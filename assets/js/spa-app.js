import { fetchFromTmdb } from "./api.js";
import {
  discoverCandidateMovies,
  scoreAndSelectCandidates,
  fetchOmdbForCandidates
} from "./recommendations.js";
import { TMDB_GENRES } from "./config.js";
import {
  loadSession,
  loginUser,
  logoutSession,
  registerUser,
  subscribeToSession
} from "./auth.js";
import { initSocialFeatures, subscribeToSocialOverview } from "./social.js";

const defaultTabs = {
  friends: "feed",
  discover: "movies",
  home: "for-you",
  library: "watchlist",
  profile: "overview"
};

const state = {
  activeTabs: { ...defaultTabs },
  activeSection: "home",
  discoverFilter: "popular",
  discoverAbort: null,
  recommendationsAbort: null,
  recommendationSeed: Math.random(),
  homeRecommendations: [],
  discoverPeople: [],
  discoverLists: [],
  session: loadSession(),
  socialOverview: null,
  accountMenuOpen: false,
  authMode: "login",
  authSubmitting: false
};

const authRequiredViews = [
  {
    section: "friends",
    message: "Sign in to see your friends feed and requests."
  },
  {
    section: "library",
    message: "Sign in to view your watchlist and lists."
  },
  {
    section: "profile",
    message: "Sign in to view your profile and diary."
  },
  {
    section: "home",
    tab: "with-friends",
    message: "Sign in to plan watch parties with friends."
  }
];

const navButtons = document.querySelectorAll("[data-section-button]");
const sections = document.querySelectorAll("[data-section-panel]");
const tabGroups = document.querySelectorAll("[data-section-tabs]");
const discoverSearchInput = document.querySelector("[data-discover-search]");
const discoverGrid = document.querySelector('[data-grid="discover-movies"]');
const discoverPeopleList = document.querySelector('[data-list="discover-people"]');
const discoverListCards = document.querySelector('[data-list="discover-lists"]');
const homeRecommendationsRow = document.querySelector('[data-row="home-recommendations"]');
const tonightPickCard = document.querySelector("[data-tonight-pick]");
const groupPicksList = document.querySelector('[data-list="group-picks"]');
const authOverlay = document.querySelector("[data-auth-overlay]");
const authForm = document.querySelector("[data-auth-form]");
const authStatus = document.querySelector("[data-auth-status]");
const authUsernameInput = document.querySelector("[data-auth-username]");
const authPasswordInput = document.querySelector("[data-auth-password]");
const authDisplayNameRow = document.querySelector("[data-auth-display-name-row]");
const authDisplayNameInput = document.querySelector("[data-auth-display-name]");
const authModeButtons = document.querySelectorAll("[data-auth-mode]");
const authTitle = document.querySelector("[data-auth-title]");
const authOpenButton = document.querySelector("[data-auth-open]");
const authCloseButton = document.querySelector("[data-auth-close]");
const authSubmitButton = document.querySelector("[data-auth-submit]");
const accountMenu = document.querySelector("[data-account-menu]");
const accountToggle = document.querySelector("[data-account-toggle]");
const accountName = document.querySelector("[data-account-name]");
const accountHandle = document.querySelector("[data-account-handle]");
const accountAvatar = document.querySelector("[data-account-avatar]");
const accountLogoutButton = document.querySelector("[data-account-logout]");
const accountProfileButton = document.querySelector("[data-account-profile]");
const accountSettingsButton = document.querySelector("[data-account-settings]");
const profileName = document.querySelector("[data-profile-name]");
const profileHandle = document.querySelector("[data-profile-handle]");
const profileBio = document.querySelector("[data-profile-bio]");
const profileLocation = document.querySelector("[data-profile-location]");
const profileAvatar = document.querySelector("[data-profile-avatar]");
const profileStats = {
  films: document.querySelector('[data-profile-stat="films"]'),
  diary: document.querySelector('[data-profile-stat="diary"]'),
  followers: document.querySelector('[data-profile-stat="followers"]'),
  following: document.querySelector('[data-profile-stat="following"]')
};

function hasActiveSession() {
  return Boolean(state.session && state.session.token);
}

function getAuthGuard(section, tab) {
  return authRequiredViews.find(
    (entry) =>
      entry.section === section &&
      (entry.tab === undefined || entry.tab === null || entry.tab === tab)
  );
}

function canAccessView(section, tab) {
  const guard = getAuthGuard(section, tab);
  return !guard || hasActiveSession();
}

function promptForAuth(section, tab) {
  const guard = getAuthGuard(section, tab);
  if (!guard) return;
  setAuthStatus(guard.message, "error");
  openAuthOverlay("login");
}

function ensureAccessibleSection() {
  const section = state.activeSection;
  const tab = state.activeTabs[section] || defaultTabs[section];
  if (canAccessView(section, tab)) return;
  setSection("discover");
}

function setSection(section) {
  const targetTab = state.activeTabs[section] || defaultTabs[section];
  if (!canAccessView(section, targetTab)) {
    promptForAuth(section, targetTab);
    return;
  }

  state.activeSection = section;
  navButtons.forEach((btn) => {
    const isActive = btn.dataset.sectionButton === section;
    btn.classList.toggle("is-active", isActive);
  });

  sections.forEach((panel) => {
    const isActive = panel.dataset.sectionPanel === section;
    panel.classList.toggle("is-active", isActive);
  });

  tabGroups.forEach((group) => {
    const isActive = group.dataset.sectionTabs === section;
    group.classList.toggle("is-active", isActive);
  });

  setTab(section, targetTab);
}

function setTab(section, tab) {
  if (!canAccessView(section, tab)) {
    promptForAuth(section, tab);
    return;
  }

  state.activeTabs[section] = tab;
  const group = document.querySelector(`[data-section-tabs="${section}"]`);
  const panels = document.querySelectorAll(
    `[data-section-panel="${section}"] [data-tab-panel]`
  );

  if (group) {
    group.querySelectorAll("[data-tab]").forEach((btn) => {
      const isActive = btn.dataset.tab === tab;
      btn.classList.toggle("is-active", isActive);
    });
  }

  panels.forEach((panel) => {
    const isActive = panel.dataset.tabPanel === tab;
    panel.classList.toggle("is-active", isActive);
  });
}

function createPoster(url) {
  const poster = document.createElement("div");
  poster.className = "poster";
  if (url) {
    poster.style.backgroundImage = `url(${url})`;
    poster.style.backgroundSize = "cover";
    poster.style.backgroundPosition = "center";
  }
  return poster;
}

function formatGenres(ids = []) {
  const names = ids
    .map((id) => TMDB_GENRES[id] || "")
    .filter(Boolean)
    .slice(0, 2);
  return names.join(" · ");
}

function initialsFromName(name = "") {
  if (!name) return "👤";
  const letters = name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return letters || "👤";
}

function setAuthStatus(message, variant = "info") {
  if (!authStatus) return;
  authStatus.textContent = message || "";
  authStatus.classList.remove("error", "success");
  if (variant === "error") {
    authStatus.classList.add("error");
  }
  if (variant === "success") {
    authStatus.classList.add("success");
  }
}

function setAuthMode(mode) {
  state.authMode = mode === "signup" ? "signup" : "login";
  authModeButtons.forEach((btn) => {
    const isActive = btn.dataset.authMode === state.authMode;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  if (authDisplayNameRow) {
    authDisplayNameRow.classList.toggle("is-hidden", state.authMode !== "signup");
  }
  if (authTitle) {
    authTitle.textContent =
      state.authMode === "signup"
        ? "Create your Smart Movie Match account"
        : "Sign in to Smart Movie Match";
  }
  if (authPasswordInput) {
    authPasswordInput.autocomplete =
      state.authMode === "signup" ? "new-password" : "current-password";
  }
}

function openAuthOverlay(mode = state.authMode) {
  setAuthMode(mode);
  setAuthStatus("");
  state.authSubmitting = false;
  if (authOverlay) {
    authOverlay.hidden = false;
    authOverlay.classList.add("is-visible");
  }
  if (authUsernameInput) {
    authUsernameInput.focus();
  }
}

function closeAuthOverlay() {
  if (!authOverlay) return;
  authOverlay.classList.remove("is-visible");
  authOverlay.hidden = true;
}

function toggleAccountMenu(forceOpen = null) {
  if (!state.session || !state.session.token) return;
  const next = forceOpen === null ? !state.accountMenuOpen : Boolean(forceOpen);
  state.accountMenuOpen = next;
  if (accountMenu) {
    accountMenu.classList.toggle("is-open", next);
  }
  if (accountToggle) {
    accountToggle.setAttribute("aria-expanded", next ? "true" : "false");
  }
}

function updateAccountUi(session) {
  state.session = session || null;
  const hasSession = Boolean(state.session && state.session.token);
  if (authOpenButton) {
    authOpenButton.classList.toggle("is-hidden", hasSession);
  }
  if (accountToggle) {
    accountToggle.classList.toggle("is-visible", hasSession);
    accountToggle.setAttribute("aria-expanded", hasSession && state.accountMenuOpen ? "true" : "false");
  }
  if (accountMenu && !hasSession) {
    accountMenu.classList.remove("is-open");
    state.accountMenuOpen = false;
  }
  if (accountName) {
    accountName.textContent = hasSession
      ? state.session.displayName || state.session.username
      : "Guest";
  }
  if (accountHandle) {
    accountHandle.textContent = hasSession && state.session.username
      ? `@${state.session.username}`
      : "@guest";
  }
  if (accountAvatar) {
    accountAvatar.style.backgroundImage = "";
    if (hasSession && state.session.avatarUrl) {
      accountAvatar.style.backgroundImage = `url(${state.session.avatarUrl})`;
      accountAvatar.textContent = "";
    } else {
      accountAvatar.textContent = initialsFromName(
        hasSession
          ? state.session.displayName || state.session.username
          : "Guest"
      );
    }
  }

  if (!hasSession) {
    ensureAccessibleSection();
  }

  renderProfileOverview();
}

function renderProfileOverview() {
  const hasSession = Boolean(state.session && state.session.token);
  const profile = {
    name: hasSession
      ? state.session.displayName || state.session.username
      : "Guest",
    handle: hasSession && state.session.username ? `@${state.session.username}` : "@guest",
    bio:
      (state.session &&
        state.session.preferencesSnapshot &&
        state.session.preferencesSnapshot.profile &&
        state.session.preferencesSnapshot.profile.bio) ||
      (hasSession
        ? "Add a short bio so friends know your vibe."
        : "Sign in to add a bio and location for your profile."),
    location:
      (state.session &&
        state.session.preferencesSnapshot &&
        state.session.preferencesSnapshot.profile &&
        state.session.preferencesSnapshot.profile.location) ||
      (hasSession ? "Location not set" : "Location unknown"),
    avatarUrl: hasSession && state.session.avatarUrl ? state.session.avatarUrl : null,
    stats: {
      films:
        (state.session &&
          state.session.preferencesSnapshot &&
          Number.isFinite(state.session.preferencesSnapshot.filmsLogged)
            ? state.session.preferencesSnapshot.filmsLogged
            : 0),
      diary:
        (state.session &&
          state.session.preferencesSnapshot &&
          Number.isFinite(state.session.preferencesSnapshot.diaryEntries)
            ? state.session.preferencesSnapshot.diaryEntries
            : 0),
      followers:
        state.socialOverview && state.socialOverview.counts
          ? Number(state.socialOverview.counts.followers || 0)
          : 0,
      following:
        state.socialOverview && state.socialOverview.counts
          ? Number(state.socialOverview.counts.following || 0)
          : 0
    }
  };

  if (profileName) {
    profileName.textContent = profile.name;
  }
  if (profileHandle) {
    profileHandle.textContent = profile.handle;
  }
  if (profileBio) {
    profileBio.textContent = profile.bio;
  }
  if (profileLocation) {
    profileLocation.textContent = profile.location;
  }
  if (profileAvatar) {
    profileAvatar.style.backgroundImage = "";
    if (profile.avatarUrl) {
      profileAvatar.style.backgroundImage = `url(${profile.avatarUrl})`;
      profileAvatar.textContent = "";
    } else {
      profileAvatar.textContent = initialsFromName(profile.name);
    }
  }

  Object.entries(profileStats).forEach(([key, element]) => {
    if (!element) return;
    const value = profile.stats[key] || 0;
    element.textContent = value.toLocaleString();
  });
}

function renderDiscoverMovies(movies = []) {
  if (!discoverGrid) return;
  discoverGrid.innerHTML = "";
  if (!movies.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Nothing matched—try a different filter.";
    discoverGrid.append(empty);
    return;
  }

  movies.forEach((movie) => {
    const card = document.createElement("article");
    card.className = "card";
    card.style.flexDirection = "column";
    card.style.alignItems = "flex-start";

    const posterUrl = movie.poster_path
      ? `https://image.tmdb.org/t/p/w342${movie.poster_path}`
      : "";
    card.appendChild(createPoster(posterUrl));

    const stack = document.createElement("div");
    stack.className = "stack";
    const title = document.createElement("strong");
    title.textContent = movie.title || movie.original_title || "Untitled";
    const meta = document.createElement("div");
    meta.className = "small-text";
    const year = movie.release_date ? movie.release_date.slice(0, 4) : "";
    const genres = formatGenres(movie.genre_ids || []);
    meta.textContent = [year, genres].filter(Boolean).join(" · ");
    const rating = document.createElement("span");
    rating.className = "badge rating";
    rating.textContent = movie.vote_average ? movie.vote_average.toFixed(1) : "N/A";

    stack.append(title, meta, rating);
    card.append(stack);
    discoverGrid.append(card);
  });
}

function renderPeople(people = []) {
  if (!discoverPeopleList) return;
  discoverPeopleList.innerHTML = "";
  if (!people.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No people found yet.";
    discoverPeopleList.append(empty);
    return;
  }
  people.forEach((person) => {
    const card = document.createElement("article");
    card.className = "card";

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    const initials = person.name
      ? person.name
          .split(" ")
          .map((part) => part[0])
          .join("")
          .slice(0, 2)
      : "?";
    avatar.textContent = initials;

    const stack = document.createElement("div");
    stack.className = "stack";
    const name = document.createElement("strong");
    name.textContent = person.name || "Unknown";
    const meta = document.createElement("div");
    meta.className = "small-text";
    const known = Array.isArray(person.known_for)
      ? person.known_for
          .map((item) => item.title || item.original_title || item.name)
          .filter(Boolean)
          .slice(0, 2)
          .join(", ")
      : "";
    meta.textContent = known ? `Known for: ${known}` : "Trending performer";

    stack.append(name, meta);
    card.append(avatar, stack);
    discoverPeopleList.append(card);
  });
}

function renderListCards(lists = []) {
  if (!discoverListCards) return;
  discoverListCards.innerHTML = "";
  if (!lists.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No lists yet—search to populate.";
    discoverListCards.append(empty);
    return;
  }

  lists.forEach((list) => {
    const card = document.createElement("article");
    card.className = "card";
    card.style.flexDirection = "column";
    card.style.alignItems = "flex-start";

    const collage = document.createElement("div");
    collage.className = "list-collage";
    list.posters.forEach((posterUrl) => {
      const mini = document.createElement("div");
      mini.className = "mini-poster";
      if (posterUrl) {
        mini.style.backgroundImage = `url(${posterUrl})`;
        mini.style.backgroundSize = "cover";
        mini.style.backgroundPosition = "center";
      }
      collage.append(mini);
    });

    const title = document.createElement("strong");
    title.textContent = list.title;
    const owner = document.createElement("div");
    owner.className = "small-text";
    owner.textContent = list.owner;
    const description = document.createElement("p");
    description.className = "small-text";
    description.textContent = list.description;
    const badge = document.createElement("span");
    badge.className = "badge trend";
    badge.textContent = list.badge;

    card.append(collage, title, owner, description, badge);
    discoverListCards.append(card);
  });
}

async function loadDiscover(filter = "popular") {
  state.discoverFilter = filter;
  const filterButtons = document.querySelectorAll("[data-filter]");
  filterButtons.forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.filter === filter);
  });

  if (state.discoverAbort) {
    state.discoverAbort.abort();
  }
  const controller = new AbortController();
  state.discoverAbort = controller;

  const paramsByFilter = {
    popular: { path: "discover/movie", params: { sort_by: "popularity.desc", "vote_count.gte": "150" } },
    "top-rated": { path: "movie/top_rated", params: { page: 1 } },
    new: { path: "movie/now_playing", params: { page: 1 } },
    friends: { path: "trending/movie/week", params: { page: 1 } }
  };

  const config = paramsByFilter[filter] || paramsByFilter.popular;
  try {
    const data = await fetchFromTmdb(config.path, config.params, {
      signal: controller.signal
    });
    const results = Array.isArray(data?.results) ? data.results.slice(0, 12) : [];
    renderDiscoverMovies(results);
  } catch (error) {
    if (error.name === "AbortError") return;
    renderDiscoverMovies([]);
  }

  state.discoverAbort = null;
}

async function loadTrendingPeople(query = "") {
  const searchPath = query && query.length >= 3 ? "search/person" : "trending/person/week";
  const params = query && query.length >= 3 ? { query, include_adult: "false" } : { page: 1 };
  try {
    const data = await fetchFromTmdb(searchPath, params);
    state.discoverPeople = Array.isArray(data?.results) ? data.results.slice(0, 6) : [];
    renderPeople(state.discoverPeople);
  } catch (error) {
    console.warn("people fetch failed", error);
    renderPeople([]);
  }
}

function buildListsFromMovies(movies = []) {
  const cleanMovies = (movies || []).filter(Boolean);
  if (!cleanMovies.length) return [];
  const top = cleanMovies.slice(0, 8);
  const split = [top.slice(0, 4), top.slice(4, 8)];
  return split
    .filter((bucket) => bucket.length)
    .map((bucket, index) => ({
      title: index === 0 ? "Fresh discoveries" : "From your vibe",
      owner: index === 0 ? "by SmartMovieMatch" : "from your session",
      description:
        index === 0
          ? "A quick reel of what’s trending this week."
          : "Built from your selected moods and recent views.",
      badge: index === 0 ? "Trending" : "Personalized",
      posters: bucket.map((movie) =>
        movie.poster_path ? `https://image.tmdb.org/t/p/w185${movie.poster_path}` : ""
      )
    }));
}

async function loadHomeRecommendations() {
  if (state.recommendationsAbort) {
    state.recommendationsAbort.abort();
  }
  const controller = new AbortController();
  state.recommendationsAbort = controller;

  try {
    const candidates = await discoverCandidateMovies(
      {
        mood: "any",
        selectedGenres: [],
        favoriteTitles: [],
        seed: state.recommendationSeed
      },
      { signal: controller.signal }
    );

    const scored = scoreAndSelectCandidates(candidates, { maxCount: 10 }, []);
    const enriched = await fetchOmdbForCandidates(scored, { signal: controller.signal });
    state.homeRecommendations = enriched;
    renderHomeRecommendations(enriched);
    renderGroupPicks(enriched.slice(0, 3));
    renderListCards(
      buildListsFromMovies(enriched.map((item) => item.tmdb || item.candidate))
    );
  } catch (error) {
    if (error.name === "AbortError") return;
    console.warn("recommendations failed", error);
  }

  state.recommendationsAbort = null;
}

function renderHomeRecommendations(items = []) {
  if (!homeRecommendationsRow) return;
  homeRecommendationsRow.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No picks yet. Try again soon.";
    homeRecommendationsRow.append(empty);
    return;
  }

  const heroSource = items[0];
  updateTonightPick(heroSource);

  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "card media-card";

    const posterUrl = item.tmdb?.poster_path
      ? `https://image.tmdb.org/t/p/w342${item.tmdb.poster_path}`
      : item.omdb?.Poster && item.omdb.Poster !== "N/A"
      ? item.omdb.Poster
      : "";

    const posterFrame = document.createElement("div");
    posterFrame.className = "poster-frame";
    posterFrame.appendChild(createPoster(posterUrl));
    const badge = document.createElement("span");
    badge.className = "badge rating poster-badge";
    const tmdbScore = item.tmdb?.vote_average;
    badge.textContent = tmdbScore ? tmdbScore.toFixed(1) : "New";
    posterFrame.appendChild(badge);

    const stack = document.createElement("div");
    stack.className = "stack tight";
    const title = document.createElement("strong");
    title.textContent = item.omdb?.Title || item.tmdb?.title || "Untitled";
    const meta = document.createElement("div");
    meta.className = "small-text";
    const year = item.omdb?.Year || (item.tmdb?.release_date || "").slice(0, 4);
    const genres = formatGenres(item.tmdb?.genre_ids || []);
    meta.textContent = [genres, year].filter(Boolean).join(" · ");

    stack.append(title, meta);
    card.append(posterFrame, stack);
    homeRecommendationsRow.append(card);
  });
}

function updateTonightPick(item) {
  if (!tonightPickCard || !item) return;
  const title = tonightPickCard.querySelector("[data-tonight-pick-title]");
  const overview = tonightPickCard.querySelector("[data-tonight-pick-overview]");
  const posterHost = tonightPickCard.querySelector("[data-tonight-pick-poster]");
  const trailerBtn = tonightPickCard.querySelector("[data-tonight-pick-trailer]");
  const detailsBtn = tonightPickCard.querySelector("[data-tonight-pick-details]");

  const titleText = item.omdb?.Title || item.tmdb?.title || "Tonight's pick";
  const year = item.omdb?.Year || (item.tmdb?.release_date || "").slice(0, 4);
  if (title) {
    title.textContent = year ? `${titleText} (${year})` : titleText;
  }
  if (overview) {
    overview.textContent = item.tmdb?.overview || item.omdb?.Plot || "A fresh discovery for you.";
  }
  if (posterHost) {
    const posterUrl = item.tmdb?.poster_path
      ? `https://image.tmdb.org/t/p/w342${item.tmdb.poster_path}`
      : item.omdb?.Poster && item.omdb.Poster !== "N/A"
      ? item.omdb.Poster
      : "";
    const posterEl = createPoster(posterUrl);
    posterHost.replaceWith(posterEl);
    posterEl.setAttribute("data-tonight-pick-poster", "");
  }

  if (trailerBtn) {
    trailerBtn.onclick = () => {
      const query = `${titleText} ${year || ""} official trailer`;
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      window.open(url, "_blank", "noopener");
    };
  }

  if (detailsBtn) {
    detailsBtn.onclick = () => {
      const url = item.tmdb?.id
        ? `https://www.themoviedb.org/movie/${item.tmdb.id}`
        : `https://www.google.com/search?q=${encodeURIComponent(titleText)}`;
      window.open(url, "_blank", "noopener");
    };
  }
}

function renderGroupPicks(items = []) {
  if (!groupPicksList) return;
  groupPicksList.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Add friends to see group picks.";
    groupPicksList.append(empty);
    return;
  }

  items.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "card match-card";
    const posterUrl = item.tmdb?.poster_path
      ? `https://image.tmdb.org/t/p/w185${item.tmdb.poster_path}`
      : item.omdb?.Poster && item.omdb.Poster !== "N/A"
      ? item.omdb.Poster
      : "";
    card.appendChild(createPoster(posterUrl));

    const stack = document.createElement("div");
    stack.className = "stack";
    const title = document.createElement("strong");
    title.textContent = item.omdb?.Title || item.tmdb?.title || "Untitled";
    const meta = document.createElement("div");
    meta.className = "small-text";
    const genres = formatGenres(item.tmdb?.genre_ids || []);
    const year = item.omdb?.Year || (item.tmdb?.release_date || "").slice(0, 4);
    meta.textContent = [genres, year].filter(Boolean).join(" · ");
    const badge = document.createElement("span");
    badge.className = "badge match";
    badge.textContent = `${82 + index * 4}% match`;
    stack.append(title, meta, badge);
    card.append(stack);
    groupPicksList.append(card);
  });
}

function handleDiscoverSearchInput(value) {
  const query = value.trim();
  if (!query || query.length < 3) {
    loadDiscover(state.discoverFilter);
    loadTrendingPeople();
    if (state.homeRecommendations.length) {
      renderListCards(buildListsFromMovies(state.homeRecommendations.map((item) => item.tmdb || item.candidate)));
    }
    return;
  }

  loadDiscoverSearch(query);
}

async function loadDiscoverSearch(query) {
  try {
    const [movies, people] = await Promise.all([
      fetchFromTmdb("search/movie", { query, include_adult: "false" }),
      fetchFromTmdb("search/person", { query, include_adult: "false" })
    ]);
    const movieResults = Array.isArray(movies?.results) ? movies.results.slice(0, 12) : [];
    renderDiscoverMovies(movieResults);
    const listSource = movieResults.length ? movieResults : state.homeRecommendations.map((item) => item.tmdb);
    renderListCards(buildListsFromMovies(listSource));
    state.discoverPeople = Array.isArray(people?.results) ? people.results.slice(0, 6) : [];
    renderPeople(state.discoverPeople);
  } catch (error) {
    console.warn("search failed", error);
  }
}

async function handleAuthSubmit(event) {
  if (event) {
    event.preventDefault();
  }
  if (!authUsernameInput || !authPasswordInput) return;
  if (state.authSubmitting) return;

  const username = authUsernameInput.value ? authUsernameInput.value.trim() : "";
  const password = authPasswordInput.value || "";
  const displayName =
    authDisplayNameInput && authDisplayNameInput.value
      ? authDisplayNameInput.value.trim()
      : "";

  if (!username || !password) {
    setAuthStatus("Enter your username and password.", "error");
    return;
  }

  state.authSubmitting = true;
  if (authSubmitButton) {
    authSubmitButton.setAttribute("disabled", "true");
  }
  setAuthStatus(
    state.authMode === "signup" ? "Creating your account…" : "Signing you in…"
  );

  try {
    const session =
      state.authMode === "signup"
        ? await registerUser({ username, password, name: displayName })
        : await loginUser({ username, password });
    setAuthStatus("You're signed in!", "success");
    closeAuthOverlay();
    updateAccountUi(session);
  } catch (error) {
    const message =
      (error && error.message) ||
      "Unable to complete the request. Please try again.";
    setAuthStatus(message, "error");
  } finally {
    state.authSubmitting = false;
    if (authSubmitButton) {
      authSubmitButton.removeAttribute("disabled");
    }
  }
}

function handleOutsideClick(event) {
  if (state.accountMenuOpen && accountMenu && accountToggle) {
    const target = event.target;
    if (!accountMenu.contains(target) && !accountToggle.contains(target)) {
      toggleAccountMenu(false);
    }
  }
}

function handleEscape(event) {
  if (event.key === "Escape") {
    if (state.accountMenuOpen) {
      toggleAccountMenu(false);
    }
    if (authOverlay && !authOverlay.hidden) {
      closeAuthOverlay();
    }
  }
}

function attachListeners() {
  navButtons.forEach((btn) => {
    btn.addEventListener("click", () => setSection(btn.dataset.sectionButton));
  });

  tabGroups.forEach((group) => {
    group.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const section = group.dataset.sectionTabs;
        setTab(section, btn.dataset.tab);
      });
    });
  });

  const filterButtons = document.querySelectorAll("[data-filter]");
  filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextFilter = btn.dataset.filter;
      loadDiscover(nextFilter);
    });
  });

  if (discoverSearchInput) {
    let handle;
    discoverSearchInput.addEventListener("input", (event) => {
      const { value } = event.target;
      window.clearTimeout(handle);
      handle = window.setTimeout(() => handleDiscoverSearchInput(value), 240);
    });
  }

  authModeButtons.forEach((btn) => {
    btn.addEventListener("click", () => setAuthMode(btn.dataset.authMode));
  });

  if (authOpenButton) {
    authOpenButton.addEventListener("click", () => openAuthOverlay("login"));
  }

  if (authCloseButton) {
    authCloseButton.addEventListener("click", closeAuthOverlay);
  }

  if (authOverlay) {
    authOverlay.addEventListener("click", (event) => {
      if (event.target === authOverlay) {
        closeAuthOverlay();
      }
    });
  }

  if (authForm) {
    authForm.addEventListener("submit", handleAuthSubmit);
  }

  if (accountToggle) {
    accountToggle.addEventListener("click", () => toggleAccountMenu());
    accountToggle.addEventListener("keydown", (event) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        toggleAccountMenu();
      }
    });
  }

  if (accountLogoutButton) {
    accountLogoutButton.addEventListener("click", () => {
      logoutSession();
      toggleAccountMenu(false);
      updateAccountUi(null);
    });
  }

  if (accountProfileButton) {
    accountProfileButton.addEventListener("click", () => {
      setSection("profile");
      toggleAccountMenu(false);
    });
  }

  if (accountSettingsButton) {
    accountSettingsButton.addEventListener("click", () => {
      setSection("profile");
      setTab("profile", "overview");
      toggleAccountMenu(false);
    });
  }

  document.addEventListener("click", handleOutsideClick);
  document.addEventListener("keydown", handleEscape);
}

function init() {
  setAuthMode(state.authMode);
  updateAccountUi(state.session);
  subscribeToSocialOverview((overview) => {
    state.socialOverview = overview;
    renderProfileOverview();
  });
  subscribeToSession((session) => {
    updateAccountUi(session);
    if (session && session.token) {
      closeAuthOverlay();
    }
  });
  initSocialFeatures();
  attachListeners();
  setSection("home");
  loadDiscover(state.discoverFilter);
  loadTrendingPeople();
  loadHomeRecommendations();
}

init();
