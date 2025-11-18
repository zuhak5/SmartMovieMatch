# Smart Movie Match – Feature TODO Index for Codex

This file is the **source of truth for feature work on `index.html` and the SPA**.
Each item is a task for Codex (or any other assistant) to implement.

## How to use this TODO list

- Each task is written as a Markdown checkbox: `- [ ] TASK-ID – short title`.
- When a task is implemented, Codex should:
  1. Change `[ ]` → `[x]`.
  2. Append a `DONE` line with timestamp and a short summary, e.g.:

     `DONE 2025-11-17T14:32Z – Implemented session-aware navbar using Supabase auth; added logout and profile menu.`

- If a task is partially complete, keep it as `[ ]` and add a `NOTE` line under it.

---

## Legend

- `AUTH-*`  – Authentication & session
- `PROF-*`  – Profiles & onboarding
- `SOC-*`   – Following, friends, social graph
- `SRCH-*`  – Search & discovery
- `LIST-*`  – Lists, tags, and favorites
- `STRM-*`  – Streaming providers & availability
- `DM-*`    – Direct messages & conversations
- `NOTIF-*` – Notifications & activity
- `CONF-*`  – App config & experiments
- `RLS-*`   – Supabase RLS & security
- `ANALYT-*`– Analytics, logging, and search telemetry

---

## Authentication & session (AUTH)

- [x] **AUTH-001 – Session-aware navbar and auth state**
  - Description: Replace the static notification/profile icons in `index.html` with session-aware UI using Supabase auth.
    - When logged out: show “Sign in / Sign up” CTA.
    - When logged in: show avatar, username, and a dropdown menu (Profile, Settings, Logout).
  - Files: `index.html`, `assets/js/spa-app.js` (or equivalent SPA entry).
  - Backend: `auth_users`, `auth_sessions`, `user_sessions`.
  - Notes for Codex: Use `supabase.auth.getUser()` (or current client API) to drive initial state and subscribe to auth changes.
  DONE 2025-11-17T03:11Z – Added session-aware header with Supabase-backed auth modal; avatar dropdown reflects live auth state and exposes profile/settings/logout actions.

- [x] **AUTH-002 – Real login/logout flows**
  - Description: Wire login and logout actions to Supabase auth instead of mock handlers.
    - Submit credentials to Supabase.
    - On success: store session token, refresh UI, redirect to main feed.
    - On logout: clear local session, navigate to logged-out landing state.
  - Files: `assets/js/spa-app.js`, any auth modal components, `index.html`.
  - Backend: `auth_users`, `auth_sessions`, RLS on user-owned data.
  DONE 2025-11-17T03:11Z – Added inline sign-in/sign-up modal backed by the auth API; successful auth persists Supabase sessions, refreshes SPA state, and logout clears stored tokens with UI reset.

- [x] **AUTH-003 – Enforce auth for protected views**
  - Description: Guard pages that require a logged-in user (feed, lists, watch parties).
    - If no active session, redirect to login or show an inline login prompt.
  - Files: SPA router / view-switcher, `assets/js/spa-app.js`.
  - Backend: Depends on Supabase RLS; rely on 401/403 to hide remote data if needed.

---

## Profiles & onboarding (PROF)

- [x] **PROF-001 – Dynamic profile header**
  - Description: Replace hardcoded profile details (name, handle, stats) with data from Supabase.
    - Use `auth_users` and `user_profiles` to populate display name, handle, avatar, location, and bio.
    - Show follower/following counts from `user_follows`.
  - Files: `index.html` profile section, `assets/js/spa-app.js`.
  - Backend: `auth_users`, `user_profiles`, `user_follows`.
  DONE 2025-11-17T03:32Z – Wired profile card to session data and live social overview counts; handles avatar initials, handle, bio/location fallbacks, and follower/following stats in the SPA.

- [x] **PROF-002 – Profile editing UI**
  - Description: Add an “Edit profile” panel where the user can update:
    - display name, bio, location, website, favorite genres/decades, profile visibility (`is_private`).
  - Files: Profile modal / panel components.
  - Backend: `user_profiles`, `auth_users.is_private`, RLS so only the owner can update.
  DONE 2025-11-17T03:38Z – Added profile editor overlay with editable bio, location, website, favorites, privacy toggle, and display name sync to auth.

- [x] **PROF-003 – Onboarding wizard**
  - Description: First-time users see a 2–3 step wizard:
    - Step 1: Choose preferred genres / decades → store in `user_profiles.favorite_genres` & `favorite_decades`.
    - Step 2: Pick streaming providers → store in `user_streaming_profiles`.
    - Step 3: Optional: import ratings or connect external services (stub).
  - Files: New onboarding view + routing, local storage flag to avoid showing after completion.
  - Backend: `user_profiles`, `user_streaming_profiles`, `import_jobs` (future).
  DONE 2025-11-17T04:28Z – Added a three-step onboarding overlay that syncs taste, streaming providers, and import intent to preferences with a per-user completion flag.

---

## Social graph: following, friends, requests (SOC)

- [x] **SOC-001 – Make follow/friend buttons functional**
  - Description: Replace static follow/friend UI with real actions:
    - “Follow” sends a follow request (or direct follow) using `user_follows`.
    - “Unfollow” / “Cancel request” updates/deletes the row.
  - Files: Friend cards in `index.html`, list rendering in SPA.
  - Backend: `user_follows` with RLS so users can only manage relationships they are part of.
  DONE 2025-11-17T07:13Z – Wired the Discover people tab to social follow suggestions with live follow/unfollow buttons updating Supabase-backed relationships.

- [x] **SOC-002 – Live follower/following counts**
  - Description: Pull follower/following counts from `user_follows` instead of fixed numbers in the profile header.
  - Files: Profile header render code.
  - Backend: `user_follows`.
  DONE 2025-11-17T07:39Z – Added Supabase-backed follow counts from `user_follows` so the profile header reflects live follower and following totals.

- [x] **SOC-003 – Friend feed based on social graph**
  - Description: Replace static friend feed items with recent reviews from people the user follows (`movie_reviews`).
  - Files: Home/feed view rendering.
  - Backend: `movie_reviews`, `user_follows`, visibility logic aligned with RLS.
  DONE 2025-11-17T07:57Z – Added Supabase-backed friend feed that surfaces reviews from followed users with privacy-aware filtering and a refreshed inline highlights UI.

---

## Search & discovery (SRCH)

- [x] **SRCH-001 – Wire search input to Supabase**
  - Description: Use the discover search input and filter pills to query Supabase instead of local mocks.
    - Text query → `movies` (title, original_title).
    - Filters → genres, year, streaming provider, etc.
  - Files: Search bar handler in SPA, cards list component.
  - Backend: `movies`, `movie_genres`, `genres`, `search_queries` for telemetry.
  DONE 2025-05-07T00:00Z – Routed discover search & filter pills through Supabase-backed movie results with trending/release ordering and normalized cards.

- [x] **SRCH-002 – Save search queries for analytics**
  - Description: On each search, insert a row into `search_queries`:
    - `username` (if logged in), `query`, `filters`, `results_count`, `client_context`.
  - Files: Search handler.
  - Backend: `search_queries` + RLS policies so users only see their own logs.
  DONE 2025-05-07T00:00Z – Added Supabase logging for discover searches (including filter metadata and session context) alongside SPA telemetry.

- [x] **SRCH-003 – “Trending now” powered by `trending_movies`**
  - Description: Replace hardcoded “trending” section with data pulled from `trending_movies` joined to `movies`.
    - Support at least one window, e.g. `time_window = 'weekly'`.
  - Files: Explore/discover section UI.
  - Backend: `trending_movies`, `movies`.
  DONE 2025-11-17T10:50Z – Added Discover “Trending now” row driven by Supabase `trending_movies` with weekly/daily/monthly window selector, server API join to `movies`, and public RLS-backed schema entries.

---



## Lists, favorites, and tags (LIST)

- [x] **LIST-001 – User-defined lists**
  - Description: Make custom lists functional with Supabase:
    - Create/update/delete lists in `user_lists` (including `kind`, `is_collaborative`).
    - Add/remove movies via `user_list_items`.
  - Files: Lists sidebar, list detail view.
  - Backend: `user_lists`, `user_list_items`.
  DONE 2025-11-17T11:51Z – Added Supabase-backed list creation, editing, deletion, and item saves/removals from search with live library list UI.

- [x] **LIST-002 – Favorites / “heart” button backed by DB**
  - Description: Hook the favorite/heart icon on movie cards to `user_favorites`.
    - Clicking toggles a row in `user_favorites`.
    - Optionally store extras in `metadata` (e.g., why it was favorited).
  - Files: Card component, detail page button.
  - Backend: `user_favorites`.
  DONE 2025-05-07T00:00Z – Added favorite toggles on trending cards with session-backed sync and a library favorites panel.

- [x] **LIST-003 – Personal tags per user**
  - Description: Allow users to create personal tags and tag movies.
    - Manage tag definitions via `user_tags`.
    - Attach tags to movies via `user_tagged_movies`.
  - Files: Tag editor UI on movie detail page, filter chips in list views.
  - Backend: `user_tags`, `user_tagged_movies`.
  DONE 2025-11-17T14:45Z – Added tag editor overlay on movie details with personal tag creation, assignment, and list-level tag filters driven by user tag metadata.

---

## Streaming providers & availability (STRM)

- [x] **STRM-001 – Streaming provider registry in UI**
  - Description: Display provider badges on movie cards using `streaming_providers` and `movie_availability`.
  - Files: Movie card component, filters UI.
  - Backend: `streaming_providers`, `movie_availability`.
  DONE 2025-11-18T00:00Z – Added streaming provider registry with availability badges on discover and trending cards backed by Supabase availability rows.

- [x] **STRM-002 – “Where I can watch” filter**
  - Description: Add filters (and onboarding step) for the user’s subscribed services.
    - Store user choices in `user_streaming_profiles`.
    - Filter discovery results to those providers.
  - Files: Onboarding, filter panel in search/discover view.
  - Backend: `user_streaming_profiles`, `movie_availability`.
  DONE 2025-11-18T00:00Z – Added onboarding-backed provider sync to user streaming profiles plus a “Where I can watch” discover filter powered by the user’s saved providers.

---


    - Fields: title, description, scheduled time, visibility (public/friends/invite-only).
    - Save to `watch_parties`.
  - Backend: `watch_parties` with RLS for host ownership.

  DONE 2025-11-17T08:26Z – Added join action plus presence-aware participant roster for watch parties, syncing host and attendee presence with the invite lobby.

    - Visible only to hosts and participants as enforced by RLS.

---

## Direct messages & conversations (DM)

- [x] **DM-001 – Conversation list UI**
  - Description: Add a “Messages” section with a list of conversations:
    - Data from `user_conversations` joined with `user_conversation_members`.
    - Show last message preview and `last_message_at`.
  - Files: Messages sidebar / drawer.
  - Backend: `user_conversations`, `user_conversation_members`.
  DONE 2025-11-17T09:20Z – Added a Messages inbox with Supabase-backed conversations, participant context, and last-message previews.

- [x] **DM-002 – Conversation detail & sending messages**
  - Description: Implement a conversation view:
    - List messages from `user_messages`.
    - Allow sending new messages, writing to `user_messages`.
  - Files: Conversation page or modal.
  - Backend: `user_messages`, `user_conversation_members`.
  DONE 2025-11-17T09:45Z – Added inbox thread view with live message history and sending powered by conversation membership checks.

- [x] **DM-003 – Start conversation from profile**
  - Description: Add a “Message” button on user profiles.
    - Creates or reuses a 1:1 `user_conversations` row and opens it.
  - Files: Profile header, quick action section.
  - Backend: `user_conversations`, `user_conversation_members`.
  DONE 2025-11-17T09:56Z – Added profile message CTA and people-list action that start or reuse 1:1 chats then open the inbox with the conversation preloaded.

---

## Notifications & activity (NOTIF)

- [x] **NOTIF-001 – Notification dropdown wired to DB**
  - Description: Replace static notification icon/menu with data from `user_notifications`.
    - Show unread count badge.
    - Mark notifications as read on click (update `is_read`, `read_at`).
  - Files: Navbar notification bell/menu.
  - Backend: `user_notifications`.
  DONE 2025-11-17T10:03Z – Added Supabase-backed notification bell with unread badge, dropdown list, click-to-mark-read and mark-all controls wired to the social API stream.

- [x] **NOTIF-002 – Activity log for user actions**
  - Description: Log key SPA actions to `user_activity` (e.g. follow, review, list update).
    - Use metadata to capture context (movie id, source action).
  - Files: Centralized logging helper in SPA.
  - Backend: `user_activity`.
  DONE 2025-11-17T10:24Z – Added telemetry API and SPA logging helper that records follows, reviews, and discovery searches into `user_activity` with contextual metadata.

---

## App config & experiments (CONF)

- [x] **CONF-001 – Remote app config wiring**
  - Description: Fetch `app_config` on app startup to control:
    - UI limits (max items per list), feature flags (enable watch parties, DMs).
  - Files: App bootstrap, config context/provider.
  - Backend: `app_config`.
  DONE 2025-11-17T10:24Z – Added config endpoint plus SPA provider to load `app_config` on startup, applying feature flags and list limits across discovery and home views.

- [x] **CONF-002 – Experiments & variants**
  - Description: Use `experiments` + `experiment_assignments` to:
    - Decide which layout or algorithm to use per user.
  - Files: Feature-flag helper, experiment switch points (e.g. home page layout).
  - Backend: `experiments`, `experiment_assignments`.
  DONE 2025-11-17T10:24Z – SPA now fetches experiment assignments from Supabase and switches the home recommendations layout based on the `home_recs_layout` variant.

---

## RLS, security & Supabase integration (RLS / ANALYT)

- [x] **RLS-001 – Confirm frontend respects RLS boundaries**
  - Description: For all data fetching, ensure:
    - Only use `select/insert/update/delete` on tables where RLS rules are defined for client.
    - Treat 401/403 responses as “not allowed” and hide the corresponding UI safely.
  - Files: Supabase client wrapper, data hooks/services.
  - Backend: All RLS-protected tables (reviews, lists, parties, DMs, etc.).
  DONE 2025-11-17T10:59Z – Added authorization-aware social API errors that clear protected state, stop polling/streams, and surface clear access messaging instead of leaking restricted UI.

- [x] **RLS-002 – Anonymous vs authenticated access**
  - Description: Ensure public-only views (e.g. movie catalog, basic discovery) use:
    - Public policies on `movies`, `streaming_providers`, `experiments`, etc.
    - Authenticated views use the user token to access private tables.
  - Files: Data access layer.
  - Backend: `movies`, `streaming_providers`, `experiments`, `app_config`, etc.
  DONE 2025-11-17T10:59Z – Hardened config fetching to fall back to public defaults when unauthenticated and require a bearer token for personalized experiments.

- [x] **ANALYT-001 – Central telemetry helper**
  - Description: Create a small SPA module that:
    - Logs search, click, and view events into `search_queries`, `recommendation_events`, and `user_activity` as appropriate.
  - Files: `analytics.js` (or equivalent), called from UI components.
  - Backend: `search_queries`, `recommendation_events`, `user_activity`.
  DONE 2025-11-17T10:24Z – Added `analytics.js` telemetry helper and server endpoint to persist search and recommendation events (stored in `user_activity` until `recommendation_events` exists) plus contextual metadata.

---

## Supabase schema → upcoming features mapping (reference)

> NOTE: This is a **reference section**, not a checklist.  
> The tasks above already cover how these tables should be used.  
> Keep this section to help future contributors map schema → features.

(This section intentionally mirrors the mapping you already added earlier; it
can be kept as-is, or replaced with the more detailed mapping in your schema
file if you prefer to avoid duplication.)
