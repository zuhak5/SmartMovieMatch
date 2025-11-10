import { TMDB_GENRES } from "./config.js";
import {
  loadSession,
  subscribeToSession,
  logoutSession,
  persistPreferencesRemote,
  persistWatchedRemote,
  persistFavoritesRemote
} from "./auth.js";
import {
  discoverCandidateMovies,
  scoreAndSelectCandidates,
  fetchOmdbForCandidates,
  fetchTrailersForMovies
} from "./recommendations.js";
import {
  renderWatchedList,
  updateWatchedSummary,
  renderRecommendations,
  renderFavoritesList,
  updateFavoritesSummary,
  showSkeletons,
  setRecStatus,
  setRecError
} from "./ui.js";
import { $ } from "./dom.js";
import { playUiClick } from "./sound.js";

const RECOMMENDATIONS_PAGE_SIZE = 20;

const state = {
  watchedMovies: [],
  favorites: [],
  lastRecSeed: Math.random(),
  activeCollectionView: "favorites",
  session: null,
  watchedSyncTimer: null,
  favoritesSyncTimer: null,
  activeRecToken: null,
  activeRecAbort: null,
  recommendations: [],
  visibleRecommendations: 0,
  recommendationContext: null,
  sessionHydration: {
    token: null,
    lastPreferencesSync: null,
    lastWatchedSync: null,
    lastFavoritesSync: null
  }
};

function getActiveDisplayName() {
  if (state.session) {
    if (state.session.displayName && state.session.displayName.trim()) {
      return state.session.displayName.trim();
    }
    if (state.session.username && state.session.username.trim()) {
      return state.session.username.trim();
    }
  }
  if (
    state.session &&
    state.session.preferencesSnapshot &&
    typeof state.session.preferencesSnapshot.name === "string"
  ) {
    const fromSnapshot = state.session.preferencesSnapshot.name.trim();
    if (fromSnapshot) {
      return fromSnapshot;
    }
  }
  return "";
}

function isAbortError(error) {
  return !!error && error.name === "AbortError";
}

document.addEventListener("DOMContentLoaded", init);

function init() {
  state.watchedMovies = [];
  state.favorites = [];
  state.session = loadSession();
  hydrateFromSession(state.session);
  refreshWatchedUi();
  refreshFavoritesUi();
  switchCollectionView(state.activeCollectionView);
  updateAccountUi(state.session);
  setSyncStatus(
    state.session
      ? "Signed in – your taste profile syncs automatically."
      : "Sign in to sync your preferences and watch history across devices.",
    state.session ? "success" : "muted"
  );

  subscribeToSession((session) => {
    state.session = session;
    hydrateFromSession(session);
    updateAccountUi(session);
    setSyncStatus(
      session
        ? "Signed in – your taste profile syncs automatically."
        : "Signed out. Preferences won’t sync until you sign in again.",
      session ? "success" : "muted"
    );
  });

  wireEvents();
}

function wireEvents() {
  const logoutBtn = $("accountLogoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      playUiClick();
      logoutSession();
      setSyncStatus(
        "Signed out. Preferences won’t sync until you sign in again.",
        "muted"
      );
    });
  }

  const prefsForm = $("prefsForm");
  if (prefsForm) {
    prefsForm.addEventListener("submit", (event) => {
      event.preventDefault();
      playUiClick();
      getRecommendations(false);
    });
  }

  const updatePreview = () => updatePreferencesPreview();

  document
    .querySelectorAll('input[name="genre"]')
    .forEach((checkbox) =>
      checkbox.addEventListener("change", () => {
        updatePreview();
      })
    );

  const recNudgeBtn = $("recNudgeBtn");
  if (recNudgeBtn) {
    recNudgeBtn.addEventListener("click", () => {
      playUiClick();
      state.lastRecSeed = Math.random();
      getRecommendations(true);
    });
  }

  const showMoreBtn = $("showMoreRecsBtn");
  if (showMoreBtn) {
    showMoreBtn.addEventListener("click", () => {
      playUiClick();
      revealMoreRecommendations();
    });
  }

  const clearWatchedBtn = $("clearWatchedBtn");
  if (clearWatchedBtn) {
    clearWatchedBtn.addEventListener("click", () => {
      playUiClick();
      if (!state.watchedMovies.length) {
        return;
      }
      const sure = window.confirm(
        "Clear your watched history on this device? This only affects recommendations in this browser."
      );
      if (!sure) {
        return;
      }
      state.watchedMovies = [];
      refreshWatchedUi();
      scheduleWatchedSync();
      getRecommendations(true);
    });
  }

  document.querySelectorAll(".collection-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.getAttribute("data-target");
      if (target) {
        playUiClick();
        switchCollectionView(target);
      }
    });
  });
}

function refreshWatchedUi() {
  renderWatchedList(state.watchedMovies, { onRemove: handleRemoveWatched });
  updateWatchedSummary(state.watchedMovies);
  updateCollectionVisibility();
  updatePreferencesPreview();
  if (state.recommendations.length && !state.activeRecAbort) {
    updateRecommendationsView();
  }
}

function refreshFavoritesUi() {
  renderFavoritesList(state.favorites, { onRemove: handleRemoveFavorite });
  updateFavoritesSummary(state.favorites);
  updateCollectionVisibility();
  updatePreferencesPreview();
  if (state.recommendations.length && !state.activeRecAbort) {
    updateRecommendationsView();
  }
}


function updatePreferencesPreview() {
  const container = $("preferencesPreview");
  if (!container) {
    return;
  }

  const selectedGenreInputs = Array.from(
    document.querySelectorAll('label.genre-pill input[name="genre"]:checked')
  );
  const selectedGenreLabels = selectedGenreInputs
    .map((input) => {
      const genreId = input.value;
      if (genreId && TMDB_GENRES[genreId]) {
        return TMDB_GENRES[genreId];
      }
      const label = input.closest(".genre-pill");
      if (!label) {
        return "";
      }
      const span = label.querySelector(".genre-pill-label");
      return span ? span.textContent.trim() : "";
    })
    .filter(Boolean);

  container.innerHTML = "";

  const title = document.createElement("div");
  title.className = "preferences-preview-title";
  title.textContent = "Live summary";
  container.appendChild(title);

  const chipsWrap = document.createElement("div");
  chipsWrap.className = "preferences-preview-chips";

  const addChip = (label, value) => {
    if (!value) {
      return;
    }
    const chip = document.createElement("span");
    chip.className = "pref-chip";
    const strong = document.createElement("strong");
    strong.textContent = label;
    const textValue = document.createElement("span");
    textValue.textContent = value;
    chip.appendChild(strong);
    chip.appendChild(textValue);
    chipsWrap.appendChild(chip);
  };

  if (selectedGenreLabels.length) {
    const maxGenres = 3;
    const visible = selectedGenreLabels.slice(0, maxGenres);
    const rest = selectedGenreLabels.length - visible.length;
    const genreSummary =
      visible.join(" • ") + (rest > 0 ? ` +${rest} more` : "");
    addChip("Genres", genreSummary);
  }

  if (state.favorites.length) {
    const visibleFavorites = state.favorites
      .map((fav) => fav.title)
      .filter(Boolean)
      .slice(-3);
    const favoritesSummary = visibleFavorites.reverse().join(" • ");
    addChip("Favorites", favoritesSummary);
  }

  if (state.watchedMovies.length) {
    const latest = state.watchedMovies[state.watchedMovies.length - 1];
    const latestTitle = latest ? latest.title : "";
    const watchedSummary =
      `${state.watchedMovies.length} logged` +
      (latestTitle ? ` • latest: ${latestTitle}` : "");
    addChip("Watched", watchedSummary);
  }

  if (chipsWrap.childElementCount) {
    container.appendChild(chipsWrap);
  } else {
    const empty = document.createElement("div");
    empty.className = "preferences-preview-empty";
    empty.textContent =
      "Choose genres, favorites, or log watched titles and I’ll summarize them here in real time.";
    container.appendChild(empty);
  }
}


async function getRecommendations(isShuffleOnly) {
  if (state.activeRecAbort) {
    state.activeRecAbort.abort();
  }

  const abortController = new AbortController();
  const { signal } = abortController;
  state.activeRecAbort = abortController;
  const requestToken = Symbol("rec");
  state.activeRecToken = requestToken;

  const isStale = () => state.activeRecToken !== requestToken;
  const finalizeRequest = () => {
    if (state.activeRecAbort === abortController) {
      state.activeRecAbort = null;
    }
    if (state.activeRecToken === requestToken) {
      state.activeRecToken = null;
    }
  };

  try {
    const name = getActiveDisplayName();
    const selectedGenres = Array.from(
      document.querySelectorAll('input[name="genre"]:checked')
    ).map((cb) => cb.value);
    const favoriteTitles = state.favorites.map((fav) => fav.title).filter(Boolean);

    updatePreferencesPreview();

    const preferencesSnapshot = {
      name,
      selectedGenres,
      favoriteTitles: favoriteTitles.slice(-6),
      watchedSample: state.watchedMovies.slice(-5).map((movie) => movie.title),
      seed: state.lastRecSeed,
      timestamp: new Date().toISOString()
    };
    syncPreferencesSnapshot(preferencesSnapshot);

    setRecError("");
    setRecStatus(
      "Thinking through your taste and calling TMDB / OMDb / YouTube...",
      true
    );
    resetRecommendationsState();
    showSkeletons();

    const titleEl = $("recTitle");
    if (name) {
      titleEl.textContent = `${name}, here’s what I found`;
    } else {
      titleEl.textContent = "Recommendations";
    }

    const metaEl = $("recMetaPrimary");
    const genreLabel = selectedGenres.length
      ? "inside your selected genres"
      : "across popular genres";
    const watchedLabel = state.watchedMovies.length
      ? "biased by what you’ve watched recently"
      : "with a bias toward well-loved titles";
    const baseMeta = `Curating picks ${genreLabel}, blending TMDB discovery with OMDb details and YouTube trailers, ${watchedLabel}.`;
    state.recommendationContext = { baseMeta };
    if (metaEl) {
      metaEl.textContent = `${baseMeta} Gathering fresh matches…`;
    }

    const candidates = await discoverCandidateMovies(
      {
        selectedGenres,
        favoriteTitles,
        seed: state.lastRecSeed
      },
      { signal }
    );

    if (isStale() || signal.aborted) {
      return;
    }

    if (!candidates.length) {
      if (isStale() || signal.aborted) {
        return;
      }
      setRecStatus("I couldn’t find anything matching that combo. Try loosening your genres.", false);
      state.recommendations = [];
      state.visibleRecommendations = 0;
      updateRecommendationsView();
      return;
    }

    const topCandidates = scoreAndSelectCandidates(
      candidates,
      {
        selectedGenres,
        favoriteTitles,
        maxCount: Number.POSITIVE_INFINITY,
        seed: state.lastRecSeed
      },
      state.watchedMovies
    );

    if (isStale() || signal.aborted) {
      return;
    }

    if (!topCandidates.length) {
      if (isStale() || signal.aborted) {
        return;
      }
      setRecStatus(
        "Everything I found is already in your watched list. Try new genres or clear some history.",
        false
      );
      state.recommendations = [];
      state.visibleRecommendations = 0;
      updateRecommendationsView();
      return;
    }

    const omdbResults = await fetchOmdbForCandidates(topCandidates, { signal });

    if (isStale() || signal.aborted) {
      return;
    }

    const nonNullOmdb = omdbResults.filter((entry) => entry && entry.omdb);

    if (!nonNullOmdb.length) {
      if (isStale() || signal.aborted) {
        return;
      }
      setRecStatus(
        "TMDB found candidates, but OMDb didn’t have details for them. Try again in a bit or tweak your filters.",
        false
      );
      state.recommendations = [];
      state.visibleRecommendations = 0;
      updateRecommendationsView();
      return;
    }

    const withTrailers = await fetchTrailersForMovies(nonNullOmdb, { signal });

    if (isStale() || signal.aborted) {
      return;
    }

    state.recommendations = withTrailers;
    state.visibleRecommendations = withTrailers.length
      ? Math.min(RECOMMENDATIONS_PAGE_SIZE, withTrailers.length)
      : 0;

    setRecStatus(
      "Here’s a curated batch based on your input. Mark anything you’ve already seen – I’ll keep learning.",
      false
    );
    updateRecommendationsView();
  } catch (error) {
    if (signal.aborted || isStale() || isAbortError(error)) {
      return;
    }
    console.error("Recommendation error:", error);
    setRecError(
      "Something went wrong while talking to the APIs. Check your internet connection and API keys, then try again."
    );
    setRecStatus("I hit an error while fetching movies.", false);
    state.recommendations = [];
    state.visibleRecommendations = 0;
    updateRecommendationsView();
  } finally {
    finalizeRequest();
  }
}

function resetRecommendationsState() {
  state.recommendations = [];
  state.visibleRecommendations = 0;
  state.recommendationContext = null;
  const container = $("recommendationsActions");
  const button = $("showMoreRecsBtn");
  if (container) {
    container.style.display = "none";
  }
  if (button) {
    button.style.display = "none";
  }
}

function updateRecommendationsView() {
  const total = state.recommendations.length;
  const fallbackVisible = total ? Math.min(total, RECOMMENDATIONS_PAGE_SIZE) : 0;
  const visible = total
    ? Math.min(total, state.visibleRecommendations || fallbackVisible)
    : 0;
  const items = total ? state.recommendations.slice(0, visible) : [];
  renderRecommendations(items, state.watchedMovies, {
    favorites: state.favorites,
    onMarkWatched: handleMarkWatched,
    onToggleFavorite: handleToggleFavorite
  });
  updateShowMoreButton();
  updateRecommendationsMeta();
}

function updateShowMoreButton() {
  const container = $("recommendationsActions");
  const button = $("showMoreRecsBtn");
  if (!container || !button) {
    return;
  }

  const total = state.recommendations.length;
  const visible = Math.min(total, state.visibleRecommendations || total);

  if (total > 0 && visible < total) {
    const remaining = total - visible;
    container.style.display = "flex";
    button.style.display = "inline-flex";
    if (remaining === 1) {
      button.textContent = "Show the last movie";
    } else if (remaining <= RECOMMENDATIONS_PAGE_SIZE) {
      button.textContent = `Show remaining ${remaining} movies`;
    } else {
      button.textContent = `Show more (${remaining} more movies)`;
    }
  } else {
    container.style.display = "none";
    button.style.display = "none";
  }
}

function updateRecommendationsMeta() {
  const metaEl = $("recMetaPrimary");
  if (!metaEl) {
    return;
  }

  const context = state.recommendationContext;
  if (!context || !context.baseMeta) {
    return;
  }

  const total = state.recommendations.length;
  const visible = total ? Math.min(total, state.visibleRecommendations || total) : 0;

  if (!total) {
    metaEl.textContent = `${context.baseMeta} No matches yet – try adjusting your preferences.`;
    return;
  }

  if (visible >= total) {
    metaEl.textContent = `${context.baseMeta} Showing all ${total} movies.`;
  } else {
    metaEl.textContent = `${context.baseMeta} Showing ${visible} of ${total} movies.`;
  }
}

function revealMoreRecommendations() {
  if (!state.recommendations.length) {
    return;
  }
  const total = state.recommendations.length;
  const nextVisible = Math.min(
    total,
    (state.visibleRecommendations || RECOMMENDATIONS_PAGE_SIZE) + RECOMMENDATIONS_PAGE_SIZE
  );
  if (nextVisible === state.visibleRecommendations || nextVisible === 0) {
    return;
  }
  state.visibleRecommendations = nextVisible;
  updateRecommendationsView();
}

function handleMarkWatched(omdbMovie) {
  const added = markAsWatched(omdbMovie);
  if (added) {
    const imdbID = omdbMovie && omdbMovie.imdbID ? omdbMovie.imdbID : null;
    const normalizedTitle =
      omdbMovie && omdbMovie.Title ? omdbMovie.Title.toLowerCase() : "";
    if (state.recommendations.length) {
      const before = state.recommendations.length;
      state.recommendations = state.recommendations.filter((entry) => {
        if (!entry) {
          return false;
        }
        const entryOmdb = entry.omdb || null;
        if (entryOmdb && imdbID && entryOmdb.imdbID === imdbID) {
          return false;
        }
        if (
          entryOmdb &&
          normalizedTitle &&
          entryOmdb.Title &&
          entryOmdb.Title.toLowerCase() === normalizedTitle
        ) {
          return false;
        }
        const entryTmdb = entry.tmdb || entry.candidate || null;
        if (
          entryTmdb &&
          normalizedTitle &&
          (entryTmdb.title || entryTmdb.original_title) &&
          (entryTmdb.title || entryTmdb.original_title).toLowerCase() === normalizedTitle
        ) {
          return false;
        }
        return true;
      });
      if (state.recommendations.length !== before) {
        const visible =
          typeof state.visibleRecommendations === "number"
            ? state.visibleRecommendations
            : 0;
        state.visibleRecommendations = Math.min(
          visible,
          state.recommendations.length
        );
        updateRecommendationsView();
      }
    }
    getRecommendations(true);
  }
  return added;
}


function handleRemoveWatched(movie) {
  if (!movie) {
    return;
  }

  const prevLength = state.watchedMovies.length;
  const next = state.watchedMovies.filter((entry) => {
    if (!entry) {
      return false;
    }
    if (movie.imdbID && entry.imdbID) {
      return entry.imdbID !== movie.imdbID;
    }
    return (entry.title || "").toLowerCase() !== (movie.title || "").toLowerCase();
  });

  if (next.length === prevLength) {
    return;
  }

  state.watchedMovies = next;
  refreshWatchedUi();
  scheduleWatchedSync();
  setRecStatus("Updated your watched list. Refreshing suggestions…", true);
  getRecommendations(true);
}

function handleToggleFavorite(payload) {
  if (!payload) {
    return false;
  }
  const omdbMovie = payload.omdb || null;
  const tmdbMovie = payload.tmdb || null;
  const isFavorite = typeof payload.isFavorite === "boolean" ? payload.isFavorite : null;

  const title =
    (omdbMovie && omdbMovie.Title) ||
    (tmdbMovie && (tmdbMovie.title || tmdbMovie.original_title)) ||
    "";
  if (!title) {
    return Boolean(isFavorite);
  }

  const imdbID = omdbMovie && omdbMovie.imdbID ? omdbMovie.imdbID : null;
  const normalized = title.toLowerCase();
  const existingIndex = state.favorites.findIndex((fav) => {
    if (!fav) {
      return false;
    }
    if (imdbID && fav.imdbID) {
      return fav.imdbID === imdbID;
    }
    return (fav.title || "").toLowerCase() === normalized;
  });

  if (existingIndex !== -1) {
    state.favorites.splice(existingIndex, 1);
    refreshFavoritesUi();
    scheduleFavoritesSync();
    getRecommendations(true);
    return false;
  }

  const posterTmdb =
    tmdbMovie && tmdbMovie.poster_path
      ? `https://image.tmdb.org/t/p/w342${tmdbMovie.poster_path}`
      : null;
  const posterOmdb =
    omdbMovie && omdbMovie.Poster && omdbMovie.Poster !== "N/A"
      ? omdbMovie.Poster
      : null;
  const genres = omdbMovie && omdbMovie.Genre
    ? omdbMovie.Genre.split(",").map((genre) => genre.trim()).filter(Boolean)
    : [];

  state.favorites.push({
    imdbID,
    title,
    year:
      (omdbMovie && omdbMovie.Year) ||
      (tmdbMovie && tmdbMovie.release_date ? tmdbMovie.release_date.slice(0, 4) : ""),
    poster: posterTmdb || posterOmdb || null,
    overview:
      (tmdbMovie && tmdbMovie.overview) ||
      (omdbMovie && omdbMovie.Plot && omdbMovie.Plot !== "N/A" ? omdbMovie.Plot : ""),
    genres
  });

  refreshFavoritesUi();
  scheduleFavoritesSync();
  getRecommendations(true);
  return true;
}

function handleRemoveFavorite(movie) {
  if (!movie) {
    return;
  }

  const prevLength = state.favorites.length;
  const next = state.favorites.filter((entry) => {
    if (!entry) {
      return false;
    }
    if (movie.imdbID && entry.imdbID) {
      return entry.imdbID !== movie.imdbID;
    }
    return (entry.title || "").toLowerCase() !== (movie.title || "").toLowerCase();
  });

  if (next.length === prevLength) {
    return;
  }

  state.favorites = next;
  refreshFavoritesUi();
  scheduleFavoritesSync();
  getRecommendations(true);
}

function markAsWatched(omdbMovie) {
  if (!omdbMovie || !omdbMovie.Title) {
    return false;
  }
  const imdbID = omdbMovie.imdbID || null;
  const title = omdbMovie.Title;

  const already = state.watchedMovies.some((movie) =>
    imdbID ? movie.imdbID === imdbID : movie.title === title
  );
  if (already) {
    return false;
  }

  const genres = omdbMovie.Genre
    ? omdbMovie.Genre.split(",").map((genre) => genre.trim()).filter(Boolean)
    : [];
  const rating =
    omdbMovie.imdbRating && omdbMovie.imdbRating !== "N/A"
      ? parseFloat(omdbMovie.imdbRating)
      : null;
  const poster =
    omdbMovie.Poster && omdbMovie.Poster !== "N/A" ? omdbMovie.Poster : null;

  state.watchedMovies.push({
    imdbID,
    title,
    year: omdbMovie.Year || "",
    genres,
    rating,
    poster
  });

  refreshWatchedUi();
  scheduleWatchedSync();
  return true;
}


function switchCollectionView(target) {
  const normalized = target === "watched" ? "watched" : "favorites";
  state.activeCollectionView = normalized;
  updateCollectionVisibility();
}

function updateCollectionVisibility() {
  const favoritesSummary = $("favoritesSummary");
  const watchedSummary = $("watchedSummary");
  const favoritesView = $("favoritesView");
  const watchedView = $("watchedView");
  const clearWatchedBtn = $("clearWatchedBtn");

  if (favoritesSummary) {
    favoritesSummary.style.display =
      state.activeCollectionView === "favorites" ? "block" : "none";
  }
  if (watchedSummary) {
    watchedSummary.style.display =
      state.activeCollectionView === "watched" ? "block" : "none";
  }
  if (favoritesView) {
    favoritesView.classList.toggle("active", state.activeCollectionView === "favorites");
  }
  if (watchedView) {
    watchedView.classList.toggle("active", state.activeCollectionView === "watched");
  }
  document.querySelectorAll(".collection-tab").forEach((tab) => {
    const target = tab.getAttribute("data-target");
    tab.classList.toggle("active", target === state.activeCollectionView);
  });
  if (clearWatchedBtn) {
    clearWatchedBtn.style.display = state.activeCollectionView === "watched" ? "inline-flex" : "none";
  }
}

function updateAccountUi(session) {
  const greeting = $("accountGreeting");
  const loginLink = $("accountLoginLink");
  const logoutBtn = $("accountLogoutBtn");

  if (!greeting || !loginLink || !logoutBtn) {
    return;
  }

  const displayName = session ? session.displayName || session.username || "" : "";

  if (displayName) {
    greeting.textContent = `Signed in as ${displayName}`;
    greeting.classList.add("account-greeting-auth");
    loginLink.style.display = "none";
    logoutBtn.style.display = "inline-flex";
  } else {
    greeting.textContent = "You’re browsing as guest.";
    greeting.classList.remove("account-greeting-auth");
    loginLink.style.display = "inline-flex";
    logoutBtn.style.display = "none";
  }
}

function setSyncStatus(message, variant = "muted") {
  const el = $("syncStatus");
  if (!el) {
    return;
  }
  el.textContent = message;
  el.dataset.variant = variant;
}

function hydrateFromSession(session) {
  if (!session) {
    state.sessionHydration = {
      token: null,
      lastPreferencesSync: null,
      lastWatchedSync: null,
      lastFavoritesSync: null
    };
    if (state.watchedSyncTimer) {
      window.clearTimeout(state.watchedSyncTimer);
      state.watchedSyncTimer = null;
    }
    if (state.favoritesSyncTimer) {
      window.clearTimeout(state.favoritesSyncTimer);
      state.favoritesSyncTimer = null;
    }
    state.watchedMovies = [];
    state.favorites = [];
    refreshWatchedUi();
    refreshFavoritesUi();
    return;
  }

  const shouldHydrateWatched =
    Array.isArray(session.watchedHistory) &&
    (
      state.sessionHydration.token !== session.token ||
      session.lastWatchedSync !== state.sessionHydration.lastWatchedSync
    );
  const shouldHydratePreferences =
    session.preferencesSnapshot &&
    (
      state.sessionHydration.token !== session.token ||
      session.lastPreferencesSync !== state.sessionHydration.lastPreferencesSync
    );
  const shouldHydrateFavorites =
    Array.isArray(session.favoritesList) &&
    (
      state.sessionHydration.token !== session.token ||
      session.lastFavoritesSync !== state.sessionHydration.lastFavoritesSync
    );

  if (shouldHydrateWatched) {
    applyWatchedHistory(session.watchedHistory);
  }

  if (shouldHydratePreferences) {
    applyPreferencesSnapshot(session.preferencesSnapshot);
  }

  if (shouldHydrateFavorites) {
    applyFavoritesList(session.favoritesList);
  }

    state.sessionHydration = {
      token: session.token,
      lastPreferencesSync: session.lastPreferencesSync || null,
      lastWatchedSync: session.lastWatchedSync || null,
      lastFavoritesSync: session.lastFavoritesSync || null
    };
  }


function applyPreferencesSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }

  if (Array.isArray(snapshot.selectedGenres)) {
    const selected = new Set(snapshot.selectedGenres.map(String));
    document.querySelectorAll('input[name="genre"]').forEach((checkbox) => {
      checkbox.checked = selected.has(checkbox.value);
    });
  }

  updatePreferencesPreview();
}

function applyWatchedHistory(history) {
  if (!Array.isArray(history)) {
    return;
  }

  const normalized = history
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const title = typeof entry.title === "string" ? entry.title : "";
      if (!title) {
        return null;
      }
      const ratingValue =
        typeof entry.rating === "number"
          ? entry.rating
          : typeof entry.rating === "string" && entry.rating.trim() !== ""
          ? Number(entry.rating)
          : null;
      return {
        imdbID: entry.imdbID || null,
        title,
        year: typeof entry.year === "string" ? entry.year : "",
        genres: Array.isArray(entry.genres)
          ? entry.genres.map((genre) => (typeof genre === "string" ? genre : "")).filter(Boolean)
          : [],
        rating: Number.isFinite(ratingValue) ? ratingValue : null,
        poster:
          typeof entry.poster === "string" && entry.poster.trim() !== ""
            ? entry.poster
            : null
      };
    })
    .filter(Boolean);

  state.watchedMovies = normalized;
  refreshWatchedUi();
}

function applyFavoritesList(favorites) {
  if (!Array.isArray(favorites)) {
    return;
  }

  const normalized = favorites
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const title = typeof entry.title === "string" ? entry.title : "";
      if (!title) {
        return null;
      }
      return {
        imdbID: entry.imdbID || null,
        title,
        year: typeof entry.year === "string" ? entry.year : "",
        poster: typeof entry.poster === "string" ? entry.poster : null,
        overview: typeof entry.overview === "string" ? entry.overview : "",
        genres: Array.isArray(entry.genres)
          ? entry.genres
              .map((genre) => (typeof genre === "string" ? genre : ""))
              .filter(Boolean)
          : []
      };
    })
    .filter(Boolean);

  state.favorites = normalized;
  refreshFavoritesUi();
}

function syncPreferencesSnapshot(snapshot) {
  if (!snapshot) {
    return;
  }

  if (!state.session) {
    if (
      snapshot.selectedGenres.length ||
      (Array.isArray(snapshot.favoriteTitles) && snapshot.favoriteTitles.length) ||
      state.watchedMovies.length
    ) {
      setSyncStatus(
        "Sign in to sync your taste profile across devices.",
        "muted"
      );
    }
    return;
  }

  setSyncStatus("Syncing your taste profile…", "loading");
  persistPreferencesRemote(state.session, snapshot)
    .then(() => {
      setSyncStatus("Taste profile synced moments ago.", "success");
    })
    .catch((error) => {
      console.warn("Preference sync failed", error);
      setSyncStatus(
        "Couldn’t sync your preferences right now. We’ll try again automatically.",
        "error"
      );
    });
}

function scheduleWatchedSync() {
  if (!state.session) {
    if (state.watchedMovies.length) {
      setSyncStatus("Sign in to sync your watched history.", "muted");
    }
    return;
  }

  if (state.watchedSyncTimer) {
    window.clearTimeout(state.watchedSyncTimer);
  }

  setSyncStatus("Syncing your watched history…", "loading");

  state.watchedSyncTimer = window.setTimeout(async () => {
    try {
      await persistWatchedRemote(state.session, state.watchedMovies);
      setSyncStatus("Watched history synced moments ago.", "success");
    } catch (error) {
      console.warn("Watched sync failed", error);
      setSyncStatus(
        "Couldn’t sync watched history right now. We’ll try again automatically.",
        "error"
      );
    } finally {
      state.watchedSyncTimer = null;
    }
  }, 600);
}

function scheduleFavoritesSync() {
  if (!state.session) {
    if (state.favorites.length) {
      setSyncStatus("Sign in to sync your favorites.", "muted");
    }
    return;
  }

  if (state.favoritesSyncTimer) {
    window.clearTimeout(state.favoritesSyncTimer);
  }

  setSyncStatus("Syncing your favorites…", "loading");

  state.favoritesSyncTimer = window.setTimeout(async () => {
    try {
      await persistFavoritesRemote(state.session, state.favorites);
      setSyncStatus("Favorites synced moments ago.", "success");
    } catch (error) {
      console.warn("Favorites sync failed", error);
      setSyncStatus(
        "Couldn’t sync favorites right now. We’ll try again automatically.",
        "error"
      );
    } finally {
      state.favoritesSyncTimer = null;
    }
  }, 600);
}
