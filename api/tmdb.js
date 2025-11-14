const { fetchJson, TIMEOUT_ERROR_NAME } = require('../lib/http-client');

const ALLOWED_PATHS = new Set([
  'discover/movie',
  'search/movie',
  'trending/movie/week',
  'genre/movie/list'
]);

const TMDB_TIMEOUT_MS = 10000;

module.exports = async (req, res) => {
  try {
    const { query = {} } = req;
    const { path = 'discover/movie', ...rest } = query;

    if (!ALLOWED_PATHS.has(path)) {
      res.status(400).json({ error: 'Unsupported TMDB path' });
      return;
    }

    const isV3Path = path.startsWith('genre/');
    const v4AccessToken = process.env.TMDB_API_READ_ACCESS_TOKEN;
    const v3ApiKey = process.env.TMDB_API_KEY;

    if (isV3Path && !v3ApiKey) {
      res.status(503).json({ error: 'TMDB v3 API key not configured' });
      return;
    }

    if (!isV3Path && !v4AccessToken) {
      res.status(503).json({ error: 'TMDB API Read Access Token not configured' });
      return;
    }

    const apiBase = isV3Path
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

    if (isV3Path) {
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
