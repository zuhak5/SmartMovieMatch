const http = require('http');
const https = require('https');

class SupabaseRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'SupabaseRequestError';
    this.status = status;
  }
}

class SupabaseAdminClient {
  constructor({ url, serviceRoleKey }) {
    if (!url || !serviceRoleKey) {
      throw new Error('Supabase URL and service role key are required');
    }
    this.baseUrl = url.replace(/\/+$/, '');
    this.serviceRoleKey = serviceRoleKey;
  }

  async select(table, { columns = '*', filters = {}, limit } = {}) {
    const query = new URLSearchParams();
    query.set('select', columns);
    if (typeof limit === 'number') {
      query.set('limit', String(limit));
    }
    const data = await this.request('GET', table, { query, filters });
    return Array.isArray(data) ? data : [];
  }

  async selectSingle(table, columns, filters = {}) {
    const rows = await this.select(table, { columns, filters, limit: 1 });
    return rows.length > 0 ? rows[0] : null;
  }

  async insert(table, values) {
    const payload = Array.isArray(values) ? values : values || {};
    await this.request('POST', table, {
      body: payload,
      prefer: 'return=representation'
    });
  }

  async update(table, values, filters = {}) {
    if (!values || typeof values !== 'object') {
      throw new Error('Update payload must be an object');
    }
    await this.request('PATCH', table, {
      body: values,
      filters,
      prefer: 'return=representation'
    });
  }

  async delete(table, filters = {}) {
    await this.request('DELETE', table, {
      filters,
      prefer: 'return=minimal'
    });
  }

  async request(method, table, { query, filters = {}, body, prefer } = {}) {
    const url = new URL(`${this.baseUrl}/rest/v1/${table}`);
    if (query instanceof URLSearchParams) {
      for (const [key, value] of query.entries()) {
        url.searchParams.append(key, value);
      }
    } else if (query && typeof query === 'object') {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.append(key, value);
      }
    }

    this.applyFilters(url.searchParams, filters);

    const headers = {
      apikey: this.serviceRoleKey,
      Authorization: `Bearer ${this.serviceRoleKey}`,
      Accept: 'application/json'
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (prefer) {
      headers.Prefer = prefer;
    }

    let result;
    try {
      result = await performRequest(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    } catch (error) {
      throw new SupabaseRequestError(503, error.message || 'Unable to reach Supabase');
    }

    const { status, ok, text } = result;

    if (!ok) {
      let message = text;
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
          message = parsed.message || parsed.error || text;
        }
      } catch (error) {
        // Ignore JSON parse errors and fall back to raw text.
      }
      throw new SupabaseRequestError(status, message || 'Supabase request failed');
    }

    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      return null;
    }
  }

  applyFilters(searchParams, filters = {}) {
    if (!filters || typeof filters !== 'object') {
      return;
    }
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined) {
        continue;
      }
      if (value === null) {
        searchParams.append(key, 'is.null');
      } else {
        searchParams.append(key, `eq.${value}`);
      }
    }
  }
}

function createSupabaseAdminClient(options) {
  return new SupabaseAdminClient(options);
}

function performRequest(url, options = {}) {
  if (typeof fetch === 'function') {
    return nodeFetch(url, options);
  }
  return legacyRequest(url, options);
}

async function nodeFetch(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    text
  };
}

function legacyRequest(url, options = {}) {
  const target = typeof url === 'string' ? new URL(url) : url;
  const isHttps = target.protocol === 'https:';
  const transport = isHttps ? https : http;

  const requestOptions = {
    method: options.method || 'GET',
    headers: options.headers || {},
    hostname: target.hostname,
    port: target.port || (isHttps ? 443 : 80),
    path: `${target.pathname}${target.search}`
  };

  return new Promise((resolve, reject) => {
    const req = transport.request(requestOptions, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode || 0,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          text
        });
      });
    });

    req.on('error', (error) => reject(error));

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

module.exports = {
  createSupabaseAdminClient,
  SupabaseRequestError
};
