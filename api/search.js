const { fetchWithTimeout } = require('../lib/http-client');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(503).json({ error: 'Supabase search is not configured.' });
    return;
  }

  const {
    q = '',
    filter = 'popular',
    genres = '',
    year,
    providers = '',
    limit
  } = req.query || {};

  const normalizedLimit = clampNumber(parseInt(limit, 10) || DEFAULT_LIMIT, 1, MAX_LIMIT);
  const parsedGenres = parseList(genres);
  const parsedProviders = parseList(providers);
  const trimmedQuery = typeof q === 'string' ? q.trim() : '';

  const url = new URL(`${trimTrailingSlash(SUPABASE_URL)}/rest/v1/movies`);
  const searchParams = url.searchParams;
  searchParams.set(
    'select',
    [
      'imdb_id',
      'tmdb_id',
      'title',
      'original_title',
      'poster_url',
      'release_year',
      'release_date',
      'rating_average',
      'rating_count',
      'popularity_score',
      'genres',
      'providers',
      'synopsis'
    ].join(',')
  );
  searchParams.set('limit', String(Math.min(MAX_LIMIT, normalizedLimit * 2)));

  const orderClause = orderForFilter(filter);
  if (orderClause) {
    searchParams.append('order', orderClause);
  }

  if (trimmedQuery && trimmedQuery.length >= 2) {
    const likeValue = `%${trimmedQuery}%`;
    searchParams.set('or', `(title.ilike.${likeValue},original_title.ilike.${likeValue})`);
  }

  const yearNumber = parseInt(year, 10);
  if (Number.isFinite(yearNumber)) {
    searchParams.set('release_year', `eq.${yearNumber}`);
  }

  if (parsedGenres.length) {
    const safeGenres = parsedGenres.map((value) => value.replace(/[{}/]/g, ''));
    searchParams.set('genres', `ov.{${safeGenres.join(',')}}`);
  }

  try {
    const response = await fetchWithTimeout(url.toString(), {
      timeoutMs: 15000,
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: 'application/json'
      }
    });

    const text = await response.text();
    const rows = text ? safeJsonParse(text) : [];

    if (!response.ok) {
      const status = response.status || 502;
      const message = (rows && rows.message) || 'Supabase search failed.';
      res.status(status).json({ error: message });
      return;
    }

    const normalizedRows = Array.isArray(rows) ? rows : [];
    const providerFiltered = filterByProviders(normalizedRows, parsedProviders);
    const limited = providerFiltered.slice(0, normalizedLimit);

    res.status(200).json({
      results: limited,
      count: limited.length,
      source: 'supabase'
    });
  } catch (error) {
    console.error('Supabase search error', error);
    res.status(502).json({ error: 'Unable to complete search request.' });
  }
};

function parseList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((entry) => entry.trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function orderForFilter(filter) {
  switch (filter) {
    case 'top-rated':
      return 'rating_average.desc.nullslast';
    case 'new':
      return 'release_date.desc.nullslast';
    case 'friends':
      return 'rating_count.desc.nullslast';
    case 'popular':
    default:
      return 'popularity_score.desc.nullslast';
  }
}

function filterByProviders(rows, providers) {
  if (!providers.length) return rows;
  const providerSet = new Set(providers.map((entry) => entry.toLowerCase()));
  return rows.filter((row) => {
    if (!row || row.providers === undefined || row.providers === null) return false;
    const value = row.providers;
    if (Array.isArray(value)) {
      return value.some((entry) => providerSet.has(String(entry).toLowerCase()));
    }
    if (typeof value === 'object') {
      return Object.keys(value).some((key) => providerSet.has(String(key).toLowerCase()));
    }
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      return Array.from(providerSet).some((provider) => lower.includes(provider));
    }
    return false;
  });
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return [];
  }
}
