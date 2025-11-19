# Smart Movie Match

## Changelog – Discover Module Enhancements (2025-11-19)

- Added first-result dropdown previews for Movies and Series in Discover.
- Implemented People dropdown sourced from Supabase social search with avatars and usernames.
- “Show more results” button routes to the corresponding Discover tab and loads full results.
- Search bar is now sticky across scroll; dynamic placeholder reflects active tab (Movies/Series/People).
- Optimized TMDB calls with `limitOverride` for efficient single-result dropdown queries.
- Added robust abort/timeout handling and user-friendly dropdown loading/error states.
- Introduced accessible attributes (`aria-controls`, `aria-expanded`, `role=listbox/option`).

### Configuration

- Ensure environment variables for TMDB and Supabase are set as documented in `api/apikey.sql`.
  - `TMDB_API_KEY`, `TMDB_API_READ_ACCESS_TOKEN`
  - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (for server-side social endpoints)

### Usage

- Type 2+ characters in the Discover search bar to see a preview.
- Click “Show more results” to open full results within the Discover tab.
- Switch tabs to change search scope; the input placeholder updates accordingly.

### Testing & QA

- Verified debounce and abort behavior for responsive, race-free updates.
- Cross-browser visual QA on sticky positioning and dropdown layering.
- Recommended next steps: add unit tests with Vitest for query builders and dropdown rendering.