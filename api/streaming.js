const { createSupabaseAdminClient } = require('../lib/supabase-admin');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USING_LOCAL_STORE = !(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

const FALLBACK_PROVIDERS = [
  { key: 'netflix', displayName: 'Netflix', url: 'https://www.netflix.com', metadata: {} },
  { key: 'prime-video', displayName: 'Prime Video', url: 'https://www.primevideo.com', metadata: {} },
  { key: 'disney-plus', displayName: 'Disney+', url: 'https://www.disneyplus.com', metadata: {} },
  { key: 'max', displayName: 'Max', url: 'https://www.max.com', metadata: {} },
  { key: 'hulu', displayName: 'Hulu', url: 'https://www.hulu.com', metadata: {} },
  { key: 'apple-tv', displayName: 'Apple TV+', url: 'https://tv.apple.com', metadata: {} },
  { key: 'peacock', displayName: 'Peacock', url: 'https://www.peacocktv.com', metadata: {} },
  { key: 'paramount-plus', displayName: 'Paramount+', url: 'https://www.paramountplus.com', metadata: {} }
];

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (USING_LOCAL_STORE) {
    res.status(200).json({ providers: FALLBACK_PROVIDERS, userProviders: [] });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  try {
    const client = createSupabaseAdminClient({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY });
    const username = token ? await resolveUsername(client, token) : null;
    const [providers, userProviders] = await Promise.all([
      fetchProviders(client),
      username ? fetchUserProviders(client, username) : []
    ]);

    res.status(200).json({ providers, userProviders });
  } catch (error) {
    console.error('streaming endpoint failed', error);
    res.status(500).json({ error: 'Unable to load streaming providers.' });
  }
};

async function fetchProviders(client) {
  const rows = await client.select('streaming_providers', {
    columns: 'key,display_name,url,metadata',
    limit: 100
  });
  return Array.isArray(rows) ? rows.map(mapProviderRow) : [];
}

async function fetchUserProviders(client, username) {
  if (!username) return [];
  const rows = await client.select('user_streaming_profiles', {
    columns: 'provider_key',
    filters: { username }
  });
  const keys = Array.isArray(rows)
    ? rows.map((row) => row && row.provider_key).filter(Boolean)
    : [];
  return Array.from(new Set(keys));
}

function mapProviderRow(row = {}) {
  return {
    key: row.key || '',
    displayName: row.display_name || row.key || 'Streaming provider',
    url: row.url || null,
    metadata: row.metadata || {}
  };
}

async function resolveUsername(client, token) {
  if (!token) return null;
  try {
    const rows = await client.select('auth_sessions', {
      columns: 'username',
      filters: { token },
      limit: 1
    });
    if (Array.isArray(rows) && rows.length) {
      const row = rows[0];
      return row && row.username ? row.username : null;
    }
    return null;
  } catch (error) {
    return null;
  }
}
