import { API_ROUTES } from "./config.js";
const REQUEST_TIMEOUT_MS = 12000;

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
  } finally {
    cleanup();
  }
}

export async function fetchFromTmdb(path, params = {}, { signal } = {}) {
  const searchParams = new URLSearchParams();
  searchParams.set("path", path);

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    searchParams.append(key, value);
  });
  return fetchJson(`${API_ROUTES.tmdb}?${searchParams.toString()}`, { signal });
}

export async function fetchFromOmdb(params = {}, { signal } = {}) {
  const searchParams = new URLSearchParams();
  Object.entries({ plot: "short", ...params }).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    searchParams.append(key, value);
  });
  return fetchJson(`${API_ROUTES.omdb}?${searchParams.toString()}`, { signal });
}

export async function fetchFromYoutube(params = {}, { signal } = {}) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    searchParams.append(key, value);
  });
  return fetchJson(`${API_ROUTES.youtube}?${searchParams.toString()}`, { signal });
}

export async function fetchFromSearch(params = {}, { signal, token } = {}) {
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

  return fetchJson(`${API_ROUTES.search}?${searchParams.toString()}`, {
    signal,
    headers
  });
}

export async function fetchTrendingMovies(params = {}, { signal, token } = {}) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    searchParams.append(key, value);
  });

  const headers = token
    ? {
        Authorization: `Bearer ${token}`
      }
    : undefined;

  return fetchJson(`${API_ROUTES.trending}?${searchParams.toString()}`, { signal, headers });
}

export async function fetchStreamingProviders({ signal, token } = {}) {
  const headers = token
    ? {
        Authorization: `Bearer ${token}`
      }
    : undefined;
  return fetchJson(API_ROUTES.streaming, { signal, headers });
}
