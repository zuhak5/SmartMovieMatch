export function computeWatchedGenreWeights(watchedMovies) {
  const map = Object.create(null);
  watchedMovies.forEach((movie) => {
    (movie.genres || []).forEach((genre) => {
      if (!genre) return;
      map[genre] = (map[genre] || 0) + 1;
    });
  });
  return map;
}

export function getWatchedRatingPreference(watchedMovies) {
  if (!watchedMovies.length) {
    return null;
  }
  const ratings = watchedMovies
    .map((movie) => movie.rating)
    .filter((rating) => typeof rating === "number");
  if (!ratings.length) {
    return null;
  }
  const total = ratings.reduce((sum, rating) => sum + rating, 0);
  return total / ratings.length;
}
