const { fetchJson, TIMEOUT_ERROR_NAME } = require('../lib/http-client');

const ALLOWED_PATHS = new Set([
  'discover/movie',
  'search/movie',
  'trending/movie/week'
]);

const TMDB_TIMEOUT_MS = 10000;

module.exports = async (req, res) => {
  try {
    const apiKey = process.env.TMDB_API_READ_ACCESS_TOKEN;
    if (!apiKey) {
      res.status(503).json({ error: 'TMDB API key not configured' });
      return;
    }

    const { query = {} } = req;
    const { path = 'discover/movie', ...rest } = query;

    if (!ALLOWED_PATHS.has(path)) {
      res.status(400).json({ error: 'Unsupported TMDB path' });
      return;
    }

    const baseUrl = `https://api.themoviedb.org/4/${path}`;
    const params = new URLSearchParams();
    params.set('api_key', apiKey);

    const language = rest.language || 'en-US';
    if (language) {
      params.set('language', language);
    }

    if (!Object.prototype.hasOwnProperty.call(rest, 'include_adult')) {
      params.set('include_adult', 'false');
    }

    Object.entries(rest).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') {
        return;
      }
      if (key === 'language') {
        params.set('language', value);
        return;
      }
      if (key === 'include_adult') {
        params.set('include_adult', value);
        return;
      }
      params.set(key, value);
    });

    const url = `${baseUrl}?${params.toString()}`;
    const result = await fetchJson(url, {
      timeoutMs: TMDB_TIMEOUT_MS,
      headers: { Accept: 'application/json' }
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
