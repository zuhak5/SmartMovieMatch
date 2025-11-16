const { fetchJson, TIMEOUT_ERROR_NAME } = require('../lib/http-client');
const { RouteCache } = require('../lib/route-cache');

const OMDB_TIMEOUT_MS = 10000;
const OMDB_CACHE_CONTROL = 'public, max-age=0, s-maxage=300, stale-while-revalidate=600';
const omdbCache = new RouteCache({ ttlMs: 300000, maxEntries: 256 });

async function proxyOmdbRequest(apiKey, query) {
  const baseUrl = 'https://www.omdbapi.com/';
  const params = new URLSearchParams();
  params.set('apikey', apiKey);

  Object.entries(query || {}).forEach(([key, value]) => {
    if (key.toLowerCase() === 'apikey') return;
    if (value === undefined || value === null || value === '') return;
    params.set(key, value);
  });

  const url = `${baseUrl}?${params.toString()}`;
  const result = await fetchJson(url, {
    timeoutMs: OMDB_TIMEOUT_MS,
    headers: { Accept: 'application/json' }
  });

  if (!result.ok) {
    const error = new Error('OMDb request failed');
    error.status = result.status || 502;
    error.data =
      result.data && typeof result.data === 'object'
        ? result.data
        : { error: 'OMDb request failed' };
    throw error;
  }

  if (!result.data || typeof result.data !== 'object') {
    const error = new Error('Invalid OMDb response');
    error.status = 502;
    error.data = { error: 'Invalid OMDb response' };
    throw error;
  }

  return {
    status: result.status,
    data: result.data
  };
}

module.exports = async (req, res) => {
  const apiKeys = [process.env.OMDB_API_KEY, process.env.OMDB_API_KEY2].filter(Boolean);
  if (!apiKeys.length) {
    res.status(503).json({ error: 'OMDb API key not configured' });
    return;
  }

  const { query } = req;
  const cacheKey = buildOmdbCacheKey(query);
  const cached = omdbCache.get(cacheKey);
  if (cached) {
    res.setHeader('Cache-Control', OMDB_CACHE_CONTROL);
    res.setHeader('X-Cache', 'OMDB-HIT');
    res.status(cached.status).json(cached.data);
    return;
  }
  let lastError = null;

  for (let index = 0; index < apiKeys.length; index += 1) {
    const apiKey = apiKeys[index];
    try {
      const result = await proxyOmdbRequest(apiKey, query);
      omdbCache.set(cacheKey, { status: result.status, data: result.data });
      res.setHeader('Cache-Control', OMDB_CACHE_CONTROL);
      res.setHeader('X-Cache', 'OMDB-MISS');
      res.status(result.status).json(result.data);
      return;
    } catch (err) {
      lastError = err;
      console.error(`OMDb proxy error (key #${index + 1})`, err);
    }
  }

  const status = (lastError && lastError.status) || (lastError && lastError.name === TIMEOUT_ERROR_NAME ? 504 : 500);
  if (lastError && lastError.name === TIMEOUT_ERROR_NAME) {
    res.status(status).json({ error: 'OMDb request timed out' });
    return;
  }

  if (lastError && lastError.data) {
    res.status(status).json(lastError.data);
    return;
  }

  res.status(status).json({ error: 'OMDb proxy error' });
};

function buildOmdbCacheKey(query = {}) {
  const entries = Object.entries(query || {})
    .filter(([key, value]) => key.toLowerCase() !== 'apikey' && value !== undefined && value !== null && value !== '')
    .map(([key, value]) => [key.toLowerCase(), String(value)])
    .sort(([a], [b]) => (a > b ? 1 : a < b ? -1 : 0));
  if (!entries.length) {
    return 'omdb::default';
  }
  const search = entries.map(([key, value]) => `${key}=${value}`).join('&');
  return `omdb::${search}`;
}
