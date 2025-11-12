const fs = require('fs/promises');
const path = require('path');
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SOCIAL_STORE_PATH = path.join(__dirname, '..', 'data', 'social.json');
const AUTH_STORE_PATH = path.join(__dirname, '..', 'data', 'auth-users.json');
const USING_LOCAL_STORE = !(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

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
  const { reviews, myReview } = await fetchMovieReviews(resolvedMovie, following, user.username);
  return {
    body: {
      reviews,
      myReview
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
  if (!USING_LOCAL_STORE && !resolvedMovie.imdbId) {
    throw new HttpError(400, 'Missing IMDb ID for this movie. Try another recommendation.');
  }
  await upsertReview({
    username: user.username,
    movie: resolvedMovie,
    rating,
    body: body ? body.slice(0, MAX_REVIEW_LENGTH) : null,
    hasSpoilers
  });

  const following = new Set(await listFollowing(user.username));
  const { reviews, myReview } = await fetchMovieReviews(resolvedMovie, following, user.username);
  return {
    body: {
      ok: true,
      myReview,
      reviews
    }
  };
}

async function authenticate(req, payload) {
  const token = extractToken(req, payload);
  if (!token) {
    throw new HttpError(401, 'Missing session token.');
  }

  if (USING_LOCAL_STORE) {
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
  if (USING_LOCAL_STORE) {
    const store = await readSocialStore();
    return store.follows
      .filter((entry) => entry.follower === username)
      .map((entry) => entry.followee)
      .filter(Boolean)
      .sort();
  }
  const rows = await supabaseFetch('user_follows', {
    query: {
      select: 'followed_username',
      follower_username: `eq.${username}`
    }
  });
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows
    .map((row) => row.followed_username)
    .filter(Boolean)
    .sort();
}

async function upsertFollow(follower, followee) {
  if (USING_LOCAL_STORE) {
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
  await supabaseFetch('user_follows', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: [{ follower_username: follower, followed_username: followee }]
  });
}

async function deleteFollow(follower, followee) {
  if (USING_LOCAL_STORE) {
    const store = await readSocialStore();
    store.follows = store.follows.filter(
      (entry) => !(entry.follower === follower && entry.followee === followee)
    );
    await writeSocialStore(store);
    return;
  }
  await supabaseFetch('user_follows', {
    method: 'DELETE',
    query: {
      follower_username: `eq.${follower}`,
      followed_username: `eq.${followee}`
    }
  });
}

async function fetchMovieReviews(movie, followingSet, currentUsername) {
  if (USING_LOCAL_STORE) {
    const store = await readSocialStore();
    const rows = store.reviews
      .filter((entry) => entry.movieTmdbId === movie.tmdbId)
      .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
    const reviews = rows.map((row) => mapReviewRow(row, followingSet, currentUsername));
    const myReview = reviews.find((review) => review.username === currentUsername) || null;
    return { reviews, myReview };
  }
  if (!movie.imdbId) {
    return { reviews: [], myReview: null };
  }
  const rows = await supabaseFetch('movie_reviews', {
    query: {
      select: 'username,rating,body,is_spoiler,created_at,updated_at',
      movie_imdb_id: `eq.${movie.imdbId}`,
      order: 'updated_at.desc'
    }
  });
  if (!Array.isArray(rows)) {
    return { reviews: [], myReview: null };
  }
  const reviews = rows.map((row) => mapReviewRow(row, followingSet, currentUsername));
  const myReview = reviews.find((review) => review.username === currentUsername) || null;
  return { reviews, myReview };
}

async function upsertReview({ username, movie, rating, body, hasSpoilers }) {
  const timestamp = new Date().toISOString();
  if (USING_LOCAL_STORE) {
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
}

async function userExists(username) {
  if (!username) {
    return false;
  }
  if (USING_LOCAL_STORE) {
    const store = await readAuthStore();
    return store.users.some((row) => row.username === username);
  }
  const rows = await supabaseFetch('auth_users', {
    query: {
      select: 'username',
      username: `eq.${username}`,
      limit: '1'
    }
  });
  return Array.isArray(rows) && rows.length > 0;
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

async function resolveMovieIdentifiers(movie) {
  if (!movie || typeof movie !== 'object') {
    return { tmdbId: null, imdbId: null, title: '' };
  }
  if (USING_LOCAL_STORE) {
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
  if (USING_LOCAL_STORE || !movie.imdbId) {
    return;
  }
  const payload = {
    imdb_id: movie.imdbId,
    tmdb_id: movie.tmdbId || null,
    title: movie.title || movie.imdbId
  };
  await supabaseFetch('movies', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    query: { on_conflict: 'imdb_id' },
    body: [payload]
  });
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
      reviews: Array.isArray(parsed.reviews) ? parsed.reviews.slice() : []
    };
  } catch (error) {
    return { follows: [], reviews: [] };
  }
}

async function writeSocialStore(store) {
  const payload = JSON.stringify(
    {
      follows: Array.isArray(store.follows) ? store.follows : [],
      reviews: Array.isArray(store.reviews) ? store.reviews : []
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
