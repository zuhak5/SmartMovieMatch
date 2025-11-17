const { fetchWithTimeout } = require('../lib/http-client');
const { createSupabaseAdminClient } = require('../lib/supabase-admin');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USING_LOCAL_STORE = !(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const query = sanitizeQuery(parsed.searchParams.get('q'));
  const filter = (parsed.searchParams.get('filter') || 'popular').trim();
  const limit = clampLimit(parsed.searchParams.get('limit'));
  const genres = parseMultiValues(parsed.searchParams.getAll('genre'));
  const year = parseYear(parsed.searchParams.get('year'));

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  try {
    const movies = USING_LOCAL_STORE
      ? buildLocalFallback({ query, limit })
      : await searchSupabase({ query, filter, limit, genres, year });

    if (!USING_LOCAL_STORE) {
      await logSearchQuery({
        query,
        filter,
        genres,
        year,
        resultsCount: movies.length,
        token
      });
    }

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

function parseYear(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 1888 || parsed > 2100) return null;
  return parsed;
}

async function searchSupabase({ query, filter, limit, genres, year }) {
  const searchParams = new URLSearchParams();
  searchParams.set(
    'select',
    [
      'imdb_id,tmdb_id,title,poster_url,release_year,genres,synopsis,last_synced_at',
      'watch_diary:watch_diary(count)',
      'movie_reviews:movie_reviews(count)',
      'user_favorites:user_favorites(count)'
    ].join(',')
  );

  const { orderField, direction, timeWindow } = resolveOrdering(filter);
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

  if (timeWindow) {
    searchParams.append('watch_diary.watched_on', `gte.${timeWindow}`);
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
  return Array.isArray(rawRows) ? rawRows.map(normalizeMovieRow) : [];
}

function normalizeMovieRow(row) {
  const watchCount = extractRelationshipCount(row.watch_diary);
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
      watchCount,
      favorites,
      reviews
    },
    lastSyncedAt: row.last_synced_at || null
  };
}

function extractRelationshipCount(rel) {
  if (Array.isArray(rel) && rel.length && typeof rel[0].count === 'number') {
    return rel[0].count;
  }
  return 0;
}

function resolveOrdering(filter) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  switch (filter) {
    case 'top-rated':
      return { orderField: 'movie_reviews.count', direction: 'desc' };
    case 'new':
      return { orderField: 'release_year', direction: 'desc' };
    case 'friends':
      return { orderField: 'user_favorites.count', direction: 'desc' };
    default:
      return { orderField: 'watch_diary.count', direction: 'desc', timeWindow: weekAgo };
  }
}

async function logSearchQuery({ query, filter, genres, year, resultsCount, token }) {
  if (!query && !genres.length && !year) {
    return;
  }
  try {
    const client = createSupabaseAdminClient({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY });
    const username = await resolveUsername(client, token);
    await client.insert('search_queries', [{
      username: username || null,
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

function buildLocalFallback({ query, limit }) {
  const sample = [
    {
      imdbId: 'tt0816692',
      tmdbId: '157336',
      title: 'Interstellar',
      posterUrl: 'https://image.tmdb.org/t/p/w342/nBNZadXqJSdt05SHLqgT0HuC5Gm.jpg',
      releaseYear: 2014,
      genres: ['Adventure', 'Drama', 'Science Fiction'],
      synopsis: 'A team of explorers travel through a wormhole in space in an attempt to ensure humanity\'s survival.',
      stats: { watchCount: 128, favorites: 43, reviews: 18 },
      lastSyncedAt: new Date().toISOString()
    },
    {
      imdbId: 'tt0133093',
      tmdbId: '603',
      title: 'The Matrix',
      posterUrl: 'https://image.tmdb.org/t/p/w342/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg',
      releaseYear: 1999,
      genres: ['Action', 'Science Fiction'],
      synopsis: 'A computer hacker learns about the true nature of his reality and his role in the war against its controllers.',
      stats: { watchCount: 152, favorites: 61, reviews: 27 },
      lastSyncedAt: new Date().toISOString()
    }
  ];

  const trimmed = query
    ? sample.filter((item) => item.title.toLowerCase().includes(query.toLowerCase())).slice(0, limit)
    : sample.slice(0, limit);

  return trimmed;
}

async function safeReadResponse(response) {
  try {
    return await response.text();
  } catch (error) {
    return '';
  }
}
