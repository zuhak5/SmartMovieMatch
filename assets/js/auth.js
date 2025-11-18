import { API_ROUTES } from "./config.js";
import { getItem, setItem, removeItem } from "./memory-store.js";

const AUTH_STORAGE_KEY = "smartMovieMatch.auth";
const AUTH_SESSION_COOKIE_KEY = "smartMovieMatch.auth";
const AUTH_ENDPOINT = API_ROUTES.auth;

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

export async function registerUser({ username, password, name, avatarBase64 = null, avatarFileName = null }) {
  const sanitized = sanitizeUsername(username);
  validateCredentials(sanitized, password);

  const payload = { username: sanitized, password, name, avatarBase64, avatarFileName };
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

export async function updateProfile({ displayName, avatarBase64 = null, avatarFileName = null, removeAvatar = false } = {}) {
  const activeSession = ensureActiveSession();
  const payload = {};

  if (typeof displayName === "string") {
    const trimmed = displayName.trim();
    if (trimmed) {
      payload.name = trimmed;
    }
  }

  if (avatarBase64) {
    payload.avatarBase64 = avatarBase64;
    if (avatarFileName) {
      payload.avatarFileName = avatarFileName;
    }
  }

  if (removeAvatar) {
    payload.removeAvatar = true;
  }

  const response = await authRequest("updateProfile", payload, activeSession.token);
  const updatedSession = normalizeSession(response && response.session);
  if (updatedSession) {
    persistSession(updatedSession);
    return updatedSession;
  }
  return activeSession;
}

export async function changePassword({ currentPassword, newPassword }) {
  const activeSession = ensureActiveSession();
  if (!currentPassword || !newPassword) {
    throw new Error("Enter your current password and a new password to continue.");
  }
  const response = await authRequest(
    "changePassword",
    { currentPassword, newPassword },
    activeSession.token
  );
  const updatedSession = normalizeSession(response && response.session);
  if (updatedSession) {
    persistSession(updatedSession);
    return updatedSession;
  }
  return activeSession;
}

export async function requestPasswordReset(username) {
  const sanitized = sanitizeUsername(username);
  if (!sanitized) {
    throw new Error("Enter the username you signed up with.");
  }
  const response = await authRequest("requestPasswordReset", { username: sanitized });
  return response || { ok: true };
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

  if (normalized) {
    const serialized = JSON.stringify(normalized);
    try {
      setItem(AUTH_STORAGE_KEY, serialized);
    } catch (error) {
      console.warn("Failed to cache auth session in memory", error);
    }
    writeSessionCookie(normalized);
  } else {
    removeItem(AUTH_STORAGE_KEY);
    clearSessionCookie();
  }

  notifySubscribers(currentSession);
}

function readStoredSession() {
  const fromMemory = readSessionFromMemory();
  if (fromMemory) {
    return fromMemory;
  }

  const fromCookie = readSessionFromCookie();
  if (fromCookie) {
    try {
      const serialized = JSON.stringify(fromCookie);
      setItem(AUTH_STORAGE_KEY, serialized);
    } catch (error) {
      console.warn("Failed to mirror cookie session into memory cache", error);
    }
    return fromCookie;
  }

  return null;
}

function sanitizeUsername(username) {
  if (typeof username !== "string") {
    return "";
  }
  return username.trim();
}

function readSessionFromMemory() {
  try {
    const raw = getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return normalizeSession(parsed);
  } catch (error) {
    console.warn("Failed to load auth session from memory", error);
    return null;
  }
}

function writeSessionCookie(session) {
  if (typeof document === "undefined" || !document) {
    return;
  }
  const encoded = encodeSessionCookiePayload(session);
  if (!encoded) {
    return;
  }
  const secure = typeof window !== "undefined" && window.location && window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${AUTH_SESSION_COOKIE_KEY}=${encoded}; path=/; max-age=2592000; SameSite=Lax${secure}`;
}

function clearSessionCookie() {
  if (typeof document === "undefined" || !document) {
    return;
  }
  const secure = typeof window !== "undefined" && window.location && window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${AUTH_SESSION_COOKIE_KEY}=; path=/; max-age=0; SameSite=Lax${secure}`;
}

function readSessionFromCookie() {
  if (typeof document === "undefined" || !document || !document.cookie) {
    return null;
  }
  const prefix = `${AUTH_SESSION_COOKIE_KEY}=`;
  const segments = document.cookie.split(";");
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (trimmed.startsWith(prefix)) {
      const value = trimmed.slice(prefix.length);
      const decoded = decodeSessionCookiePayload(value);
      if (decoded) {
        return normalizeSession(decoded);
      }
      break;
    }
  }
  return null;
}

function encodeSessionCookiePayload(payload) {
  try {
    if (typeof window === "undefined" || typeof window.btoa !== "function") {
      return null;
    }
    const json = JSON.stringify(payload);
    if (typeof TextEncoder === "function") {
      const encoder = new TextEncoder();
      const bytes = encoder.encode(json);
      let binary = "";
      bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
      });
      return window.btoa(binary);
    }
    if (typeof encodeURIComponent === "function" && typeof unescape === "function") {
      return window.btoa(unescape(encodeURIComponent(json)));
    }
    return window.btoa(json);
  } catch (error) {
    console.warn("Failed to encode auth session for cookie storage", error);
    return null;
  }
}

function decodeSessionCookiePayload(value) {
  try {
    if (typeof window === "undefined" || typeof window.atob !== "function") {
      return null;
    }
    const binary = window.atob(value);
    if (typeof TextDecoder === "function") {
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const decoder = new TextDecoder();
      const json = decoder.decode(bytes);
      return JSON.parse(json);
    }
    if (typeof decodeURIComponent === "function" && typeof escape === "function") {
      const json = decodeURIComponent(escape(binary));
      return JSON.parse(json);
    }
    return JSON.parse(binary);
  } catch (error) {
    console.warn("Failed to decode auth session from cookie storage", error);
    return null;
  }
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
    createdAt: value.createdAt || null,
    lastLoginAt: value.lastLoginAt || null,
    lastPreferencesSync: value.lastPreferencesSync || null,
    lastWatchedSync: value.lastWatchedSync || null,
    lastFavoritesSync: value.lastFavoritesSync || null,
    avatarUrl:
      typeof value.avatarUrl === "string" && value.avatarUrl.trim()
        ? value.avatarUrl
        : null,
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
