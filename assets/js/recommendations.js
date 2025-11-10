import { fetchFromOmdb, fetchFromTmdb, fetchFromYoutube } from "./api.js";
import { TMDB_GENRES } from "./config.js";
import {
  computeWatchedGenreWeights,
  getWatchedRatingPreference
} from "./taste.js";

const omdbCache = new Map();
const ytCache = new Map();

const ABORT_ERROR_NAME = "AbortError";

function isAbortError(error) {
  return (
    !!error &&
    (error.name === ABORT_ERROR_NAME || (typeof error.code === "number" && error.code === 20))
  );
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    const abortError = new Error("Aborted");
    abortError.name = ABORT_ERROR_NAME;
    throw abortError;
  }
}

export async function discoverCandidateMovies(
  { selectedGenres, favoriteTitles, seed },
  { signal } = {}
) {
  const candidateMap = new Map();

  const fetchOptions = { signal };

  const favorites = Array.isArray(favoriteTitles)
    ? favoriteTitles
        .map((title) => (typeof title === "string" ? title.trim() : ""))
        .filter((title) => title.length > 0)
        .slice(0, 6)
    : [];

  function addCandidatesFromResults(results, opts = {}) {
    if (!Array.isArray(results)) {
      return;
    }
    const weightMultiplier =
      typeof opts.weightMultiplier === "number" ? opts.weightMultiplier : 1;
    const reason = opts.reason;

    results.forEach((movie) => {
      if (!movie || !movie.id || !movie.title) {
        return;
      }
      if (!Array.isArray(movie.genre_ids) || !movie.genre_ids.length) {
        return;
      }

      const existing = candidateMap.get(movie.id) || {
        movie,
        score: 0,
        reasons: []
      };

      const rating =
        typeof movie.vote_average === "number" ? movie.vote_average : 0;
      const popularity =
        typeof movie.popularity === "number" ? movie.popularity : 0;
      const voteCount =
        typeof movie.vote_count === "number" ? movie.vote_count : 0;
      let score = rating * 0.9 + popularity * 0.03;

      if (selectedGenres.length) {
        const overlap = movie.genre_ids.filter((id) =>
          selectedGenres.includes(String(id))
        );
        score += overlap.length * 4.2;
      }

      if (voteCount) {
        score += Math.log10(1 + voteCount) * 1.5;
      }

      if (movie.release_date) {
        const year = parseInt(movie.release_date.slice(0, 4), 10);
        if (!Number.isNaN(year)) {
          const age = Math.max(0, new Date().getFullYear() - year);
          const recencyBoost = 1 / (1 + age / 8);
          score += recencyBoost * 2;
        }
      }

      existing.score += score * weightMultiplier;

      if (reason && !existing.reasons.includes(reason)) {
        existing.reasons.push(reason);
      }

      candidateMap.set(movie.id, existing);
    });
  }

  const genreList = [...selectedGenres];

  const discoverParams = {
    sort_by: "popularity.desc",
    "vote_count.gte": "150"
  };

  if (genreList.length) {
    discoverParams.with_genres = genreList.join(",");
  }

  if (typeof seed === "number") {
    discoverParams.page = String(1 + Math.floor(seed * 3));
  }

  try {
    throwIfAborted(signal);
    const data = await fetchFromTmdb("discover/movie", discoverParams, fetchOptions);
    if (data && Array.isArray(data.results)) {
      addCandidatesFromResults(data.results, {
        weightMultiplier: 1,
        reason: genreList.length
          ? "Popular in your chosen genres"
          : "Popular worldwide this week"
      });
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    console.warn("TMDB discover error:", error);
  }

  if (favorites.length) {
    const favoriteTasks = favorites.map(async (favoriteTitle) => {
      const chunk = favoriteTitle;
      throwIfAborted(signal);
      let data;
      try {
        data = await fetchFromTmdb(
          "search/movie",
          {
            query: chunk,
            include_adult: "false"
          },
          fetchOptions
        );
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        console.warn("TMDB search error for favorite", chunk, error);
        return;
      }

      if (!data || !Array.isArray(data.results)) {
        return;
      }

      addCandidatesFromResults(data.results, {
        weightMultiplier: 1.4,
        reason: `Because "${chunk}" is in your favorites`
      });

      const topMatch = data.results[0];
      if (!topMatch || !topMatch.id) {
        return;
      }

      const referenceTitle = topMatch.title || topMatch.original_title || chunk;
      const followUps = [];

      followUps.push(
        (async () => {
          try {
            const recommendations = await fetchFromTmdb(
              `movie/${topMatch.id}/recommendations`,
              {},
              fetchOptions
            );
            if (recommendations && Array.isArray(recommendations.results)) {
              addCandidatesFromResults(recommendations.results, {
                weightMultiplier: 1.25,
                reason: `Fans of "${referenceTitle}" also enjoyed`
              });
            }
          } catch (error) {
            if (isAbortError(error)) {
              throw error;
            }
            console.warn(
              "TMDB recommendations error for",
              referenceTitle,
              error
            );
          }
        })()
      );

      followUps.push(
        (async () => {
          try {
            const similar = await fetchFromTmdb(
              `movie/${topMatch.id}/similar`,
              {},
              fetchOptions
            );
            if (similar && Array.isArray(similar.results)) {
              addCandidatesFromResults(similar.results, {
                weightMultiplier: 1.1,
                reason: `Similar picks to "${referenceTitle}"`
              });
            }
          } catch (error) {
            if (isAbortError(error)) {
              throw error;
            }
            console.warn("TMDB similar error for", referenceTitle, error);
          }
        })()
      );

      await Promise.all(followUps);
    });

    await Promise.all(favoriteTasks);
  }

  if (!selectedGenres.length && !favorites.length) {
    try {
      throwIfAborted(signal);
      const data = await fetchFromTmdb("trending/movie/week", {}, fetchOptions);
      if (data && Array.isArray(data.results)) {
        addCandidatesFromResults(data.results, {
          weightMultiplier: 0.9,
          reason: "Trending this week"
        });
      }
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      console.warn("TMDB trending error:", error);
    }
  }

  return Array.from(candidateMap.values());
}

export function scoreAndSelectCandidates(candidates, opts, watchedMovies) {
  const selectedGenres = opts.selectedGenres || [];
  const favoriteTitles = Array.isArray(opts.favoriteTitles) ? opts.favoriteTitles : [];
  const favoriteSet = new Set(
    favoriteTitles
      .map((title) => (typeof title === "string" ? title.toLowerCase() : ""))
      .filter(Boolean)
  );
  const maxCount =
    typeof opts.maxCount === "number" && opts.maxCount > 0 ? opts.maxCount : 8;
  const seed = typeof opts.seed === "number" ? opts.seed : null;
  const baseSeed =
    seed !== null ? (Math.floor(Math.abs(seed) * 1_000_000_000) >>> 0) : null;

  const noiseForMovie = (movie) => {
    if (baseSeed === null) {
      return Math.random();
    }
    const idSource =
      movie && movie.id !== undefined && movie.id !== null
        ? movie.id
        : movie && movie.title
        ? movie.title
        : "";
    const str = String(idSource);
    let hash = 0;
    for (let i = 0; i < str.length; i += 1) {
      hash = Math.imul(31, hash) + str.charCodeAt(i);
      hash |= 0;
    }
    let combined = (hash ^ baseSeed) >>> 0;
    combined = Math.imul(combined ^ (combined >>> 15), 0x2c1b3c6d);
    combined = Math.imul(combined ^ (combined >>> 12), 0x297a2d39);
    combined = (combined ^ (combined >>> 15)) >>> 0;
    return combined / 4294967295;
  };

  const watchedGenreWeights = computeWatchedGenreWeights(watchedMovies);
  const watchedHasAny = Object.keys(watchedGenreWeights).length > 0;
  const avgPref = getWatchedRatingPreference(watchedMovies);

  const watchedTitlesSet = new Set(
    watchedMovies.map((movie) => (movie.imdbID || movie.title || "").toLowerCase())
  );

  const scored = candidates
    .map((entry) => {
      const movie = entry.movie;
      const baseScore = entry.score || 0;
      const genreNames = (movie.genre_ids || []).map(
        (id) => TMDB_GENRES[id] || ""
      );
      const rating =
        typeof movie.vote_average === "number" ? movie.vote_average : 0;
      const voteCount =
        typeof movie.vote_count === "number" ? movie.vote_count : 0;

      let personalizationBoost = 0;
      const reasons = Array.isArray(entry.reasons)
        ? [...new Set(entry.reasons)]
        : [];

      const addReason = (text) => {
        if (text && !reasons.includes(text)) {
          reasons.push(text);
        }
      };

      const normalizedTitle = (movie.title || movie.original_title || "").toLowerCase();
      if (normalizedTitle && favoriteSet.has(normalizedTitle)) {
        personalizationBoost += 3.5;
        addReason("Inspired by your favorites list");
      }

      if (watchedHasAny) {
        genreNames.forEach((name) => {
          if (!name) return;
          const weight = watchedGenreWeights[name];
          if (weight) {
            personalizationBoost += 1.1 * Math.sqrt(weight);
            addReason("Echoes your watched favorites");
          }
        });
      }

      if (!selectedGenres.length) {
        const count = (movie.genre_ids || []).length || 1;
        personalizationBoost += 0.3 * count;
      } else {
        const overlaps = genreNames.filter((name) =>
          selectedGenres.some((id) => TMDB_GENRES[id] === name)
        );
        if (overlaps.length) {
          addReason("Matches your selected genres");
        }
      }

      if (avgPref && rating) {
        const diff = Math.abs(avgPref - rating);
        personalizationBoost += Math.max(0, 2.5 - diff);
        if (diff < 1) {
          addReason("In the same rating lane you tend to enjoy");
        }
      }

      const imdbKey = (movie.id || movie.title || "").toString().toLowerCase();
      const alreadyWatched = watchedTitlesSet.has(imdbKey);

      const qualityBoost = rating ? rating * 0.6 : 0;
      if (rating >= 7.5) {
        addReason("Well loved by movie fans (7.5+ rating)");
      } else if (rating >= 6.8) {
        addReason("Solid viewer scores on TMDB");
      }

      if (voteCount >= 500) {
        addReason("Backed by lots of community votes");
      }

      if (movie.release_date) {
        const year = parseInt(movie.release_date.slice(0, 4), 10);
        if (!Number.isNaN(year) && new Date().getFullYear() - year <= 3) {
          addReason("Fresh release from the last few years");
        }
      }

      const slightRandom = noiseForMovie(movie) * 0.4;

      return {
        movie,
        reasons,
        score:
          baseScore +
          personalizationBoost +
          qualityBoost +
          slightRandom -
          (alreadyWatched ? 999 : 0),
        alreadyWatched
      };
    })
    .filter((entry) => !entry.alreadyWatched);

  const genreCounts = new Map();
  const remaining = scored.slice();
  const selected = [];

  const computePenalty = (entry) => {
    const names = (entry.movie.genre_ids || [])
      .map((id) => TMDB_GENRES[id] || "")
      .filter(Boolean);
    if (!names.length) {
      return 0;
    }
    return names.reduce(
      (sum, name) => sum + (genreCounts.get(name) || 0) * 0.9,
      0
    );
  };

  while (remaining.length && selected.length < maxCount) {
    remaining.sort(
      (a, b) => b.score - computePenalty(b) - (a.score - computePenalty(a))
    );
    const next = remaining.shift();
    const penalty = computePenalty(next);
    const adjustedScore = next.score - penalty;
    if (penalty < 0.5 && selected.length > 0) {
      const hasReason = next.reasons.some((reason) => reason.includes("mix"));
      if (!hasReason) {
        next.reasons.push("Balances the mix");
      }
    }
    next.score = adjustedScore;
    selected.push(next);
    const genres = (next.movie.genre_ids || [])
      .map((id) => TMDB_GENRES[id] || "")
      .filter(Boolean);
    genres.forEach((genre) => {
      genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
    });
  }

  selected.sort((a, b) => b.score - a.score);

  return selected.slice(0, maxCount);
}

export async function fetchOmdbForCandidates(entries, { signal } = {}) {
  const fetchOptions = { signal };
  const tasks = entries.map(async (entry) => {
    throwIfAborted(signal);
    const movie = entry.movie;
    const reasons = entry.reasons || [];
    const title = movie.title || movie.original_title;
    if (!title) {
      return null;
    }

    let year = "";
    if (movie.release_date && movie.release_date.length >= 4) {
      year = movie.release_date.slice(0, 4);
    }

    const cacheKey = `${title}|${year}`;
    if (omdbCache.has(cacheKey)) {
      return {
        candidate: movie,
        tmdb: movie,
        omdb: omdbCache.get(cacheKey),
        reasons
      };
    }

    try {
      const data = await fetchFromOmdb({ t: title, y: year }, fetchOptions);
      if (!data || data.Response === "False") {
        return null;
      }
      omdbCache.set(cacheKey, data);
      return {
        candidate: movie,
        tmdb: movie,
        omdb: data,
        reasons
      };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      console.warn("OMDb fetch error for", title, error);
      return null;
    }
  });

  try {
    const results = await Promise.all(tasks);
    return results.filter(Boolean);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw error;
  }
}

export async function fetchTrailersForMovies(items, { signal } = {}) {
  const fetchOptions = { signal };
  const tasks = items.map(async (item) => {
    throwIfAborted(signal);
    const { omdb, tmdb, candidate, reasons } = item;
    const tmdbSource = tmdb || candidate || null;
    const title = omdb.Title;
    const year = omdb.Year || "";
    const query = `${title} ${year ? year + " " : ""}official trailer`;

    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
      query
    )}`;

    const cached = ytCache.get(query);
    if (cached) {
      return { omdb, tmdb: tmdbSource, candidate: tmdbSource, trailer: cached, reasons };
    }

    let trailer = {
      embedUrl: null,
      directUrl: null,
      searchUrl
    };

    try {
      const data = await fetchFromYoutube(
        {
          q: query,
          maxResults: 1,
          type: "video"
        },
        fetchOptions
      );
      if (data && Array.isArray(data.items) && data.items.length > 0) {
        const first = data.items[0];
        const videoId = first.id && first.id.videoId ? first.id.videoId : null;
        if (videoId) {
          trailer.embedUrl = `https://www.youtube.com/embed/${videoId}`;
          trailer.directUrl = `https://www.youtube.com/watch?v=${videoId}`;
        }
      }
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      console.warn("YouTube fetch error for", title, error);
    }

    ytCache.set(query, trailer);
    return { omdb, tmdb: tmdbSource, candidate: tmdbSource, trailer, reasons };
  });

  try {
    const results = await Promise.all(tasks);
    return results;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw error;
  }
}
