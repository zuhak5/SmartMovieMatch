import { computeWatchedGenreWeights } from "./taste.js";
import { $, closest } from "./dom.js";
import { playExpandSound, playFavoriteSound, playUiClick } from "./sound.js";
import { acknowledgeFriendActivity } from "./social.js";
import { TMDB_GENRES } from "./config.js";

const COLLECTION_DEFAULT_STATE = {
  expandedItems: { favorites: [], watched: [] },
  viewExpanded: { favorites: false, watched: false }
};
let collectionStateCache = cloneCollectionState(COLLECTION_DEFAULT_STATE);
const TOAST_DURATION = 4200;
const MOVIE_OVERLAY_TRANSITION_MS = 220;
const LANGUAGE_DISPLAY =
  typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["en"], { type: "language" })
    : null;

let movieOverlayState = { card: null, placeholder: null, details: null, summary: null };
let movieOverlayElements = null;
let movieOverlayListenersAttached = false;

function getOmdbField(omdb, key) {
  if (!omdb || omdb.Response === "False") {
    return null;
  }
  const value = omdb[key];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "N/A") {
      return null;
    }
    return trimmed;
  }
  return null;
}

function splitOmdbList(omdb, key, limit) {
  const value = getOmdbField(omdb, key);
  if (!value) {
    return [];
  }
  const list = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (typeof limit === "number" && limit > 0) {
    return list.slice(0, limit);
  }
  return list;
}

function formatRuntimeValue(tmdbRuntime, omdbRuntime) {
  if (typeof tmdbRuntime === "number" && Number.isFinite(tmdbRuntime) && tmdbRuntime > 0) {
    return `${tmdbRuntime} min`;
  }
  if (typeof omdbRuntime === "string" && omdbRuntime.trim() && omdbRuntime.trim() !== "N/A") {
    return omdbRuntime.trim();
  }
  return null;
}

function formatIsoDate(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatFriendlyDate(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatLanguageLabel(code) {
  if (!code || typeof code !== "string") {
    return null;
  }
  const normalized = code.trim();
  if (!normalized) {
    return null;
  }
  if (LANGUAGE_DISPLAY) {
    try {
      const label = LANGUAGE_DISPLAY.of(normalized.toLowerCase());
      if (label && typeof label === "string") {
        return label.replace(/^(.)/, (match) => match.toUpperCase());
      }
    } catch (error) {
      // Fallback to uppercase code below.
    }
  }
  return normalized.toUpperCase();
}

function buildLanguageList(tmdb, omdbLanguage) {
  const languages = [];
  if (tmdb) {
    if (Array.isArray(tmdb.spoken_languages) && tmdb.spoken_languages.length) {
      tmdb.spoken_languages.forEach((lang) => {
        const label = lang?.english_name || lang?.name || formatLanguageLabel(lang?.iso_639_1);
        if (label) {
          languages.push(label);
        }
      });
    } else if (tmdb.original_language) {
      const label = formatLanguageLabel(tmdb.original_language);
      if (label) {
        languages.push(label);
      }
    }
  }
  if (!languages.length && typeof omdbLanguage === "string" && omdbLanguage.trim()) {
    omdbLanguage
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((entry) => languages.push(entry));
  }
  return languages;
}

function formatNumberValue(value, { decimals = 0 } = {}) {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const formatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
  return formatter.format(numeric);
}

function buildOmdbRatingsMap(omdb) {
  if (!omdb || omdb.Response === "False" || !Array.isArray(omdb.Ratings)) {
    return {};
  }
  return omdb.Ratings.reduce((map, entry) => {
    const source = typeof entry?.Source === "string" ? entry.Source.trim() : "";
    const value = typeof entry?.Value === "string" ? entry.Value.trim() : "";
    if (!source || !value) {
      return map;
    }
    if (source.includes("Internet Movie Database")) {
      map.imdb = value;
    } else if (source.includes("Rotten Tomatoes")) {
      map.rotten = value;
    } else if (source.includes("Metacritic")) {
      map.metacritic = value;
    }
    return map;
  }, {});
}

function buildGenreList(tmdb, omdb) {
  if (tmdb && Array.isArray(tmdb.genre_ids) && tmdb.genre_ids.length) {
    return tmdb.genre_ids
      .map((id) => ({ id, label: TMDB_GENRES[id] || `Genre ${id}` }))
      .filter((genre) => Boolean(genre.label));
  }
  const omdbGenres = splitOmdbList(omdb, "Genre");
  return omdbGenres.map((label) => ({ id: null, label }));
}

function getMovieOverlayElements() {
  if (movieOverlayElements) {
    return movieOverlayElements;
  }
  const overlay = $("movieOverlay");
  const hero = $("movieOverlayHero");
  const body = $("movieOverlayBody");
  const close = $("movieOverlayClose");
  const title = $("movieOverlayHeading");
  if (!overlay || !hero || !body || !close) {
    return null;
  }
  if (!movieOverlayListenersAttached) {
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        playUiClick();
        closeMovieOverlay();
      }
    });
    close.addEventListener("click", () => {
      playUiClick();
      closeMovieOverlay();
    });
    movieOverlayListenersAttached = true;
  }
  movieOverlayElements = { overlay, hero, body, close, title };
  return movieOverlayElements;
}

function createMovieOverlayHero(summaryButton) {
  const hero = document.createElement("div");
  hero.className = "movie-summary movie-overlay-summary";
  hero.innerHTML = summaryButton.innerHTML;
  hero.setAttribute("aria-hidden", "true");
  hero.setAttribute("tabindex", "-1");
  const stateIcons = hero.querySelector(".movie-state-icons");
  if (stateIcons) {
    stateIcons.setAttribute("aria-hidden", "true");
  }
  return hero;
}

export function closeMovieOverlay(options = {}) {
  if (!movieOverlayState.card) {
    const elements = getMovieOverlayElements();
    if (elements && !elements.overlay.hidden) {
      elements.overlay.classList.remove("is-visible");
      elements.overlay.setAttribute("aria-hidden", "true");
      elements.overlay.hidden = true;
      elements.hero.innerHTML = "";
      elements.body.innerHTML = "";
      document.body.classList.remove("movie-overlay-open");
    }
    return;
  }
  const { card, placeholder, details, summary } = movieOverlayState;
  const elements = getMovieOverlayElements();
  if (placeholder && placeholder.parentNode) {
    placeholder.parentNode.replaceChild(details, placeholder);
  } else if (card) {
    card.appendChild(details);
  }
  if (card) {
    card.classList.remove("movie-card--overlay-active");
  }
  if (summary) {
    summary.setAttribute("aria-expanded", "false");
  }
  movieOverlayState = { card: null, placeholder: null, details: null, summary: null };
  if (elements) {
    elements.overlay.classList.remove("is-visible");
    elements.overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("movie-overlay-open");
    window.setTimeout(() => {
      if (!movieOverlayState.card) {
        elements.overlay.hidden = true;
        elements.hero.innerHTML = "";
        elements.body.innerHTML = "";
      }
    }, MOVIE_OVERLAY_TRANSITION_MS);
  }
  if (!options.silent && summary && typeof summary.focus === "function") {
    summary.focus();
  }
}

export function isMovieOverlayOpen() {
  return Boolean(movieOverlayState.card);
}

function prefersInlineMovieDetails() {
  if (typeof window === "undefined") {
    return false;
  }

  const hasMatchMedia = typeof window.matchMedia === "function";
  const matches = (query) => (hasMatchMedia ? window.matchMedia(query).matches : false);

  const prefersCoarsePointer = matches("(pointer: coarse)") || matches("(any-pointer: coarse)");
  const prefersNoHover = matches("(hover: none)") || matches("(any-hover: none)");
  const prefersSmallViewport = matches("(max-width: 900px)") || matches("(max-device-width: 900px)");

  let measuredViewport = 0;
  if (typeof window.innerWidth === "number" && window.innerWidth > 0) {
    measuredViewport = window.innerWidth;
  } else if (typeof document !== "undefined" && document.documentElement) {
    measuredViewport = document.documentElement.clientWidth || 0;
  }
  const viewportIsSmall = measuredViewport > 0 && measuredViewport <= 900;

  const hasTouch =
    (typeof navigator !== "undefined" && Number(navigator.maxTouchPoints) > 0) ||
    (typeof window !== "undefined" && "ontouchstart" in window);

  return (
    prefersCoarsePointer ||
    prefersNoHover ||
    prefersSmallViewport ||
    viewportIsSmall ||
    hasTouch
  );
}

function showMovieOverlay(card) {
  if (!card || prefersInlineMovieDetails()) {
    return false;
  }
  const elements = getMovieOverlayElements();
  if (!elements) {
    return false;
  }
  if (movieOverlayState.card === card) {
    closeMovieOverlay();
    return true;
  }
  const summary = card.querySelector(".movie-summary");
  const details = card.querySelector(".movie-details");
  if (!summary || !details || !details.parentNode) {
    return false;
  }
  closeMovieOverlay({ silent: true });
  const placeholder = document.createElement("div");
  placeholder.className = "movie-details-placeholder";
  details.parentNode.insertBefore(placeholder, details);
  elements.hero.innerHTML = "";
  const heroContent = createMovieOverlayHero(summary);
  elements.hero.appendChild(heroContent);
  elements.body.innerHTML = "";
  elements.body.appendChild(details);
  const titleText = heroContent.querySelector(".movie-title")?.textContent?.trim();
  if (elements.title) {
    elements.title.textContent = titleText ? `Details for ${titleText}` : "Movie details";
  }
  movieOverlayState = { card, placeholder, details, summary };
  summary.setAttribute("aria-expanded", "true");
  card.classList.add("movie-card--overlay-active");
  elements.overlay.hidden = false;
  elements.overlay.setAttribute("aria-hidden", "false");
  elements.overlay.classList.add("is-visible");
  document.body.classList.add("movie-overlay-open");
  window.requestAnimationFrame(() => {
    if (elements.close) {
      elements.close.focus();
    }
  });
  return true;
}

function createMetaChip(label, value) {
  if (!value) {
    return null;
  }
  const chip = document.createElement("span");
  chip.className = "movie-meta-chip";
  chip.innerHTML = `<span class="movie-meta-chip-label">${label}</span><span>${value}</span>`;
  return chip;
}

function createIdRow(imdbID) {
  if (!imdbID) {
    return null;
  }
  const row = document.createElement("div");
  row.className = "movie-id-row";
  const label = document.createElement("span");
  label.className = "movie-id-label";
  label.textContent = "IMDb ID";
  const value = document.createElement("code");
  value.className = "movie-id-value";
  value.textContent = imdbID;
  row.appendChild(label);
  row.appendChild(value);
  return row;
}

function createFlagRow(tmdb) {
  if (!tmdb) {
    return null;
  }
  const row = document.createElement("div");
  row.className = "movie-flag-row";
  const flags = [
    tmdb.adult
      ? { label: "Adult content", variant: "alert", icon: "18+" }
      : { label: "All audiences", variant: "calm", icon: "✅" },
    tmdb.video
      ? { label: "Direct-to-video", variant: "muted", icon: "📼" }
      : { label: "Feature film", variant: "neutral", icon: "🎞️" }
  ];
  flags.forEach((flag) => {
    const pill = document.createElement("span");
    pill.className = `movie-flag movie-flag-${flag.variant}`;
    pill.innerHTML = `<span class="movie-flag-icon">${flag.icon}</span><span>${flag.label}</span>`;
    row.appendChild(pill);
  });
  return row;
}

function buildSynopsisBlock(text, label) {
  if (!text) {
    return null;
  }
  const block = document.createElement("div");
  block.className = "movie-synopsis";
  const eyebrow = document.createElement("span");
  eyebrow.className = "movie-synopsis-label";
  eyebrow.textContent = label || "Synopsis";
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  block.appendChild(eyebrow);
  block.appendChild(paragraph);
  return block;
}

function appendFactChip(container, label, value) {
  if (!container || !value) {
    return;
  }
  const chip = document.createElement("div");
  chip.className = "fact-chip";
  const factLabel = document.createElement("span");
  factLabel.className = "fact-chip-label";
  factLabel.textContent = label;
  const factValue = document.createElement("span");
  factValue.className = "fact-chip-value";
  factValue.textContent = value;
  chip.appendChild(factLabel);
  chip.appendChild(factValue);
  container.appendChild(chip);
}

function buildRatingBoard(entries) {
  const visible = entries.filter((entry) => entry && entry.value);
  if (!visible.length) {
    return null;
  }
  const board = document.createElement("div");
  board.className = "movie-rating-board";
  visible.forEach((entry) => {
    const chip = document.createElement("div");
    chip.className = "rating-board-chip";
    const label = document.createElement("span");
    label.className = "rating-board-label";
    label.textContent = entry.label;
    const value = document.createElement("strong");
    value.className = "rating-board-value";
    value.textContent = entry.value;
    chip.appendChild(label);
    chip.appendChild(value);
    if (entry.meta) {
      const meta = document.createElement("span");
      meta.className = "rating-board-meta";
      meta.textContent = entry.meta;
      chip.appendChild(meta);
    }
    board.appendChild(chip);
  });
  return board;
}

function formatRelativeTime(timestamp) {
  if (!timestamp) {
    return "";
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) {
    return "moments ago";
  }
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 45) {
    return "moments ago";
  }
  if (diffSeconds < 90) {
    return "About a minute ago";
  }
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  }
  return date.toLocaleDateString();
}

function cloneCollectionState(state) {
  return {
    expandedItems: {
      favorites: Array.isArray(state.expandedItems?.favorites)
        ? [...state.expandedItems.favorites]
        : [],
      watched: Array.isArray(state.expandedItems?.watched)
        ? [...state.expandedItems.watched]
        : []
    },
    viewExpanded: {
      favorites: Boolean(state.viewExpanded?.favorites),
      watched: Boolean(state.viewExpanded?.watched)
    }
  };
}

function readCollectionState() {
  return cloneCollectionState(collectionStateCache);
}

function writeCollectionState(state) {
  collectionStateCache = cloneCollectionState(state);
}

function updateCollectionState(updater) {
  const current = readCollectionState();
  const next = updater(cloneCollectionState(current));
  writeCollectionState(next);
  return next;
}

function getCollectionItemKey(movie) {
  if (!movie || typeof movie !== "object") {
    return null;
  }
  return (
    movie.id ||
    movie.tmdbId ||
    movie.tmdb_id ||
    movie.imdbID ||
    movie.slug ||
    movie.externalId ||
    movie.title ||
    null
  );
}

function getExpandedSet(collection) {
  const state = readCollectionState();
  const list = state.expandedItems?.[collection];
  return new Set(Array.isArray(list) ? list : []);
}

function setExpandedValue(collection, key, expanded) {
  if (!key) {
    return;
  }
  updateCollectionState((draft) => {
    const list = draft.expandedItems[collection] || [];
    const idx = list.indexOf(key);
    if (expanded) {
      if (idx === -1) {
        list.push(key);
      }
    } else if (idx >= 0) {
      list.splice(idx, 1);
    }
    draft.expandedItems[collection] = list;
    return draft;
  });
}

function getViewExpanded(collection) {
  const state = readCollectionState();
  return Boolean(state.viewExpanded?.[collection]);
}

function setViewExpanded(collection, expanded) {
  updateCollectionState((draft) => {
    draft.viewExpanded[collection] = Boolean(expanded);
    return draft;
  });
}

function createImdbLookupKey(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  return `imdb:${value.trim().toLowerCase()}`;
}

function createTitleLookupKey(value, { normalize } = {}) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const normalized = normalize ? value.trim().toLowerCase() : value.trim();
  return `title:${normalized}`;
}

function buildMovieLookup(list, { normalizeTitle = false } = {}) {
  const lookup = new Set();
  if (!Array.isArray(list)) {
    return lookup;
  }
  list.forEach((movie) => {
    if (!movie || typeof movie !== "object") {
      return;
    }
    const imdbKey = createImdbLookupKey(movie.imdbID);
    if (imdbKey) {
      lookup.add(imdbKey);
    }
    const titleKey = createTitleLookupKey(movie.title, { normalize: normalizeTitle });
    if (titleKey) {
      lookup.add(titleKey);
    }
  });
  return lookup;
}

function hasMovieInLookup(lookup, imdbId, title, { normalizeTitle = false } = {}) {
  if (!lookup || lookup.size === 0) {
    return false;
  }
  const imdbKey = createImdbLookupKey(imdbId);
  if (imdbKey && lookup.has(imdbKey)) {
    return true;
  }
  const titleKey = createTitleLookupKey(title, { normalize: normalizeTitle });
  return titleKey ? lookup.has(titleKey) : false;
}

export function showToast({ title, text, variant = "info", icon = "🔔", duration = TOAST_DURATION } = {}) {
  const region = $("globalToastRegion");
  if (!region) {
    return;
  }
  const toast = document.createElement("div");
  toast.className = "global-toast";
  toast.dataset.variant = variant;

  const iconEl = document.createElement("span");
  iconEl.className = "global-toast-icon";
  iconEl.textContent = icon;
  toast.appendChild(iconEl);

  const content = document.createElement("div");
  content.className = "global-toast-content";
  const titleEl = document.createElement("div");
  titleEl.className = "global-toast-title";
  titleEl.textContent = title || "Updated";
  const textEl = document.createElement("div");
  textEl.className = "global-toast-text";
  textEl.textContent = text || "Your changes were saved.";
  content.appendChild(titleEl);
  content.appendChild(textEl);
  toast.appendChild(content);

  region.appendChild(toast);

  requestAnimationFrame(() => {
    toast.dataset.state = "visible";
  });

  const removeToast = () => {
    toast.dataset.state = "hidden";
    setTimeout(() => {
      if (toast.parentElement === region) {
        region.removeChild(toast);
      }
    }, 260);
  };

  const timeout = typeof duration === "number" && duration > 0 ? duration : TOAST_DURATION;
  const timer = setTimeout(removeToast, timeout);

  toast.addEventListener("click", () => {
    clearTimeout(timer);
    removeToast();
  });
}

export function setRecStatus(text, loading, progress) {
  const statusText = $("recStatusText");
  if (statusText) {
    statusText.textContent = text;
  }
  const dot = $("recStatusDot");
  if (dot) {
    if (loading) {
      dot.classList.add("loading");
    } else {
      dot.classList.remove("loading");
    }
  }
  const progressEl = $("recStatusProgress");
  const stageEl = $("recStatusStage");
  if (progressEl) {
    if (progress && typeof progress.total === "number" && progress.total > 0) {
      const total = Math.max(1, progress.total);
      const step = Math.min(total, Math.max(0, Number(progress.step) || 0));
      const percent = Math.min(100, Math.max(0, (step / total) * 100));
      progressEl.hidden = false;
      progressEl.setAttribute("aria-valuemin", "0");
      progressEl.setAttribute("aria-valuemax", String(total));
      progressEl.setAttribute("aria-valuenow", String(step));
      progressEl.setAttribute("aria-hidden", "false");
      const fill = progressEl.querySelector(".status-progress-fill");
      if (fill) {
        fill.style.width = `${percent}%`;
      }
      if (stageEl) {
        stageEl.hidden = false;
        stageEl.textContent = progress.label || "";
      }
    } else {
      progressEl.hidden = true;
      progressEl.removeAttribute("aria-valuemin");
      progressEl.removeAttribute("aria-valuemax");
      progressEl.removeAttribute("aria-valuenow");
      progressEl.setAttribute("aria-hidden", "true");
      const fill = progressEl.querySelector(".status-progress-fill");
      if (fill) {
        fill.style.width = "0%";
      }
      if (stageEl) {
        stageEl.hidden = true;
        stageEl.textContent = "";
      }
    }
  }
}

export function setRecError(text) {
  const el = $("recError");
  if (!el) {
    return;
  }
  if (text) {
    el.textContent = text;
    el.classList.add("is-visible");
  } else {
    el.textContent = "";
    el.classList.remove("is-visible");
  }
}

export function showSkeletons(count) {
  const grid = $("recommendationsGrid");
  if (!grid) {
    return;
  }
  grid.innerHTML = "";
  const n = typeof count === "number" && count > 0 ? Math.min(count, 12) : 4;
  for (let i = 0; i < n; i += 1) {
    const card = document.createElement("article");
    card.className = "skeleton-card";

    const poster = document.createElement("div");
    poster.className = "skeleton-poster";
    card.appendChild(poster);

    const body = document.createElement("div");
    body.className = "skeleton-stack";

    const titleLine = document.createElement("div");
    titleLine.className = "skeleton-line lg";
    body.appendChild(titleLine);

    const subtitleLine = document.createElement("div");
    subtitleLine.className = "skeleton-line";
    body.appendChild(subtitleLine);

    const metaRow = document.createElement("div");
    metaRow.className = "skeleton-meta";
    for (let chip = 0; chip < 3; chip += 1) {
      const chipEl = document.createElement("div");
      chipEl.className = "skeleton-chip";
      metaRow.appendChild(chipEl);
    }
    body.appendChild(metaRow);

    const plotLine = document.createElement("div");
    plotLine.className = "skeleton-line";
    body.appendChild(plotLine);

    card.appendChild(body);

    const shimmer = document.createElement("div");
    shimmer.className = "skeleton-shimmer";
    card.appendChild(shimmer);

    grid.appendChild(card);
  }
}

export function renderWatchedList(watchedMovies, options = {}) {
  const listEl = $("watchedList");
  const emptyEl = $("watchedEmpty");
  if (!listEl || !emptyEl) {
    return;
  }
  listEl.innerHTML = "";

  const onRemove = typeof options.onRemove === "function" ? options.onRemove : null;
  const viewEl = listEl.closest(".collection-view");
  const storedExpanded = getViewExpanded("watched");
  const expandedSet = getExpandedSet("watched");
  if (viewEl) {
    const previousToggle = viewEl.querySelector(".collection-collapse");
    if (previousToggle) {
      previousToggle.remove();
    }
  }

  if (!watchedMovies.length) {
    if (viewEl) {
      delete viewEl.dataset.collectionExpanded;
    }
    emptyEl.style.display = "block";
    return;
  }

  emptyEl.style.display = "none";

  const items = watchedMovies.map((movie) => {
      const item = document.createElement("div");
      item.className = "favorite-chip watched-chip";
      item.setAttribute("role", "button");
      item.setAttribute("tabindex", "0");
      item.setAttribute("aria-expanded", "false");

      const itemKey = getCollectionItemKey(movie);
      if (itemKey) {
        item.dataset.collectionKey = String(itemKey);
      }

      const posterWrap = document.createElement("div");
      posterWrap.className = "favorite-poster";
      if (movie.poster) {
        const img = document.createElement("img");
        img.src = movie.poster;
        img.alt = `Poster for ${movie.title}`;
        posterWrap.appendChild(img);
      } else {
        const placeholder = document.createElement("span");
        placeholder.className = "favorite-poster-placeholder";
        placeholder.textContent = "✓";
        placeholder.setAttribute("aria-hidden", "true");
        posterWrap.appendChild(placeholder);
      }

      const badge = document.createElement("span");
      badge.className = "watched-badge";
      badge.innerHTML = '<span aria-hidden="true">✓</span><span>Watched</span>';
      posterWrap.appendChild(badge);

      const content = document.createElement("div");
      content.className = "favorite-body";

      const title = document.createElement("div");
      title.className = "favorite-title";
      title.textContent = movie.title + (movie.year ? ` (${movie.year})` : "");

      const meta = document.createElement("div");
      meta.className = "favorite-genres";
      const parts = [];
      if (typeof movie.rating === "number" && Number.isFinite(movie.rating)) {
        parts.push(`IMDb ${movie.rating.toFixed(1)}`);
      }
      if (Array.isArray(movie.genres) && movie.genres.length) {
        parts.push(movie.genres.slice(0, 3).join(" • "));
      }
      meta.textContent = parts.length ? parts.join(" • ") : "Marked as watched";

      content.appendChild(title);
      content.appendChild(meta);

      item.appendChild(posterWrap);
      item.appendChild(content);

      const detail = document.createElement("div");
      detail.className = "favorite-details";
      detail.hidden = true;
      const summary = document.createElement("div");
      summary.className = "favorite-details-text";
      summary.textContent = "Logged in your watched history.";
      detail.appendChild(summary);

      const detailMeta = [];
      if (movie.year) {
        detailMeta.push(`Year: ${movie.year}`);
      }
      if (typeof movie.rating === "number" && Number.isFinite(movie.rating)) {
        detailMeta.push(`IMDb ${movie.rating.toFixed(1)}`);
      }
      if (Array.isArray(movie.genres) && movie.genres.length) {
        detailMeta.push(`Genres: ${movie.genres.join(", ")}`);
      }
      if (typeof movie.loggedAt === "number" && Number.isFinite(movie.loggedAt)) {
        const relative = formatRelativeTime(movie.loggedAt);
        if (relative) {
          detailMeta.push(`Logged ${relative}`);
        }
      }
      if (detailMeta.length) {
        const metaLine = document.createElement("div");
        metaLine.className = "favorite-details-meta";
        metaLine.textContent = detailMeta.join(" • ");
        detail.appendChild(metaLine);
      }

      if (onRemove) {
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "favorite-remove watched-remove";
        removeBtn.setAttribute(
          "aria-label",
          `Remove ${movie.title}${movie.year ? ` (${movie.year})` : ""} from watched`
        );
        removeBtn.innerHTML =
          '<span class="sr-only">Remove</span><span aria-hidden="true">✕</span>';
        removeBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          playUiClick();
          if (itemKey) {
            setExpandedValue("favorites", itemKey, false);
          }
          onRemove(movie);
        });
        item.appendChild(removeBtn);
      }

      item.appendChild(detail);

      const setExpanded = (expanded, { persist = true, silent = false } = {}) => {
        item.classList.toggle("expanded", expanded);
        detail.hidden = !expanded;
        item.setAttribute("aria-expanded", expanded ? "true" : "false");
        if (persist && itemKey) {
          setExpandedValue("watched", itemKey, expanded);
        }
        if (!silent) {
          playExpandSound(expanded);
        }
      };

      const toggleExpansion = () => {
        const next = !item.classList.contains("expanded");
        setExpanded(next);
      };

      if (itemKey && expandedSet.has(itemKey)) {
        setExpanded(true, { persist: false, silent: true });
      }

      item.addEventListener("click", (event) => {
        if (closest(event.target, ".favorite-remove")) {
          return;
        }
        playUiClick();
        toggleExpansion();
      });

      item.addEventListener("keydown", (event) => {
        if (closest(event.target, ".favorite-remove")) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          playUiClick();
          toggleExpansion();
        }
      });

      return item;
    });

  applyCollectionCollapse(listEl, viewEl, items, {
    wasExpanded: storedExpanded,
    onToggle: (expanded) => setViewExpanded("favorites", expanded)
  });
}

function applyCollectionCollapse(listEl, viewEl, items, options = {}) {
  const MAX_VISIBLE = 2;
  const hiddenItems = [];
  const wasExpanded = options.wasExpanded === true;
  const total = items.length;
  const hiddenCount = Math.max(0, total - MAX_VISIBLE);
  const shouldShowToggle = hiddenCount > 0 && Boolean(viewEl);
  const initialExpanded = shouldShowToggle && wasExpanded;
  const onToggle = typeof options.onToggle === "function" ? options.onToggle : null;

  items.forEach((item, index) => {
    const isHidden = shouldShowToggle && index >= MAX_VISIBLE;
    if (isHidden) {
      hiddenItems.push(item);
      if (!initialExpanded) {
        return;
      }
    }
    listEl.appendChild(item);
  });

  if (!shouldShowToggle || !viewEl) {
    if (viewEl) {
      delete viewEl.dataset.collectionExpanded;
    }
    return;
  }

  const toggleContainer = document.createElement("div");
  toggleContainer.className = "collection-collapse";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn-subtle btn-chip collection-collapse-btn";
  button.innerHTML = '<span class="label"></span><span class="icon" aria-hidden="true"></span>';
  toggleContainer.appendChild(button);
  listEl.insertAdjacentElement("afterend", toggleContainer);

  const labelEl = button.querySelector(".label");
  const iconEl = button.querySelector(".icon");

  const update = (expanded, { emit = true } = {}) => {
    if (expanded) {
      hiddenItems.forEach((item) => {
        if (!item.isConnected) {
          listEl.appendChild(item);
        }
      });
    } else {
      hiddenItems.forEach((item) => {
        if (item.parentElement === listEl) {
          listEl.removeChild(item);
        }
      });
    }
    viewEl.dataset.collectionExpanded = expanded ? "true" : "false";
    if (labelEl) {
      if (expanded) {
        labelEl.textContent = "Show less";
      } else if (hiddenCount === 1) {
        labelEl.textContent = "Show 1 more";
      } else {
        labelEl.textContent = `Show ${hiddenCount} more`;
      }
    }
    if (iconEl) {
      iconEl.textContent = expanded ? "▴" : "▾";
    }
    if (emit && onToggle) {
      onToggle(expanded);
    }
  };

  update(initialExpanded, { emit: false });

  button.addEventListener("click", () => {
    const expanded = viewEl.dataset.collectionExpanded === "true";
    const next = !expanded;
    playUiClick();
    update(next);
    playExpandSound(next);
  });
}

export function updateWatchedSummary(watchedMovies) {
  const el = $("watchedSummary");
  if (!el) {
    return;
  }
  if (!watchedMovies.length) {
    el.textContent =
      "Mark titles as watched to steer future suggestions and avoid repeats.";
    return;
  }

  const total = watchedMovies.length;
  const latest = watchedMovies[watchedMovies.length - 1];
  const favGenres = computeWatchedGenreWeights(watchedMovies);
  const topGenres = Object.entries(favGenres)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([genre]) => genre)
    .join(" • ");

  const pieces = [`${total} logged`];
  if (latest && latest.title) {
    pieces.push(`last added: ${latest.title}`);
  }
  if (topGenres) {
    pieces.push(`trending genres: ${topGenres}`);
  }

  el.textContent = pieces.join(" • ");
}

export function renderFavoritesList(favorites, options = {}) {
  const listEl = $("favoritesList");
  const emptyEl = $("favoritesEmpty");
  if (!listEl || !emptyEl) {
    return;
  }
  listEl.innerHTML = "";

  const onRemove = typeof options.onRemove === "function" ? options.onRemove : null;
  const viewEl = listEl.closest(".collection-view");
  const storedExpanded = getViewExpanded("favorites");
  const expandedSet = getExpandedSet("favorites");
  if (viewEl) {
    const previousToggle = viewEl.querySelector(".collection-collapse");
    if (previousToggle) {
      previousToggle.remove();
    }
  }

  if (!favorites.length) {
    if (viewEl) {
      delete viewEl.dataset.collectionExpanded;
    }
    emptyEl.style.display = "block";
    return;
  }

  emptyEl.style.display = "none";

  const items = favorites.map((movie) => {
      const item = document.createElement("div");
      item.className = "favorite-chip";
      item.setAttribute("role", "button");
      item.setAttribute("tabindex", "0");
      item.setAttribute("aria-expanded", "false");

      const itemKey = getCollectionItemKey(movie);
      if (itemKey) {
        item.dataset.collectionKey = String(itemKey);
      }

      const posterWrap = document.createElement("div");
      posterWrap.className = "favorite-poster";
      if (movie.poster) {
        const img = document.createElement("img");
        img.src = movie.poster;
        img.alt = `Poster for ${movie.title}`;
        posterWrap.appendChild(img);
      } else {
        const placeholder = document.createElement("span");
        placeholder.className = "favorite-poster-placeholder";
        placeholder.textContent = "🎬";
        posterWrap.appendChild(placeholder);
      }

      const content = document.createElement("div");
      content.className = "favorite-body";

      const title = document.createElement("div");
      title.className = "favorite-title";
      title.textContent = movie.title + (movie.year ? ` (${movie.year})` : "");

      const meta = document.createElement("div");
      meta.className = "favorite-meta";
      const metaParts = [];
      if (typeof movie.rating === "number" && Number.isFinite(movie.rating)) {
        metaParts.push(`IMDb ${movie.rating.toFixed(1)}`);
      }
      if (movie.year) {
        metaParts.push(movie.year);
      }
      meta.textContent = metaParts.length ? metaParts.join(" • ") : "No rating logged";

      const genres = document.createElement("div");
      genres.className = "favorite-genres";
      if (movie.genres && movie.genres.length) {
        genres.textContent = movie.genres.slice(0, 3).join(" • ");
      } else {
        genres.textContent = "Saved for later";
      }

      content.appendChild(title);
      content.appendChild(meta);
      content.appendChild(genres);

      item.appendChild(posterWrap);
      item.appendChild(content);

      const detail = document.createElement("div");
      detail.className = "favorite-details";
      detail.hidden = true;
      const overview = document.createElement("div");
      overview.className = "favorite-details-text";
      overview.textContent =
        movie.overview && movie.overview.trim()
          ? movie.overview.trim()
          : "No synopsis saved for this favorite.";
      detail.appendChild(overview);

      const detailMeta = [];
      if (movie.year) {
        detailMeta.push(`Year: ${movie.year}`);
      }
      if (typeof movie.rating === "number" && Number.isFinite(movie.rating)) {
        detailMeta.push(`IMDb ${movie.rating.toFixed(1)}`);
      }
      if (Array.isArray(movie.genres) && movie.genres.length) {
        detailMeta.push(`Genres: ${movie.genres.join(", ")}`);
      }
      if (detailMeta.length) {
        const metaLine = document.createElement("div");
        metaLine.className = "favorite-details-meta";
        metaLine.textContent = detailMeta.join(" • ");
        detail.appendChild(metaLine);
      }

      if (onRemove) {
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "favorite-remove";
        removeBtn.setAttribute("aria-label", `Remove ${movie.title} from favorites`);
        removeBtn.innerHTML = "✕";
        removeBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          playUiClick();
          if (itemKey) {
            setExpandedValue("favorites", itemKey, false);
          }
          onRemove(movie);
        });
        item.appendChild(removeBtn);
      }

      item.appendChild(detail);

      const setExpanded = (expanded, { persist = true, silent = false } = {}) => {
        item.classList.toggle("expanded", expanded);
        detail.hidden = !expanded;
        item.setAttribute("aria-expanded", expanded ? "true" : "false");
        if (persist && itemKey) {
          setExpandedValue("favorites", itemKey, expanded);
        }
        if (!silent) {
          playExpandSound(expanded);
        }
      };

      const toggleExpansion = () => {
        const next = !item.classList.contains("expanded");
        setExpanded(next);
      };

      if (itemKey && expandedSet.has(itemKey)) {
        setExpanded(true, { persist: false, silent: true });
      }

      item.addEventListener("click", (event) => {
        if (closest(event.target, ".favorite-remove")) {
          return;
        }
        playUiClick();
        toggleExpansion();
      });

      item.addEventListener("keydown", (event) => {
        if (closest(event.target, ".favorite-remove")) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          playUiClick();
          toggleExpansion();
        }
      });

      return item;
    });

  applyCollectionCollapse(listEl, viewEl, items, {
    wasExpanded: storedExpanded,
    onToggle: (expanded) => setViewExpanded("watched", expanded)
  });
}

export function updateFavoritesSummary(favorites) {
  const el = $("favoritesSummary");
  if (!el) {
    return;
  }

  if (!favorites.length) {
    el.textContent = "No favorites yet – tap the heart on any movie to pin it here.";
    return;
  }

  const total = favorites.length;
  const latest = favorites[favorites.length - 1];
  const label = latest && latest.title ? latest.title : "new pick";
  el.textContent = `${total} saved • newest: ${label}`;
}

export function renderRecommendations(items, watchedMovies, options = {}) {
  const grid = $("recommendationsGrid");
  if (!grid) {
    return;
  }
  closeMovieOverlay({ silent: true });
  grid.innerHTML = "";

  const favorites = Array.isArray(options.favorites) ? options.favorites : [];
  const onMarkWatched = typeof options.onMarkWatched === "function" ? options.onMarkWatched : null;
  const onToggleFavorite =
    typeof options.onToggleFavorite === "function" ? options.onToggleFavorite : null;
  const presenceSpotlights = Array.isArray(options.presenceSpotlights) ? options.presenceSpotlights : null;

  const watchedLookup = buildMovieLookup(watchedMovies, { normalizeTitle: false });
  const favoriteLookup = buildMovieLookup(favorites, { normalizeTitle: true });
  const fragment = document.createDocumentFragment();

  if (!items.length) {
    const msg = document.createElement("div");
    msg.className = "empty-state";
    msg.textContent =
      "No movies to show yet. Try adjusting your genres, then click “Find movies for me”.";
    grid.appendChild(msg);
    return;
  }

  items.forEach((item) => {
    const tmdb = item.tmdb || item.candidate || null;
    const card = createMovieCard(
      tmdb,
      item.omdb,
      item.trailer,
      item.reasons || [],
      watchedLookup,
      favoriteLookup,
      {
        onMarkWatched,
        onToggleFavorite,
        community: options.community || null,
        presenceSpotlights
      }
    );
    fragment.appendChild(card);
  });

  grid.appendChild(fragment);
}

function createMovieCard(tmdb, omdb, trailer, reasons, watchedLookup, favoriteLookup, handlers) {
  const hasReliableTmdb = Boolean(tmdb && (tmdb.id || tmdb.tmdb_id || tmdb.tmdbId || tmdb.title || tmdb.original_title));
  const hasReliableOmdb = Boolean(omdb && omdb.__source !== "tmdb-fallback");
  const omdbImdbId = getOmdbField(omdb, "imdbID");
  const tmdbImdbId = tmdb && tmdb.imdb_id ? tmdb.imdb_id : "";
  const imdbID = omdbImdbId || tmdbImdbId || "";
  const tmdbId = tmdb && (tmdb.id || tmdb.tmdb_id || tmdb.tmdbId)
    ? tmdb.id || tmdb.tmdb_id || tmdb.tmdbId
    : null;
  const tmdbPoster = tmdb && tmdb.poster_path ? `https://image.tmdb.org/t/p/w342${tmdb.poster_path}` : null;
  const omdbPoster = getOmdbField(omdb, "Poster");
  const poster = tmdbPoster || omdbPoster;
  const tmdbBackdrop = tmdb && tmdb.backdrop_path ? `https://image.tmdb.org/t/p/w780${tmdb.backdrop_path}` : null;
  const omdbTitle = getOmdbField(omdb, "Title");
  const tmdbTitle = tmdb && (tmdb.title || tmdb.original_title) ? tmdb.title || tmdb.original_title : null;
  const title = tmdbTitle || omdbTitle || "Unknown title";
  const originalTitle = tmdb && tmdb.original_title && tmdb.original_title !== title ? tmdb.original_title : null;
  const catalogTitle = omdbTitle && omdbTitle !== title ? omdbTitle : null;
  const omdbReleased = getOmdbField(omdb, "Released");
  const tmdbReleaseDate = tmdb && tmdb.release_date ? tmdb.release_date : null;
  const releaseIso = formatIsoDate(tmdbReleaseDate || omdbReleased);
  const releaseFriendly = formatFriendlyDate(tmdbReleaseDate || releaseIso);
  const releaseSource = tmdbReleaseDate ? "tmdb" : omdbReleased ? "omdb" : null;
  const omdbYearValue = getOmdbField(omdb, "Year") || "";
  const year = releaseIso ? releaseIso.slice(0, 4) : omdbYearValue;
  const omdbRuntime = getOmdbField(omdb, "Runtime");
  const hasTmdbRuntime = Boolean(
    tmdb && typeof tmdb.runtime === "number" && Number.isFinite(tmdb.runtime) && tmdb.runtime > 0
  );
  const tmdbRuntimeMinutes = hasTmdbRuntime ? tmdb.runtime : null;
  const runtime = formatRuntimeValue(tmdbRuntimeMinutes, omdbRuntime);
  const runtimeSource = tmdbRuntimeMinutes ? "tmdb" : omdbRuntime ? "omdb" : null;
  const rated = getOmdbField(omdb, "Rated");
  const omdbLanguage = getOmdbField(omdb, "Language");
  const languages = buildLanguageList(tmdb, omdbLanguage);
  const tmdbHasLanguageData = Boolean(
    (tmdb && Array.isArray(tmdb.spoken_languages) && tmdb.spoken_languages.length) ||
      (tmdb && tmdb.original_language)
  );
  const languageSource = tmdbHasLanguageData ? "tmdb" : omdbLanguage ? "omdb" : null;
  const director = getOmdbField(omdb, "Director");
  const writer = getOmdbField(omdb, "Writer");
  const actors = splitOmdbList(omdb, "Actors", 3).join(", ") || null;
  const country = getOmdbField(omdb, "Country");
  const awards = getOmdbField(omdb, "Awards");
  const boxOffice = getOmdbField(omdb, "BoxOffice");
  const tmdbOverview = tmdb && typeof tmdb.overview === "string" && tmdb.overview.trim() ? tmdb.overview.trim() : "";
  const omdbPlot = getOmdbField(omdb, "Plot");
  const primarySynopsis = tmdbOverview || omdbPlot || "No synopsis available for this title.";
  const ratingRaw = getOmdbField(omdb, "imdbRating");
  const imdbRatingNumeric = ratingRaw ? parseFloat(ratingRaw) : null;
  const imdbRating = Number.isFinite(imdbRatingNumeric) ? imdbRatingNumeric.toFixed(1) : "–";
  const tmdbRating = tmdb && typeof tmdb.vote_average === "number" ? tmdb.vote_average.toFixed(1) : "–";
  const tmdbVotes = tmdb && typeof tmdb.vote_count === "number" ? tmdb.vote_count : null;
  const tmdbPopularity = tmdb && typeof tmdb.popularity === "number" ? tmdb.popularity : null;
  const imdbVotesRaw = getOmdbField(omdb, "imdbVotes");
  const imdbVotesNumeric = imdbVotesRaw ? Number(imdbVotesRaw.replace(/[,_]/g, "")) : null;
  const imdbVotesDisplay = imdbVotesNumeric ? imdbVotesNumeric.toLocaleString() : imdbVotesRaw;
  const metascore = getOmdbField(omdb, "Metascore");
  const ratingsMap = buildOmdbRatingsMap(omdb);
  const genres = buildGenreList(tmdb, omdb);
  const tmdbHasGenres = Boolean(tmdb && Array.isArray(tmdb.genre_ids) && tmdb.genre_ids.length);
  const genreSource = tmdbHasGenres ? "tmdb" : genres.length ? "omdb" : null;
  const imdbIdSource = omdbImdbId ? "omdb" : tmdbImdbId ? "tmdb" : null;

  const card = document.createElement("article");
  card.className = "movie-card collapsed";
  if (tmdbId) {
    card.dataset.tmdbId = String(tmdbId);
  }
  if (imdbID) {
    card.dataset.imdbId = String(imdbID);
  }
  if (title) {
    card.dataset.title = title.toLowerCase();
  }

  const summaryButton = document.createElement("div");
  summaryButton.className = "movie-summary";
  summaryButton.setAttribute("role", "button");
  summaryButton.setAttribute("tabindex", "0");
  summaryButton.setAttribute("aria-expanded", "false");
  const summaryBackdrop = document.createElement("div");
  summaryBackdrop.className = "movie-summary-backdrop";
  summaryBackdrop.setAttribute("aria-hidden", "true");
  const backgroundSource = tmdbBackdrop || poster;
  if (backgroundSource) {
    summaryBackdrop.style.setProperty("--movie-backdrop-image", `url(${backgroundSource})`);
  }
  summaryButton.appendChild(summaryBackdrop);

  const posterWrap = document.createElement("div");
  posterWrap.className = "movie-summary-poster";
  if (poster) {
    const img = document.createElement("img");
    img.src = poster;
    img.alt = `Poster for ${title}`;
    posterWrap.appendChild(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "poster-placeholder";
    placeholder.innerHTML = "<span class=\"poster-placeholder-icon\">🎞️</span><span>No poster</span>";
    posterWrap.appendChild(placeholder);
  }

  const infoWrap = document.createElement("div");
  infoWrap.className = "movie-summary-info";

  const titleRow = document.createElement("div");
  titleRow.className = "movie-title-row";
  const titleEl = document.createElement("div");
  titleEl.className = "movie-title";
  titleEl.textContent = title;
  const yearEl = document.createElement("div");
  yearEl.className = "movie-year";
  yearEl.textContent = year || "";
  titleRow.appendChild(titleEl);
  titleRow.appendChild(yearEl);

  let titleVariants = null;
  if (originalTitle || catalogTitle) {
    titleVariants = document.createElement("div");
    titleVariants.className = "movie-title-variants";
    if (originalTitle) {
      const variant = document.createElement("span");
      variant.className = "movie-title-variant";
      variant.innerHTML = `<span>Original:</span> <strong>${originalTitle}</strong>`;
      titleVariants.appendChild(variant);
    }
    if (catalogTitle) {
      const variant = document.createElement("span");
      variant.className = "movie-title-variant";
      variant.innerHTML = `<span>OMDb:</span> <strong>${catalogTitle}</strong>`;
      titleVariants.appendChild(variant);
    }
  }

  const metaRow = document.createElement("div");
  metaRow.className = "movie-meta-row";
  const metaChips = [
    createMetaChip("Year", year || null),
    createMetaChip("Release", releaseIso || releaseFriendly || null),
    createMetaChip("Rated", rated || null),
    createMetaChip("Runtime", runtime || null),
    createMetaChip("Language", languages.length ? languages.join(", ") : null)
  ];
  metaChips.forEach((chip) => {
    if (chip) {
      metaRow.appendChild(chip);
    }
  });
  const idRow = createIdRow(imdbID);

  const communityContext = document.createElement("div");
  communityContext.className = "movie-community-context";
  communityContext.dataset.state = "idle";
  communityContext.hidden = false;
  communityContext.setAttribute("aria-live", "polite");

  const communityAvatars = document.createElement("div");
  communityAvatars.className = "movie-community-avatars";
  const communityMeta = document.createElement("div");
  communityMeta.className = "movie-community-meta";
  const communityOverall = document.createElement("span");
  communityOverall.className = "movie-community-chip";
  communityOverall.textContent = "Community intel warming up";
  communityMeta.appendChild(communityOverall);

  const communityFriends = document.createElement("span");
  communityFriends.className = "movie-community-chip is-friends";
  communityFriends.dataset.empty = "true";
  communityFriends.textContent = "No friend reviews yet";
  communityMeta.appendChild(communityFriends);

  const communitySummary = document.createElement("div");
  communitySummary.className = "movie-community-summary";
  communitySummary.appendChild(communityAvatars);
  communitySummary.appendChild(communityMeta);
  communityContext.appendChild(communitySummary);

  const communityActivity = document.createElement("div");
  communityActivity.className = "movie-community-activity";
  communityActivity.hidden = false;
  communityActivity.textContent = "Leave a quick note to start the thread.";

  const communityQuickEntry = document.createElement("button");
  communityQuickEntry.type = "button";
  communityQuickEntry.className = "movie-community-quick";
  communityQuickEntry.innerHTML =
    '<span class="movie-community-quick-icon" aria-hidden="true">💬</span><span class="movie-community-quick-label">Notes</span>';
  communityQuickEntry.setAttribute(
    "aria-label",
    "Open community notes and leave a quick review"
  );
  communityQuickEntry.hidden = !(handlers && handlers.community);
  communityQuickEntry.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    playUiClick();
    card.dispatchEvent(
      new CustomEvent("movie-card:set-state", {
        detail: { expand: true }
      })
    );
    focusCommunitySection(card, { pulse: true, focusInput: true });
  });
  communityContext.appendChild(communityQuickEntry);

  const ratingsRow = document.createElement("div");
  ratingsRow.className = "movie-ratings";

  const imdbPill = document.createElement("div");
  imdbPill.className = "rating-pill";
  const imdbSummaryValue =
    imdbRating !== "–"
      ? imdbRating
      : ratingsMap.imdb
      ? ratingsMap.imdb
      : "–";
  imdbPill.innerHTML = `<span class="star">★</span><strong>${imdbSummaryValue}</strong><span>IMDb</span>`;
  ratingsRow.appendChild(imdbPill);

  const tmdbPill = document.createElement("div");
  tmdbPill.className = "rating-pill rating-pill-secondary";
  tmdbPill.innerHTML = `<span class="star">★</span><strong>${tmdbRating}</strong><span>TMDB</span>`;
  ratingsRow.appendChild(tmdbPill);

  const providers = Array.isArray(tmdb?.streamingProviders) ? tmdb.streamingProviders.slice(0, 4) : [];
  if (providers.length) {
    const availabilityRow = document.createElement("div");
    availabilityRow.className = "movie-availability";
    providers.forEach((provider) => {
      const badge = document.createElement("span");
      badge.className = "badge provider";
      badge.textContent = provider.name || provider.key || "Stream";
      if (provider.brandColor) {
        badge.style.borderColor = provider.brandColor;
        badge.style.color = provider.brandColor;
      }
      if (provider.region) {
        badge.title = provider.region;
      }
      availabilityRow.appendChild(badge);
    });
    ratingsRow.appendChild(availabilityRow);
  }

  const reasonText = formatReasons(reasons);
  const reasonRow = reasonText ? document.createElement("div") : null;
  if (reasonRow) {
    reasonRow.className = "movie-reason";
    reasonRow.textContent = reasonText;
  }

  const presenceRow = buildMoviePresenceRow(handlers && handlers.presenceSpotlights);
  const flagRow = createFlagRow(tmdb);
  const synopsisBlock = buildSynopsisBlock(primarySynopsis, tmdbOverview ? "TMDb overview" : "Synopsis");
  const genreTags = document.createElement("div");
  genreTags.className = "genre-tags";
  genres.forEach((genre) => {
    const tag = document.createElement("span");
    tag.className = "genre-tag";
    tag.textContent = genre.label;
    if (genre.id) {
      tag.dataset.genreId = String(genre.id);
      tag.title = `TMDb genre ID ${genre.id}`;
    }
    genreTags.appendChild(tag);
  });

  infoWrap.appendChild(titleRow);
  infoWrap.appendChild(communityContext);
  infoWrap.appendChild(communityActivity);
  if (titleVariants) {
    infoWrap.appendChild(titleVariants);
  }
  if (metaRow.childElementCount) {
    infoWrap.appendChild(metaRow);
  }
  if (idRow) {
    infoWrap.appendChild(idRow);
  }
  infoWrap.appendChild(ratingsRow);
  if (flagRow) {
    infoWrap.appendChild(flagRow);
  }
  if (reasonRow) {
    infoWrap.appendChild(reasonRow);
  }
  if (presenceRow) {
    infoWrap.appendChild(presenceRow);
  }
  if (genreTags.childElementCount) {
    infoWrap.appendChild(genreTags);
  }
  if (synopsisBlock) {
    infoWrap.appendChild(synopsisBlock);
  }

  const stateIcons = document.createElement("div");
  stateIcons.className = "movie-state-icons";

  const watchedStateIcon = document.createElement("span");
  watchedStateIcon.className = "movie-state-icon watched-icon";
  watchedStateIcon.setAttribute("role", "button");
  watchedStateIcon.setAttribute("tabindex", "0");
  stateIcons.appendChild(watchedStateIcon);

  const favoriteStateIcon = document.createElement("span");
  favoriteStateIcon.className = "movie-state-icon favorite-icon";
  favoriteStateIcon.setAttribute("role", "button");
  favoriteStateIcon.setAttribute("tabindex", "0");
  stateIcons.appendChild(favoriteStateIcon);

  infoWrap.appendChild(stateIcons);

  summaryButton.appendChild(posterWrap);
  summaryButton.appendChild(infoWrap);

  const communityBadge = document.createElement("span");
  communityBadge.className = "movie-community-badge";
  communityBadge.hidden = true;
  summaryButton.appendChild(communityBadge);

  const details = document.createElement("div");
  details.className = "movie-details";

  const summaryMeta = document.createElement("div");
  summaryMeta.className = "movie-detail-grid";
  appendDetail(summaryMeta, "Director", director || "—", { source: "omdb" });
  appendDetail(summaryMeta, "Writer", writer || "—", { source: "omdb" });
  appendDetail(summaryMeta, "Main cast", actors || "—", { source: "omdb" });
  appendDetail(summaryMeta, "Country", country || "—", { source: "omdb" });
  appendDetail(summaryMeta, "Awards", awards || "—", { source: "omdb" });
  appendDetail(summaryMeta, "Box office", boxOffice || "—", { source: "omdb" });
  appendDetail(summaryMeta, "Rated", rated || "Not rated", { source: "omdb" });
  appendDetail(summaryMeta, "Runtime", runtime || "Unknown", { source: runtimeSource });
  appendDetail(
    summaryMeta,
    "Genres",
    genres.length ? genres.map((genre) => genre.label).join(", ") : "—",
    { source: genreSource }
  );
  appendDetail(summaryMeta, "Release (ISO)", releaseIso || "—", { source: releaseSource });
  appendDetail(
    summaryMeta,
    "Primary language",
    languages.length ? languages.join(", ") : "—",
    { source: languageSource }
  );
  appendDetail(summaryMeta, "IMDb ID", imdbID || "—", { source: imdbIdSource });
  appendDetail(summaryMeta, "TMDb ID", tmdbId ? String(tmdbId) : "—", { source: "tmdb" });

  const missingDetailSources = [];
  if (!hasReliableOmdb) {
    missingDetailSources.push("omdb");
  }
  if (!hasReliableTmdb) {
    missingDetailSources.push("tmdb");
  }
  if (missingDetailSources.length) {
    removeDetailItemsBySource(summaryMeta, missingDetailSources);
  }

  const plotEl = document.createElement("div");
  plotEl.className = "movie-plot";
  const plotText = document.createElement("p");
  plotText.className = "movie-plot-text";
  const plotValue = omdbPlot || primarySynopsis;
  plotText.textContent = plotValue;
  const plotLabel = document.createElement("span");
  plotLabel.className = "movie-plot-label";
  plotLabel.textContent = omdbPlot ? "OMDb synopsis" : "Synopsis";
  plotEl.appendChild(plotLabel);
  plotEl.appendChild(plotText);

  if (typeof plotValue === "string" && plotValue.trim().length > 220) {
    plotEl.classList.add("is-collapsible", "is-collapsed");

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "movie-plot-toggle";
    toggleBtn.innerHTML =
      '<span class="label">Read more</span><span class="icon" aria-hidden="true">▾</span>';
    toggleBtn.setAttribute("aria-expanded", "false");

    const setExpanded = (expanded) => {
      plotEl.classList.toggle("is-expanded", expanded);
      plotEl.classList.toggle("is-collapsed", !expanded);
      toggleBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
      const label = toggleBtn.querySelector(".label");
      if (label) {
        label.textContent = expanded ? "Show less" : "Read more";
      }
      const icon = toggleBtn.querySelector(".icon");
      if (icon) {
        icon.textContent = expanded ? "▴" : "▾";
      }
    };

    toggleBtn.addEventListener("click", () => {
      const expanded = !plotEl.classList.contains("is-expanded");
      playUiClick();
      setExpanded(expanded);
      playExpandSound(expanded);
    });

    setExpanded(false);
    plotEl.appendChild(toggleBtn);
  }

  const ratingBoard = buildRatingBoard([
    {
      label: "TMDb score",
      value: tmdbRating !== "–" ? `${tmdbRating}/10` : null,
      meta: tmdbVotes ? `${tmdbVotes.toLocaleString()} votes` : null
    },
    {
      label: "TMDb popularity",
      value: tmdbPopularity != null ? formatNumberValue(tmdbPopularity, { decimals: 1 }) : null
    },
    { label: "IMDb (Ratings API)", value: ratingsMap.imdb || null },
    { label: "Rotten Tomatoes", value: ratingsMap.rotten || null },
    { label: "Metacritic (Ratings API)", value: ratingsMap.metacritic || null },
    {
      label: "IMDb rating",
      value:
        imdbRating !== "–"
          ? `${imdbRating}/10`
          : ratingRaw
          ? ratingRaw
          : null,
      meta: imdbVotesDisplay || null
    },
    { label: "IMDb votes", value: imdbVotesDisplay || null },
    { label: "Metascore", value: metascore || null }
  ]);

  const factGrid = document.createElement("div");
  factGrid.className = "movie-facts-grid";
  appendFactChip(factGrid, "Release", releaseFriendly || releaseIso || null);
  appendFactChip(factGrid, "Release (ISO)", releaseIso || null);
  appendFactChip(factGrid, "Original language", languages.length ? languages[0] : null);
  appendFactChip(factGrid, "TMDb ID", tmdbId ? String(tmdbId) : null);
  appendFactChip(
    factGrid,
    "TMDb popularity",
    tmdbPopularity != null ? formatNumberValue(tmdbPopularity, { decimals: 1 }) : null
  );
  appendFactChip(
    factGrid,
    "TMDb votes",
    tmdbVotes ? tmdbVotes.toLocaleString() : null
  );

  const actions = document.createElement("div");
  actions.className = "movie-actions";

  const watchedBtn = document.createElement("button");
  watchedBtn.type = "button";
  watchedBtn.className = "watched-btn";
  watchedBtn.innerHTML = `<span class="watched-btn-icon">👁️</span><span>I’ve watched this</span>`;
  const watchedMatch = hasMovieInLookup(watchedLookup, imdbID, title, { normalizeTitle: false });
  if (watchedMatch) {
    markButtonAsWatched(watchedBtn, title, watchedStateIcon, { animate: false });
  } else {
    watchedBtn.setAttribute("aria-pressed", "false");
    watchedBtn.setAttribute("aria-label", `Mark ${title} as watched`);
    applyWatchedIconState(watchedStateIcon, false, title);
  }

  const attemptMarkWatched = () => {
    if (watchedBtn.classList.contains("watched")) {
      return false;
    }
    const added = handlers.onMarkWatched ? handlers.onMarkWatched(omdb, tmdb) : true;
    if (added) {
      markButtonAsWatched(watchedBtn, title, watchedStateIcon, { animate: true });
    }
    return added;
  };

  watchedBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    playUiClick();
    attemptMarkWatched();
  });

  const handleWatchedIconActivate = (event) => {
    event.stopPropagation();
    playUiClick();
    attemptMarkWatched();
  };

  watchedStateIcon.addEventListener("click", handleWatchedIconActivate);
  watchedStateIcon.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleWatchedIconActivate(event);
    }
  });

  const favoriteBtn = document.createElement("button");
  favoriteBtn.type = "button";
  favoriteBtn.className = "favorite-btn";
  favoriteBtn.innerHTML = `<span class="favorite-btn-icon">♡</span><span>Save to favorites</span>`;
  const isFavorite = hasMovieInLookup(favoriteLookup, imdbID, title, { normalizeTitle: true });
  setFavoriteState(favoriteBtn, isFavorite, favoriteStateIcon, title);

  const toggleFavorite = () => {
    if (!handlers.onToggleFavorite) {
      return;
    }
    const currentlyFavorite = favoriteBtn.classList.contains("favorited");
    const nowFavorite = handlers.onToggleFavorite({
      omdb,
      tmdb,
      isFavorite: currentlyFavorite
    });
    if (typeof nowFavorite === "boolean") {
      setFavoriteState(favoriteBtn, nowFavorite, favoriteStateIcon, title, { animate: true });
      playFavoriteSound(nowFavorite);
    }
  };

  favoriteBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFavorite();
  });

  const handleFavoriteIconActivate = (event) => {
    event.stopPropagation();
    playUiClick();
    toggleFavorite();
  };

  favoriteStateIcon.addEventListener("click", handleFavoriteIconActivate);
  favoriteStateIcon.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleFavoriteIconActivate(event);
    }
  });

  actions.appendChild(watchedBtn);
  actions.appendChild(favoriteBtn);

  const trailerArea = document.createElement("div");
  trailerArea.className = "movie-trailer";

  if (trailer && trailer.embedUrl) {
    const trailerWrap = document.createElement("div");
    trailerWrap.className = "trailer-frame-wrap";
    const iframe = document.createElement("iframe");
    iframe.className = "trailer-iframe";
    iframe.src = trailer.embedUrl;
    iframe.loading = "lazy";
    iframe.title = `${title} trailer`;
    iframe.allow =
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.referrerPolicy = "no-referrer-when-downgrade";
    iframe.allowFullscreen = true;
    trailerWrap.appendChild(iframe);
    trailerArea.appendChild(trailerWrap);

    const linkRow = document.createElement("div");
    linkRow.className = "trailer-link-row";
    const link = document.createElement("a");
    link.className = "trailer-link";
    link.href = trailer.directUrl || trailer.searchUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.innerHTML = `<span class="trailer-link-icon">▶</span><span>Play trailer on YouTube</span>`;
    linkRow.appendChild(link);
    trailerArea.appendChild(linkRow);
  } else {
    const fallback = document.createElement("div");
    fallback.className = "trailer-fallback";
    const line1 = document.createElement("div");
    line1.textContent = "No embedded trailer found via YouTube API.";
    const link = document.createElement("a");
    link.className = "trailer-link";
    link.href =
      trailer && trailer.searchUrl
        ? trailer.searchUrl
        : `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} trailer`)}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.innerHTML = `<span class="trailer-link-icon">🔎</span><span>Search trailer on YouTube</span>`;
    fallback.appendChild(line1);
    fallback.appendChild(link);
    trailerArea.appendChild(fallback);
  }

  if (summaryMeta.childElementCount) {
    details.appendChild(summaryMeta);
  }
  if (factGrid.childElementCount) {
    details.appendChild(factGrid);
  }
  details.appendChild(plotEl);
  if (ratingBoard) {
    details.appendChild(ratingBoard);
  }
  details.appendChild(actions);
  details.appendChild(trailerArea);

  if (
    handlers &&
    handlers.community &&
    typeof handlers.community.buildSection === "function"
  ) {
    const communitySection = handlers.community.buildSection({
      tmdbId,
      imdbId: imdbID,
      title,
      headerSummary: {
        container: communityContext,
        avatars: communityAvatars,
        overall: communityOverall,
        friends: communityFriends,
        activity: communityActivity,
        badge: communityBadge
      }
    });
    if (communitySection) {
      details.appendChild(communitySection);
    }
  }

  const setExpansionState = (expanded, options = {}) => {
    const next = Boolean(expanded);
    const isExpanded = card.classList.contains("expanded");
    if (next === isExpanded) {
      return;
    }
    card.classList.toggle("expanded", next);
    card.classList.toggle("collapsed", !next);
    summaryButton.setAttribute("aria-expanded", next ? "true" : "false");
    if (!options.silent) {
      playExpandSound(next);
    }
    if (next && tmdbId) {
      acknowledgeFriendActivity(String(tmdbId));
    }
  };

  const handleSummaryInteraction = (event) => {
    if (event) {
      if (event.type === "keydown") {
        if (event.target !== summaryButton) {
          return;
        }
        const key = event.key;
        if (key !== "Enter" && key !== " ") {
          return;
        }
      }
      event.preventDefault();
    }
    playUiClick();
    const handledByOverlay = showMovieOverlay(card);
    if (!handledByOverlay) {
      const shouldExpand = !card.classList.contains("expanded");
      setExpansionState(shouldExpand);
    }
  };

  summaryButton.addEventListener("click", handleSummaryInteraction);
  summaryButton.addEventListener("keydown", handleSummaryInteraction);

  card.addEventListener("movie-card:set-state", (event) => {
    const detail = event && event.detail ? event.detail : {};
    const expand = typeof detail.expand === "boolean" ? detail.expand : true;
    setExpansionState(expand, detail);
  });

  card.appendChild(summaryButton);
  card.appendChild(details);

  return card;
}

export function highlightRecommendationCard(target, options = {}) {
  if (!target) {
    return false;
  }
  const tmdbId = target.tmdbId ? String(target.tmdbId) : "";
  const imdbId = target.imdbId ? String(target.imdbId) : "";
  const normalizedTitle = typeof target.title === "string" ? target.title.trim().toLowerCase() : "";
  const cards = document.querySelectorAll(".movie-card");
  let match = null;
  cards.forEach((card) => {
    if (match) {
      return;
    }
    const cardTmdb = card.dataset.tmdbId || "";
    const cardImdb = card.dataset.imdbId || "";
    const cardTitle = card.dataset.title || "";
    if (
      (tmdbId && cardTmdb === tmdbId) ||
      (imdbId && cardImdb === imdbId) ||
      (normalizedTitle && cardTitle === normalizedTitle)
    ) {
      match = card;
    }
  });
  if (!match) {
    return false;
  }
  const duration = typeof options.highlightDuration === "number" ? options.highlightDuration : 1800;
  match.classList.add("movie-card--notification-focus");
  window.setTimeout(() => {
    match.classList.remove("movie-card--notification-focus");
  }, duration);
  if (options.scroll !== false) {
    const block = options.scrollBlock || "center";
    match.scrollIntoView({ behavior: "smooth", block });
  }
  if (options.expand && match.classList.contains("collapsed")) {
    match.dispatchEvent(
      new CustomEvent("movie-card:set-state", {
        detail: { expand: true, silent: true }
      })
    );
  }
  if (options.focusCommunity) {
    focusCommunitySection(match, { pulse: true, pulseDuration: duration });
  }
  if (typeof options.onFocused === "function") {
    options.onFocused(match);
  }
  return true;
}

function focusCommunitySection(card, { pulse = false, focusInput = false, pulseDuration = 1800 } = {}) {
  if (!card) {
    return;
  }
  window.requestAnimationFrame(() => {
    const community = card.querySelector(".community-notes");
    if (!community) {
      return;
    }
    community.hidden = false;
    if (pulse) {
      community.classList.add("community-notes--pulse");
      window.setTimeout(() => {
        community.classList.remove("community-notes--pulse");
      }, pulseDuration);
    }
    community.scrollIntoView({ behavior: "smooth", block: "start" });
    if (focusInput) {
      const input = community.querySelector(".community-textarea");
      if (input) {
        input.focus();
      }
    }
  });
}

function appendDetail(container, label, value, options = {}) {
  const item = document.createElement("div");
  item.className = "detail-item";
  const sourceList = Array.isArray(options.sources)
    ? options.sources
    : options.source
    ? [options.source]
    : [];
  const normalizedSources = sourceList
    .map((source) => (typeof source === "string" ? source.trim() : ""))
    .filter(Boolean);
  if (normalizedSources.length) {
    item.dataset.sources = normalizedSources.join(" ");
  }
  const dt = document.createElement("span");
  dt.className = "detail-label";
  dt.textContent = label;
  const dd = document.createElement("span");
  dd.className = "detail-value";
  dd.textContent = value || "—";
  item.appendChild(dt);
  item.appendChild(dd);
  container.appendChild(item);
  return item;
}

function removeDetailItemsBySource(container, missingSources) {
  if (!container || !Array.isArray(missingSources) || !missingSources.length) {
    return;
  }
  const items = container.querySelectorAll(".detail-item");
  items.forEach((item) => {
    const attr = item.dataset.sources;
    if (!attr) {
      return;
    }
    const sources = attr.split(/\s+/).filter(Boolean);
    const shouldRemove = sources.some((source) => missingSources.includes(source));
    if (shouldRemove) {
      item.remove();
    }
  });
}

function formatReasons(reasons) {
  if (!reasons || !reasons.length) {
    return "";
  }
  const unique = Array.from(new Set(reasons));
  const topTwo = unique.slice(0, 2);
  if (topTwo.length === 1) {
    return topTwo[0];
  }
  return topTwo.join(" • ");
}

function buildMoviePresenceRow(spotlights) {
  if (!Array.isArray(spotlights) || !spotlights.length) {
    return null;
  }
  const row = document.createElement("div");
  row.className = "movie-presence-row";
  const label = document.createElement("span");
  label.className = "movie-presence-label";
  label.textContent = "Friends online";
  row.appendChild(label);
  const chips = document.createElement("div");
  chips.className = "movie-presence-chips";
  spotlights.slice(0, 3).forEach((spotlight) => {
    if (!spotlight || !spotlight.displayName) {
      return;
    }
    const chip = document.createElement("span");
    chip.className = "movie-presence-chip";
    if (spotlight.statusKey) {
      chip.dataset.status = spotlight.statusKey;
    }
    const icon = document.createElement("span");
    icon.className = "movie-presence-chip-icon";
    icon.textContent = spotlight.icon || "👥";
    chip.appendChild(icon);
    const name = document.createElement("strong");
    name.textContent = spotlight.displayName;
    chip.appendChild(name);
    const message = document.createElement("span");
    message.textContent = formatPresenceMessage(spotlight.message);
    chip.appendChild(message);
    chips.appendChild(chip);
  });
  if (!chips.childElementCount) {
    return null;
  }
  row.appendChild(chips);
  return row;
}

function formatPresenceMessage(message) {
  const text = typeof message === "string" ? message.trim() : "is online now.";
  if (!text) {
    return "is online now.";
  }
  return text.replace(/\s+/g, " ");
}

function markButtonAsWatched(btn, title, watchedIcon, options = {}) {
  btn.classList.add("watched");
  btn.setAttribute("aria-pressed", "true");
  btn.setAttribute("aria-label", `Marked ${title} as watched`);
  btn.innerHTML = "";
  const icon = document.createElement("span");
  icon.className = "watched-btn-icon";
  icon.textContent = "✓";
  const text = document.createElement("span");
  text.textContent = "Watched";
  btn.appendChild(icon);
  btn.appendChild(text);
  applyWatchedIconState(watchedIcon, true, title);
  if (options.animate) {
    triggerStateIconPulse(watchedIcon);
  }
}

function setFavoriteState(btn, isFavorite, favoriteIcon, title, options = {}) {
  if (isFavorite) {
    btn.classList.add("favorited");
    btn.setAttribute("aria-pressed", "true");
    btn.innerHTML = `<span class="favorite-btn-icon">♥</span><span>Favorited</span>`;
    applyFavoriteIconState(favoriteIcon, true, title);
  } else {
    btn.classList.remove("favorited");
    btn.setAttribute("aria-pressed", "false");
    btn.innerHTML = `<span class="favorite-btn-icon">♡</span><span>Save to favorites</span>`;
    applyFavoriteIconState(favoriteIcon, false, title);
  }
  if (options.animate) {
    triggerStateIconPulse(favoriteIcon);
  }
}

function applyWatchedIconState(iconEl, isWatched, title) {
  if (!iconEl) {
    return;
  }
  iconEl.classList.toggle("active", isWatched);
  iconEl.innerHTML = isWatched
    ? '<span class="icon">✓</span><span>Watched</span>'
    : '<span class="icon">👁️</span><span>Watched</span>';
  iconEl.setAttribute("aria-pressed", isWatched ? "true" : "false");
  if (title) {
    iconEl.setAttribute(
      "aria-label",
      isWatched ? `${title} marked as watched` : `Mark ${title} as watched`
    );
  }
}

function applyFavoriteIconState(iconEl, isFavorite, title) {
  if (!iconEl) {
    return;
  }
  iconEl.classList.toggle("active", isFavorite);
  iconEl.innerHTML = isFavorite
    ? '<span class="icon">♥</span><span>Favorite</span>'
    : '<span class="icon">♡</span><span>Favorite</span>';
  iconEl.setAttribute("aria-pressed", isFavorite ? "true" : "false");
  if (title) {
    iconEl.setAttribute(
      "aria-label",
      isFavorite ? `${title} saved to favorites` : `Save ${title} to favorites`
    );
  }
}

function triggerStateIconPulse(iconEl) {
  if (!iconEl) {
    return;
  }
  iconEl.classList.remove("state-icon-pulse");
  // force reflow so animation can restart
  // eslint-disable-next-line no-unused-expressions
  iconEl.offsetWidth;
  iconEl.classList.add("state-icon-pulse");
  iconEl.addEventListener(
    "animationend",
    () => {
      iconEl.classList.remove("state-icon-pulse");
    },
    { once: true }
  );
}
