const { createSupabaseAdminClient } = require('../lib/supabase-admin');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TELEMETRY_SERVICE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!TELEMETRY_SERVICE_CONFIGURED) {
    res.status(503).json({ error: 'Telemetry service is not configured' });
    return;
  }

  let payload = await readBody(req);
  if (!payload || typeof payload !== 'object') {
    payload = {};
  }

  const eventType = typeof payload.event === 'string' ? payload.event.trim() : '';
  if (!eventType) {
    res.status(400).json({ error: 'Missing event type' });
    return;
  }

  const token = extractToken(req, payload);
  const username = await resolveUsername(token);

  try {
    switch (eventType) {
      case 'search':
        await logSearchEvent({ username, payload });
        break;
      case 'recommendation':
        await logRecommendationEvent({ username, payload });
        break;
      case 'activity':
        await logUserActivity({ username, payload });
        break;
      default:
        res.status(400).json({ error: 'Unsupported event type' });
        return;
    }
  } catch (error) {
    console.error('Failed to persist telemetry', error);
    res.status(500).json({ error: 'Unable to record telemetry right now.' });
    return;
  }

  res.status(200).json({ ok: true });
};

async function logSearchEvent({ username, payload }) {
  const query = typeof payload.query === 'string' ? payload.query.trim() : '';
  if (!query) {
    return;
  }
  const filters = payload.filters && typeof payload.filters === 'object' ? payload.filters : {};
  const resultsCount = Number.isFinite(payload.resultsCount) ? Number(payload.resultsCount) : null;
  const clientContext = payload.clientContext && typeof payload.clientContext === 'object'
    ? payload.clientContext
    : {};

  const client = createSupabaseAdminClient({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY });
  await client.insert('search_queries', [{
    username: username || null,
    query,
    filters,
    results_count: resultsCount,
    client_context: clientContext
  }]);
}

async function logRecommendationEvent({ username, payload }) {
  if (!username) {
    return;
  }
  const action = typeof payload.action === 'string' ? payload.action.trim() : '';
  if (!action) {
    return;
  }
  const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};

  await logUserActivity({
    username,
    payload: {
      verb: 'recommendation_event',
      object_type: metadata.object_type || 'recommendation',
      metadata: { ...metadata, action }
    }
  });
}

async function logUserActivity({ username, payload }) {
  if (!username) {
    return;
  }
  const verb = typeof payload.verb === 'string' ? payload.verb.trim() : '';
  const objectType = typeof payload.object_type === 'string' ? payload.object_type.trim() : '';
  if (!verb || !objectType) {
    return;
  }
  const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};

  const client = createSupabaseAdminClient({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY });
  await client.insert('user_activity', [{
    username,
    verb,
    object_type: objectType,
    metadata
  }]);
}

async function resolveUsername(token) {
  if (!token || !TELEMETRY_SERVICE_CONFIGURED) {
    return null;
  }

  try {
    const client = createSupabaseAdminClient({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY });
    const rows = await client.select('auth_sessions', {
      columns: 'username',
      filters: { token },
      limit: 1
    });
    if (!Array.isArray(rows) || !rows.length) {
      return null;
    }
    const row = rows[0];
    return row && row.username ? row.username : null;
  } catch (error) {
    return null;
  }
}

async function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        resolve({});
      }
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function extractToken(req, payload) {
  if (payload && typeof payload.token === 'string') {
    return payload.token;
  }
  if (!req || !req.headers) {
    return null;
  }
  const header = req.headers.authorization || req.headers.Authorization || '';
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  return null;
}
