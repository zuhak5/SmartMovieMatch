import { API_ROUTES } from "./config.js";

const tmdbLimiter = createRequestLimiter(3);
const omdbLimiter = createRequestLimiter(2);
const youtubeLimiter = createRequestLimiter(2);

export async function fetchFromTmdb(path, params = {}, { signal } = {}) {
  const searchParams = new URLSearchParams();
  searchParams.set("path", path);

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    searchParams.append(key, value);
  });

  return fetchJsonWithRetry(`${API_ROUTES.tmdb}?${searchParams.toString()}`, {
    signal,
    limiter: tmdbLimiter
  });
}

export async function fetchFromOmdb(params = {}, { signal } = {}) {
  const searchParams = new URLSearchParams();
  Object.entries({ plot: "short", ...params }).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    searchParams.append(key, value);
  });
  return fetchJsonWithRetry(`${API_ROUTES.omdb}?${searchParams.toString()}`, {
    signal,
    limiter: omdbLimiter
  });
}

export async function fetchFromYoutube(params = {}, { signal } = {}) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    searchParams.append(key, value);
  });
  return fetchJsonWithRetry(`${API_ROUTES.youtube}?${searchParams.toString()}`, {
    signal,
    limiter: youtubeLimiter
  });
}

function createRequestLimiter(maxConcurrency) {
  let activeCount = 0;
  const queue = [];

  const runNext = () => {
    if (activeCount >= maxConcurrency) {
      return;
    }

    const job = queue.shift();
    if (!job) {
      return;
    }

    if (job.signal && job.signal.aborted) {
      job.reject(createAbortError());
      runNext();
      return;
    }

    activeCount += 1;
    Promise.resolve()
      .then(job.fn)
      .then(
        (value) => {
          activeCount -= 1;
          job.resolve(value);
          runNext();
        },
        (error) => {
          activeCount -= 1;
          job.reject(error);
          runNext();
        }
      );
  };

  return (fn, signal) =>
    new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(createAbortError());
        return;
      }

      queue.push({ fn, resolve, reject, signal });
      runNext();
    });
}

async function fetchJsonWithRetry(url, { signal, limiter, maxAttempts = 4 } = {}) {
  let attempt = 0;
  let lastError;

  while (attempt < maxAttempts) {
    attempt += 1;

    try {
      const response = await runWithLimiter(
        () => fetch(url, { signal }),
        limiter,
        signal
      );

      if (response.ok) {
        return await response.json();
      }

      const errorText = await safelyReadResponse(response);
      const error = new Error(
        `Request failed with status ${response.status} for ${url}: ${errorText}`
      );
      error.status = response.status;

      if (!shouldRetry(response.status) || attempt >= maxAttempts) {
        throw error;
      }

      lastError = error;
      const retryDelay = getRetryDelay(response, attempt);
      await wait(retryDelay, signal);
      continue;
    } catch (error) {
      if (isAbort(error, signal)) {
        throw error;
      }

      lastError = error;
      if (attempt >= maxAttempts) {
        break;
      }

      await wait(getRetryDelay(null, attempt), signal);
    }
  }

  throw lastError || new Error(`Request failed for ${url}`);
}

async function runWithLimiter(task, limiter, signal) {
  if (!limiter) {
    return task();
  }
  return limiter(task, signal);
}

function shouldRetry(status) {
  if (!status) {
    return true;
  }
  if (status === 429) {
    return true;
  }
  return status >= 500 && status < 600;
}

function getRetryDelay(response, attempt) {
  const baseDelay = 300;
  let delay = Math.min(baseDelay * 2 ** (attempt - 1), 2000);

  if (response && typeof response.headers?.get === "function") {
    const retryAfter = response.headers.get("Retry-After");
    if (retryAfter) {
      const parsedSeconds = Number.parseInt(retryAfter, 10);
      if (Number.isFinite(parsedSeconds) && parsedSeconds >= 0) {
        delay = Math.max(delay, parsedSeconds * 1000);
      } else {
        const retryDate = new Date(retryAfter);
        if (!Number.isNaN(retryDate.getTime())) {
          delay = Math.max(delay, retryDate.getTime() - Date.now());
        }
      }
    }
  }

  return Math.max(delay, 0);
}

function wait(duration, signal) {
  return new Promise((resolve, reject) => {
    if (duration <= 0) {
      resolve();
      return;
    }

    if (signal && signal.aborted) {
      reject(createAbortError());
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, duration);

    const cleanup = () => {
      clearTimeout(timeout);
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    };

    const onAbort = () => {
      cleanup();
      reject(createAbortError());
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

async function safelyReadResponse(response) {
  try {
    return await response.text();
  } catch (error) {
    return "";
  }
}

function createAbortError() {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

function isAbort(error, signal) {
  if (signal && signal.aborted) {
    return true;
  }
  return error && error.name === "AbortError";
}
