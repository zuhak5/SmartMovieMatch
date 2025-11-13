import { computeWatchedGenreWeights } from "./taste.js";
import { $ } from "./dom.js";
import { playExpandSound, playFavoriteSound, playUiClick } from "./sound.js";
import { acknowledgeFriendActivity } from "./social.js";

const COLLECTION_STATE_KEY = "smm.collection-state.v1";
const COLLECTION_DEFAULT_STATE = {
  expandedItems: { favorites: [], watched: [] },
  viewExpanded: { favorites: false, watched: false }
};
const TOAST_DURATION = 4200;

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
  try {
    const raw = localStorage.getItem(COLLECTION_STATE_KEY);
    if (!raw) {
      return cloneCollectionState(COLLECTION_DEFAULT_STATE);
    }
    const parsed = JSON.parse(raw);
    return cloneCollectionState({ ...COLLECTION_DEFAULT_STATE, ...parsed });
  } catch (error) {
    console.warn("Failed to read collection state", error);
    return cloneCollectionState(COLLECTION_DEFAULT_STATE);
  }
}

function writeCollectionState(state) {
  try {
    localStorage.setItem(COLLECTION_STATE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Failed to persist collection state", error);
  }
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
        if (event.target.closest(".favorite-remove")) {
          return;
        }
        playUiClick();
        toggleExpansion();
      });

      item.addEventListener("keydown", (event) => {
        if (event.target.closest(".favorite-remove")) {
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
        if (event.target.closest(".favorite-remove")) {
          return;
        }
        playUiClick();
        toggleExpansion();
      });

      item.addEventListener("keydown", (event) => {
        if (event.target.closest(".favorite-remove")) {
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
  const imdbID = omdb && omdb.imdbID ? omdb.imdbID : "";
  const tmdbId = tmdb && (tmdb.id || tmdb.tmdb_id || tmdb.tmdbId)
    ? tmdb.id || tmdb.tmdb_id || tmdb.tmdbId
    : null;
  const tmdbPoster = tmdb && tmdb.poster_path ? `https://image.tmdb.org/t/p/w342${tmdb.poster_path}` : null;
  const omdbPoster = omdb && omdb.Poster && omdb.Poster !== "N/A" ? omdb.Poster : null;
  const poster = tmdbPoster || omdbPoster;
  const title = omdb && omdb.Title ? omdb.Title : tmdb && tmdb.title ? tmdb.title : "Unknown title";
  const year = omdb && omdb.Year ? omdb.Year : tmdb && tmdb.release_date ? tmdb.release_date.slice(0, 4) : "";
  const ratingRaw = omdb && omdb.imdbRating ? omdb.imdbRating : null;
  const imdbRating = ratingRaw && ratingRaw !== "N/A" ? parseFloat(ratingRaw).toFixed(1) : "–";
  const tmdbRating = tmdb && typeof tmdb.vote_average === "number" ? tmdb.vote_average.toFixed(1) : "–";
  const tmdbVotes = tmdb && typeof tmdb.vote_count === "number" ? tmdb.vote_count : null;
  const genres = omdb && omdb.Genre ? omdb.Genre.split(",").map((g) => g.trim()) : [];
  const plot =
    omdb && omdb.Plot && omdb.Plot !== "N/A"
      ? omdb.Plot
      : "No plot summary available for this title.";

  const card = document.createElement("article");
  card.className = "movie-card collapsed";

  const summaryButton = document.createElement("button");
  summaryButton.type = "button";
  summaryButton.className = "movie-summary";
  summaryButton.setAttribute("aria-expanded", "false");

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

  const ratingsRow = document.createElement("div");
  ratingsRow.className = "movie-ratings";

  const imdbPill = document.createElement("div");
  imdbPill.className = "rating-pill";
  imdbPill.innerHTML = `<span class="star">★</span><strong>${imdbRating}</strong><span>IMDb</span>`;
  ratingsRow.appendChild(imdbPill);

  const tmdbPill = document.createElement("div");
  tmdbPill.className = "rating-pill rating-pill-secondary";
  tmdbPill.innerHTML = `<span class="star">★</span><strong>${tmdbRating}</strong><span>TMDB</span>`;
  ratingsRow.appendChild(tmdbPill);

  const reasonText = formatReasons(reasons);
  if (reasonText) {
    const reasonRow = document.createElement("div");
    reasonRow.className = "movie-reason";
    reasonRow.textContent = reasonText;
    infoWrap.appendChild(reasonRow);
  }

  const presenceRow = buildMoviePresenceRow(handlers && handlers.presenceSpotlights);
  if (presenceRow) {
    infoWrap.appendChild(presenceRow);
  }

  infoWrap.appendChild(titleRow);
  infoWrap.appendChild(ratingsRow);

  const genreTags = document.createElement("div");
  genreTags.className = "genre-tags";
  genres.forEach((genre) => {
    const tag = document.createElement("span");
    tag.className = "genre-tag";
    tag.textContent = genre;
    genreTags.appendChild(tag);
  });
  infoWrap.appendChild(genreTags);

  const communityMeta = document.createElement("div");
  communityMeta.className = "movie-community-meta";
  communityMeta.hidden = true;

  const communityOverall = document.createElement("span");
  communityOverall.className = "movie-community-chip";
  communityMeta.appendChild(communityOverall);

  const communityFriends = document.createElement("span");
  communityFriends.className = "movie-community-chip is-friends";
  communityMeta.appendChild(communityFriends);

  infoWrap.appendChild(communityMeta);

  const communityActivity = document.createElement("div");
  communityActivity.className = "movie-community-activity";
  communityActivity.hidden = true;
  infoWrap.appendChild(communityActivity);

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
  appendDetail(summaryMeta, "Runtime", omdb && omdb.Runtime && omdb.Runtime !== "N/A" ? omdb.Runtime : "Unknown");
  appendDetail(summaryMeta, "Director", omdb && omdb.Director && omdb.Director !== "N/A" ? omdb.Director : "—");
  appendDetail(summaryMeta, "Cast", omdb && omdb.Actors && omdb.Actors !== "N/A" ? omdb.Actors.split(",").slice(0, 3).join(", ") : "—");
  if (tmdbVotes) {
    appendDetail(summaryMeta, "TMDB votes", tmdbVotes.toLocaleString());
  }

  const plotEl = document.createElement("div");
  plotEl.className = "movie-plot";
  const plotText = document.createElement("p");
  plotText.className = "movie-plot-text";
  plotText.textContent = plot;
  plotEl.appendChild(plotText);

  if (typeof plot === "string" && plot.trim().length > 220) {
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

  details.appendChild(summaryMeta);
  details.appendChild(plotEl);
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
        container: communityMeta,
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

  const toggleExpansion = () => {
    const expanded = card.classList.toggle("expanded");
    card.classList.toggle("collapsed", !expanded);
    summaryButton.setAttribute("aria-expanded", expanded ? "true" : "false");
    playExpandSound(expanded);
    if (expanded && tmdbId) {
      acknowledgeFriendActivity(String(tmdbId));
    }
  };

  summaryButton.addEventListener("click", () => {
    playUiClick();
    toggleExpansion();
  });

  card.appendChild(summaryButton);
  card.appendChild(details);

  return card;
}

function appendDetail(container, label, value) {
  const item = document.createElement("div");
  item.className = "detail-item";
  const dt = document.createElement("span");
  dt.className = "detail-label";
  dt.textContent = label;
  const dd = document.createElement("span");
  dd.className = "detail-value";
  dd.textContent = value;
  item.appendChild(dt);
  item.appendChild(dd);
  container.appendChild(item);
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
