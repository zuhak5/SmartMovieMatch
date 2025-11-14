- Document the API-related environment variables required by SmartMovieMatch.
- Running this script will simply list the key names alongside the code paths that consume them, making it easy to audit usage without touching any database tables.
WITH apikey_usage(key_name, used_in, purpose) AS (
  VALUES
    ('OMDB_API_KEY', 'api/omdb.js', 'Proxy requests to the OMDb API for movie metadata.'),
    ('TMDB_API_READ_ACCESS_TOKEN', 'api/tmdb.js', 'Proxy requests to The Movie Database for discovery and search.'),
    ('YOUTUBE_API_KEY', 'api/youtube.js', 'Proxy requests to the YouTube Data API for trailer lookups.'),
    ('SUPABASE_URL', 'api/auth.js, api/social.js, scripts/test-supabase.js', 'Access Supabase REST endpoints for auth and social actions.'),
    ('SUPABASE_SERVICE_ROLE_KEY', 'api/auth.js, api/social.js, lib/supabaseServer.ts, scripts/test-supabase.js', 'Perform privileged Supabase operations (auth, social service).')
)
SELECT * FROM apikey_usage;
