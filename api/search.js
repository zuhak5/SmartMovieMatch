const { fetchWithTimeout } = require('../lib/http-client');
const { createSupabaseAdminClient } = require('../lib/supabase-admin');

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

  if (!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)) {
    res.status(503).json({ error: 'Search service is not configured' });
    return;
  }

  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const query = sanitizeQuery(parsed.searchParams.get('q'));
  const filter = (parsed.searchParams.get('filter') || 'popular').trim();
  const limit = clampLimit(parsed.searchParams.get('limit'));
  const genres = parseMultiValues(parsed.searchParams.getAll('genre'));
  const year = parseYear(parsed.searchParams.get('year'));
  const providerKeys = parseMultiValues(parsed.searchParams.getAll('provider'));
  const preferUserProviders = parsed.searchParams.get('providers') === 'mine';
  const streamingOnly =
    parsed.searchParams.get('streaming_only') === 'true' || filter === 'streaming' || preferUserProviders;

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  try {
    const client = createSupabaseAdminClient({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY });
    const username = client && token ? await resolveUsername(client, token) : null;
    const activeProviders =
      !streamingOnly && providerKeys.length
        ? providerKeys
        : streamingOnly && preferUserProviders
        ? await fetchUserProviders(client, username)
        : providerKeys;

    if (streamingOnly && !activeProviders.length) {
      res.status(200).json({ movies: [] });
      return;
    }

    const movies = await searchSupabase({
      query,
      filter,
      limit,
      genres,
      year,
      providerKeys: activeProviders,
      streamingOnly,
      includeAvailability: true
    });

    await logSearchQuery({
      query,
      filter,
      genres,
      year,
      resultsCount: movies.length,
      token,
      client,
      username
    });

    res.status(200).json({ movies });
  } catch (error) {
    console.error('search endpoint failed', error);
    res.status(500).json({ error: 'Unable to fetch search results right now.' });
  }
};

function clampLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(MAX_LIMIT, Math.max(1, parsed));
  }
  return DEFAULT_LIMIT;
}

function sanitizeQuery(value) {
  if (!value) return '';
  return value.replace(/[%]/g, '').trim().slice(0, 120);
}

function parseMultiValues(values = []) {
  return values
    .flatMap((value) => (value || '').split(','))
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function encodeInList(values = []) {
  const safeValues = values
    .map((value) => String(value || ''))
    .filter(Boolean)
    .map((value) => `"${value.replace(/"/g, '\\"')}"`);
  return `(${safeValues.join(',')})`;
}

function parseYear(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 1888 || parsed > 2100) return null;
  return parsed;
}

async function searchSupabase({
  query,
  filter,
  limit,
  genres,
  year,
  providerKeys = [],
  streamingOnly = false,
  includeAvailability = false
}) {
  const searchParams = new URLSearchParams();
  searchParams.set(
    'select',
    [
      'imdb_id,tmdb_id,title,poster_url,release_year,genres,synopsis,last_synced_at',
      'movie_reviews:movie_reviews(count)',
      'user_favorites:user_favorites(count)'
    ].join(',')
  );

  const { orderField, direction } = resolveOrdering(filter);
  searchParams.set('order', `${orderField}.${direction}.nullslast`);
  searchParams.set('limit', String(limit));

  if (query) {
    const escaped = query.replace(/,/g, ' ');
    searchParams.append('or', `title.ilike.%${escaped}%,synopsis.ilike.%${escaped}%`);
  }

  if (genres.length) {
    searchParams.append('genres', `cs.{${genres.join(',')}}`);
  }

  if (year) {
    searchParams.append('release_year', `eq.${year}`);
  }

  const url = new URL('/rest/v1/movies', SUPABASE_URL);
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
    throw new Error(text || 'Supabase search request failed');
  }

  const text = await response.text();
  const rawRows = text ? JSON.parse(text) : [];
  const movies = Array.isArray(rawRows) ? rawRows.map(normalizeMovieRow) : [];

  if (!includeAvailability || !movies.length) {
    return movies;
  }

  const availabilityByMovie = await fetchMovieAvailability(
    movies.map((movie) => movie.imdbId).filter(Boolean),
    { providerKeys }
  );
  const withAvailability = movies.map((movie) => ({
    ...movie,
    streamingProviders: availabilityByMovie[movie.imdbId] || []
  }));

  if (streamingOnly) {
    return withAvailability.filter((movie) => movie.streamingProviders.length);
  }

  return withAvailability;
}

function normalizeMovieRow(row) {
  const favorites = extractRelationshipCount(row.user_favorites);
  const reviews = extractRelationshipCount(row.movie_reviews);

  return {
    imdbId: row.imdb_id || null,
    tmdbId: row.tmdb_id || null,
    title: row.title || 'Untitled',
    posterUrl: row.poster_url || '',
    releaseYear: row.release_year || null,
    genres: Array.isArray(row.genres) ? row.genres : [],
    synopsis: row.synopsis || '',
    stats: {
      favorites,
      reviews
    },
    lastSyncedAt: row.last_synced_at || null
  };
}

async function fetchMovieAvailability(imdbIds = [], { providerKeys = [] } = {}) {
  if (!Array.isArray(imdbIds) || !imdbIds.length) {
    return {};
  }

  const url = new URL('/rest/v1/movie_availability', SUPABASE_URL);
  url.searchParams.set(
    'select',
    'movie_imdb_id,provider_key,region,deeplink,provider:provider_key(key,display_name,url,metadata)'
  );
  url.searchParams.append('movie_imdb_id', `in.${encodeInList(imdbIds)}`);

  const filteredProviders = (providerKeys || []).filter(Boolean);
  if (filteredProviders.length) {
    url.searchParams.append('provider_key', `in.${encodeInList(filteredProviders)}`);
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

function extractRelationshipCount(rel) {
  if (Array.isArray(rel) && rel.length && typeof rel[0].count === 'number') {
    return rel[0].count;
  }
  return 0;
}

function resolveOrdering(filter) {
  switch (filter) {
    case 'top-rated':
      return { orderField: 'movie_reviews.count', direction: 'desc' };
    case 'new':
      return { orderField: 'release_year', direction: 'desc' };
    case 'friends':
      return { orderField: 'user_favorites.count', direction: 'desc' };
    case 'streaming':
      return { orderField: 'movie_reviews.count', direction: 'desc' };
    default:
      return { orderField: 'user_favorites.count', direction: 'desc' };
  }
}

async function fetchUserProviders(client, username) {
  if (!client || !username) {
    return [];
  }
  try {
    const rows = await client.select('user_streaming_profiles', {
      columns: 'provider_key,is_active',
      filters: { username }
    });
    return Array.from(
      new Set(
        (Array.isArray(rows) ? rows : [])
          .filter((row) => row && row.provider_key && row.is_active !== false)
          .map((row) => row.provider_key)
      )
    );
  } catch (error) {
    return [];
  }
}

async function logSearchQuery({ query, filter, genres, year, resultsCount, token, client, username }) {
  if (!query && !genres.length && !year) {
    return;
  }
  try {
    const workingClient =
      client || createSupabaseAdminClient({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY });
    const resolvedUsername = username || (token ? await resolveUsername(workingClient, token) : null);
    await workingClient.insert('search_queries', [{
      username: resolvedUsername || null,
      query: query || '(empty)',
      filters: { sort: filter, genres, year },
      results_count: Number.isFinite(resultsCount) ? resultsCount : null,
      client_context: { source: 'discover' }
    }]);
  } catch (error) {
    console.warn('Failed to log search query', error);
  }
}

async function resolveUsername(client, token) {
  if (!token) {
    return null;
  }
  try {
    const rows = await client.select('auth_sessions', {
      columns: 'username',
      filters: { token },
      limit: 1
    });
    if (Array.isArray(rows) && rows.length) {
      const row = rows[0];
      return row && row.username ? row.username : null;
    }
    return null;
  } catch (error) {
    return null;
  }
}

async function safeReadResponse(response) {
  try {
    return await response.text();
  } catch (error) {
    return '';
  }
}
