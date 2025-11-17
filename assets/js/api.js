import { API_ROUTES } from "./config.js";
import {
  FALLBACK_DISCOVER_MOVIES,
  FALLBACK_PEOPLE,
  FALLBACK_TRENDING_MOVIES
} from "./fallback-data.js";

const REQUEST_TIMEOUT_MS = 12000;
const OFFLINE_STATUS_CODES = new Set([404, 500, 501]);
const DEFAULT_SEARCH_LIMIT = 12;
const MAX_SEARCH_LIMIT = 50;

class OfflineApiError extends Error {
  constructor(message) {
    super(message || "API unavailable; using fallback data");
    this.name = "OfflineApiError";
  }
}

let apiOffline = false;
let offlineReason = "";

function markApiOffline(reason = "") {
  apiOffline = true;
  offlineReason = reason;
}

function isOfflineError(error) {
  return error instanceof OfflineApiError || error?.name === "OfflineApiError";
}

function isOfflineTrigger(error) {
  if (isOfflineError(error)) {
    return true;
  }
  if (error?.name === "TypeError") {
    return true;
  }
  if (typeof error?.status === "number" && OFFLINE_STATUS_CODES.has(error.status)) {
    return true;
  }
  return false;
}

function ensureApiOnline() {
  if (apiOffline) {
    throw new OfflineApiError(offlineReason || "API unavailable; using fallback data");
  }
}

function clampLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(MAX_SEARCH_LIMIT, Math.max(1, parsed));
  }
  return DEFAULT_SEARCH_LIMIT;
}

function buildOfflineSearch(params = {}) {
  const query = typeof params.q === "string" ? params.q.trim().toLowerCase() : "";
  const filter = typeof params.filter === "string" ? params.filter.trim() : "";
  const limit = clampLimit(params.limit);
  const streamingOnly =
    params.streaming_only === "true" || filter === "streaming" || params.providers === "mine";
  const providerFilters = new Set();

  const providerParam = params.provider || params.providers;
  if (typeof providerParam === "string" && providerParam.length) {
    providerParam.split(",").forEach((value) => {
      const trimmed = value.trim();
      if (trimmed) providerFilters.add(trimmed);
    });
  } else if (Array.isArray(providerParam)) {
    providerParam
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean)
      .forEach((value) => providerFilters.add(value));
  }

  const matchesQuery = (value = "") => !query || value.toLowerCase().includes(query);
  const matchesProviders = (movie) => {
    if (!streamingOnly) {
      return true;
    }
    const providers = Array.isArray(movie.streamingProviders) ? movie.streamingProviders : [];
    if (!providers.length) {
      return false;
    }
    if (!providerFilters.size) {
      return true;
    }
    return providers.some((provider) => provider && providerFilters.has(provider.key));
  };

  const movies = FALLBACK_DISCOVER_MOVIES.filter((movie) => {
    const matches =
      matchesQuery(movie.title || "") ||
      matchesQuery(movie.synopsis || "") ||
      (Array.isArray(movie.genres) && movie.genres.some((genre) => matchesQuery(String(genre))));
    return matches && matchesProviders(movie);
  }).slice(0, limit);

  const people = FALLBACK_PEOPLE.filter((person) => matchesQuery(person.name || "")).slice(0, limit);

  return { movies, people, lists: [] };
}

export function isApiOffline() {
  return apiOffline;
}

function buildAbortSignal(signal, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const cleanups = [];

  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      const abortHandler = () => controller.abort(signal.reason);
      signal.addEventListener("abort", abortHandler);
      cleanups.push(() => signal.removeEventListener("abort", abortHandler));
    }
  }

  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    const timeoutId = window.setTimeout(() => {
      controller.abort(new DOMException("Request timed out", "AbortError"));
    }, timeoutMs);
    cleanups.push(() => window.clearTimeout(timeoutId));
  }

  return { signal: controller.signal, cleanup: () => cleanups.forEach((fn) => fn()) };
}

async function fetchJson(url, { signal, headers = {}, method = "GET", body, timeoutMs } = {}) {
  const { signal: combinedSignal, cleanup } = buildAbortSignal(signal, timeoutMs);

  try {
    ensureApiOnline();
    const response = await fetch(url, {
      method,
      signal: combinedSignal,
      headers: { Accept: "application/json", ...headers },
      body
    });

    let parsedBody = null;
    let responseText = "";
    try {
      parsedBody = await response.clone().json();
    } catch (_) {
      try {
        responseText = await response.clone().text();
      } catch (_) {
        responseText = "";
      }
    }

    if (!response.ok) {
      const detail =
        (parsedBody && typeof parsedBody.message === "string" && parsedBody.message.trim()) ||
        (typeof responseText === "string" ? responseText.trim() : "") ||
        response.statusText;
      const error = new Error(
        detail ? `Request failed (${response.status}): ${detail}` : `Request failed with status ${response.status}`
      );
      error.status = response.status;
      throw error;
    }

    if (parsedBody !== null) {
      return parsedBody;
    }

    if (responseText) {
      return { message: responseText };
    }

    return {};
  } catch (error) {
    if (isOfflineTrigger(error)) {
      markApiOffline(error?.message || "API request failed");
      throw new OfflineApiError(error?.message);
    }
    throw error;
  } finally {
    cleanup();
  }
}

export async function fetchFromTmdb(path, params = {}, { signal } = {}) {
  ensureApiOnline();
  const searchParams = new URLSearchParams();
  searchParams.set("path", path);

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    searchParams.append(key, value);
  });

  try {
    return await fetchJson(`${API_ROUTES.tmdb}?${searchParams.toString()}`, { signal });
  } catch (error) {
    if (isOfflineTrigger(error)) {
      markApiOffline(error?.message || "TMDB unavailable");
      throw new OfflineApiError(error?.message);
    }
    throw error;
  }
}

export async function fetchFromOmdb(params = {}, { signal } = {}) {
  ensureApiOnline();
  const searchParams = new URLSearchParams();
  Object.entries({ plot: "short", ...params }).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    searchParams.append(key, value);
  });
  try {
    return await fetchJson(`${API_ROUTES.omdb}?${searchParams.toString()}`, { signal });
  } catch (error) {
    if (isOfflineTrigger(error)) {
      markApiOffline(error?.message || "OMDB unavailable");
      throw new OfflineApiError(error?.message);
    }
    throw error;
  }
}

export async function fetchFromYoutube(params = {}, { signal } = {}) {
  ensureApiOnline();
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    searchParams.append(key, value);
  });
  try {
    return await fetchJson(`${API_ROUTES.youtube}?${searchParams.toString()}`, { signal });
  } catch (error) {
    if (isOfflineTrigger(error)) {
      markApiOffline(error?.message || "YouTube unavailable");
      throw new OfflineApiError(error?.message);
    }
    throw error;
  }
}

export async function fetchFromSearch(params = {}, { signal, token } = {}) {
  if (apiOffline) {
    return buildOfflineSearch(params);
  }
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => {
        searchParams.append(key, item);
      });
      return;
    }
    searchParams.append(key, value);
  });

  const headers = token
    ? {
        Authorization: `Bearer ${token}`
      }
    : undefined;

  try {
    return await fetchJson(`${API_ROUTES.search}?${searchParams.toString()}`, {
      signal,
      headers
    });
  } catch (error) {
    if (isOfflineTrigger(error)) {
      markApiOffline(error?.message || "Search unavailable");
      return buildOfflineSearch(params);
    }
    throw error;
  }
}

export async function fetchTrendingMovies(params = {}, { signal } = {}) {
  if (apiOffline) {
    return { movies: FALLBACK_TRENDING_MOVIES };
  }
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    searchParams.append(key, value);
  });

  try {
    return await fetchJson(`${API_ROUTES.trending}?${searchParams.toString()}`, { signal });
  } catch (error) {
    if (isOfflineTrigger(error)) {
      markApiOffline(error?.message || "Trending unavailable");
      return { movies: FALLBACK_TRENDING_MOVIES };
    }
    throw error;
  }
}

export async function fetchStreamingProviders({ signal, token } = {}) {
  ensureApiOnline();
  const headers = token
    ? {
        Authorization: `Bearer ${token}`
      }
    : undefined;
  try {
    return await fetchJson(API_ROUTES.streaming, { signal, headers });
  } catch (error) {
    if (isOfflineTrigger(error)) {
      markApiOffline(error?.message || "Streaming providers unavailable");
      throw new OfflineApiError(error?.message);
    }
    throw error;
  }
}

export { OfflineApiError, isOfflineError };
