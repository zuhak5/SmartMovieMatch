# index.html feature activation audit

## Overview
This audit walks through `index.html` and the connected SPA script to highlight UI features that are currently static or missing the logic needed to activate them. Each item notes where the UI appears and what wiring would be required to make it functional.

## Authentication
- The top bar only shows notification and profile icons; there are no sign-up, login, or logout entry points, and no authentication modals or routes are referenced in the SPA script. Add visible authentication controls plus handlers that integrate with the chosen auth backend (e.g., Supabase session checks, login/signup forms, and logout).【F:index.html†L15-L27】【F:assets/js/spa-app.js†L489-L518】
- Profile details (name, handle, stats) are hardcoded. Replace these placeholders with data from the authenticated user and guard the profile view when no session is present.【F:index.html†L275-L350】

## Following, friends, and requests
- Friend feed items and request cards render static people; buttons such as “Accept,” “Ignore,” “Join,” and “View” do not have event bindings. Implement handlers to send follow/accept/decline actions to the backend, update local UI state, and refresh counts after completion.【F:index.html†L61-L124】【F:assets/js/spa-app.js†L489-L518】
- Follower/following counts in the profile overview are fixed numbers with no follow/unfollow controls. Add follow buttons on user cards and hook the counters to live data from the social graph service.【F:index.html†L285-L320】

## Search and discovery
- The discover search input and filter pills are already wired to TMDB queries through `spa-app.js`, providing movie, people, and list rendering. Ensure API keys and rate limits are configured for production and consider adding empty-state guidance when third-party calls fail.【F:index.html†L134-L158】【F:assets/js/spa-app.js†L233-L487】
- Search results currently generate derived list cards locally; if curated lists should be persisted or shareable, add endpoints to fetch and store list data instead of building them from search results only.【F:assets/js/spa-app.js†L281-L333】

## Notifications and invites
- The notification bell in the top bar is a static icon with no dropdown, badge count, or fetch logic. Add a notifications panel plus polling or server-push wiring to load alerts and mark them read.【F:index.html†L23-L27】【F:assets/js/spa-app.js†L489-L518】
- Watch-party invites and other alerts in the Friends section are static cards; accepting or joining does not trigger any workflow. Connect these buttons to invitation APIs and update the UI after the action completes.【F:index.html†L100-L124】

## Watchlist, lists, and diary actions
- Watchlist items show “Mark watched” buttons that have no click handling. Add persistence to mark titles watched and refresh the watchlist view when toggled.【F:index.html†L223-L246】
- The “+ Create new list” control is purely presentational. Attach it to a list-creation flow (modal/form) and update the lists panel with the new entry on success.【F:index.html†L247-L271】
- Diary rows and list collages are hardcoded; integrate them with actual diary/list data tied to the signed-in user to keep them current.【F:index.html†L247-L350】

## Miscellaneous interactive gaps
- The “Start watch party” CTA and “Add friend” pill in the Home section have no behavior. Wire these to real watch-party creation and friend-invite flows, updating the group picks list when participants change.【F:index.html†L186-L208】
- Profile “Edit profile” and “Share profile” buttons are non-functional; connect them to editing dialogs and share links tied to the user’s handle or ID.【F:index.html†L281-L320】

## Additional enhancement opportunities
- The Home and Library sort dropdowns are static UI only. Connect them to real sorting/filtering of watchlist items and recommendations so users can quickly re-order content by recency, release date, or name.【F:index.html†L200-L221】
- Personalization is session-randomized via an in-memory seed and generic request parameters. Persist per-user recommendation seeds and allow tastes/genres to influence `discoverCandidateMovies` inputs so the “Tonight’s Pick,” home carousel, and group picks reflect individual profiles instead of changing on every reload.【F:assets/js/spa-app.js†L17-L27】【F:assets/js/spa-app.js†L302-L327】
- Network failures in discovery and search are silently swallowed or shown as empty states. Add visible error toasts, retry controls, and skeleton loaders across discover filters and search so users understand when TMDB calls fail rather than seeing blank grids.【F:assets/js/spa-app.js†L233-L279】【F:assets/js/spa-app.js†L472-L487】
- Navigation, tab, and search state resets on each page load. Cache the last active section/tab and the last successful search query in local storage (or user settings) during `init()` to restore context when a user returns.【F:assets/js/spa-app.js†L9-L27】【F:assets/js/spa-app.js†L521-L527】

## Insights from `assets/js`
- A richer SPA already lives in `assets/js/main.js`, wiring authentication, social graph actions, notifications, collaborative lists, and watch parties; however, `index.html` only loads the lightweight `spa-app.js`, leaving these capabilities idle. Port the necessary DOM and switch the entry script (or adapt `spa-app.js`) so the existing full-featured controllers run on the homepage instead of remaining unused.【F:index.html†L379-L379】【F:assets/js/main.js†L1-L46】【F:assets/js/main.js†L994-L1058】
- Full auth/session management exists in `assets/js/auth.js` (register/login/logout, profile updates, sync of preferences/watched/favorites), but no sign-in UI or handlers are present on `index.html`. Hook the top bar/account areas to these methods or embed the standalone auth page flows so sign-up/login/logout become real rather than static icons.【F:assets/js/auth.js†L23-L120】【F:assets/js/auth.js†L200-L280】
- Social features—follow/unfollow, notifications, presence, collaborative lists, and watch-party scheduling—are already implemented in `assets/js/social.js` and initialized from `main.js`, yet no UI in `index.html` calls them. Add data attributes and handlers that call these APIs so buttons like “Add friend,” request cards, and notification bells reflect real backend state.【F:assets/js/social.js†L4-L120】【F:assets/js/social.js†L248-L308】【F:assets/js/main.js†L994-L1058】

## Insights from `/api`, `/data`, `/lib`, `/pages/api`, and Supabase schema
- The Node auth API (`/api/auth.js`) already supports signup/login/session, preference syncing, watched/favorites syncing, profile updates, password resets, and avatar uploads with Supabase Storage; when Supabase env vars are missing it silently falls back to local JSON storage. Wire `index.html` auth UI to these endpoints and ensure production uses the Supabase-backed path instead of the empty local store.【F:api/auth.js†L1-L97】【F:api/auth.js†L225-L314】
- The social API (`/api/social.js`) exposes live notifications/streaming plus follow/unfollow/block, reviews with reactions/comments, user search, collaborative lists, watch-party scheduling, and presence updates—yet `index.html` never calls it. Hook friend buttons, review UI, and notification bell to these actions so server responses drive the UI instead of static cards.【F:api/social.js†L1-L129】【F:api/social.js†L147-L231】
- `data/auth-users.json` and `data/social.json` are empty seed stores used when Supabase is absent; until real services are wired, auth, follows, reviews, notifications, and watch parties will always return empty results. Populate via Supabase or provide seed data so UI state persists across reloads.【F:data/auth-users.json†L1-L4】【F:data/social.json†L1-L11】
- The Next.js `/pages/api/signup.ts` route inserts new users and avatars into Supabase tables/storage using server credentials. If `index.html` keeps the static form, mirror its submission to this endpoint (or consolidate with `/api/auth.js`) so signup actually creates users and sessions instead of being a no-op.【F:pages/api/signup.ts†L1-L87】
- Supabase helpers in `/lib/supabaseServer.ts` require `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; without them server operations warn/fail. Validate env setup in deployments so avatar uploads and table writes succeed.【F:lib/supabaseServer.ts†L1-L10】
- The Supabase schema defines rich tables for follows, notifications, reviews/likes/comments, collaborative lists, watch diary entries, favorites, and activity streams. Map each dormant UI control (follow buttons, watch diary rows, notifications badge, collaborative lists) to these tables so user actions persist server-side instead of being static placeholders.【F:supabase/migrations/supabase_tables_schema.sql†L1-L92】【F:supabase/migrations/supabase_tables_schema.sql†L165-L241】

## Final gap sweep and enhancement ideas
- Social-login buttons on the dedicated auth page still show “coming soon.” Implement provider-backed sign-in (or hide these options) so onboarding flows don’t dead-end for users expecting Google/Apple/etc. paths, and reuse the same handling for any auth entry points added to `index.html`.【F:assets/js/auth-page.js†L259-L337】
- TMDB is the only discovery source currently wired into `index.html`, but backend proxies already exist for OMDb metadata and YouTube trailers with caching and timeout handling. Add these providers to improve fallback robustness (e.g., ratings/plots when TMDB fails) and to surface trailers on title detail views, while ensuring the required API keys are configured.【F:api/omdb.js†L1-L105】【F:api/youtube.js†L1-L83】
- Supabase exposes `user_activity` and review/comment tables that could power an activity feed or richer review threads, yet `index.html` lacks any surface for them. Add an activity/review module to the Home or Profile sections to highlight new follows, diary logs, reviews, and comments so the social graph feels alive instead of static cards.【F:supabase/migrations/supabase_tables_schema.sql†L29-L157】
