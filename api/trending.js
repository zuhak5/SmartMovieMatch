const { fetchWithTimeout } = require('../lib/http-client');
const { createSupabaseAdminClient } = require('../lib/supabase-admin');
const logger = require('../lib/logger');

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const ALLOWED_WINDOWS = new Set(['daily', 'weekly', 'monthly']);
const REQUEST_TIMEOUT_MS = 10000;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!TMDB_API_KEY) {
    res.status(503).json({ error: 'TMDB API key is not configured' });
    return;
  }

  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const timeWindow = parseTimeWindow(parsed.searchParams.get('time_window'));
  const limit = clampLimit(parsed.searchParams.get('limit'));

  try {
    logger.info('request.trending', { timeWindow, limit });
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const providerKeys = parseMultiValues(parsed.searchParams.getAll('provider'));
    const preferUserProviders = parsed.searchParams.get('providers') === 'mine';
    const streamingOnly = parsed.searchParams.get('streaming_only') === 'true';

    const movies = await fetchTrendingFromTmdb({ timeWindow, limit });
    const enriched = await enrichWithAvailability(movies, {
      providerKeys,
      preferUserProviders,
      streamingOnly,
      token
    });
    res.status(200).json({ movies: enriched });
  } catch (error) {
    logger.error('error.trending', { message: String(error && error.message ? error.message : error) });
    res.status(500).json({ error: 'Unable to load trending movies right now.' });
  }
};

function clampLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(MAX_LIMIT, Math.max(1, parsed));
  }
  return DEFAULT_LIMIT;
}

function parseTimeWindow(value) {
  if (!value) return 'weekly';
  const normalized = value.trim().toLowerCase();
  return ALLOWED_WINDOWS.has(normalized) ? normalized : 'weekly';
}

async function fetchTrendingFromTmdb({ timeWindow, limit }) {
  const url = buildTrendingUrl(timeWindow);
  const response = await fetchWithTimeout(url, { timeoutMs: REQUEST_TIMEOUT_MS });

  if (!response.ok) {
    const text = await safeReadResponse(response);
    throw new Error(text || 'TMDB trending request failed');
  }

  const payload = await parseJson(response);
  const results = Array.isArray(payload?.results) ? payload.results.slice(0, limit) : [];
  return results.map((movie, index) => normalizeTrendingMovie(movie, { timeWindow, index }));
}

function buildTrendingUrl(timeWindow = 'weekly') {
  const tmdbWindow = timeWindow === 'daily' ? 'day' : 'week';
  const basePath = timeWindow === 'monthly'
    ? 'https://api.themoviedb.org/3/discover/movie'
    : `https://api.themoviedb.org/3/trending/movie/${tmdbWindow}`;

  const url = new URL(basePath);
  url.searchParams.set('api_key', TMDB_API_KEY);
  url.searchParams.set('language', 'en-US');
  url.searchParams.set('include_adult', 'false');
  url.searchParams.set('page', '1');
  url.searchParams.set('region', 'US');

  if (timeWindow === 'monthly') {
    url.searchParams.set('sort_by', 'popularity.desc');
    url.searchParams.set('primary_release_date.gte', dateStringDaysAgo(30));
  }

  return url;
}

function normalizeTrendingMovie(movie = {}, { timeWindow, index }) {
  const releaseYear = movie.release_date ? movie.release_date.slice(0, 4) : null;
  const rank = Number.isFinite(Number(movie.rank)) ? Number(movie.rank) : index + 1;
  const trendScore = Number.isFinite(Number(movie.popularity))
    ? Number(movie.popularity)
    : movie.vote_average || null;

  return {
    ...movie,
    releaseYear,
    trendScore,
    rank,
    timeWindow
  };
}

function parseMultiValues(values) {
  const list = Array.isArray(values) ? values : [];
  return Array.from(new Set(list.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)));
}

function encodeInList(items) {
  const list = (Array.isArray(items) ? items : []).map((v) => String(v)).filter(Boolean);
  return `(${list.map((v) => v.replace(/,/g, ' ')).join(',')})`;
}

async function resolveUsername(client, token) {
  if (!client || !token) return null;
  try {
    const rows = await client.select('auth_sessions', { columns: 'username', filters: { token }, limit: 1 });
    if (Array.isArray(rows) && rows.length) {
      const row = rows[0];
      return row && row.username ? row.username : null;
    }
    return null;
  } catch (_) {
    return null;
  }
}

async function fetchUserProviders(client, username) {
  if (!client || !username) return [];
  try {
    const rows = await client.select('user_streaming_profiles', { columns: 'provider_key,is_active', filters: { username } });
    return Array.from(new Set((Array.isArray(rows) ? rows : [])
      .filter((row) => row && row.provider_key && row.is_active !== false)
      .map((row) => row.provider_key)));
  } catch (_) {
    return [];
  }
}

function mapAvailabilityRow(row = {}) {
  const provider = row.provider || {};
  return {
    key: row.provider_key || provider.key || '',
    name: provider.display_name || row.provider_key || 'Streaming',
    url: provider.url || null,
    region: row.region || null,
    deeplink: row.deeplink || null,
    brandColor: provider.metadata?.brand_color || null
  };
}

async function enrichWithAvailability(movies, { providerKeys = [], preferUserProviders = false, streamingOnly = false, token = '' } = {}) {
  if (!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) || !Array.isArray(movies) || !movies.length) {
    return movies;
  }

  const client = createSupabaseAdminClient({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY });
  const username = token ? await resolveUsername(client, token) : null;
  const activeProviders = preferUserProviders ? await fetchUserProviders(client, username) : providerKeys;
  if (streamingOnly && !activeProviders.length) {
    return [];
  }

  const tmdbIds = movies.map((m) => m && m.id).filter(Boolean);
  const mapUrl = new URL('/rest/v1/movies', SUPABASE_URL);
  mapUrl.searchParams.set('select', 'tmdb_id,imdb_id');
  mapUrl.searchParams.append('tmdb_id', `in.${encodeInList(tmdbIds)}`);

  const mapResp = await fetchWithTimeout(mapUrl, {
    timeoutMs: REQUEST_TIMEOUT_MS,
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Accept: 'application/json' }
  });
  if (!mapResp.ok) {
    return movies;
  }
  const mapRowsText = await safeReadResponse(mapResp);
  const mapRows = mapRowsText ? JSON.parse(mapRowsText) : [];
  const imdbByTmdb = (Array.isArray(mapRows) ? mapRows : []).reduce((acc, row) => {
    if (row && row.tmdb_id && row.imdb_id) acc[row.tmdb_id] = row.imdb_id;
    return acc;
  }, {});
  const imdbIds = movies.map((m) => imdbByTmdb[m.id]).filter(Boolean);
  if (!imdbIds.length) {
    return movies;
  }

  const availUrl = new URL('/rest/v1/movie_availability', SUPABASE_URL);
  availUrl.searchParams.set('select', 'movie_imdb_id,provider_key,region,deeplink,provider:provider_key(key,display_name,url,metadata)');
  availUrl.searchParams.append('movie_imdb_id', `in.${encodeInList(imdbIds)}`);
  const filteredProviders = (activeProviders || []).filter(Boolean);
  if (filteredProviders.length) {
    availUrl.searchParams.append('provider_key', `in.${encodeInList(filteredProviders)}`);
  }

  const availResp = await fetchWithTimeout(availUrl, {
    timeoutMs: REQUEST_TIMEOUT_MS,
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Accept: 'application/json' }
  });
  if (!availResp.ok) {
    return movies;
  }
  const availText = await safeReadResponse(availResp);
  const availRows = availText ? JSON.parse(availText) : [];
  const byImdb = (Array.isArray(availRows) ? availRows : []).reduce((acc, row) => {
    if (!row || !row.movie_imdb_id) return acc;
    const normalized = mapAvailabilityRow(row);
    if (!acc[row.movie_imdb_id]) acc[row.movie_imdb_id] = [];
    acc[row.movie_imdb_id].push(normalized);
    return acc;
  }, {});

  const merged = movies.map((m) => {
    const providers = byImdb[imdbByTmdb[m.id]] || [];
    return { ...m, streamingProviders: providers };
  });

  return streamingOnly ? merged.filter((m) => Array.isArray(m.streamingProviders) && m.streamingProviders.length) : merged;
}

function dateStringDaysAgo(days = 30) {
  const boundary = new Date();
  boundary.setDate(boundary.getDate() - days);
  return boundary.toISOString().slice(0, 10);
}

async function parseJson(response) {
  try {
    return await response.json();
  } catch (error) {
    throw new Error('Unable to parse TMDB response');
  }
}

async function safeReadResponse(response) {
  try {
    return await response.text();
  } catch (error) {
    return '';
  }
}
