const { fetchWithTimeout } = require('../lib/http-client');

const TMDB_API_KEY = process.env.TMDB_API_KEY;

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
    const movies = await fetchTrendingFromTmdb({ timeWindow, limit });
    res.status(200).json({ movies });
  } catch (error) {
    console.error('trending endpoint failed', error);
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
