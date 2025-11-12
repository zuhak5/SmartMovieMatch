# Social Experience Enhancements

## Current Foundation
- The social module already maintains collaborative lists, watch party scheduling, and shared review data for friends, giving us a baseline for richer community tools.
- Presence polling, badge tracking, and community review forms are built into the client, so we can extend what already feels familiar to returning users.

## Opportunities to Expand the Experience

### 1. Smarter Friend Discovery and Onboarding

**Goals**
- Remove friction from the first-hour experience so that new members connect with at least three friends before leaving the onboarding flow.
- Help returning users continue expanding their network with low-effort, privacy-preserving suggestions that feel relevant and timely.

**Key Enhancements**
- **People You May Know (PYMK) 2.0**
  - **Signal blend**: Weight mutual followers (0.30), shared watch history (0.25), common favorites (0.20), genre affinity (0.15), and recent co-hosted watch parties (0.10) into a single score so no single signal dominates.
  - **Freshness guardrails**: Refresh the ranking every Monday, cap repeats to once per 14 days, and automatically hide suggestions already dismissed or followed in the past week.
  - **Multi-surface delivery**: Show the top five matches on the dashboard hero card, dedicate a three-card carousel during onboarding step two, and email a weekly digest to opted-in members.
  - **Feedback loop**: Log impressions, dismissals, follows, and acceptance conversions to a PYMK analytics table so data science can re-tune coefficients quarterly.
- **Sharable Profiles**
  - **Vanity handle flow**: Let members claim a handle (3–20 characters, alphanumeric plus underscore) during onboarding, with real-time availability checks and automatic migration if they change it later.
  - **Invite artifacts**: Generate deep links (`smartmoviematch.com/u/<handle>`), QR codes sized for print (1024×1024 PNG), and NFC payload snippets for event booths—all including contextual copy like “Scan to swap movie lists.”
  - **Safety catches**: Rate-limit link generations to three per minute, include one-tap abuse reporting on shared profiles, and expire QR codes after 30 days unless refreshed.
- **Guided Invitations**
  - **Consent-first import**: Add an explicit opt-in gate before enabling CSV/OAuth contact syncing, surface exactly which fields are imported, and allow members to delete uploaded lists at any time.
  - **Smart templates**: Offer three tone presets (“Friendly catch-up,” “Festival buddy,” “Watch party invite”) that auto-populate notes with dynamic tokens like `{first_name}` and `{favorite_genre}`.
  - **Deliverability hygiene**: Validate handles on upload, dedupe against existing followers, throttle invites to 25 per day, and provide a status dashboard summarizing pending, sent, and bounced requests.

**Onboarding Flow Tweaks**
1. Prompt new users to choose their preferred discovery method (suggested friends, manual search, invite import) to emphasize control.
2. Offer "Add all" and "Skip for now" actions with clear microcopy explaining that settings can be revisited later in the profile menu.
3. Send a follow-up notification 48 hours after signup summarizing pending invites, accepted connections, and a call-to-action to explore collaborative lists.

**Success Metrics & Safeguards**
- Track conversion from suggestion view → follow request → accepted connection, and run A/B tests on PYMK ranking weights to ensure diversity in recommendations.
- Log invitation source (link, QR, contact sync) to understand which channels drive the highest acceptance while monitoring for spam via rate limiting and abuse reporting hooks.
- Use differential privacy techniques when aggregating watch history signals so no single viewing session reveals sensitive behavior.

### 2. Deeper Conversations Around Reviews
- Let people start threaded replies under community notes, with lightweight markdown and spoiler tags so longer-form reviews stay readable.
- Surface highlight reels ("Top friend's takeaway", "Most surprising review") that summarize sentiment from someone you follow versus the wider community.
- Expand emoji reactions into full reaction analytics so users can see how their friends responded emotionally to a film night.

### 3. Premium Watch Party Moments
- Extend watch parties with synchronized countdowns, shared scene reactions, and an ambient chat room that persists afterward for recap notes.
- Offer co-host roles so one friend can handle moderation while another curates trivia, polls, or mini-games during the party.
- Capture party highlights (top quotes, collective rating, playlists) that automatically post back into each attendee's profile feed.

### 4. Social Progression and Recognition
- Turn badges into tiered achievements with clear progress bars (e.g., "Critic in Training" → "Master Curator") so players know what to do next.
- Introduce seasonal spotlights or community quests ("Review three debuts this month") that unlock exclusive profile frames or emoji packs.
- Add gratitude mechanics where friends can endorse each other for specific skills (taste matching, event hosting), showcasing social capital.

### 5. Collaborative Storytelling Beyond Lists
- Evolve collaborative lists into "collections" that support rich text intros, embedded trailers, and voting mechanisms for what to watch next.
- Give groups a shared activity log that chronicles edits, newly added picks, and milestones ("Completed a trilogy together"), making collaboration feel alive.
- Allow exported collections to become public showcases other teams can fork, remix, or subscribe to for inspiration.

### 6. Presence, Notifications, and Boundaries
- Add status presets ("Available for watch party", "In the mood for comedies") that automatically update recommendation biases when friends browse together.
- Layer in quiet hours, digest emails, and granular notification preferences so social chatter stays delightful instead of overwhelming.
- When friends go live in a party or start a new review thread, deliver real-time toasts with quick-action buttons (join, react, save for later).

### 7. Extend the Social Graph Across Platforms
- Ship a share-target integration so mobile users can send a title from any streaming app directly into Smart Movie Match with a comment for friends.
- Explore optional push notifications via the PWA install, ensuring badge wins or party invites reach people even when the site is closed.
- Provide an API for third-party bots (Discord, Slack) to broadcast watch parties or community highlights into existing friend hubs.
