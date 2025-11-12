const fs = require('fs/promises');
const path = require('path');
const https = require('https');
const { randomUUID } = require('crypto');

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

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
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
  const following = await listFollowing(user.username);
  return {
    body: { following }
  };
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

  await upsertFollow(user.username, target);
  await enqueueNotification({
    username: target,
    type: 'follow',
    actor: user.username
  });
  const following = await listFollowing(user.username);
  return {
    body: { ok: true, following }
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
  const following = await listFollowing(user.username);
  return {
    body: { ok: true, following }
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

  const body = typeof reviewInput.body === 'string' ? reviewInput.body.trim() : '';
  const hasSpoilers = Boolean(reviewInput.hasSpoilers);
  const resolvedMovie = await resolveMovieIdentifiers(movie);
  if (!usingLocalStore() && !resolvedMovie.imdbId) {
    throw new HttpError(400, 'Missing IMDb ID for this movie. Try another recommendation.');
  }
  await upsertReview({
    username: user.username,
    movie: resolvedMovie,
    rating,
    body: body ? body.slice(0, MAX_REVIEW_LENGTH) : null,
    hasSpoilers
  });
  await broadcastReviewActivity({
    actor: user.username,
    movie: resolvedMovie,
    body
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

  if (usingLocalStore()) {
    const likes = await likeReviewLocal({
      movie: resolvedMovie,
      reviewUsername,
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
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: [
        {
          movie_tmdb_id: resolvedMovie.tmdbId,
          movie_imdb_id: resolvedMovie.imdbId,
          review_username: reviewUsername,
          liked_by: user.username,
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

  const likes = await fetchReviewLikeSummary(resolvedMovie, reviewUsername, user.username);
  return { body: { ok: true, likes } };
}

async function handleUnlikeReview(req, payload) {
  const { user } = await authenticate(req, payload);
  const movie = normalizeMovieInput(payload.movie);
  const reviewUsername = canonicalUsername(payload.reviewUsername || '');
  if (!movie || !movie.tmdbId || !movie.title) {
    throw new HttpError(400, 'Missing movie identifiers.');
  }
  if (!reviewUsername) {
    throw new HttpError(400, 'Missing review username.');
  }

  const resolvedMovie = await resolveMovieIdentifiers(movie);

  if (usingLocalStore()) {
    const likes = await unlikeReviewLocal({
      movie: resolvedMovie,
      reviewUsername,
      likedBy: user.username
    });
    return { body: { ok: true, likes } };
  }

  try {
    await supabaseFetch('review_likes', {
      method: 'DELETE',
      query: {
        movie_tmdb_id: `eq.${resolvedMovie.tmdbId}`,
        review_username: `eq.${reviewUsername}`,
        liked_by: `eq.${user.username}`
      }
    });
  } catch (error) {
    enableLocalFallback('removing a review like', error);
    const likes = await unlikeReviewLocal({
      movie: resolvedMovie,
      reviewUsername,
      likedBy: user.username
    });
    return { body: { ok: true, likes } };
  }
  const likes = await fetchReviewLikeSummary(resolvedMovie, reviewUsername, user.username);
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
    store.reviewLikes
      .filter((entry) => entry.movieTmdbId === movie.tmdbId)
      .forEach((entry) => {
        const key = `${entry.reviewUsername}`;
        if (!likeMap.has(key)) {
          likeMap.set(key, []);
        }
        likeMap.get(key).push(entry);
      });
    reviews.forEach((review) => {
      const likes = likeMap.get(review.username) || [];
      review.likes = summarizeLikes(likes, currentUsername);
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
        select: 'username,rating,body,is_spoiler,created_at,updated_at',
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
  try {
    const likeRows = await supabaseFetch('review_likes', {
      query: {
        select: 'review_username,liked_by',
        movie_tmdb_id: `eq.${movie.tmdbId}`
      }
    });
    if (Array.isArray(likeRows) && likeRows.length) {
      const likeMap = new Map();
      likeRows.forEach((row) => {
        const key = `${row.review_username}`;
        if (!likeMap.has(key)) {
          likeMap.set(key, []);
        }
        likeMap.get(key).push(row);
      });
      reviews.forEach((review) => {
        const likes = likeMap.get(review.username) || [];
        review.likes = summarizeLikes(likes, currentUsername);
      });
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

async function upsertReview({ username, movie, rating, body, hasSpoilers }) {
  const timestamp = new Date().toISOString();
  if (usingLocalStore()) {
    const store = await readSocialStore();
    const existingIndex = store.reviews.findIndex(
      (entry) => entry.movieTmdbId === movie.tmdbId && entry.username === username
    );
    const payload = {
      username,
      movieTmdbId: movie.tmdbId,
      movieImdbId: movie.imdbId || null,
      movieTitle: movie.title,
      rating,
      body: body || null,
      hasSpoilers,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    if (existingIndex !== -1) {
      const existing = store.reviews[existingIndex];
      store.reviews[existingIndex] = {
        ...existing,
        rating,
        body: body || null,
        hasSpoilers,
        updatedAt: timestamp,
        movieTitle: movie.title,
        movieImdbId: movie.imdbId || null
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
    return upsertReview({ username, movie, rating, body, hasSpoilers });
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
  return {
    username,
    rating: typeof row.rating === 'number' ? Number(row.rating) : row.rating ? Number(row.rating) : null,
    body: row.body || null,
    hasSpoilers: Boolean(row.has_spoilers || row.hasSpoilers || row.is_spoiler),
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
    store.library.push({
      username,
      action,
      movieTmdbId: movie.tmdbId,
      movieImdbId: movie.imdbId || null,
      movieTitle: movie.title || '',
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
    await supabaseFetch('library_activity', {
      method: 'POST',
      body: [
        {
          username,
          action,
          movie_tmdb_id: movie.tmdbId,
          movie_imdb_id: movie.imdbId,
          movie_title: movie.title,
          created_at: timestamp
        }
      ]
    });
  } catch (error) {
    enableLocalFallback('recording library activity', error);
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

async function enqueueNotification({ store, username, type, actor, movie, timestamp }) {
  const normalizedUsername = canonicalUsername(username);
  if (!normalizedUsername || (actor && normalizedUsername === actor)) {
    return null;
  }
  const createdAt = timestamp || new Date().toISOString();
  const entry = {
    id: randomUUID(),
    username: normalizedUsername,
    type,
    actor: actor || null,
    movieTitle: movie && movie.title ? movie.title : null,
    movieTmdbId: movie && movie.tmdbId ? movie.tmdbId : null,
    movieImdbId: movie && movie.imdbId ? movie.imdbId : null,
    message: formatNotificationMessage(type, { actor, movie }),
    createdAt,
    readAt: null
  };

  if (usingLocalStore()) {
    if (store) {
      store.notifications.push(entry);
      return entry;
    }
    const nextStore = await readSocialStore();
    nextStore.notifications.push(entry);
    await writeSocialStore(nextStore);
    return entry;
  }

  try {
    await supabaseFetch('user_notifications', {
      method: 'POST',
      body: [
        {
          id: entry.id,
          username: entry.username,
          type: entry.type,
          actor: entry.actor,
          movie_title: entry.movieTitle,
          movie_tmdb_id: entry.movieTmdbId,
          movie_imdb_id: entry.movieImdbId,
          message: entry.message,
          created_at: entry.createdAt,
          read_at: null
        }
      ]
    });
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
      return `${actor} followed you.`;
    case 'mention':
      return `${actor} mentioned you in a review for ${title}.`;
    case 'review_like':
      return `${actor} liked your review for ${title}.`;
    case 'friend_review':
      return `${actor} posted a new review for ${title}.`;
    case 'friend_watchlist':
      return `${actor} added ${title} to their watchlist.`;
    case 'friend_favorite':
      return `${actor} favorited ${title}.`;
    default:
      return `New activity from ${actor}.`;
  }
}

function summarizeLikes(entries, currentUsername) {
  if (!Array.isArray(entries) || !entries.length) {
    return { count: 0, hasLiked: false };
  }
  const count = entries.length;
  const hasLiked = entries.some((entry) => {
    const username = entry.likedBy || entry.liked_by;
    return username === currentUsername;
  });
  return { count, hasLiked };
}

async function likeReviewLocal({ movie, reviewUsername, likedBy, timestamp }) {
  const store = await readSocialStore();
  const exists = store.reviewLikes.some(
    (entry) =>
      entry.movieTmdbId === movie.tmdbId &&
      entry.reviewUsername === reviewUsername &&
      entry.likedBy === likedBy
  );
  if (!exists) {
    store.reviewLikes.push({
      movieTmdbId: movie.tmdbId,
      movieImdbId: movie.imdbId || null,
      reviewUsername,
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
  const likes = store.reviewLikes.filter(
    (entry) => entry.movieTmdbId === movie.tmdbId && entry.reviewUsername === reviewUsername
  );
  return summarizeLikes(likes, likedBy);
}

async function unlikeReviewLocal({ movie, reviewUsername, likedBy }) {
  const store = await readSocialStore();
  const before = store.reviewLikes.length;
  store.reviewLikes = store.reviewLikes.filter(
    (entry) =>
      !(
        entry.movieTmdbId === movie.tmdbId &&
        entry.reviewUsername === reviewUsername &&
        entry.likedBy === likedBy
      )
  );
  if (store.reviewLikes.length !== before) {
    await writeSocialStore(store);
  }
  const likes = store.reviewLikes.filter(
    (entry) => entry.movieTmdbId === movie.tmdbId && entry.reviewUsername === reviewUsername
  );
  return summarizeLikes(likes, likedBy);
}

async function fetchReviewLikeSummary(movie, reviewUsername, currentUsername) {
  if (!movie || !movie.tmdbId) {
    return { count: 0, hasLiked: false };
  }
  if (usingLocalStore()) {
    const store = await readSocialStore();
    const likes = store.reviewLikes.filter(
      (entry) => entry.movieTmdbId === movie.tmdbId && entry.reviewUsername === reviewUsername
    );
    return summarizeLikes(likes, currentUsername);
  }
  try {
    const rows = await supabaseFetch('review_likes', {
      query: {
        select: 'liked_by',
        movie_tmdb_id: `eq.${movie.tmdbId}`,
        review_username: `eq.${reviewUsername}`
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
        select:
          'id,type,actor,movie_title,movie_tmdb_id,movie_imdb_id,message,created_at,read_at',
        username: `eq.${username}`,
        order: 'created_at.desc',
        limit: String(limit)
      }
    });
    if (!Array.isArray(rows)) {
      return { notifications: [], unreadCount: 0 };
    }
    let unreadCount = rows.filter((row) => !row.read_at).length;
    if (unreadCount < rows.length) {
      try {
        const unreadRows = await supabaseFetch('user_notifications', {
          query: {
            select: 'id',
            username: `eq.${username}`,
            read_at: 'is.null'
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
        actor: row.actor,
        movieTitle: row.movie_title,
        movieTmdbId: row.movie_tmdb_id,
        movieImdbId: row.movie_imdb_id,
        message: row.message,
        createdAt: row.created_at,
        readAt: row.read_at || null
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
      query: { username: `eq.${username}` },
      body: { read_at: now }
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

function canonicalUsername(username) {
  if (typeof username !== 'string') {
    return '';
  }
  return username.trim().toLowerCase();
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
    return {
      follows: Array.isArray(parsed.follows) ? parsed.follows.slice() : [],
      reviews: Array.isArray(parsed.reviews) ? parsed.reviews.slice() : [],
      reviewLikes: Array.isArray(parsed.reviewLikes) ? parsed.reviewLikes.slice() : [],
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications.slice() : [],
      library: Array.isArray(parsed.library) ? parsed.library.slice() : []
    };
  } catch (error) {
    return { follows: [], reviews: [], reviewLikes: [], notifications: [], library: [] };
  }
}

async function writeSocialStore(store) {
  const payload = JSON.stringify(
    {
      follows: Array.isArray(store.follows) ? store.follows : [],
      reviews: Array.isArray(store.reviews) ? store.reviews : [],
      reviewLikes: Array.isArray(store.reviewLikes) ? store.reviewLikes : [],
      notifications: Array.isArray(store.notifications) ? store.notifications : [],
      library: Array.isArray(store.library) ? store.library : []
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
    response = await fetch(url, requestInit);
  } catch (networkError) {
    response = await nodeFetch(url, requestInit);
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

function nodeFetch(input, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const requestUrl = typeof input === 'string' ? new URL(input) : input;
      const method = options.method || 'GET';
      const headers = options.headers || {};
      const body = options.body;

      const requestOptions = {
        method,
        headers,
        hostname: requestUrl.hostname,
        port: requestUrl.port || (requestUrl.protocol === 'http:' ? 80 : 443),
        path: `${requestUrl.pathname}${requestUrl.search}`
      };

      const transport = requestUrl.protocol === 'http:' ? require('http') : https;

      const req = transport.request(requestOptions, (resp) => {
        const chunks = [];
        resp.on('data', (chunk) => chunks.push(chunk));
        resp.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const text = buffer.toString('utf8');
          resolve({
            ok: resp.statusCode >= 200 && resp.statusCode < 300,
            status: resp.statusCode || 0,
            statusText: resp.statusMessage || '',
            headers: resp.headers,
            text: async () => text
          });
        });
      });

      req.on('error', reject);

      if (body !== undefined && body !== null) {
        req.write(typeof body === 'string' ? body : Buffer.from(body));
      }

      req.end();
    } catch (error) {
      reject(error);
    }
  });
}
