# SmartMovieMatch UI/UX Redesign
## Codex Coding Instructions – Read and Implement This Spec

**SmartMovieMatch – Codex Implementation Meta Instructions**

> **Audience:** Codex (coding agent)  
> **Goal:** Implement this spec **gradually, one feature group at a time**, and keep this file updated as the source of truth for what’s done and what’s left.

### How Codex should work through this spec

1. **Always work in order, one section at a time.**  
   Start with the main feature sections:
   - `1. Make social features impossible to miss`  
   - `2. Make profiles feel like real “movie personas”`  
   - `3. Deepen community reviews & comments`  
   - `4. Collaborative lists that feel actually collaborative`  
   - `5. Watch parties that feel live, not just scheduled`  
   - `6. Presence that actually leads to interaction`  
   - `7. Social notifications that feel like a feed`  
   - `8. Safety, comfort, and control in the social layer`  
   - `9. Reduce friction to find and follow people`  

   Then move on to the page-specific implementation sections:
   - `1. index.html – Discovery / Home`  
   - `2. profile.html – Profile Overview`  
   - `3. peeruser.html – Peer / Friend Profile`  
   - `4. login.html – Auth Page`  
   - `5. account-settings.html – Account & Security`  

2. **Within a section, finish the basics first.**  
   For each numbered section above:
   - Implement the **core UI & UX changes** first (layout, structure, key elements).
   - Then implement **data wiring** (using the existing data model and API the spec assumes).
   - Only after that, add **refinements** (copy polishing, microinteractions, animations).

3. **Do not skip around unless explicitly told.**  
   If a section is not fully marked as `DONE`, treat it as **not finished**, even if some of the work exists in code. Continue from where this file says you left off.

---

### How Codex should mark progress inside this file

For **every major feature group heading** (the nine sections listed above) **and each page-specific section**, add and maintain a status line **immediately under the heading**, in this exact format:

```text
[Codex status: TODO]  (Last updated: YYYY-MM-DD by Codex)
```

Codex must update this line as it works:

- When starting real implementation work on a section:  
  `[Codex status: IN PROGRESS]  (Last updated: 2025-11-13 by Codex)`
- When the section is functionally implemented and merged:  
  `[Codex status: DONE]  (Last updated: 2025-11-20 by Codex)`
- If a section is partially implemented or blocked:  
  `[Codex status: PARTIAL / BLOCKED – see notes at bottom of section]`

Codex should **never delete** older dates; instead it should overwrite the whole status line with the latest state.

---

### How Codex should update this document after coding

After each coding session, Codex must:

1. **Update the status line** under every section it touched.
2. **Add a short “Implementation notes for Codex” sub-block** at the bottom of that section if helpful, like:

   ```text
   Implementation notes for Codex (internal):

   - Review filters UI is wired, but reactions bar is still stubbed.
   - Next pickup point: implement reactions aggregation and filter logic in community.js.
   ```

3. **Use this file as the “resume point.”**  
   Next time Codex is called, it should:
   - Scan from the **top** to find the **first section whose status is not `DONE`**.
   - Read that section and its “Implementation notes for Codex.”
   - Continue from there.

---

### Section order Codex should follow (high-level checklist)

1. Make social features impossible to miss  
2. Make profiles feel like real “movie personas”  
3. Deepen community reviews & comments  
4. Collaborative lists that feel actually collaborative  
5. Watch parties that feel live, not just scheduled  
6. Presence that actually leads to interaction  
7. Social notifications that feel like a feed  
8. Safety, comfort, and control in the social layer  
9. Reduce friction to find and follow people  

Then:

10. index.html – Discovery / Home  
11. profile.html – Profile Overview  
12. peeruser.html – Peer / Friend Profile  
13. login.html – Auth Page  
14. account-settings.html – Account & Security  

Codex should **not jump ahead** to later sections if earlier ones are still marked as `TODO` or `IN PROGRESS`.

---


You are an expert UX/UI designer and frontend architect. Code the following.

## 1. Make social features impossible to miss
[Codex status: DONE]  (Last updated: 2025-11-13 by Codex)


Social “first-run” nudge on the home page

When someone has no friends yet, show a small card near recommendations:
“Sign in and follow friends to see which picks they loved (or hated).”

Re-use your existing Social circle stats (“X following, Y followers, Z mutuals”) as a mini preview.

Inline friend badges on recommendation cards

On each movie card, show subtle friend context like:

“3 friends watched · 1 rewatching now”

“Anna rated 9/10 · Sam dropped at 20 min”

You already track watch history and reviews; pipe that into the condensed header for each movie, not just the full community section.

Home-page “Friends activity” slice

Add a small vertical strip or row on the discovery page with:

“Recently watched by friends”

“New lists from people you follow”

Use your user_activity / recordLibraryActivity data so this feels alive even if the user never opens the full social profile page.

Implementation notes for Codex (internal):

- Discovery now includes a social-first nudge card plus a live friends activity panel sourced from notifications and collaborative list data.
- Recommendation cards surface inline friend context via the condensed community header, so the social signal is visible even before expanding a movie.



## 2. Make profiles feel like real “movie personas”
[Codex status: DONE]  (Last updated: 2025-11-13 by Codex)


Taste compatibility badge on friend / peer profiles

On social-profile / peeruser pages, show a simple badge like:

“Taste match: 82% – you both love quirky sci-fi and 90s thrillers.”

Base it on overlap of favorites, genres, and watch diary entries you already store.

Highlight “Story of this friendship” section

Collate: shared favorites, shared genres, overlapping watch history, and watch parties into a short story block, e.g.:

“You’ve watched 17 of the same movies, 4 parties together, and both favor slow-burn thrillers.”

This makes the profile feel personal, not just a list of stats.

Pin favorite lists and reviews on profiles

Let users “pin” one list and one review to the top of their profile (e.g. “All-time comfort movies”).

That immediately gives visitors something to explore and talk about.

Implementation notes for Codex (internal):

- Taste compatibility badge, story grid, and pinned-content placeholders now render on social profile overlays/pages, using shared overlap data to keep cards populated even without bespoke pins.
- Persona pins now pull from the personaPins snapshot data that lives in auth preferences, so list/review CTAs link to the owner’s actual highlights instead of fallback summaries.



## 3. Deepen community reviews & comments
[Codex status: DONE]  (Last updated: 2025-11-13 by Codex)


Richer filters for community reviews

You already have “Everyone / Friends” filtering; add light sorting:

“Top from friends” · “Most liked” · “Newest”

This keeps threads more navigable on popular titles.

Use reactions as quick sentiment summaries

Above the review list, show a compact bar:

👍 x24 · ❤️ x10 · 😂 x5 · 😮 x3

Then let users filter to “Reviews with ❤️” or “Reviews with 😮” to quickly find emotional / surprising takes.

Implementation notes for Codex (internal):

- Review sections now include sentiment filters, sort tabs, and inline “From your friends” highlights before the global feed.
- Reply forms surface rotating prompt chips to nudge threaded replies and use reaction summaries to drive emoji filtering.

Threaded reply hints and prompts

When someone starts a comment thread, show a little hint:

“Ask what they’d pair this with”

“Agree or disagree with their take”

Tiny copy changes can double comment volume.

“Friends first” view for community threads

When you know there’s friend activity, show a mini block at the top:

“From your friends: [X’s 4-star review] · [Y’s 2-star rant]”

Then list the global community below.



## 4. Collaborative lists that feel actually collaborative
[Codex status: DONE]  (Last updated: 2025-11-13 by Codex)


Suggestions when creating a collaborative list

In the “Collaborative lists & watch parties” area, when a user creates a list:

Pre-suggest a few friends from your suggestions in socialOverview, like “People who share a lot of favorites with you.”

One click to add them makes it much more social.

Voting on list items

For collaborative lists, add optional voting: thumbs up/down or “This tonight?” toggle per movie.

Use that to auto-sort the list so “group favorites” float to the top.

Per-list micro-discussion

Attach a tiny comment thread to each collaborative list (even just the last 3 messages visible inline).

This gives people a place to negotiate why a movie is or isn’t on the list.

Implementation notes for Codex (internal):

- Collaborative list creation now surfaces suggested collaborators pulled from social matches and automatically invites selected handles after the list is created.
- Collaborative cards show live vote buttons tied to new API endpoints so “yes/no” sentiment reorders preview chips and highlights top picks.
- Each card includes a lightweight chat thread with the latest three messages plus an inline composer for owners/collaborators.



## 5. Watch parties that feel live, not just scheduled
[Codex status: DONE]  (Last updated: 2025-11-13 by Codex)


Pre-party lobby state

For upcoming watch parties, show a “lobby” view: who’s marked “In”, who’s “Maybe”, and what people are planning to watch next.

Add a simple “What snack / vibe are you bringing?” text chip; it makes the event feel more human.

Auto-suggest party invitees

When scheduling a watch party, suggest:

Frequent collaborators

Friends with high overlap on the chosen movie’s genres

This uses data you already have (tags, favorites, history) to reduce friction.

Post-party summary

After the scheduled time passes, create a small summary card in the social area:

“4 friends joined · average rating 8.1 · 2 new reviews.”

It nudges people to leave reviews right after watching.

Implementation notes for Codex (internal):

- Watch party cards now include a lobby row that groups invitees by status and highlights snack/vibe chips from each RSVP.
- The invite form surfaces smart friend suggestions plus selectable chips that autofill the invite list.
- Once a party time passes, hosts and attendees see a summary tile with joined counts and a nudge to post a fresh review.



## 6. Presence that actually leads to interaction
[Codex status: DONE]  (Last updated: 2025-11-14 by Codex)


Presence chips on movie cards & lists

You already have presence presets like “Available for watch party” or “Rewatching comfort classics”.

When a movie appears in recommendations or a collaborative list, add a subtle text like:

“Sam is currently in ‘In the mood for comedies’.”

It’s a soft nudge to invite them.

Quick action from presence list

In the “Friends online” section, add buttons like:

“Invite to watch party”

“Send this movie to them” (share a specific title)

Turn presence from a passive indicator into an action launcher.

Auto-expiring statuses

For time-sensitive presets (“Available for watch party”), let users pick a duration (e.g. 2 hours).

When it expires, automatically drop them back to “Just browsing” so presence stays accurate.

Implementation notes for Codex (internal):

- Recommendation cards and collaborative lists now include inline presence chips fed by the live presence map so friends feel inviteable at a glance.
- The “Friends online” list adds invite/share quick actions plus an inline composer; sharing currently surfaces confirmation toasts while the direct messaging backend is still pending.
- Status presets respect auto-expire durations (30 min to 4 hours) with local timers that reset users to “Just browsing” and sync the change back to the presence service.



## 7. Social notifications that feel like a feed
[Codex status: DONE]  (Last updated: 2025-11-13 by Codex)


Social-first notification grouping

Group notifications into bands like:

“New from your friends” (follows, reviews, lists, watch parties)

“Account & sync” (less important stuff)

On the bell panel, show the social group at the top by default.

Contextual “open destination” buttons

For each notification, lead straight to the social context:

Follow request → Social circle tab

New review on a movie you watched → Open that movie with the community section focused

Watch party invite → Watch party details with RSVP buttons ready

Soft “unread social activity” indicator on nav

Add tiny dot or count near the Profile/Social link when there’s new social activity, not just system notifications.

This keeps the social area feeling active without being spammy.

Implementation notes for Codex (internal):

- Notification center now groups entries into “New from your friends” and “Account & sync”, adds contextual CTA buttons, and updates the social nav indicator across every page.
- Discovery cards respond to notification deep links by auto-expanding the relevant movie and pulsing the community section; profile links honor context anchors for follow, collab, and watch-party invites.



## 8. Safety, comfort, and control in the social layer
[Codex status: DONE]  (Last updated: 2025-02-14 by Codex)


Expose blocking / muting in the UI

Your follow table supports a status (including a “blocked” state); surface this in the profile overlay and social lists as a quiet “Block / Mute user” option.

Give blocked users’ content a clear “hidden” mode in community reviews and comments.

Tone & spoiler guidelines near review forms

Next to the community review textareas, add one line of guidance:

“Keep it constructive and mark spoilers. Use [spoiler]…[/spoiler] for big reveals.”

This improves the overall quality of social content with almost no extra UI.

Per-movie “friend visibility” control

Let users optionally mark certain reviews or diary entries as “private” or “friends only”.

That encourages sharing honest takes without worrying everything is public.

Implementation notes for Codex (internal):

- Comment threads now respect the same hidden-content rules as reviews, and the reveal notice wires to unblock/unmute helpers.
- Follow lists and peer profiles surface dedicated safety controls (block/mute) plus new chips so members always see current status.



## 9. Reduce friction to find and follow people
[Codex status: TODO]  (Last updated: 2025-11-13 by Codex)


Inline follow buttons wherever names appear

Whenever you render a username (review, comment, lists, watch party cards), show a tiny “Follow” pill or icon next to unfollowed people.

It should feel like Twitter/Letterboxd: see someone interesting → follow in one click.

Smart suggestions: “People you might like” on discovery

Use your socialOverview.suggestions to show 2–3 people on the main page:

“Because you like X and Y, you might enjoy following…”

This turns social discovery into part of the recommendation loop, not a separate tab.

Search with social context

In the member search, show why each person is recommended:

“Shares 14 favorites”

“Also into horror / sci-fi”

You already compute shared favorites and interests; surface those signals directly in the search results.



## 1. index.html – Discovery / Home
[Codex status: TODO]  (Last updated: 2025-11-13 by Codex)


Goal: “What should I watch right now?” + “What are my people into?” should be the first things you feel.

### A. Re-prioritize panels

Make #recommendationsPanel visually primary.

(.right-column): change the order so the stack becomes:

#preferencesPanel (“Your vibe”)

#recommendationsPanel

#collectionsPanel

This way, even brand-new users see the “Find movies for me” results quickly instead of empty lists.

### B. Tighten the “Your vibe” panel

Collapse less-critical copy.
The “The more you share…” hint text is good, but a bit long. Shrink it into one short line and give more vertical space to:

Vibe presets (the cards)

Genre pills

Group controls by intent:
Within #prefsForm, visually split into:

“Jump in with a preset” (vibe cards)

“Fine-tune genres” (genre pills)

(If you add more filters later) “Advanced filters” in a collapsible <details> block.
This keeps the left column feeling like a clear 1-2-3 flow instead of a long scroll of controls.

### C. Make social signals more discoverable in rec cards

(Using the social data you already collect through social.js / community sections.)

Surface “friends & community” at card level.
In each recommendation card inside #recommendationsGrid, reserve a small row under the title for:

Friend avatars / count who rated or watched

A tiny label like “3 friends liked this • Avg 8.2/10”

Inline “Leave a quick note” entry point.
From buildCommunitySection, make the short review field reachable via:

A “Community notes” toggle on each card, or

A single “Open notes” icon that expands the community block in place.
Layout-wise, keep the movie details visible; have the community area slide down underneath.

### D. Make the current “vibe” + filters obvious above the grid

In the #recommendationsPanel header, turn #recMetaPrimary + the genre/mood info into one compact pill row:

“Cozy Sci-Fi • Genres: Sci-Fi, Adventure • IMDb 7+ • Streamable now”

Add a tiny “Clear all” filter pill on the right so people aren’t hunting through the left panel to reset.



## 2. profile.html – Profile Overview
[Codex status: TODO]  (Last updated: 2025-11-13 by Codex)


Goal: This page should answer: “Who am I on Smart Movie Match?” (taste + social footprint) in a quick scroll.

### A. Add a proper profile hero at the top

Right now the top is “🧾 Profile overview” + subtitle, while the avatar and name live mostly in the account pill.

Above or inside .profile-callout, add a hero strip that shows:

Avatar (#accountAvatar / #settingsAvatarPreview)

Display name

@handle (from username / canonical handle)

Tagline (from profile.tagline if present)

Move the Followers / Following / Mutual followers stats (currently in .social-overview-stats) up into this hero row. That gives users an immediate “social snapshot”.

### B. Simplify the “pulse” card layout

The big #profileOverviewCallout currently mixes library stats, genre donut, taste highlights, saved genres, and quick links in a single dense block.

Use a two-column layout inside the callout:

Left column: core stats + genre donut + one sentence summary (“Leans sci-fi with occasional drama.”).

Right column: Latest favorites and Recently watched snapshots only (the two snapshot sections starting at lines ~204+).

Move saved genres chips and taste highlight list to a secondary section below, titled “Taste details”, so the main callout feels like a punchy overview rather than a dashboard.

### C. Strengthen navigation from profile to activity

In .profile-callout-quick-links, visually group links into:

“Your library” (Jump to favorites / Jump to watched history)

“Your account” (Manage account settings / back to discovery)


### D. Clean up the social section hierarchy

The social block is rich but quite spread out (highlights, badges, presence, collab lists, search, invites).

Wrap all of it in a clearly titled panel, e.g. “Connections & collabs”, with a short subtitle.

Reorder child sections for scannability:

Social stats + highlights (.social-overview-stats + highlight cards)

Presence status & “who’s online” (.social-presence-block)

Collaborative lists (.social-collab-column)

“Find friends” search + suggestions grid

“Share your profile” (invite link + QR)

On mobile, collapse some areas with <details>:

e.g. “Recognition badges” and “Collaborative lists” can be expandable, leaving “Find friends” and “Share profile” more visible.



## 3. peeruser.html – Peer / Friend Profile
[Codex status: TODO]  (Last updated: 2025-11-13 by Codex)


This page wraps the same #socialProfileBody content from the overlay but uses the full-page profile-main layout.

Goal: Quickly answer “Should I follow / collaborate with this person?” with minimal scrolling.

### A. Turn the friend profile into a full hero layout

Right now, the title is controlled via #socialProfileTitle and details are appended in renderSocialProfileContent.

At the top of the page, above the main panel, add a friend profile hero that includes:

Display name (socialProfileTitleEl)

@handle (normalized username)

Tagline (social-profile-tagline)

Follow / Unfollow button (currently appended as .modal-actions)

Display key overlap stats inline below the name, e.g.:

“Shared favorites: 12 • Recently watched overlap: 4 • Watch parties together: 1”
You already get these arrays (sharedFavorites, sharedWatchHistory, sharedWatchParties); just summarise counts in the hero.

### B. Group overlap sections into a clear grid

renderProfileTagSection renders headings like Shared favorites, Shared genres, Recently watched overlap, Watch parties together each with their chip list.


### C. Make mutual connections more visible

You already calculate mutual followers in the profile object.

Right under the hero, add a subtle strip: “Mutual followers: N” with up to 3 avatars and a “+ more” label that opens a mini list (reusing the social list item rendering from buildSocialListItem).
That’s a very strong social signal and deserves top placement.



## 4. login.html – Auth Page
[Codex status: TODO]  (Last updated: 2025-11-13 by Codex)


Goal: Make it obvious what you get socially by signing in, and get people through the form with as little friction as possible.

### A. Emphasize the two modes more clearly

You already have auth-mode-tabs for “Sign in” / “Create account”.

Give the active tab a stronger visual cue (background, border) and add a tiny line of copy under the inactive one when hovered/focused, e.g.:

“Sign in – for existing members”

“Create account – takes less than a minute”

On mobile, ensure these tabs are full-width buttons stacked or a segmented control so they’re easy to hit.

### B. Move key benefits closer to the form

duplicate or collapse the top 2–3 bullet benefits directly under the auth-card-subtitle, so people see:

“Sync your taste profile”

“See friends’ trends”

“Join collaborative watchlists”

### C. Clarify social context in microcopy

In the subtitle (#authSubtitle), mention the social angle explicitly:

“…and connect your profile with friends for shared recommendations.”

In one of the auth-story-cards, add a concrete social example:

“See when your friends add something you loved.”

### D. Streamline error/feedback placement

Ensure #authStatus appears directly below the submit button, not at the very bottom of the card visually, and style it consistently (success vs error). It’s already there, but you can give it a high-contrast label (“Error:” / “Success:”) and minimal margin so it feels attached to the form.



## 5. account-settings.html – Account & Security
[Codex status: TODO]  (Last updated: 2025-11-13 by Codex)


Goal: Make it effortless to manage identity + safety, while hinting at how that affects the social side.

### A. Make the signed-out state lighter and clearer

#accountSettingsSignedOut currently sits in the main panel.

Center that block vertically a bit more and shrink the copy to one short sentence:

“Sign in to update your profile and security settings.”

Add a secondary link back to login.html labelled “Switch account” to be explicit about multiple profiles.

### B. Split “Profile” into identity vs social discoverability

In the Profile card (#accountProfileForm):

Visually group fields into:

Identity: Display name, avatar upload (what friends see).

Handle + tagline: how people find you (if/when those fields are editable in this UI).

Sync info: a brief line about where this profile shows up (e.g., “Used for favorites, reviews, and friend suggestions.”)

Add inline helper text that ties these fields to social features:

For display name: “Shown to friends and collaborators.”

For avatar: “Used across friend profiles and watch parties.”

### C. Make the security section more reassuring, less intimidating

In the Security card (#accountSecurityForm):

Use a 2-step visual layout:

Step 1: “Confirm current password”

Step 2: “Choose a new password” (new + confirm side by side )

Under the “Email verification” checkbox area (currently mostly static text), add a tiny line of copy:

“Used for sign-in alerts and important security notifications only.”
This reinforces safety without adding new functionality.

### D. Improve local navigation within settings

You already have .settings-anchor elements for #profile and #security.

Add a small sticky “Settings” sidebar or top tabs that link to those anchors:

“Profile”

“Security”

On mobile, make this a horizontal pill strip at the top of #accountSettingsContent so users can jump directly without scrolling.



## 1. index – Home / Discovery


Layout: Single column, stacked.

Order from top to scroll:

App header: logo, search icon, notification icon, avatar.

Current vibe card (full width).

Vibe presets carousel (horizontal scroll).

Genre/filter chips (line wraps).

Main Recommendations list (vertically scrolling cards).

Social strip visible on each card.

Immediately after the first 3–4 recs: Friends Activity block.

Then: “Your lists & collections”.



## 2. profile – My Profile Overview


Order from top to scroll:

Profile hero (centered):

Avatar, display name, handle, tagline.

Social stats row underneath.

Taste summary strip.

Pinned content card.

Recent activity snippet.

Social circle overview.

Collaborative lists & watch parties.

Suggested people to follow.

Columns collapse into stacked blocks; actions like “Edit profile”, “View library” become horizontal button row under stats.



## 3. peeruser – Someone Else’s Profile


Order from top:

Peer hero:

Avatar, name, handle, tagline.

Taste match badge with short description.

Follow button.

Social stats/mutuals row.

Overlap grid sections stacked one after another.

Pinned content.

Lists & recent activity.

Engagement prompts at the bottom (sticky follow button could also be used on scroll).



## 4. login – Sign In / Create Account



Order from top:

App logo/title.

Auth header + subtitle.

Mode switcher (Sign in / Create account).

Form.

Submit + secondary actions.

Beneath the form (same page, no second column): “Why create an account?” bullet list (shortened).

The benefits panel is collapsed into a section under the form so the user still sees the social value with minimal scrolling.



## 5. account-settings – Profile & Security


Order from top:

Settings header: “Account Settings”.

Horizontal tab strip: “Profile” | “Security”.

Selected tab content:

For Profile: profile fields card.

For Security: password/email card.

Signed-out state uses the same sign-in card, full-width.

Everything’s a vertical stack with large tap targets; sidebar becomes top tabs.



1. How notifications should work in SmartMovieMatch

A. Types of notifications

Keep it simple and social-focused:

Social activity

Someone followed you

Someone you follow posted a new review or list

You were invited to a watch party / collaborative list

Your list got a new follower or vote

Someone replied to your review/comment

Recommendation / content

“New recommendations based on your recent watch”

“A movie from your watchlist is now on a streaming service you use”

Account & security

Email/password changes

Verification reminders

Login from a new device (if you ever support that)

In the UI, you can group 1 & 2 together as “New from your friends” / “For you”, and 3 as “Account & security.”



B. Global UI pattern

1. Bell icon in the header (all signed-in pages)

Top-right in the main nav, next to avatar.

Shows a badge with the count of unread social notifications (or just a dot if you want to stay calm).

2. Notification panel (dropdown)

Clicking the bell opens a panel anchored to it.

Panel has two sections:

“New from your friends” – social + recs.

“Account & security” – password, email, etc.

Each item is a small card:

Icon/avatar

One-line sentence

Time (“5m ago”)

Clickable → deep-links to the relevant place:

Movie page with the community section focused

Peer profile

Watch party page

List page

3. Optional full notifications page

If you want: a dedicated “Notifications” page linked at the bottom of the panel:
➜ “View all notifications”

Same grouping, but shows longer history (e.g. 30 days).



C. What shows where (per page)

index (home / discovery)

Bell in the top nav with badge.

Optionally, a small inline “From your friends” section on the page surface that mirrors recent social notifications:

Example row:

“Alex created a new list: ‘Underrated 90s sci-fi’ – View list”

“Sam rated Dune 9/10 – See their review”

profile (my profile)

Add a block like “Activity about you”:

“New followers”

“New reactions to your reviews”

“New votes on your collaborative lists”

This can reuse the same notification items, filtered to “things where I am the target.”

peeruser (someone else’s profile)

No dedicated notification section needed.

But if I landed here from a notification (“Alex followed you”), you can show a tiny banner at the top:

“Alex recently followed you · Follow back?”

login

No notification UI, but microcopy can mention:

“We may email you about important account/security events and major updates. Social activity stays in-app.”

account-settings

Add a “Notifications” subsection (now or in future):

Switches/checkboxes like:

“Email me about security events”

“Email me when I get a follow”

“Email me about watch party invites”

Clarify that in-app notifications (bell) always exist; email is optional.



D. Behavior & feel

Unread vs read

Different background or bold title for unread items.

Clicking an item marks it read (and reduces the badge count).

Option: “Mark all as read” button in the panel.

Social-feed feeling

Items read like a mini feed:

“Sam invited you to a watch party: ‘Horror Night’ – View”

“3 friends reviewed Blade Runner 2049 – See reviews”

Use friend avatars and movie posters to make it visually scannable.

Prioritization

Watch party invites, direct replies, and follows appear at the top.

Slower things like “someone you follow rated something” can come after.



## 1. Top-level goals for peeruser

The page should:

Feel like a “movie persona card” for this person.

Immediately show taste compatibility and overlap.

Make Follow / collaborate / start watch party very obvious.

Show their activity that’s relevant to you (lists, reviews, parties).



Order from top to scroll:

(If applicable) context banner

Hero (centered):

Avatar, name, handle, tagline.

Taste match badge.

Social stats.

Follow button (full width).

Overlap section

Cards stacked:

Shared favorites

Shared genres

Recent overlapping watches

Watch parties together

Pinned content

Top lists

Recent activity

Make Follow button easy to tap (full-width, just below stats).



## 4. States & behaviors

### A. Not following vs following

Not following:

Big primary Follow button in hero.

In overlap sections, nudge text:

“High taste match – following them will improve your social feed.”

Following:

Button becomes “Following” (with an option to unfollow via dropdown).

Maybe subtle text:

“You’ll see their reviews and lists in your social feed.”

### B. If the profile is limited/private (if you ever add that)

Hero still shows basic identity + “This profile is private.”

Overlap and activity sections replaced with:

“Follow to see their lists and reviews (if they approve).”



## 5. How notifications tie in (in short)

If you clicked a notification to reach this page, show the context banner and maybe highlight the relevant item in Recent activity or Pinned content.

Examples:

Notification: “Alex followed you” → banner with “Follow back” button.

Notification: “Sam invited you to a watch party” → banner with “View party” and a “Going/Maybe/No” choice.

Notification: “Maya replied to your review” → banner: “View discussion”, which jumps to the movie’s review thread.


---

**SmartMovieMatch – Codex Implementation Tracker (Summary)**

> This section is a quick at-a-glance summary. The **source of truth** is still the status lines under each section heading.

- [x] 1. Make social features impossible to miss  (Done: 2025-11-13 by Codex)
- [x] 2. Make profiles feel like real “movie personas”  (Done: 2025-11-13 by Codex)
- [x] 3. Deepen community reviews & comments  (Done: 2025-11-13 by Codex)
- [x] 4. Collaborative lists that feel actually collaborative  (Done: 2025-11-13 by Codex)
- [x] 5. Watch parties that feel live, not just scheduled  (Done: 2025-11-13 by Codex)
- [x] 6. Presence that actually leads to interaction  (Done: 2025-11-14 by Codex)
- [x] 7. Social notifications that feel like a feed  (Done: 2025-11-13 by Codex)
- [ ] 8. Safety, comfort, and control in the social layer
- [ ] 9. Reduce friction to find and follow people

- [ ] 1. index.html – Discovery / Home
- [ ] 2. profile.html – Profile Overview
- [ ] 3. peeruser.html – Peer / Friend Profile
- [ ] 4. login.html – Auth Page
- [ ] 5. account-settings.html – Account & Security

**Codex instructions for this tracker:**

- When a section’s main status line is updated to `DONE`, also tick the corresponding box above and add a date, e.g.:

  `- [x] 1. Make social features impossible to miss  (Done: 2025-11-20 by Codex)`

- Use this list only as a **quick progress overview**. Any detailed “where to pick up” information belongs in:
  - the **status line** under the section heading and
  - the **“Implementation notes for Codex”** at the bottom of that section.
