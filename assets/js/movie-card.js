const noop = () => {};

function setActiveState(button, isActive) {
  button.classList.toggle("is-active", isActive);
  button.setAttribute("aria-pressed", String(isActive));
}

function updateActionLabel(button, { activeLabel, inactiveLabel, isActive }) {
  const labelNode = button.querySelector(".label");
  const iconNode = button.querySelector(".icon");
  if (labelNode) {
    labelNode.textContent = isActive ? activeLabel : inactiveLabel;
  }
  if (iconNode && iconNode.dataset.iconActive && iconNode.dataset.iconInactive) {
    iconNode.textContent = isActive ? iconNode.dataset.iconActive : iconNode.dataset.iconInactive;
  }
}

export function createMovieCard(props = {}) {
  const {
    posterUrl = "",
    title = "Untitled",
    year = "",
    imdbScore = "",
    rtScore = "",
    inWatchlist = false,
    liked = false,
    watched = false,
    onToggleWatchlist = noop,
    onToggleLike = noop,
    onToggleWatched = noop
  } = props;

  const state = { inWatchlist, liked, watched };

  const card = document.createElement("article");
  card.className = "movie-card";
  card.innerHTML = `
    <div class="movie-card__poster">
      <div class="movie-card__status-bar" aria-hidden="true">
        <span class="movie-card__status-chip" data-watched-indicator>
          <span class="icon">✔</span>
          <span>Watched</span>
        </span>
      </div>
      <img src="" alt="" loading="lazy" />
    </div>
    <div class="movie-card__body">
      <div class="movie-card__title-row">
        <div class="movie-card__title">
          <div class="truncate">${title}</div>
        </div>
        ${year ? `<span class="movie-card__year">${year}</span>` : ""}
      </div>
      <div class="movie-card__ratings" aria-label="Ratings">
        <span class="movie-card__rating-chip" title="IMDb score">
          <small>IMDb</small>
          <span>${imdbScore || "—"}</span>
        </span>
        <span class="movie-card__rating-chip" title="Rotten Tomatoes score">
          <small>RT</small>
          <span>${rtScore || "—"}</span>
        </span>
      </div>
      <div class="movie-card__actions">
        <button class="movie-card__action-btn" type="button" data-action="watchlist" aria-pressed="false" aria-label="Add to watchlist">
          <span class="icon" data-icon-inactive="🔖" data-icon-active="📌">🔖</span>
          <span class="label">Watchlist</span>
        </button>
        <button class="movie-card__action-btn" type="button" data-action="like" aria-pressed="false" aria-label="Like movie">
          <span class="icon" data-icon-inactive="👍" data-icon-active="❤️">👍</span>
          <span class="label">Like</span>
        </button>
        <button class="movie-card__action-btn movie-card__pill" type="button" data-action="watched" aria-pressed="false" aria-label="Mark as watched">
          <span class="icon" data-icon-inactive="👁️" data-icon-active="✔">👁️</span>
          <span class="label">Watched</span>
        </button>
      </div>
    </div>
  `;

  const posterImg = card.querySelector("img");
  if (posterImg) {
    posterImg.src = posterUrl || "https://image.tmdb.org/t/p/w500/1httn8iK5wWzMMzvDTzbo2uiSUp.jpg";
    posterImg.alt = `${title} poster`;
  }

  const watchedIndicator = card.querySelector("[data-watched-indicator]");
  const watchlistBtn = card.querySelector('[data-action="watchlist"]');
  const likeBtn = card.querySelector('[data-action="like"]');
  const watchedBtn = card.querySelector('[data-action="watched"]');

  const refresh = () => {
    if (watchlistBtn) {
      setActiveState(watchlistBtn, state.inWatchlist);
      updateActionLabel(watchlistBtn, {
        activeLabel: "In Watchlist",
        inactiveLabel: "Watchlist",
        isActive: state.inWatchlist
      });
      watchlistBtn.setAttribute("title", state.inWatchlist ? "Remove from watchlist" : "Add to watchlist");
    }
    if (likeBtn) {
      setActiveState(likeBtn, state.liked);
      updateActionLabel(likeBtn, {
        activeLabel: "Liked",
        inactiveLabel: "Like",
        isActive: state.liked
      });
      likeBtn.setAttribute("title", state.liked ? "Remove like" : "Like this movie");
    }
    if (watchedBtn) {
      setActiveState(watchedBtn, state.watched);
      updateActionLabel(watchedBtn, {
        activeLabel: "Watched",
        inactiveLabel: "Watch",
        isActive: state.watched
      });
      watchedBtn.setAttribute("title", state.watched ? "Mark as not watched" : "Mark as watched");
    }
    if (watchedIndicator) {
      watchedIndicator.style.display = state.watched ? "inline-flex" : "none";
    }
  };

  if (watchlistBtn) {
    watchlistBtn.addEventListener("click", () => {
      state.inWatchlist = !state.inWatchlist;
      refresh();
      onToggleWatchlist(state.inWatchlist, card);
    });
  }

  if (likeBtn) {
    likeBtn.addEventListener("click", () => {
      state.liked = !state.liked;
      refresh();
      onToggleLike(state.liked, card);
    });
  }

  if (watchedBtn) {
    watchedBtn.addEventListener("click", () => {
      state.watched = !state.watched;
      refresh();
      onToggleWatched(state.watched, card);
    });
  }

  refresh();
  return card;
}
