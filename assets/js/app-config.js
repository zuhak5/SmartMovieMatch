import { loadSession, subscribeToSession } from './auth.js';

const CONFIG_ENDPOINT = '/api/config';

const DEFAULT_CONFIG = {
  'ui.home.maxRecommendations': 10,
  'ui.home.groupPicks': 3,
  'ui.discover.maxMovies': 12,
  'ui.discover.maxPeople': 6,
  'feature.watchParties.enabled': true,
  'feature.messages.enabled': true,
  'feature.notifications.enabled': true
};

const state = {
  config: { ...DEFAULT_CONFIG },
  experiments: { experiments: [], assignments: {} },
  loading: false,
  loaded: false,
  error: ''
};

const subscribers = new Set();
let currentSession = loadSession();

subscribeToSession((session) => {
  currentSession = session || null;
});

export function subscribeToConfig(callback) {
  if (typeof callback !== 'function') {
    return () => {};
  }
  subscribers.add(callback);
  try {
    callback(getSnapshot());
  } catch (error) {
    console.warn('Config subscriber error', error);
  }
  return () => subscribers.delete(callback);
}

function notifySubscribers() {
  const snapshot = getSnapshot();
  subscribers.forEach((callback) => {
    try {
      callback(snapshot);
    } catch (error) {
      console.warn('Config subscriber error', error);
    }
  });
}

function getSnapshot() {
  return {
    config: { ...state.config },
    experiments: {
      experiments: Array.isArray(state.experiments.experiments)
        ? state.experiments.experiments.slice()
        : [],
      assignments: { ...(state.experiments.assignments || {}) }
    },
    loading: state.loading,
    loaded: state.loaded,
    error: state.error
  };
}

export function getConfigValue(key, fallback = null) {
  if (Object.prototype.hasOwnProperty.call(state.config, key)) {
    return state.config[key];
  }
  if (Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, key)) {
    return DEFAULT_CONFIG[key];
  }
  return fallback;
}

export function getFeatureFlag(key, fallback = true) {
  const value = getConfigValue(key, fallback);
  if (typeof value === 'boolean') {
    return value;
  }
  return Boolean(value);
}

export function getExperimentVariant(key, fallback = 'control') {
  if (!key) {
    return fallback;
  }
  const variant = state.experiments.assignments[key];
  return typeof variant === 'string' && variant.trim() ? variant.trim() : fallback;
}

export async function refreshAppConfig() {
  state.loading = true;
  notifySubscribers();

  const headers = { Accept: 'application/json' };
  if (currentSession && currentSession.token) {
    headers.Authorization = `Bearer ${currentSession.token}`;
  }

  try {
    const response = await fetch(CONFIG_ENDPOINT, { headers });
    if (!response.ok) {
      throw new Error('Request failed');
    }
    const payload = await response.json();
    const config = payload && typeof payload.config === 'object' ? payload.config : {};
    const experiments = payload && typeof payload.experiments === 'object'
      ? payload.experiments
      : { experiments: [], assignments: {} };
    state.config = { ...DEFAULT_CONFIG, ...config };
    state.experiments = {
      experiments: Array.isArray(experiments.experiments) ? experiments.experiments : [],
      assignments: experiments.assignments || {}
    };
    state.error = '';
  } catch (error) {
    state.error = 'Unable to load remote config.';
  } finally {
    state.loading = false;
    state.loaded = true;
    notifySubscribers();
  }
}
