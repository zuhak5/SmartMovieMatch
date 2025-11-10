export function loadWatchedMovies(storageKey) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((movie) => movie && movie.title)
      : [];
  } catch (error) {
    console.warn("Failed to read watched movies from storage:", error);
    return [];
  }
}

export function saveWatchedMovies(storageKey, watchedMovies) {
  try {
    const compact = watchedMovies.map((movie) => ({
      imdbID: movie.imdbID || null,
      title: movie.title,
      year: movie.year || "",
      genres: Array.isArray(movie.genres) ? movie.genres : [],
      rating: movie.rating || null
    }));
    window.localStorage.setItem(storageKey, JSON.stringify(compact));
  } catch (error) {
    console.warn("Failed to save watched movies:", error);
  }
}

export function loadFavorites(storageKey) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((movie) => movie && movie.title)
      : [];
  } catch (error) {
    console.warn("Failed to read favorites from storage:", error);
    return [];
  }
}

export function saveFavorites(storageKey, favorites) {
  try {
    const compact = favorites.map((movie) => ({
      imdbID: movie.imdbID || null,
      title: movie.title,
      year: movie.year || "",
      poster: movie.poster || null,
      overview: movie.overview || "",
      genres: Array.isArray(movie.genres) ? movie.genres : []
    }));
    window.localStorage.setItem(storageKey, JSON.stringify(compact));
  } catch (error) {
    console.warn("Failed to save favorites:", error);
  }
}
