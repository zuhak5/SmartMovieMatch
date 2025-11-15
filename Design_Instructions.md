You are Codex, an AI coding assistant working inside the SmartMovieMatch repo.

Your job:
- Redesign and implement SmartMovieMatch’s **web UI from scratch**, guided by this spec.
- Keep the existing backend/API logic working (Supabase, TMDB/OMDb/YouTube, social features).
- Make the app feel like a modern, mobile-first, cinematic movie social app (similar in spirit to Letterboxd / Trakt mobile): **dark, poster-first, bottom navigation, top tabs**, and strong social features.

Use these instructions every time you work on this project.

==================================================
0. CONTEXT: WHAT SMARTMOVIEMATCH IS
==================================================

SmartMovieMatch is a **taste-aware movie assistant + social layer**:

Core capabilities:
- Taste-aware recommendations using TMDB discovery/search + OMDb enrichment.
- YouTube trailer lookup for each movie.
- Cloud-synced library (Supabase): watched history, favorites, ratings, lists.
- Social features: profiles, lists (including collaborative lists), reviews, comments, activity feed, watch parties, presence, notifications.

Your redesign must:
- Preserve all functional behaviors already wired up in JS (recommendations, taste engine, social, auth, Supabase).
- Focus on **rebuilding the UI and UX**: HTML structure, CSS, and minimal JavaScript changes to match the new layout and interactions.

==================================================
1. BRAND & VISUAL DIRECTION
==================================================

Overall feel:
- **Cinematic & premium**, like a streaming service / Letterboxd / Trakt mobile.
- **Warm & cozy movie night** feeling – not corporate.
- Poster-first layouts, dark backgrounds, bright accent color.

Visual guidelines:
- **Dark theme by default**:
  - Very dark gray / near-black background.
  - Single accent color. for active states, chips, sliders, icons.
- **Typography**:
  - One clean sans-serif font.
  - Clear hierarchy: big headings, mid-size section titles, small but readable body text.
- **Components** (define reusable styles/classes):
  - `movie-card` (poster-first).
  - `list-card` (poster collage + meta).
  - `review-card`.
  - `profile-header`.
  - `tab-bar` / `tab-chip`.
  - `bottom-nav`.
  - `chip` (filters, tags).
  - `sheet` (bottom sheet modals).
  - `btn-primary`, `btn-ghost`, `icon-button`.

Motion:
- Subtle hover/tap effects (scale, shadow, background).
- Smooth transitions for tab changes, opening sheets, etc.
- No heavy or distracting animations.

Accessibility:
- Respect color contrast.
- Focus styles on interactive elements.
- Semantic HTML where possible.

==================================================
2. TECH & FILES – HOW TO IMPLEMENT
==================================================

Current structure to respect:
- HTML pages:
  - `index.html` – main app shell / “Home” experience.
  - `profile.html` – self profile.
  - `peeruser.html` – other user’s profile.
  - `social-profile.html` – social / community-related views.
  - `login.html` – auth.
  - `account-settings.html` – account & app settings.
- CSS:
  - `assets/css/mobile.css` (you may rename to `styles.css` if you also update references).
- JS:
  - `assets/js/*.js` including `main.js`, `recommendations.js`, `taste.js`, `social.js`, `ui.js`, etc.
- API helpers: `api/` + Supabase helpers in `lib/`.

Instructions:
- You may refactor HTML/CSS/JS, but:
  - **Do not break** API calls, auth flows, or Supabase usage.
  - Reuse existing JS modules for recommendations, taste, social, etc., adjusting DOM selectors and event wiring to the new layout.
- Aim for **mobile-first CSS** with responsive adjustments for tablet/desktop.

Routing approach:
- The simplest option is still: multi-page app using the existing HTML files.
- Within `index.html`, implement a **tabbed app shell** that can show different “sections” (Home/Films, Search, Activity, Lists, Profile) using DOM-based tab switching.
- Alternatively (more advanced), you may approximate a single-page experience by hiding/showing major sections, but keep URLs working as currently wired.

==================================================
3. GLOBAL APP SHELL & NAVIGATION
==================================================

Across the main app (especially `index.html`), implement:

3.1 Top App Header
- At small/mobile widths:
  - Minimal header: brand/wordmark (SmartMovieMatch) on the left.
  - Icon buttons on the right as needed (notifications, cast icon, profile avatar shortcut).
- At larger widths:
  - You can also show top nav links (Home, Lists, Activity, Profile) as secondary navigation.

3.2 Bottom Tab Bar (MOBILE)
Implement a persistent bottom navigation bar with 5 tabs:

1) Home  
2) Search  
3) Activity  
4) Lists  
5) Profile  

Each tab has an icon + short label. The active tab uses the accent color and maybe a pill/underline.

3.3 Top Tabs / Segments (PER SCREEN)
Inside some tabs, add **top segmented tabs**, inspired by modern film apps:

- Home: `Films | Reviews | Lists`
- Activity: `Friends | You | Incoming`
- Profile: `Profile | Diary | Lists | Watchlist`
- Lists (global): `Your lists | Collaborative | Saved`
- Review & list detail: `Review | Comments` or `Films | Comments`, etc.


==================================================
4. SCREEN-BY-SCREEN SPECS
==================================================

Implement the following screens / layouts using the above nav patterns. Focus first on **mobile layout**, then enhance for larger screens.

------------------------------------------
4.1 HOME TAB (index.html) – FILMS SUB-TAB
------------------------------------------

Goal: “What should I watch tonight?” – poster-first, vibe filters, friend context.

Layout (Films tab):
- Hero section “Tonight’s picks”:
  - Horizontal scroll row of large `movie-card` components (~¾ width on mobile).
  - Each card: poster, title, year, runtime, a short reason (“Because you liked …”).
  - Inline actions: `Watch trailer`, `+ Watchlist`, `Mark watched`.
- Popular/trending section:
  - Section header: “Popular this week” with a “See all” link.
  - 2-column poster grid with titles + rating badges, and a watched check overlay.
- From friends:
  - Horizontal row of posters with a small avatar chip in a corner (who watched/rated it).
- Vibe chips:
  - Scrollable row of chips at the top or under hero: `Cozy`, `Mind-bending`, `Short`, `Family`, etc.
  - Clicking a chip refilters the main grid using existing TMDB/taste logic.

------------------------------------------
4.2 HOME TAB – REVIEWS SUB-TAB
------------------------------------------

Goal: Surface community/friend reviews.

Layout:
- Vertical list of `review-card`s:
  - Left: poster thumbnail.
  - Right:
    - Film title + year.
    - Username + avatar.
    - Star rating.
    - 2–3 lines of review text.
    - Footer: “Liked by X friends • N likes”.
- Tapping anywhere opens the **review detail screen** (section 4.8).

------------------------------------------
4.3 HOME TAB – LISTS SUB-TAB
------------------------------------------

Layout:
- Vertical list of `list-card`s:
  - Top: collage of 4–6 small posters.
  - Middle: list title + owner + like count.
  - Bottom: short description and tag chips (e.g. `cozy`, `thrillers`, `comfort`).
- Tap opens **list detail** (section 4.9).

------------------------------------------
------------------------------------------
4.5 SEARCH TAB (inside index.html)
------------------------------------------

Goal: Single powerful search + browse.

Layout:
- Top app header title: “Search”.
- Full-width pill search bar at top:
  - Leading icon: 🔍
  - Placeholder: “Search films, people, lists, or users”.
- When idle:
  - “Browse by” section with rows:
    - Release date
    - Genre, country or language
    - Streaming service
    - Most popular
    - Highest rated
    - Most anticipated
    - Top 250
    - Featured lists
- When searching:
  - Under the search bar, segmented chips: `All | Films | People | Lists | Users`.
  - Results list:
    - Films: poster + title + year + rating and maybe genres.
    - People: headshot + name + “Director/Actor”.
    - Lists: condensed `list-card`.
    - Users: avatar + username + follower count.

Wire this into the existing global search/taste logic, updating selectors/event handlers as needed.

------------------------------------------
4.6 ACTIVITY TAB (index.html)
------------------------------------------

Use top tabs: ` Friends | You | Incoming`.

Friends tab:
- Vertical feed of social events:
  - Examples:
    - “X rated Y ★★★★☆”
    - “X added 5 films to ‘Cozy Horror’”
    - “X started a watch party”
  - Each item row:
    - Left: user avatar.
    - Right:
      - Primary text: action summary.
      - Secondary text: time ago.
      - Optional inline film/list thumbnails.
    - Tap → relevant movie/list/watch party.

You tab:
- Same layout, but only the current user’s actions.

Incoming tab:
- Requests and invitations:
  - Follow requests.
  - Watch party invites (with a Join button).
  - Collaborative list invites.

Tie into existing social/presence/watch party logic where available.

------------------------------------------
4.7 LISTS TAB (index.html, plus social-profile.html as needed)
------------------------------------------

Top tabs: `Your lists | Collaborative | Saved`.

Layout:
- Search icon and filter icon in the header.
- List for each tab:
  - Use `list-card` style:
    - Left: poster collage.
    - Right:
      - Title + lock icon if private.
      - Subtitle: “23 films · 68% watched”.
      - Small avatar row for collaborators.
      - Tag chips for list type.

- Floating action button (FAB) bottom-right:
  - Primary action: “Create list”.

Use existing collaborative list logic; this is a visual redesign.

------------------------------------------
4.8 PROFILE TAB – SELF PROFILE (profile.html)
------------------------------------------

Top tabs: `Profile | Lists | Watchlist`.

Profile tab layout:
- Header:
  - Large circular avatar.
  - Username + @handle.
  - Short bio line.
  - Stats row: films, diary entries, followers, following (clickable).
  - Primary actions: edit profile, maybe share profile link.
- Ratings distribution:
  - Horizontal bar chart from ½★ to 5★.
  - “Average rating” & “Most-used rating” labels.
- Quick stats rows:
  - Films, Diary, Reviews, Watchlist, Lists, Likes, Tags, Followers/Following, Stats (deep dive).

Diary tab:
- Reverse-chronological list of watched entries:
  - Poster thumb, title, year, rating, watched date, optional review snippet.

Lists tab:
- Same `list-card` layout as global Lists, but scoped to this user.
- FAB to create new list.

Watchlist tab:
- 2-column grid or vertical list of poster-first movie cards.
- Header with Filter and Sort actions.
- Each card: poster, title, year, maybe streaming badge.

Ensure `profile.html` matches this layout, but also make the Profile tab in the app shell show a similar UI.

------------------------------------------
4.9 OTHER USER PROFILE (peeruser.html)
------------------------------------------

Same structure as self profile, but:

- Header:
  - Back button in header.
  - Follow / Following button in header.
  - Possibly a “Message” or “Invite to watch party” button.
- Tabs: `Profile | Diary | Lists | Watchlist` with same layouts, but no editing actions.

Reuse components from self profile, with small differences in available actions.

------------------------------------------
4.10 MOVIE DETAIL SCREEN (can be in index.html using a panel, or its own view)
------------------------------------------

Goal: combine hero visuals, actions, synopsis, stats, social, and related titles.

Layout:

Hero area:
- Full-width backdrop image with a dark gradient overlay.
- Floating card or row on top:
  - Left: medium poster.
  - Right:
    - Title, year, runtime.
    - Genres.
    - Director.
    - Where to watch (service badges) if available.

Primary action row (below hero):
- Three main icon buttons:
  - Watch (trailer or streaming deep link).
  - Favorite/Like.
  - Watchlist toggle.
- Secondary toggles:
  - Watched checkbox.
  - Your star rating.
  - “Review or log this watch” button.

Synopsis & meta:
- Movie overview text with “More” expansion.
- Fact rows: release date, country, language.
- Cast: horizontal scroll of cast headshots & names.
- Tags/moods as chips.

Ratings & stats:
- Rating histogram bar chart.
- Text: “Average 3.9 from 12k ratings”; “Your rating: …”.
- Buttons: “See all logs” / “See all lists with this film”.

Social section:
- Friends activity summary: “5 friends watched; 3 wrote reviews.” with avatar strip.
- Preview of a few reviews (friend-first), linking to full reviews.

Related titles:
- Rows: “Because you liked X” and “More like this” using `movie-card` row or grid.

------------------------------------------
4.11 REVIEW DETAIL & COMMENTS (likely social-profile.html or a dedicated section)
------------------------------------------

Use top tabs: `Review | Comments`.

Review tab:
- Header:
  - User avatar + name + follow button.
  - Film card on the side/top: small poster, title/year (tap → movie detail).
- Body:
  - Star rating, watched date.
  - Full review text.
  - Action row: Like, Comment, Re-log, Share.
- Footer:
  - “Liked by X” avatar strip.
  - Link/button: “View film”.

Comments tab:
- Vertical list of comments:
  - Each row: avatar, username, comment text, time, like button.
- Bottom fixed comment input:
  - Text field + send button.
- Long-press or “…” options on a comment:
  - Report, block user, share, maybe “View profile”.

------------------------------------------
4.12 LIST DETAIL & COMMENTS
------------------------------------------

Use top tabs: `Films | Comments`.

Films tab:
- Header:
  - Banner area with collage / hero image.
  - List title, owner, like button.
  - Stats: “100 films · 68% watched · 0% complete”.
  - Tag chips (e.g. `stats`, `faves`, `comfort`).
- Horizontal featured row:
  - A few standout posters from the list.
- Full list:
  - Vertical rows:
    - Poster, title, year, runtime.
    - Possibly a watched progress indicator per user.
- Sort/filter controls:
  - “Sort” & “Filter” buttons linking to the Filters screen.

Comments tab:
- Same comment layout as review comments.
- Bottom comment input.
- Options for sharing/reporting the list.

------------------------------------------
4.13 FILTERS SCREEN (FOR LISTS & SEARCH)
------------------------------------------

Implement as a full-screen modal or page:

- Top bar:
  - “X” to cancel on the left.
  - Title “Filters”.
  - “Apply” button on the right.
- Body: grouped filter options:
  - Sort by: List order, Rating, Release date.
  - Appearance: toggles like “Fade watched films”, “Use custom posters”.
  - Content:
    - Year range.
    - Genre.
    - Country.
    - Language.
    - Service.
    - Release type (in theaters, streaming, etc.).
    - Length.
    - Film vs TV.
  - Your account:
    - Watched status (Any / Only watched / Only unwatched).
    - Liked only.
- Footer:
  - Primary “Apply filters” button.

Wire these controls into the existing list/search logic where possible; otherwise, stub them with sample interactions but keep the UI ready.

------------------------------------------
4.14 WATCH PARTY / LIVE SESSION SCREENS
------------------------------------------

Implement two states:

A) Watch party lobby:
- Header:
  - “Watch Party” title.
  - Back button.
  - Invite button and overflow menu.
- Movie summary card:
  - Poster, title, runtime, service.
  - “Watch on [Service]” button (link or stub).
- Party details:
  - Host info, scheduled time, privacy.
- Participants row:
  - Horizontal avatar strip with presence dots (online/offline).
- Chat:
  - Vertical chat list.
  - Bottom input bar for messages.
- Primary buttons:
  - “Start party” (for host) or “Ready” state.

B) In-session overlay:
- Minimal overlay that can sit over a hypothetical player:
  - Top bar with party name + LIVE indicator.
  - Side or bottom chat overlay.
  - Quick reactions bar (emoji).
  - “Leave party” / “End party” button.

Connect to existing watch party / presence logic where implemented; otherwise, keep the UI and stub the behavior in JS.

------------------------------------------
4.15 ACCOUNT SETTINGS (account-settings.html)
------------------------------------------

Layout:
- Header: “Settings” with back arrow.
- Sections:
  - Account:
    - Email, username, password change.
    - Connected services (TMDB, Google, etc.).
  - Privacy & social:
    - Profile visibility.
    - Blocked users.
    - Activity sharing preference.
  - Notifications:
    - Toggles for new followers, likes, comments, watch party invites.
  - Appearance:
    - Theme (Dark / Light / System).
    - Poster size (Comfortable / Compact).
  - Danger zone:
    - Delete account (visually separated, red).

Use standard form patterns, clear labels, helper text, and error handling.

------------------------------------------
4.16 AUTH / LOGIN (login.html)
------------------------------------------

Implement:
- Welcome / splash-like login with cinematic mood:
  - Logo/wordmark, short pitch (“Movie nights, dialed in.”).
  - Social login buttons (e.g. Continue with Google) if supported.
  - Email/password login form.
  - Link to sign up.
  - “Continue as guest” option if guest browsing exists.
- For signup:
  - Email, password (and confirmation), username, optional avatar URL.
  - Clear form validation & error states.

Make forms accessible and mobile-friendly (large tap targets, no cramped fields).

==================================================
5. IMPLEMENTATION PRIORITIES & STYLE
==================================================

When coding:
1. Start from the **global shell** and **Home / Films** layout in `index.html`.
2. Define reusable UI components via HTML + CSS classes.
3. Refactor existing JS to bind to the new DOM:
   - Update selectors and event handlers.
   - Maintain or improve loading states, error messaging, and skeletons.
4. Then implement Profile, Lists, Activity, Search, and detail screens.
5. Finally, refine watch party and advanced filters.

Always:
- Prefer small, focused CSS utilities + clear BEM-ish class names.
- Keep JS modular and organized (don’t create one giant script).
- Comment non-obvious logic.
- Ensure the redesigned UI works on mobile, then scale up to tablets/desktop.

This spec is the source of truth for the new SmartMovieMatch UI. Implement it step by step, preserving existing functionality while upgrading the overall experience to a modern, cinematic, social-first movie app.
