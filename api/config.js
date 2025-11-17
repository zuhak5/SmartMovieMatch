const fs = require('fs/promises');
const path = require('path');
const { createSupabaseAdminClient } = require('../lib/supabase-admin');

const AUTH_STORE_PATH = path.join(__dirname, '..', 'data', 'auth-users.json');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USING_LOCAL_STORE = !(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

const DEFAULT_CONFIG = {
  'ui.home.maxRecommendations': 10,
  'ui.home.groupPicks': 3,
  'ui.discover.maxMovies': 12,
  'ui.discover.maxPeople': 6,
  'feature.watchParties.enabled': true,
  'feature.messages.enabled': true,
  'feature.notifications.enabled': true
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let username = null;
  try {
    const token = extractToken(req);
    username = token ? await resolveUsername(token) : null;
  } catch (error) {
    // Treat auth failures as anonymous access for config fetching.
    username = null;
  }

  const config = await loadAppConfig();
  const experiments = await loadExperiments(username);

  res.status(200).json({ config, experiments });
};

async function loadAppConfig() {
  if (USING_LOCAL_STORE) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const client = createSupabaseAdminClient({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY });
    const rows = await client.select('app_config', { columns: 'key,value' });
    const mapped = rows.reduce((acc, row) => {
      if (!row || !row.key) {
        return acc;
      }
      acc[row.key] = row.value;
      return acc;
    }, {});
    return { ...DEFAULT_CONFIG, ...mapped };
  } catch (error) {
    console.warn('Failed to load app_config; using defaults.', error);
    return { ...DEFAULT_CONFIG };
  }
}

async function loadExperiments(username) {
  const base = { experiments: [], assignments: {} };
  if (!username && USING_LOCAL_STORE) {
    return base;
  }

  if (USING_LOCAL_STORE) {
    return base;
  }

  try {
    const client = createSupabaseAdminClient({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY });
    const experiments = await client.select('experiments', {
      columns: 'key, description, is_enabled, config'
    });
    const filtered = experiments.filter((exp) => exp && exp.is_enabled !== false);
    let assignments = {};
    if (username) {
      const rows = await client.select('experiment_assignments', {
        columns: 'experiment_key, variant',
        filters: { username }
      });
      assignments = rows.reduce((acc, row) => {
        if (row && row.experiment_key && row.variant) {
          acc[row.experiment_key] = row.variant;
        }
        return acc;
      }, {});
    }
    return { experiments: filtered, assignments };
  } catch (error) {
    console.warn('Failed to load experiments; returning empty set.', error);
    return base;
  }
}

async function resolveUsername(token) {
  if (!token) {
    return null;
  }

  if (USING_LOCAL_STORE) {
    try {
      const text = await fs.readFile(AUTH_STORE_PATH, 'utf8');
      const parsed = JSON.parse(text);
      const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
      const sessionRow = sessions.find((session) => session && session.token === token);
      return sessionRow ? sessionRow.username || null : null;
    } catch (error) {
      return null;
    }
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

function extractToken(req) {
  if (!req || !req.headers) {
    return null;
  }
  const header = req.headers.authorization || req.headers.Authorization || '';
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  return null;
}
