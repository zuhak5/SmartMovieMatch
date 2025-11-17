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
  authMenuOpen: false,
  authModalMode: "signin"
};

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
const authShell = document.querySelector("[data-auth-shell]");
const authSignedOut = document.querySelector("[data-auth-signed-out]");
const authSignedIn = document.querySelector("[data-auth-signed-in]");
const authUsername = document.querySelector("[data-auth-username]");
const authAvatar = document.querySelector("[data-auth-avatar]");
const authMenu = document.querySelector("[data-auth-menu]");
const authToggle = document.querySelector("[data-auth-toggle]");
const authSignInBtn = document.querySelector("[data-auth-signin]");
const authSignUpBtn = document.querySelector("[data-auth-signup]");
const authLogoutBtn = document.querySelector("[data-auth-logout]");
const authProfileBtn = document.querySelector("[data-auth-profile]");
const authSettingsBtn = document.querySelector("[data-auth-settings]");
const authRequiredNodes = document.querySelectorAll("[data-auth-required]");
const authModal = document.querySelector("[data-auth-modal]");
const authForm = document.querySelector("[data-auth-form]");
const authError = document.querySelector("[data-auth-error]");
const authSubmit = document.querySelector("[data-auth-submit]");
const authSwitch = document.querySelector("[data-auth-switch]");
const authHelper = document.querySelector("[data-auth-helper]");
const authModalTitle = document.querySelector("[data-auth-modal-title]");
const authModalEyebrow = document.querySelector("[data-auth-modal-eyebrow]");
const authModalSubtitle = document.querySelector("[data-auth-modal-subtitle]");
const authUsernameInput = document.querySelector("[data-auth-username-input]");
const authNameInput = document.querySelector("[data-auth-name-input]");
const authPasswordInput = document.querySelector("[data-auth-password-input]");
const authDisplayNameField = document.querySelector("[data-auth-displayname-field]");
const authModalDismiss = document.querySelectorAll("[data-auth-modal-dismiss]");

function setSection(section) {
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

  setTab(section, state.activeTabs[section] || defaultTabs[section]);
}

function setTab(section, tab) {
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

function initialsFromName(name) {
  if (!name) return "🙂";
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function toggleAuthMenu(forceOpen = null) {
  if (!authMenu || !authToggle) return;
  const nextState = forceOpen === null ? !state.authMenuOpen : Boolean(forceOpen);
  state.authMenuOpen = nextState;
  authMenu.classList.toggle("is-open", nextState);
  authToggle.setAttribute("aria-expanded", nextState ? "true" : "false");
}

function updateAuthGuards(hasSession) {
  authRequiredNodes.forEach((node) => {
    node.classList.toggle("is-hidden", !hasSession);
  });

  if (!hasSession && state.activeSection === "profile") {
    setSection("home");
  }
}

function renderAuthState(session) {
  const hasSession = Boolean(session && session.token);
  if (authSignedOut) {
    authSignedOut.classList.toggle("is-active", !hasSession);
  }
  if (authSignedIn) {
    authSignedIn.classList.toggle("is-active", hasSession);
  }
  updateAuthGuards(hasSession);

  if (!hasSession) {
    toggleAuthMenu(false);
    if (authUsername) {
      authUsername.textContent = "Guest";
    }
    if (authAvatar) {
      authAvatar.textContent = "🙂";
      authAvatar.style.backgroundImage = "none";
    }
    return;
  }

  if (authUsername) {
    authUsername.textContent = session.displayName || session.username;
  }
  if (authAvatar) {
    const initials = initialsFromName(session.displayName || session.username);
    authAvatar.textContent = initials;
    if (session.avatarUrl) {
      authAvatar.style.backgroundImage = `url(${session.avatarUrl})`;
      authAvatar.style.backgroundSize = "cover";
      authAvatar.style.backgroundPosition = "center";
    } else {
      authAvatar.style.backgroundImage = "none";
    }
  }
}

function setAuthModalMode(mode = "signin") {
  const nextMode = mode === "signup" ? "signup" : "signin";
  state.authModalMode = nextMode;
  const isSignUp = nextMode === "signup";

  if (authModalTitle) {
    authModalTitle.textContent = isSignUp ? "Create your account" : "Sign in";
  }
  if (authModalEyebrow) {
    authModalEyebrow.textContent = isSignUp
      ? "Join Smart Movie Match"
      : "Welcome back";
  }
  if (authModalSubtitle) {
    authModalSubtitle.textContent = isSignUp
      ? "Make an account to sync your watchlists and diary."
      : "Enter your details to jump into Smart Movie Match.";
  }
  if (authHelper) {
    authHelper.textContent = isSignUp
      ? "Pick a unique username. You can change your display name later."
      : "Use your Smart Movie Match credentials to continue.";
  }
  if (authDisplayNameField) {
    authDisplayNameField.classList.toggle("is-hidden", !isSignUp);
  }
  if (authSwitch) {
    authSwitch.textContent = isSignUp ? "Already have an account? Sign in" : "Need an account? Sign up";
  }
  if (authSubmit) {
    authSubmit.textContent = isSignUp ? "Create account" : "Sign in";
  }
  if (authPasswordInput) {
    authPasswordInput.setAttribute("autocomplete", isSignUp ? "new-password" : "current-password");
  }

  resetAuthError();
  if (!isSignUp && authNameInput) {
    authNameInput.value = "";
  }
}

function resetAuthError() {
  if (authError) {
    authError.textContent = "";
    authError.classList.add("is-hidden");
  }
}

function showAuthError(message) {
  if (authError) {
    authError.textContent = message || "";
    authError.classList.toggle("is-hidden", !message);
  }
}

function setAuthLoading(isLoading) {
  if (authSubmit) {
    authSubmit.disabled = isLoading;
    const isSignUp = state.authModalMode === "signup";
    authSubmit.textContent = isLoading
      ? isSignUp
        ? "Creating..."
        : "Signing in..."
      : isSignUp
        ? "Create account"
        : "Sign in";
  }
  if (authSwitch) {
    authSwitch.disabled = isLoading;
  }
}

function openAuthModal(mode = "signin") {
  if (!authModal) return;
  setAuthModalMode(mode);
  resetAuthError();
  authModal.classList.add("is-open");
  authModal.setAttribute("aria-hidden", "false");
  window.setTimeout(() => {
    if (authUsernameInput) {
      authUsernameInput.focus();
    }
  }, 10);
}

function closeAuthModal() {
  if (!authModal) return;
  authModal.classList.remove("is-open");
  authModal.setAttribute("aria-hidden", "true");
  resetAuthError();
  if (authForm) {
    authForm.reset();
  }
}

function formatGenres(ids = []) {
  const names = ids
    .map((id) => TMDB_GENRES[id] || "")
    .filter(Boolean)
    .slice(0, 2);
  return names.join(" · ");
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
    const card = document.createElement("div");
    card.className = "card";
    card.style.flexDirection = "column";

    const posterUrl = item.tmdb?.poster_path
      ? `https://image.tmdb.org/t/p/w342${item.tmdb.poster_path}`
      : item.omdb?.Poster && item.omdb.Poster !== "N/A"
      ? item.omdb.Poster
      : "";
    card.appendChild(createPoster(posterUrl));

    const title = document.createElement("strong");
    title.textContent = item.omdb?.Title || item.tmdb?.title || "Untitled";
    const badge = document.createElement("span");
    badge.className = "badge rating";
    const tmdbScore = item.tmdb?.vote_average;
    badge.textContent = tmdbScore ? tmdbScore.toFixed(1) : "New";

    card.append(title, badge);
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
  if (!authUsernameInput || !authPasswordInput) {
    return;
  }

  const username = authUsernameInput.value.trim();
  const password = authPasswordInput.value.trim();
  const displayName = authNameInput ? authNameInput.value.trim() : "";

  if (!username || !password) {
    showAuthError("Enter your username and password to continue.");
    return;
  }

  resetAuthError();
  setAuthLoading(true);

  try {
    if (state.authModalMode === "signup") {
      await registerUser({ username, password, name: displayName || undefined });
    } else {
      await loginUser({ username, password });
    }
    closeAuthModal();
  } catch (error) {
    const message = error && error.message ? error.message : "Unable to authenticate. Please try again.";
    showAuthError(message);
  } finally {
    setAuthLoading(false);
  }
}

function attachAuthListeners() {
  if (authToggle) {
    authToggle.addEventListener("click", () => toggleAuthMenu());
  }
  if (authSignInBtn) {
    authSignInBtn.addEventListener("click", () => openAuthModal("signin"));
  }
  if (authSignUpBtn) {
    authSignUpBtn.addEventListener("click", () => openAuthModal("signup"));
  }
  if (authLogoutBtn) {
    authLogoutBtn.addEventListener("click", () => {
      logoutSession();
      toggleAuthMenu(false);
    });
  }
  if (authForm) {
    authForm.addEventListener("submit", handleAuthSubmit);
  }
  if (authSwitch) {
    authSwitch.addEventListener("click", () => {
      const nextMode = state.authModalMode === "signup" ? "signin" : "signup";
      setAuthModalMode(nextMode);
    });
  }
  if (authModalDismiss && authModalDismiss.length) {
    authModalDismiss.forEach((node) => {
      node.addEventListener("click", () => closeAuthModal());
    });
  }
  if (authModal) {
    authModal.addEventListener("click", (event) => {
      if (event.target === authModal) {
        closeAuthModal();
      }
    });
  }
  if (authProfileBtn) {
    authProfileBtn.addEventListener("click", () => {
      setSection("profile");
      toggleAuthMenu(false);
    });
  }
  if (authSettingsBtn) {
    authSettingsBtn.addEventListener("click", () => {
      window.alert("Settings coming soon.");
      toggleAuthMenu(false);
    });
  }

  document.addEventListener("click", (event) => {
    if (!state.authMenuOpen || !authShell) return;
    if (authShell.contains(event.target)) return;
    toggleAuthMenu(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      toggleAuthMenu(false);
      closeAuthModal();
    }
  });
}

function initAuth() {
  setAuthModalMode(state.authModalMode);
  renderAuthState(state.session);
  subscribeToSession((session) => {
    state.session = session;
    renderAuthState(session);
    if (session && session.token) {
      closeAuthModal();
    }
  });
  attachAuthListeners();
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
}

function init() {
  initAuth();
  attachListeners();
  setSection("home");
  loadDiscover(state.discoverFilter);
  loadTrendingPeople();
  loadHomeRecommendations();
}

init();
