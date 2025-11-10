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

const state = {
  watchedMovies: [],
  favorites: [],
  lastRecSeed: Math.random(),
  moodIntensity: 1,
  activeCollectionView: "favorites",
  session: null,
  watchedSyncTimer: null,
  favoritesSyncTimer: null,
  activeRecToken: null,
  activeRecAbort: null,
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

function updateCountValueLabel() {
  const countInput = $("countInput");
  const valueEl = $("countValue");
  if (!countInput || !valueEl) {
    return;
  }
  const parsed = parseInt(countInput.value || "0", 10);
  let value = Number.isNaN(parsed) ? 0 : parsed;
  if (value > 0) {
    value = Math.min(20, Math.max(4, value));
    if (String(value) !== countInput.value) {
      countInput.value = String(value);
    }
  }
  const suffix = value === 1 ? "movie" : "movies";
  valueEl.textContent = value > 0 ? `${value} ${suffix}` : `0 ${suffix}`;
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

  document
    .querySelectorAll('input[name="mood"]')
    .forEach((radio) =>
      radio.addEventListener("change", () => {
        playUiClick();
        updateMoodDynamicCopy();
        updatePreview();
      })
    );

  const moodIntensityInput = $("moodIntensity");
  if (moodIntensityInput) {
    const syncMoodIntensity = () => {
      const raw = parseInt(moodIntensityInput.value || "1", 10);
      state.moodIntensity = Number.isNaN(raw) ? 1 : raw;
      updateMoodIntensityLabels();
      updateMoodDynamicCopy();
      updatePreview();
    };
    moodIntensityInput.addEventListener("input", () => {
      playUiClick();
      syncMoodIntensity();
    });
    syncMoodIntensity();
  }

  const countInput = $("countInput");
  if (countInput) {
    const handleCountChange = () => {
      updateCountValueLabel();
      updatePreview();
    };
    countInput.addEventListener("input", handleCountChange);
    countInput.addEventListener("change", handleCountChange);
    updateCountValueLabel();
  }

  const recNudgeBtn = $("recNudgeBtn");
  if (recNudgeBtn) {
    recNudgeBtn.addEventListener("click", () => {
      playUiClick();
      state.lastRecSeed = Math.random();
      getRecommendations(true);
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
  updateMoodIntensityLabels();
  updateMoodDynamicCopy();
}

function refreshFavoritesUi() {
  renderFavoritesList(state.favorites, { onRemove: handleRemoveFavorite });
  updateFavoritesSummary(state.favorites);
  updateCollectionVisibility();
  updatePreferencesPreview();
  updateMoodIntensityLabels();
  updateMoodDynamicCopy();
}


function updatePreferencesPreview() {
  const container = $("preferencesPreview");
  if (!container) {
    return;
  }

  const countInput = $("countInput");

  const name = getActiveDisplayName();
  const desiredCountRaw = countInput ? countInput.value : "";
  let desiredCount = parseInt(desiredCountRaw, 10);
  if (Number.isNaN(desiredCount)) {
    desiredCount = 12;
  }
  desiredCount = Math.min(20, Math.max(4, desiredCount));

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

  const moodInput = document.querySelector('input[name="mood"]:checked');
  const moodValue = moodInput ? moodInput.value : "any";
  const moodLabel = getMoodSummaryLabel(moodValue, state.moodIntensity);
  const energyLabel = getMoodIntensityLabel(state.moodIntensity);

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

  if (name) {
    addChip("Name", name);
  }

  if (selectedGenreLabels.length) {
    const maxGenres = 3;
    const visible = selectedGenreLabels.slice(0, maxGenres);
    const rest = selectedGenreLabels.length - visible.length;
    const genreSummary =
      visible.join(" • ") + (rest > 0 ? ` +${rest} more` : "");
    addChip("Genres", genreSummary);
  }

  if (moodLabel) {
    addChip("Mood", moodLabel);
  }

  if (energyLabel) {
    addChip("Energy", energyLabel);
  }

  if (state.favorites.length) {
    const visibleFavorites = state.favorites
      .map((fav) => fav.title)
      .filter(Boolean)
      .slice(-3);
    const favoritesSummary = visibleFavorites.reverse().join(" • ");
    addChip("Favorites", favoritesSummary);
  }

  if (!Number.isNaN(desiredCount) && desiredCount > 0) {
    addChip("Batch size", `${desiredCount} movies`);
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
      "Choose genres, mood, or favorites and I’ll summarize them here in real time.";
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
    const moodInput = document.querySelector('input[name="mood"]:checked');
    const mood = moodInput ? moodInput.value : "any";
    const favoriteTitles = state.favorites.map((fav) => fav.title).filter(Boolean);

    const countInput = $("countInput");
    let desiredCount = parseInt(countInput.value || "12", 10);
    if (Number.isNaN(desiredCount)) {
      desiredCount = 12;
    }
    desiredCount = Math.min(20, Math.max(4, desiredCount));
    countInput.value = String(desiredCount);
    updateCountValueLabel();
    updatePreferencesPreview();

    const preferencesSnapshot = {
      name,
      selectedGenres,
      mood,
      moodIntensity: state.moodIntensity,
      favoriteTitles: favoriteTitles.slice(-6),
      desiredCount,
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
    showSkeletons();

    const titleEl = $("recTitle");
    if (name) {
      titleEl.textContent = `${name}, here’s what I found`;
    } else {
      titleEl.textContent = "Recommendations";
    }

    const metaEl = $("recMetaPrimary");
    const moodSummaryRaw = getMoodSummaryLabel(mood, state.moodIntensity);
    let moodMeta = moodSummaryRaw.toLowerCase();
    if (moodMeta.includes("mix")) {
      const article = /^(?:[aeiou])/i.test(moodMeta.trim()) ? "an" : "a";
      moodMeta = `${article} ${moodMeta}`;
    }
    const genreLabel = selectedGenres.length
      ? "inside your selected genres"
      : "across popular genres";
    const watchedLabel = state.watchedMovies.length
      ? "biased by what you’ve watched recently"
      : "with a bias toward well-loved titles";

    metaEl.textContent =
      `Curating ${moodMeta} ${genreLabel}, blending TMDB discovery with OMDb details and YouTube trailers, ${watchedLabel}. Showing up to ${desiredCount} movies.`;

    const candidates = await discoverCandidateMovies(
      {
        selectedGenres,
        mood,
        moodIntensity: state.moodIntensity,
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
      setRecStatus(
        "I couldn’t find anything matching that combo. Try loosening genres or mood a bit.",
        false
      );
      renderRecommendations([], state.watchedMovies, { favorites: state.favorites });
      return;
    }

    const topCandidates = scoreAndSelectCandidates(
      candidates,
      {
        selectedGenres,
        mood,
        favoriteTitles,
        maxCount: desiredCount,
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
      renderRecommendations([], state.watchedMovies, { favorites: state.favorites });
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
      renderRecommendations([], state.watchedMovies, { favorites: state.favorites });
      return;
    }

    const withTrailers = await fetchTrailersForMovies(nonNullOmdb, { signal });

    if (isStale() || signal.aborted) {
      return;
    }

    setRecStatus(
      "Here’s a curated batch based on your input. Mark anything you’ve already seen – I’ll keep learning.",
      false
    );
    renderRecommendations(withTrailers, state.watchedMovies, {
      favorites: state.favorites,
      onMarkWatched: handleMarkWatched,
      onToggleFavorite: handleToggleFavorite
    });
  } catch (error) {
    if (signal.aborted || isStale() || isAbortError(error)) {
      return;
    }
    console.error("Recommendation error:", error);
    setRecError(
      "Something went wrong while talking to the APIs. Check your internet connection and API keys, then try again."
    );
    setRecStatus("I hit an error while fetching movies.", false);
    renderRecommendations([], state.watchedMovies, { favorites: state.favorites });
  } finally {
    finalizeRequest();
  }
}

function handleMarkWatched(omdbMovie) {
  const added = markAsWatched(omdbMovie);
  if (added) {
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

  state.watchedMovies.push({
    imdbID,
    title,
    year: omdbMovie.Year || "",
    genres,
    rating
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

function updateMoodIntensityLabels() {
  document.querySelectorAll('[data-intensity-value]').forEach((label) => {
    const value = parseInt(label.getAttribute('data-intensity-value') || '0', 10);
    label.classList.toggle('active', value === state.moodIntensity);
  });
}

function updateMoodDynamicCopy() {
  const moodCopy = $("moodDynamicCopy");
  if (!moodCopy) {
    return;
  }
  const moodInput = document.querySelector('input[name="mood"]:checked');
  const moodValue = moodInput ? moodInput.value : "any";
  const summary = getMoodSummaryLabel(moodValue, state.moodIntensity);
  if (moodValue === "any") {
    moodCopy.textContent = `Expect a ${summary.toLowerCase()}.`;
  } else {
    moodCopy.textContent = `Expect ${summary.toLowerCase()}.`;
  }
}

function getMoodIntensityLabel(intensity) {
  const value = Math.min(2, Math.max(0, Number(intensity)));
  if (value <= 0) {
    return "Laid-back";
  }
  if (value >= 2) {
    return "High energy";
  }
  return "Balanced";
}

function getMoodSummaryLabel(moodValue, intensity) {
  const value = typeof intensity === "number" ? intensity : 1;
  if (moodValue === "light") {
    if (value >= 2) {
      return "Uplifting crowd-pleasers";
    }
    if (value <= 0) {
      return "Cozy comfort picks";
    }
    return "Feel-good stories";
  }
  if (moodValue === "dark") {
    if (value >= 2) {
      return "Edge-of-your-seat thrillers";
    }
    if (value <= 0) {
      return "Moody slow-burns";
    }
    return "Dark & intense picks";
  }
  const intensityLabel = getMoodIntensityLabel(value).toLowerCase();
  return `${intensityLabel} mix of moods`;
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
    updateCountValueLabel();
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
  updateCountValueLabel();
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

  if (typeof snapshot.mood === "string") {
    const moodValue = snapshot.mood;
    let matched = false;
    document.querySelectorAll('input[name="mood"]').forEach((radio) => {
      if (!matched && radio.value === moodValue) {
        radio.checked = true;
        matched = true;
      }
    });
    if (!matched) {
      const defaultMood = document.querySelector('input[name="mood"][value="any"]');
      if (defaultMood) {
        defaultMood.checked = true;
      }
    }
  }

  if (typeof snapshot.moodIntensity === "number") {
    const moodIntensityInput = $("moodIntensity");
    if (moodIntensityInput) {
      const clamped = Math.min(2, Math.max(0, parseInt(snapshot.moodIntensity, 10)));
      moodIntensityInput.value = String(clamped);
      state.moodIntensity = clamped;
      updateMoodIntensityLabels();
      updateMoodDynamicCopy();
    }
  }

  const countInput = $("countInput");
  if (countInput) {
    const desiredCount = parseInt(snapshot.desiredCount, 10);
    if (!Number.isNaN(desiredCount)) {
      const clamped = Math.min(20, Math.max(4, desiredCount));
      countInput.value = String(clamped);
      updateCountValueLabel();
    }
  }

  updatePreferencesPreview();
  updateMoodIntensityLabels();
  updateMoodDynamicCopy();
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
        rating: Number.isFinite(ratingValue) ? ratingValue : null
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
