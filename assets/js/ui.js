import { computeWatchedGenreWeights } from "./taste.js";
import { $ } from "./dom.js";
import { playExpandSound, playFavoriteSound, playUiClick } from "./sound.js";

export function setRecStatus(text, loading) {
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
}

export function setRecError(text) {
  const el = $("recError");
  if (!el) {
    return;
  }
  if (text) {
    el.textContent = text;
    el.style.display = "block";
  } else {
    el.textContent = "";
    el.style.display = "none";
  }
}

export function showSkeletons(count) {
  const grid = $("recommendationsGrid");
  if (!grid) {
    return;
  }
  grid.innerHTML = "";
  const n = typeof count === "number" && count > 0 ? count : 4;
  for (let i = 0; i < n; i += 1) {
    const sk = document.createElement("div");
    sk.className = "skeleton-card";
    const shimmer = document.createElement("div");
    shimmer.className = "skeleton-shimmer";
    sk.appendChild(shimmer);
    grid.appendChild(sk);
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

  if (!watchedMovies.length) {
    emptyEl.style.display = "block";
    return;
  }

  emptyEl.style.display = "none";

  watchedMovies
    .slice()
    .reverse()
    .forEach((movie) => {
      const item = document.createElement("div");
      item.className = "favorite-chip watched-chip";

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
        removeBtn.addEventListener("click", () => {
          playUiClick();
          onRemove(movie);
        });
        item.appendChild(removeBtn);
      }

      listEl.appendChild(item);
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

  if (!favorites.length) {
    emptyEl.style.display = "block";
    return;
  }

  emptyEl.style.display = "none";

  favorites
    .slice()
    .reverse()
    .forEach((movie) => {
      const item = document.createElement("div");
      item.className = "favorite-chip";

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

      const genres = document.createElement("div");
      genres.className = "favorite-genres";
      if (movie.genres && movie.genres.length) {
        genres.textContent = movie.genres.slice(0, 3).join(" • ");
      } else {
        genres.textContent = "Saved for later";
      }

      content.appendChild(title);
      content.appendChild(genres);

      item.appendChild(posterWrap);
      item.appendChild(content);

      if (onRemove) {
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "favorite-remove";
        removeBtn.setAttribute("aria-label", `Remove ${movie.title} from favorites`);
        removeBtn.innerHTML = "✕";
        removeBtn.addEventListener("click", () => {
          playUiClick();
          onRemove(movie);
        });
        item.appendChild(removeBtn);
      }

      listEl.appendChild(item);
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
      watchedMovies,
      favorites,
      { onMarkWatched, onToggleFavorite }
    );
    grid.appendChild(card);
  });
}

function createMovieCard(tmdb, omdb, trailer, reasons, watchedMovies, favorites, handlers) {
  const imdbID = omdb && omdb.imdbID ? omdb.imdbID : "";
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

  const stateIcons = document.createElement("div");
  stateIcons.className = "movie-state-icons";

  const watchedStateIcon = document.createElement("span");
  watchedStateIcon.className = "movie-state-icon watched-icon";
  stateIcons.appendChild(watchedStateIcon);

  const favoriteStateIcon = document.createElement("span");
  favoriteStateIcon.className = "movie-state-icon favorite-icon";
  stateIcons.appendChild(favoriteStateIcon);

  infoWrap.appendChild(stateIcons);

  summaryButton.appendChild(posterWrap);
  summaryButton.appendChild(infoWrap);

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
  plotEl.textContent = plot;

  const actions = document.createElement("div");
  actions.className = "movie-actions";

  const watchedBtn = document.createElement("button");
  watchedBtn.type = "button";
  watchedBtn.className = "watched-btn";
  watchedBtn.innerHTML = `<span class="watched-btn-icon">👁️</span><span>I’ve watched this</span>`;
  const watchedMatch = watchedMovies.some((movie) =>
    imdbID ? movie.imdbID === imdbID : movie.title === title
  );
  if (watchedMatch) {
    markButtonAsWatched(watchedBtn, title, watchedStateIcon);
  } else {
    watchedBtn.setAttribute("aria-pressed", "false");
    watchedBtn.setAttribute("aria-label", `Mark ${title} as watched`);
    applyWatchedIconState(watchedStateIcon, false);
  }

  watchedBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    playUiClick();
    if (watchedBtn.classList.contains("watched")) {
      return;
    }
    const added = handlers.onMarkWatched ? handlers.onMarkWatched(omdb) : true;
    if (added) {
      markButtonAsWatched(watchedBtn, title, watchedStateIcon);
    }
  });

  const favoriteBtn = document.createElement("button");
  favoriteBtn.type = "button";
  favoriteBtn.className = "favorite-btn";
  favoriteBtn.innerHTML = `<span class="favorite-btn-icon">♡</span><span>Save to favorites</span>`;
  const isFavorite = favorites.some((fav) =>
    imdbID && fav.imdbID
      ? fav.imdbID === imdbID
      : fav.title.toLowerCase() === title.toLowerCase()
  );
  setFavoriteState(favoriteBtn, isFavorite, favoriteStateIcon);

  favoriteBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!handlers.onToggleFavorite) {
      return;
    }
    const nowFavorite = handlers.onToggleFavorite({ omdb, tmdb, isFavorite });
    if (typeof nowFavorite === "boolean") {
      setFavoriteState(favoriteBtn, nowFavorite, favoriteStateIcon);
      playFavoriteSound(nowFavorite);
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

  const toggleExpansion = () => {
    const expanded = card.classList.toggle("expanded");
    card.classList.toggle("collapsed", !expanded);
    summaryButton.setAttribute("aria-expanded", expanded ? "true" : "false");
    playExpandSound(expanded);
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

function markButtonAsWatched(btn, title, watchedIcon) {
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
  applyWatchedIconState(watchedIcon, true);
}

function setFavoriteState(btn, isFavorite, favoriteIcon) {
  if (isFavorite) {
    btn.classList.add("favorited");
    btn.setAttribute("aria-pressed", "true");
    btn.innerHTML = `<span class="favorite-btn-icon">♥</span><span>Favorited</span>`;
    applyFavoriteIconState(favoriteIcon, true);
  } else {
    btn.classList.remove("favorited");
    btn.setAttribute("aria-pressed", "false");
    btn.innerHTML = `<span class="favorite-btn-icon">♡</span><span>Save to favorites</span>`;
    applyFavoriteIconState(favoriteIcon, false);
  }
}

function applyWatchedIconState(iconEl, isWatched) {
  if (!iconEl) {
    return;
  }
  iconEl.classList.toggle("active", isWatched);
  iconEl.innerHTML = isWatched
    ? '<span class="icon">✓</span><span>Watched</span>'
    : '<span class="icon">👁️</span><span>Watched</span>';
}

function applyFavoriteIconState(iconEl, isFavorite) {
  if (!iconEl) {
    return;
  }
  iconEl.classList.toggle("active", isFavorite);
  iconEl.innerHTML = isFavorite
    ? '<span class="icon">♥</span><span>Favorite</span>'
    : '<span class="icon">♡</span><span>Favorite</span>';
}
