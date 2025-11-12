const { fetchJson, TIMEOUT_ERROR_NAME } = require('../lib/http-client');

const OMDB_TIMEOUT_MS = 10000;

module.exports = async (req, res) => {
  try {
    const apiKey = process.env.OMDB_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: 'OMDb API key not configured' });
      return;
    }

    const { query } = req;

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
      res.status(result.status || 502).json(
        result.data && typeof result.data === 'object'
          ? result.data
          : { error: 'OMDb request failed' }
      );
      return;
    }

    if (!result.data || typeof result.data !== 'object') {
      res.status(502).json({ error: 'Invalid OMDb response' });
      return;
    }

    res.status(result.status).json(result.data);
  } catch (err) {
    console.error('OMDb proxy error', err);
    if (err && err.name === TIMEOUT_ERROR_NAME) {
      res.status(504).json({ error: 'OMDb request timed out' });
      return;
    }
    res.status(500).json({ error: 'OMDb proxy error' });
  }
};
