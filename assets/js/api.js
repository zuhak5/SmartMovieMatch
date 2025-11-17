import { API_ROUTES } from "./config.js";
const REQUEST_TIMEOUT_MS = 12000;
const OFFLINE_STATUS_CODES = new Set([404, 500, 501]);

class OfflineApiError extends Error {
  constructor(message) {
    super(message || "API unavailable; please try again");
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
    throw new OfflineApiError(offlineReason || "API unavailable; please try again");
  }
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
  ensureApiOnline();
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
      throw new OfflineApiError(error?.message || "Search unavailable");
    }
    throw error;
  }
}

export async function fetchTrendingMovies(params = {}, { signal } = {}) {
  ensureApiOnline();
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
      throw new OfflineApiError(error?.message || "Trending unavailable");
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
