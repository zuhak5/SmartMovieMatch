# SmartMovieMatch v1 — Master Instructions for Codex
## Redesign the Product UI from Scratch (with Brand + TODO System)

**Audience:** Codex (coding agent)  
**Goal:** Redesign SmartMovieMatch’s web UI from scratch, implementing a **cinematic, premium, warm, social movie companion** experience while keeping the app functional (Supabase, auth, lists, recommendations, social).

Use these instructions every time you (Codex) work on this project.

---

## 0. Your Role, Repo & Safety Context

### 0.1 Your role and behavior

You are **Codex**, acting as:

- Senior front-end engineer  
- UX/UI designer  
- Accessibility-minded developer  

You are allowed to:

- **Heavily change HTML, CSS, and JS.**
- Reorganize navigation, pages, and components as needed.
- **Introduce a front-end framework** (React/Next/Vite/etc.) **if it clearly improves UX and you implement it fully.**

You must:

- Preserve and respect the **core product behavior**:
  - Movie recommendations
  - Lists (favorites, watchlist, custom lists)
  - Social (profiles, follow, activity)
  - Authentication
  - Supabase sync and backend behavior
- Leave the app in a **working, runnable state** at the end of each change set
  - Existing or updated commands such as `npm install` and `npm start` / `npm run dev`.

You are **allowed to rewrite all UI copy** (headlines, button labels, descriptions) as long as it fits the SmartMovieMatch concept and brand.

If user instructions conflict with this document, **obey the user**, and treat this spec as the fallback.

---

### 0.2 Repo context — files to read first

Before making changes, **always read or re-read**:

- `README.md` – overview, setup, dev commands, and any “Implementation notes for Codex”.
- `AGENTS.md` – especially:
  - Database Safety Checklist
  - Environment variables / API keys rules
- Main entry points:
  - `server.js` (or equivalent server entry)
  - Front-end pages:
    - `index.html` (home / dashboard)
    - `profile.html` (my profile)
    - `peeruser.html` (another user’s profile)
    - `social-profile.html` or any community/social page (if present)
    - `login.html` (auth)
    - `account-settings.html` (account)
  - Styles:
    - `assets/css/mobile.css` (and any other CSS)
  - Scripts:
    - `assets/js/*.js` (especially `main.js`, `dom.js`, `auth.js`, `api.js`, etc.)

---

### 0.3 Database & API safety rules

Follow `AGENTS.md` and these principles:

- Interact only with tables defined in:
  - `supabase/migrations/supabase_tables_schema.sql`
- Do **not** invent new tables, columns, or policies unless explicitly instructed by the user.
- Do **not** hard-code secrets; use existing env vars / config mechanisms.
- If you change any API or SQL-related code:
  - Ensure it still matches the schema and existing policies.
  - Ensure Supabase authentication and data access remain correct.

Before renaming/removing any `id`, `class`, or `data-*` attribute that might be used by JS:

- Search through `assets/js/*.js` and update all references accordingly.

---

### 0.4 Tech stack choices & running the app

Default assumptions:

- Current project uses **static HTML + CSS + vanilla JS** with a Node server and Supabase backend.

You may:

- **Stay with vanilla** (preferred by default for simplicity)  
  *OR*
- Introduce a framework (React SPA, Next.js, etc.) **if**:
  - You fully implement routing and build configuration.
  - You update `package.json` with dependencies and scripts.
  - You update `README.md` with a simple “one-command” dev story (`npm run dev`, etc.).

When you introduce or change the stack:

- Keep the app runnable with clear, up-to-date instructions in `README.md`.

---

## 1. Product Vision & Brand Direction (North Star)

**Brand feel:**

- **Cinematic & premium** — like a polished streaming service intro.
- **Warm & cozy** — “movie night with friends”, not cold or corporate.
- UI tone:
  - Friendly, conversational, with occasional small jokes or playful hints.

**Primary audiences:**

1. **Casual viewers**
   - Want: “What should I watch tonight?”
2. **Social / show-off users**
   - Want: Share taste, curate lists, follow friends, see what others loved.

**Core promises (all four matter and must be visible in the UI):**

1. **Personal recommendations** tuned to the user’s vibe and history.
2. **See what friends like** and reuse their good picks.
3. **Movie lists done right** (watchlists, favorites, themed collections).
4. **Social movie community** (profiles, activity, compatibility, following).

**Social priority:**

- **Balanced**:
  - Recommendations are the star.
  - Social context is woven into movie cards, profiles, lists, and activity — visible, but not overwhelming.

---

## 2. Design System & UX Rules

### 2.1 Theme & colors

- **Dark-mode-first** (movie theater feel) with optional light mode if practical.
- Palette:
  - Backgrounds: dark charcoals / near-black.
  - Accents: **warm, cozy colors** (muted oranges, ambers, warm reds) for CTAs, badges, highlights.
- Use CSS custom properties (variables), e.g.:
  - `--color-bg`, `--color-bg-elevated`, `--color-text`, `--color-accent`, `--color-accent-soft`.
- Maintain accessible contrast, especially for text on dark backgrounds.

### 2.2 Typography

- **Modern sans-serif stack** (inspired by Spotify/Netflix/Notion).
- Clear hierarchy:
  - Large, confident headings for the main sections.
  - Medium titles on cards and list headers.
  - Body text sized comfortably for reading summaries and reviews.

### 2.3 Layout & density

- **Mobile-first**:
  - Design for ~375px width first; enhance for tablet (~768px) and desktop (~1200px+).
- Avoid edge-to-edge text; use comfortable padding and a sensible max-width for main content.
- **Medium information density**:
  - Enough detail to feel “smart” (ratings, genres, social context).
  - Enough whitespace so it doesn’t feel cramped.

Main layout patterns:

- Top app header:
  - Brand logo / name
  - Key nav links (Home, My Lists, Friends/Community, Profile, Account)
  - Auth/account state and possible theme toggle
- Main area:
  - Discovery dashboard, recs, movie cards, filters.
- Secondary panels:
  - My lists preview, friend activity, suggested people, streak.

### 2.4 Motion & interactions

- **Moderate micro-interactions:**
  - Hover/focus states on cards and buttons (subtle scale, shadow, or background shift).
  - Smooth transitions for tabs, modals, filters.
- Avoid heavy, distracting animations or large parallax effects.
- Respect reduced-motion preferences if possible (e.g., keep animations subtle and non-essential).

### 2.5 Accessibility (standard best practices)

- Semantic HTML: use `<header>`, `<main>`, `<nav>`, `<section>`, `<button>`, `<ul>`, `<li>`, `<form>`, etc.
- Forms:
  - Use `<label>` associated via `for` / `id`.
  - Provide helper or error text near the inputs.
- Controls:
  - Accessible names (via text or `aria-label`).
  - All interactive elements reachable via keyboard.
  - Visible focus states for all interactive elements.
- Ensure color contrast is reasonable for text/icons on dark backgrounds.

---

## 3. Information Architecture & Navigation

Use a **classic top navigation bar** visible across main pages.

Baseline structure (you can refine labels/URLs, but keep roles):

- **Brand** – “SmartMovieMatch”
- **Home** – `/` (index): “Movie Night Dashboard” with:
  - Vibes/filters
  - Recommendations
  - Lists preview
  - Friend highlights
- **My Lists** – dedicated lists view or a clearly defined section (can be its own route or part of Home/Profile).
- **Friends / Community** – social view:
  - Activity, followers/following, discover people.
- **Profile** – my movie persona:
  - Taste breakdown, pinned lists, compatibility.
- **Account** – account settings & security.
- **Auth** – login / signup (or folded into Profile/Account when logged in).

On mobile:

- Top bar can collapse into a burger menu or icon bar.
- Keep navigation obvious and easy to tap.

---

## 4. Page Responsibilities

You can reorganize existing HTML files, but aim for these roles:

### 4.1 Home (`index.html`) – “Movie Night Dashboard”

Main screen; should feel like a dashboard.

1. **Top hero strip**
   - 1–2 lines explaining SmartMovieMatch.
   - Main call-to-action: “Find something to watch” / “Set tonight’s vibe”.

2. **Vibe & filters panel**
   - Moods, genres, runtime (short/medium/epic), and maybe platform filters if available.
   - Use chips, toggles, sliders that are friendly on mobile.
   - Show a short explanation of the current vibe/filter.

3. **Recommendations area**
   - Rich grid/list of movie cards.
   - Each card should include:
     - Poster
     - Title & year
     - 1–2 key stats (rating, runtime, 1–2 genre chips)
     - Tiny hook/summary
     - Primary actions:
       - Add to Favorites
       - Add to Watchlist / Mark as Watched
       - View details / trailer
     - Social context:
       - Friend avatars/initials if friends liked/watched it.
       - A small “X friends loved this” metric if applicable.

4. **My lists preview**
   - Quick slices of:
     - Favorites
     - Watchlist / “For tonight”
   - Clear CTAs:
     - “View all lists”
     - “Create a themed list”

5. **Friend activity highlights**
   - Compact feed or modules:
     - “Alice added 3 movies to ‘Cozy Thrillers’”
     - “You and Bob both liked [Movie]”
   - Visible but not dominating.

---

### 4.2 My Profile (`profile.html`)

A **movie persona** view, not just a settings page.

- Top:
  - Avatar, display name, handle.
  - Short taste tagline (e.g., “Slow-burn thriller addict”).
- Body:
  - Taste breakdown:
    - Favorite genres, moods, recent streak.
  - Signature lists:
    - Pinned lists like “All-time favorites”, “Rainy day comfort watches”.
  - Compatibility summaries:
    - Small highlight with best friend matches or overall compatibility with friends.
  - Clear CTAs:
    - “Edit profile”
    - “Jump into recs with your usual vibe”

---

### 4.3 Peer Profile (`peeruser.html`)

**My taste vs their taste** comparison.

- Their avatar, display name, taste tagline.
- “Taste match %” or similar compatibility indicator.
- Overlapping favorites and genres.
- Their pinned lists / standout lists.
- Actions:
  - Follow/unfollow
  - Copy movie/list items to my lists
  - (If supported) start a shared list

---

### 4.4 Social / Community (`social-profile.html` or similar)

Dedicated **Friends / Community** area.

- Followers / Following / Mutuals view.
- Activity feed:
  - List creations, big updates, notable reviews/logs.
- Explanations:
  - How friends you follow influence the recommendations you see.
- Suggestions:
  - “People you might like”
  - “Friends with similar tastes”

---

### 4.5 Auth (`login.html` + signup)

Fast, reassuring auth experience.

- Simple login and signup forms.
- Clear messaging:
  - Why log in:
    - Cloud sync, saved lists, social features, better recommendations.
- Friendly error states and inline validation.
- Consider “Continue as guest” if already supported or easy to maintain.
- Keep flows short and mobile-friendly.

---

### 4.6 Account Settings (`account-settings.html`)

Settings with clear structure.

- Profile details:
  - Avatar, name, handle, tagline.
- Email + password management.
- Clear sections:
  - Profile
  - Security
  - Notifications
  - Data/sync status (e.g., last sync time) if available.
- Destructive actions:
  - Log out
  - Delete account
  - Visually distinct and clearly separated.

---

## 5. Tech & Implementation Guidelines

### 5.1 HTML, CSS, JS structure

Prefer to keep or evolve a simple structure, for example:

- Pages:
  - `index.html`, `profile.html`, `peeruser.html`, `social-profile.html`, `login.html`, `account-settings.html`
- Styles:
  - `assets/css/styles.css` – main stylesheet (may replace/absorb `mobile.css`)
  - Optionally, additional CSS files for specific pages, but prefer a central system.
- Scripts:
  - `assets/js/main.js` – global UI behavior
  - `assets/js/dom.js`, `assets/js/auth.js`, `assets/js/api.js`, etc.

Use **clear, readable class names**, BEM-ish is fine (e.g., `header`, `hero`, `movie-card`, `profile-header`, `btn-primary`, `chip`, `nav-link`).

### 5.2 If you introduce a framework

If moving to React/Next/Vite/etc.:

- Organize components by feature:
  - `HomeDashboard`, `MovieCard`, `ProfileHeader`, `FriendActivityFeed`, `AuthForm`, etc.
- Map existing pages to routes:
  - `/`, `/profile`, `/user/:id`, `/community`, `/login`, `/account`.
- Keep API calls and Supabase logic consistent with current behavior.
- Update:
  - `package.json` with all dependencies and scripts.
  - `README.md` with:
    - Install instructions
    - Dev and build commands
    - Any migration notes.

Always ensure you **don’t break**:

- Authentication.
- Recommendation flows.
- Lists CRUD operations.
- Social functionality.

---

## 6. TODO System & Progress Tracking

This instruction file (`SMART_MOVIE_MATCH_INSTRUCTIONS.md`) is the **single source of truth** for high-level TODOs.

### 6.1 TODO format

Every TODO must appear on a single line in this format:

```text
[TODO id="some-id" status="pending"] Description of the task.
```

Attributes:

- `id` — short, unique, stable identifier. **Never change it once created.**
- `status` — one of:
  - `pending` — not done or partially done.
  - `done YYYY-MM-DD HH:MM` — completed at the given date/time (24-hour clock, any timezone, be consistent).

**When you finish a TODO**, update only the `status` attribute:

From:

```text
[TODO id="home-hero" status="pending"] Rebuild the discovery page hero section with new layout and styles.
```

To:

```text
[TODO id="home-hero" status="done 2025-11-14 19:42"] Rebuild the discovery page hero section with new layout and styles.
```

You may append a brief note:

```text
[TODO id="home-hero" status="done 2025-11-14 19:42"] Rebuild the discovery page hero section with new layout and styles. Note: uses mock featured movie data.
```

Rules:

- Do **not** delete TODO lines.
- Do **not** change `id`s.
- Only change `status` and optionally append a short note at the end.

This status tracking lets future runs of Codex **continue where they left off.**

---

## 7. Concrete TODO Roadmap

You must work through these sections in numeric order. Within each section, progress TODOs **from top to bottom**.

### 7.1 Global shell & shared layout

- [TODO id="global-reset" status="pending"] Implement a global CSS base/reset (box-sizing, margin reset, basic typography, link and image defaults).
- [TODO id="app-shell" status="pending"] Create a reusable app shell layout: consistent header, main content area with max-width and padding, optional footer.
- [TODO id="theme-system" status="pending"] Define a theme system using CSS custom properties for dark mode (and optional light mode), applied via a class or data attribute on `<body>`.
- [TODO id="theme-toggle" status="pending"] Add a theme toggle control in the header that updates the theme attribute on `<body>` with vanilla JS and optionally persists choice in `localStorage`.
- [TODO id="global-nav" status="pending"] Design and implement a global navigation bar (logo/app name, Home, My Lists, Friends/Community, Profile, Account) reused across pages.

### 7.2 Home / Dashboard (`index.html`)

- [TODO id="home-hero" status="pending"] Redesign the hero strip with cinematic dark styling, a short explanation, and a main CTA for starting a movie search or vibe.
- [TODO id="home-search" status="pending"] Implement a prominent search/vibe entry area: search bar plus quick vibe shortcuts (movies, friends, genres).
- [TODO id="home-filters" status="pending"] Build a “Dial in your vibe” filter area with mood chips, genre chips, runtime controls, and placeholder space for future filters (platform, crew, etc.).
- [TODO id="home-recs" status="pending"] Create the main recommendations grid/list with rich movie cards, including stats, actions, and social context indicators.
- [TODO id="home-lists-preview" status="pending"] Add a “My lists” preview section showing slices of Favorites, Watchlist, and/or a featured custom list with CTAs to view all and create new lists.
- [TODO id="home-streak" status="pending"] Implement a “watched streak” widget showing streak count and a simple visual indicator using mock data.
- [TODO id="home-friend-activity" status="pending"] Build a compact friend activity area displaying recent list updates, overlaps, and highlights from friends.
- [TODO id="home-responsive" status="pending"] Ensure the home/dashboard layout is mobile-first and scales gracefully to tablet and desktop.

### 7.3 Auth (`login.html` + signup flow)

- [TODO id="auth-layout" status="pending"] Redesign the login/signup layout as a clean, centered card with cinematic background treatment and a short “Why sign in?” pitch.
- [TODO id="auth-forms" status="pending"] Build accessible forms for login and signup (email, password, display name, optional avatar URL/upload) with clear labels and helper text.
- [TODO id="auth-errors" status="pending"] Implement visual patterns for validation and error states (messages, highlighted fields) using front-end logic and/or mocked server responses.
- [TODO id="auth-mobile" status="pending"] Optimize the auth page(s) for mobile: large tap targets, comfortable spacing, minimal scrolling.

### 7.4 Profile (self) (`profile.html`)

- [TODO id="profile-hero" status="pending"] Design a profile hero section with avatar, display name, handle, and a short taste tagline, plus primary actions (edit profile, manage lists).
- [TODO id="profile-pulse" status="pending"] Create a “Your SmartMovieMatch pulse” summary with basic stats and simple visual indicators for favorites, watched, and vibe diversity.
- [TODO id="profile-library" status="pending"] Implement a “Your library” area with tabs/filters for Favorites, Watchlist, and other lists using responsive movie cards.
- [TODO id="profile-social" status="pending"] Add social sections for “Friends online”, “Mutual followers”, and “People you might like”, using consistent card components.
- [TODO id="profile-onboarding-empty" status="pending"] Design empty states for new users, prompting them to add favorites and create lists.
- [TODO id="profile-responsive" status="pending"] Ensure the profile layout is attractive and usable across mobile, tablet, and desktop.

### 7.5 Peer user profile (`peeruser.html`)

- [TODO id="peer-hero" status="pending"] Adapt the profile hero for another user, emphasizing their avatar, display name, and taste tagline.
- [TODO id="peer-compat" status="pending"] Visualize taste compatibility (e.g., “Taste match %” and overlapping favorite genres/movies).
- [TODO id="peer-activity" status="pending"] Show the peer’s recent activity, public lists, and standout movies using movie/list cards.
- [TODO id="peer-follow-cta" status="pending"] Provide clear follow/unfollow controls and a short explanation of what following does.

### 7.6 Social / Community (`social-profile.html` or similar)

- [TODO id="social-shell" status="pending"] Create a dedicated Friends/Community layout with sections for followers, following, and mutuals.
- [TODO id="social-activity-feed" status="pending"] Implement an activity feed showing friend list creations, movie additions, and notable actions in a readable, scrollable format.
- [TODO id="social-suggestions" status="pending"] Add “People you might like” and “Friends with similar taste” suggestion blocks.
- [TODO id="social-explainer" status="pending"] Include UI copy/sections explaining how following people influences recommendations.

### 7.7 Account settings (`account-settings.html`)

- [TODO id="settings-shell" status="pending"] Build a clear settings layout with navigation for Profile, Security, and Notifications.
- [TODO id="settings-profile" status="pending"] Structure fields for avatar, display name, handle, tagline, and taste tagline with labels and helper text.
- [TODO id="settings-security" status="pending"] Design the security section: email, password change, and placeholders for future 2FA settings (visual only).
- [TODO id="settings-notifications" status="pending"] Layout notification preferences (email recaps, friend activity, etc.) using accessible switches/checkboxes.
- [TODO id="settings-jump-links" status="pending"] Add “Jump to section” links that scroll smoothly to each section and manage focus appropriately.
- [TODO id="settings-mobile" status="pending"] Ensure settings are easy to use on mobile with no horizontal scrolling and clear tap targets.

### 7.8 Polish & QA

- [TODO id="a11y-pass" status="pending"] Perform an accessibility pass across pages (semantic structure, labels, focus states, contrast).
- [TODO id="cross-page-consistency" status="pending"] Ensure component styles (buttons, cards, chips, forms) and spacing are consistent across all pages.
- [TODO id="performance-basics" status="pending"] Keep CSS/JS lean, optimize images, and avoid unnecessary DOM complexity to maintain good performance.
- [TODO id="readme-update" status="pending"] Update `README.md` to reflect the current stack, dev commands, and any important notes from this UI redesign.

---

## 8. How Codex Should Work Each Run

When you (Codex) are called to work on SmartMovieMatch:

1. **Read context**
   - Re-read this instructions file.
   - Re-read `README.md` and `AGENTS.md`.
   - Skim relevant HTML/CSS/JS (or components) for the feature you’re touching.

2. **Identify TODOs**
   - Find all `[TODO ... status="pending"]` lines.
   - Start with the **lowest-numbered section** (7.1, 7.2, …) that still has pending TODOs.
   - Within that section, work **top to bottom**.

3. **Pick a focused task**
   - Example: “Redesign Home hero and filters”, “Implement new movie card design”, “Build profile hero”.

4. **Explain the plan (briefly)**
   - Describe in natural language:
     - Which TODO IDs you will address.
     - Which files you will change.
     - The high-level UX outcome.

5. **Implement the changes**
   - Modify the necessary HTML, CSS, JS or framework components.
   - If you change IDs/classes/data attributes, update all relevant JS.
   - Ensure the app still runs (e.g., `npm start` / `npm run dev` works).

6. **Summarize the outcome**
   - List the TODO IDs you worked on.
   - List the files you changed.
   - Describe how the UI/UX improved and note any limitations or follow-ups.

7. **Output updated code**
   - For each changed file, output the **full updated file content** in fenced code blocks with the correct language, e.g.:

     ```html
     <!-- index.html -->
     <!DOCTYPE html>
     <html lang="en">
     ...
     </html>
     ```

     ```css
     /* assets/css/styles.css */
     :root {
       --color-bg: #0b0c10;
       ...
     }
     ```

8. **Update TODO statuses**
   - In this instructions file’s TODO section:
     - Change `status="pending"` to `status="done YYYY-MM-DD HH:MM"` for each completed TODO.
     - Use a 24-hour timestamp.
   - If you partially completed a TODO but are blocked:
     - Keep `status="pending"`.
     - Append a short note describing the blocker.

9. **Update progress notes**
   - If the repo has a progress notes section or you adjust `README.md`, summarize:
     - New features implemented.
     - Remaining tasks that relate to this spec.

---

## 9. Quality, Accessibility & Error Avoidance Checklist

Before finishing any run:

- **HTML & structure**
  - Valid doctype, `<html>`, `<head>`, `<body>`.
  - Properly nested tags, no missing closing tags.
- **Layout**
  - Check visual layout on:
    - ~375px (mobile)
    - ~768px (tablet)
    - ~1200px (desktop)
  - No critical overlaps or cut-off text.
- **Interaction**
  - Buttons and links look interactive.
  - Hover and focus states present.
  - Forms have labels, helper/error messages.
- **Accessibility**
  - Headings structured logically.
  - Interactive elements reachable via keyboard.
  - Visible focus outlines.
  - Color contrast reasonable.
- **Performance & stability**
  - Avoid large, unused libraries.
  - Keep CSS and JS reasonably small and organized.
  - Do not break Supabase calls or auth flows.
- **Run the app**
  - Ensure `npm start` / `npm run dev` (or documented equivalent) still works without errors.

---

## 10. Resuming Work in Future Runs

On each new invocation:

1. Re-read this instructions file.
2. Identify all TODO lines with `status="pending"`.
3. Begin with the earliest section (7.1, 7.2, …) that still has pending TODOs.
4. Pick focused TODOs from top to bottom and complete them.
5. Update the TODO `status` values with `done YYYY-MM-DD HH:MM`.

This guarantees that Codex can **always continue where it left off**, using this document’s TODO list as the shared memory across runs.
