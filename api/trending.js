const { fetchWithTimeout } = require('../lib/http-client');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USING_LOCAL_STORE = !(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

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

  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const timeWindow = parseTimeWindow(parsed.searchParams.get('time_window'));
  const limit = clampLimit(parsed.searchParams.get('limit'));

  try {
    const movies = USING_LOCAL_STORE
      ? buildLocalFallback(limit)
      : await fetchTrendingFromSupabase({ timeWindow, limit });

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
  return Array.isArray(rawRows)
    ? rawRows.map(normalizeTrendingRow).filter(Boolean)
    : [];
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

function buildLocalFallback(limit) {
  const sample = [
    {
      imdbId: 'tt0816692',
      tmdbId: '157336',
      title: 'Interstellar',
      posterUrl: 'https://image.tmdb.org/t/p/w342/nBNZadXqJSdt05SHLqgT0HuC5Gm.jpg',
      releaseYear: 2014,
      genres: ['Adventure', 'Drama', 'Science Fiction'],
      synopsis:
        "A team of explorers travel through a wormhole in space in an attempt to ensure humanity's survival.",
      stats: { watchCount: 128, favorites: 43, reviews: 18 },
      lastSyncedAt: new Date().toISOString(),
      trendScore: 98.2,
      rank: 1,
      timeWindow: 'weekly'
    },
    {
      imdbId: 'tt0133093',
      tmdbId: '603',
      title: 'The Matrix',
      posterUrl: 'https://image.tmdb.org/t/p/w342/f89U3ADr1oiB1s9GkdPOEpXUk5Gm.jpg',
      releaseYear: 1999,
      genres: ['Action', 'Science Fiction'],
      synopsis:
        'A computer hacker learns about the true nature of his reality and his role in the war against its controllers.',
      stats: { watchCount: 152, favorites: 61, reviews: 27 },
      lastSyncedAt: new Date().toISOString(),
      trendScore: 91.4,
      rank: 2,
      timeWindow: 'weekly'
    }
  ];

  return sample.slice(0, limit);
}

async function safeReadResponse(response) {
  try {
    return await response.text();
  } catch (error) {
    return '';
  }
}
