const crypto = require("crypto");
const https = require("https");

const fetch = typeof global.fetch === "function" ? global.fetch.bind(global) : nodeFetch;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase configuration for authentication service.");
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let payload = req.body;
  if (!payload || typeof payload !== "object") {
    try {
      payload = JSON.parse(req.body || "{}");
    } catch (error) {
      payload = {};
    }
  }

  const action = typeof payload.action === "string" ? payload.action : null;
  if (!action) {
    res.status(400).json({ error: "Missing action" });
    return;
  }

  try {
    const result = await handleAction(action, req, payload);
    res.status(result.status || 200).json(result.body);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
    } else {
      console.error("Auth API error", error);
      res.status(500).json({ error: "Unexpected auth service error." });
    }
  }
};

async function handleAction(action, req, payload) {
  switch (action) {
    case "signup":
      return signup(payload);
    case "login":
      return login(payload);
    case "session":
      return sessionInfo(req, payload);
    case "syncPreferences":
      return syncPreferences(req, payload);
    case "syncWatched":
      return syncWatched(req, payload);
    case "syncFavorites":
      return syncFavorites(req, payload);
    case "logout":
      return logout(req, payload);
    default:
      throw new HttpError(400, "Unsupported action");
  }
}

async function signup(payload) {
  const usernameInput = sanitizeUsername(payload.username);
  const password = typeof payload.password === "string" ? payload.password : "";
  const displayNameInput = sanitizeDisplayName(payload.name);

  validateCredentials(usernameInput, password);

  const canonical = canonicalUsername(usernameInput);
  const preferredDisplayName = displayNameInput || usernameInput;

  const existingRow = await selectUserRow(canonical);
  if (existingRow) {
    throw new HttpError(409, "That username is already registered. Try signing in.");
  }

  const now = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);

  const userRow = await insertUserRow({
    username: canonical,
    display_name: preferredDisplayName,
    password_hash: passwordHash,
    salt,
    created_at: now,
    last_login_at: now,
    last_preferences_sync: null,
    last_watched_sync: null,
    last_favorites_sync: null,
    preferences_snapshot: null,
    watched_history: [],
    favorites_list: []
  });

  const userRecord = mapUserRow(userRow);
  const sessionRecord = await createSessionRecord(userRecord, now);

  return {
    status: 201,
    body: { session: toSessionResponse(userRecord, sessionRecord) }
  };
}

async function login(payload) {
  const usernameInput = sanitizeUsername(payload.username);
  const password = typeof payload.password === "string" ? payload.password : "";

  validateCredentials(usernameInput, password);

  const canonical = canonicalUsername(usernameInput);
  const userRow = await selectUserRow(canonical);
  if (!userRow) {
    throw new HttpError(401, "Incorrect username or password. Sign up if you’re new here.");
  }

  const userRecord = mapUserRow(userRow);
  const computedHash = hashPassword(password, userRecord.salt);
  if (computedHash !== userRecord.passwordHash) {
    throw new HttpError(401, "Incorrect username or password. Sign up if you’re new here.");
  }

  const now = new Date().toISOString();
  const updatedUserRow = await updateUserRow(userRecord.username, { last_login_at: now });
  const refreshedUser = updatedUserRow ? mapUserRow(updatedUserRow) : { ...userRecord, lastLoginAt: now };

  const sessionRecord = await createSessionRecord(refreshedUser, now);

  return {
    body: { session: toSessionResponse(refreshedUser, sessionRecord) }
  };
}

async function sessionInfo(req, payload) {
  const { sessionRecord, userRecord } = await authenticate(req, payload);
  const now = new Date().toISOString();

  const updatedSessionRow = await updateSessionRow(sessionRecord.token, {
    last_active_at: now
  });
  const updatedSession = updatedSessionRow
    ? mapSessionRow(updatedSessionRow)
    : { ...sessionRecord, lastActiveAt: now };

  return {
    body: { session: toSessionResponse(userRecord, updatedSession) }
  };
}

async function syncPreferences(req, payload) {
  const { sessionRecord, userRecord } = await authenticate(req, payload);
  const preferences = sanitizePreferences(payload.preferences);

  const now = new Date().toISOString();
  const updatedUserRow = await updateUserRow(userRecord.username, {
    preferences_snapshot: preferences,
    last_preferences_sync: now
  });
  const updatedSessionRow = await updateSessionRow(sessionRecord.token, {
    last_preferences_sync: now,
    last_active_at: now
  });

  const refreshedUser = updatedUserRow
    ? mapUserRow(updatedUserRow)
    : {
        ...userRecord,
        preferencesSnapshot: preferences,
        lastPreferencesSync: now
      };
  const refreshedSession = updatedSessionRow
    ? mapSessionRow(updatedSessionRow)
    : {
        ...sessionRecord,
        lastPreferencesSync: now,
        lastActiveAt: now
      };

  return {
    body: {
      ok: true,
      session: toSessionResponse(refreshedUser, refreshedSession)
    }
  };
}

async function syncWatched(req, payload) {
  const { sessionRecord, userRecord } = await authenticate(req, payload);
  const watched = Array.isArray(payload.watched)
    ? payload.watched.slice(-50)
    : [];

  const now = new Date().toISOString();
  const updatedUserRow = await updateUserRow(userRecord.username, {
    watched_history: watched,
    last_watched_sync: now
  });
  const updatedSessionRow = await updateSessionRow(sessionRecord.token, {
    last_watched_sync: now,
    last_active_at: now
  });

  const refreshedUser = updatedUserRow
    ? mapUserRow(updatedUserRow)
    : {
        ...userRecord,
        watchedHistory: watched,
        lastWatchedSync: now
      };
  const refreshedSession = updatedSessionRow
    ? mapSessionRow(updatedSessionRow)
    : {
        ...sessionRecord,
        lastWatchedSync: now,
        lastActiveAt: now
      };

  return {
    body: {
      ok: true,
      session: toSessionResponse(refreshedUser, refreshedSession)
    }
  };
}

async function syncFavorites(req, payload) {
  const { sessionRecord, userRecord } = await authenticate(req, payload);
  const favorites = sanitizeFavorites(payload.favorites);

  const now = new Date().toISOString();
  const updatedUserRow = await updateUserRow(userRecord.username, {
    favorites_list: favorites,
    last_favorites_sync: now
  });
  const updatedSessionRow = await updateSessionRow(sessionRecord.token, {
    last_favorites_sync: now,
    last_active_at: now
  });

  const refreshedUser = updatedUserRow
    ? mapUserRow(updatedUserRow)
    : {
        ...userRecord,
        favoritesList: favorites,
        lastFavoritesSync: now
      };
  const refreshedSession = updatedSessionRow
    ? mapSessionRow(updatedSessionRow)
    : {
        ...sessionRecord,
        lastFavoritesSync: now,
        lastActiveAt: now
      };

  return {
    body: {
      ok: true,
      session: toSessionResponse(refreshedUser, refreshedSession)
    }
  };
}

async function logout(req, payload) {
  const token = extractToken(req, payload);
  if (!token) {
    return { body: { ok: true } };
  }

  await deleteSessionByToken(token);
  return { body: { ok: true } };
}

async function authenticate(req, payload) {
  const token = extractToken(req, payload);
  if (!token) {
    throw new HttpError(401, "Missing session token.");
  }

  const sessionRow = await selectSessionRow(token);
  if (!sessionRow) {
    throw new HttpError(401, "Session expired. Sign in again.");
  }

  const userRow = await selectUserRow(sessionRow.username);
  if (!userRow) {
    await deleteSessionByToken(token).catch(() => {});
    throw new HttpError(401, "Session expired. Sign in again.");
  }

  return {
    sessionRecord: mapSessionRow(sessionRow),
    userRecord: mapUserRow(userRow)
  };
}

async function selectUserRow(username) {
  if (!username) {
    return null;
  }
  const rows = await supabaseFetch("auth_users", {
    query: {
      select: "*",
      username: `eq.${username}`,
      limit: "1"
    }
  });
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }
  return rows[0];
}

async function insertUserRow(values) {
  return await mutateRows("auth_users", values, "POST");
}

async function updateUserRow(username, patch) {
  if (!username) {
    return null;
  }
  return await mutateRows(
    `auth_users?username=eq.${encodeURIComponent(username)}`,
    patch,
    "PATCH"
  );
}

async function createSessionRecord(userRecord, timestamp) {
  const token = crypto.randomBytes(24).toString("hex");
  await deleteSessionsByUsername(userRecord.username);

  const sessionRow = await mutateRows("auth_sessions", {
    token,
    username: userRecord.username,
    created_at: timestamp,
    last_active_at: timestamp,
    last_preferences_sync: userRecord.lastPreferencesSync || null,
    last_watched_sync: userRecord.lastWatchedSync || null,
    last_favorites_sync: userRecord.lastFavoritesSync || null
  }, "POST");

  return mapSessionRow(sessionRow);
}

async function updateSessionRow(token, patch) {
  if (!token) {
    return null;
  }
  return await mutateRows(
    `auth_sessions?token=eq.${encodeURIComponent(token)}`,
    patch,
    "PATCH"
  );
}

async function selectSessionRow(token) {
  if (!token) {
    return null;
  }
  const rows = await supabaseFetch("auth_sessions", {
    query: {
      select: "*",
      token: `eq.${token}`,
      limit: "1"
    }
  });
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }
  return rows[0];
}

async function deleteSessionsByUsername(username) {
  if (!username) {
    return;
  }
  await supabaseFetch(`auth_sessions`, {
    method: "DELETE",
    query: {
      username: `eq.${username}`
    }
  });
}

async function deleteSessionByToken(token) {
  if (!token) {
    return;
  }
  await supabaseFetch(`auth_sessions`, {
    method: "DELETE",
    query: {
      token: `eq.${token}`
    }
  });
}

async function mutateRows(path, values, method) {
  const body = method === "POST" ? [values] : values;
  const target = method === "POST" ? path : `${path}`;
  const rows = await supabaseFetch(target, {
    method,
    headers: { Prefer: "return=representation" },
    body
  });
  if (Array.isArray(rows)) {
    return rows[0] || null;
  }
  return rows || null;
}

async function supabaseFetch(path, { method = "GET", headers = {}, query, body } = {}) {
  const url = new URL(`/rest/v1/${path}`, SUPABASE_URL);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value);
      }
    });
  }

  const init = {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers
    }
  };

  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    handleSupabaseError("Network error", error);
  }

  if (!response.ok) {
    const errorText = await safeReadResponse(response);
    handleSupabaseError(`HTTP ${response.status} ${response.statusText}: ${errorText}`);
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    handleSupabaseError("Invalid JSON response", error);
  }
}

async function safeReadResponse(response) {
  try {
    return await response.text();
  } catch (error) {
    return "";
  }
}

function nodeFetch(input, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const requestUrl = typeof input === "string" ? new URL(input) : input;
      const method = options.method || "GET";
      const headers = options.headers || {};
      const body = options.body;

      const requestOptions = {
        method,
        headers,
        hostname: requestUrl.hostname,
        port: requestUrl.port || (requestUrl.protocol === "http:" ? 80 : 443),
        path: `${requestUrl.pathname}${requestUrl.search}`
      };

      const transport = requestUrl.protocol === "http:" ? require("http") : https;

      const req = transport.request(requestOptions, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          const text = buffer.toString("utf8");
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode || 0,
            statusText: res.statusMessage || "",
            headers: res.headers,
            text: async () => text
          });
        });
      });

      req.on("error", reject);

      if (body !== undefined && body !== null) {
        req.write(typeof body === "string" ? body : Buffer.from(body));
      }

      req.end();
    } catch (error) {
      reject(error);
    }
  });
}

function handleSupabaseError(context, error) {
  console.error("Supabase error:", context, error);
  throw new HttpError(500, "Authentication storage service failure.");
}

function sanitizeUsername(username) {
  if (typeof username !== "string") {
    return "";
  }
  return username.trim();
}

function sanitizeDisplayName(name) {
  if (typeof name !== "string") {
    return "";
  }
  return name.trim().slice(0, 120);
}

function canonicalUsername(username) {
  return sanitizeUsername(username).toLowerCase();
}

function validateCredentials(username, password) {
  if (!username || username.length < 3) {
    throw new HttpError(400, "Usernames need at least 3 characters.");
  }
  if (!password || password.length < 6) {
    throw new HttpError(400, "Passwords must include 6 or more characters.");
  }
}

function mapUserRow(row) {
  return {
    username: row.username,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    salt: row.salt,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    lastPreferencesSync: row.last_preferences_sync,
    lastWatchedSync: row.last_watched_sync,
    lastFavoritesSync: row.last_favorites_sync,
    preferencesSnapshot: row.preferences_snapshot || null,
    watchedHistory: Array.isArray(row.watched_history) ? row.watched_history : [],
    favoritesList: Array.isArray(row.favorites_list) ? row.favorites_list : []
  };
}

function mapSessionRow(row) {
  return {
    token: row.token,
    username: row.username,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    lastPreferencesSync: row.last_preferences_sync,
    lastWatchedSync: row.last_watched_sync,
    lastFavoritesSync: row.last_favorites_sync
  };
}

function toSessionResponse(userRecord, sessionRecord) {
  const displayName = userRecord.displayName || userRecord.username;
  return {
    token: sessionRecord.token,
    username: userRecord.username,
    displayName,
    createdAt: userRecord.createdAt,
    lastLoginAt: userRecord.lastLoginAt || null,
    lastPreferencesSync: userRecord.lastPreferencesSync || null,
    lastWatchedSync: userRecord.lastWatchedSync || null,
    lastFavoritesSync: userRecord.lastFavoritesSync || null,
    preferencesSnapshot: userRecord.preferencesSnapshot || null,
    watchedHistory: Array.isArray(userRecord.watchedHistory)
      ? userRecord.watchedHistory
      : [],
    favoritesList: Array.isArray(userRecord.favoritesList) ? userRecord.favoritesList : []
  };
}

function sanitizePreferences(preferences) {
  if (!preferences || typeof preferences !== "object") {
    return null;
  }

  const safe = { ...preferences };
  if (Array.isArray(preferences.selectedGenres)) {
    safe.selectedGenres = preferences.selectedGenres
      .map((genre) => (typeof genre === "string" ? genre : ""))
      .filter(Boolean)
      .slice(0, 12);
  }
  if (typeof preferences.name === "string") {
    safe.name = preferences.name.slice(0, 120);
  }
  if (typeof preferences.likesText === "string") {
    safe.likesText = preferences.likesText.slice(0, 500);
  }
  return safe;
}

function sanitizeFavorites(favorites) {
  if (!Array.isArray(favorites)) {
    return [];
  }

  const normalized = favorites
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const title = typeof entry.title === "string" ? entry.title.trim() : "";
      if (!title) {
        return null;
      }
      const imdbID = typeof entry.imdbID === "string" ? entry.imdbID.slice(0, 32) : null;
      const year = typeof entry.year === "string" ? entry.year.slice(0, 16) : "";
      const poster = typeof entry.poster === "string" ? entry.poster.slice(0, 512) : null;
      const overview = typeof entry.overview === "string" ? entry.overview.slice(0, 2000) : "";
      const genres = Array.isArray(entry.genres)
        ? entry.genres
            .map((genre) => (typeof genre === "string" ? genre.trim() : ""))
            .filter(Boolean)
            .slice(0, 10)
        : [];

      return {
        imdbID,
        title,
        year,
        poster,
        overview,
        genres
      };
    })
    .filter(Boolean);

  return normalized.slice(-100);
}

function extractToken(req, payload) {
  const header = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
  if (header.startsWith("Bearer ")) {
    return header.slice(7);
  }
  if (payload && typeof payload.token === "string") {
    return payload.token;
  }
  return null;
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 120000, 64, "sha512").toString("hex");
}
