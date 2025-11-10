const AUTH_STORAGE_KEY = "smartMovieMatch.auth";
const AUTH_ENDPOINT = "/api/auth";

class AuthRequestError extends Error {
  constructor(message, status = 0, cause) {
    super(message);
    this.name = "AuthRequestError";
    this.status = status;
    if (cause) {
      this.cause = cause;
    }
  }
}

const subscribers = new Set();
let currentSession = readStoredSession();

if (currentSession && currentSession.token) {
  refreshSessionFromRemote(currentSession.token);
}

export function loadSession() {
  return currentSession;
}

export function subscribeToSession(callback) {
  if (typeof callback !== "function") {
    return () => {};
  }
  subscribers.add(callback);
  try {
    callback(currentSession);
  } catch (error) {
    console.warn("Auth subscriber error", error);
  }
  return () => {
    subscribers.delete(callback);
  };
}

export async function registerUser({ username, password, name }) {
  const sanitized = sanitizeUsername(username);
  validateCredentials(sanitized, password);

  const payload = { username: sanitized, password };
  if (typeof name === "string" && name.trim()) {
    payload.name = name.trim();
  }

  const response = await authRequest("signup", payload);
  const session = normalizeSession(response && response.session);
  if (!session) {
    throw new Error("Unexpected response from the authentication service.");
  }
  persistSession(session);
  return session;
}

export async function loginUser({ username, password }) {
  const sanitized = sanitizeUsername(username);
  validateCredentials(sanitized, password);

  const response = await authRequest("login", { username: sanitized, password });
  const session = normalizeSession(response && response.session);
  if (!session) {
    throw new Error("Unexpected response from the authentication service.");
  }
  persistSession(session);
  return session;
}

export function logoutSession() {
  const token = currentSession && currentSession.token ? currentSession.token : null;
  persistSession(null);
  if (!token) {
    return;
  }
  authRequest("logout", {}, token).catch((error) => {
    if (error instanceof AuthRequestError && error.status === 401) {
      return;
    }
    console.warn("Failed to log out remotely", error);
  });
}

export async function updateProfile(session, updates = {}) {
  const activeSession = ensureActiveSession(session);
  const profile = {};
  const safeUpdates = updates && typeof updates === "object" ? updates : {};

  if (Object.prototype.hasOwnProperty.call(safeUpdates, "displayName")) {
    profile.displayName =
      typeof safeUpdates.displayName === "string" ? safeUpdates.displayName : "";
  }
  if (Object.prototype.hasOwnProperty.call(safeUpdates, "password")) {
    profile.password = typeof safeUpdates.password === "string" ? safeUpdates.password : "";
  }
  if (Object.prototype.hasOwnProperty.call(safeUpdates, "avatar")) {
    profile.avatar = safeUpdates.avatar;
  }

  const response = await authRequest(
    "updateProfile",
    { profile },
    activeSession.token
  );

  const sessionUpdate = normalizeSession(response && response.session);
  if (sessionUpdate) {
    persistSession(sessionUpdate);
  }
  return sessionUpdate;
}

export async function persistPreferencesRemote(session, preferences) {
  const activeSession = ensureActiveSession(session);
  const response = await authRequest(
    "syncPreferences",
    { preferences },
    activeSession.token
  );
  const updatedSession = normalizeSession(response && response.session);
  if (updatedSession) {
    persistSession(updatedSession);
  }
  return updatedSession;
}

export async function persistWatchedRemote(session, watchedMovies) {
  const activeSession = ensureActiveSession(session);
  const trimmed = Array.isArray(watchedMovies)
    ? watchedMovies.slice(-50)
    : [];
  const response = await authRequest(
    "syncWatched",
    { watched: trimmed },
    activeSession.token
  );
  const updatedSession = normalizeSession(response && response.session);
  if (updatedSession) {
    persistSession(updatedSession);
  }
  return updatedSession;
}

export async function persistFavoritesRemote(session, favorites) {
  const activeSession = ensureActiveSession(session);
  const trimmed = Array.isArray(favorites) ? favorites.slice(-100) : [];
  const response = await authRequest(
    "syncFavorites",
    { favorites: trimmed },
    activeSession.token
  );
  const updatedSession = normalizeSession(response && response.session);
  if (updatedSession) {
    persistSession(updatedSession);
  }
  return updatedSession;
}

function notifySubscribers(session) {
  subscribers.forEach((callback) => {
    try {
      callback(session || null);
    } catch (error) {
      console.warn("Auth subscriber error", error);
    }
  });
}

function persistSession(session) {
  const normalized = session ? normalizeSession(session) : null;
  currentSession = normalized;
  try {
    if (normalized) {
      window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(normalized));
    } else {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  } catch (error) {
    console.warn("Failed to persist auth session", error);
  }
  notifySubscribers(currentSession);
}

function readStoredSession() {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return normalizeSession(parsed);
  } catch (error) {
    console.warn("Failed to load auth session", error);
    return null;
  }
}

function sanitizeUsername(username) {
  if (typeof username !== "string") {
    return "";
  }
  return username.trim();
}

function validateCredentials(username, password) {
  if (!username || username.length < 3) {
    throw new Error("Usernames need at least 3 characters.");
  }
  if (!password || password.length < 6) {
    throw new Error("Passwords must include 6 or more characters.");
  }
}

function ensureActiveSession(session) {
  const candidate = session && session.token ? session : currentSession;
  if (!candidate || !candidate.token) {
    throw new Error("No active session");
  }
  return candidate;
}

function normalizeSession(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (!value.token || typeof value.token !== "string") {
    return null;
  }
  if (!value.username || typeof value.username !== "string") {
    return null;
  }
  const displayName =
    typeof value.displayName === "string" && value.displayName.trim()
      ? value.displayName.trim()
      : value.username;
  return {
    token: value.token,
    username: value.username,
    displayName,
    profileName:
      typeof value.profileName === "string" && value.profileName.trim()
        ? value.profileName.trim()
        : null,
    avatarUrl:
      typeof value.avatarUrl === "string" && value.avatarUrl.trim()
        ? value.avatarUrl.trim()
        : null,
    createdAt: value.createdAt || null,
    lastLoginAt: value.lastLoginAt || null,
    lastPreferencesSync: value.lastPreferencesSync || null,
    lastWatchedSync: value.lastWatchedSync || null,
    lastFavoritesSync: value.lastFavoritesSync || null,
    preferencesSnapshot: value.preferencesSnapshot || null,
    watchedHistory: Array.isArray(value.watchedHistory) ? value.watchedHistory : [],
    favoritesList: Array.isArray(value.favoritesList) ? value.favoritesList : []
  };
}

async function refreshSessionFromRemote(token) {
  const sessionToken = token || (currentSession && currentSession.token);
  if (!sessionToken) {
    return;
  }
  try {
    const response = await authRequest("session", {}, sessionToken);
    const session = normalizeSession(response && response.session);
    if (session) {
      persistSession(session);
    }
  } catch (error) {
    if (error instanceof AuthRequestError && error.status === 401) {
      persistSession(null);
      return;
    }
    console.warn("Failed to refresh auth session", error);
  }
}

async function authRequest(action, body = {}, token) {
  const payload = { action, ...body };
  if (token && payload.token === undefined) {
    payload.token = token;
  }

  const headers = {
    "Content-Type": "application/json"
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(AUTH_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      credentials: "same-origin",
      cache: "no-store"
    });
  } catch (error) {
    throw new AuthRequestError(
      "Unable to reach the authentication service. Check your connection and try again.",
      0,
      error
    );
  }

  let text = "";
  try {
    text = await response.text();
  } catch (error) {
    console.warn("Failed to read auth response", error);
  }

  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      console.warn("Failed to parse auth response", error);
    }
  }

  if (!response.ok) {
    const message = data && typeof data.error === "string"
      ? data.error
      : `Authentication request failed (${response.status}).`;
    throw new AuthRequestError(message, response.status);
  }

  return data;
}
