const { fetchJson, TIMEOUT_ERROR_NAME } = require('../lib/http-client');
const { RouteCache } = require('../lib/route-cache');

const YOUTUBE_TIMEOUT_MS = 10000;
const YOUTUBE_CACHE_CONTROL = 'public, max-age=0, s-maxage=120, stale-while-revalidate=300';
const youtubeCache = new RouteCache({ ttlMs: 120000, maxEntries: 256 });

module.exports = async (req, res) => {
  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: 'YouTube API key not configured' });
      return;
    }

    const { query } = req;
    const cacheKey = buildYoutubeCacheKey(query);
    const cached = youtubeCache.get(cacheKey);
    if (cached) {
      res.setHeader('Cache-Control', YOUTUBE_CACHE_CONTROL);
      res.setHeader('X-Cache', 'YOUTUBE-HIT');
      res.status(cached.status).json(cached.data);
      return;
    }

    const baseUrl = 'https://www.googleapis.com/youtube/v3/search';

    const params = new URLSearchParams();
    params.set('key', apiKey);
    params.set('part', 'snippet');
    params.set('type', 'video');
    params.set('maxResults', (query && query.maxResults) || '1');

    Object.entries(query || {}).forEach(([key, value]) => {
      if (key.toLowerCase() === 'key') return;
      if (value === undefined || value === null || value === '') return;
      params.set(key, value);
    });

    const url = `${baseUrl}?${params.toString()}`;
    const result = await fetchJson(url, {
      timeoutMs: YOUTUBE_TIMEOUT_MS,
      headers: { Accept: 'application/json' }
    });

    if (!result.ok) {
      res.status(result.status || 502).json(
        result.data && typeof result.data === 'object'
          ? result.data
          : { error: 'YouTube request failed' }
      );
      return;
    }

    if (!result.data || typeof result.data !== 'object') {
      res.status(502).json({ error: 'Invalid YouTube response' });
      return;
    }

    youtubeCache.set(cacheKey, { status: result.status, data: result.data });
    res.setHeader('Cache-Control', YOUTUBE_CACHE_CONTROL);
    res.setHeader('X-Cache', 'YOUTUBE-MISS');
    res.status(result.status).json(result.data);
  } catch (err) {
    console.error('YouTube proxy error', err);
    if (err && err.name === TIMEOUT_ERROR_NAME) {
      res.status(504).json({ error: 'YouTube request timed out' });
      return;
    }
    res.status(500).json({ error: 'YouTube proxy error' });
  }
};

function buildYoutubeCacheKey(query = {}) {
  const entries = Object.entries(query || {})
    .filter(([key, value]) => key.toLowerCase() !== 'key' && value !== undefined && value !== null && value !== '')
    .map(([key, value]) => [key.toLowerCase(), String(value)])
    .sort(([a], [b]) => (a > b ? 1 : a < b ? -1 : 0));
  if (!entries.length) {
    return 'youtube::default';
  }
  return `youtube::${entries.map(([key, value]) => `${key}=${value}`).join('&')}`;
}
