const { fetchJson, TIMEOUT_ERROR_NAME } = require('../lib/http-client');

const YOUTUBE_TIMEOUT_MS = 10000;

module.exports = async (req, res) => {
  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: 'YouTube API key not configured' });
      return;
    }

    const { query } = req;

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
