const crypto = require("crypto");
const path = require("path");
const fs = require("fs/promises");

const { fetchWithTimeout } = require("../lib/http-client");
const { FALLBACK_AVATARS } = require("../lib/fallbackAvatars");
const { downloadRandomCelebrityAvatar } = require("../lib/tmdbCelebrity");

const fetch = (input, init = {}) => fetchWithTimeout(input, { timeoutMs: 15000, ...init });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AUTH_SERVICE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const LOCAL_STORE_PATH = path.join(__dirname, "..", "data", "auth-users.json");
const USING_LOCAL_STORE = !AUTH_SERVICE_CONFIGURED;
const DEFAULT_NOTIFICATION_PREFERENCES = {
  securityEmails: true,
  followEmails: false,
  partyEmails: true
};

function safeFilename(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function uploadToStorage(bucket, objectPath, buffer, contentType = 'application/octet-stream') {
  if (!AUTH_SERVICE_CONFIGURED) {
    throw new HttpError(500, "Auth service not configured");
  }
  const target = new URL(`/storage/v1/object/${bucket}/${objectPath}`, SUPABASE_URL).toString();
  const res = await fetch(target, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': contentType,
      'x-upsert': 'false'
    },
    body: buffer
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new HttpError(res.status, "Avatar upload failed: " + text);
  }
  // Public URL (if bucket is public)
  const publicUrl = new URL(`/storage/v1/object/public/${bucket}/${objectPath}`, SUPABASE_URL).toString();
  return { path: objectPath, publicUrl };
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

  if (!AUTH_SERVICE_CONFIGURED) {
    res.status(503).json({ error: "Auth service is not configured" });
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
    case "updateProfile":
      return updateProfile(req, payload);
    case "changePassword":
      return changePassword(req, payload);
    case "logout":
      return logout(req, payload);
    case "requestPasswordReset":
      return requestPasswordReset(payload);
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
  let avatar_path = null;
  let avatar_url = null;
  try {
    const base64 =
      typeof payload.avatarBase64 === "string" && payload.avatarBase64.trim()
        ? payload.avatarBase64.trim()
        : null;
    const originalName = safeFilename(payload.avatarFileName || "avatar.png");
    if (base64) {
      const buffer = Buffer.from(base64, "base64");
      if (buffer.length > 5 * 1024 * 1024) {
        throw new HttpError(400, "Avatar must be 5 MB or smaller.");
      }

      if (AUTH_SERVICE_CONFIGURED) {
        const objectPath = `${canonical}/${Date.now()}-${originalName}`;
        const uploaded = await uploadToStorage(
          "avatars",
          objectPath,
          buffer,
          "application/octet-stream"
        );
        avatar_path = uploaded.path;
        avatar_url = uploaded.publicUrl;
      } else {
        avatar_path = `local:${canonical}/${Date.now()}-${originalName}`;
        avatar_url = buildDataUrlFromBase64(base64, originalName);
      }
    }
  } catch (e) {
    console.warn("Avatar upload skipped:", e && e.message ? e.message : e);
  }

  if (!avatar_url) {
    try {
      const celebrityAvatar = await downloadRandomCelebrityAvatar({ fetchImpl: fetch });
      if (celebrityAvatar) {
        const fallbackName = `tmdb-${celebrityAvatar.personId}-${Date.now()}${celebrityAvatar.extension}`;
        if (AUTH_SERVICE_CONFIGURED) {
          const objectPath = `${canonical}/${fallbackName}`;
          const uploaded = await uploadToStorage(
            "avatars",
            objectPath,
            celebrityAvatar.buffer,
            celebrityAvatar.contentType
          );
          avatar_path = uploaded.path;
          avatar_url = uploaded.publicUrl;
        } else {
          avatar_path = `local:${fallbackName}`;
          avatar_url = buildDataUrlFromBuffer(celebrityAvatar.buffer, celebrityAvatar.contentType);
        }
      }
    } catch (error) {
      console.warn("TMDB celebrity avatar skipped", error && error.message ? error.message : error);
    }
  }

  if (!avatar_url) {
    const fallbackAvatar = pickFallbackAvatar();
    if (fallbackAvatar) {
      avatar_path = `preset:${fallbackAvatar.id}`;
      avatar_url = fallbackAvatar.imageUrl;
    }
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);

  const userRow = await insertUserRow({
    username: canonical,
    display_name: preferredDisplayName,
    password_hash: passwordHash,
    salt,
    created_at: now,
    last_login_at: now,
    preferences_snapshot: null,
    watched_history: [],
    favorites_list: [],
    avatar_path,
    avatar_url
  });

  if (!userRow) {
    throw new HttpError(500, "Failed to create user record.");
  }

  const userRecord = mapUserRow(userRow);
  const sessionRecord = await createSessionRecord(userRecord, now);

  return {
    status: 201,
    body: { session: toSessionResponse(userRecord, sessionRecord) }
  };
}

function pickFallbackAvatar() {
  if (!Array.isArray(FALLBACK_AVATARS) || FALLBACK_AVATARS.length === 0) {
    return null;
  }
  try {
    const index = crypto.randomInt(0, FALLBACK_AVATARS.length);
    return FALLBACK_AVATARS[index] || null;
  } catch (error) {
    console.warn("Fallback avatar selection failed", error);
    return null;
  }
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

  if (AUTH_SERVICE_CONFIGURED) {
    const streamingProviders =
      (preferences && preferences.streaming && preferences.streaming.providers) || [];
    await syncStreamingProfiles(userRecord.username, streamingProviders);
  }

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

async function updateProfile(req, payload) {
  const { sessionRecord, userRecord } = await authenticate(req, payload);
  const now = new Date().toISOString();

  const patch = {};
  const sanitizedName = sanitizeDisplayName(payload.name);
  if (sanitizedName) {
    patch.display_name = sanitizedName;
  }

  let nextAvatarPath = userRecord.avatarPath;
  let nextAvatarUrl = userRecord.avatarUrl;

  if (payload.removeAvatar) {
    patch.avatar_path = null;
    patch.avatar_url = null;
    nextAvatarPath = null;
    nextAvatarUrl = null;
  } else {
    const base64 = typeof payload.avatarBase64 === "string" ? payload.avatarBase64.trim() : null;
    if (base64) {
      try {
        const buffer = Buffer.from(base64, "base64");
        if (!buffer || buffer.length === 0) {
          throw new Error("Empty avatar payload");
        }
        if (buffer.length > 5 * 1024 * 1024) {
          throw new HttpError(400, "Avatar must be 5 MB or smaller.");
        }
        const originalName = safeFilename(payload.avatarFileName || "avatar.png");
        if (AUTH_SERVICE_CONFIGURED) {
          const objectPath = `${userRecord.username}/${Date.now()}-${originalName}`;
          const uploaded = await uploadToStorage("avatars", objectPath, buffer, "application/octet-stream");
          patch.avatar_path = uploaded.path;
          patch.avatar_url = uploaded.publicUrl;
          nextAvatarPath = uploaded.path;
          nextAvatarUrl = uploaded.publicUrl;
        } else {
          const localPath = `local:${userRecord.username}/${Date.now()}-${originalName}`;
          const dataUrl = buildDataUrlFromBase64(base64, originalName);
          patch.avatar_path = localPath;
          patch.avatar_url = dataUrl;
          nextAvatarPath = localPath;
          nextAvatarUrl = dataUrl;
        }
      } catch (error) {
        if (error instanceof HttpError) {
          throw error;
        }
        console.warn("Avatar update skipped:", error && error.message ? error.message : error);
      }
    }
  }

  let updatedUserRow = null;
  if (Object.keys(patch).length > 0) {
    updatedUserRow = await updateUserRow(userRecord.username, patch);
  }

  const refreshedUser = updatedUserRow
    ? mapUserRow(updatedUserRow)
    : {
        ...userRecord,
        displayName:
          patch.display_name !== undefined && patch.display_name !== null
            ? patch.display_name
            : userRecord.displayName,
        avatarPath: nextAvatarPath,
        avatarUrl: nextAvatarUrl
      };

  const updatedSessionRow = await updateSessionRow(sessionRecord.token, {
    last_active_at: now
  });
  const refreshedSession = updatedSessionRow
    ? mapSessionRow(updatedSessionRow)
    : { ...sessionRecord, lastActiveAt: now };

  return {
    body: {
      session: toSessionResponse(refreshedUser, refreshedSession)
    }
  };
}

async function changePassword(req, payload) {
  const { userRecord } = await authenticate(req, payload);

  const currentPassword = typeof payload.currentPassword === "string" ? payload.currentPassword : "";
  const newPassword = typeof payload.newPassword === "string" ? payload.newPassword : "";

  if (!currentPassword || !newPassword) {
    throw new HttpError(400, "Provide your current password and a new password.");
  }

  if (newPassword.length < 8) {
    throw new HttpError(400, "New password must be at least 8 characters long.");
  }

  if (currentPassword === newPassword) {
    throw new HttpError(400, "Choose a password that’s different from the current one.");
  }

  const computedHash = hashPassword(currentPassword, userRecord.salt);
  if (computedHash !== userRecord.passwordHash) {
    throw new HttpError(401, "That current password doesn’t match our records.");
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(newPassword, salt);
  const now = new Date().toISOString();

  await updateUserRow(userRecord.username, {
    password_hash: passwordHash,
    salt,
    last_login_at: now
  });

  const refreshedUserRow = await selectUserRow(userRecord.username);
  const refreshedUser = refreshedUserRow ? mapUserRow(refreshedUserRow) : { ...userRecord };
  const sessionRecord = await createSessionRecord(refreshedUser, now);

  return {
    body: {
      session: toSessionResponse(refreshedUser, sessionRecord)
    }
  };
}

async function requestPasswordReset(payload) {
  const usernameInput = sanitizeUsername(payload && payload.username);
  if (!usernameInput) {
    return {
      body: {
        ok: true,
        message: "If that username exists, we just emailed recovery instructions."
      }
    };
  }

  const canonical = canonicalUsername(usernameInput);

  try {
    const userRow = await selectUserRow(canonical);
    if (userRow) {
      console.info(`Password reset requested for ${canonical}`);
    }
  } catch (error) {
    console.warn("Password reset lookup failed", error);
  }

  return {
    body: {
      ok: true,
      message: "If that username exists, we just emailed recovery instructions."
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
  if (USING_LOCAL_STORE) {
    const store = await readLocalStore();
    const found = store.users.find((row) => row.username === username);
    return found ? cloneObject(found) : null;
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
  if (USING_LOCAL_STORE) {
    const store = await readLocalStore();
    const next = cloneObject(values);
    store.users.push(next);
    await writeLocalStore(store);
    return cloneObject(next);
  }
  return await mutateRows("auth_users", values, "POST");
}

async function updateUserRow(username, patch) {
  if (!username) {
    return null;
  }
  if (USING_LOCAL_STORE) {
    const store = await readLocalStore();
    const index = store.users.findIndex((row) => row.username === username);
    if (index === -1) {
      return null;
    }
    const updated = { ...store.users[index], ...patch };
    store.users[index] = updated;
    await writeLocalStore(store);
    return cloneObject(updated);
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

  if (USING_LOCAL_STORE) {
    const store = await readLocalStore();
    const sessionRow = {
      token,
      username: userRecord.username,
      created_at: timestamp,
      last_active_at: timestamp,
      last_preferences_sync: userRecord.lastPreferencesSync || null,
      last_watched_sync: userRecord.lastWatchedSync || null,
      last_favorites_sync: userRecord.lastFavoritesSync || null
    };
    store.sessions.push(sessionRow);
    await writeLocalStore(store);
    return mapSessionRow(sessionRow);
  }

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
  if (USING_LOCAL_STORE) {
    const store = await readLocalStore();
    const index = store.sessions.findIndex((row) => row.token === token);
    if (index === -1) {
      return null;
    }
    const updated = { ...store.sessions[index], ...patch };
    store.sessions[index] = updated;
    await writeLocalStore(store);
    return mapSessionRow(updated);
  }
  return await mutateRows(
    `auth_sessions?token=eq.${encodeURIComponent(token)}`,
    patch,
    "PATCH"
  );
}

async function syncStreamingProfiles(username, providers) {
  if (!username) {
    return;
  }

  const providerKeys = sanitizeStringList(providers, 12, 40);
  const existing = await supabaseFetch("user_streaming_profiles", {
    query: {
      select: "id,provider_key,is_active",
      username: `eq.${encodeURIComponent(username)}`
    }
  });

  const existingRows = Array.isArray(existing) ? existing : [];
  const existingMap = new Map(
    existingRows.filter((row) => row && row.provider_key).map((row) => [row.provider_key, row])
  );

  const toInsert = providerKeys
    .filter((key) => !existingMap.has(key))
    .map((key) => ({ username, provider_key: key, is_active: true }));
  const toActivate = existingRows.filter(
    (row) => row && providerKeys.includes(row.provider_key) && row.is_active === false
  );
  const toDelete = existingRows.filter(
    (row) => row && row.provider_key && !providerKeys.includes(row.provider_key)
  );

  if (toInsert.length) {
    await supabaseFetch("user_streaming_profiles", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: toInsert
    });
  }

  await Promise.all(
    toActivate.map((row) =>
      supabaseFetch(`user_streaming_profiles?id=eq.${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: { is_active: true }
      })
    )
  );

  if (toDelete.length) {
    const encodedIds = encodeIdsInList(toDelete.map((row) => row.id));
    await supabaseFetch(`user_streaming_profiles?id=in.${encodedIds}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
  }
}

async function selectSessionRow(token) {
  if (!token) {
    return null;
  }
  if (USING_LOCAL_STORE) {
    const store = await readLocalStore();
    const found = store.sessions.find((row) => row.token === token);
    return found ? cloneObject(found) : null;
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
  if (USING_LOCAL_STORE) {
    const store = await readLocalStore();
    store.sessions = store.sessions.filter((row) => row.username !== username);
    await writeLocalStore(store);
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
  if (USING_LOCAL_STORE) {
    const store = await readLocalStore();
    store.sessions = store.sessions.filter((row) => row.token !== token);
    await writeLocalStore(store);
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

function encodeIdsInList(values = []) {
  const safeValues = values
    .map((value) => String(value || ""))
    .filter(Boolean)
    .map((value) => `"${value.replace(/"/g, '\\"')}"`);
  return `(${safeValues.join(",")})`;
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

function handleSupabaseError(context, error) {
  console.error("Supabase error:", context, error);
  throw new HttpError(500, "Authentication storage service failure.");
}

async function readLocalStore() {
  try {
    const raw = await fs.readFile(LOCAL_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeLocalStore(parsed);
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      console.warn("Failed to read local auth store", error);
    }
    return { users: [], sessions: [] };
  }
}

async function writeLocalStore(store) {
  const normalized = normalizeLocalStore(store);
  const directory = path.dirname(LOCAL_STORE_PATH);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(LOCAL_STORE_PATH, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

function normalizeLocalStore(value) {
  const users = Array.isArray(value && value.users) ? value.users : [];
  const sessions = Array.isArray(value && value.sessions) ? value.sessions : [];
  return {
    users: users.map((user) => ({ ...user })),
    sessions: sessions.map((session) => ({ ...session }))
  };
}

function cloneObject(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildDataUrlFromBase64(base64, fileName) {
  const mimeType = inferMimeTypeFromName(fileName);
  return `data:${mimeType};base64,${base64}`;
}

function buildDataUrlFromBuffer(buffer, contentType) {
  if (!buffer || typeof buffer.toString !== "function") {
    return "";
  }
  const mime = typeof contentType === "string" && contentType.trim() ? contentType : "image/jpeg";
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

function inferMimeTypeFromName(fileName) {
  if (typeof fileName !== "string") {
    return "image/png";
  }
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".gif")) {
    return "image/gif";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".svg")) {
    return "image/svg+xml";
  }
  return "image/png";
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

function sanitizeStringList(values, maxItems = 12, maxLength = 60) {
  if (!Array.isArray(values)) {
    return [];
  }
  const seen = new Set();
  const result = [];
  values.forEach((value) => {
    const normalized = typeof value === "string" || typeof value === "number"
      ? String(value).trim()
      : "";
    if (!normalized || normalized.length > maxLength || seen.has(normalized)) {
      return;
    }
    if (result.length < maxItems) {
      seen.add(normalized);
      result.push(normalized);
    }
  });
  return result;
}

function sanitizeWebsite(value) {
  const trimmed = typeof value === "string" ? value.trim().slice(0, 200) : "";
  if (!trimmed) {
    return "";
  }
  const normalized = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(normalized);
    return url.toString();
  } catch (error) {
    return "";
  }
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
    avatarPath: row.avatar_path || null,
    avatarUrl: row.avatar_url || null,
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
    avatarUrl: userRecord.avatarUrl || null,
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
  const profilePreferences = sanitizeProfilePreferences(preferences.profile);
  if (profilePreferences) {
    safe.profile = profilePreferences;
  } else {
    delete safe.profile;
  }
  const streamingPreferences = sanitizeStreamingPreferences(preferences.streaming);
  if (streamingPreferences) {
    safe.streaming = streamingPreferences;
  } else {
    delete safe.streaming;
  }
  const personaPins = sanitizePersonaPins(
    preferences.personaPins || {
      list: preferences.pinnedList || null,
      review: preferences.pinnedReview || null
    }
  );
  if (personaPins) {
    safe.personaPins = personaPins;
  } else {
    delete safe.personaPins;
  }
  const notificationPreferences = sanitizeNotificationPreferences(preferences.notificationPreferences);
  if (notificationPreferences) {
    safe.notificationPreferences = notificationPreferences;
  } else {
    delete safe.notificationPreferences;
  }
  delete safe.pinnedList;
  delete safe.pinnedReview;
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
      const ratingValue =
        typeof entry.rating === "number"
          ? entry.rating
          : typeof entry.rating === "string" && entry.rating.trim() !== ""
          ? Number(entry.rating)
          : null;

      return {
        imdbID,
        title,
        year,
        poster,
        overview,
        genres,
        rating: Number.isFinite(ratingValue) ? ratingValue : null
      };
    })
    .filter(Boolean);

  return normalized.slice(-100);
}

function sanitizePersonaPins(pins) {
  if (!pins || typeof pins !== "object") {
    return null;
  }
  const list = sanitizePinnedListPin(pins.list || pins.pinnedList);
  const review = sanitizePinnedReviewPin(pins.review || pins.pinnedReview);
  const normalized = {};
  if (list) {
    normalized.list = list;
  }
  if (review) {
    normalized.review = review;
  }
  return Object.keys(normalized).length ? normalized : null;
}

function sanitizeNotificationPreferences(prefs) {
  const source = prefs && typeof prefs === "object" ? prefs : {};
  const normalized = {
    securityEmails:
      typeof source.securityEmails === "boolean"
        ? source.securityEmails
        : DEFAULT_NOTIFICATION_PREFERENCES.securityEmails,
    followEmails:
      typeof source.followEmails === "boolean"
        ? source.followEmails
        : DEFAULT_NOTIFICATION_PREFERENCES.followEmails,
    partyEmails:
      typeof source.partyEmails === "boolean"
        ? source.partyEmails
        : DEFAULT_NOTIFICATION_PREFERENCES.partyEmails
  };
  const matchesDefaults =
    normalized.securityEmails === DEFAULT_NOTIFICATION_PREFERENCES.securityEmails &&
    normalized.followEmails === DEFAULT_NOTIFICATION_PREFERENCES.followEmails &&
    normalized.partyEmails === DEFAULT_NOTIFICATION_PREFERENCES.partyEmails;
  return matchesDefaults ? null : normalized;
}

function sanitizeStreamingPreferences(streaming) {
  if (!streaming || typeof streaming !== "object") {
    return null;
  }
  const providers = sanitizeStringList(streaming.providers, 12, 40);
  const normalized = providers.length ? { providers } : {};
  return Object.keys(normalized).length ? normalized : null;
}

function sanitizeProfilePreferences(profile) {
  if (!profile || typeof profile !== "object") {
    return null;
  }
  const normalized = {};
  const bio = typeof profile.bio === "string" ? profile.bio.trim().slice(0, 280) : "";
  const location = typeof profile.location === "string" ? profile.location.trim().slice(0, 120) : "";
  const website = sanitizeWebsite(profile.website);

  if (bio) {
    normalized.bio = bio;
  }
  if (location) {
    normalized.location = location;
  }
  if (website) {
    normalized.website = website;
  }

  const favoriteGenres = sanitizeStringList(profile.favoriteGenres, 12, 60);
  if (favoriteGenres.length) {
    normalized.favoriteGenres = favoriteGenres;
  }

  const favoriteDecades = sanitizeStringList(profile.favoriteDecades, 12, 20);
  if (favoriteDecades.length) {
    normalized.favoriteDecades = favoriteDecades;
  }

  if (typeof profile.isPrivate === "boolean") {
    normalized.isPrivate = profile.isPrivate;
  }

  return Object.keys(normalized).length ? normalized : null;
}

function sanitizePinnedListPin(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const title = sanitizePinText(value.title || value.name, 160);
  if (!title) {
    return null;
  }
  const description = sanitizePinText(value.description || value.subtitle || value.summary, 320);
  const highlights = sanitizePinHighlights(value.highlights || value.items || value.movies);
  const href = sanitizePinUrl(value.href || value.url || value.link);
  const normalized = { title };
  if (description) {
    normalized.description = description;
  }
  if (highlights.length) {
    normalized.highlights = highlights;
  }
  if (href) {
    normalized.href = href;
  }
  return normalized;
}

function sanitizePinnedReviewPin(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const title = sanitizePinText(value.title || value.movieTitle || value.movie, 160);
  if (!title) {
    return null;
  }
  const excerpt = sanitizePinText(value.excerpt || value.summary || value.body, 400);
  const ratingValue =
    typeof value.rating === "number"
      ? value.rating
      : typeof value.rating === "string" && value.rating.trim() !== ""
      ? Number(value.rating)
      : null;
  const rating = Number.isFinite(ratingValue)
    ? Math.max(0, Math.min(10, Number(ratingValue)))
    : null;
  const href = sanitizePinUrl(value.href || value.url || value.link);
  const normalized = { title };
  if (excerpt) {
    normalized.excerpt = excerpt;
  }
  if (rating !== null) {
    normalized.rating = rating;
  }
  if (href) {
    normalized.href = href;
  }
  return normalized;
}

function sanitizePinHighlights(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  return list
    .map((value) => sanitizePinText(value, 120))
    .filter(Boolean)
    .slice(0, 6);
}

function sanitizePinUrl(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.slice(0, 500);
}

function sanitizePinText(value, max = 280) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.slice(0, max);
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
