const fs = require('fs/promises');
const path = require('path');
const QRCode = require('qrcode');
const { randomUUID } = require('crypto');
const { setInterval: nodeSetInterval, clearInterval: nodeClearInterval } = require('timers');

const { fetchWithTimeout } = require('../lib/http-client');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SOCIAL_STORE_PATH = path.join(__dirname, '..', 'data', 'social.json');
const AUTH_STORE_PATH = path.join(__dirname, '..', 'data', 'auth-users.json');
const USING_LOCAL_STORE = !(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
let forceLocalStore = false;

function usingLocalStore() {
  return USING_LOCAL_STORE || forceLocalStore;
}

function enableLocalFallback(reason, error) {
  if (!forceLocalStore && !USING_LOCAL_STORE) {
    const details = error instanceof Error ? error.message : String(error);
    console.warn(`Falling back to local social store after ${reason}: ${details}`);
  }
  forceLocalStore = true;
}

const MAX_REVIEW_LENGTH = 600;
const MAX_LONG_REVIEW_LENGTH = 2400;
const MAX_SUGGESTION_RESULTS = 8;
const MAX_FOLLOW_NOTE_LENGTH = 180;
const SEARCH_RESULT_LIMIT = 6;
const MIN_SEARCH_LENGTH = 2;
const STREAM_HEARTBEAT_MS = 20000;
const PRESENCE_TTL_MS = 120000;
const REVIEW_REACTIONS = ['👍', '❤️', '😂', '😮'];
const PRESENCE_STATUS_PRESETS = new Set(['default', 'available', 'comedy', 'rewatch']);

const streamClients = new Set();
const presenceMap = new Map();

let presenceCleanupTimer = null;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    try {
      await handleStreamRequest(req, res);
    } catch (error) {
      if (error instanceof HttpError) {
        if (!res.headersSent) {
          res.status(error.status).json({ error: error.message });
        }
      } else {
        console.error('Stream request failed', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Unable to open live updates stream.' });
        }
      }
    }
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let payload = await readBody(req);
  if (!payload || typeof payload !== 'object') {
    payload = {};
  }

  const action = typeof payload.action === 'string' ? payload.action : null;
  if (!action) {
    res.status(400).json({ error: 'Missing action' });
    return;
  }

  try {
    let result;
    switch (action) {
      case 'listFollowing':
        result = await handleListFollowing(req, payload);
        break;
      case 'followUser':
        result = await handleFollowUser(req, payload);
        break;
      case 'unfollowUser':
        result = await handleUnfollowUser(req, payload);
        break;
      case 'getMovieReviews':
        result = await handleGetMovieReviews(req, payload);
        break;
      case 'upsertReview':
        result = await handleUpsertReview(req, payload);
        break;
      case 'likeReview':
        result = await handleLikeReview(req, payload);
        break;
      case 'unlikeReview':
        result = await handleUnlikeReview(req, payload);
        break;
      case 'listNotifications':
        result = await handleListNotifications(req, payload);
        break;
      case 'ackNotifications':
        result = await handleAcknowledgeNotifications(req, payload);
        break;
      case 'recordLibraryAction':
        result = await handleRecordLibraryAction(req, payload);
        break;
      case 'searchUsers':
        result = await handleSearchUsers(req, payload);
        break;
      case 'postReviewReply':
        result = await handlePostReviewReply(req, payload);
        break;
      case 'listReviewThread':
        result = await handleListReviewThread(req, payload);
        break;
      case 'reactToReview':
        result = await handleReactToReview(req, payload);
        break;
      case 'removeReviewReaction':
        result = await handleRemoveReviewReaction(req, payload);
        break;
      case 'listCollaborativeState':
        result = await handleListCollaborativeState(req, payload);
        break;
      case 'createCollaborativeList':
        result = await handleCreateCollaborativeList(req, payload);
        break;
      case 'inviteCollaborator':
        result = await handleInviteCollaborator(req, payload);
        break;
      case 'respondCollaboratorInvite':
        result = await handleRespondCollaboratorInvite(req, payload);
        break;
      case 'addCollaborativeItem':
        result = await handleAddCollaborativeItem(req, payload);
        break;
      case 'removeCollaborativeItem':
        result = await handleRemoveCollaborativeItem(req, payload);
        break;
      case 'voteCollaborativeItem':
        result = await handleVoteCollaborativeItem(req, payload);
        break;
      case 'postCollaborativeNote':
        result = await handlePostCollaborativeNote(req, payload);
        break;
      case 'scheduleWatchParty':
        result = await handleScheduleWatchParty(req, payload);
        break;
      case 'respondWatchParty':
        result = await handleRespondWatchParty(req, payload);
        break;
      case 'updatePresence':
        result = await handleUpdatePresence(req, payload);
        break;
      case 'generateInviteQr':
        result = await handleGenerateInviteQr(req, payload);
        break;
      default:
        res.status(400).json({ error: 'Unsupported action' });
        return;
    }

    res.status(result.status || 200).json(result.body);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error('Social API error', error);
    res.status(500).json({ error: 'Unexpected social service error.' });
  }
};

async function handleListFollowing(req, payload) {
  const { user } = await authenticate(req, payload);
  const overview = await buildSocialOverview(user.username);
  return {
    body: {
      ok: true,
      ...overview
    }
  };
}

async function handleStreamRequest(req, res) {
  const parsed = new URL(req.url || '/api/social', 'http://localhost');
  const channel = parsed.searchParams.get('channel') || 'notifications';
  const token = parsed.searchParams.get('token') || '';
  if (!token) {
    throw new HttpError(401, 'Missing session token.');
  }
  const { user } = await authenticate({ headers: req.headers }, { token });
  const username = canonicalUsername(user && user.username ? user.username : '');
  if (!username) {
    throw new HttpError(401, 'Session expired. Sign in again.');
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive'
  });

  const client = {
    username,
    channel,
    res,
    closed: false,
    heartbeat: nodeSetInterval(() => {
      try {
        res.write(':\n\n');
      } catch (error) {
        cleanupStreamClient(client);
      }
    }, STREAM_HEARTBEAT_MS)
  };

  streamClients.add(client);

  const snapshot = buildPresenceSnapshot();
  res.write(`event: ready\ndata: ${JSON.stringify({ channel, presence: snapshot })}\n\n`);

  recordPresence(username, { state: 'online', source: channel });
  broadcastPresenceSnapshot();

  req.on('close', () => {
    cleanupStreamClient(client);
    recordPresence(username, { state: 'away', source: 'stream' });
    broadcastPresenceSnapshot();
  });
}

function cleanupStreamClient(client) {
  if (!client || client.closed) {
    return;
  }
  client.closed = true;
  if (client.heartbeat) {
    nodeClearInterval(client.heartbeat);
  }
  try {
    client.res.end();
  } catch (error) {
    // Ignore close errors.
  }
  streamClients.delete(client);
}

function pushStreamEvent(client, eventName, payload) {
  if (!client || client.closed) {
    return;
  }
  try {
    client.res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
  } catch (error) {
    cleanupStreamClient(client);
  }
}

function broadcastNotificationToStreams(entry) {
  if (!entry || !entry.username) {
    return;
  }
  const payload = {
    notification: {
      id: entry.id,
      type: entry.type,
      actor: entry.actor || null,
      message: entry.message,
      movieTitle: entry.movieTitle || null,
      movieTmdbId: entry.movieTmdbId || null,
      movieImdbId: entry.movieImdbId || null,
      note: entry.note || null,
      createdAt: entry.createdAt || new Date().toISOString()
    }
  };
  streamClients.forEach((client) => {
    if (client.username === entry.username) {
      pushStreamEvent(client, 'notification', payload);
    }
  });
}

async function handleFollowUser(req, payload) {
  const { user } = await authenticate(req, payload);
  const target = canonicalUsername(payload && payload.target ? payload.target : '');

  if (!target) {
    throw new HttpError(400, 'Enter a username to follow.');
  }
  if (target === user.username) {
    throw new HttpError(400, 'You cannot follow yourself.');
  }

  const exists = await userExists(target);
  if (!exists) {
    throw new HttpError(404, 'That username does not exist.');
  }

  const noteRaw = typeof payload.note === 'string' ? payload.note : '';
  if (noteRaw && stripControlCharacters(noteRaw).trim().length > MAX_FOLLOW_NOTE_LENGTH) {
    throw new HttpError(400, `Follow notes must be ${MAX_FOLLOW_NOTE_LENGTH} characters or fewer.`);
  }
  const note = sanitizeFollowNote(noteRaw);

  await upsertFollow(user.username, target);
  await enqueueNotification({
    username: target,
    type: 'follow',
    actor: user.username,
    note
  });
  return {
    body: {
      ok: true,
      ...(await buildSocialOverview(user.username))
    }
  };
}

async function handleUnfollowUser(req, payload) {
  const { user } = await authenticate(req, payload);
  const target = canonicalUsername(payload && payload.target ? payload.target : '');
  if (!target) {
    throw new HttpError(400, 'Enter a username to unfollow.');
  }
  if (target === user.username) {
    throw new HttpError(400, 'You cannot unfollow yourself.');
  }

  await deleteFollow(user.username, target);
  return {
    body: {
      ok: true,
      ...(await buildSocialOverview(user.username))
    }
  };
}

async function handleGetMovieReviews(req, payload) {
  const { user } = await authenticate(req, payload);
  const movie = normalizeMovieInput(payload.movie);
  if (!movie || !movie.tmdbId || !movie.title) {
    throw new HttpError(400, 'Missing movie identifiers.');
  }

  const resolvedMovie = await resolveMovieIdentifiers(movie);
  const following = new Set(await listFollowing(user.username));
  const { reviews, myReview, stats } = await fetchMovieReviews(
    resolvedMovie,
    following,
    user.username
  );
  return {
    body: {
      reviews,
      myReview,
      stats
    }
  };
}

async function handleUpsertReview(req, payload) {
  const { user } = await authenticate(req, payload);
  const movie = normalizeMovieInput(payload.movie);
  if (!movie || !movie.tmdbId || !movie.title) {
    throw new HttpError(400, 'Missing movie identifiers.');
  }

  const reviewInput = payload.review && typeof payload.review === 'object' ? payload.review : {};
  const rating = normalizeRating(reviewInput.rating);
  if (rating === null) {
    throw new HttpError(400, 'Enter a rating between 0 and 10.');
  }

  const content = normalizeReviewContent(reviewInput);
  const resolvedMovie = await resolveMovieIdentifiers(movie);
  if (!usingLocalStore() && !resolvedMovie.imdbId) {
    throw new HttpError(400, 'Missing IMDb ID for this movie. Try another recommendation.');
  }
  await upsertReview({
    username: user.username,
    movie: resolvedMovie,
    rating,
    body: content.capsule || null,
    hasSpoilers: content.hasSpoilers,
    fullText: content.fullText || null,
    segments: content.segments
  });
  await broadcastReviewActivity({
    actor: user.username,
    movie: resolvedMovie,
    body: content.capsule
  });

  const following = new Set(await listFollowing(user.username));
  const { reviews, myReview, stats } = await fetchMovieReviews(
    resolvedMovie,
    following,
    user.username
  );
  return {
    body: {
      ok: true,
      myReview,
      reviews,
      stats
    }
  };
}

async function handleLikeReview(req, payload) {
  const { user } = await authenticate(req, payload);
  const movie = normalizeMovieInput(payload.movie);
  const reviewUsername = canonicalUsername(payload.reviewUsername || '');
  const reviewIdRaw = payload && typeof payload.reviewId === 'string' ? payload.reviewId.trim() : '';
  const reviewId = reviewIdRaw || null;
  if (!movie || !movie.tmdbId || !movie.title) {
    throw new HttpError(400, 'Missing movie identifiers.');
  }
  if (!reviewUsername) {
    throw new HttpError(400, 'Missing review username.');
  }
  if (reviewUsername === user.username) {
    throw new HttpError(400, 'You cannot like your own review.');
  }

  const resolvedMovie = await resolveMovieIdentifiers(movie);
  const timestamp = new Date().toISOString();
  const targetReviewId = await ensureReviewId({
    movie: resolvedMovie,
    reviewUsername,
    reviewId,
    requireRemote: !usingLocalStore()
  });
  if (!targetReviewId) {
    throw new HttpError(404, 'Unable to locate that review.');
  }

  if (usingLocalStore()) {
    const likes = await likeReviewLocal({
      movie: resolvedMovie,
      reviewUsername,
      reviewId: targetReviewId,
      likedBy: user.username,
      timestamp
    });
    return { body: { ok: true, likes } };
  }

  let created = true;
  try {
    await ensureMovieRecord(resolvedMovie);
    await supabaseFetch('review_likes', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates' },
      body: [
        {
          review_id: targetReviewId,
          username: user.username,
          created_at: timestamp
        }
      ]
    });
  } catch (error) {
    if (error instanceof HttpError && error.status === 409) {
      created = false;
    } else {
      enableLocalFallback('liking a review', error);
      const likes = await likeReviewLocal({
        movie: resolvedMovie,
        reviewUsername,
        reviewId: targetReviewId,
        likedBy: user.username,
        timestamp
      });
      return { body: { ok: true, likes } };
    }
  }

  if (created) {
    await enqueueNotification({
      username: reviewUsername,
      type: 'review_like',
      actor: user.username,
      movie: resolvedMovie,
      timestamp
    });
  }

  const likes = await fetchReviewLikeSummary({
    reviewId: targetReviewId,
    movie: resolvedMovie,
    reviewUsername,
    currentUsername: user.username
  });
  return { body: { ok: true, likes } };
}

async function handleUnlikeReview(req, payload) {
  const { user } = await authenticate(req, payload);
  const movie = normalizeMovieInput(payload.movie);
  const reviewUsername = canonicalUsername(payload.reviewUsername || '');
  const reviewIdRaw = payload && typeof payload.reviewId === 'string' ? payload.reviewId.trim() : '';
  const reviewId = reviewIdRaw || null;
  if (!movie || !movie.tmdbId || !movie.title) {
    throw new HttpError(400, 'Missing movie identifiers.');
  }
  if (!reviewUsername) {
    throw new HttpError(400, 'Missing review username.');
  }

  const resolvedMovie = await resolveMovieIdentifiers(movie);
  const targetReviewId = await ensureReviewId({
    movie: resolvedMovie,
    reviewUsername,
    reviewId,
    requireRemote: !usingLocalStore()
  });
  if (!targetReviewId) {
    throw new HttpError(404, 'Unable to locate that review.');
  }

  if (usingLocalStore()) {
    const likes = await unlikeReviewLocal({
      movie: resolvedMovie,
      reviewUsername,
      reviewId: targetReviewId,
      likedBy: user.username
    });
    return { body: { ok: true, likes } };
  }

  try {
    await supabaseFetch('review_likes', {
      method: 'DELETE',
      query: {
        review_id: `eq.${targetReviewId}`,
        username: `eq.${user.username}`
      }
    });
  } catch (error) {
    enableLocalFallback('removing a review like', error);
    const likes = await unlikeReviewLocal({
      movie: resolvedMovie,
      reviewUsername,
      reviewId: targetReviewId,
      likedBy: user.username
    });
    return { body: { ok: true, likes } };
  }
  const likes = await fetchReviewLikeSummary({
    reviewId: targetReviewId,
    movie: resolvedMovie,
    reviewUsername,
    currentUsername: user.username
  });
  return { body: { ok: true, likes } };
}

async function handleListNotifications(req, payload) {
  const { user } = await authenticate(req, payload);
  const limit = Number(payload.limit) || 50;
  const response = await listNotifications(user.username, { limit });
  return { body: response };
}

async function handleAcknowledgeNotifications(req, payload) {
  const { user } = await authenticate(req, payload);
  await markNotificationsRead(user.username);
  const response = await listNotifications(user.username, { limit: Number(payload.limit) || 50 });
  return { body: response };
}

async function handleRecordLibraryAction(req, payload) {
  const { user } = await authenticate(req, payload);
  const action = typeof payload.action === 'string' ? payload.action : '';
  if (!['watchlist_add', 'favorite_add'].includes(action)) {
    throw new HttpError(400, 'Unsupported library action.');
  }
  const movie = normalizeMovieInput(payload.movie);
  if (!movie || !movie.tmdbId || !movie.title) {
    throw new HttpError(400, 'Missing movie identifiers.');
  }
  const resolvedMovie = await resolveMovieIdentifiers(movie);
  await recordLibraryActivity({
    username: user.username,
    action,
    movie: resolvedMovie
  });
  return { body: { ok: true } };
}

async function handleSearchUsers(req, payload) {
  const { user } = await authenticate(req, payload);
  const queryRaw = typeof payload.query === 'string' ? payload.query : '';
  const query = queryRaw.trim();
  if (query.length < MIN_SEARCH_LENGTH) {
    throw new HttpError(400, `Enter at least ${MIN_SEARCH_LENGTH} characters to search.`);
  }
  const graph = await loadSocialGraph(user.username);
  const suggestionContext = await loadSuggestionCandidates({
    username: graph.username,
    followingSet: graph.followingSet,
    followersSet: graph.followersSet
  });
  const normalizedQuery = query.toLowerCase();
  const matches = suggestionContext.candidates
    .filter((profile) => {
      if (!profile || !profile.username) {
        return false;
      }
      if (graph.followingSet.has(profile.username)) {
        return false;
      }
      const displayName = profile.displayName ? profile.displayName.toLowerCase() : '';
      return (
        profile.username.includes(normalizedQuery) ||
        (displayName && displayName.includes(normalizedQuery))
      );
    })
    .map((profile) => {
      const sharedFavorites = computeSharedFavorites(suggestionContext.userProfile, profile);
      const sharedGenres = computeSharedGenres(suggestionContext.userProfile, profile);
      const sharedWatchHistory = computeSharedWatchHistory(suggestionContext.userProfile, profile);
      const sharedWatchParties = computeSharedWatchParties(
        graph.username,
        profile.username,
        suggestionContext.partyIndex
      );
      const mutualFollowers = computeMutualFollowersForCandidate(
        profile,
        graph.followingSet,
        graph.followersSet
      );
      const followsYou = graph.followersSet.has(profile.username);
      const baseScore =
        (profile.username.startsWith(normalizedQuery) ? 6 : 0) +
        (sharedFavorites.length * 4) +
        (sharedGenres.length * 2) +
        (sharedWatchHistory.length * 3) +
        (sharedWatchParties.length ? 4 : 0) +
        (mutualFollowers.length ? 2 : 0) +
        (followsYou ? 3 : 0);
      return {
        profile,
        sharedFavorites,
        sharedGenres,
        sharedWatchHistory,
        sharedWatchParties,
        mutualFollowers,
        followsYou,
        score: baseScore
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if ((b.profile.followerCount || 0) !== (a.profile.followerCount || 0)) {
        return (b.profile.followerCount || 0) - (a.profile.followerCount || 0);
      }
      const nameA = a.profile.displayName || a.profile.username;
      const nameB = b.profile.displayName || b.profile.username;
      return nameA.localeCompare(nameB);
    })
    .slice(0, SEARCH_RESULT_LIMIT)
    .map((entry) =>
      normalizeSuggestionPayload(
        {
          username: entry.profile.username,
          displayName: entry.profile.displayName,
          tagline: buildProfileTagline(entry.profile),
          sharedInterests: entry.sharedGenres,
          sharedFavorites: entry.sharedFavorites,
          sharedWatchHistory: entry.sharedWatchHistory,
          sharedWatchParties: entry.sharedWatchParties,
          mutualFollowers: entry.mutualFollowers,
          followsYou: entry.followsYou,
          preferencesSnapshot: entry.profile.preferencesSnapshot || null
        },
        {
          username: graph.username,
          followingSet: graph.followingSet,
          followersSet: graph.followersSet
        }
      )
    )
    .filter(Boolean);

  return {
    body: {
      ok: true,
      results: matches
    }
  };
}

async function handlePostReviewReply(req, payload) {
  const { user } = await authenticate(req, payload);
  const movie = normalizeMovieInput(payload.movie);
  if (!movie || !movie.tmdbId || !movie.title) {
    throw new HttpError(400, 'Missing movie identifiers.');
  }
  const reviewUsername = canonicalUsername(payload.reviewUsername || '');
  if (!reviewUsername) {
    throw new HttpError(400, 'Missing review owner.');
  }
  const reviewIdRaw = typeof payload.reviewId === 'string' ? payload.reviewId.trim() : '';
  const parentIdRaw = typeof payload.parentId === 'string' ? payload.parentId.trim() : '';
  const bodyRaw = typeof payload.body === 'string' ? payload.body.trim() : '';
  if (!bodyRaw) {
    throw new HttpError(400, 'Enter a reply before posting.');
  }
  const resolvedMovie = await resolveMovieIdentifiers(movie);
  const targetReviewId = await ensureReviewId({
    movie: resolvedMovie,
    reviewUsername,
    reviewId: reviewIdRaw || null,
    requireRemote: !usingLocalStore()
  });
  if (!targetReviewId) {
    throw new HttpError(404, 'Unable to locate that review.');
  }
  const mentions = extractMentions(bodyRaw);
  const comment = await addReviewComment({
    reviewId: targetReviewId,
    reviewUsername,
    username: user.username,
    movie: resolvedMovie,
    body: bodyRaw,
    parentId: parentIdRaw || null,
    mentions
  });
  const threadEntries = await listReviewComments({
    movie: resolvedMovie,
    reviewId: targetReviewId,
    reviewUsername
  });
  const commentMap = new Map();
  threadEntries.forEach((entry) => {
    commentMap.set(entry.id, entry);
  });
  const notifyTargets = new Set();
  if (reviewUsername && reviewUsername !== user.username) {
    notifyTargets.add(reviewUsername);
  }
  if (comment.parentCommentId) {
    const parent = commentMap.get(comment.parentCommentId);
    if (parent && parent.username && parent.username !== user.username) {
      notifyTargets.add(parent.username);
    }
  }
  mentions
    .filter((mention) => mention && mention !== user.username)
    .forEach((mention) => notifyTargets.add(mention));
  await Promise.all(
    Array.from(notifyTargets).map((target) =>
      enqueueNotification({
        username: target,
        type: mentions.includes(target) ? 'mention' : 'review_reply',
        actor: user.username,
        movie: resolvedMovie
      })
    )
  );
  const comments = mapCommentEntries(threadEntries, user.username);
  return {
    body: {
      ok: true,
      comments,
      mentions: Array.from(new Set(mentions))
    }
  };
}

async function handleListReviewThread(req, payload) {
  const { user } = await authenticate(req, payload);
  const movie = normalizeMovieInput(payload.movie);
  if (!movie || !movie.tmdbId || !movie.title) {
    throw new HttpError(400, 'Missing movie identifiers.');
  }
  const reviewUsername = canonicalUsername(payload.reviewUsername || '');
  if (!reviewUsername) {
    throw new HttpError(400, 'Missing review owner.');
  }
  const reviewIdRaw = typeof payload.reviewId === 'string' ? payload.reviewId.trim() : '';
  const resolvedMovie = await resolveMovieIdentifiers(movie);
  const targetReviewId = await ensureReviewId({
    movie: resolvedMovie,
    reviewUsername,
    reviewId: reviewIdRaw || null,
    requireRemote: !usingLocalStore()
  });
  if (!targetReviewId) {
    throw new HttpError(404, 'Unable to locate that review.');
  }
  const threadEntries = await listReviewComments({
    movie: resolvedMovie,
    reviewId: targetReviewId,
    reviewUsername
  });
  return {
    body: {
      ok: true,
      comments: mapCommentEntries(threadEntries, user.username)
    }
  };
}

async function handleReactToReview(req, payload) {
  const { user } = await authenticate(req, payload);
  const movie = normalizeMovieInput(payload.movie);
  if (!movie || !movie.tmdbId || !movie.title) {
    throw new HttpError(400, 'Missing movie identifiers.');
  }
  const reviewUsername = canonicalUsername(payload.reviewUsername || '');
  if (!reviewUsername) {
    throw new HttpError(400, 'Missing review owner.');
  }
  const reviewIdRaw = typeof payload.reviewId === 'string' ? payload.reviewId.trim() : '';
  const reaction = typeof payload.reaction === 'string' ? payload.reaction.trim() : '';
  if (!REVIEW_REACTIONS.includes(reaction)) {
    throw new HttpError(400, 'Unsupported reaction.');
  }
  const resolvedMovie = await resolveMovieIdentifiers(movie);
  const targetReviewId = await ensureReviewId({
    movie: resolvedMovie,
    reviewUsername,
    reviewId: reviewIdRaw || null,
    requireRemote: !usingLocalStore()
  });
  if (!targetReviewId) {
    throw new HttpError(404, 'Unable to locate that review.');
  }
  const timestamp = new Date().toISOString();
  let entries;
  if (usingLocalStore()) {
    entries = await reactToReviewLocal({
      movie: resolvedMovie,
      reviewUsername,
      reviewId: targetReviewId,
      username: user.username,
      emoji: reaction,
      timestamp
    });
  } else {
    enableLocalFallback('storing review reactions', new Error('Review reactions are local-only.'));
    entries = await reactToReviewLocal({
      movie: resolvedMovie,
      reviewUsername,
      reviewId: targetReviewId,
      username: user.username,
      emoji: reaction,
      timestamp
    });
  }
  if (reviewUsername !== user.username) {
    await enqueueNotification({
      username: reviewUsername,
      type: 'review_reaction',
      actor: user.username,
      movie: resolvedMovie,
      timestamp
    });
  }
  const summary = summarizeReactions(entries, user.username);
  return { body: { ok: true, reactions: summary } };
}

async function handleRemoveReviewReaction(req, payload) {
  const { user } = await authenticate(req, payload);
  const movie = normalizeMovieInput(payload.movie);
  if (!movie || !movie.tmdbId || !movie.title) {
    throw new HttpError(400, 'Missing movie identifiers.');
  }
  const reviewUsername = canonicalUsername(payload.reviewUsername || '');
  if (!reviewUsername) {
    throw new HttpError(400, 'Missing review owner.');
  }
  const reviewIdRaw = typeof payload.reviewId === 'string' ? payload.reviewId.trim() : '';
  const resolvedMovie = await resolveMovieIdentifiers(movie);
  const targetReviewId = await ensureReviewId({
    movie: resolvedMovie,
    reviewUsername,
    reviewId: reviewIdRaw || null,
    requireRemote: !usingLocalStore()
  });
  if (!targetReviewId) {
    throw new HttpError(404, 'Unable to locate that review.');
  }
  let entries;
  if (usingLocalStore()) {
    entries = await removeReactionLocal({
      movie: resolvedMovie,
      reviewUsername,
      reviewId: targetReviewId,
      username: user.username
    });
  } else {
    enableLocalFallback('removing review reaction', new Error('Review reactions are local-only.'));
    entries = await removeReactionLocal({
      movie: resolvedMovie,
      reviewUsername,
      reviewId: targetReviewId,
      username: user.username
    });
  }
  const summary = summarizeReactions(entries, user.username);
  return { body: { ok: true, reactions: summary } };
}

async function handleListCollaborativeState(req, payload) {
  const { user } = await authenticate(req, payload);
  if (!usingLocalStore()) {
    return {
      body: {
        ok: true,
        lists: { owned: [], shared: [], invites: [] },
        watchParties: { upcoming: [], invites: [] }
      }
    };
  }
  const store = await readSocialStore();
  const lists = listCollaborativeSummary(store, user.username);
  const watchParties = listWatchPartySummary(store, user.username);
  return {
    body: {
      ok: true,
      lists,
      watchParties
    }
  };
}

async function handleCreateCollaborativeList(req, payload) {
  const { user } = await authenticate(req, payload);
  if (!usingLocalStore()) {
    throw new HttpError(501, 'Collaborative lists are only available in local demo mode.');
  }
  const nameRaw = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (nameRaw.length < 3) {
    throw new HttpError(400, 'Name your list with at least 3 characters.');
  }
  const description = typeof payload.description === 'string' ? payload.description.trim() : '';
  const visibility = payload.visibility === 'private' ? 'private' : 'friends';
  const timestamp = new Date().toISOString();
  const store = await readSocialStore();
  const list = {
    id: randomUUID(),
    owner: user.username,
    name: nameRaw,
    description,
    visibility,
    collaborators: [],
    invites: [],
    items: [],
    discussion: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
  store.collabLists.push(list);
  await writeSocialStore(store);
  return {
    body: {
      ok: true,
      list: formatCollaborativeListForUser(list, user.username)
    }
  };
}

async function handleInviteCollaborator(req, payload) {
  const { user } = await authenticate(req, payload);
  if (!usingLocalStore()) {
    throw new HttpError(501, 'Collaborative invites require local mode.');
  }
  const listId = typeof payload.listId === 'string' ? payload.listId.trim() : '';
  const target = canonicalUsername(payload.username || '');
  if (!listId || !target) {
    throw new HttpError(400, 'Select a collaborator to invite.');
  }
  if (target === user.username) {
    throw new HttpError(400, 'You are already part of this list.');
  }
  const store = await readSocialStore();
  const list = store.collabLists.find((entry) => entry.id === listId);
  if (!list) {
    throw new HttpError(404, 'Could not find that collaborative list.');
  }
  if (list.owner !== user.username) {
    throw new HttpError(403, 'Only the list owner can invite collaborators.');
  }
  const timestamp = new Date().toISOString();
  list.invites = Array.isArray(list.invites) ? list.invites : [];
  list.collaborators = Array.isArray(list.collaborators) ? list.collaborators : [];
  const alreadyCollaborator = list.collaborators.some((entry) => canonicalUsername(entry.username) === target);
  if (alreadyCollaborator) {
    throw new HttpError(400, 'They already have edit access.');
  }
  const pending = list.invites.find((invite) => canonicalUsername(invite.username) === target && invite.status === 'pending');
  if (pending) {
    throw new HttpError(400, 'Invite already pending.');
  }
  list.invites.push({
    username: target,
    invitedBy: user.username,
    status: 'pending',
    invitedAt: timestamp
  });
  list.updatedAt = timestamp;
  await writeSocialStore(store);
  await enqueueNotification({
    username: target,
    type: 'collab_invite',
    actor: user.username,
    movie: { title: list.name }
  });
  return {
    body: {
      ok: true,
      list: formatCollaborativeListForUser(list, user.username)
    }
  };
}

async function handleRespondCollaboratorInvite(req, payload) {
  const { user } = await authenticate(req, payload);
  if (!usingLocalStore()) {
    throw new HttpError(501, 'Collaborative invites require local mode.');
  }
  const listId = typeof payload.listId === 'string' ? payload.listId.trim() : '';
  const decision = (typeof payload.decision === 'string' ? payload.decision.trim().toLowerCase() : '').replace(/[^a-z]/g, '');
  if (!listId) {
    throw new HttpError(400, 'Missing collaborative list identifier.');
  }
  if (!['accept', 'decline'].includes(decision)) {
    throw new HttpError(400, 'Choose to accept or decline the invite.');
  }
  const store = await readSocialStore();
  const list = store.collabLists.find((entry) => entry.id === listId);
  if (!list) {
    throw new HttpError(404, 'Could not find that collaborative list.');
  }
  list.invites = Array.isArray(list.invites) ? list.invites : [];
  const inviteIndex = list.invites.findIndex(
    (invite) => canonicalUsername(invite.username) === user.username && invite.status === 'pending'
  );
  if (inviteIndex === -1) {
    throw new HttpError(404, 'No pending invite found.');
  }
  const timestamp = new Date().toISOString();
  const invite = list.invites[inviteIndex];
  if (decision === 'accept') {
    list.collaborators = Array.isArray(list.collaborators) ? list.collaborators : [];
    list.collaborators.push({ username: user.username, joinedAt: timestamp });
    list.invites.splice(inviteIndex, 1);
    list.updatedAt = timestamp;
    await writeSocialStore(store);
    await enqueueNotification({
      username: list.owner,
      type: 'collab_accept',
      actor: user.username,
      movie: { title: list.name }
    });
  } else {
    list.invites[inviteIndex] = {
      ...invite,
      status: 'declined',
      respondedAt: timestamp
    };
    list.updatedAt = timestamp;
    await writeSocialStore(store);
  }
  const state = listCollaborativeSummary(store, user.username);
  return {
    body: {
      ok: true,
      lists: state
    }
  };
}

async function handleAddCollaborativeItem(req, payload) {
  const { user } = await authenticate(req, payload);
  if (!usingLocalStore()) {
    throw new HttpError(501, 'Collaborative list editing requires local mode.');
  }
  const listId = typeof payload.listId === 'string' ? payload.listId.trim() : '';
  if (!listId) {
    throw new HttpError(400, 'Select a collaborative list first.');
  }
  const movie = normalizeMovieInput(payload.movie);
  if (!movie || !movie.tmdbId || !movie.title) {
    throw new HttpError(400, 'Missing movie identifiers.');
  }
  const notes = typeof payload.notes === 'string' ? payload.notes.trim() : '';
  const resolvedMovie = await resolveMovieIdentifiers(movie);
  const store = await readSocialStore();
  const list = store.collabLists.find((entry) => entry.id === listId);
  if (!list) {
    throw new HttpError(404, 'Could not find that collaborative list.');
  }
  const actor = canonicalUsername(user.username);
  const hasAccess = list.owner === actor || (Array.isArray(list.collaborators) && list.collaborators.some((entry) => canonicalUsername(entry.username) === actor));
  if (!hasAccess) {
    throw new HttpError(403, 'You do not have permission to edit this list.');
  }
  list.items = Array.isArray(list.items) ? list.items : [];
  const exists = list.items.some((item) => item.tmdbId === resolvedMovie.tmdbId);
  if (exists) {
    throw new HttpError(400, 'That movie is already on the list.');
  }
  const timestamp = new Date().toISOString();
  list.items.push({
    tmdbId: resolvedMovie.tmdbId,
    imdbId: resolvedMovie.imdbId || null,
    title: resolvedMovie.title,
    notes,
    addedBy: user.username,
    addedAt: timestamp,
    votes: { yes: [], no: [] }
  });
  list.updatedAt = timestamp;
  await writeSocialStore(store);
  return {
    body: {
      ok: true,
      list: formatCollaborativeListForUser(list, user.username)
    }
  };
}

async function handleRemoveCollaborativeItem(req, payload) {
  const { user } = await authenticate(req, payload);
  if (!usingLocalStore()) {
    throw new HttpError(501, 'Collaborative list editing requires local mode.');
  }
  const listId = typeof payload.listId === 'string' ? payload.listId.trim() : '';
  const tmdbId = normalizeId(payload.tmdbId || payload.movieTmdbId || payload.movieId);
  if (!listId || !tmdbId) {
    throw new HttpError(400, 'Missing list or movie identifiers.');
  }
  const store = await readSocialStore();
  const list = store.collabLists.find((entry) => entry.id === listId);
  if (!list) {
    throw new HttpError(404, 'Could not find that collaborative list.');
  }
  const actor = canonicalUsername(user.username);
  const hasAccess = list.owner === actor || (Array.isArray(list.collaborators) && list.collaborators.some((entry) => canonicalUsername(entry.username) === actor));
  if (!hasAccess) {
    throw new HttpError(403, 'You do not have permission to edit this list.');
  }
  const before = Array.isArray(list.items) ? list.items.length : 0;
  list.items = Array.isArray(list.items)
    ? list.items.filter((item) => item.tmdbId !== tmdbId)
    : [];
  if (list.items.length === before) {
    throw new HttpError(404, 'That movie is not on this list.');
  }
  list.updatedAt = new Date().toISOString();
  await writeSocialStore(store);
  return {
    body: {
      ok: true,
      list: formatCollaborativeListForUser(list, user.username)
    }
  };
}

async function handleVoteCollaborativeItem(req, payload) {
  const { user } = await authenticate(req, payload);
  if (!usingLocalStore()) {
    throw new HttpError(501, 'Collaborative list voting requires local mode.');
  }
  const listId = typeof payload.listId === 'string' ? payload.listId.trim() : '';
  const tmdbId = normalizeId(payload.tmdbId || payload.movieTmdbId || payload.movieId);
  const voteRaw = typeof payload.vote === 'string' ? payload.vote.trim().toLowerCase() : '';
  const vote = voteRaw === 'no' ? 'no' : voteRaw === 'clear' ? 'clear' : 'yes';
  if (!listId || !tmdbId) {
    throw new HttpError(400, 'Missing list or movie identifiers.');
  }
  const store = await readSocialStore();
  const list = store.collabLists.find((entry) => entry.id === listId);
  if (!list) {
    throw new HttpError(404, 'Could not find that collaborative list.');
  }
  const actor = canonicalUsername(user.username);
  const hasAccess = list.owner === actor ||
    (Array.isArray(list.collaborators) && list.collaborators.some((entry) => canonicalUsername(entry.username) === actor));
  if (!hasAccess) {
    throw new HttpError(403, 'You do not have permission to vote on this list.');
  }
  list.items = Array.isArray(list.items) ? list.items : [];
  const item = list.items.find((entry) => normalizeId(entry.tmdbId) === tmdbId);
  if (!item) {
    throw new HttpError(404, 'That movie is not on this list.');
  }
  item.votes = normalizeCollaborativeVotes(item.votes);
  const yesSet = new Set(item.votes.yes);
  const noSet = new Set(item.votes.no);
  yesSet.delete(actor);
  noSet.delete(actor);
  if (vote === 'yes') {
    yesSet.add(actor);
  } else if (vote === 'no') {
    noSet.add(actor);
  }
  item.votes = { yes: Array.from(yesSet), no: Array.from(noSet) };
  list.updatedAt = new Date().toISOString();
  await writeSocialStore(store);
  return {
    body: {
      ok: true,
      list: formatCollaborativeListForUser(list, user.username)
    }
  };
}

async function handlePostCollaborativeNote(req, payload) {
  const { user } = await authenticate(req, payload);
  if (!usingLocalStore()) {
    throw new HttpError(501, 'Collaborative notes are only available in local demo mode.');
  }
  const listId = typeof payload.listId === 'string' ? payload.listId.trim() : '';
  const bodyRaw = typeof payload.body === 'string' ? payload.body.trim() : '';
  if (!listId) {
    throw new HttpError(400, 'Select a collaborative list first.');
  }
  if (!bodyRaw) {
    throw new HttpError(400, 'Share a short note before posting.');
  }
  const message = bodyRaw.slice(0, 240);
  const store = await readSocialStore();
  const list = store.collabLists.find((entry) => entry.id === listId);
  if (!list) {
    throw new HttpError(404, 'Could not find that collaborative list.');
  }
  const actor = canonicalUsername(user.username);
  const canComment = list.owner === actor ||
    (Array.isArray(list.collaborators) && list.collaborators.some((entry) => canonicalUsername(entry.username) === actor));
  if (!canComment) {
    throw new HttpError(403, 'You do not have permission to chat on this list.');
  }
  list.discussion = Array.isArray(list.discussion) ? list.discussion : [];
  const timestamp = new Date().toISOString();
  list.discussion.push({
    id: randomUUID(),
    username: actor,
    body: message,
    createdAt: timestamp
  });
  list.updatedAt = timestamp;
  await writeSocialStore(store);
  return {
    body: {
      ok: true,
      list: formatCollaborativeListForUser(list, user.username)
    }
  };
}

async function handleScheduleWatchParty(req, payload) {
  const { user } = await authenticate(req, payload);
  if (!usingLocalStore()) {
    throw new HttpError(501, 'Watch parties are not yet available with remote storage.');
  }
  const movie = normalizeMovieInput(payload.movie);
  if (!movie || !movie.tmdbId || !movie.title) {
    throw new HttpError(400, 'Missing movie identifiers.');
  }
  const resolvedMovie = await resolveMovieIdentifiers(movie);
  const whenRaw = typeof payload.scheduledFor === 'string' ? payload.scheduledFor.trim() : '';
  if (!whenRaw) {
    throw new HttpError(400, 'Choose a date for your watch party.');
  }
  const when = new Date(whenRaw);
  if (Number.isNaN(when.getTime())) {
    throw new HttpError(400, 'Enter a valid watch party date.');
  }
  const note = typeof payload.note === 'string' ? payload.note.trim() : '';
  const invitees = Array.isArray(payload.invitees)
    ? Array.from(new Set(payload.invitees.map((entry) => canonicalUsername(entry)).filter(Boolean)))
    : [];
  const timestamp = new Date().toISOString();
  const store = await readSocialStore();
  const party = {
    id: randomUUID(),
    host: user.username,
    movieTmdbId: resolvedMovie.tmdbId,
    movieImdbId: resolvedMovie.imdbId || null,
    movieTitle: resolvedMovie.title,
    scheduledFor: when.toISOString(),
    note,
    invitees: invitees.map((username) => ({ username, response: 'pending' })),
    createdAt: timestamp
  };
  store.watchParties.push(party);
  await writeSocialStore(store);
  await Promise.all(
    invitees.map((invitee) =>
      enqueueNotification({
        username: invitee,
        type: 'watch_party',
        actor: user.username,
        movie: { title: resolvedMovie.title }
      })
    )
  );
  const watchParties = listWatchPartySummary(store, user.username);
  return {
    body: {
      ok: true,
      party: formatWatchPartyForUser(party, user.username),
      watchParties
    }
  };
}

async function handleRespondWatchParty(req, payload) {
  const { user } = await authenticate(req, payload);
  if (!usingLocalStore()) {
    throw new HttpError(501, 'Watch parties are not yet available with remote storage.');
  }
  const partyId = typeof payload.partyId === 'string' ? payload.partyId.trim() : '';
  if (!partyId) {
    throw new HttpError(400, 'Missing watch party identifier.');
  }
  const decision = (typeof payload.response === 'string' ? payload.response.trim().toLowerCase() : '').replace(/[^a-z]/g, '');
  if (!['accept', 'decline', 'maybe'].includes(decision)) {
    throw new HttpError(400, 'Select attending, maybe, or decline.');
  }
  const store = await readSocialStore();
  const party = store.watchParties.find((entry) => entry.id === partyId);
  if (!party) {
    throw new HttpError(404, 'Watch party not found.');
  }
  if (party.host === user.username) {
    party.note = typeof payload.note === 'string' ? payload.note.trim() : party.note || '';
    if (payload.scheduledFor) {
      const next = new Date(String(payload.scheduledFor));
      if (!Number.isNaN(next.getTime())) {
        party.scheduledFor = next.toISOString();
      }
    }
  }
  party.invitees = Array.isArray(party.invitees) ? party.invitees : [];
  const invite = party.invitees.find((entry) => canonicalUsername(entry.username) === user.username);
  if (!invite && party.host !== user.username) {
    throw new HttpError(403, 'You are not invited to this watch party.');
  }
  if (invite) {
    invite.response = decision;
    invite.respondedAt = new Date().toISOString();
  }
  await writeSocialStore(store);
  if (party.host !== user.username) {
    await enqueueNotification({
      username: party.host,
      type: 'watch_party_update',
      actor: user.username,
      movie: { title: party.movieTitle }
    });
  }
  return {
    body: {
      ok: true,
      party: formatWatchPartyForUser(party, user.username)
    }
  };
}

async function handleUpdatePresence(req, payload) {
  const { user } = await authenticate(req, payload);
  const stateRaw = typeof payload.state === 'string' ? payload.state.trim().toLowerCase() : 'online';
  const allowedStates = new Set(['online', 'away', 'watching']);
  const state = allowedStates.has(stateRaw) ? stateRaw : 'online';
  let movieContext = null;
  if (payload.movie) {
    const movie = normalizeMovieInput(payload.movie);
    if (movie && movie.tmdbId && movie.title) {
      movieContext = movie;
    }
  }
  const presetRaw = typeof payload.statusPreset === 'string' ? payload.statusPreset.trim().toLowerCase() : undefined;
  const statusPreset =
    presetRaw && PRESENCE_STATUS_PRESETS.has(presetRaw) ? presetRaw : presetRaw === 'default' ? 'default' : undefined;
  recordPresence(user.username, { state, movie: movieContext, statusPreset, source: 'ping' });
  broadcastPresenceSnapshot();
  return { body: { ok: true } };
}

async function handleGenerateInviteQr(req, payload) {
  const { user } = await authenticate(req, payload);
  const rawLink = typeof payload.link === 'string' ? payload.link.trim() : '';
  if (!rawLink) {
    throw new HttpError(400, 'Provide a profile link to encode.');
  }

  let parsed;
  try {
    parsed = new URL(rawLink);
  } catch (error) {
    throw new HttpError(400, 'That invite link is not valid.');
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'https:' && protocol !== 'http:') {
    throw new HttpError(400, 'Only http(s) links can be converted to a QR code.');
  }

  const followParam = canonicalUsername(parsed.searchParams.get('follow') || '');
  if (!followParam || followParam !== canonicalUsername(user.username)) {
    throw new HttpError(400, 'Use your own invite link when creating a QR code.');
  }

  const normalized = parsed.toString();

  try {
    const dataUrl = await QRCode.toDataURL(normalized, {
      errorCorrectionLevel: 'M',
      margin: 2,
      scale: 6,
      color: {
        dark: '#05050F',
        light: '#FFFFFF'
      }
    });
    return {
      body: {
        ok: true,
        dataUrl
      }
    };
  } catch (error) {
    console.error('Failed to generate invite QR code', error);
    throw new HttpError(500, 'Unable to generate a QR code right now.');
  }
}

async function authenticate(req, payload) {
  const token = extractToken(req, payload);
  if (!token) {
    throw new HttpError(401, 'Missing session token.');
  }

  if (usingLocalStore()) {
    const store = await readAuthStore();
    const sessionRow = store.sessions.find((row) => row.token === token);
    if (!sessionRow) {
      throw new HttpError(401, 'Session expired. Sign in again.');
    }
    const userRow = store.users.find((row) => row.username === sessionRow.username);
    if (!userRow) {
      throw new HttpError(401, 'Session expired. Sign in again.');
    }
    return { session: { token, username: sessionRow.username }, user: { username: sessionRow.username } };
  }

  const sessionRows = await supabaseFetch('auth_sessions', {
    query: {
      select: 'token,username',
      token: `eq.${token}`,
      limit: '1'
    }
  });
  if (!Array.isArray(sessionRows) || !sessionRows.length) {
    throw new HttpError(401, 'Session expired. Sign in again.');
  }
  const sessionRow = sessionRows[0];
  const userRows = await supabaseFetch('auth_users', {
    query: {
      select: 'username',
      username: `eq.${sessionRow.username}`,
      limit: '1'
    }
  });
  if (!Array.isArray(userRows) || !userRows.length) {
    throw new HttpError(401, 'Session expired. Sign in again.');
  }
  return {
    session: { token: sessionRow.token, username: sessionRow.username },
    user: { username: sessionRow.username }
  };
}

async function listFollowing(username) {
  if (!username) {
    return [];
  }
  if (usingLocalStore()) {
    const store = await readSocialStore();
    return store.follows
      .filter((entry) => entry.follower === username)
      .map((entry) => entry.followee)
      .filter(Boolean)
      .sort();
  }
  let rows;
  try {
    rows = await supabaseFetch('user_follows', {
      query: {
        select: 'followed_username',
        follower_username: `eq.${username}`
      }
    });
  } catch (error) {
    enableLocalFallback('loading following list', error);
    return listFollowing(username);
  }
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows
    .map((row) => row.followed_username)
    .filter(Boolean)
    .sort();
}

async function listFollowers(username) {
  if (!username) {
    return [];
  }
  if (usingLocalStore()) {
    const store = await readSocialStore();
    return store.follows
      .filter((entry) => entry.followee === username)
      .map((entry) => entry.follower)
      .filter(Boolean)
      .sort();
  }
  let rows;
  try {
    rows = await supabaseFetch('user_follows', {
      query: {
        select: 'follower_username',
        followed_username: `eq.${username}`
      }
    });
  } catch (error) {
    enableLocalFallback('loading followers list', error);
    return listFollowers(username);
  }
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows
    .map((row) => row.follower_username)
    .filter(Boolean)
    .sort();
}

async function buildSocialOverview(username) {
  const graph = await loadSocialGraph(username);
  const suggestions = await buildFollowSuggestions(graph);
  let badges = [];
  let collaborations = { owned: 0, shared: 0, invites: 0 };
  if (usingLocalStore()) {
    const store = await readSocialStore();
    badges = computeRecognitionBadgesFromStore(store, username);
    const summary = listCollaborativeSummary(store, username);
    collaborations = {
      owned: summary.owned.length,
      shared: summary.shared.length,
      invites: summary.invites.length
    };
  }
  return {
    following: graph.following,
    followers: graph.followers,
    mutualFollowers: graph.mutualFollowers,
    counts: {
      following: graph.following.length,
      followers: graph.followers.length,
      mutual: graph.mutualFollowers.length
    },
    suggestions,
    presence: buildPresenceSnapshot(),
    badges,
    collaborations
  };
}

async function loadSocialGraph(username) {
  const following = await listFollowing(username);
  const followers = await listFollowers(username);
  const followingSet = new Set(following);
  const followersSet = new Set(followers);
  const mutualFollowers = following
    .filter((handle) => followersSet.has(handle))
    .sort();
  return {
    username,
    following,
    followers,
    mutualFollowers,
    followingSet,
    followersSet
  };
}

async function buildFollowSuggestions({
  username,
  following,
  followers,
  mutualFollowers,
  followingSet,
  followersSet
}) {
  const suggestions = [];
  const seen = new Set();

  const suggestionContext = await loadSuggestionCandidates({
    username,
    followingSet,
    followersSet
  });

  const addSuggestion = (payload) => {
    const suggestion = normalizeSuggestionPayload(payload, {
      username,
      followingSet,
      followersSet
    });
    if (!suggestion) {
      return;
    }
    if (seen.has(suggestion.username)) {
      return;
    }
    seen.add(suggestion.username);
    suggestions.push(suggestion);
  };

  followers
    .filter((handle) => handle && !followingSet.has(handle) && handle !== username)
    .forEach((handle) => {
      const mutuals = suggestionContext.mutualMap.get(handle) || [];
      const candidateProfile = suggestionContext.profileMap.get(handle) || null;
      const sharedWatchHistory = computeSharedWatchHistory(suggestionContext.userProfile, candidateProfile);
      const sharedWatchParties = computeSharedWatchParties(username, handle, suggestionContext.partyIndex);
      addSuggestion({
        username: handle,
        displayName: formatDisplayNameFromHandle(handle),
        sharedInterests: [],
        sharedFavorites: [],
        sharedWatchHistory,
        sharedWatchParties,
        mutualFollowers: mutuals,
        followsYou: true,
        tagline: 'They already follow you back.',
        priorityReason: 'Already following you',
        preferencesSnapshot: candidateProfile ? candidateProfile.preferencesSnapshot : null
      });
    });

  const dynamicCandidates = suggestionContext.candidates
    .filter((profile) => profile && profile.username !== username && !followingSet.has(profile.username))
    .map((profile) => {
      const sharedFavorites = computeSharedFavorites(
        suggestionContext.userProfile,
        profile
      );
      const sharedGenres = computeSharedGenres(
        suggestionContext.userProfile,
        profile
      );
      const sharedWatchHistory = computeSharedWatchHistory(
        suggestionContext.userProfile,
        profile
      );
      const sharedWatchParties = computeSharedWatchParties(
        username,
        profile.username,
        suggestionContext.partyIndex
      );
      const mutuals = computeMutualFollowersForCandidate(profile, followingSet, followersSet);
      const followsYou = followersSet.has(profile.username);
      const score =
        (sharedFavorites.length * 4) +
        (sharedGenres.length * 2) +
        (sharedWatchHistory.length * 3) +
        (sharedWatchParties.length ? 5 : 0) +
        Math.min(sharedWatchParties.length, 2) * 2 +
        (mutuals.length ? 3 : 0) +
        (followsYou ? 3 : 0) +
        Math.min(profile.followerCount || 0, 4) +
        (profile.favoritesList.length ? 1 : 0);
      return {
        profile,
        sharedFavorites,
        sharedGenres,
        sharedWatchHistory,
        sharedWatchParties,
        mutuals,
        followsYou,
        score
      };
    })
    .filter((entry) => entry && entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if ((b.profile.followerCount || 0) !== (a.profile.followerCount || 0)) {
        return (b.profile.followerCount || 0) - (a.profile.followerCount || 0);
      }
      const nameA = a.profile.displayName || a.profile.username;
      const nameB = b.profile.displayName || b.profile.username;
      return nameA.localeCompare(nameB);
    })
    .slice(0, MAX_SUGGESTION_RESULTS);

  dynamicCandidates.forEach((entry) => {
    addSuggestion({
      username: entry.profile.username,
      displayName: entry.profile.displayName,
      tagline: buildProfileTagline(entry.profile),
      sharedInterests: entry.sharedGenres,
      sharedFavorites: entry.sharedFavorites,
      sharedWatchHistory: entry.sharedWatchHistory,
      sharedWatchParties: entry.sharedWatchParties,
      mutualFollowers: entry.mutuals,
      followsYou: entry.followsYou,
      preferencesSnapshot: entry.profile.preferencesSnapshot || null
    });
  });

  return suggestions.slice(0, MAX_SUGGESTION_RESULTS);
}

async function loadSuggestionCandidates({ username, followingSet, followersSet }) {
  const [profiles, followRows, partyIndex] = await Promise.all([
    fetchAllUserProfiles(),
    fetchFollowGraph(),
    fetchWatchPartyIndex()
  ]);

  const followerMap = buildFollowerMap(followRows);
  const normalizedProfiles = profiles
    .map((profile) => enrichProfileForSuggestions(profile, followerMap))
    .filter(Boolean);

  const profileMap = new Map();
  normalizedProfiles.forEach((profile) => {
    if (profile && profile.username) {
      profileMap.set(profile.username, profile);
    }
  });

  const userProfile = normalizedProfiles.find((profile) => profile.username === username) || null;
  const candidates = normalizedProfiles.filter((profile) => profile.username !== username);

  const mutualMap = new Map();
  followersSet.forEach((handle) => {
    mutualMap.set(handle, computeMutualFollowersFromMap(handle, followerMap, followingSet, followersSet));
  });

  return { userProfile, candidates, mutualMap, partyIndex, profileMap };
}

function computeMutualFollowersFromMap(handle, followerMap, followingSet, followersSet) {
  const canonical = canonicalUsername(handle);
  if (!canonical || !followerMap.has(canonical)) {
    return [];
  }
  const followers = followerMap.get(canonical);
  const mutuals = [];
  followers.forEach((follower) => {
    if ((followingSet.has(follower) || followersSet.has(follower)) && follower !== canonical) {
      mutuals.push(follower);
    }
  });
  return Array.from(new Set(mutuals)).sort();
}

function computeMutualFollowersForCandidate(profile, followingSet, followersSet) {
  if (!profile || !Array.isArray(profile.followers)) {
    return [];
  }
  const mutuals = profile.followers.filter((handle) => {
    const canonical = canonicalUsername(handle);
    return canonical && canonical !== profile.username && (followingSet.has(canonical) || followersSet.has(canonical));
  });
  return Array.from(new Set(mutuals)).sort();
}

function computeSharedFavorites(currentProfile, candidateProfile) {
  if (!currentProfile || !candidateProfile) {
    return [];
  }
  const results = [];
  const seen = new Set();
  const candidateIds = candidateProfile.favoriteImdbSet || new Set();
  const candidateTitles = candidateProfile.favoriteTitleSet || new Set();
  const favorites = Array.isArray(currentProfile.favoritesList) ? currentProfile.favoritesList : [];
  favorites.forEach((favorite) => {
    if (!favorite || typeof favorite !== 'object') {
      return;
    }
    const title = typeof favorite.title === 'string' ? favorite.title.trim() : '';
    const imdbId = normalizeIdentifier(favorite.imdbID || favorite.imdbId);
    if (imdbId && candidateIds.has(imdbId) && !seen.has(imdbId)) {
      seen.add(imdbId);
      if (title) {
        results.push(title);
      }
      return;
    }
    const normalizedTitle = normalizeTitleKey(title);
    if (normalizedTitle && candidateTitles.has(normalizedTitle) && !seen.has(normalizedTitle)) {
      seen.add(normalizedTitle);
      if (title) {
        results.push(title);
      }
    }
  });
  return results.slice(0, 3);
}

function computeSharedGenres(currentProfile, candidateProfile) {
  if (!currentProfile || !candidateProfile) {
    return [];
  }
  const currentGenres = currentProfile.favoriteGenreSet || new Set();
  const candidateGenres = candidateProfile.favoriteGenreSet || new Set();
  const shared = [];
  currentGenres.forEach((genre) => {
    if (candidateGenres.has(genre) && !shared.includes(genre)) {
      shared.push(genre);
    }
  });
  return shared.slice(0, 3);
}

function computeSharedWatchHistory(currentProfile, candidateProfile) {
  if (!currentProfile || !candidateProfile) {
    return [];
  }
  const results = [];
  const seen = new Set();
  const candidateIds = candidateProfile.watchedImdbSet || new Set();
  const candidateTitles = candidateProfile.watchedTitleSet || new Set();
  const history = Array.isArray(currentProfile.watchedHistory) ? currentProfile.watchedHistory : [];
  history.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const title = typeof entry.title === 'string' ? entry.title.trim() : '';
    const imdbId = entry.imdbId ? normalizeIdentifier(entry.imdbId) : '';
    const normalizedTitle = title ? normalizeTitleKey(title) : '';
    if (imdbId && candidateIds.has(imdbId) && !seen.has(imdbId)) {
      seen.add(imdbId);
      if (title) {
        results.push(title);
      }
      return;
    }
    if (normalizedTitle && candidateTitles.has(normalizedTitle) && !seen.has(normalizedTitle)) {
      seen.add(normalizedTitle);
      if (title) {
        results.push(title);
      }
    }
  });
  return results.slice(0, 3);
}

function computeSharedWatchParties(username, candidateUsername, partyIndex) {
  if (!partyIndex || !partyIndex.participationMap || !partyIndex.partyDetailMap) {
    return [];
  }
  const currentHandle = canonicalUsername(username);
  const candidateHandle = canonicalUsername(candidateUsername);
  if (!currentHandle || !candidateHandle) {
    return [];
  }
  const userParties = partyIndex.participationMap.get(currentHandle);
  const candidateParties = partyIndex.participationMap.get(candidateHandle);
  if (!userParties || !candidateParties) {
    return [];
  }
  const sharedIds = [];
  userParties.forEach((partyId) => {
    if (candidateParties.has(partyId)) {
      sharedIds.push(partyId);
    }
  });
  const formatted = sharedIds
    .map((partyId) => partyIndex.partyDetailMap.get(partyId))
    .filter(Boolean)
    .map(formatWatchPartyTag)
    .filter(Boolean);
  return formatted.slice(0, 2);
}

function formatWatchPartyTag(detail) {
  if (!detail) {
    return '';
  }
  const parts = [];
  if (detail.title) {
    parts.push(detail.title);
  }
  if (detail.scheduledFor) {
    const date = new Date(detail.scheduledFor);
    if (!Number.isNaN(date.getTime())) {
      parts.push(
        date.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric'
        })
      );
    }
  }
  if (!parts.length && detail.host) {
    parts.push(`${formatDisplayNameFromHandle(detail.host)}’s party`);
  }
  return parts.join(' • ');
}

function normalizeSuggestionPayload(entry, { username, followingSet, followersSet }) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const handle = canonicalUsername(entry.username);
  if (!handle || handle === username || followingSet.has(handle)) {
    return null;
  }
  const displayName = entry.displayName ? String(entry.displayName).trim() : formatDisplayNameFromHandle(handle);
  const sharedInterests = Array.isArray(entry.sharedInterests)
    ? entry.sharedInterests.map((value) => normalizeGenreLabel(value)).filter(Boolean)
    : [];
  const sharedFavorites = Array.isArray(entry.sharedFavorites)
    ? entry.sharedFavorites.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean)
    : [];
  const sharedWatchHistory = Array.isArray(entry.sharedWatchHistory)
    ? entry.sharedWatchHistory.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean)
    : [];
  const sharedWatchParties = Array.isArray(entry.sharedWatchParties)
    ? entry.sharedWatchParties.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean)
    : [];
  const mutualFollowers = Array.isArray(entry.mutualFollowers)
    ? Array.from(
        new Set(
          entry.mutualFollowers
            .map((value) => canonicalUsername(value))
            .filter((value) => value && (followingSet.has(value) || followersSet.has(value)))
        )
      ).sort()
    : [];
  const followsYou = entry.followsYou === true || followersSet.has(handle);
  const reasonParts = [];
  if (entry.priorityReason) {
    reasonParts.push(entry.priorityReason);
  }
  if (followsYou && !reasonParts.includes('Already following you')) {
    reasonParts.push('Follows you');
  }
  if (mutualFollowers.length) {
    reasonParts.push(`${mutualFollowers.length} mutual follower${mutualFollowers.length === 1 ? '' : 's'}`);
  }
  if (sharedInterests.length) {
    reasonParts.push(`Shared genres: ${sharedInterests.slice(0, 2).join(', ')}`);
  }
  if (sharedFavorites.length) {
    reasonParts.push(`Shared favorites: ${sharedFavorites.slice(0, 2).join(', ')}`);
  }
  if (sharedWatchHistory.length) {
    reasonParts.push(`Recently watched: ${sharedWatchHistory.slice(0, 2).join(', ')}`);
  }
  if (sharedWatchParties.length) {
    reasonParts.push(
      sharedWatchParties.length === 1
        ? `Joined the same watch party: ${sharedWatchParties[0]}`
        : `Joined ${sharedWatchParties.length} of the same watch parties`
    );
  }
  if (entry.reason && typeof entry.reason === 'string') {
    reasonParts.push(entry.reason.trim());
  }

  const pins = resolvePersonaPins(entry);

  return {
    username: handle,
    displayName,
    tagline: entry.tagline ? String(entry.tagline).trim() : '',
    sharedInterests,
    sharedFavorites,
    sharedWatchHistory,
    sharedWatchParties,
    mutualFollowers,
    followsYou,
    reason: reasonParts.join(' • '),
    pinnedList: pins.list,
    pinnedReview: pins.review
  };
}

function buildProfileTagline(profile) {
  if (!profile) {
    return '';
  }
  const likesText = profile.preferencesSnapshot && typeof profile.preferencesSnapshot.likesText === 'string'
    ? profile.preferencesSnapshot.likesText.trim()
    : '';
  if (likesText) {
    return likesText;
  }
  const genreList = Array.from(profile.favoriteGenreSet || []).slice(0, 3);
  if (genreList.length) {
    return `Into ${genreList.join(', ')}`;
  }
  const favorites = Array.isArray(profile.favoritesList) ? profile.favoritesList : [];
  const recent = favorites
    .slice(-2)
    .map((entry) => (entry && typeof entry.title === 'string' ? entry.title.trim() : ''))
    .filter(Boolean);
  if (recent.length) {
    return `Recently favorited ${recent.join(' & ')}`;
  }
  return '';
}

function resolvePersonaPins(entry) {
  const sources = [];
  if (entry && entry.personaPins) {
    sources.push(entry.personaPins);
  }
  if (entry && entry.preferencesSnapshot && entry.preferencesSnapshot.personaPins) {
    sources.push(entry.preferencesSnapshot.personaPins);
  }
  if (entry && entry.preferencesSnapshot) {
    if (entry.preferencesSnapshot.pinnedList || entry.preferencesSnapshot.pinnedReview) {
      sources.push({
        list: entry.preferencesSnapshot.pinnedList,
        review: entry.preferencesSnapshot.pinnedReview
      });
    }
  }
  if (entry && (entry.pinnedList || entry.pinnedReview)) {
    sources.push({ list: entry.pinnedList, review: entry.pinnedReview });
  }
  let list = null;
  let review = null;
  sources.forEach((payload) => {
    if (!payload || typeof payload !== 'object') {
      return;
    }
    if (!list && (payload.list || payload.pinnedList)) {
      list = normalizePinnedListPayload(payload.list || payload.pinnedList);
    }
    if (!review && (payload.review || payload.pinnedReview)) {
      review = normalizePinnedReviewPayload(payload.review || payload.pinnedReview);
    }
  });
  return { list, review };
}

function normalizePinnedListPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const title = extractPinText(payload.title || payload.name);
  if (!title) {
    return null;
  }
  const description = extractPinText(payload.description || payload.subtitle || payload.summary);
  const highlights = extractPinHighlights(payload.highlights || payload.items || payload.movies);
  const href = extractPinUrl(payload.href || payload.url || payload.link);
  const normalized = { title };
  if (description) {
    normalized.description = description;
  }
  if (highlights.length) {
    normalized.highlights = highlights;
  }
  if (href) {
    normalized.href = href;
  }
  return normalized;
}

function normalizePinnedReviewPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const title = extractPinText(payload.title || payload.movieTitle || payload.movie);
  if (!title) {
    return null;
  }
  const excerpt = extractPinText(payload.excerpt || payload.summary || payload.body);
  const ratingValue =
    typeof payload.rating === 'number'
      ? payload.rating
      : typeof payload.rating === 'string' && payload.rating.trim() !== ''
      ? Number(payload.rating)
      : null;
  const rating = Number.isFinite(ratingValue) ? Math.max(0, Math.min(10, Number(ratingValue))) : null;
  const href = extractPinUrl(payload.href || payload.url || payload.link);
  const normalized = { title };
  if (excerpt) {
    normalized.excerpt = excerpt;
  }
  if (rating !== null) {
    normalized.rating = rating;
  }
  if (href) {
    normalized.href = href;
  }
  return normalized;
}

function extractPinText(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 320) : '';
}

function extractPinHighlights(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((value) => extractPinText(value))
    .filter(Boolean)
    .slice(0, 6);
}

function extractPinUrl(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 500) : '';
}

async function fetchAllUserProfiles() {
  if (usingLocalStore()) {
    const store = await readAuthStore();
    return store.users.map(mapAuthUserProfile).filter(Boolean);
  }
  try {
    const rows = await supabaseFetch('auth_users', {
      query: {
        select:
          'username,display_name,preferences_snapshot,favorites_list,watched_history,last_login_at,created_at'
      }
    });
    if (!Array.isArray(rows)) {
      return [];
    }
    return rows.map(mapAuthUserProfile).filter(Boolean);
  } catch (error) {
    console.warn('Failed to load user profiles for suggestions', error);
    enableLocalFallback('loading user profiles', error);
    return fetchAllUserProfiles();
  }
}

async function fetchFollowGraph() {
  if (usingLocalStore()) {
    const store = await readSocialStore();
    return Array.isArray(store.follows) ? store.follows.slice() : [];
  }
  try {
    const rows = await supabaseFetch('user_follows', {
      query: {
        select: 'follower_username,followed_username'
      }
    });
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    console.warn('Failed to load follow graph', error);
    enableLocalFallback('loading follow graph', error);
    return fetchFollowGraph();
  }
}

async function fetchWatchPartyIndex() {
  if (usingLocalStore()) {
    const store = await readSocialStore();
    return buildWatchPartyIndex(Array.isArray(store.watchParties) ? store.watchParties : []);
  }
  return { participationMap: new Map(), partyDetailMap: new Map() };
}

function buildWatchPartyIndex(entries) {
  const participationMap = new Map();
  const partyDetailMap = new Map();
  if (!Array.isArray(entries)) {
    return { participationMap, partyDetailMap };
  }
  entries.forEach((party) => {
    if (!party || !party.id) {
      return;
    }
    const partyId = String(party.id);
    const host = canonicalUsername(party.host || '');
    const title = typeof party.movieTitle === 'string'
      ? party.movieTitle
      : typeof party.movie?.title === 'string'
      ? party.movie.title
      : '';
    const scheduledFor = party.scheduledFor || party.scheduled_for || null;
    partyDetailMap.set(partyId, {
      id: partyId,
      title: title ? title.trim() : '',
      scheduledFor,
      host
    });
    if (host) {
      addPartyParticipation(participationMap, host, partyId);
    }
    const invitees = Array.isArray(party.invitees) ? party.invitees : [];
    invitees.forEach((invite) => {
      const handle = canonicalUsername(invite && invite.username ? invite.username : '');
      if (!handle) {
        return;
      }
      const response = (invite.response || invite.status || '').toLowerCase();
      if (!response || response === 'accepted' || response === 'attending' || response === 'yes' || response === 'host') {
        addPartyParticipation(participationMap, handle, partyId);
      }
    });
  });
  return { participationMap, partyDetailMap };
}

function addPartyParticipation(map, username, partyId) {
  if (!username || !partyId) {
    return;
  }
  if (!map.has(username)) {
    map.set(username, new Set());
  }
  map.get(username).add(partyId);
}

function buildFollowerMap(rows) {
  const map = new Map();
  if (!Array.isArray(rows)) {
    return map;
  }
  rows.forEach((row) => {
    const follower = canonicalUsername(row.follower_username || row.follower);
    const followee = canonicalUsername(row.followed_username || row.followee);
    if (!follower || !followee) {
      return;
    }
    if (!map.has(followee)) {
      map.set(followee, new Set());
    }
    map.get(followee).add(follower);
  });
  return map;
}

function enrichProfileForSuggestions(profile, followerMap) {
  if (!profile || !profile.username) {
    return null;
  }
  const favoritesList = Array.isArray(profile.favoritesList) ? profile.favoritesList : [];
  const favoriteTitleSet = new Set();
  const favoriteImdbSet = new Set();
  const favoriteGenreSet = new Set();
  const watchedHistoryRaw = Array.isArray(profile.watchedHistory)
    ? profile.watchedHistory.slice()
    : [];
  const watchedHistoryList = [];
  const watchedTitleSet = new Set();
  const watchedImdbSet = new Set();
  favoritesList.forEach((favorite) => {
    if (!favorite || typeof favorite !== 'object') {
      return;
    }
    const title = typeof favorite.title === 'string' ? favorite.title.trim() : '';
    if (title) {
      favoriteTitleSet.add(normalizeTitleKey(title));
    }
    const imdbId = normalizeIdentifier(favorite.imdbID || favorite.imdbId);
    if (imdbId) {
      favoriteImdbSet.add(imdbId);
    }
    if (Array.isArray(favorite.genres)) {
      favorite.genres.forEach((genre) => {
        const normalized = normalizeGenreLabel(genre);
        if (normalized) {
          favoriteGenreSet.add(normalized);
        }
      });
    }
  });
  watchedHistoryRaw.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const title = typeof entry.title === 'string' ? entry.title : typeof entry.movieTitle === 'string' ? entry.movieTitle : '';
    const imdbId = normalizeIdentifier(entry.imdbId || entry.imdbID || entry.movieImdbId);
    const watchedAt = entry.watchedAt || entry.watched_at || entry.created_at || entry.updated_at || entry.watchedOn;
    if (title) {
      watchedTitleSet.add(normalizeTitleKey(title));
    }
    if (imdbId) {
      watchedImdbSet.add(imdbId);
    }
    if (title || imdbId) {
      watchedHistoryList.push({
        title: title ? title.trim() : '',
        imdbId,
        watchedAt: watchedAt || null
      });
    }
  });
  watchedHistoryList.sort((a, b) => {
    const aTime = a && a.watchedAt ? new Date(a.watchedAt).getTime() : 0;
    const bTime = b && b.watchedAt ? new Date(b.watchedAt).getTime() : 0;
    return bTime - aTime;
  });
  const recentWatched = watchedHistoryList.slice(0, 60);
  const selectedGenres = Array.isArray(profile.preferencesSnapshot?.selectedGenres)
    ? profile.preferencesSnapshot.selectedGenres
        .map((genre) => normalizeGenreLabel(genre))
        .filter(Boolean)
    : [];
  selectedGenres.forEach((genre) => favoriteGenreSet.add(genre));
  const followers = followerMap.has(profile.username)
    ? Array.from(followerMap.get(profile.username)).sort()
    : [];
  return {
    username: profile.username,
    displayName: profile.displayName || formatDisplayNameFromHandle(profile.username),
    preferencesSnapshot: profile.preferencesSnapshot || null,
    favoritesList,
    favoriteTitleSet,
    favoriteImdbSet,
    favoriteGenreSet,
    watchedHistory: recentWatched,
    watchedTitleSet,
    watchedImdbSet,
    followers,
    followerCount: followers.length,
    lastLoginAt: profile.lastLoginAt || null,
    createdAt: profile.createdAt || null
  };
}

function mapAuthUserProfile(row) {
  if (!row || !row.username) {
    return null;
  }
  const username = canonicalUsername(row.username);
  if (!username) {
    return null;
  }
  const displayName = row.display_name || row.displayName || formatDisplayNameFromHandle(username);
  const preferencesSnapshot = row.preferences_snapshot || row.preferencesSnapshot || null;
  const favoritesList = Array.isArray(row.favorites_list)
    ? row.favorites_list
    : Array.isArray(row.favoritesList)
    ? row.favoritesList
    : [];
  return {
    username,
    displayName,
    preferencesSnapshot,
    favoritesList,
    watchedHistory: Array.isArray(row.watched_history)
      ? row.watched_history
      : Array.isArray(row.watchedHistory)
      ? row.watchedHistory
      : [],
    lastLoginAt: row.last_login_at || row.lastLoginAt || null,
    createdAt: row.created_at || row.createdAt || null
  };
}

function stripControlCharacters(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/[\u0000-\u001F\u007F]/g, '');
}

function sanitizeFollowNote(value) {
  const stripped = stripControlCharacters(value);
  if (!stripped) {
    return '';
  }
  const trimmed = stripped.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.length > MAX_FOLLOW_NOTE_LENGTH) {
    return trimmed.slice(0, MAX_FOLLOW_NOTE_LENGTH).trim();
  }
  return trimmed;
}

function normalizeIdentifier(value) {
  if (!value) {
    return '';
  }
  return String(value).trim().toLowerCase();
}

function normalizeTitleKey(value) {
  if (!value) {
    return '';
  }
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeGenreLabel(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed
    .split(' ')
    .map((part) => titleCase(part))
    .join(' ');
}

async function upsertFollow(follower, followee) {
  if (usingLocalStore()) {
    const store = await readSocialStore();
    const exists = store.follows.find(
      (entry) => entry.follower === follower && entry.followee === followee
    );
    if (!exists) {
      store.follows.push({ follower, followee, createdAt: new Date().toISOString() });
      await writeSocialStore(store);
    }
    return;
  }
  try {
    await supabaseFetch('user_follows', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: [{ follower_username: follower, followed_username: followee }]
    });
  } catch (error) {
    enableLocalFallback('following a user', error);
    await upsertFollow(follower, followee);
  }
}

async function deleteFollow(follower, followee) {
  if (usingLocalStore()) {
    const store = await readSocialStore();
    store.follows = store.follows.filter(
      (entry) => !(entry.follower === follower && entry.followee === followee)
    );
    await writeSocialStore(store);
    return;
  }
  try {
    await supabaseFetch('user_follows', {
      method: 'DELETE',
      query: {
        follower_username: `eq.${follower}`,
        followed_username: `eq.${followee}`
      }
    });
  } catch (error) {
    enableLocalFallback('unfollowing a user', error);
    await deleteFollow(follower, followee);
  }
}

async function fetchMovieReviews(movie, followingSet, currentUsername) {
  if (usingLocalStore()) {
    const store = await readSocialStore();
    const rows = store.reviews
      .filter((entry) => entry.movieTmdbId === movie.tmdbId)
      .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
    const reviews = rows.map((row) => mapReviewRow(row, followingSet, currentUsername));
    const likeMap = new Map();
    const reactionMap = new Map();
    const commentMap = new Map();
    store.reviewLikes
      .filter((entry) => entry.movieTmdbId === movie.tmdbId)
      .forEach((entry) => {
        const key = entry.reviewId || buildLocalReviewId(entry.movieTmdbId, entry.reviewUsername);
        if (!likeMap.has(key)) {
          likeMap.set(key, []);
        }
        likeMap.get(key).push(entry);
      });
    store.reviewReactions
      .filter((entry) => entry.movieTmdbId === movie.tmdbId)
      .forEach((entry) => {
        const key = entry.reviewId || buildLocalReviewId(entry.movieTmdbId, entry.reviewUsername);
        if (!reactionMap.has(key)) {
          reactionMap.set(key, []);
        }
        reactionMap.get(key).push(entry);
      });
    store.reviewComments
      .filter((entry) => entry.movieTmdbId === movie.tmdbId)
      .forEach((entry) => {
        const key = entry.reviewId || buildLocalReviewId(entry.movieTmdbId, entry.reviewUsername);
        if (!commentMap.has(key)) {
          commentMap.set(key, []);
        }
        commentMap.get(key).push(entry);
      });
    reviews.forEach((review) => {
      const lookupKey = review.id || buildLocalReviewId(movie.tmdbId, review.username);
      const likes = likeMap.get(lookupKey) || likeMap.get(review.username) || [];
      review.likes = summarizeLikes(likes, currentUsername);
      const reactions = reactionMap.get(lookupKey) || reactionMap.get(review.username) || [];
      review.reactions = summarizeReactions(reactions, currentUsername);
      const comments = commentMap.get(lookupKey) || commentMap.get(review.username) || [];
      review.comments = mapCommentEntries(comments, currentUsername);
    });
    const myReview = reviews.find((review) => review.username === currentUsername) || null;
    const stats = calculateReviewStats(reviews);
    return { reviews, myReview, stats };
  }
  if (!movie.imdbId) {
    return { reviews: [], myReview: null };
  }
  let rows;
  try {
    rows = await supabaseFetch('movie_reviews', {
      query: {
        select: 'id,username,rating,body,is_spoiler,created_at,updated_at',
        movie_imdb_id: `eq.${movie.imdbId}`,
        order: 'updated_at.desc'
      }
    });
  } catch (error) {
    enableLocalFallback('loading reviews', error);
    return fetchMovieReviews(movie, followingSet, currentUsername);
  }
  if (!Array.isArray(rows)) {
    return { reviews: [], myReview: null };
  }
  const reviews = rows.map((row) => mapReviewRow(row, followingSet, currentUsername));
  const reviewIds = reviews.map((review) => review.id).filter(Boolean);
  try {
    if (reviewIds.length) {
      const likeRows = await supabaseFetch('review_likes', {
        query: {
          select: 'review_id,username',
          review_id: `in.(${reviewIds.join(',')})`
        }
      });
      if (Array.isArray(likeRows) && likeRows.length) {
        const likeMap = new Map();
        likeRows.forEach((row) => {
          const key = row.review_id || row.reviewId;
          if (!key) {
            return;
          }
          if (!likeMap.has(key)) {
            likeMap.set(key, []);
          }
          likeMap.get(key).push(row);
        });
        reviews.forEach((review) => {
          const likes = likeMap.get(review.id) || [];
          review.likes = summarizeLikes(likes, currentUsername);
        });
      }
    }
  } catch (error) {
    console.warn('Failed to load review likes for movie', error);
  }
  reviews.forEach((review) => {
    if (!review.likes) {
      review.likes = summarizeLikes([], currentUsername);
    }
  });
  const myReview = reviews.find((review) => review.username === currentUsername) || null;
  const stats = calculateReviewStats(reviews);
  return { reviews, myReview, stats };
}

async function upsertReview({ username, movie, rating, body, hasSpoilers, fullText, segments }) {
  const timestamp = new Date().toISOString();
  if (usingLocalStore()) {
    const store = await readSocialStore();
    const existingIndex = store.reviews.findIndex(
      (entry) => entry.movieTmdbId === movie.tmdbId && entry.username === username
    );
    const fallbackId = buildLocalReviewId(movie.tmdbId, username);
    const existing = existingIndex !== -1 ? store.reviews[existingIndex] : null;
    const reviewId = existing && existing.id ? existing.id : fallbackId;
    const payload = {
      id: reviewId,
      username,
      movieTmdbId: movie.tmdbId,
      movieImdbId: movie.imdbId || null,
      movieTitle: movie.title,
      rating,
      body: body || null,
      capsule: body || null,
      fullText: fullText || null,
      segments: Array.isArray(segments) ? segments : existing?.segments || null,
      hasSpoilers,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    if (existingIndex !== -1) {
      store.reviews[existingIndex] = {
        ...existing,
        rating,
        body: body || null,
        capsule: body || null,
        fullText: fullText || existing?.fullText || null,
        segments: Array.isArray(segments) ? segments : existing?.segments || null,
        hasSpoilers,
        updatedAt: timestamp,
        movieTitle: movie.title,
        movieImdbId: movie.imdbId || null,
        id: reviewId
      };
    } else {
      store.reviews.push(payload);
    }
    await writeSocialStore(store);
    return;
  }
  try {
    await ensureMovieRecord(movie);
    await supabaseFetch('movie_reviews', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      query: { on_conflict: 'username,movie_imdb_id' },
      body: [
        {
          username,
          movie_imdb_id: movie.imdbId,
          rating,
          body: body || null,
          is_spoiler: hasSpoilers,
          updated_at: timestamp
        }
      ]
    });
  } catch (error) {
    enableLocalFallback('saving a review', error);
    return upsertReview({
      username,
      movie,
      rating,
      body,
      hasSpoilers,
      fullText,
      segments
    });
  }
}

async function userExists(username) {
  if (!username) {
    return false;
  }
  if (usingLocalStore()) {
    const store = await readAuthStore();
    return store.users.some((row) => row.username === username);
  }
  try {
    const rows = await supabaseFetch('auth_users', {
      query: {
        select: 'username',
        username: `eq.${username}`,
        limit: '1'
      }
    });
    return Array.isArray(rows) && rows.length > 0;
  } catch (error) {
    enableLocalFallback('looking up a user', error);
    return userExists(username);
  }
}

function mapReviewRow(row, followingSet, currentUsername) {
  const username = row.username || row.author_username || '';
  const fallbackId = buildLocalReviewId(row.movieTmdbId || row.movie_tmdb_id, username);
  const segments = Array.isArray(row.segments)
    ? row.segments
        .map((segment) => ({
          text: typeof segment.text === 'string' ? segment.text : '',
          spoiler: Boolean(segment.spoiler)
        }))
        .filter((segment) => segment.text)
    : parseReviewSegments(row.fullText || row.body || '');
  const capsule = buildCapsuleFromSegments(segments, row.body || row.capsule || row.fullText || '');
  const fullText = typeof row.fullText === 'string' && row.fullText ? row.fullText : row.body || '';
  return {
    id: row.id || row.reviewId || fallbackId || null,
    username,
    rating: typeof row.rating === 'number' ? Number(row.rating) : row.rating ? Number(row.rating) : null,
    body: capsule || null,
    capsule: capsule || null,
    fullText: fullText || null,
    segments,
    hasSpoilers:
      Boolean(row.has_spoilers || row.hasSpoilers || row.is_spoiler) || segments.some((segment) => segment.spoiler),
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || row.created_at || row.createdAt || null,
    isFriend: username !== currentUsername && followingSet.has(username),
    isSelf: username === currentUsername
  };
}

function calculateReviewStats(reviews) {
  if (!Array.isArray(reviews) || reviews.length === 0) {
    return {
      totalReviews: 0,
      totalRatings: 0,
      averageRating: null,
      friendReviews: 0,
      friendRatings: 0,
      friendAverageRating: null,
      lastReviewAt: null
    };
  }

  let totalReviews = 0;
  let totalRatings = 0;
  let ratingSum = 0;
  let friendReviews = 0;
  let friendRatings = 0;
  let friendRatingSum = 0;
  let latestTimestamp = null;
  let friendLatestTimestamp = null;

  reviews.forEach((review) => {
    if (!review) {
      return;
    }
    totalReviews += 1;

    const ratingValue =
      typeof review.rating === 'number'
        ? review.rating
        : typeof review.rating === 'string'
        ? Number(review.rating)
        : null;
    if (Number.isFinite(ratingValue)) {
      totalRatings += 1;
      ratingSum += ratingValue;
      if (review.isFriend) {
        friendRatings += 1;
        friendRatingSum += ratingValue;
      }
    }

    const timestamp = review.updatedAt || review.createdAt || null;
    if (review.isFriend) {
      friendReviews += 1;
      if (timestamp && typeof timestamp === 'string') {
        if (!friendLatestTimestamp || timestamp > friendLatestTimestamp) {
          friendLatestTimestamp = timestamp;
        }
      }
    }
    if (timestamp && typeof timestamp === 'string') {
      if (!latestTimestamp || timestamp > latestTimestamp) {
        latestTimestamp = timestamp;
      }
    }
  });

  return {
    totalReviews,
    totalRatings,
    averageRating: totalRatings ? Math.round((ratingSum / totalRatings) * 10) / 10 : null,
    friendReviews,
    friendRatings,
    friendAverageRating: friendRatings ? Math.round((friendRatingSum / friendRatings) * 10) / 10 : null,
    lastReviewAt: latestTimestamp,
    friendLastReviewAt: friendLatestTimestamp
  };
}

async function broadcastReviewActivity({ actor, movie, body }) {
  if (!actor || !movie || !movie.tmdbId) {
    return;
  }
  const timestamp = new Date().toISOString();
  const followers = await listFollowers(actor);
  const mentionTargets = await resolveMentionTargets(body, actor);

  if (usingLocalStore()) {
    const store = await readSocialStore();
    followers
      .filter((username) => username && username !== actor)
      .forEach((username) => {
        enqueueNotification({
          store,
          username,
          type: 'friend_review',
          actor,
          movie,
          timestamp
        });
      });
    mentionTargets
      .filter((username) => username && username !== actor)
      .forEach((username) => {
        enqueueNotification({
          store,
          username,
          type: 'mention',
          actor,
          movie,
          timestamp
        });
      });
    await writeSocialStore(store);
    return;
  }

  await Promise.all(
    followers
      .filter((username) => username && username !== actor)
      .map((username) =>
        enqueueNotification({
          username,
          type: 'friend_review',
          actor,
          movie,
          timestamp
        })
      )
  );
  await Promise.all(
    mentionTargets
      .filter((username) => username && username !== actor)
      .map((username) =>
        enqueueNotification({
          username,
          type: 'mention',
          actor,
          movie,
          timestamp
        })
      )
  );
}

async function recordLibraryActivity({ username, action, movie }) {
  if (!username || !action || !movie) {
    return;
  }
  const timestamp = new Date().toISOString();
  const notificationType = action === 'watchlist_add' ? 'friend_watchlist' : 'friend_favorite';

  if (usingLocalStore()) {
    const store = await readSocialStore();
    store.activity.push({
      username,
      verb: action,
      objectType: 'movie',
      metadata: {
        movie_tmdb_id: movie.tmdbId,
        movie_imdb_id: movie.imdbId || null,
        movie_title: movie.title || ''
      },
      createdAt: timestamp
    });
    store.follows
      .filter((entry) => entry.followee === username)
      .map((entry) => entry.follower)
      .filter((follower) => follower && follower !== username)
      .forEach((follower) => {
        enqueueNotification({
          store,
          username: follower,
          type: notificationType,
          actor: username,
          movie,
          timestamp
        });
      });
    await writeSocialStore(store);
    return;
  }

  try {
    await supabaseFetch('user_activity', {
      method: 'POST',
      body: [
        {
          username,
          verb: action,
          object_type: 'movie',
          metadata: {
            movie_tmdb_id: movie.tmdbId,
            movie_imdb_id: movie.imdbId || null,
            movie_title: movie.title || ''
          },
          created_at: timestamp
        }
      ]
    });
  } catch (error) {
    enableLocalFallback('recording user activity', error);
    await recordLibraryActivity({ username, action, movie });
    return;
  }

  const followers = await listFollowers(username);
  await Promise.all(
    followers
      .filter((follower) => follower && follower !== username)
      .map((follower) =>
        enqueueNotification({
          username: follower,
          type: notificationType,
          actor: username,
          movie,
          timestamp
        })
      )
  );
}

async function listFollowers(username) {
  if (!username) {
    return [];
  }
  if (usingLocalStore()) {
    const store = await readSocialStore();
    return store.follows
      .filter((entry) => entry.followee === username)
      .map((entry) => entry.follower)
      .filter(Boolean)
      .sort();
  }
  try {
    const rows = await supabaseFetch('user_follows', {
      query: {
        select: 'follower_username',
        followed_username: `eq.${username}`
      }
    });
    if (!Array.isArray(rows)) {
      return [];
    }
    return rows
      .map((row) => row.follower_username)
      .filter(Boolean)
      .sort();
  } catch (error) {
    enableLocalFallback('loading followers', error);
    return listFollowers(username);
  }
}

async function resolveMentionTargets(body, actor) {
  if (!body) {
    return [];
  }
  const mentions = Array.from(new Set(extractMentions(body))).filter(
    (username) => username && username !== actor
  );
  if (!mentions.length) {
    return [];
  }
  const valid = [];
  for (const username of mentions) {
    try {
      if (await userExists(username)) {
        valid.push(username);
      }
    } catch (error) {
      // ignore lookup failure
    }
  }
  return valid;
}

function extractMentions(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }
  const matches = text.match(/@([a-z0-9_\.\-]{2,20})/gi) || [];
  return matches.map((match) => canonicalUsername(match.slice(1))).filter(Boolean);
}

async function enqueueNotification({ store, username, type, actor, movie, timestamp, note }) {
  const normalizedUsername = canonicalUsername(username);
  if (!normalizedUsername || (actor && normalizedUsername === actor)) {
    return null;
  }
  const createdAt = timestamp || new Date().toISOString();
  const sanitizedNote = note ? sanitizeFollowNote(note) : '';
  const entry = {
    id: randomUUID(),
    username: normalizedUsername,
    type,
    actor: actor || null,
    movieTitle: movie && movie.title ? movie.title : null,
    movieTmdbId: movie && movie.tmdbId ? movie.tmdbId : null,
    movieImdbId: movie && movie.imdbId ? movie.imdbId : null,
    message: formatNotificationMessage(type, { actor, movie, note: sanitizedNote }),
    note: sanitizedNote || null,
    createdAt,
    readAt: null
  };
  const payload = {
    actor: entry.actor,
    movieTitle: entry.movieTitle,
    movieTmdbId: entry.movieTmdbId,
    movieImdbId: entry.movieImdbId,
    message: entry.message,
    note: sanitizedNote || undefined
  };

  if (usingLocalStore()) {
    if (store) {
      store.notifications.push(entry);
      broadcastNotificationToStreams(entry);
      return entry;
    }
    const nextStore = await readSocialStore();
    nextStore.notifications.push(entry);
    await writeSocialStore(nextStore);
    broadcastNotificationToStreams(entry);
    return entry;
  }

  try {
    await supabaseFetch('user_notifications', {
      method: 'POST',
      body: [
        {
          id: entry.id,
          recipient_username: entry.username,
          type: entry.type,
          payload,
          is_read: false,
          created_at: entry.createdAt
        }
      ]
    });
    broadcastNotificationToStreams(entry);
  } catch (error) {
    enableLocalFallback('queuing a notification', error);
    return enqueueNotification({ store, username, type, actor, movie, timestamp });
  }
  return entry;
}

function formatNotificationMessage(type, context = {}) {
  const actor = context.actor ? context.actor : 'Someone';
  const title = context.movie && context.movie.title ? context.movie.title : 'a movie';
  switch (type) {
    case 'follow':
      if (context.note) {
        return `${actor} followed you: “${context.note}”`;
      }
      return `${actor} followed you.`;
    case 'mention':
      return `${actor} mentioned you in a review for ${title}.`;
    case 'review_like':
      return `${actor} liked your review for ${title}.`;
    case 'review_reply':
      return `${actor} replied to your community note on ${title}.`;
    case 'review_reaction':
      return `${actor} reacted to your review for ${title}.`;
    case 'friend_review':
      return `${actor} posted a new review for ${title}.`;
    case 'friend_watchlist':
      return `${actor} added ${title} to their watchlist.`;
    case 'friend_favorite':
      return `${actor} favorited ${title}.`;
    case 'collab_invite':
      return `${actor} invited you to co-curate “${title || 'their list'}”.`;
    case 'collab_accept':
      return `${actor} joined your collaborative list “${title || 'Untitled'}”.`;
    case 'watch_party':
      return `${actor} invited you to a watch party for ${title}.`;
    case 'watch_party_update':
      return `${actor} updated their watch party RSVP for ${title}.`;
    default:
      return `New activity from ${actor}.`;
  }
}

function normalizeNotificationPayload(row) {
  const payload = row && row.payload && typeof row.payload === 'object' ? row.payload : {};
  const actor = typeof payload.actor === 'string' && payload.actor ? payload.actor : null;
  const movieTitle = typeof payload.movieTitle === 'string' && payload.movieTitle ? payload.movieTitle : null;
  const movieTmdbId = payload.movieTmdbId || null;
  const movieImdbId = payload.movieImdbId || null;
  const messageRaw = typeof payload.message === 'string' ? payload.message.trim() : '';
  const message = messageRaw
    ? messageRaw
    : formatNotificationMessage(row && row.type ? row.type : 'activity', {
        actor,
        movie: { title: movieTitle, tmdbId: movieTmdbId, imdbId: movieImdbId }
      });
  return {
    actor,
    movieTitle,
    movieTmdbId,
    movieImdbId,
    message
  };
}

function normalizeNotificationReadTimestamp(row) {
  const payload = row && row.payload && typeof row.payload === 'object' ? row.payload : {};
  if (typeof payload.readAt === 'string' && payload.readAt) {
    return payload.readAt;
  }
  if (typeof payload.read_at === 'string' && payload.read_at) {
    return payload.read_at;
  }
  return row && row.created_at ? row.created_at : new Date().toISOString();
}

function summarizeLikes(entries, currentUsername) {
  if (!Array.isArray(entries) || !entries.length) {
    return { count: 0, hasLiked: false };
  }
  const count = entries.length;
  const hasLiked = entries.some((entry) => {
    const username = entry.likedBy || entry.liked_by || entry.username;
    return username === currentUsername;
  });
  return { count, hasLiked };
}

function summarizeReactions(entries, currentUsername) {
  const totals = {};
  let mine = null;
  const ordered = Array.isArray(entries)
    ? entries
        .map((entry) => ({
          emoji: entry.emoji || entry.reaction || entry.symbol || null,
          username: entry.username || entry.reactedBy || entry.actor || null,
          createdAt: entry.createdAt || entry.created_at || null
        }))
        .filter((entry) => entry.emoji && REVIEW_REACTIONS.includes(entry.emoji))
    : [];
  ordered.sort((a, b) => {
    const timeA = a.createdAt || '';
    const timeB = b.createdAt || '';
    return timeB.localeCompare(timeA);
  });
  ordered.forEach((entry) => {
    totals[entry.emoji] = (totals[entry.emoji] || 0) + 1;
    if (entry.username === currentUsername && mine === null) {
      mine = entry.emoji;
    }
  });
  REVIEW_REACTIONS.forEach((emoji) => {
    if (!totals[emoji]) {
      totals[emoji] = 0;
    }
  });
  const recent = ordered.slice(0, 6);
  return {
    totals,
    mine,
    count: ordered.length,
    recent
  };
}

function mapCommentEntries(entries, currentUsername) {
  if (!Array.isArray(entries) || !entries.length) {
    return [];
  }
  const normalized = entries
    .map((entry) => ({
      id: entry.id || entry.commentId || null,
      username: entry.username || entry.author || null,
      body: entry.body || '',
      createdAt: entry.createdAt || entry.created_at || null,
      parentId: entry.parentCommentId || entry.parent_id || null,
      mentions: Array.isArray(entry.mentions)
        ? entry.mentions.map((mention) => canonicalUsername(mention)).filter(Boolean)
        : [],
      isSelf: (entry.username || entry.author || '') === currentUsername
    }))
    .filter((entry) => entry.id && entry.username && entry.body);
  normalized.sort((a, b) => {
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });
  const lookup = new Map();
  const roots = [];
  normalized.forEach((comment) => {
    comment.replies = [];
    lookup.set(comment.id, comment);
  });
  normalized.forEach((comment) => {
    if (comment.parentId && lookup.has(comment.parentId)) {
      lookup.get(comment.parentId).replies.push(comment);
    } else {
      roots.push(comment);
    }
  });
  const sortReplies = (list) => {
    list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    list.forEach((item) => {
      if (Array.isArray(item.replies) && item.replies.length) {
        sortReplies(item.replies);
      }
    });
  };
  sortReplies(roots);
  return roots;
}

function formatCollaborativeListForUser(list, username) {
  if (!list) {
    return null;
  }
  const role = list.owner === username ? 'owner' : list.collaborators?.some((entry) => entry.username === username) ? 'editor' : 'viewer';
  const collaboratorUsernames = [list.owner]
    .concat(Array.isArray(list.collaborators) ? list.collaborators.map((entry) => entry.username) : [])
    .map((handle) => canonicalUsername(handle))
    .filter(Boolean);
  const pendingInvites = Array.isArray(list.invites)
    ? list.invites.filter((invite) => invite.status === 'pending').map((invite) => canonicalUsername(invite.username)).filter(Boolean)
    : [];
  const previewItems = buildCollaborativePreviewItems(list);
  const voteHighlights = buildCollaborativeVoteHighlights(list, username);
  const discussionPreview = buildCollaborativeDiscussionPreview(list);
  return {
    id: list.id,
    name: list.name,
    description: list.description || '',
    role,
    owner: list.owner,
    movieCount: Array.isArray(list.items) ? list.items.length : 0,
    collaborators: collaboratorUsernames,
    pendingInvites,
    updatedAt: list.updatedAt || list.createdAt || null,
    createdAt: list.createdAt || null,
    visibility: list.visibility || 'friends',
    preview: previewItems,
    voteHighlights,
    discussionPreview: discussionPreview.preview,
    discussionCount: discussionPreview.count
  };
}

function buildCollaborativePreviewItems(list) {
  if (!Array.isArray(list.items)) {
    return [];
  }
  const sorted = list.items
    .map((item) => {
      const votes = normalizeCollaborativeVotes(item.votes);
      const yesCount = votes.yes.length;
      const noCount = votes.no.length;
      const score = yesCount - noCount;
      return {
        tmdbId: item.tmdbId || null,
        imdbId: item.imdbId || null,
        title: item.title || '',
        addedBy: item.addedBy || null,
        addedAt: item.addedAt || item.createdAt || list.createdAt || null,
        score,
        totalVotes: yesCount + noCount
      };
    })
    .filter((entry) => entry.tmdbId)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (b.totalVotes !== a.totalVotes) {
        return b.totalVotes - a.totalVotes;
      }
      return (b.addedAt || '').localeCompare(a.addedAt || '');
    });
  return sorted
    .slice(0, 4)
    .map((entry) => ({
      tmdbId: entry.tmdbId,
      imdbId: entry.imdbId,
      title: entry.title,
      addedBy: entry.addedBy,
      addedAt: entry.addedAt
    }));
}

function buildCollaborativeVoteHighlights(list, username) {
  if (!Array.isArray(list.items)) {
    return [];
  }
  const canonical = canonicalUsername(username);
  const highlights = list.items
    .map((item) => {
      const votes = normalizeCollaborativeVotes(item.votes);
      const yesCount = votes.yes.length;
      const noCount = votes.no.length;
      const score = yesCount - noCount;
      const myVote = canonical
        ? votes.yes.includes(canonical)
          ? 'yes'
          : votes.no.includes(canonical)
          ? 'no'
          : null
        : null;
      return {
        tmdbId: item.tmdbId || null,
        title: item.title || '',
        yesCount,
        noCount,
        score,
        myVote,
        addedAt: item.addedAt || item.createdAt || list.createdAt || null
      };
    })
    .filter((entry) => entry.tmdbId)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const totalA = a.yesCount + a.noCount;
      const totalB = b.yesCount + b.noCount;
      if (totalB !== totalA) {
        return totalB - totalA;
      }
      return (b.addedAt || '').localeCompare(a.addedAt || '');
    });
  return highlights.slice(0, 3).map((entry) => ({
    tmdbId: entry.tmdbId,
    title: entry.title,
    yesCount: entry.yesCount,
    noCount: entry.noCount,
    score: entry.score,
    myVote: entry.myVote
  }));
}

function buildCollaborativeDiscussionPreview(list) {
  const discussion = Array.isArray(list.discussion) ? list.discussion.slice() : [];
  discussion.sort((a, b) => {
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });
  const preview = discussion
    .slice(-3)
    .map((message) => ({
      id: message.id || randomUUID(),
      username: canonicalUsername(message.username) || message.username || '',
      body: typeof message.body === 'string' ? message.body : '',
      createdAt: message.createdAt || null
    }))
    .filter((message) => message.username && message.body);
  return { preview, count: discussion.length };
}

function normalizeCollaborativeVotes(votes) {
  const yes = Array.isArray(votes?.yes)
    ? Array.from(new Set(votes.yes.map((value) => canonicalUsername(value)).filter(Boolean)))
    : [];
  const no = Array.isArray(votes?.no)
    ? Array.from(new Set(votes.no.map((value) => canonicalUsername(value)).filter(Boolean)))
    : [];
  return { yes, no };
}

function listCollaborativeSummary(store, username) {
  const owned = [];
  const shared = [];
  const invites = [];
  const canonical = canonicalUsername(username);
  if (!Array.isArray(store.collabLists)) {
    return { owned, shared, invites };
  }
  store.collabLists.forEach((list) => {
    const normalized = formatCollaborativeListForUser(list, canonical);
    if (!normalized) {
      return;
    }
    const inviteMatches = Array.isArray(list.invites)
      ? list.invites.find((invite) => canonicalUsername(invite.username) === canonical && invite.status === 'pending')
      : null;
    if (list.owner === canonical) {
      owned.push(normalized);
      return;
    }
    const isCollaborator = Array.isArray(list.collaborators)
      ? list.collaborators.some((entry) => canonicalUsername(entry.username) === canonical)
      : false;
    if (inviteMatches) {
      invites.push({
        id: list.id,
        name: list.name,
        owner: list.owner,
        invitedAt: inviteMatches.invitedAt || list.updatedAt || list.createdAt || null,
        description: list.description || ''
      });
      return;
    }
    if (isCollaborator) {
      shared.push(normalized);
    }
  });
  return { owned, shared, invites };
}

function formatWatchPartyForUser(party, username) {
  if (!party) {
    return null;
  }
  const canonical = canonicalUsername(username);
  const invite = Array.isArray(party.invitees)
    ? party.invitees.find((entry) => canonicalUsername(entry.username) === canonical)
    : null;
  const response = invite ? invite.response || 'pending' : party.host === canonical ? 'host' : 'none';
  return {
    id: party.id,
    host: party.host,
    movie: {
      title: party.movieTitle || '',
      tmdbId: party.movieTmdbId || null,
      imdbId: party.movieImdbId || null
    },
    scheduledFor: party.scheduledFor || null,
    createdAt: party.createdAt || null,
    note: party.note || '',
    response,
    invitees: Array.isArray(party.invitees)
      ? party.invitees.map((entry) => ({
          username: canonicalUsername(entry.username),
          response: entry.response || 'pending'
        }))
      : []
  };
}

function listWatchPartySummary(store, username) {
  const canonical = canonicalUsername(username);
  if (!Array.isArray(store.watchParties)) {
    return { upcoming: [], invites: [] };
  }
  const upcoming = [];
  const invites = [];
  store.watchParties.forEach((party) => {
    const formatted = formatWatchPartyForUser(party, canonical);
    if (!formatted) {
      return;
    }
    if (party.host === canonical || (formatted.response && formatted.response !== 'pending' && formatted.response !== 'none')) {
      upcoming.push(formatted);
    } else if (formatted.response === 'pending') {
      invites.push(formatted);
    }
  });
  return { upcoming, invites };
}

function recordPresence(username, { state, movie, statusPreset, source }) {
  const canonical = canonicalUsername(username);
  if (!canonical) {
    return;
  }
  const now = Date.now();
  const existing = presenceMap.get(canonical) || {};
  presenceMap.set(canonical, {
    state: state || existing.state || 'online',
    updatedAt: now,
    source: source || existing.source || 'manual',
    movieTmdbId: movie && movie.tmdbId ? movie.tmdbId : existing.movieTmdbId || null,
    movieImdbId: movie && movie.imdbId ? movie.imdbId : existing.movieImdbId || null,
    movieTitle: movie && movie.title ? movie.title : existing.movieTitle || null,
    statusPreset:
      statusPreset !== undefined
        ? PRESENCE_STATUS_PRESETS.has(statusPreset)
          ? statusPreset
          : 'default'
        : existing.statusPreset || 'default'
  });
  schedulePresenceCleanup();
}

function buildPresenceSnapshot() {
  const now = Date.now();
  const snapshot = {};
  presenceMap.forEach((entry, key) => {
    if (!entry) {
      presenceMap.delete(key);
      return;
    }
    if (now - entry.updatedAt > PRESENCE_TTL_MS) {
      presenceMap.delete(key);
      return;
    }
    snapshot[key] = {
      state: entry.state || 'online',
      updatedAt: entry.updatedAt,
      statusPreset: entry.statusPreset || 'default',
      movieTitle: entry.movieTitle || null,
      movieTmdbId: entry.movieTmdbId || null,
      movieImdbId: entry.movieImdbId || null
    };
  });
  return snapshot;
}

function broadcastPresenceSnapshot() {
  const snapshot = buildPresenceSnapshot();
  streamClients.forEach((client) => {
    pushStreamEvent(client, 'presence', { presence: snapshot });
  });
}

function schedulePresenceCleanup() {
  if (presenceCleanupTimer) {
    return;
  }
  presenceCleanupTimer = setTimeout(() => {
    presenceCleanupTimer = null;
    const before = presenceMap.size;
    const snapshot = buildPresenceSnapshot();
    if (presenceMap.size !== before) {
      streamClients.forEach((client) => {
        pushStreamEvent(client, 'presence', { presence: snapshot });
      });
    }
    if (presenceMap.size) {
      schedulePresenceCleanup();
    }
  }, PRESENCE_TTL_MS);
}

function computeRecognitionBadgesFromStore(store, username) {
  const canonical = canonicalUsername(username);
  if (!canonical) {
    return [];
  }
  const reviews = Array.isArray(store.reviews)
    ? store.reviews.filter((entry) => canonicalUsername(entry.username) === canonical)
    : [];
  const likes = Array.isArray(store.reviewLikes)
    ? store.reviewLikes.filter((entry) => canonicalUsername(entry.reviewUsername) === canonical)
    : [];
  const comments = Array.isArray(store.reviewComments)
    ? store.reviewComments.filter((entry) => canonicalUsername(entry.username) === canonical)
    : [];
  const hostedParties = Array.isArray(store.watchParties)
    ? store.watchParties.filter((party) => canonicalUsername(party.host) === canonical)
    : [];

  const badges = [];
  if (reviews.length >= 5) {
    badges.push({
      key: 'prolific-reviewer',
      label: 'Prolific Reviewer',
      description: `Published ${reviews.length} community notes.`
    });
  }
  if (likes.length >= 10) {
    badges.push({
      key: 'community-favorite',
      label: 'Community Favorite',
      description: `Earned ${likes.length} reactions from friends.`
    });
  }
  if (comments.length >= 5) {
    badges.push({
      key: 'conversation-starter',
      label: 'Conversation Starter',
      description: `Jumped into ${comments.length} community threads.`
    });
  }
  if (hostedParties.length >= 1) {
    badges.push({
      key: 'event-planner',
      label: 'Event Planner',
      description: `Hosted ${hostedParties.length} watch party${hostedParties.length === 1 ? '' : 'ies'}.`
    });
  }

  const streak = computeReviewStreak(reviews);
  if (streak >= 3) {
    badges.push({
      key: 'streak-keeper',
      label: 'Streak Keeper',
      description: `Shared notes ${streak} days in a row.`
    });
  }
  return badges;
}

function computeReviewStreak(reviews) {
  if (!Array.isArray(reviews) || !reviews.length) {
    return 0;
  }
  const timestamps = reviews
    .map((review) => review.updatedAt || review.createdAt || null)
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());
  if (!timestamps.length) {
    return 0;
  }
  let streak = 1;
  let current = timestamps[0];
  for (let index = 1; index < timestamps.length; index += 1) {
    const next = timestamps[index];
    const diffDays = Math.floor((current.getTime() - next.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays === 1) {
      streak += 1;
      current = next;
    } else if (diffDays > 1) {
      break;
    }
  }
  return streak;
}

function buildLocalReviewId(tmdbId, username) {
  const normalizedUsername = canonicalUsername(username);
  if (!tmdbId || !normalizedUsername) {
    return null;
  }
  return `${tmdbId}:${normalizedUsername}`;
}

async function addReviewComment({
  reviewId,
  reviewUsername,
  username,
  movie,
  body,
  parentId,
  mentions
}) {
  const trimmed = typeof body === 'string' ? body.trim() : '';
  if (!trimmed) {
    throw new HttpError(400, 'Enter a reply before posting.');
  }
  const timestamp = new Date().toISOString();
  const uniqueMentions = Array.isArray(mentions)
    ? Array.from(new Set(mentions.map((mention) => canonicalUsername(mention)).filter(Boolean)))
    : [];
  if (usingLocalStore()) {
    const store = await readSocialStore();
    const entry = {
      id: randomUUID(),
      reviewId,
      reviewUsername,
      username,
      body: trimmed,
      parentCommentId: parentId || null,
      mentions: uniqueMentions,
      movieTmdbId: movie.tmdbId,
      movieImdbId: movie.imdbId || null,
      movieTitle: movie.title,
      createdAt: timestamp
    };
    store.reviewComments.push(entry);
    await writeSocialStore(store);
    return entry;
  }
  try {
    await supabaseFetch('review_comments', {
      method: 'POST',
      body: [
        {
          review_id: reviewId,
          username,
          body: trimmed,
          parent_comment_id: parentId || null
        }
      ]
    });
  } catch (error) {
    enableLocalFallback('posting a review reply', error);
    return addReviewComment({
      reviewId,
      reviewUsername,
      username,
      movie,
      body: trimmed,
      parentId,
      mentions: uniqueMentions
    });
  }
  return {
    id: randomUUID(),
    reviewId,
    reviewUsername,
    username,
    body: trimmed,
    parentCommentId: parentId || null,
    mentions: uniqueMentions,
    movieTmdbId: movie.tmdbId,
    movieImdbId: movie.imdbId || null,
    movieTitle: movie.title,
    createdAt: timestamp
  };
}

async function listReviewComments({ movie, reviewId, reviewUsername }) {
  if (usingLocalStore()) {
    const store = await readSocialStore();
    return store.reviewComments.filter((entry) => {
      if (!entry) {
        return false;
      }
      if (entry.reviewId && reviewId) {
        return entry.reviewId === reviewId;
      }
      return entry.movieTmdbId === movie.tmdbId && entry.reviewUsername === reviewUsername;
    });
  }
  if (!reviewId) {
    return [];
  }
  try {
    const rows = await supabaseFetch('review_comments', {
      query: {
        select: 'id,username,body,parent_comment_id,created_at',
        review_id: `eq.${reviewId}`,
        order: 'created_at.asc'
      }
    });
    if (!Array.isArray(rows)) {
      return [];
    }
    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      body: row.body,
      parentCommentId: row.parent_comment_id || null,
      createdAt: row.created_at || null,
      mentions: extractMentions(row.body || '')
    }));
  } catch (error) {
    enableLocalFallback('loading review replies', error);
    return listReviewComments({ movie, reviewId, reviewUsername });
  }
}

async function likeReviewLocal({ movie, reviewUsername, reviewId, likedBy, timestamp }) {
  const store = await readSocialStore();
  const fallbackId = buildLocalReviewId(movie.tmdbId, reviewUsername);
  const id = reviewId || fallbackId;
  const exists = store.reviewLikes.some(
    (entry) =>
      (entry.reviewId ? entry.reviewId === id : entry.movieTmdbId === movie.tmdbId && entry.reviewUsername === reviewUsername) &&
      entry.likedBy === likedBy
  );
  if (!exists) {
    store.reviewLikes.push({
      movieTmdbId: movie.tmdbId,
      movieImdbId: movie.imdbId || null,
      reviewUsername,
      reviewId: id,
      likedBy,
      createdAt: timestamp
    });
    await enqueueNotification({
      store,
      username: reviewUsername,
      type: 'review_like',
      actor: likedBy,
      movie,
      timestamp
    });
    await writeSocialStore(store);
  }
  const likes = store.reviewLikes.filter((entry) => {
    if (entry.reviewId && id) {
      return entry.reviewId === id;
    }
    return entry.movieTmdbId === movie.tmdbId && entry.reviewUsername === reviewUsername;
  });
  return summarizeLikes(likes, likedBy);
}

async function unlikeReviewLocal({ movie, reviewUsername, reviewId, likedBy }) {
  const store = await readSocialStore();
  const fallbackId = buildLocalReviewId(movie.tmdbId, reviewUsername);
  const id = reviewId || fallbackId;
  const before = store.reviewLikes.length;
  store.reviewLikes = store.reviewLikes.filter(
    (entry) =>
      !(
        (entry.reviewId ? entry.reviewId === id : entry.movieTmdbId === movie.tmdbId && entry.reviewUsername === reviewUsername) &&
        entry.likedBy === likedBy
      )
  );
  if (store.reviewLikes.length !== before) {
    await writeSocialStore(store);
  }
  const likes = store.reviewLikes.filter((entry) => {
    if (entry.reviewId && id) {
      return entry.reviewId === id;
    }
    return entry.movieTmdbId === movie.tmdbId && entry.reviewUsername === reviewUsername;
  });
  return summarizeLikes(likes, likedBy);
}

async function reactToReviewLocal({ movie, reviewUsername, reviewId, username, emoji, timestamp }) {
  const store = await readSocialStore();
  const fallbackId = buildLocalReviewId(movie.tmdbId, reviewUsername);
  const id = reviewId || fallbackId;
  store.reviewReactions = store.reviewReactions.filter((entry) => {
    if (!entry) {
      return false;
    }
    const matchesReview = entry.reviewId === id || entry.reviewUsername === reviewUsername;
    return !(matchesReview && entry.username === username);
  });
  store.reviewReactions.push({
    reviewId: id,
    reviewUsername,
    movieTmdbId: movie.tmdbId,
    movieImdbId: movie.imdbId || null,
    movieTitle: movie.title,
    username,
    emoji,
    createdAt: timestamp
  });
  await writeSocialStore(store);
  return store.reviewReactions.filter((entry) => entry.reviewId === id || entry.reviewUsername === reviewUsername);
}

async function removeReactionLocal({ movie, reviewUsername, reviewId, username }) {
  const store = await readSocialStore();
  const fallbackId = buildLocalReviewId(movie.tmdbId, reviewUsername);
  const id = reviewId || fallbackId;
  const before = store.reviewReactions.length;
  store.reviewReactions = store.reviewReactions.filter((entry) => {
    if (!entry) {
      return false;
    }
    const matchesReview = entry.reviewId === id || entry.reviewUsername === reviewUsername;
    return !(matchesReview && entry.username === username);
  });
  if (before !== store.reviewReactions.length) {
    await writeSocialStore(store);
  }
  return store.reviewReactions.filter((entry) => entry.reviewId === id || entry.reviewUsername === reviewUsername);
}

async function fetchReviewLikeSummary({ reviewId, movie, reviewUsername, currentUsername }) {
  if (!reviewId && (!movie || !movie.tmdbId)) {
    return { count: 0, hasLiked: false };
  }
  if (usingLocalStore()) {
    const store = await readSocialStore();
    const fallbackId = buildLocalReviewId(movie ? movie.tmdbId : null, reviewUsername);
    const id = reviewId || fallbackId;
    const likes = store.reviewLikes.filter((entry) => {
      if (entry.reviewId && id) {
        return entry.reviewId === id;
      }
      if (!movie) {
        return false;
      }
      return entry.movieTmdbId === movie.tmdbId && entry.reviewUsername === reviewUsername;
    });
    return summarizeLikes(likes, currentUsername);
  }
  try {
    if (!reviewId) {
      return { count: 0, hasLiked: false };
    }
    const rows = await supabaseFetch('review_likes', {
      query: {
        select: 'username',
        review_id: `eq.${reviewId}`
      }
    });
    if (!Array.isArray(rows)) {
      return { count: 0, hasLiked: false };
    }
    return summarizeLikes(rows, currentUsername);
  } catch (error) {
    console.warn('Failed to load review likes', error);
    return { count: 0, hasLiked: false };
  }
}

async function ensureReviewId({ movie, reviewUsername, reviewId, requireRemote = false }) {
  if (reviewId) {
    return reviewId;
  }
  if (!reviewUsername) {
    return null;
  }
  if (usingLocalStore()) {
    const tmdbId = movie && movie.tmdbId ? movie.tmdbId : null;
    const store = await readSocialStore();
    const entry = store.reviews.find(
      (row) => row.movieTmdbId === tmdbId && row.username === reviewUsername
    );
    if (entry && entry.id) {
      return entry.id;
    }
    return buildLocalReviewId(tmdbId, reviewUsername);
  }
  if (!movie || !movie.imdbId) {
    return null;
  }
  try {
    const rows = await supabaseFetch('movie_reviews', {
      query: {
        select: 'id',
        movie_imdb_id: `eq.${movie.imdbId}`,
        username: `eq.${reviewUsername}`,
        limit: '1'
      }
    });
    if (Array.isArray(rows) && rows.length && rows[0].id) {
      return rows[0].id;
    }
  } catch (error) {
    if (requireRemote) {
      enableLocalFallback('finding review id', error);
      return ensureReviewId({ movie, reviewUsername, reviewId, requireRemote: false });
    }
    throw error;
  }
  return null;
}

async function listLocalNotifications(username, limit) {
  const store = await readSocialStore();
  const all = store.notifications
    .filter((entry) => entry.username === username)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const unreadCount = all.filter((entry) => !entry.readAt).length;
  return {
    notifications: all.slice(0, limit).map((entry) => ({
      id: entry.id,
      type: entry.type,
      actor: entry.actor,
      movieTitle: entry.movieTitle,
      movieTmdbId: entry.movieTmdbId,
      movieImdbId: entry.movieImdbId,
      message: entry.message,
      createdAt: entry.createdAt,
      readAt: entry.readAt || null
    })),
    unreadCount
  };
}

async function markLocalNotificationsRead(username, timestamp = new Date().toISOString()) {
  const store = await readSocialStore();
  let changed = false;
  store.notifications.forEach((entry) => {
    if (entry.username === username && !entry.readAt) {
      entry.readAt = timestamp;
      changed = true;
    }
  });
  if (changed) {
    await writeSocialStore(store);
  }
}

async function listNotifications(username, { limit = 50 } = {}) {
  if (!username) {
    return { notifications: [], unreadCount: 0 };
  }
  if (usingLocalStore()) {
    return listLocalNotifications(username, limit);
  }
  try {
    const rows = await supabaseFetch('user_notifications', {
      query: {
        select: 'id,type,payload,created_at,is_read',
        recipient_username: `eq.${username}`,
        order: 'created_at.desc',
        limit: String(limit)
      }
    });
    if (!Array.isArray(rows)) {
      return { notifications: [], unreadCount: 0 };
    }
    let unreadCount = rows.filter((row) => !row.is_read).length;
    if (unreadCount < rows.length) {
      try {
        const unreadRows = await supabaseFetch('user_notifications', {
          query: {
            select: 'id',
            recipient_username: `eq.${username}`,
            is_read: 'eq.false'
          }
        });
        if (Array.isArray(unreadRows)) {
          unreadCount = unreadRows.length;
        }
      } catch (error) {
        // ignore supplementary unread fetch failures
      }
    }
    return {
      notifications: rows.map((row) => ({
        id: row.id,
        type: row.type,
        ...normalizeNotificationPayload(row),
        createdAt: row.created_at,
        readAt: row.is_read ? normalizeNotificationReadTimestamp(row) : null
      })),
      unreadCount
    };
  } catch (error) {
    enableLocalFallback('loading notifications', error);
    return listNotifications(username, { limit });
  }
}

async function markNotificationsRead(username) {
  if (!username) {
    return;
  }
  const now = new Date().toISOString();
  if (usingLocalStore()) {
    await markLocalNotificationsRead(username, now);
    return;
  }
  try {
    await supabaseFetch('user_notifications', {
      method: 'PATCH',
      query: { recipient_username: `eq.${username}` },
      body: { is_read: true }
    });
  } catch (error) {
    enableLocalFallback('marking notifications read', error);
    await markLocalNotificationsRead(username, now);
  }
}

async function resolveMovieIdentifiers(movie) {
  if (!movie || typeof movie !== 'object') {
    return { tmdbId: null, imdbId: null, title: '' };
  }
  if (usingLocalStore()) {
    return movie;
  }

  const normalized = {
    tmdbId: movie.tmdbId,
    imdbId: movie.imdbId || null,
    title: movie.title || ''
  };

  let supabaseTitle = '';

  if (!normalized.imdbId) {
    try {
      const rows = await supabaseFetch('movies', {
        query: {
          select: 'imdb_id,title',
          tmdb_id: `eq.${normalized.tmdbId}`,
          limit: '1'
        }
      });
      if (Array.isArray(rows) && rows.length) {
        normalized.imdbId = rows[0].imdb_id || null;
        supabaseTitle = rows[0].title || '';
      }
    } catch (error) {
      // Ignore lookup failure and fall back to existing identifiers.
    }
  }

  if (!normalized.imdbId) {
    const fallbackId = buildFallbackMovieId(normalized.tmdbId);
    if (fallbackId) {
      normalized.imdbId = fallbackId;
    }
  }

  if (!normalized.title && supabaseTitle) {
    normalized.title = supabaseTitle;
  }

  return normalized;
}

function buildFallbackMovieId(tmdbId) {
  const safeId = typeof tmdbId === 'string' ? tmdbId.trim() : tmdbId != null ? String(tmdbId) : '';
  return safeId ? `tmdb-${safeId}` : null;
}

async function ensureMovieRecord(movie) {
  if (usingLocalStore() || !movie.imdbId) {
    return;
  }
  const payload = {
    imdb_id: movie.imdbId,
    tmdb_id: movie.tmdbId || null,
    title: movie.title || movie.imdbId
  };
  try {
    await supabaseFetch('movies', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      query: { on_conflict: 'imdb_id' },
      body: [payload]
    });
  } catch (error) {
    enableLocalFallback('ensuring movie record', error);
  }
}

function normalizeMovieInput(movie) {
  if (!movie || typeof movie !== 'object') {
    return null;
  }
  const tmdbIdRaw = movie.tmdbId ?? movie.tmdb_id ?? movie.tmdbID ?? null;
  const tmdbId = tmdbIdRaw !== null && tmdbIdRaw !== undefined ? String(tmdbIdRaw).trim() : '';
  const imdbId = movie.imdbId || movie.imdbID || null;
  const title = typeof movie.title === 'string' ? movie.title.trim() : '';
  if (!tmdbId || !title) {
    return null;
  }
  return {
    tmdbId,
    imdbId: imdbId ? String(imdbId).trim() : null,
    title
  };
}

function normalizeRating(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }
  const clamped = Math.min(10, Math.max(0, number));
  return Math.round(clamped * 10) / 10;
}

function normalizeReviewContent(input = {}) {
  const capsuleRaw = typeof input.body === 'string' ? input.body.trim() : '';
  const longRaw = typeof input.fullText === 'string' ? input.fullText.trim() : '';
  const preferred = longRaw || capsuleRaw;
  const fullText = preferred ? preferred.slice(0, MAX_LONG_REVIEW_LENGTH).trim() : '';
  const segments = parseReviewSegments(fullText || capsuleRaw);
  const derivedCapsule = capsuleRaw || buildCapsuleFromSegments(segments, preferred);
  const capsule = derivedCapsule ? derivedCapsule.slice(0, MAX_REVIEW_LENGTH).trim() : '';
  const hasSpoilers = Boolean(input.hasSpoilers) || segments.some((segment) => segment.spoiler);
  return {
    capsule,
    fullText,
    segments,
    hasSpoilers
  };
}

function canonicalUsername(username) {
  if (typeof username !== 'string') {
    return '';
  }
  return username.trim().toLowerCase();
}

function formatDisplayNameFromHandle(handle) {
  if (!handle) {
    return '';
  }
  const cleaned = handle.replace(/[_\-.]+/g, ' ');
  return cleaned
    .split(' ')
    .filter(Boolean)
    .map((part) => titleCase(part))
    .join(' ');
}

function titleCase(value) {
  if (!value) {
    return '';
  }
  const lower = value.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function parseReviewSegments(text) {
  if (!text) {
    return [];
  }
  const normalized = text.replace(/\r\n/g, '\n');
  const segments = [];
  const spoilerRegex = /\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi;
  let lastIndex = 0;
  let match;
  while ((match = spoilerRegex.exec(normalized))) {
    const start = match.index;
    if (start > lastIndex) {
      const chunk = normalized.slice(lastIndex, start);
      pushSegmentChunks(segments, chunk, false);
    }
    const spoilerContent = match[1] || '';
    pushSegmentChunks(segments, spoilerContent, true);
    lastIndex = start + match[0].length;
  }
  if (lastIndex < normalized.length) {
    const chunk = normalized.slice(lastIndex);
    pushSegmentChunks(segments, chunk, false);
  }
  return segments;
}

function pushSegmentChunks(segments, raw, spoiler) {
  if (!raw) {
    return;
  }
  const cleaned = raw.replace(/\s+$/g, '').replace(/^\s+/g, '');
  const blocks = cleaned.split(/\n{2,}/);
  blocks.forEach((block) => {
    const text = block.replace(/\s*\n\s*/g, '\n').trim();
    if (text) {
      segments.push({ text, spoiler: Boolean(spoiler) });
    }
  });
}

function buildCapsuleFromSegments(segments, fallback = '') {
  const plainText = Array.isArray(segments)
    ? segments
        .filter((segment) => segment && !segment.spoiler)
        .map((segment) => segment.text)
        .join(' ')
    : '';
  const basis = (plainText || fallback || '').replace(/\s+/g, ' ').trim();
  if (!basis) {
    return '';
  }
  if (basis.length <= MAX_REVIEW_LENGTH) {
    return basis;
  }
  return `${basis.slice(0, MAX_REVIEW_LENGTH - 1).trimEnd()}…`;
}

function extractToken(req, payload) {
  if (!req || !payload) {
    return null;
  }
  if (payload && typeof payload.token === 'string') {
    return payload.token;
  }
  const header = req.headers && req.headers.authorization ? req.headers.authorization : '';
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  return null;
}

async function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        req.destroy();
        resolve({});
      }
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readSocialStore() {
  try {
    const text = await fs.readFile(SOCIAL_STORE_PATH, 'utf8');
    const parsed = JSON.parse(text);
    const legacyLibrary = Array.isArray(parsed.library)
      ? parsed.library.map((row) => ({
          username: row.username,
          verb: row.action,
          objectType: 'movie',
          metadata: {
            movie_tmdb_id: row.movieTmdbId,
            movie_imdb_id: row.movieImdbId || null,
            movie_title: row.movieTitle || ''
          },
          createdAt: row.createdAt
        }))
      : [];
    return {
      follows: Array.isArray(parsed.follows) ? parsed.follows.slice() : [],
      reviews: Array.isArray(parsed.reviews) ? parsed.reviews.slice() : [],
      reviewLikes: Array.isArray(parsed.reviewLikes) ? parsed.reviewLikes.slice() : [],
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications.slice() : [],
      activity: Array.isArray(parsed.activity) ? parsed.activity.slice() : legacyLibrary,
      reviewComments: Array.isArray(parsed.reviewComments) ? parsed.reviewComments.slice() : [],
      reviewReactions: Array.isArray(parsed.reviewReactions) ? parsed.reviewReactions.slice() : [],
      collabLists: Array.isArray(parsed.collabLists) ? parsed.collabLists.slice() : [],
      watchParties: Array.isArray(parsed.watchParties) ? parsed.watchParties.slice() : []
    };
  } catch (error) {
    return {
      follows: [],
      reviews: [],
      reviewLikes: [],
      notifications: [],
      activity: [],
      reviewComments: [],
      reviewReactions: [],
      collabLists: [],
      watchParties: []
    };
  }
}

async function writeSocialStore(store) {
  const payload = JSON.stringify(
    {
      follows: Array.isArray(store.follows) ? store.follows : [],
      reviews: Array.isArray(store.reviews) ? store.reviews : [],
      reviewLikes: Array.isArray(store.reviewLikes) ? store.reviewLikes : [],
      notifications: Array.isArray(store.notifications) ? store.notifications : [],
      activity: Array.isArray(store.activity) ? store.activity : [],
      reviewComments: Array.isArray(store.reviewComments) ? store.reviewComments : [],
      reviewReactions: Array.isArray(store.reviewReactions) ? store.reviewReactions : [],
      collabLists: Array.isArray(store.collabLists) ? store.collabLists : [],
      watchParties: Array.isArray(store.watchParties) ? store.watchParties : []
    },
    null,
    2
  );
  await fs.writeFile(SOCIAL_STORE_PATH, payload, 'utf8');
}

async function readAuthStore() {
  try {
    const text = await fs.readFile(AUTH_STORE_PATH, 'utf8');
    const parsed = JSON.parse(text);
    return {
      users: Array.isArray(parsed.users) ? parsed.users.slice() : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions.slice() : []
    };
  } catch (error) {
    return { users: [], sessions: [] };
  }
}

async function supabaseFetch(pathname, { method = 'GET', headers = {}, query, body } = {}) {
  const url = new URL(`/rest/v1/${pathname}`, SUPABASE_URL);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value);
      }
    });
  }

  const requestInit = {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers
    }
  };

  if (body !== undefined) {
    requestInit.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetchWithTimeout(url, { timeoutMs: 15000, ...requestInit });
  } catch (networkError) {
    throw new HttpError(503, networkError && networkError.message ? networkError.message : 'Unable to reach Supabase');
  }

  if (!response.ok) {
    const text = await safeReadResponse(response);
    throw new HttpError(response.status, text || 'Supabase request failed');
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new HttpError(500, 'Invalid JSON response from Supabase');
  }
}

async function safeReadResponse(response) {
  try {
    return await response.text();
  } catch (error) {
    return '';
  }
}
