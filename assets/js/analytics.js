import { loadSession, subscribeToSession } from './auth.js';

const TELEMETRY_ENDPOINT = '/api/telemetry';

let currentSession = loadSession();
const subscribers = new Set();

subscribeToSession((session) => {
  currentSession = session || null;
  subscribers.forEach((callback) => {
    try {
      callback(currentSession);
    } catch (error) {
      console.warn('Telemetry subscriber error', error);
    }
  });
});

export function subscribeToTelemetrySession(callback) {
  if (typeof callback !== 'function') {
    return () => {};
  }
  subscribers.add(callback);
  try {
    callback(currentSession);
  } catch (error) {
    console.warn('Telemetry subscriber error', error);
  }
  return () => subscribers.delete(callback);
}

export async function logSearchEvent({ query, filters = {}, resultsCount = null, clientContext = {} }) {
  const trimmed = typeof query === 'string' ? query.trim() : '';
  if (!trimmed) {
    return;
  }
  await sendTelemetry({
    event: 'search',
    query: trimmed,
    filters,
    resultsCount,
    clientContext
  });
}

export async function logRecommendationEvent({ action, metadata = {} }) {
  const normalized = typeof action === 'string' ? action.trim() : '';
  if (!normalized) {
    return;
  }
  await sendTelemetry({
    event: 'recommendation',
    action: normalized,
    metadata
  });
}

export async function logUserActivity({ verb, objectType, metadata = {} }) {
  const normalizedVerb = typeof verb === 'string' ? verb.trim() : '';
  const normalizedType = typeof objectType === 'string' ? objectType.trim() : '';
  if (!normalizedVerb || !normalizedType) {
    return;
  }
  await sendTelemetry({
    event: 'activity',
    verb: normalizedVerb,
    object_type: normalizedType,
    metadata
  });
}

async function sendTelemetry(payload) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
  if (currentSession && currentSession.token) {
    headers.Authorization = `Bearer ${currentSession.token}`;
  }

  try {
    await fetch(TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.warn('Unable to send telemetry', error);
  }
}
