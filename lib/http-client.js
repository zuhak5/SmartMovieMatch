const http = require('http');
const https = require('https');

const TIMEOUT_ERROR_NAME = 'TimeoutError';
const ABORT_ERROR_NAME = 'AbortError';

function getFetchImplementation() {
  if (typeof global.fetch === 'function') {
    return global.fetch.bind(global);
  }
  return legacyFetch;
}

async function fetchWithTimeout(input, init = {}) {
  const { timeoutMs = 10000, ...rest } = init || {};
  const fetchImpl = getFetchImplementation();
  const finalInit = cloneInit(rest);

  if (timeoutMs > 0 && !finalInit.signal && typeof AbortController === 'function') {
    const controller = new AbortController();
    finalInit.signal = controller.signal;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(input, finalInit);
    } catch (error) {
      if (isAbortError(error)) {
        throw buildTimeoutError(input, timeoutMs);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  if (timeoutMs > 0) {
    let timeoutId;
    try {
      const timedResponse = await Promise.race([
        fetchImpl(input, finalInit),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(buildTimeoutError(input, timeoutMs)), timeoutMs);
        })
      ]);
      return timedResponse;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return fetchImpl(input, finalInit);
}

async function fetchJson(input, init = {}) {
  const response = await fetchWithTimeout(input, init);
  const text = await response.text();
  if (!text) {
    return {
      status: response.status,
      ok: response.ok,
      headers: extractHeaders(response.headers),
      data: null
    };
  }

  try {
    const data = JSON.parse(text);
    return {
      status: response.status,
      ok: response.ok,
      headers: extractHeaders(response.headers),
      data
    };
  } catch (error) {
    const parseError = new Error('Failed to parse JSON response');
    parseError.cause = error;
    throw parseError;
  }
}

function extractHeaders(headers) {
  if (!headers) {
    return {};
  }
  if (typeof headers.entries === 'function') {
    return Object.fromEntries(headers.entries());
  }
  return { ...headers };
}

function cloneInit(init) {
  if (!init || typeof init !== 'object') {
    return {};
  }
  const cloned = { ...init };
  if (init.headers && typeof init.headers === 'object' && typeof init.headers.entries !== 'function') {
    cloned.headers = { ...init.headers };
  }
  return cloned;
}

function isAbortError(error) {
  if (!error) {
    return false;
  }
  return error.name === ABORT_ERROR_NAME || error.code === 'ABORT_ERR';
}

function buildTimeoutError(input, timeoutMs) {
  const timeoutError = new Error(`Request to ${formatInput(input)} timed out after ${timeoutMs}ms`);
  timeoutError.name = TIMEOUT_ERROR_NAME;
  return timeoutError;
}

function formatInput(input) {
  if (typeof input === 'string') {
    return input;
  }
  if (input && typeof input.href === 'string') {
    return input.href;
  }
  return '[unknown-url]';
}

function legacyFetch(input, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const requestUrl = typeof input === 'string' ? new URL(input) : input;
      const method = options.method || 'GET';
      const headers = options.headers || {};
      const body = options.body;
      const isHttps = requestUrl.protocol === 'https:';
      const transport = isHttps ? https : http;
      const requestOptions = {
        method,
        headers,
        hostname: requestUrl.hostname,
        port: requestUrl.port || (isHttps ? 443 : 80),
        path: `${requestUrl.pathname}${requestUrl.search}`
      };

      const req = transport.request(requestOptions, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const text = buffer.toString('utf8');
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode || 0,
            statusText: res.statusMessage || '',
            headers: res.headers,
            text: async () => text,
            json: async () => JSON.parse(text || 'null'),
            arrayBuffer: async () => buffer
          });
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      if (options.signal) {
        const { signal } = options;
        const abortHandler = () => {
          const abortError = new Error('The operation was aborted');
          abortError.name = ABORT_ERROR_NAME;
          req.destroy(abortError);
        };
        if (signal.aborted) {
          abortHandler();
          return;
        }
        signal.addEventListener('abort', abortHandler, { once: true });
        req.on('close', () => {
          signal.removeEventListener('abort', abortHandler);
        });
      }

      if (body !== undefined && body !== null) {
        if (Buffer.isBuffer(body) || typeof body === 'string') {
          req.write(body);
        } else if (body instanceof Uint8Array) {
          req.write(Buffer.from(body));
        } else {
          req.write(String(body));
        }
      }

      req.end();
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = {
  fetchWithTimeout,
  fetchJson,
  TIMEOUT_ERROR_NAME
};
