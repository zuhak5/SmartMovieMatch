const { fetchWithTimeout } = require('../lib/http-client');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const ALLOWED_WINDOWS = new Set(['daily', 'weekly', 'monthly']);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)) {
    res.status(503).json({ error: 'Trending service is not configured' });
    return;
  }

  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const timeWindow = parseTimeWindow(parsed.searchParams.get('time_window'));
  const limit = clampLimit(parsed.searchParams.get('limit'));

  try {
    const movies = await fetchTrendingFromSupabase({ timeWindow, limit });

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

async function fetchTrendingFromSupabase({ timeWindow, limit }) {
  const searchParams = new URLSearchParams();
  searchParams.set(
    'select',
    [
      'time_window,rank,trend_score,captured_at',
      'movie:movie_imdb_id(imdb_id,tmdb_id,title,poster_url,release_year,genres,synopsis,last_synced_at,watch_diary:watch_diary(count),movie_reviews:movie_reviews(count),user_favorites:user_favorites(count))'
    ].join(',')
  );
  searchParams.set('time_window', `eq.${timeWindow}`);
  searchParams.append('order', 'rank.asc.nullslast');
  searchParams.append('order', 'trend_score.desc.nullslast');
  searchParams.set('limit', String(limit));

  const url = new URL('/rest/v1/trending_movies', SUPABASE_URL);
  for (const [key, value] of searchParams.entries()) {
    url.searchParams.append(key, value);
  }

  const response = await fetchWithTimeout(url, {
    timeoutMs: 15000,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    const text = await safeReadResponse(response);
    throw new Error(text || 'Supabase trending request failed');
  }

  const text = await response.text();
  const rawRows = text ? JSON.parse(text) : [];
  const movies = Array.isArray(rawRows)
    ? rawRows.map(normalizeTrendingRow).filter(Boolean)
    : [];

  if (!movies.length) {
    return movies;
  }

  const availabilityByMovie = await fetchMovieAvailability(
    movies.map((movie) => movie.imdbId).filter(Boolean)
  );

  return movies.map((movie) => ({
    ...movie,
    streamingProviders: availabilityByMovie[movie.imdbId] || []
  }));
}

function normalizeTrendingRow(row) {
  if (!row || !row.movie) {
    return null;
  }

  const watchCount = extractRelationshipCount(row.movie.watch_diary);
  const favorites = extractRelationshipCount(row.movie.user_favorites);
  const reviews = extractRelationshipCount(row.movie.movie_reviews);

  return {
    imdbId: row.movie.imdb_id || null,
    tmdbId: row.movie.tmdb_id || null,
    title: row.movie.title || 'Untitled',
    posterUrl: row.movie.poster_url || '',
    releaseYear: row.movie.release_year || null,
    genres: Array.isArray(row.movie.genres) ? row.movie.genres : [],
    synopsis: row.movie.synopsis || '',
    stats: {
      watchCount,
      favorites,
      reviews
    },
    lastSyncedAt: row.movie.last_synced_at || null,
    trendScore: Number.isFinite(Number(row.trend_score)) ? Number(row.trend_score) : null,
    rank: Number.isFinite(Number(row.rank)) ? Number(row.rank) : null,
    timeWindow: row.time_window || 'weekly'
  };
}

function extractRelationshipCount(rel) {
  if (Array.isArray(rel) && rel.length && typeof rel[0].count === 'number') {
    return rel[0].count;
  }
  return 0;
}

async function fetchMovieAvailability(imdbIds = []) {
  if (!Array.isArray(imdbIds) || !imdbIds.length) {
    return {};
  }

  const url = new URL('/rest/v1/movie_availability', SUPABASE_URL);
  url.searchParams.set(
    'select',
    'movie_imdb_id,provider_key,region,deeplink,provider:provider_key(key,display_name,url,metadata)'
  );
  url.searchParams.append('movie_imdb_id', `in.${encodeInList(imdbIds)}`);

  const response = await fetchWithTimeout(url, {
    timeoutMs: 15000,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    const text = await safeReadResponse(response);
    throw new Error(text || 'Supabase availability request failed');
  }

  const text = await response.text();
  const rows = text ? JSON.parse(text) : [];
  if (!Array.isArray(rows)) {
    return {};
  }

  return rows.reduce((acc, row) => {
    if (!row || !row.movie_imdb_id) {
      return acc;
    }
    const normalized = mapAvailabilityRow(row);
    if (!acc[row.movie_imdb_id]) {
      acc[row.movie_imdb_id] = [];
    }
    acc[row.movie_imdb_id].push(normalized);
    return acc;
  }, {});
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

function encodeInList(values = []) {
  const safeValues = values
    .map((value) => String(value || ''))
    .filter(Boolean)
    .map((value) => `"${value.replace(/"/g, '\\"')}"`);
  return `(${safeValues.join(',')})`;
}

async function safeReadResponse(response) {
  try {
    return await response.text();
  } catch (error) {
    return '';
  }
}
