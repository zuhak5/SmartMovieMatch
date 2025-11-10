# Smart Movie Match

Smart Movie Match is a client-first movie recommendation assistant. It lets people describe what they like, pick genres and a preferred mood, and then generates a curated batch of films with trailers and IMDb data. The app stores your "watched" history locally so suggestions improve over time, and (when you log in) syncs preferences to Supabase so your account travels with you.

## Features

- **Taste-aware recommendations** – combines TMDB discovery/search and OMDb enrichment to surface relevant titles.
- **YouTube trailer lookup** – grabs the top trailer for each pick or links to a search if none are embedded.
- **Cloud-synced library** – stores watched history and favorites in Supabase so your data travels with you.
- **Accessible UI** – responsive layout with skeleton states and clear status messaging.

## Getting started

### Prerequisites

1. [Node.js 18+](https://nodejs.org/) (needed for running the API proxies locally).
2. A [Supabase](https://supabase.com/) project for storing accounts. See [Supabase setup](#supabase-setup) for the schema definition.
3. API keys for the external services:
   - [OMDb API](https://www.omdbapi.com/apikey.aspx) → `OMDB_API_KEY`
   - [The Movie Database (TMDB)](https://www.themoviedb.org/settings/api) → `TMDB_API_KEY`
   - [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com) → `YOUTUBE_API_KEY`

### Local development

Install dependencies and start the bundled Node server:

```bash
npm install
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm start
```

The server serves the static UI and exposes the authentication endpoint at `http://localhost:3000/api/auth`. All API proxy logic still lives under `api/`, so if you deploy somewhere other than this Node server make sure the environment variables remain available.

### Building for production

The site is static, so deploying the repository to Vercel (or any provider with equivalent serverless support) is typically enough. Just remember to configure the environment variables before deploying.

## Project structure

```
├── api/                  # Serverless proxy functions that keep API keys on the server
├── assets/
│   ├── css/app.css       # Global styles
│   └── js/               # ES modules for state, APIs, UI, and recommendation logic
└── index.html            # Application shell that wires in the modules
```

Key modules:

- `assets/js/recommendations.js` – orchestrates TMDB discovery/search, OMDb enrichment, trailer lookups, and scoring logic.
- `assets/js/ui.js` – renders UI components, skeleton states, and watched history widgets.
- `assets/js/auth.js` – manages Supabase-backed authentication and data sync.
- `assets/js/main.js` – entry point that wires events, loads state, and kicks off recommendation requests.

## Environment variables

| Variable          | Description                                             |
| ----------------- | ------------------------------------------------------- |
| `OMDB_API_KEY`    | OMDb API key used by the `/api/omdb` proxy.             |
| `TMDB_API_KEY`    | TMDB API key used by the `/api/tmdb` proxy.             |
| `YOUTUBE_API_KEY` | YouTube Data API key used by the `/api/youtube` proxy.  |
| `SUPABASE_URL`    | Supabase project URL used for remote auth persistence.  |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key used by the auth API. |

### Supabase setup

Create the following tables inside your Supabase project (SQL editor → `public` schema):

```sql
create table if not exists public.auth_users (
  username text primary key,
  display_name text not null,
  password_hash text not null,
  salt text not null,
  created_at timestamptz not null,
  last_login_at timestamptz,
  last_preferences_sync timestamptz,
  last_watched_sync timestamptz,
  last_favorites_sync timestamptz,
  preferences_snapshot jsonb,
  watched_history jsonb default '[]'::jsonb,
  favorites_list jsonb default '[]'::jsonb
);

create table if not exists public.auth_sessions (
  token text primary key,
  username text not null references public.auth_users(username) on delete cascade,
  created_at timestamptz not null,
  last_active_at timestamptz not null,
  last_preferences_sync timestamptz,
  last_watched_sync timestamptz,
  last_favorites_sync timestamptz
);
```

Enable Row-Level Security (RLS) on both tables and create policies that allow the service role key to read/write. Because the server uses the service role key, it can manage rows on behalf of users while the public `anon` key stays restricted for client-side use (if needed).

## Contributing

Issues and pull requests are welcome. Please describe any significant changes, and where possible include reproduction steps for bug reports.
