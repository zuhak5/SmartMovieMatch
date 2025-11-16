const { fetchJson, TIMEOUT_ERROR_NAME } = require('../lib/http-client');
const { RouteCache } = require('../lib/route-cache');

const ALLOWED_PATH_PATTERNS = [
  /^discover\/movie$/,
  /^search\/movie$/,
  /^trending\/movie\/week$/,
  /^genre\/movie\/list$/,
  /^movie\/\d+\/(recommendations|similar)$/
];

function isAllowedPath(path) {
  return ALLOWED_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

const V3_PATH_PATTERNS = [
  /^genre\//,
  /^discover\//,
  /^search\//,
  /^trending\//,
  /^movie\/\d+\/(recommendations|similar)$/
];

function isV3Path(path) {
  return V3_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

const TMDB_TIMEOUT_MS = 10000;
const TMDB_CACHE_CONTROL = 'public, max-age=0, s-maxage=60, stale-while-revalidate=120';
const tmdbCache = new RouteCache({ ttlMs: 60000, maxEntries: 256 });

module.exports = async (req, res) => {
  try {
    const { query = {} } = req;
    const { path = 'discover/movie', ...rest } = query;

    if (!isAllowedPath(path)) {
      res.status(400).json({ error: 'Unsupported TMDB path' });
      return;
    }

    let useV3 = isV3Path(path);
    const v4AccessToken = process.env.TMDB_API_READ_ACCESS_TOKEN;
    const v3ApiKey = process.env.TMDB_API_KEY;

    if (useV3 && !v3ApiKey) {
      res.status(503).json({ error: 'TMDB v3 API key not configured' });
      return;
    }

    if (!useV3 && !v4AccessToken) {
      if (!v3ApiKey) {
        res.status(503).json({ error: 'TMDB API credentials not configured' });
        return;
      }
      useV3 = true;
    }

    const apiBase = useV3
      ? 'https://api.themoviedb.org/3/'
      : 'https://api.themoviedb.org/4/';
    const baseUrl = `${apiBase}${path}`;

    const paramEntries = [];
    const appendParam = (key, value) => {
      if (value === undefined || value === null || value === '') {
        return;
      }
      paramEntries.push([key, value]);
    };

    const language = rest.language || 'en-US';
    if (language) {
      appendParam('language', language);
    }

    if (!Object.prototype.hasOwnProperty.call(rest, 'include_adult')) {
      appendParam('include_adult', 'false');
    }

    Object.entries(rest).forEach(([key, value]) => {
      if (key === 'language' || key === 'include_adult') {
        appendParam(key, value);
        return;
      }
      appendParam(key, value);
    });

    const headers = {
      Accept: 'application/json'
    };

    let url = baseUrl;
    let body;
    let method = 'GET';

    if (useV3) {
      appendParam('api_key', v3ApiKey);
      if (paramEntries.length) {
        const search = new URLSearchParams(paramEntries);
        url = `${baseUrl}?${search.toString()}`;
      }
    } else {
      method = 'POST';
      headers.Authorization = `Bearer ${v4AccessToken}`;
      headers['Content-Type'] = 'application/json;charset=utf-8';
      const payload = Object.fromEntries(paramEntries);
      body = JSON.stringify(payload);
    }

    const cacheKey = buildCacheKey(method, url, body);
    const cached = tmdbCache.get(cacheKey);
    if (cached) {
      res.setHeader('Cache-Control', TMDB_CACHE_CONTROL);
      res.setHeader('X-Cache', 'TMDB-HIT');
      res.status(cached.status).json(cached.data);
      return;
    }

    const result = await fetchJson(url, {
      timeoutMs: TMDB_TIMEOUT_MS,
      method,
      body,
      headers
    });

    if (!result.ok) {
      res.status(result.status || 502).json(
        result.data && typeof result.data === 'object'
          ? result.data
          : { error: 'TMDB request failed' }
      );
      return;
    }

    if (!result.data || typeof result.data !== 'object') {
      res.status(502).json({ error: 'Invalid TMDB response' });
      return;
    }

    tmdbCache.set(cacheKey, { status: result.status, data: result.data });
    res.setHeader('Cache-Control', TMDB_CACHE_CONTROL);
    res.setHeader('X-Cache', 'TMDB-MISS');
    res.status(result.status).json(result.data);
  } catch (err) {
    console.error('TMDB proxy error', err);
    if (err && err.name === TIMEOUT_ERROR_NAME) {
      res.status(504).json({ error: 'TMDB request timed out' });
      return;
    }
    res.status(500).json({ error: 'TMDB proxy error' });
  }
};

function buildCacheKey(method, url, body) {
  return `${method}:${url}:${body || ''}`;
}
