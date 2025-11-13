const { fetchJson, TIMEOUT_ERROR_NAME } = require('../lib/http-client');

const OMDB_TIMEOUT_MS = 10000;

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
  let lastError = null;

  for (let index = 0; index < apiKeys.length; index += 1) {
    const apiKey = apiKeys[index];
    try {
      const result = await proxyOmdbRequest(apiKey, query);
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
