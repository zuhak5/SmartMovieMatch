import { API_ROUTES } from "./config.js";

async function fetchJson(url, { signal, headers, method = "GET", body } = {}) {
  const response = await fetch(url, {
    method,
    signal,
    headers,
    body
  });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status} for ${url}`);
  }
  return response.json();
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

export async function fetchTrendingMovies(params = {}, { signal } = {}) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    searchParams.append(key, value);
  });

  return fetchJson(`${API_ROUTES.trending}?${searchParams.toString()}`, { signal });
}
