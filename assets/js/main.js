import { TMDB_GENRES } from "./config.js";
import {
  loadSession,
  subscribeToSession,
  logoutSession,
  persistPreferencesRemote,
  persistWatchedRemote,
  persistFavoritesRemote,
  updateProfile,
  changePassword
} from "./auth.js";
import {
  discoverCandidateMovies,
  scoreAndSelectCandidates,
  fetchOmdbForCandidates,
  fetchTrailersForMovies
} from "./recommendations.js";
import {
  initSocialFeatures,
  buildCommunitySection,
  subscribeToFollowing,
  subscribeToSocialOverview,
  followUserByUsername,
  unfollowUserByUsername,
  searchSocialUsers,
  getFollowingSnapshot,
  getSocialOverviewSnapshot,
  subscribeToNotifications,
  acknowledgeNotifications,
  recordLibraryActivity,
  refreshCollaborativeState,
  createCollaborativeListRemote,
  inviteCollaboratorRemote,
  respondCollaboratorInviteRemote,
  scheduleWatchPartyRemote,
  respondWatchPartyRemote,
  voteCollaborativeItemRemote,
  postCollaborativeNoteRemote,
  subscribeToCollaborativeState,
  getCollaborativeStateSnapshot,
  generateInviteQrRemote,
  PRESENCE_STATUS_PRESETS,
  setPresenceStatusPreset,
  getPresenceStatusPreset,
  subscribeToPresenceStatusPreset
} from "./social.js";
import {
  renderWatchedList,
  updateWatchedSummary,
  renderRecommendations,
  renderFavoritesList,
  updateFavoritesSummary,
  showSkeletons,
  setRecStatus,
  setRecError,
  showToast,
  highlightRecommendationCard,
  closeMovieOverlay,
  isMovieOverlayOpen
} from "./ui.js";
import { $ } from "./dom.js";
import { playUiClick, playExpandSound } from "./sound.js";
import {
  createProfileButton,
  createInlineProfileLink,
  subscribeToProfileOpens,
  canonicalHandle
} from "./profile-overlay.js";
import { getWatchedRatingPreference } from "./taste.js";

const RECOMMENDATIONS_PAGE_SIZE = 20;
const MAX_FOLLOW_NOTE_LENGTH = 180;
const MAX_SUGGESTED_COLLABORATORS = 4;
const MAX_WATCH_PARTY_SUGGESTIONS = 6;
const COLLAB_DISCUSSION_MAX_LENGTH = 220;

let inviteQrRequest = 0;

const SOCIAL_NOTIFICATION_TYPES = new Set([
  "follow",
  "mention",
  "review_like",
  "review_reply",
  "review_reaction",
  "friend_review",
  "friend_watchlist",
  "friend_favorite",
  "collab_invite",
  "collab_accept",
  "watch_party",
  "watch_party_update",
  "watch_party_reminder"
]);

const RECOMMENDATION_LAYOUT_STORAGE_KEY = "smm.recommendation-layout.v1";
const PRESENCE_STATUS_STORAGE_KEY = "smm.presence-status.v1";
const PRESENCE_DURATION_STORAGE_KEY = "smm.presence-duration-minutes.v1";
const PRESENCE_EXPIRY_STORAGE_KEY = "smm.presence-expiry.v1";

const state = {
  watchedMovies: [],
  favorites: [],
  followingUsers: [],
  socialOverview: getSocialOverviewSnapshot(),
  collaborativeState: getCollaborativeStateSnapshot(),
  presenceStatusPreset: getPresenceStatusPreset(),
  presenceStatusDuration: getStoredPresenceStatusDuration(),
  lastRecSeed: Math.random(),
  activeCollectionView: "favorites",
  session: null,
  accountMenuOpen: false,
  notificationPanelOpen: false,
  notifications: [],
  notificationFocusTarget: null,
  accountAvatarPreviewUrl: null,
  accountRemoveAvatar: false,
  socialSearchReset: null,
  followNote: '',
  inviteQr: { link: '', dataUrl: '', generating: false },
  watchedSyncTimer: null,
  favoritesSyncTimer: null,
  activeRecToken: null,
  activeRecAbort: null,
  recommendations: [],
  filteredRecommendations: [],
  visibleRecommendations: 0,
  recommendationContext: null,
  recommendationLayout: "grid",
  recommendationFilters: { topRated: false, streaming: false, fresh: false },
  collectionFilters: { genre: "", sort: "recent" },
  theme: null,
  activePreset: null,
  onboardingSeen: false,
  onboardingStep: 0,
  gridVisibleRecommendations: 0,
  sessionHydration: {
    token: null,
    lastPreferencesSync: null,
    lastWatchedSync: null,
    lastFavoritesSync: null
  }
};

const collabSuggestionSelections = new Set();
const watchPartySuggestionSelections = new Set();

const THEME_COLOR_MAP = {
  dark: "#020617",
  light: "#f3f5ff"
};

const COLOR_SCHEME_META_CONTENT = {
  dark: "dark light",
  light: "light dark"
};

const metaThemeColorEl = document.querySelector('meta[name="theme-color"]');
const metaColorSchemeEl = document.querySelector('meta[name="color-scheme"]');
const rootElement = document.documentElement;

const PROFILE_CALLOUT_MILESTONE = 5;
const PROFILE_CALLOUT_PULSE_DURATION = 2400;
const PROFILE_CALLOUT_SNAPSHOT_LIMIT = 3;
let profileCalloutSnapshot = {
  favoritesCount: 0,
  watchedCount: 0,
  lastSyncToken: null
};
let profileCalloutPulseTimer = null;
let unsubscribeFollowing = null;
let unsubscribeNotifications = null;
let unsubscribeSocialOverview = null;
let unsubscribeCollaborative = null;
let unsubscribePresenceStatus = null;
let unsubscribeProfileOpen = null;
const presenceStatusButtons = new Map();
let presenceStatusFeedbackTimer = null;
let presenceStatusExpiryTimer = null;
let activePresenceShareForm = null;
let socialProfileOverlay = null;
let socialProfileCloseBtn = null;
let socialProfileTitleEl = null;
let socialProfileSubtitleEl = null;
let socialProfileBodyEl = null;
let socialProfileStatusEl = null;
let socialProfileActiveUsername = null;
let socialProfileRequestId = 0;
let socialProfileReturnFocus = null;
let socialProfileInitialized = false;
let socialProfilePageLoaded = false;
let socialFirstRunCtaWired = false;

const GENRE_ICON_MAP = {
  "28": "💥", // Action
  "12": "🧭", // Adventure
  "16": "🎨", // Animation
  "18": "🎭", // Drama
  "27": "👻", // Horror
  "35": "😂", // Comedy
  "53": "🔍", // Thriller
  "80": "🕵️", // Crime
  "878": "🚀", // Sci-Fi
  "9648": "🧩", // Mystery
  "10749": "❤️", // Romance
  "10751": "👨‍👩‍👧", // Family
};

const GENRE_DONUT_COLORS = ["#f97316", "#a855f7", "#38bdf8", "#facc15"];
const VIBE_PRESET_SELECTOR = '[data-vibe-preset]';

const PRESENCE_STATUS_PRESET_MAP = new Map(PRESENCE_STATUS_PRESETS.map((preset) => [preset.key, preset]));

const THEME_STORAGE_KEY = "smm.theme.v1";
const ONBOARDING_STORAGE_KEY = "smm.onboarding.v1";

function getStoredRecommendationLayout() {
  try {
    const stored = localStorage.getItem(RECOMMENDATION_LAYOUT_STORAGE_KEY);
    if (stored === "grid" || stored === "carousel") {
      return stored;
    }
  } catch (error) {
    console.warn("Failed to read stored recommendation layout", error);
  }
  return "grid";
}

function persistRecommendationLayout(layout) {
  try {
    localStorage.setItem(RECOMMENDATION_LAYOUT_STORAGE_KEY, layout);
  } catch (error) {
    console.warn("Failed to persist recommendation layout", error);
  }
}

const ONBOARDING_STEPS = [
  {
    title: "Set your vibe",
    description: "Choose genres, moods, and watched titles so recommendations feel instantly personal.",
    focus: "#preferencesPanel"
  },
  {
    title: "Curate collections",
    description: "Favorites and watched history stay organized with filters, expansion memory, and sync.",
    focus: "#collectionsPanel"
  },
  {
    title: "Refine results",
    description: "Apply quick filters, switch layouts, and save the standouts straight from the results grid.",
    focus: "#recommendationsPanel"
  }
];

const GENRE_NAME_ICON_MAP = Object.entries(TMDB_GENRES).reduce((map, [id, name]) => {
  const icon = GENRE_ICON_MAP[id];
  if (icon && name) {
    map[name.toLowerCase()] = icon;
  }
  return map;
}, Object.create(null));

function getGenreIconByLabel(label) {
  if (!label) {
    return "🎬";
  }
  return GENRE_NAME_ICON_MAP[label.toLowerCase()] || "🎬";
}

function getStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      return stored;
    }
  } catch (error) {
    console.warn("Failed to read stored theme", error);
  }
  return "dark";
}

function updateThemeToggle(theme) {
  const button = $("themeToggle");
  if (!button) {
    return;
  }
  const icon = button.querySelector(".btn-theme-icon");
  const label = button.querySelector(".btn-theme-label");
  if (theme === "light") {
    if (icon) {
      icon.textContent = "☀️";
    }
    if (label) {
      label.textContent = "Light";
    }
    button.setAttribute("aria-label", "Switch to dark theme");
    button.dataset.themeTarget = "dark";
  } else {
    if (icon) {
      icon.textContent = "🌙";
    }
    if (label) {
      label.textContent = "Dark";
    }
    button.setAttribute("aria-label", "Switch to light theme");
    button.dataset.themeTarget = "light";
  }
}

function updateDocumentThemeAttributes(theme) {
  const normalized = theme === "light" ? "light" : "dark";
  if (rootElement) {
    rootElement.dataset.theme = normalized;
    rootElement.style.setProperty("color-scheme", normalized);
  }
  if (document.body) {
    document.body.dataset.theme = normalized;
    document.body.style.setProperty("color-scheme", normalized);
  }
  if (metaColorSchemeEl) {
    const content =
      COLOR_SCHEME_META_CONTENT[normalized] || COLOR_SCHEME_META_CONTENT.dark;
    metaColorSchemeEl.setAttribute("content", content);
  }
  if (metaThemeColorEl) {
    const color = THEME_COLOR_MAP[normalized] || THEME_COLOR_MAP.dark;
    metaThemeColorEl.setAttribute("content", color);
  }
}

function applyTheme(theme, { persist = true } = {}) {
  const normalized = theme === "light" ? "light" : "dark";
  state.theme = normalized;
  updateDocumentThemeAttributes(normalized);
  updateThemeToggle(normalized);
  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, normalized);
    } catch (error) {
      console.warn("Failed to persist theme", error);
    }
  }
}

function handleThemeToggle() {
  const nextTheme = state.theme === "light" ? "dark" : "light";
  applyTheme(nextTheme);
  showToast({
    title: `Theme set to ${nextTheme}`,
    text: nextTheme === "light" ? "Enjoy a brighter palette." : "Enjoy the cinematic dark mode.",
    icon: nextTheme === "light" ? "☀️" : "🌙"
  });
}

function normalizeGenreValue(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function applyCollectionFilters(list) {
  const normalizedGenre = normalizeGenreValue(state.collectionFilters.genre);
  const sortMode = state.collectionFilters.sort || "recent";
  let result = Array.isArray(list) ? [...list] : [];
  if (normalizedGenre) {
    result = result.filter((movie) => {
      if (!movie || !Array.isArray(movie.genres)) {
        return false;
      }
      return movie.genres.some((genre) => normalizeGenreValue(genre) === normalizedGenre);
    });
  }

  if (sortMode === "alpha") {
    result.sort((a, b) => {
      const titleA = (a && a.title ? a.title : "").toLowerCase();
      const titleB = (b && b.title ? b.title : "").toLowerCase();
      return titleA.localeCompare(titleB);
    });
  } else if (sortMode === "rating") {
    result.sort((a, b) => {
      const ratingA = typeof a?.rating === "number" ? a.rating : -1;
      const ratingB = typeof b?.rating === "number" ? b.rating : -1;
      return ratingB - ratingA;
    });
  } else if (sortMode === "year") {
    result.sort((a, b) => {
      const yearA = parseInt(a?.year, 10) || 0;
      const yearB = parseInt(b?.year, 10) || 0;
      return yearB - yearA;
    });
  } else {
    // recent – newest additions first
    result.reverse();
  }

  return result;
}

function updateCollectionFilterOptions() {
  const select = $("collectionFilterGenre");
  if (!select) {
    return;
  }
  const previous = normalizeGenreValue(state.collectionFilters.genre);
  const genres = new Set();
  [...state.favorites, ...state.watchedMovies].forEach((movie) => {
    if (movie && Array.isArray(movie.genres)) {
      movie.genres
        .map((genre) => genre && genre.trim())
        .filter(Boolean)
        .forEach((genre) => {
          genres.add(genre);
        });
    }
  });

  const sortedGenres = Array.from(genres).sort((a, b) => a.localeCompare(b));
  const currentValue = previous && sortedGenres.some((genre) => normalizeGenreValue(genre) === previous)
    ? previous
    : "";

  select.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "All";
  select.appendChild(defaultOption);

  sortedGenres.forEach((genre) => {
    const opt = document.createElement("option");
    opt.value = normalizeGenreValue(genre);
    opt.textContent = genre;
    select.appendChild(opt);
  });

  select.value = currentValue;
  state.collectionFilters.genre = select.value;
}

function hasStreamingAvailability(entry) {
  const tmdb = entry?.tmdb || entry?.candidate || null;
  const providerResults = tmdb && tmdb.watch_providers && tmdb.watch_providers.results;
  if (providerResults && typeof providerResults === "object") {
    return Object.values(providerResults).some((provider) => {
      if (!provider) {
        return false;
      }
      const flat = Array.isArray(provider.flatrate) ? provider.flatrate : [];
      const rent = Array.isArray(provider.rent) ? provider.rent : [];
      const buy = Array.isArray(provider.buy) ? provider.buy : [];
      return flat.length > 0 || rent.length > 0 || buy.length > 0;
    });
  }
  if (Array.isArray(tmdb?.streaming_services) && tmdb.streaming_services.length) {
    return true;
  }
  if (Array.isArray(entry?.streamingProviders) && entry.streamingProviders.length) {
    return true;
  }
  return false;
}

function getRecommendationYear(entry) {
  const omdbYear = entry?.omdb?.Year ? parseInt(entry.omdb.Year, 10) : NaN;
  if (!Number.isNaN(omdbYear) && omdbYear > 1900) {
    return omdbYear;
  }
  const release = entry?.tmdb?.release_date;
  if (release && release.length >= 4) {
    const parsed = parseInt(release.slice(0, 4), 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return NaN;
}

function applyRecommendationFilters(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  const filters = state.recommendationFilters;
  if (!filters.topRated && !filters.streaming && !filters.fresh) {
    return items.slice();
  }
  const currentYear = new Date().getFullYear();
  return items.filter((entry) => {
    if (!entry) {
      return false;
    }
    if (filters.topRated) {
      const rating = parseFloat(entry?.omdb?.imdbRating);
      if (!Number.isFinite(rating) || rating < 7) {
        return false;
      }
    }
    if (filters.streaming && !hasStreamingAvailability(entry)) {
      return false;
    }
    if (filters.fresh) {
      const year = getRecommendationYear(entry);
      if (!Number.isFinite(year) || currentYear - year > 2) {
        return false;
      }
    }
    return true;
  });
}

function updateFilteredRecommendations({ preserveVisible = true } = {}) {
  state.filteredRecommendations = applyRecommendationFilters(state.recommendations);
  const total = state.filteredRecommendations.length;
  const fallbackVisible = total ? Math.min(total, RECOMMENDATIONS_PAGE_SIZE) : 0;
  if (!preserveVisible || !state.visibleRecommendations) {
    state.visibleRecommendations = fallbackVisible;
  } else {
    state.visibleRecommendations = Math.min(total, state.visibleRecommendations);
  }
  updateRecommendationsView();
}

function updateRecommendationLayout() {
  const grid = $("recommendationsGrid");
  if (grid) {
    grid.dataset.layout = state.recommendationLayout;
    if (state.recommendationLayout === "carousel") {
      grid.setAttribute("aria-live", "polite");
    } else {
      grid.removeAttribute("aria-live");
    }
  }
  if (document.body) {
    document.body.dataset.recommendationsLayout = state.recommendationLayout;
  }
  document.querySelectorAll(".segmented-control .segment[data-layout]").forEach((btn) => {
    const layout = btn.getAttribute("data-layout");
    btn.setAttribute("aria-pressed", layout === state.recommendationLayout ? "true" : "false");
  });
}

function clearOnboardingFocus() {
  document.querySelectorAll(".onboarding-focus").forEach((node) => {
    node.classList.remove("onboarding-focus");
  });
}

function focusOnboardingTarget(selector) {
  clearOnboardingFocus();
  if (!selector) {
    return;
  }
  const target = document.querySelector(selector);
  if (target) {
    target.classList.add("onboarding-focus");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function hasCompletedOnboarding() {
  try {
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) === "complete";
  } catch (error) {
    console.warn("Failed to read onboarding state", error);
    return false;
  }
}

function markOnboardingComplete() {
  state.onboardingSeen = true;
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, "complete");
  } catch (error) {
    console.warn("Failed to persist onboarding state", error);
  }
}

function evaluatePasswordRules(password, confirmPassword = "") {
  const value = typeof password === "string" ? password : "";
  const confirm = typeof confirmPassword === "string" ? confirmPassword : "";
  const rules = {
    length: value.length >= 8,
    upper: /[a-z]/.test(value) && /[A-Z]/.test(value),
    number: /\d/.test(value),
    symbol: /[^A-Za-z0-9]/.test(value)
  };
  if (confirm) {
    rules.match = value === confirm;
  }
  return rules;
}

function updatePasswordChecklist(listEl, password, confirmPassword = "") {
  if (!listEl) {
    return;
  }
  const rules = evaluatePasswordRules(password, confirmPassword);
  listEl.querySelectorAll("[data-password-rule]").forEach((item) => {
    const key = item.getAttribute("data-password-rule");
    if (!key) {
      return;
    }
    const isMet = key in rules ? Boolean(rules[key]) : false;
    item.dataset.state = isMet ? "met" : "pending";
  });
}

function attachPasswordToggle(button) {
  if (!button) {
    return;
  }
  const targetId = button.getAttribute("data-password-toggle");
  if (!targetId) {
    return;
  }
  const input = document.getElementById(targetId);
  if (!input) {
    return;
  }
  const labelNode = button.querySelector("[data-toggle-label]");
  const showLabel = button.getAttribute("data-label-show") || "Show";
  const hideLabel = button.getAttribute("data-label-hide") || "Hide";
  const showAria = button.getAttribute("data-aria-show") || "Show password";
  const hideAria = button.getAttribute("data-aria-hide") || "Hide password";

  button.setAttribute("aria-pressed", input.getAttribute("type") !== "password" ? "true" : "false");
  if (labelNode) {
    labelNode.textContent = input.getAttribute("type") === "password" ? showLabel : hideLabel;
  }
  button.setAttribute(
    "aria-label",
    input.getAttribute("type") === "password" ? showAria : hideAria
  );

  button.addEventListener("click", () => {
    const isPassword = input.getAttribute("type") === "password";
    input.setAttribute("type", isPassword ? "text" : "password");
    button.setAttribute("aria-pressed", isPassword ? "true" : "false");
    if (labelNode) {
      labelNode.textContent = isPassword ? hideLabel : showLabel;
    } else {
      button.textContent = isPassword ? hideLabel : showLabel;
    }
    button.setAttribute("aria-label", isPassword ? hideAria : showAria);
    playUiClick();
    input.focus();
  });
}

function updateOnboardingUi() {
  const overlay = $("onboardingCoach");
  if (!overlay || overlay.hidden) {
    return;
  }
  const stepIndex = Math.max(0, Math.min(state.onboardingStep, ONBOARDING_STEPS.length - 1));
  const step = ONBOARDING_STEPS[stepIndex];
  const stepEl = $("onboardingStep");
  if (stepEl) {
    stepEl.textContent = String(stepIndex + 1);
  }
  const content = $("onboardingContent");
  if (content) {
    content.innerHTML = `<h3>${step.title}</h3><p>${step.description}</p>`;
  }
  const backBtn = $("onboardingBack");
  if (backBtn) {
    backBtn.disabled = stepIndex === 0;
  }
  const nextBtn = $("onboardingNext");
  if (nextBtn) {
    nextBtn.textContent = stepIndex === ONBOARDING_STEPS.length - 1 ? "Finish" : "Next";
  }
  focusOnboardingTarget(step.focus);
}

function openOnboarding(step = 0) {
  const overlay = $("onboardingCoach");
  if (!overlay) {
    return;
  }
  state.onboardingStep = Math.max(0, Math.min(step, ONBOARDING_STEPS.length - 1));
  overlay.hidden = false;
  overlay.dataset.open = "true";
  overlay.setAttribute("aria-hidden", "false");
  if (document.body) {
    document.body.classList.add("onboarding-open");
  }
  updateOnboardingUi();
}

function closeOnboarding({ persist = true } = {}) {
  const overlay = $("onboardingCoach");
  if (!overlay) {
    return;
  }
  overlay.hidden = true;
  overlay.dataset.open = "false";
  overlay.setAttribute("aria-hidden", "true");
  if (document.body) {
    document.body.classList.remove("onboarding-open");
  }
  clearOnboardingFocus();
  if (persist) {
    markOnboardingComplete();
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = (event) => reject(event);
    reader.readAsDataURL(file);
  });
}

function formatSyncTime(timestamp) {
  if (!timestamp) {
    return "Not synced yet";
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "Not synced yet";
  }
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) {
    return "Scheduled soon";
  }
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 45) {
    return "Just now";
  }
  if (diffSeconds < 90) {
    return "About a minute ago";
  }
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 14) {
    return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getMostRecentSync(session) {
  if (!session) {
    return null;
  }
  const timestamps = [session.lastPreferencesSync, session.lastWatchedSync, session.lastFavoritesSync]
    .map((value) => {
      const date = value ? new Date(value) : null;
      return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
    })
    .filter(Boolean);
  if (!timestamps.length) {
    return null;
  }
  return new Date(Math.max(...timestamps));
}

function getGenreIcon(genreId, label) {
  if (genreId && GENRE_ICON_MAP[genreId]) {
    return GENRE_ICON_MAP[genreId];
  }
  if (!label) {
    return "🎬";
  }
  const normalized = label.trim().toLowerCase();
  const fallback = {
    action: "💥",
    adventure: "🧭",
    animation: "🎨",
    comedy: "😂",
    crime: "🕵️",
    drama: "🎭",
    family: "👨‍👩‍👧",
    horror: "👻",
    mystery: "🧩",
    romance: "❤️",
    "sci-fi": "🚀",
    thriller: "🔍",
  };
  return fallback[normalized] || "🎬";
}

function ensureSnapshotExpandedFromItem(itemEl, event) {
  if (!itemEl) {
    return false;
  }
  const listEl = itemEl.closest(".preferences-collection-collapsible");
  if (!listEl || listEl.dataset.expanded === "true") {
    return false;
  }
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  playUiClick();
  if (typeof listEl.__toggleSnapshot === "function") {
    listEl.__toggleSnapshot(true);
  } else {
    listEl.classList.add("expanded");
    listEl.classList.remove("collapsed");
    listEl.dataset.expanded = "true";
  }
  return true;
}

function finalizeCollectionsSnapshot(listEl) {
  if (!listEl) {
    return;
  }
  const items = Array.from(listEl.querySelectorAll(".preferences-collection-item"));
  const extraItems = items.filter((item) => item.classList.contains("collection-item-extra"));
  if (!extraItems.length) {
    return;
  }

  listEl.classList.add("preferences-collection-collapsible", "collapsed");
  listEl.dataset.collapsible = "true";
  listEl.dataset.expanded = "false";
  listEl.dataset.totalItems = String(items.length);

  extraItems.forEach((item) => {
    const currentTabIndex = item.getAttribute("tabindex");
    item.dataset.snapshotTabindex = currentTabIndex === null ? "" : currentTabIndex;
  });

  const updateExtrasVisibility = (expanded) => {
    extraItems.forEach((item) => {
      if (expanded) {
        const stored = item.dataset.snapshotTabindex;
        if (stored === "") {
          item.removeAttribute("tabindex");
        } else {
          item.setAttribute("tabindex", stored);
        }
        item.removeAttribute("aria-hidden");
      } else {
        item.setAttribute("tabindex", "-1");
        item.setAttribute("aria-hidden", "true");
      }
    });
  };

  updateExtrasVisibility(false);

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "preferences-collection-toggle";
  toggleBtn.innerHTML =
    `<span class="toggle-label">Show all (${items.length})</span><span class="toggle-icon" aria-hidden="true">▾</span>`;
  toggleBtn.setAttribute("aria-expanded", "false");
  listEl.appendChild(toggleBtn);

  const toggleList = (expand, options = {}) => {
    const previous = listEl.dataset.expanded === "true";
    const next = typeof expand === "boolean" ? expand : !previous;
    if (next === previous) {
      return next;
    }
    listEl.dataset.expanded = next ? "true" : "false";
    listEl.classList.toggle("expanded", next);
    listEl.classList.toggle("collapsed", !next);
    toggleBtn.setAttribute("aria-expanded", next ? "true" : "false");
    toggleBtn.classList.toggle("is-expanded", next);
    const label = toggleBtn.querySelector(".toggle-label");
    if (label) {
      label.textContent = next ? "Show less" : `Show all (${items.length})`;
    }
    const icon = toggleBtn.querySelector(".toggle-icon");
    if (icon) {
      icon.textContent = next ? "▴" : "▾";
    }
    updateExtrasVisibility(next);
    if (!options.silent) {
      playExpandSound(next);
    }
    return next;
  };

  toggleBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    playUiClick();
    toggleList();
  });

  // expose controller so list items can trigger expansion
  // eslint-disable-next-line no-param-reassign
  listEl.__toggleSnapshot = toggleList;
}

function getActiveDisplayName() {
  if (state.session) {
    if (state.session.displayName && state.session.displayName.trim()) {
      return state.session.displayName.trim();
    }
    if (state.session.username && state.session.username.trim()) {
      return state.session.username.trim();
    }
  }
  if (
    state.session &&
    state.session.preferencesSnapshot &&
    typeof state.session.preferencesSnapshot.name === "string"
  ) {
    const fromSnapshot = state.session.preferencesSnapshot.name.trim();
    if (fromSnapshot) {
      return fromSnapshot;
    }
  }
  return "";
}

function isAbortError(error) {
  return !!error && error.name === "AbortError";
}

document.addEventListener("DOMContentLoaded", init);

function init() {
  const initialTheme = getStoredTheme();
  applyTheme(initialTheme, { persist: false });
  state.onboardingSeen = hasCompletedOnboarding();
  state.recommendationLayout = getStoredRecommendationLayout();
  updateRecommendationLayout();

  state.watchedMovies = [];
  state.favorites = [];
  state.session = loadSession();
  state.notificationFocusTarget = getNotificationDeepLinkTarget();
  setupSocialFeatures();
  hydrateFromSession(state.session);
  refreshWatchedUi();
  refreshFavoritesUi();
  switchCollectionView(state.activeCollectionView);
  updateAccountUi(state.session);
  updateSocialSectionVisibility(state.session);
  if (isAccountSettingsContext() && state.session && state.session.token) {
    populateAccountSettings();
  }
  setSyncStatus(
    state.session
      ? "Signed in – your taste profile syncs automatically."
      : "Sign in to sync your preferences and watch history across devices.",
    state.session ? "success" : "muted"
  );

  subscribeToSession((session) => {
    const previousSession = state.session;
    state.session = session;
    const wasSignedIn = Boolean(previousSession && previousSession.token);
    const isSignedIn = Boolean(session && session.token);
    hydrateFromSession(session);
    updateAccountUi(session);
    updateSocialSectionVisibility(session);
    updateSocialInviteLink(session);
    if (!session || !session.token) {
      if (typeof state.socialSearchReset === "function") {
        state.socialSearchReset({ hidePanel: true });
      }
    } else if (typeof state.socialSearchReset === "function") {
      state.socialSearchReset({ showPrompt: true });
    }
    if (!wasSignedIn && isSignedIn) {
      const storedPreset = getStoredPresenceStatusPreset();
      const currentPreset = normalizePresenceStatusKey(getPresenceStatusPreset());
      if (storedPreset !== currentPreset) {
        setPresenceStatusPreset(storedPreset, { silent: true })
          .then((normalized) => {
            persistPresenceStatusPreset(normalized);
          })
          .catch((error) => {
            console.warn('Failed to sync presence status preset after sign-in', error);
          });
      }
    }
    if (!session || !session.token) {
      state.notifications = [];
      closeNotificationPanel();
      renderNotificationCenter();
    }
    setSyncStatus(
      session
        ? "Signed in – your taste profile syncs automatically."
        : "Signed out. Preferences won’t sync until you sign in again.",
      session ? "success" : "muted"
    );
    if (isSocialProfileContext() && wasSignedIn !== isSignedIn) {
      maybeReloadSocialProfilePage({ force: true });
    }
    if (isAccountSettingsContext()) {
      populateAccountSettings();
      if (window.location.hash === "#security" && session && session.token) {
        window.requestAnimationFrame(() => {
          const anchor = document.getElementById("security");
          if (anchor) {
            anchor.scrollIntoView({ behavior: "smooth", block: "start" });
          }
          const securityInput = $("currentPasswordInput");
          if (securityInput) {
            securityInput.focus();
          }
        });
      }
    }
  });

  wireEvents();
  renderNotificationCenter();
  maybeApplyPageContextFromQuery();

  if (!state.onboardingSeen) {
    window.setTimeout(() => {
      if (!state.onboardingSeen) {
        openOnboarding(0);
      }
    }, 650);
  }

  if (isAccountSettingsContext() && state.session && state.session.token) {
    const hash = window.location.hash ? window.location.hash.replace("#", "") : "";
    window.requestAnimationFrame(() => {
      if (hash === "security") {
        const anchor = document.getElementById("security");
        if (anchor) {
          anchor.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        const securityInput = $("currentPasswordInput");
        if (securityInput) {
          securityInput.focus();
        }
      } else {
        const displayNameInput = $("accountDisplayName");
        if (displayNameInput) {
          displayNameInput.focus();
        }
      }
    });
  }

  maybeReloadSocialProfilePage();
}

function getNotificationDeepLinkTarget() {
  const page = document.body ? document.body.getAttribute("data-page") : null;
  if (page !== "discovery") {
    return null;
  }
  const params = new URLSearchParams(window.location.search);
  const tmdbId = params.get("movie") || params.get("tmdb");
  const imdbId = params.get("imdb");
  const title = params.get("title");
  if (!tmdbId && !imdbId && !title) {
    return null;
  }
  const context = (params.get("context") || params.get("notification") || "").toLowerCase();
  return {
    tmdbId: tmdbId ? tmdbId.trim() : "",
    imdbId: imdbId ? imdbId.trim() : "",
    title: title ? title.trim() : "",
    focusCommunity: context === "community" || context === "review"
  };
}

function maybeFocusNotificationTarget() {
  if (!state.notificationFocusTarget || document.body?.getAttribute("data-page") !== "discovery") {
    return;
  }
  const didFocus = highlightRecommendationCard(state.notificationFocusTarget, {
    expand: true,
    focusCommunity: state.notificationFocusTarget.focusCommunity,
    scrollBlock: "center"
  });
  if (didFocus) {
    state.notificationFocusTarget = null;
    clearNotificationQueryParams();
  }
}

function clearNotificationQueryParams() {
  if (!window.history || typeof window.history.replaceState !== "function") {
    return;
  }
  const url = new URL(window.location.href);
  const keys = ["movie", "tmdb", "imdb", "title", "context", "notification", "source"];
  let mutated = false;
  keys.forEach((key) => {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      mutated = true;
    }
  });
  if (!mutated) {
    return;
  }
  const nextSearch = url.searchParams.toString();
  const next = `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${url.hash || ""}`;
  window.history.replaceState({}, document.title, next);
}

function maybeApplyPageContextFromQuery() {
  const page = document.body ? document.body.getAttribute("data-page") : null;
  if (page !== "profile-overview") {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  const context = (params.get("context") || params.get("notification") || "").toLowerCase();
  if (!context) {
    return;
  }
  let targetId = "";
  switch (context) {
    case "party":
      targetId = "watchPartyInviteList";
      break;
    case "collab":
      targetId = "collabInviteList";
      break;
    case "social":
    case "follow":
    default:
      targetId = "socialConnectionsSection";
      break;
  }
  const target = document.getElementById(targetId);
  if (target) {
    window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.classList.add("profile-section-pulse");
      window.setTimeout(() => {
        target.classList.remove("profile-section-pulse");
      }, 1800);
    });
  }
  clearNotificationQueryParams();
}

function wireEvents() {
  const accountProfileBtn = $("accountProfileBtn");
  const accountMenu = $("accountMenu");
  const accountProfile = $("accountProfile");
  const profileForm = $("accountProfileForm");
  const securityForm = $("accountSecurityForm");
  const avatarInput = $("accountAvatarInput");
  const avatarUploadBtn = $("accountAvatarUpload");
  const avatarRemoveBtn = $("accountAvatarRemove");
  const notificationBell = $("notificationBell");
  const notificationPanel = $("notificationPanel");
  const notificationOverlay = $("notificationOverlay");
  const notificationMarkRead = $("notificationMarkRead");
  const themeToggle = $("themeToggle");
  const collectionFilterGenre = $("collectionFilterGenre");
  const collectionFilterSort = $("collectionFilterSort");
  const filterTopRated = $("filterTopRated");
  const filterStreaming = $("filterStreaming");
  const filterFresh = $("filterFresh");
  const onboardingNext = $("onboardingNext");
  const onboardingBack = $("onboardingBack");
  const onboardingClose = $("onboardingClose");
  const currentPasswordInput = $("currentPasswordInput");
  const newPasswordInput = $("newPasswordInput");
  const confirmPasswordInput = $("confirmPasswordInput");
  const settingsPasswordChecklist = $("settingsPasswordChecklist");

  if (accountProfileBtn && accountMenu) {
    accountProfileBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      playUiClick();
      toggleAccountMenu();
    });
  }

  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      playUiClick();
      handleThemeToggle();
    });
  }

  if (notificationBell) {
    notificationBell.addEventListener("click", (event) => {
      event.stopPropagation();
      playUiClick();
      toggleNotificationPanel();
    });
  }

  if (notificationOverlay) {
    notificationOverlay.addEventListener("click", () => {
      closeNotificationPanel();
    });
  }

  if (notificationMarkRead) {
    notificationMarkRead.addEventListener("click", () => {
      acknowledgeNotifications();
    });
  }

  if (accountMenu) {
    accountMenu.querySelectorAll(".account-menu-item").forEach((item) => {
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        const action = item.getAttribute("data-action");
        handleAccountMenuAction(action);
      });
    });
  }

  if (collectionFilterGenre) {
    collectionFilterGenre.value = state.collectionFilters.genre || "";
    collectionFilterGenre.addEventListener("change", (event) => {
      state.collectionFilters.genre = normalizeGenreValue(event.target.value || "");
      refreshFavoritesUi();
      refreshWatchedUi();
    });
  }

  if (collectionFilterSort) {
    collectionFilterSort.value = state.collectionFilters.sort || "recent";
    collectionFilterSort.addEventListener("change", (event) => {
      const value = event.target.value || "recent";
      state.collectionFilters.sort = value;
      refreshFavoritesUi();
      refreshWatchedUi();
    });
  }

  document.querySelectorAll(".segmented-control .segment[data-layout]").forEach((segment) => {
    segment.addEventListener("click", () => {
      const layout = segment.getAttribute("data-layout") === "carousel" ? "carousel" : "grid";
      if (state.recommendationLayout !== layout) {
        playUiClick();
        const previousLayout = state.recommendationLayout;
        if (layout === "carousel") {
          state.gridVisibleRecommendations = state.visibleRecommendations || state.gridVisibleRecommendations;
        } else if (previousLayout === "carousel" && state.gridVisibleRecommendations) {
          state.visibleRecommendations = state.gridVisibleRecommendations;
        }
        state.recommendationLayout = layout;
        persistRecommendationLayout(layout);
        updateRecommendationsView();
      } else {
        playUiClick();
      }
    });
  });

  if (filterTopRated) {
    filterTopRated.checked = state.recommendationFilters.topRated;
    filterTopRated.addEventListener("change", () => {
      state.recommendationFilters.topRated = filterTopRated.checked;
      updateFilteredRecommendations();
    });
  }

  if (filterStreaming) {
    filterStreaming.checked = state.recommendationFilters.streaming;
    filterStreaming.addEventListener("change", () => {
      state.recommendationFilters.streaming = filterStreaming.checked;
      updateFilteredRecommendations();
    });
  }

  if (filterFresh) {
    filterFresh.checked = state.recommendationFilters.fresh;
    filterFresh.addEventListener("change", () => {
      state.recommendationFilters.fresh = filterFresh.checked;
      updateFilteredRecommendations();
    });
  }

  if (onboardingNext) {
    onboardingNext.addEventListener("click", () => {
      playUiClick();
      if (state.onboardingStep >= ONBOARDING_STEPS.length - 1) {
        closeOnboarding();
      } else {
        state.onboardingStep += 1;
        updateOnboardingUi();
      }
    });
  }

  if (onboardingBack) {
    onboardingBack.addEventListener("click", () => {
      playUiClick();
      if (state.onboardingStep > 0) {
        state.onboardingStep -= 1;
        updateOnboardingUi();
      }
    });
  }

  if (onboardingClose) {
    onboardingClose.addEventListener("click", () => {
      playUiClick();
      closeOnboarding();
    });
  }

  const onboardingOverlay = $("onboardingCoach");
  if (onboardingOverlay) {
    onboardingOverlay.addEventListener("click", (event) => {
      if (event.target === onboardingOverlay) {
        playUiClick();
        closeOnboarding();
      }
    });
  }

  document.querySelectorAll('[data-password-toggle]').forEach((button) => {
    attachPasswordToggle(button);
  });

  if (settingsPasswordChecklist && newPasswordInput) {
    const refreshChecklist = () => {
      updatePasswordChecklist(
        settingsPasswordChecklist,
        newPasswordInput ? newPasswordInput.value : "",
        confirmPasswordInput ? confirmPasswordInput.value : ""
      );
    };
    newPasswordInput.addEventListener("input", refreshChecklist);
    if (confirmPasswordInput) {
      confirmPasswordInput.addEventListener("input", refreshChecklist);
    }
    refreshChecklist();
  }

  const settingsNavButtons = document.querySelectorAll('[data-settings-target]');
  if (settingsNavButtons.length) {
    settingsNavButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const target = button.getAttribute("data-settings-target") || "profile";
        setActiveSettingsSection(target);
      });
    });
  }

  document.addEventListener("click", (event) => {
    if (state.accountMenuOpen) {
      const container = accountProfile || (accountProfileBtn ? accountProfileBtn.parentElement : null);
      if (!container || !container.contains(event.target)) {
        closeAccountMenu();
      }
    }
    if (state.notificationPanelOpen) {
      const bell = notificationBell;
      const panel = notificationPanel;
      const isBell = bell && bell.contains(event.target);
      const isPanel = panel && panel.contains(event.target);
      if (!isBell && !isPanel) {
        closeNotificationPanel();
      }
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (isSocialProfileOpen()) {
        closeSocialProfileOverlay();
        return;
      }
      if (isMovieOverlayOpen()) {
        closeMovieOverlay();
        return;
      }
      if (state.accountMenuOpen) {
        closeAccountMenu(true);
      }
      if (state.notificationPanelOpen) {
        closeNotificationPanel();
      }
      const coach = $("onboardingCoach");
      if (coach && !coach.hidden) {
        closeOnboarding();
      }
    }
  });

  if (profileForm) {
    profileForm.addEventListener("submit", handleProfileSubmit);
  }

  if (securityForm) {
    securityForm.addEventListener("submit", handleSecuritySubmit);
  }

  if (avatarInput) {
    avatarInput.addEventListener("change", handleAvatarInputChange);
  }

  if (avatarUploadBtn && avatarInput) {
    avatarUploadBtn.addEventListener("click", () => {
      playUiClick();
      avatarInput.click();
    });
  }

  if (avatarRemoveBtn) {
    avatarRemoveBtn.addEventListener("click", () => {
      playUiClick();
      handleAvatarRemove();
    });
  }

  const prefsForm = $("prefsForm");
  if (prefsForm) {
    prefsForm.addEventListener("submit", (event) => {
      event.preventDefault();
      playUiClick();
      getRecommendations(false);
    });
  }

  const updatePreview = () => updatePreferencesPreview();

  document.querySelectorAll('input[name="genre"]').forEach((checkbox) =>
    checkbox.addEventListener("change", () => {
      syncPresetSelectionFromGenres();
      updatePreview();
    })
  );

  document.querySelectorAll(VIBE_PRESET_SELECTOR).forEach((button) => {
    button.addEventListener("click", () => {
      playUiClick();
      applyPresetFromButton(button);
    });
  });

  document.querySelectorAll('[data-empty-scroll]').forEach((button) => {
    button.addEventListener("click", () => {
      const selector = button.getAttribute("data-empty-scroll");
      playUiClick();
      if (!selector) {
        return;
      }
      const target = document.querySelector(selector);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });

  const recNudgeBtn = $("recNudgeBtn");
  if (recNudgeBtn) {
    recNudgeBtn.addEventListener("click", () => {
      playUiClick();
      state.lastRecSeed = Math.random();
      getRecommendations(true);
    });
  }

  const showMoreBtn = $("showMoreRecsBtn");
  if (showMoreBtn) {
    showMoreBtn.addEventListener("click", () => {
      playUiClick();
      revealMoreRecommendations();
    });
  }

  const clearWatchedBtn = $("clearWatchedBtn");
  if (clearWatchedBtn) {
    clearWatchedBtn.addEventListener("click", () => {
      playUiClick();
      if (!state.watchedMovies.length) {
        return;
      }
      const sure = window.confirm(
        "Clear your watched history on this device? This only affects recommendations in this browser."
      );
      if (!sure) {
        return;
      }
      state.watchedMovies = [];
      refreshWatchedUi();
      scheduleWatchedSync();
      getRecommendations(true);
      showToast({
        title: "History cleared",
        text: "Watched history reset for this device.",
        icon: "🧹"
      });
    });
  }

  document.querySelectorAll(".collection-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.getAttribute("data-target");
      if (target) {
        playUiClick();
        switchCollectionView(target);
      }
    });
  });

  document.querySelectorAll("[data-profile-snapshot-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const targetId = button.getAttribute("data-target");
      if (!targetId) {
        return;
      }
      const listEl = document.getElementById(targetId);
      if (!listEl) {
        return;
      }
      const isExpanded = listEl.dataset.expanded === "true";
      listEl.dataset.expanded = isExpanded ? "false" : "true";
      playUiClick();
      playExpandSound(!isExpanded);
      refreshProfileOverviewCallout();
    });
  });

  document.querySelectorAll("[data-profile-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      const action = button.getAttribute("data-profile-action");
      if (!action) {
        return;
      }
      if (button.tagName === "A") {
        return;
      }
      event.preventDefault();
      playUiClick();
      switch (action) {
        case "favorites":
        case "watched":
          highlightCollectionSection(action);
          break;
        default:
          break;
      }
    });
  });

  document.addEventListener("click", (event) => {
    const settingsButton = event.target.closest("[data-profile-settings-action]");
    if (!settingsButton) {
      return;
    }
    const section = settingsButton.getAttribute("data-profile-settings-action") || "profile";
    event.preventDefault();
    playUiClick();
    openAccountSettings(section);
  });
}

function toggleAccountMenu() {
  if (state.accountMenuOpen) {
    closeAccountMenu();
  } else {
    openAccountMenu();
  }
}

function openAccountMenu() {
  const accountMenu = $("accountMenu");
  if (!accountMenu || !accountProfileBtn) {
    return;
  }
  accountMenu.classList.add("is-open");
  accountProfileBtn.setAttribute("aria-expanded", "true");
  state.accountMenuOpen = true;
  const firstItem = accountMenu.querySelector(".account-menu-item");
  if (firstItem) {
    window.requestAnimationFrame(() => {
      if (!state.accountMenuOpen) {
        return;
      }
      try {
        firstItem.focus();
      } catch (error) {
        console.warn("Account menu focus failed", error);
      }
    });
  }
}

function closeAccountMenu(focusButton = false) {
  const accountMenu = $("accountMenu");
  if (accountMenu) {
    accountMenu.classList.remove("is-open");
  }
  if (accountProfileBtn) {
    accountProfileBtn.setAttribute("aria-expanded", "false");
    if (focusButton) {
      accountProfileBtn.focus();
    }
  }
  state.accountMenuOpen = false;
}

function handleAccountMenuAction(action) {
  closeAccountMenu();
  switch (action) {
    case "profile":
      openProfilePage();
      break;
    case "settings":
      openAccountSettings();
      break;
    case "logout":
      logoutSession();
      setSyncStatus(
        "Signed out. Preferences won’t sync until you sign in again.",
        "muted"
      );
      break;
    default:
      break;
  }
}

function openProfilePage() {
  const page = document.body ? document.body.getAttribute("data-page") : null;
  if (page === "profile-overview") {
    const main = document.querySelector(".app-main");
    if (main) {
      main.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    return;
  }

  window.location.href = "profile.html";
}

function openProfileDeepLink(context = "social") {
  if (!state.session || !state.session.token) {
    window.location.href = "login.html";
    return;
  }
  const url = new URL("profile.html", window.location.origin);
  const normalized = typeof context === "string" ? context.toLowerCase() : "social";
  let hash = "";
  switch (normalized) {
    case "party":
      hash = "watchPartyInviteList";
      break;
    case "collab":
      hash = "collabInviteList";
      break;
    case "social":
    case "follow":
    default:
      hash = "socialConnectionsSection";
      break;
  }
  url.searchParams.set("context", normalized);
  if (hash) {
    url.hash = `#${hash}`;
  }
  window.location.href = url.toString();
}

function highlightCollectionSection(target) {
  const normalized = target === "watched" ? "watched" : "favorites";
  switchCollectionView(normalized);
  const collectionsPanel = document.querySelector(".profile-collections-panel");
  if (collectionsPanel) {
    collectionsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const highlightView = normalized === "watched" ? $("watchedView") : $("favoritesView");
  const highlightEl = highlightView || collectionsPanel;
  if (highlightEl) {
    highlightEl.classList.add("profile-section-pulse");
    window.setTimeout(() => {
      highlightEl.classList.remove("profile-section-pulse");
    }, 1200);
  }
}

function isAccountSettingsContext() {
  const page = document.body ? document.body.getAttribute("data-page") : null;
  return page === "account-settings";
}

function isSocialProfileContext() {
  const page = document.body ? document.body.getAttribute("data-page") : null;
  return page === "social-profile" || page === "peeruser-profile";
}

function openAccountSettings(section = "profile") {
  if (!state.session || !state.session.token) {
    window.location.href = "login.html";
    return;
  }

  const page = document.body ? document.body.getAttribute("data-page") : null;
  const normalized = section === "security" ? "security" : "profile";

  if (page === "account-settings") {
    populateAccountSettings();
    window.setTimeout(() => {
      if (normalized === "security") {
        const anchor = document.getElementById("security");
        if (anchor) {
          anchor.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        const securityInput = $("currentPasswordInput");
        if (securityInput) {
          securityInput.focus();
        }
      } else {
        const profileAnchor = document.getElementById("profile");
        if (profileAnchor) {
          profileAnchor.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        const displayNameInput = $("accountDisplayName");
        if (displayNameInput) {
          displayNameInput.focus();
        }
      }
    }, 60);
    return;
  }

  let target = "account-settings.html";
  if (normalized === "security") {
    target += "#security";
  }
  window.location.href = target;
}

function updateAvatarRemoveAvailability(canRemove) {
  const removeBtn = $("accountAvatarRemove");
  if (removeBtn) {
    removeBtn.disabled = !canRemove;
  }
}

function populateAccountSettings() {
  const displayNameInput = $("accountDisplayName");
  const settingsAvatar = document.querySelector(".settings-avatar");
  const preview = $("settingsAvatarPreview");
  const profileStatus = $("accountProfileStatus");
  const securityStatus = $("accountSecurityStatus");
  const avatarInput = $("accountAvatarInput");

  state.accountRemoveAvatar = false;
  if (avatarInput) {
    avatarInput.value = "";
  }
  if (state.accountAvatarPreviewUrl) {
    URL.revokeObjectURL(state.accountAvatarPreviewUrl);
    state.accountAvatarPreviewUrl = null;
  }

  if (displayNameInput) {
    displayNameInput.value = state.session && state.session.displayName ? state.session.displayName : "";
  }
  if (profileStatus) {
    profileStatus.textContent = "";
    profileStatus.removeAttribute("data-variant");
  }
  if (securityStatus) {
    securityStatus.textContent = "";
    securityStatus.removeAttribute("data-variant");
  }

  const initials = getActiveDisplayName().slice(0, 2).toUpperCase() || "SM";
  if (settingsAvatar && preview) {
    if (state.session && state.session.avatarUrl) {
      settingsAvatar.style.backgroundImage = `url(${state.session.avatarUrl})`;
      settingsAvatar.style.backgroundSize = "cover";
      settingsAvatar.style.backgroundPosition = "center";
      settingsAvatar.classList.add("has-image");
      preview.textContent = "";
      updateAvatarRemoveAvailability(true);
    } else {
      settingsAvatar.style.backgroundImage = "none";
      settingsAvatar.style.backgroundSize = "";
      settingsAvatar.style.backgroundPosition = "";
      settingsAvatar.classList.remove("has-image");
      preview.textContent = initials;
      updateAvatarRemoveAvailability(false);
    }
  }

}

async function handleProfileSubmit(event) {
  event.preventDefault();
  if (!state.session || !state.session.token) {
    window.location.href = "login.html";
    return;
  }
  const displayNameInput = $("accountDisplayName");
  const statusEl = $("accountProfileStatus");
  const avatarInput = $("accountAvatarInput");

  if (!displayNameInput || !statusEl) {
    return;
  }

  const displayName = displayNameInput.value.trim();
  if (displayName.length < 2) {
    statusEl.textContent = "Display name should be at least 2 characters.";
    statusEl.dataset.variant = "error";
    return;
  }

  let avatarBase64 = null;
  let avatarFileName = null;
  if (state.accountRemoveAvatar) {
    avatarBase64 = null;
    avatarFileName = null;
  } else if (avatarInput && avatarInput.files && avatarInput.files[0]) {
    const file = avatarInput.files[0];
    if (file.size > 5 * 1024 * 1024) {
      statusEl.textContent = "Avatar must be 5 MB or smaller.";
      statusEl.dataset.variant = "error";
      return;
    }
    try {
      avatarBase64 = await fileToBase64(file);
      avatarFileName = file.name;
    } catch (error) {
      statusEl.textContent = "Couldn’t read that image file.";
      statusEl.dataset.variant = "error";
      return;
    }
  }

  statusEl.textContent = "Saving profile…";
  statusEl.dataset.variant = "loading";

  try {
    await updateProfile({
      displayName,
      avatarBase64,
      avatarFileName,
      removeAvatar: state.accountRemoveAvatar
    });
    statusEl.textContent = "Profile updated.";
    statusEl.dataset.variant = "success";
    state.accountRemoveAvatar = false;
    if (avatarInput) {
      avatarInput.value = "";
    }
    populateAccountSettings();
  } catch (error) {
    statusEl.textContent = error.message || "Couldn’t update your profile.";
    statusEl.dataset.variant = "error";
  }
}

async function handleSecuritySubmit(event) {
  event.preventDefault();
  if (!state.session || !state.session.token) {
    window.location.href = "login.html";
    return;
  }
  const currentInput = $("currentPasswordInput");
  const newInput = $("newPasswordInput");
  const confirmInput = $("confirmPasswordInput");
  const statusEl = $("accountSecurityStatus");
  const checklist = $("settingsPasswordChecklist");

  if (!currentInput || !newInput || !confirmInput || !statusEl) {
    return;
  }

  const currentPassword = currentInput.value;
  const newPassword = newInput.value;
  const confirmPassword = confirmInput.value;

  updatePasswordChecklist(checklist, newPassword, confirmPassword);

  if (newPassword !== confirmPassword) {
    statusEl.textContent = "New passwords don’t match.";
    statusEl.dataset.variant = "error";
    return;
  }

  if (newPassword.length < 8) {
    statusEl.textContent = "Use at least 8 characters for your new password.";
    statusEl.dataset.variant = "error";
    return;
  }

  statusEl.textContent = "Updating password…";
  statusEl.dataset.variant = "loading";

  try {
    await changePassword({ currentPassword, newPassword });
    statusEl.textContent = "Password updated. We’ve refreshed your session.";
    statusEl.dataset.variant = "success";
    currentInput.value = "";
    newInput.value = "";
    confirmInput.value = "";
    updatePasswordChecklist(checklist, "", "");
  } catch (error) {
    statusEl.textContent = error.message || "Couldn’t update your password.";
    statusEl.dataset.variant = "error";
  }
}

function handleAvatarInputChange(event) {
  const input = event.target;
  const settingsAvatar = document.querySelector(".settings-avatar");
  const preview = $("settingsAvatarPreview");
  const statusEl = $("accountProfileStatus");
  if (!input || !settingsAvatar || !preview) {
    return;
  }

  if (!input.files || !input.files[0]) {
    if (state.accountAvatarPreviewUrl) {
      URL.revokeObjectURL(state.accountAvatarPreviewUrl);
      state.accountAvatarPreviewUrl = null;
    }
    settingsAvatar.style.backgroundImage = "none";
    settingsAvatar.style.backgroundSize = "";
    settingsAvatar.style.backgroundPosition = "";
    settingsAvatar.classList.remove("has-image");
    preview.textContent = getActiveDisplayName().slice(0, 2).toUpperCase() || "SM";
    state.accountRemoveAvatar = false;
    updateAvatarRemoveAvailability(false);
    return;
  }

  const file = input.files[0];
  if (!file.type.startsWith("image/")) {
    if (statusEl) {
      statusEl.textContent = "Choose an image file for your avatar.";
      statusEl.dataset.variant = "error";
    }
    input.value = "";
    updateAvatarRemoveAvailability(settingsAvatar.classList.contains("has-image"));
    return;
  }

  if (state.accountAvatarPreviewUrl) {
    URL.revokeObjectURL(state.accountAvatarPreviewUrl);
  }
  const objectUrl = URL.createObjectURL(file);
  state.accountAvatarPreviewUrl = objectUrl;
  settingsAvatar.style.backgroundImage = `url(${objectUrl})`;
  settingsAvatar.style.backgroundSize = "cover";
  settingsAvatar.style.backgroundPosition = "center";
  settingsAvatar.classList.add("has-image");
  preview.textContent = "";
  state.accountRemoveAvatar = false;
  updateAvatarRemoveAvailability(true);
}

function handleAvatarRemove() {
  const settingsAvatar = document.querySelector(".settings-avatar");
  const preview = $("settingsAvatarPreview");
  const avatarInput = $("accountAvatarInput");
  if (settingsAvatar) {
    settingsAvatar.style.backgroundImage = "none";
    settingsAvatar.style.backgroundSize = "";
    settingsAvatar.style.backgroundPosition = "";
    settingsAvatar.classList.remove("has-image");
  }
  if (preview) {
    preview.textContent = getActiveDisplayName().slice(0, 2).toUpperCase() || "SM";
  }
  if (avatarInput) {
    avatarInput.value = "";
  }
  if (state.accountAvatarPreviewUrl) {
    URL.revokeObjectURL(state.accountAvatarPreviewUrl);
    state.accountAvatarPreviewUrl = null;
  }
  state.accountRemoveAvatar = true;
  updateAvatarRemoveAvailability(false);
}

function refreshWatchedUi() {
  const filteredWatched = applyCollectionFilters(state.watchedMovies);
  renderWatchedList(filteredWatched, { onRemove: handleRemoveWatched });
  updateWatchedSummary(state.watchedMovies);
  updateCollectionVisibility();
  updatePreferencesPreview();
  refreshProfileOverviewCallout();
  updateCollectionFilterOptions();
  if (state.recommendations.length && !state.activeRecAbort) {
    updateRecommendationsView();
  }
}

function refreshFavoritesUi() {
  const filteredFavorites = applyCollectionFilters(state.favorites);
  renderFavoritesList(filteredFavorites, { onRemove: handleRemoveFavorite });
  updateFavoritesSummary(state.favorites);
  updateCollectionVisibility();
  updatePreferencesPreview();
  refreshProfileOverviewCallout();
  updateCollectionFilterOptions();
  if (state.recommendations.length && !state.activeRecAbort) {
    updateRecommendationsView();
  }
}


function refreshProfileOverviewCallout(options = {}) {
  const callout = $("profileOverviewCallout");
  if (!callout) {
    return;
  }

  const favoritesValue = $("profileCalloutFavoritesValue");
  const favoritesMeta = $("profileCalloutFavoritesMeta");
  const watchedValue = $("profileCalloutWatchedValue");
  const watchedMeta = $("profileCalloutWatchedMeta");
  const syncValue = $("profileCalloutSyncValue");
  const syncMeta = $("profileCalloutSyncMeta");
  const progressFill = $("profileCalloutProgressFill");
  const progressText = $("profileCalloutProgressText");
  const progressContainer = $("profileCalloutProgress");
  const favoritesList = $("profileCalloutFavoritesList");
  const watchedList = $("profileCalloutWatchedList");
  const favoritesSubtitle = $("profileCalloutFavoritesSubtitle");
  const watchedSubtitle = $("profileCalloutWatchedSubtitle");
  const tasteList = $("profileCalloutTasteList");
  const tasteSubtitle = $("profileCalloutTasteSubtitle");
  const syncBadge = $("profileCalloutSyncBadge");
  const genreDonut = $("profileGenreDonut");
  const genreLegend = $("profileGenreLegend");
  const genreMeta = $("profileGenreMeta");
  const activityTimeline = $("profileActivityTimeline");
  const activityMeta = $("profileActivityMeta");

  const favoritesCount = Array.isArray(state.favorites) ? state.favorites.length : 0;
  const watchedCount = Array.isArray(state.watchedMovies) ? state.watchedMovies.length : 0;
  const session = state.session;
  const isSignedIn = Boolean(session && session.token);
  const mostRecentSync = getMostRecentSync(session);
  const syncToken = mostRecentSync
    ? mostRecentSync.toISOString()
    : isSignedIn
    ? "pending"
    : "guest";
  const syncState = isSignedIn ? (mostRecentSync ? "active" : "pending") : "guest";

  callout.dataset.syncState = syncState;

  const describeSync = (timestamp, fallback) => {
    if (!isSignedIn) {
      return fallback;
    }
    if (!timestamp) {
      return "Sync pending";
    }
    try {
      return `Synced ${formatSyncTime(timestamp)}`;
    } catch (error) {
      return "Synced recently";
    }
  };

  if (favoritesValue) {
    favoritesValue.textContent = favoritesCount ? favoritesCount.toLocaleString() : "0";
  }
  if (watchedValue) {
    watchedValue.textContent = watchedCount ? watchedCount.toLocaleString() : "0";
  }
  if (syncValue) {
    syncValue.textContent = isSignedIn
      ? mostRecentSync
        ? formatSyncTime(mostRecentSync.toISOString())
        : "Pending"
      : "Guest mode";
  }

  if (syncBadge) {
    let badgeText = "Guest mode";
    let badgeTitle = "Guest mode – sign in to sync your profile.";
    if (isSignedIn) {
      if (mostRecentSync) {
        badgeText = "Sync up to date";
        badgeTitle = `Last synced ${formatSyncTime(mostRecentSync.toISOString())}.`;
      } else {
        badgeText = "Sync pending";
        badgeTitle = "Sync pending – we’ll sync automatically soon.";
      }
    }
    syncBadge.textContent = badgeText;
    syncBadge.setAttribute("title", badgeTitle);
  }

  const latestFavorite = favoritesCount ? state.favorites[favoritesCount - 1] : null;
  const latestWatched = watchedCount ? state.watchedMovies[watchedCount - 1] : null;

  if (favoritesMeta) {
    const fallback = favoritesCount ? "Stored locally" : "Ready when you are";
    const syncDescription = describeSync(session ? session.lastFavoritesSync : null, fallback);
    if (latestFavorite && latestFavorite.title) {
      favoritesMeta.textContent = `${syncDescription} • Latest: “${latestFavorite.title}”`;
    } else {
      favoritesMeta.textContent = syncDescription;
    }
  }

  if (watchedMeta) {
    const fallback = watchedCount ? "Stored locally" : "Log watched titles to tune picks.";
    const syncDescription = describeSync(session ? session.lastWatchedSync : null, fallback);
    if (latestWatched && latestWatched.title) {
      watchedMeta.textContent = `${syncDescription} • Latest: “${latestWatched.title}”`;
    } else {
      watchedMeta.textContent = syncDescription;
    }
  }

  if (syncMeta) {
    syncMeta.textContent = isSignedIn
      ? "Automatic sync keeps favorites and watched aligned."
      : "Sign in to start syncing automatically.";
  }

  if (progressFill || progressText || progressContainer) {
    const remainder = favoritesCount % PROFILE_CALLOUT_MILESTONE;
    const progressSteps = favoritesCount === 0 ? 0 : remainder === 0 ? PROFILE_CALLOUT_MILESTONE : remainder;
    const progressPercent = Math.min(1, progressSteps / PROFILE_CALLOUT_MILESTONE);
    const nextMilestone =
      favoritesCount === 0
        ? PROFILE_CALLOUT_MILESTONE
        : remainder === 0
        ? PROFILE_CALLOUT_MILESTONE
        : PROFILE_CALLOUT_MILESTONE - remainder;
    let progressMessage = "";
    if (progressFill) {
      progressFill.style.width = `${Math.round(progressPercent * 100)}%`;
    }
    if (progressText) {
      if (!favoritesCount) {
        progressMessage = "Add 5 favorites to unlock smarter batches.";
      } else if (nextMilestone === PROFILE_CALLOUT_MILESTONE) {
        progressMessage = "Milestone reached! Keep adding favorites for sharper picks.";
      } else {
        progressMessage = `${nextMilestone} more favorite${nextMilestone === 1 ? "" : "s"} unlock a smarter batch.`;
      }
      progressText.textContent = progressMessage;
    }
    if (progressContainer && progressMessage) {
      progressContainer.setAttribute("aria-label", `Favorite milestone progress – ${progressMessage}`);
      progressContainer.setAttribute("data-progress-message", progressMessage);
    } else if (progressContainer) {
      progressContainer.removeAttribute("data-progress-message");
      progressContainer.removeAttribute("aria-label");
    }
  }

  const genreMap = new Map();
  const addGenresFrom = (items) => {
    if (!Array.isArray(items)) {
      return;
    }
    items.forEach((entry) => {
      if (!entry || !Array.isArray(entry.genres)) {
        return;
      }
      entry.genres.forEach((genre) => {
        if (!genre) {
          return;
        }
        const normalized = genre.trim().toLowerCase();
        if (!normalized) {
          return;
        }
        if (!genreMap.has(normalized)) {
          genreMap.set(normalized, { label: genre.trim(), count: 0 });
        }
        const data = genreMap.get(normalized);
        data.count += 1;
      });
    });
  };

  addGenresFrom(state.favorites);
  addGenresFrom(state.watchedMovies);
  const topGenres = Array.from(genreMap.values()).sort((a, b) => b.count - a.count).slice(0, 3);

  const computeViewingStreak = () => {
    if (!Array.isArray(state.watchedMovies) || !state.watchedMovies.length) {
      return 0;
    }
    const daySet = new Set();
    state.watchedMovies.forEach((movie) => {
      const raw = movie && (movie.loggedAt || movie.syncedAt || movie.updatedAt || movie.timestamp);
      let date;
      if (typeof raw === "number" && Number.isFinite(raw)) {
        date = new Date(raw);
      } else if (typeof raw === "string" && raw.trim()) {
        date = new Date(raw);
      }
      if (date && !Number.isNaN(date.getTime())) {
        const normalized = new Date(date);
        normalized.setHours(0, 0, 0, 0);
        daySet.add(normalized.toISOString().slice(0, 10));
      }
    });
    if (!daySet.size) {
      return 0;
    }
    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let offset = 0; offset <= daySet.size; offset += 1) {
      const check = new Date(today);
      check.setDate(check.getDate() - offset);
      const key = check.toISOString().slice(0, 10);
      if (daySet.has(key)) {
        streak += 1;
      } else {
        break;
      }
    }
    return streak;
  };

  if (tasteList) {
    tasteList.innerHTML = "";
    const highlightItems = [];

    if (topGenres.length) {
      const labels = topGenres.map((entry) => entry.label);
      highlightItems.push({
        icon: getGenreIconByLabel(labels[0]),
        title: labels.length > 1 ? "Comfort genres" : `${labels[0]} focus`,
        meta: labels.join(" • ")
      });
    }

    const viewingStreak = computeViewingStreak();
    if (viewingStreak >= 2) {
      highlightItems.push({
        icon: "🔥",
        title: "Viewing streak",
        meta: `${viewingStreak} days in a row`
      });
    }

    const avgRating = getWatchedRatingPreference(
      Array.isArray(state.watchedMovies) ? state.watchedMovies : []
    );
    if (typeof avgRating === "number" && Number.isFinite(avgRating)) {
      highlightItems.push({
        icon: "⭐",
        title: "Average IMDb rating",
        meta: `${avgRating.toFixed(1)} across watched titles`
      });
    }

    if (!highlightItems.length && (favoritesCount || watchedCount)) {
      const prefersFavorites = favoritesCount >= watchedCount;
      const count = prefersFavorites ? favoritesCount : watchedCount;
      const noun = prefersFavorites ? "favorite" : "watched title";
      highlightItems.push({
        icon: prefersFavorites ? "💾" : "🎬",
        title: prefersFavorites ? "Favorites saved" : "Watched logged",
        meta: `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"} so far`
      });
    }

    if (!highlightItems.length) {
      const empty = document.createElement("li");
      empty.className = "profile-callout-taste-empty";
      empty.textContent = "Add favorites or log watched titles to unlock taste highlights.";
      tasteList.appendChild(empty);
    } else {
      highlightItems.slice(0, 3).forEach((item) => {
        const li = document.createElement("li");
        li.className = "profile-callout-taste-item";
        const iconEl = document.createElement("span");
        iconEl.className = "profile-callout-taste-icon";
        iconEl.textContent = item.icon;
        iconEl.setAttribute("aria-hidden", "true");
        const textWrap = document.createElement("div");
        textWrap.className = "profile-callout-taste-text";
        const titleEl = document.createElement("span");
        titleEl.className = "profile-callout-taste-title";
        titleEl.textContent = item.title;
        textWrap.appendChild(titleEl);
        if (item.meta) {
          const metaEl = document.createElement("span");
          metaEl.className = "profile-callout-taste-meta";
          metaEl.textContent = item.meta;
          textWrap.appendChild(metaEl);
        }
        li.appendChild(iconEl);
        li.appendChild(textWrap);
        tasteList.appendChild(li);
      });
  }

  if (tasteSubtitle) {
    tasteSubtitle.textContent = highlightItems.length
      ? "Based on your recent favorites and watched history."
      : "We’ll summarize your taste once you start saving titles.";
  }
} else if (tasteSubtitle) {
  tasteSubtitle.textContent = "We’ll summarize your taste once you start saving titles.";
}

  const genreChips = $("profileCalloutGenreChips");
  const genreEmpty = $("profileCalloutGenreEmpty");
  const selectedGenres = Array.isArray(session?.preferencesSnapshot?.selectedGenres)
    ? session.preferencesSnapshot.selectedGenres
        .map((genre) => (typeof genre === "string" ? genre.trim() : ""))
        .filter(Boolean)
    : [];
  const uniqueGenres = Array.from(new Set(selectedGenres.map((genre) => genre.toLowerCase()))).map((key) => {
    const match = selectedGenres.find((genre) => genre.toLowerCase() === key);
    return match || key;
  });

  if (genreChips) {
    genreChips.innerHTML = "";
    if (uniqueGenres.length) {
      genreChips.hidden = false;
      if (genreEmpty) {
        genreEmpty.hidden = true;
      }
      uniqueGenres.slice(0, 8).forEach((genre) => {
        const chip = document.createElement("li");
        chip.className = "profile-callout-genre-chip";
        const icon = document.createElement("span");
        icon.className = "profile-callout-genre-icon";
        icon.textContent = getGenreIconByLabel(genre);
        icon.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.className = "profile-callout-genre-label";
        label.textContent = genre;
        chip.appendChild(icon);
        chip.appendChild(label);
        genreChips.appendChild(chip);
      });
    } else {
      genreChips.hidden = true;
      if (genreEmpty) {
        genreEmpty.hidden = false;
      }
    }
  } else if (genreEmpty) {
    genreEmpty.hidden = uniqueGenres.length > 0;
  }

  if (genreDonut && genreLegend) {
    genreLegend.innerHTML = "";
    if (!topGenres.length) {
      genreDonut.dataset.state = "empty";
      genreDonut.style.background = "";
      if (genreMeta) {
        genreMeta.textContent = "Pick a few genres to visualize.";
      }
      const placeholder = document.createElement("li");
      placeholder.className = "profile-genre-legend-empty";
      placeholder.textContent = "Waiting for favorites…";
      genreLegend.appendChild(placeholder);
    } else {
      const totalGenreEntries = Array.from(genreMap.values()).reduce(
        (sum, entry) => sum + entry.count,
        0
      );
      const segments = [];
      let start = 0;
      topGenres.forEach((entry, index) => {
        const ratio = totalGenreEntries ? entry.count / totalGenreEntries : 0;
        const percent = Math.max(3, Math.round(ratio * 100));
        const color = GENRE_DONUT_COLORS[index % GENRE_DONUT_COLORS.length];
        const end = index === topGenres.length - 1 ? 100 : Math.min(100, start + percent);
        segments.push(`${color} ${start}% ${end}%`);
        const item = document.createElement("li");
        item.className = "profile-genre-legend-item";
        const dot = document.createElement("span");
        dot.className = "profile-genre-legend-dot";
        dot.style.setProperty("--legend-color", color);
        dot.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.className = "profile-genre-legend-label";
        label.textContent = entry.label;
        const value = document.createElement("span");
        value.className = "profile-genre-legend-value";
        value.textContent = `${Math.round(ratio * 100)}%`;
        item.appendChild(dot);
        item.appendChild(label);
        item.appendChild(value);
        genreLegend.appendChild(item);
        start = end;
      });
      genreDonut.style.background = `conic-gradient(${segments.join(",")})`;
      genreDonut.dataset.state = "ready";
      if (genreMeta) {
        genreMeta.textContent = "Top genres from your saved taste.";
      }
    }
  }

  if (activityTimeline) {
    activityTimeline.innerHTML = "";
    const activityBuckets = new Map();
    const normalizeTimestamp = (value) => {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === "string" && value.trim()) {
        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed)) {
          return parsed;
        }
      }
      return null;
    };
    const recordActivity = (raw, type) => {
      const timestamp = normalizeTimestamp(raw);
      if (timestamp === null) {
        return;
      }
      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime())) {
        return;
      }
      const key = date.toISOString().slice(0, 10);
      const bucket = activityBuckets.get(key) || { count: 0, types: new Set() };
      bucket.count += 1;
      bucket.types.add(type);
      activityBuckets.set(key, bucket);
    };

    state.watchedMovies.forEach((movie) => {
      if (!movie) {
        return;
      }
      recordActivity(movie.loggedAt || movie.syncedAt || movie.updatedAt || movie.timestamp, "watched");
    });
    state.favorites.forEach((favorite) => {
      if (!favorite) {
        return;
      }
      recordActivity(favorite.addedAt || favorite.syncedAt || favorite.updatedAt, "favorite");
    });

    const timelineData = [];
    const today = new Date();
    for (let offset = 6; offset >= 0; offset -= 1) {
      const day = new Date(today);
      day.setDate(today.getDate() - offset);
      const key = day.toISOString().slice(0, 10);
      const bucket = activityBuckets.get(key);
      const count = bucket ? bucket.count : 0;
      const chip = document.createElement("div");
      chip.className = "profile-activity-chip";
      chip.dataset.level = count ? String(Math.min(3, count)) : "0";
      chip.setAttribute("role", "listitem");
      const label = document.createElement("span");
      label.className = "profile-activity-chip-label";
      label.textContent = day.toLocaleDateString(undefined, { weekday: "short" });
      const tooltipDate = day.toLocaleDateString(undefined, { month: "long", day: "numeric" });
      chip.title = count
        ? `${count} action${count === 1 ? "" : "s"} logged on ${tooltipDate}.`
        : `No activity on ${tooltipDate}.`;
      chip.appendChild(label);
      activityTimeline.appendChild(chip);
      timelineData.push({ label: tooltipDate, count });
    }

    if (activityMeta) {
      const latestActive = [...timelineData].reverse().find((entry) => entry.count > 0);
      activityMeta.textContent = latestActive
        ? `Last activity: ${latestActive.count} logged ${latestActive.label}.`
        : "No activity logged yet.";
    }
  } else if (activityMeta) {
    activityMeta.textContent = "No activity logged yet.";
  }

  const renderSnapshotList = (
    listEl,
    subtitleEl,
    items,
    totalCount,
    emptyMessage,
    singularLabel,
    pluralLabel
  ) => {
    if (!listEl) {
      return;
    }
    listEl.innerHTML = "";

    const toggleBtn = listEl.id
      ? document.querySelector(`.profile-callout-toggle[data-target="${listEl.id}"]`)
      : null;

    if (!totalCount) {
      if (subtitleEl) {
        subtitleEl.textContent = emptyMessage;
      }
      const empty = document.createElement("li");
      empty.className = "profile-callout-snapshot-empty";
      empty.textContent = emptyMessage;
      listEl.appendChild(empty);
      if (listEl.id === "profileCalloutFavoritesList" || listEl.id === "profileCalloutWatchedList") {
        const ctaItem = document.createElement("li");
        ctaItem.className = "profile-callout-snapshot-empty-cta";
        const ctaButton = document.createElement("button");
        ctaButton.type = "button";
        ctaButton.className = "profile-callout-empty-cta";
        if (listEl.id === "profileCalloutFavoritesList") {
          ctaButton.textContent = "Find movies to favorite";
          ctaButton.addEventListener("click", () => {
            window.location.href = "index.html#recommendationsPanel";
          });
        } else {
          ctaButton.textContent = "Log something you watched";
          ctaButton.addEventListener("click", () => {
            window.location.href = "index.html#collectionsPanel";
          });
        }
        ctaItem.appendChild(ctaButton);
        listEl.appendChild(ctaItem);
      }
      listEl.dataset.expanded = "false";
      if (toggleBtn) {
        toggleBtn.hidden = true;
        toggleBtn.setAttribute("aria-hidden", "true");
        toggleBtn.setAttribute("aria-expanded", "false");
      }
      return;
    }

    if (totalCount <= PROFILE_CALLOUT_SNAPSHOT_LIMIT) {
      listEl.dataset.expanded = "false";
    }

    const isExpanded = listEl.dataset.expanded === "true" && totalCount > PROFILE_CALLOUT_SNAPSHOT_LIMIT;
    const sortedItems = items.filter(Boolean);
    const visibleItems = isExpanded
      ? sortedItems.reverse()
      : sortedItems.slice(-PROFILE_CALLOUT_SNAPSHOT_LIMIT).reverse();

    if (subtitleEl) {
      const totalLabel = totalCount === 1 ? singularLabel : pluralLabel;
      if (isExpanded) {
        subtitleEl.textContent = `All ${totalCount} ${totalLabel}`;
      } else {
        const visibleCount = visibleItems.length;
        subtitleEl.textContent = `Latest ${visibleCount} of ${totalCount} ${totalLabel}`;
      }
    }

    const formatMeta = (entry) => {
      if (!entry) {
        return "";
      }
      const parts = [];
      if (entry.year) {
        parts.push(String(entry.year));
      }
      if (Array.isArray(entry.genres) && entry.genres.length) {
        parts.push(entry.genres.slice(0, 2).join(" • "));
      }
      if (typeof entry.rating === "number" && Number.isFinite(entry.rating)) {
        parts.push(`IMDb ${entry.rating.toFixed(1)}`);
      }
      return parts.join(" • ");
    };

    visibleItems.forEach((entry) => {
      if (!entry) {
        return;
      }
      const item = document.createElement("li");
      item.className = "profile-callout-snapshot-item";
      const thumb = document.createElement("div");
      thumb.className = "profile-callout-snapshot-thumb";
      if (entry.poster) {
        const img = document.createElement("img");
        img.src = entry.poster;
        img.alt = `Poster for ${entry.title || "this movie"}`;
        thumb.appendChild(img);
      } else {
        const fallback = document.createElement("span");
        fallback.className = "profile-callout-snapshot-thumb-fallback";
        const initial = entry.title ? entry.title.trim().charAt(0).toUpperCase() : "🎬";
        fallback.textContent = initial || "🎬";
        thumb.appendChild(fallback);
      }
      item.appendChild(thumb);

      const content = document.createElement("div");
      content.className = "profile-callout-snapshot-content";
      const title = document.createElement("span");
      title.className = "profile-callout-snapshot-item-title";
      title.textContent = entry.title || "Untitled";
      content.appendChild(title);
      const meta = formatMeta(entry);
      if (meta) {
        const metaEl = document.createElement("span");
        metaEl.className = "profile-callout-snapshot-item-meta";
        metaEl.textContent = meta;
        content.appendChild(metaEl);
      }
      if (isExpanded && entry.overview) {
        const overview = document.createElement("span");
        overview.className = "profile-callout-snapshot-item-overview";
        overview.textContent = entry.overview;
        content.appendChild(overview);
      }
      item.appendChild(content);
      listEl.appendChild(item);
    });

    if (toggleBtn) {
      const pluralText = toggleBtn.dataset.labelPlural || pluralLabel;
      const singularText = toggleBtn.dataset.labelSingular || singularLabel;
      const label = totalCount === 1 ? singularText : pluralText;
      const canExpand = totalCount > PROFILE_CALLOUT_SNAPSHOT_LIMIT;
      toggleBtn.hidden = !canExpand;
      toggleBtn.setAttribute("aria-hidden", canExpand ? "false" : "true");
      toggleBtn.setAttribute("aria-expanded", isExpanded ? "true" : "false");
      if (canExpand) {
        toggleBtn.textContent = isExpanded
          ? `Show recent ${label}`
          : `Show all ${label}`;
      } else {
        toggleBtn.textContent = `All ${totalCount} ${label}`;
      }
    }
  };

  renderSnapshotList(
    favoritesList,
    favoritesSubtitle,
    Array.isArray(state.favorites) ? state.favorites : [],
    favoritesCount,
    "Save favorites to surface them here.",
    "favorite",
    "favorites"
  );

  renderSnapshotList(
    watchedList,
    watchedSubtitle,
    Array.isArray(state.watchedMovies) ? state.watchedMovies : [],
    watchedCount,
    "Log watched titles to see recent activity.",
    "watched title",
    "watched titles"
  );

  callout.classList.toggle("has-data", favoritesCount > 0 || watchedCount > 0);

  const syncChanged =
    profileCalloutSnapshot.lastSyncToken !== null && syncToken !== profileCalloutSnapshot.lastSyncToken;

  const shouldPulse =
    options.forcePulse ||
    favoritesCount > profileCalloutSnapshot.favoritesCount ||
    watchedCount > profileCalloutSnapshot.watchedCount ||
    syncChanged;

  if (shouldPulse) {
    callout.classList.add("has-updates");
    if (profileCalloutPulseTimer) {
      window.clearTimeout(profileCalloutPulseTimer);
    }
    profileCalloutPulseTimer = window.setTimeout(() => {
      callout.classList.remove("has-updates");
      profileCalloutPulseTimer = null;
    }, PROFILE_CALLOUT_PULSE_DURATION);
  }

  profileCalloutSnapshot = {
    favoritesCount,
    watchedCount,
    lastSyncToken: syncToken
  };
}


function clearActivePresetUi() {
  document.querySelectorAll(VIBE_PRESET_SELECTOR).forEach((button) => {
    button.classList.remove("is-active");
    button.setAttribute("aria-pressed", "false");
  });
}

function syncPresetSelectionFromGenres() {
  if (!state.activePreset) {
    return;
  }
  const selectedGenres = Array.from(
    document.querySelectorAll('label.genre-pill input[name="genre"]:checked')
  ).map((input) => input.value);
  const presetGenres = Array.isArray(state.activePreset.genres)
    ? state.activePreset.genres
    : [];
  const matches =
    selectedGenres.length === presetGenres.length &&
    presetGenres.every((genre) => selectedGenres.includes(genre));
  if (!matches) {
    state.activePreset = null;
    clearActivePresetUi();
  }
}

function applyPresetFromButton(button) {
  if (!button) {
    return;
  }
  const key = button.getAttribute("data-vibe-preset");
  if (!key) {
    return;
  }
  const currentKey = state.activePreset ? state.activePreset.key : null;
  if (currentKey === key) {
    state.activePreset = null;
    clearActivePresetUi();
    updatePreferencesPreview();
    return;
  }

  const rawGenres = button.getAttribute("data-preset-genres") || "";
  const genres = rawGenres
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const title = button.getAttribute("data-preset-title") || button.textContent.trim();
  const summary = button.getAttribute("data-preset-summary") || "";
  const icon = button.getAttribute("data-preset-icon") || "🎬";
  state.activePreset = { key, genres, title, summary, icon };

  document.querySelectorAll('input[name="genre"]').forEach((checkbox) => {
    checkbox.checked = genres.includes(checkbox.value);
  });

  document.querySelectorAll(VIBE_PRESET_SELECTOR).forEach((presetBtn) => {
    const match = presetBtn.getAttribute("data-vibe-preset") === key;
    presetBtn.classList.toggle("is-active", match);
    presetBtn.setAttribute("aria-pressed", match ? "true" : "false");
  });
  updatePreferencesPreview();
}

function updatePreferencesPreview() {
  const container = $("preferencesPreview");
  if (!container) {
    return;
  }

  const selectedGenreInputs = Array.from(
    document.querySelectorAll('label.genre-pill input[name="genre"]:checked')
  );
  const selectedGenres = selectedGenreInputs
    .map((input) => {
      const genreId = input.value;
      let labelText = "";
      if (genreId && TMDB_GENRES[genreId]) {
        labelText = TMDB_GENRES[genreId];
      } else {
        const label = input.closest(".genre-pill");
        if (label) {
          const span = label.querySelector(".genre-pill-label");
          labelText = span ? span.textContent.trim() : "";
        }
      }
      if (!labelText) {
        return null;
      }
      return { id: genreId, label: labelText };
    })
    .filter(Boolean);

  container.innerHTML = "";

  const title = document.createElement("div");
  title.className = "preferences-preview-title";
  title.textContent = "Live summary";
  container.appendChild(title);

  if (state.activePreset) {
    const presetBanner = document.createElement("div");
    presetBanner.className = "preferences-preview-preset";
    const iconEl = document.createElement("span");
    iconEl.className = "preferences-preview-preset-icon";
    iconEl.textContent = state.activePreset.icon || "✨";
    iconEl.setAttribute("aria-hidden", "true");
    const textWrap = document.createElement("div");
    textWrap.className = "preferences-preview-preset-body";
    const heading = document.createElement("span");
    heading.className = "preferences-preview-preset-title";
    heading.textContent = state.activePreset.title || "Preset applied";
    const summary = document.createElement("span");
    summary.className = "preferences-preview-preset-summary";
    summary.textContent =
      state.activePreset.summary || "You can fine-tune the checkboxes below.";
    textWrap.appendChild(heading);
    textWrap.appendChild(summary);
    presetBanner.appendChild(iconEl);
    presetBanner.appendChild(textWrap);
    container.appendChild(presetBanner);
  }

  const listsWrap = document.createElement("div");
  listsWrap.className = "preferences-collection-lists";

  const createList = (headingText) => {
    const listWrap = document.createElement("div");
    listWrap.className = "preferences-collection-list";
    const heading = document.createElement("div");
    heading.className = "preferences-collection-heading";
    heading.textContent = headingText;
    listWrap.appendChild(heading);
    return listWrap;
  };

  const createItem = (item) => {
    const itemTitle = item.title || "Untitled";
    const meta = item.meta || "";
    const poster = item.poster || null;
    const icon = item.icon || null;
    const details = Array.isArray(item.details) ? item.details.filter(Boolean) : [];

    const wrapper = document.createElement("div");
    wrapper.className = "preferences-collection-item";
    if (item.extra) {
      wrapper.classList.add("collection-item-extra");
    }

    const iconWrap = document.createElement("div");
    iconWrap.className = "preferences-collection-icon";
    if (poster) {
      const img = document.createElement("img");
      img.src = poster;
      img.alt = `Poster for ${itemTitle}`;
      iconWrap.appendChild(img);
    } else if (icon) {
      iconWrap.textContent = icon;
    } else {
      iconWrap.textContent = "🎬";
    }

    const body = document.createElement("div");
    body.className = "preferences-collection-body";

    const titleEl = document.createElement("div");
    titleEl.className = "preferences-collection-title";
    titleEl.textContent = itemTitle;

    const metaEl = document.createElement("div");
    metaEl.className = "preferences-collection-meta";
    metaEl.textContent = meta;

    body.appendChild(titleEl);
    body.appendChild(metaEl);

    wrapper.appendChild(iconWrap);
    wrapper.appendChild(body);

    if (details.length) {
      wrapper.setAttribute("role", "button");
      wrapper.setAttribute("tabindex", "0");
      wrapper.setAttribute("aria-expanded", "false");

      const detailEl = document.createElement("div");
      detailEl.className = "preferences-collection-details";
      detailEl.style.display = "none";
      details.forEach((line, index) => {
        const row = document.createElement("div");
        row.className =
          index === 0
            ? "preferences-collection-detail-primary"
            : "preferences-collection-detail-meta";
        row.textContent = line;
        detailEl.appendChild(row);
      });
      wrapper.appendChild(detailEl);

      const toggle = () => {
        const expanded = wrapper.classList.toggle("expanded");
        detailEl.style.display = expanded ? "block" : "none";
        wrapper.setAttribute("aria-expanded", expanded ? "true" : "false");
        playExpandSound(expanded);
      };

      wrapper.addEventListener("click", (event) => {
        if (event.target.closest("button")) {
          return;
        }
        if (ensureSnapshotExpandedFromItem(wrapper, event)) {
          return;
        }
        playUiClick();
        toggle();
      });

      wrapper.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (ensureSnapshotExpandedFromItem(wrapper, event)) {
            return;
          }
          playUiClick();
          toggle();
        }
      });
    }

    return wrapper;
  };

  const addItems = (listEl, items, emptyMessage) => {
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "preferences-collection-empty";
      empty.textContent = emptyMessage;
      listEl.appendChild(empty);
      return false;
    }
    items.forEach((item) => {
      listEl.appendChild(createItem(item));
    });
    return true;
  };

  const genreList = createList("Selected genres");
  const genreItems = [];
  const maxGenres = 4;
  selectedGenres.slice(0, maxGenres).forEach((genre) => {
    genreItems.push({
      title: genre.label,
      meta: "Preferred genre",
      icon: getGenreIcon(genre.id, genre.label)
    });
  });
  if (selectedGenres.length > maxGenres) {
    genreItems.push({
      title: `+${selectedGenres.length - maxGenres} more`,
      meta: "Additional genres selected",
      icon: "➕"
    });
  }
  const hasGenreItems = addItems(
    genreList,
    genreItems,
    "Pick genres to tailor the recommendations."
  );
  listsWrap.appendChild(genreList);

  const collectionsList = createList("Collections snapshot");
  const collectionItems = [];

  if (state.favorites.length) {
    const favoritesSnapshot = state.favorites.slice(-5).reverse();
    favoritesSnapshot.forEach((favorite, index) => {
      if (!favorite) {
        return;
      }
      const metaParts = [];
      if (index === 0) {
        metaParts.push(`${state.favorites.length} saved`);
      } else {
        metaParts.push("Saved favorite");
      }
      if (favorite.year) {
        metaParts.push(favorite.year);
      }
      if (Array.isArray(favorite.genres) && favorite.genres.length) {
        metaParts.push(favorite.genres.slice(0, 2).join(" • "));
      }
      if (typeof favorite.rating === "number" && Number.isFinite(favorite.rating)) {
        metaParts.push(`IMDb ${favorite.rating.toFixed(1)}`);
      }

      const detailLines = [];
      if (favorite.overview) {
        detailLines.push(favorite.overview);
      }
      const extraMeta = [];
      if (favorite.year) {
        extraMeta.push(`Year: ${favorite.year}`);
      }
      if (Array.isArray(favorite.genres) && favorite.genres.length) {
        extraMeta.push(`Genres: ${favorite.genres.join(", ")}`);
      }
      if (typeof favorite.rating === "number" && Number.isFinite(favorite.rating)) {
        extraMeta.push(`IMDb ${favorite.rating.toFixed(1)}`);
      }
      if (extraMeta.length) {
        detailLines.push(extraMeta.join(" • "));
      }
      if (index === 0 && state.favorites.length > favoritesSnapshot.length) {
        detailLines.push(`+${state.favorites.length - favoritesSnapshot.length} more favorites tracked`);
      }
      if (!detailLines.length) {
        detailLines.push("Saved to favorites for later.");
      }

      collectionItems.push({
        title: favorite.title ? favorite.title : index === 0 ? "Latest favorite" : "Favorite pick",
        meta: metaParts.join(" • ") || "Favorite pick",
        poster: favorite.poster ? favorite.poster : null,
        icon: "♡",
        details: detailLines,
        extra: index > 0
      });
    });
  }

  if (state.watchedMovies.length) {
    const watchedSnapshot = state.watchedMovies.slice(-5).reverse();
    watchedSnapshot.forEach((movie, index) => {
      if (!movie) {
        return;
      }
      const metaParts = [];
      if (index === 0) {
        metaParts.push(`${state.watchedMovies.length} logged`);
      } else {
        metaParts.push("Watched entry");
      }
      if (typeof movie.rating === "number" && Number.isFinite(movie.rating)) {
        metaParts.push(`IMDb ${movie.rating.toFixed(1)}`);
      }
      if (Array.isArray(movie.genres) && movie.genres.length) {
        metaParts.push(movie.genres.slice(0, 2).join(" • "));
      }

      const detailLines = [];
      const watchedMeta = [];
      if (movie.year) {
        watchedMeta.push(`Year: ${movie.year}`);
      }
      if (Array.isArray(movie.genres) && movie.genres.length) {
        watchedMeta.push(`Genres: ${movie.genres.join(", ")}`);
      }
      if (typeof movie.rating === "number" && Number.isFinite(movie.rating)) {
        watchedMeta.push(`IMDb ${movie.rating.toFixed(1)}`);
      }
      if (watchedMeta.length) {
        detailLines.push(watchedMeta.join(" • "));
      }
      if (index === 0 && state.watchedMovies.length > watchedSnapshot.length) {
        detailLines.push(`+${state.watchedMovies.length - watchedSnapshot.length} more watched titles logged`);
      }
      if (!detailLines.length) {
        detailLines.push("Recently marked as watched.");
      }

      collectionItems.push({
        title: movie.title ? movie.title : index === 0 ? "Latest watched" : "Watched movie",
        meta: metaParts.join(" • ") || "Watched movie",
        poster: movie.poster ? movie.poster : null,
        icon: "👁️",
        details: detailLines,
        extra: index > 0
      });
    });
  }

  const hasCollectionItems = addItems(
    collectionsList,
    collectionItems,
    "Mark favorites or watched movies to build your collections."
  );
  finalizeCollectionsSnapshot(collectionsList);
  listsWrap.appendChild(collectionsList);

  if (hasGenreItems || hasCollectionItems) {
    container.appendChild(listsWrap);
  } else {
    const empty = document.createElement("div");
    empty.className = "preferences-preview-empty";
    empty.textContent =
      "Choose genres or mark movies as favorites/watched and I’ll summarize them here in real time.";
    container.appendChild(empty);
  }
}


async function getRecommendations(isShuffleOnly) {
  if (state.activeRecAbort) {
    state.activeRecAbort.abort();
  }

  const abortController = new AbortController();
  const { signal } = abortController;
  state.activeRecAbort = abortController;
  const requestToken = Symbol("rec");
  state.activeRecToken = requestToken;

  const isStale = () => state.activeRecToken !== requestToken;
  const finalizeRequest = () => {
    if (state.activeRecAbort === abortController) {
      state.activeRecAbort = null;
    }
    if (state.activeRecToken === requestToken) {
      state.activeRecToken = null;
    }
  };

  try {
    const name = getActiveDisplayName();
    const selectedGenres = Array.from(
      document.querySelectorAll('input[name="genre"]:checked')
    ).map((cb) => cb.value);
    const mood = "any";
    const favoriteTitles = state.favorites.map((fav) => fav.title).filter(Boolean);

    updatePreferencesPreview();

    const preferencesSnapshot = {
      name,
      selectedGenres,
      mood,
      moodIntensity: 1,
      favoriteTitles: favoriteTitles.slice(-6),
      watchedSample: state.watchedMovies.slice(-5).map((movie) => movie.title),
      seed: state.lastRecSeed,
      timestamp: new Date().toISOString()
    };
    syncPreferencesSnapshot(preferencesSnapshot);

    setRecError("");
    setRecStatus(
      "Calling TMDB for live discovery…",
      true,
      { step: 1, total: 4, label: "TMDB discovery" }
    );
    resetRecommendationsState();
    showSkeletons();

    const titleEl = $("recTitle");
    if (name) {
      titleEl.textContent = `${name}, here’s what I found`;
    } else {
      titleEl.textContent = "Recommendations";
    }

    const metaEl = $("recMetaPrimary");
    const genreLabel = selectedGenres.length
      ? "inside your selected genres"
      : "across popular genres";
    const watchedLabel = state.watchedMovies.length
      ? "biased by what you’ve watched recently"
      : "with a bias toward well-loved titles";
    const baseMeta = `Curating recommendations ${genreLabel}, blending TMDB discovery with OMDb details and YouTube trailers, ${watchedLabel}.`;
    state.recommendationContext = { baseMeta };
    if (metaEl) {
      metaEl.textContent = `${baseMeta} Gathering fresh matches…`;
    }

    const candidates = await discoverCandidateMovies(
      {
        selectedGenres,
        mood,
        moodIntensity: 1,
        favoriteTitles,
        seed: state.lastRecSeed
      },
      { signal }
    );

    if (isStale() || signal.aborted) {
      return;
    }

    if (!candidates.length) {
      if (isStale() || signal.aborted) {
        return;
      }
      setRecStatus(
        "I couldn’t find anything matching that combo. Try loosening your genre filters a bit.",
        false
      );
      state.recommendations = [];
      state.filteredRecommendations = [];
      state.visibleRecommendations = 0;
      updateRecommendationsView();
      return;
    }

    setRecStatus(
      "Scoring picks against your vibe…",
      true,
      { step: 2, total: 4, label: "Scoring taste" }
    );

    const topCandidates = scoreAndSelectCandidates(
      candidates,
      {
        selectedGenres,
        mood,
        favoriteTitles,
        maxCount: Number.POSITIVE_INFINITY,
        seed: state.lastRecSeed
      },
      state.watchedMovies
    );

    if (isStale() || signal.aborted) {
      return;
    }

    if (!topCandidates.length) {
      if (isStale() || signal.aborted) {
        return;
      }
      setRecStatus(
        "Everything I found is already in your watched list. Try new genres or clear some history.",
        false
      );
      state.recommendations = [];
      state.filteredRecommendations = [];
      state.visibleRecommendations = 0;
      updateRecommendationsView();
      return;
    }

    setRecStatus(
      "Pulling OMDb details and IMDb ratings…",
      true,
      { step: 3, total: 4, label: "OMDb details" }
    );

    const omdbResults = await fetchOmdbForCandidates(topCandidates, { signal });

    if (isStale() || signal.aborted) {
      return;
    }

    const nonNullOmdb = omdbResults.filter((entry) => entry && entry.omdb);

    if (!nonNullOmdb.length) {
      if (isStale() || signal.aborted) {
        return;
      }
      setRecStatus(
        "TMDB found candidates, but OMDb didn’t have details for them. Try again in a bit or tweak your filters.",
        false
      );
      state.recommendations = [];
      state.filteredRecommendations = [];
      state.visibleRecommendations = 0;
      updateRecommendationsView();
      return;
    }

    setRecStatus(
      "Fetching trailers and availability…",
      true,
      { step: 4, total: 4, label: "Trailers" }
    );

    const withTrailers = await fetchTrailersForMovies(nonNullOmdb, { signal });

    if (isStale() || signal.aborted) {
      return;
    }

    const watchedIds = new Set(
      state.watchedMovies
        .map((movie) => (movie && movie.imdbID ? movie.imdbID.toLowerCase() : ""))
        .filter(Boolean)
    );
    const watchedTitles = new Set(
      state.watchedMovies
        .map((movie) => (movie && movie.title ? movie.title.toLowerCase() : ""))
        .filter(Boolean)
    );

    const filteredRecommendations = withTrailers.filter((entry) => {
      if (!entry || !entry.omdb) {
        return true;
      }
      const imdbId = entry.omdb.imdbID ? entry.omdb.imdbID.toLowerCase() : "";
      const titleKey = entry.omdb.Title ? entry.omdb.Title.toLowerCase() : "";
      if (imdbId && watchedIds.has(imdbId)) {
        return false;
      }
      if (titleKey && watchedTitles.has(titleKey)) {
        return false;
      }
      return true;
    });

    if (!filteredRecommendations.length) {
      setRecStatus(
        "Everything I found is already in your watched list. Try new genres or clear some history.",
        false
      );
      state.recommendations = [];
      state.filteredRecommendations = [];
      state.visibleRecommendations = 0;
      updateRecommendationsView();
      finalizeRequest();
      return;
    }

    state.recommendations = filteredRecommendations;
    state.visibleRecommendations = 0;
    state.filteredRecommendations = [];

    setRecStatus(
      "Here’s a curated batch based on your input. Mark anything you’ve already seen – I’ll keep learning.",
      false
    );
    updateFilteredRecommendations({ preserveVisible: false });
  } catch (error) {
    if (signal.aborted || isStale() || isAbortError(error)) {
      return;
    }
    console.error("Recommendation error:", error);
    setRecError(
      "Something went wrong while talking to the APIs. Check your internet connection and API keys, then try again."
    );
    setRecStatus("I hit an error while fetching movies.", false);
    state.recommendations = [];
    state.filteredRecommendations = [];
    state.visibleRecommendations = 0;
    updateRecommendationsView();
  } finally {
    finalizeRequest();
  }
}

function resetRecommendationsState() {
  state.recommendations = [];
  state.filteredRecommendations = [];
  state.visibleRecommendations = 0;
  state.recommendationContext = null;
  const container = $("recommendationsActions");
  const button = $("showMoreRecsBtn");
  if (container) {
    container.style.display = "none";
  }
  if (button) {
    button.style.display = "none";
  }
}

function updateRecommendationsView() {
  const filtered = Array.isArray(state.filteredRecommendations) && state.filteredRecommendations.length
    ? state.filteredRecommendations
    : applyRecommendationFilters(state.recommendations);
  state.filteredRecommendations = filtered;
  const total = filtered.length;
  const fallbackVisible = total ? Math.min(total, RECOMMENDATIONS_PAGE_SIZE) : 0;
  if (!state.visibleRecommendations) {
    state.visibleRecommendations = fallbackVisible;
  }
  if (state.recommendationLayout === "carousel") {
    state.visibleRecommendations = total;
  }
  const visible = total ? Math.min(total, state.visibleRecommendations || fallbackVisible) : 0;
  const items = total ? filtered.slice(0, visible) : [];
  updateRecommendationLayout();
  const presenceSpotlights = buildPresenceSpotlights(3);
  renderRecommendations(items, state.watchedMovies, {
    favorites: state.favorites,
    onMarkWatched: handleMarkWatched,
    onToggleFavorite: handleToggleFavorite,
    community: {
      buildSection: buildCommunitySection
    },
    presenceSpotlights
  });
  updateShowMoreButton();
  updateRecommendationsMeta();
  maybeFocusNotificationTarget();
}

function updateShowMoreButton() {
  const container = $("recommendationsActions");
  const button = $("showMoreRecsBtn");
  if (!container || !button) {
    return;
  }

  if (state.recommendationLayout === "carousel") {
    container.style.display = "none";
    button.style.display = "none";
    return;
  }

  const total = state.filteredRecommendations.length;
  const visible = Math.min(total, state.visibleRecommendations || total);

  if (total > 0 && visible < total) {
    const remaining = total - visible;
    container.style.display = "flex";
    button.style.display = "inline-flex";
    if (remaining === 1) {
      button.textContent = "Show the last movie";
    } else if (remaining <= RECOMMENDATIONS_PAGE_SIZE) {
      button.textContent = `Show remaining ${remaining} movies`;
    } else {
      button.textContent = `Show more (${remaining} more movies)`;
    }
  } else {
    container.style.display = "none";
    button.style.display = "none";
  }
}

function updateRecommendationsMeta() {
  const metaEl = $("recMetaPrimary");
  if (!metaEl) {
    return;
  }

  const context = state.recommendationContext;
  if (!context || !context.baseMeta) {
    return;
  }

  const total = state.recommendations.length;
  const filteredTotal = state.filteredRecommendations.length;
  const visible = filteredTotal ? Math.min(filteredTotal, state.visibleRecommendations || filteredTotal) : 0;

  if (!total) {
    metaEl.textContent = `${context.baseMeta} No matches yet – try adjusting your vibe.`;
    return;
  }

  if (!filteredTotal) {
    metaEl.textContent = `${context.baseMeta} Filters are hiding everything – loosen them or fetch again.`;
    return;
  }

  if (filteredTotal >= total) {
    if (visible >= filteredTotal) {
      metaEl.textContent = `${context.baseMeta} Showing all ${filteredTotal} movies.`;
    } else {
      metaEl.textContent = `${context.baseMeta} Showing ${visible} of ${filteredTotal} movies.`;
    }
  } else {
    metaEl.textContent = `${context.baseMeta} Showing ${visible} of ${filteredTotal} filtered movies (${total} found).`;
  }
}

function revealMoreRecommendations() {
  const total = state.filteredRecommendations.length;
  if (!total) {
    return;
  }
  const nextVisible = Math.min(
    total,
    (state.visibleRecommendations || RECOMMENDATIONS_PAGE_SIZE) + RECOMMENDATIONS_PAGE_SIZE
  );
  if (nextVisible === state.visibleRecommendations || nextVisible === 0) {
    return;
  }
  state.visibleRecommendations = nextVisible;
  updateRecommendationsView();
}

function handleMarkWatched(omdbMovie, tmdbMovie) {
  const added = markAsWatched(omdbMovie);
  if (added) {
    const tmdbId = tmdbMovie && (tmdbMovie.id || tmdbMovie.tmdb_id)
      ? String(tmdbMovie.id || tmdbMovie.tmdb_id)
      : null;
    const title =
      (omdbMovie && omdbMovie.Title) ||
      (tmdbMovie && (tmdbMovie.title || tmdbMovie.original_title)) ||
      "";
    if (tmdbId && title) {
      recordLibraryActivity('watchlist_add', {
        tmdbId,
        imdbId: omdbMovie && omdbMovie.imdbID ? omdbMovie.imdbID : null,
        title
      });
    }
    if (title) {
      showToast({
        title: "Logged as watched",
        text: `${title} added to your history.`,
        icon: "🎞️",
        variant: "success"
      });
    }
  }
  return added;
}


function handleRemoveWatched(movie) {
  if (!movie) {
    return;
  }

  const prevLength = state.watchedMovies.length;
  const next = state.watchedMovies.filter((entry) => {
    if (!entry) {
      return false;
    }
    if (movie.imdbID && entry.imdbID) {
      return entry.imdbID !== movie.imdbID;
    }
    return (entry.title || "").toLowerCase() !== (movie.title || "").toLowerCase();
  });

  if (next.length === prevLength) {
    return;
  }

  state.watchedMovies = next;
  refreshWatchedUi();
  scheduleWatchedSync();
  if (movie.title) {
    showToast({
      title: "Removed from history",
      text: `${movie.title} removed from watched list.`,
      icon: "↩️"
    });
  }
  setRecStatus("Updated your watched list.", false);
}

function handleToggleFavorite(payload) {
  if (!payload) {
    return false;
  }
  const omdbMovie = payload.omdb || null;
  const tmdbMovie = payload.tmdb || null;
  const isFavorite = typeof payload.isFavorite === "boolean" ? payload.isFavorite : null;

  const title =
    (omdbMovie && omdbMovie.Title) ||
    (tmdbMovie && (tmdbMovie.title || tmdbMovie.original_title)) ||
    "";
  if (!title) {
    return Boolean(isFavorite);
  }

  const imdbID = omdbMovie && omdbMovie.imdbID ? omdbMovie.imdbID : null;
  const normalized = title.toLowerCase();
  const existingIndex = state.favorites.findIndex((fav) => {
    if (!fav) {
      return false;
    }
    if (imdbID && fav.imdbID) {
      return fav.imdbID === imdbID;
    }
    return (fav.title || "").toLowerCase() === normalized;
  });

  if (existingIndex !== -1) {
    state.favorites.splice(existingIndex, 1);
    refreshFavoritesUi();
    scheduleFavoritesSync();
    if (title) {
      showToast({
        title: "Removed from favorites",
        text: `${title} removed from your saved list.`,
        icon: "💔"
      });
    }
    return false;
  }

  const posterTmdb =
    tmdbMovie && tmdbMovie.poster_path
      ? `https://image.tmdb.org/t/p/w342${tmdbMovie.poster_path}`
      : null;
  const posterOmdb =
    omdbMovie && omdbMovie.Poster && omdbMovie.Poster !== "N/A"
      ? omdbMovie.Poster
      : null;
  const genres = omdbMovie && omdbMovie.Genre
    ? omdbMovie.Genre.split(",").map((genre) => genre.trim()).filter(Boolean)
    : [];
  const rating =
    omdbMovie && omdbMovie.imdbRating && omdbMovie.imdbRating !== "N/A"
      ? parseFloat(omdbMovie.imdbRating)
      : null;

  state.favorites.push({
    imdbID,
    title,
    year:
      (omdbMovie && omdbMovie.Year) ||
      (tmdbMovie && tmdbMovie.release_date ? tmdbMovie.release_date.slice(0, 4) : ""),
    poster: posterTmdb || posterOmdb || null,
    overview:
      (tmdbMovie && tmdbMovie.overview) ||
      (omdbMovie && omdbMovie.Plot && omdbMovie.Plot !== "N/A" ? omdbMovie.Plot : ""),
    genres,
    rating,
    addedAt: Date.now()
  });

  const tmdbIdValue = tmdbMovie && (tmdbMovie.id || tmdbMovie.tmdb_id)
    ? String(tmdbMovie.id || tmdbMovie.tmdb_id)
    : null;
  if (tmdbIdValue) {
    recordLibraryActivity('favorite_add', {
      tmdbId: tmdbIdValue,
      imdbId: imdbID,
      title
    });
  }

  refreshFavoritesUi();
  scheduleFavoritesSync();
  if (title) {
    showToast({
      title: "Added to favorites",
      text: `${title} pinned to your saved list.`,
      icon: "❤️",
      variant: "success"
    });
  }
  return true;
}

function handleRemoveFavorite(movie) {
  if (!movie) {
    return;
  }

  const prevLength = state.favorites.length;
  const next = state.favorites.filter((entry) => {
    if (!entry) {
      return false;
    }
    if (movie.imdbID && entry.imdbID) {
      return entry.imdbID !== movie.imdbID;
    }
    return (entry.title || "").toLowerCase() !== (movie.title || "").toLowerCase();
  });

  if (next.length === prevLength) {
    return;
  }

  state.favorites = next;
  refreshFavoritesUi();
  scheduleFavoritesSync();
  if (movie.title) {
    showToast({
      title: "Removed from favorites",
      text: `${movie.title} removed from your saved list.`,
      icon: "💔"
    });
  }
}

function markAsWatched(omdbMovie) {
  if (!omdbMovie || !omdbMovie.Title) {
    return false;
  }
  const imdbID = omdbMovie.imdbID || null;
  const title = omdbMovie.Title;

  const already = state.watchedMovies.some((movie) =>
    imdbID ? movie.imdbID === imdbID : movie.title === title
  );
  if (already) {
    return false;
  }

  const genres = omdbMovie.Genre
    ? omdbMovie.Genre.split(",").map((genre) => genre.trim()).filter(Boolean)
    : [];
  const rating =
    omdbMovie.imdbRating && omdbMovie.imdbRating !== "N/A"
      ? parseFloat(omdbMovie.imdbRating)
      : null;
  const poster =
    omdbMovie.Poster && omdbMovie.Poster !== "N/A" ? omdbMovie.Poster : null;

  state.watchedMovies.push({
    imdbID,
    title,
    year: omdbMovie.Year || "",
    genres,
    rating,
    poster,
    loggedAt: Date.now()
  });

  refreshWatchedUi();
  scheduleWatchedSync();
  return true;
}


function switchCollectionView(target) {
  const normalized = target === "watched" ? "watched" : "favorites";
  state.activeCollectionView = normalized;
  updateCollectionVisibility();
}

function updateCollectionVisibility() {
  const favoritesSummary = $("favoritesSummary");
  const watchedSummary = $("watchedSummary");
  const favoritesView = $("favoritesView");
  const watchedView = $("watchedView");
  const clearWatchedBtn = $("clearWatchedBtn");

  if (favoritesSummary) {
    favoritesSummary.style.display =
      state.activeCollectionView === "favorites" ? "block" : "none";
  }
  if (watchedSummary) {
    watchedSummary.style.display =
      state.activeCollectionView === "watched" ? "block" : "none";
  }
  if (favoritesView) {
    favoritesView.classList.toggle("active", state.activeCollectionView === "favorites");
  }
  if (watchedView) {
    watchedView.classList.toggle("active", state.activeCollectionView === "watched");
  }
  document.querySelectorAll(".collection-tab").forEach((tab) => {
    const target = tab.getAttribute("data-target");
    tab.classList.toggle("active", target === state.activeCollectionView);
  });
  if (clearWatchedBtn) {
    clearWatchedBtn.style.display = state.activeCollectionView === "watched" ? "inline-flex" : "none";
  }
}

function updateAccountUi(session) {
  const greeting = $("accountGreeting");
  const loginLink = $("accountLoginLink");
  const accountProfile = $("accountProfile");
  const accountName = $("accountName");
  const accountPillSync = $("accountPillSync");
  const accountAvatar = document.getElementById("accountAvatar");
  const accountAvatarImg = $("accountAvatarImg");
  const accountAvatarInitials = $("accountAvatarInitials");
  const accountMenu = $("accountMenu");
  const accountBar = document.querySelector(".account-bar");
  const activePage = document.body ? document.body.getAttribute("data-page") : null;

  if (!greeting || !loginLink || !accountProfile || !accountName || !accountPillSync || !accountAvatar || !accountAvatarImg || !accountAvatarInitials) {
    return;
  }

  const defaultAvatarInitials =
    accountAvatarInitials.dataset.defaultInitials || accountAvatarInitials.textContent || "GM";
  accountAvatarInitials.dataset.defaultInitials = defaultAvatarInitials;

  const defaultPillText =
    accountPillSync.dataset.defaultText || accountPillSync.textContent || "Cloud sync inactive";
  accountPillSync.dataset.defaultText = defaultPillText;

  const defaultAccountName =
    accountName.dataset.defaultName || accountName.textContent || "Guest";
  accountName.dataset.defaultName = defaultAccountName;

  if (accountMenu) {
    const profileItem = accountMenu.querySelector('[data-action="profile"]');
    if (profileItem) {
      if (activePage === "profile-overview") {
        profileItem.setAttribute("aria-current", "page");
      } else {
        profileItem.removeAttribute("aria-current");
      }
    }
    const settingsItem = accountMenu.querySelector('[data-action="settings"]');
    if (settingsItem) {
      if (isAccountSettingsContext()) {
        settingsItem.setAttribute("aria-current", "page");
      } else {
        settingsItem.removeAttribute("aria-current");
      }
    }
  }

  const isSignedIn = Boolean(session && session.token);
  let displayName = "";
  if (accountBar) {
    accountBar.dataset.accountState = isSignedIn ? "signed-in" : "guest";
  }

  if (isSignedIn) {
    const rawDisplayName =
      typeof session.displayName === "string" ? session.displayName.trim() : "";
    const fallbackUsername =
      typeof session.username === "string" ? session.username.trim() : "";
    displayName = rawDisplayName || fallbackUsername || "Member";
  }

  if (isSignedIn) {
    greeting.textContent = `Welcome back, ${displayName}!`;
    greeting.classList.add("account-greeting-auth");
    loginLink.style.display = "none";
    loginLink.hidden = true;
    loginLink.setAttribute("aria-hidden", "true");
    accountProfile.hidden = false;
    accountProfile.setAttribute("aria-hidden", "false");
    accountName.textContent = displayName;
    const mostRecent = getMostRecentSync(session);
    accountPillSync.textContent = mostRecent
      ? `Last sync ${formatSyncTime(mostRecent.toISOString())}`
      : "Sync pending";
    const initials = displayName
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "SM";
    accountAvatarInitials.textContent = initials;
    const avatarUrl = session.avatarUrl || null;
    if (avatarUrl) {
      accountAvatarImg.src = avatarUrl;
      accountAvatarImg.alt = `${displayName} avatar`;
      accountAvatar.classList.add("has-image");
    } else {
      accountAvatarImg.removeAttribute("src");
      accountAvatarImg.alt = "";
      accountAvatar.classList.remove("has-image");
    }
  } else {
    closeAccountMenu();
    greeting.textContent = "You’re browsing as guest.";
    greeting.classList.remove("account-greeting-auth");
    loginLink.style.display = "inline-flex";
    loginLink.hidden = false;
    loginLink.setAttribute("aria-hidden", "false");
    accountProfile.hidden = true;
    accountProfile.setAttribute("aria-hidden", "true");
    accountName.textContent = defaultAccountName;
    accountPillSync.textContent = defaultPillText;
    accountAvatarInitials.textContent = defaultAvatarInitials;
    accountAvatarImg.removeAttribute("src");
    accountAvatarImg.alt = "";
    accountAvatar.classList.remove("has-image");
  }

  const settingsContent = $("accountSettingsContent");
  const settingsSignedOut = $("accountSettingsSignedOut");
  if (settingsContent && settingsSignedOut) {
    settingsContent.hidden = !isSignedIn;
    settingsContent.setAttribute("aria-hidden", isSignedIn ? "false" : "true");
    settingsSignedOut.hidden = isSignedIn;
    settingsSignedOut.setAttribute("aria-hidden", isSignedIn ? "true" : "false");
  }

}

function setSyncStatus(message, variant = "muted") {
  const el = $("syncStatus");
  if (el) {
    el.textContent = message;
    el.dataset.variant = variant;
  }
}

function wireSocialFirstRunCta() {
  if (socialFirstRunCtaWired) {
    return;
  }
  const button = $("socialFirstRunCta");
  if (!button) {
    return;
  }
  socialFirstRunCtaWired = true;
  button.addEventListener("click", () => {
    playUiClick();
    openProfileDeepLink("social");
  });
}

function updateSocialFirstRunCard(counts = {}) {
  const panel = $("socialFirstRunPanel");
  const card = $("socialFirstRunCard");
  if (!panel || !card) {
    return;
  }
  const followingValue = Number.isFinite(counts.following) ? counts.following : 0;
  const followersValue = Number.isFinite(counts.followers) ? counts.followers : 0;
  const mutualValue = Number.isFinite(counts.mutual) ? counts.mutual : 0;
  const totalConnections = followingValue + followersValue + mutualValue;
  const shouldShow = totalConnections === 0;
  panel.hidden = !shouldShow;
  panel.setAttribute("aria-hidden", shouldShow ? "false" : "true");
  if (!shouldShow) {
    return;
  }
  const messageEl = $("socialFirstRunMessage");
  const followingEl = $("socialNudgeFollowing");
  const followersEl = $("socialNudgeFollowers");
  const mutualEl = $("socialNudgeMutual");
  const hasSession = Boolean(state.session && state.session.token);
  if (messageEl) {
    messageEl.textContent = hasSession
      ? "Follow friends to see which picks they loved (or hated)."
      : "Sign in and follow friends to see which picks they loved (or hated).";
  }
  if (followingEl) {
    followingEl.textContent = followingValue.toLocaleString();
  }
  if (followersEl) {
    followersEl.textContent = followersValue.toLocaleString();
  }
  if (mutualEl) {
    mutualEl.textContent = mutualValue.toLocaleString();
  }
  wireSocialFirstRunCta();
}

function setupSocialFeatures() {
  initSocialFeatures();
  initSocialProfileOverlay();
  wireSocialFirstRunCta();
  if (!unsubscribeProfileOpen) {
    unsubscribeProfileOpen = subscribeToProfileOpens((username) => {
      openSocialProfile(username);
    });
  }
  if (unsubscribeFollowing) {
    unsubscribeFollowing();
  }
  unsubscribeFollowing = subscribeToFollowing((list) => {
    state.followingUsers = Array.isArray(list) ? list.slice() : [];
    renderSocialConnections();
  });
  state.followingUsers = getFollowingSnapshot();
  if (unsubscribeSocialOverview) {
    unsubscribeSocialOverview();
  }
  unsubscribeSocialOverview = subscribeToSocialOverview((overview) => {
    state.socialOverview = overview;
    renderSocialConnections();
  });
  state.socialOverview = getSocialOverviewSnapshot();
  if (unsubscribeCollaborative) {
    unsubscribeCollaborative();
  }
  unsubscribeCollaborative = subscribeToCollaborativeState((collabState) => {
    state.collaborativeState = collabState;
    renderSocialConnections();
    // Keep the friends activity tiles in sync with collaborative list updates.
    // Otherwise, the "New lists" column stays empty until a notification event
    // happens to trigger a manual refresh.
    renderFriendsActivityFeed();
  });
  state.collaborativeState = getCollaborativeStateSnapshot();
  renderSocialConnections();
  wirePresenceStatusControls();
  wireFollowForm();
  wireCollaborativeForms();
  if (unsubscribeNotifications) {
    unsubscribeNotifications();
  }
  unsubscribeNotifications = subscribeToNotifications((payload) => {
    renderNotificationCenter(payload);
  });
  renderFriendsActivityFeed();
}

function wirePresenceStatusControls() {
  const container = $("socialStatusPresets");
  const listEl = $("socialStatusPresetList");
  if (!container || !listEl) {
    return;
  }

  presenceStatusButtons.clear();
  listEl.innerHTML = "";
  PRESENCE_STATUS_PRESETS.forEach((preset) => {
    const button = createPresenceStatusButton(preset);
    presenceStatusButtons.set(preset.key, button);
    listEl.appendChild(button);
  });

  if (unsubscribePresenceStatus) {
    unsubscribePresenceStatus();
  }
  unsubscribePresenceStatus = subscribeToPresenceStatusPreset((presetKey) => {
    applyPresenceStatusUi(presetKey, { silent: true, source: 'subscription' });
  });

  const durationSelect = $("socialStatusDuration");
  if (durationSelect) {
    const storedDuration =
      typeof state.presenceStatusDuration === 'number'
        ? state.presenceStatusDuration
        : getStoredPresenceStatusDuration();
    durationSelect.value = String(storedDuration || 0);
    durationSelect.addEventListener('change', () => {
      const minutes = Math.max(0, parseInt(durationSelect.value, 10) || 0);
      state.presenceStatusDuration = minutes;
      persistPresenceStatusDuration(minutes);
      if (state.presenceStatusPreset !== 'default') {
        if (minutes > 0) {
          updatePresenceExpiryForPreset(state.presenceStatusPreset, { force: true });
        } else {
          clearPresenceStatusExpiry();
        }
      }
    });
  }

  const storedPreset = getStoredPresenceStatusPreset();
  const currentPreset = normalizePresenceStatusKey(getPresenceStatusPreset());

  if (state.session && state.session.token) {
    if (storedPreset !== currentPreset) {
      setPresenceStatusPreset(storedPreset, { silent: true })
        .then((normalized) => {
          persistPresenceStatusPreset(normalized);
        })
        .catch((error) => {
          console.warn('Failed to sync presence status preset', error);
        });
    } else {
      applyPresenceStatusUi(currentPreset, { silent: true, source: 'hydrate' });
    }
  } else {
    applyPresenceStatusUi(storedPreset, { silent: true, source: 'hydrate' });
    setPresenceStatusPreset(storedPreset, { sync: false, silent: true }).catch(() => {});
  }

  updatePresenceStatusAvailability(state.session);
  hydratePresenceExpiryState();
}

function createPresenceStatusButton(preset) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'social-status-btn';
  button.dataset.status = preset.key;
  button.setAttribute('aria-pressed', 'false');
  const icon = document.createElement('span');
  icon.className = 'social-status-icon';
  icon.textContent = preset.icon;
  const text = document.createElement('span');
  text.className = 'social-status-text';
  const label = document.createElement('span');
  label.className = 'social-status-label';
  label.textContent = preset.label;
  const description = document.createElement('span');
  description.className = 'social-status-desc';
  description.textContent = preset.description;
  text.appendChild(label);
  text.appendChild(description);
  button.appendChild(icon);
  button.appendChild(text);
  button.addEventListener('click', () => handlePresenceStatusClick(preset.key));
  return button;
}

function applyPresenceStatusUi(presetKey, options = {}) {
  const normalized = normalizePresenceStatusKey(presetKey);
  state.presenceStatusPreset = normalized;
  setPresenceStatusButtonsActive(normalized);
  syncPresenceExpiryState(normalized, options);
  if (!options.silent) {
    const preset = PRESENCE_STATUS_PRESET_MAP.get(normalized) || PRESENCE_STATUS_PRESET_MAP.get('default');
    if (preset) {
      const message =
        normalized === 'default'
          ? 'Status cleared. You’ll appear just browsing.'
          : `${preset.label} is live for friends.`;
      setPresenceStatusFeedback(message, 'success');
    }
  }
  return normalized;
}

function setPresenceStatusButtonsActive(activeKey) {
  presenceStatusButtons.forEach((button, key) => {
    const isActive = key === activeKey;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

async function handlePresenceStatusClick(presetKey) {
  const normalized = normalizePresenceStatusKey(presetKey);
  const preset = PRESENCE_STATUS_PRESET_MAP.get(normalized) || PRESENCE_STATUS_PRESET_MAP.get('default');
  if (!state.session || !state.session.token) {
    setPresenceStatusFeedback('Sign in to share a status with friends.', 'muted');
    return;
  }
  if (normalized === state.presenceStatusPreset) {
    if (preset && normalized !== 'default') {
      setPresenceStatusFeedback(`${preset.label} is already active.`, 'muted');
    }
    return;
  }
  setPresenceStatusFeedback('Updating status…', 'loading');
  try {
    const applied = await setPresenceStatusPreset(normalized);
    persistPresenceStatusPreset(applied);
    updatePresenceExpiryForPreset(applied);
    const successMessage =
      applied === 'default'
        ? 'Status cleared. You’ll appear just browsing.'
        : `${preset?.label || 'Status'} is live for friends.`;
    setPresenceStatusFeedback(successMessage, 'success');
  } catch (error) {
    const message = error && error.message ? String(error.message) : 'Unable to update your status right now.';
    setPresenceStatusFeedback(message, 'error');
  }
}

function setPresenceStatusFeedback(message, variant) {
  if (presenceStatusFeedbackTimer) {
    window.clearTimeout(presenceStatusFeedbackTimer);
    presenceStatusFeedbackTimer = null;
  }
  const feedbackEl = $("socialStatusFeedback");
  if (!feedbackEl) {
    return;
  }
  if (!message) {
    feedbackEl.textContent = '';
    feedbackEl.hidden = true;
    feedbackEl.removeAttribute('data-variant');
    return;
  }
  feedbackEl.textContent = message;
  feedbackEl.hidden = false;
  if (variant) {
    feedbackEl.dataset.variant = variant;
  } else {
    feedbackEl.removeAttribute('data-variant');
  }
  const persistentVariants = new Set(['loading', 'muted']);
  if (!persistentVariants.has(variant)) {
    presenceStatusFeedbackTimer = window.setTimeout(() => {
      feedbackEl.textContent = '';
      feedbackEl.hidden = true;
      feedbackEl.removeAttribute('data-variant');
      presenceStatusFeedbackTimer = null;
    }, 5000);
  }
}

function normalizePresenceStatusKey(value) {
  if (typeof value !== 'string') {
    return 'default';
  }
  const trimmed = value.trim().toLowerCase();
  return PRESENCE_STATUS_PRESET_MAP.has(trimmed) ? trimmed : 'default';
}

function getStoredPresenceStatusPreset() {
  try {
    const stored = window.localStorage.getItem(PRESENCE_STATUS_STORAGE_KEY);
    return normalizePresenceStatusKey(stored || 'default');
  } catch (error) {
    console.warn('Unable to read presence status preference', error);
    return 'default';
  }
}

function persistPresenceStatusPreset(value) {
  const normalized = normalizePresenceStatusKey(value);
  try {
    if (normalized === 'default') {
      window.localStorage.removeItem(PRESENCE_STATUS_STORAGE_KEY);
    } else {
      window.localStorage.setItem(PRESENCE_STATUS_STORAGE_KEY, normalized);
    }
  } catch (error) {
    console.warn('Unable to store presence status preference', error);
  }
  return normalized;
}

function getStoredPresenceStatusDuration() {
  try {
    const stored = window.localStorage.getItem(PRESENCE_DURATION_STORAGE_KEY);
    const minutes = parseInt(stored || '0', 10);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return 0;
    }
    return minutes;
  } catch (error) {
    console.warn('Unable to read presence status duration', error);
    return 0;
  }
}

function persistPresenceStatusDuration(value) {
  const minutes = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  try {
    if (!minutes) {
      window.localStorage.removeItem(PRESENCE_DURATION_STORAGE_KEY);
    } else {
      window.localStorage.setItem(PRESENCE_DURATION_STORAGE_KEY, String(minutes));
    }
  } catch (error) {
    console.warn('Unable to store presence status duration', error);
  }
  return minutes;
}

function getStoredPresenceStatusExpiry() {
  try {
    const stored = window.localStorage.getItem(PRESENCE_EXPIRY_STORAGE_KEY);
    if (!stored) {
      return 0;
    }
    const timestamp = parseInt(stored, 10);
    return Number.isFinite(timestamp) ? timestamp : 0;
  } catch (error) {
    console.warn('Unable to read presence status expiry', error);
    return 0;
  }
}

function persistPresenceStatusExpiry(timestamp) {
  const normalized = Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp) : 0;
  try {
    if (!normalized) {
      window.localStorage.removeItem(PRESENCE_EXPIRY_STORAGE_KEY);
    } else {
      window.localStorage.setItem(PRESENCE_EXPIRY_STORAGE_KEY, String(normalized));
    }
  } catch (error) {
    console.warn('Unable to store presence status expiry', error);
  }
  return normalized;
}

function clearPresenceStatusExpiry() {
  if (presenceStatusExpiryTimer) {
    window.clearTimeout(presenceStatusExpiryTimer);
    presenceStatusExpiryTimer = null;
  }
  persistPresenceStatusExpiry(0);
}

function schedulePresenceExpiry(timestamp) {
  if (presenceStatusExpiryTimer) {
    window.clearTimeout(presenceStatusExpiryTimer);
    presenceStatusExpiryTimer = null;
  }
  if (!timestamp) {
    clearPresenceStatusExpiry();
    return;
  }
  const delay = Math.max(0, timestamp - Date.now());
  if (delay <= 0) {
    handlePresenceStatusExpiry();
    return;
  }
  persistPresenceStatusExpiry(timestamp);
  presenceStatusExpiryTimer = window.setTimeout(() => {
    presenceStatusExpiryTimer = null;
    handlePresenceStatusExpiry();
  }, delay);
}

function hydratePresenceExpiryState() {
  const expiresAt = getStoredPresenceStatusExpiry();
  if (!expiresAt) {
    return;
  }
  if (expiresAt <= Date.now()) {
    handlePresenceStatusExpiry();
    return;
  }
  schedulePresenceExpiry(expiresAt);
}

async function handlePresenceStatusExpiry() {
  clearPresenceStatusExpiry();
  if (state.presenceStatusPreset === 'default') {
    return;
  }
  try {
    await setPresenceStatusPreset('default');
    persistPresenceStatusPreset('default');
    setPresenceStatusFeedback('Status expired. You’re back to “Just browsing”.', 'muted');
    showToast({
      title: 'Status reset',
      text: 'Your status expired, so you’re back to “Just browsing”.',
      icon: '⏱️'
    });
  } catch (error) {
    const message = error && error.message ? String(error.message) : 'Status expired, but we could not reset it.';
    setPresenceStatusFeedback(message, 'error');
  }
}

function syncPresenceExpiryState(presetKey, options = {}) {
  if (presetKey === 'default') {
    clearPresenceStatusExpiry();
    return;
  }
  const source = options.source || '';
  if (source === 'subscription' || source === 'remote' || source === 'hydrate') {
    const expiresAt = getStoredPresenceStatusExpiry();
    if (expiresAt) {
      schedulePresenceExpiry(expiresAt);
    }
    return;
  }
  updatePresenceExpiryForPreset(presetKey);
}

function updatePresenceExpiryForPreset(presetKey, { force = false } = {}) {
  if (presetKey === 'default') {
    clearPresenceStatusExpiry();
    return;
  }
  const duration =
    typeof state.presenceStatusDuration === 'number'
      ? state.presenceStatusDuration
      : getStoredPresenceStatusDuration();
  if (!duration || duration <= 0) {
    if (force) {
      clearPresenceStatusExpiry();
    }
    return;
  }
  const expiresAt = Date.now() + duration * 60000;
  schedulePresenceExpiry(expiresAt);
}

function updatePresenceStatusAvailability(session) {
  const hasSession = Boolean(session && session.token);
  presenceStatusButtons.forEach((button) => {
    button.disabled = !hasSession;
    if (hasSession) {
      button.setAttribute('aria-disabled', 'false');
    } else {
      button.setAttribute('aria-disabled', 'true');
    }
  });
  const container = $("socialStatusPresets");
  if (container) {
    container.dataset.state = hasSession ? 'ready' : 'signin';
  }
  if (hasSession) {
    setPresenceStatusFeedback('', null);
  } else {
    setPresenceStatusFeedback('Sign in to share a status with friends.', 'muted');
  }
}

function getPresenceEntryStatusKey(entry) {
  if (!entry || !entry.presence) {
    return 'default';
  }
  const raw = typeof entry.presence.statusPreset === 'string' ? entry.presence.statusPreset : 'default';
  return normalizePresenceStatusKey(raw);
}

function buildPresenceHighlightSentence(entry) {
  if (!entry || !entry.presence) {
    return 'is online now.';
  }
  if (entry.presence.state === 'watching' && entry.presence.movieTitle) {
    return `is watching ${entry.presence.movieTitle}.`;
  }
  if (entry.presence.state === 'away') {
    return 'stepped away for a moment.';
  }
  const preset = PRESENCE_STATUS_PRESET_MAP.get(getPresenceEntryStatusKey(entry));
  if (preset && preset.key !== 'default') {
    return preset.highlight || `${preset.label} right now.`;
  }
  return 'is online now.';
}

function formatPresenceListStatus(entry) {
  if (!entry || !entry.presence) {
    return 'Online';
  }
  if (entry.presence.state === 'watching' && entry.presence.movieTitle) {
    return `Watching ${entry.presence.movieTitle}`;
  }
  if (entry.presence.state === 'away') {
    return 'Away';
  }
  const preset = PRESENCE_STATUS_PRESET_MAP.get(getPresenceEntryStatusKey(entry));
  if (preset && preset.key !== 'default') {
    const label = preset.shortLabel || preset.label;
    return preset.icon ? `${preset.icon} ${label}` : label;
  }
  return 'Online';
}

function formatPresenceChipSummary(entry) {
  if (!entry || !entry.presence) {
    return 'Online now';
  }
  if (entry.presence.state === 'watching' && entry.presence.movieTitle) {
    return `Watching ${entry.presence.movieTitle}`;
  }
  if (entry.presence.state === 'away') {
    return 'Away for now';
  }
  const preset = PRESENCE_STATUS_PRESET_MAP.get(getPresenceEntryStatusKey(entry));
  if (preset && preset.key !== 'default') {
    return preset.shortLabel || preset.label;
  }
  return 'Online now';
}

function wireFollowForm() {
  const form = $("socialFollowForm");
  const input = $("socialFollowUsername");
  const submitBtn = $("socialFollowSubmit");
  const statusEl = $("socialFollowStatus");
  const searchPanel = $("socialFollowSearchPanel");
  const searchList = $("socialFollowSearchList");
  const searchStatus = $("socialFollowSearchStatus");
  const searchEmpty = $("socialFollowSearchEmpty");
  const inviteCopyBtn = $("socialInviteCopyBtn");
  const inviteStatus = $("socialInviteStatus");
  const noteInput = $("socialFollowNote");
  const noteHint = $("socialFollowNoteHint");
  const noteTemplateBtn = $("socialFollowNoteTemplate");
  const inviteQrDownload = $("socialInviteQrDownload");
  const importFile = $("socialInviteImportFile");
  const importConsent = $("socialInviteImportConsent");
  const importBtn = $("socialInviteImportBtn");
  const importStatus = $("socialInviteImportStatus");
  if (!form || !input || !submitBtn || !statusEl) {
    return;
  }

  const SEARCH_MIN_CHARS = 2;
  let searchTimer = null;
  let searchRequestId = 0;
  let lastQuery = "";

  const updateNoteHint = () => {
    if (!noteHint || !noteInput) {
      return;
    }
    const length = noteInput.value.trim().length;
    if (length) {
      const remaining = Math.max(0, MAX_FOLLOW_NOTE_LENGTH - length);
      noteHint.textContent = `${remaining} characters left for your note.`;
    } else {
      noteHint.textContent = "We’ll include this note in follow requests (optional).";
    }
  };

  const applyNoteValue = (value) => {
    if (noteInput) {
      noteInput.value = setFollowNoteValue(value);
      updateNoteHint();
    } else {
      setFollowNoteValue(value);
    }
  };

  if (noteInput) {
    noteInput.maxLength = MAX_FOLLOW_NOTE_LENGTH;
    noteInput.addEventListener("input", () => {
      applyNoteValue(noteInput.value);
    });
    applyNoteValue(noteInput.value || state.followNote || "");
  } else {
    setFollowNoteValue(state.followNote || "");
  }

  if (noteTemplateBtn) {
    noteTemplateBtn.addEventListener("click", () => {
      applyNoteValue(buildFollowNoteTemplate());
      if (noteInput) {
        noteInput.focus();
      }
    });
  }

  if (inviteQrDownload) {
    inviteQrDownload.addEventListener("click", () => {
      if (!state.inviteQr || !state.inviteQr.dataUrl) {
        return;
      }
      playUiClick();
      downloadInviteQr();
    });
  }

  const updateImportControls = () => {
    if (!importBtn) {
      return;
    }
    const hasFile = Boolean(importFile && importFile.files && importFile.files.length);
    const consentGiven = importConsent ? importConsent.checked : false;
    importBtn.disabled = !(hasFile && consentGiven);
  };

  if (importConsent) {
    importConsent.addEventListener("change", () => {
      updateImportControls();
    });
  }

  if (importFile) {
    importFile.addEventListener("change", () => {
      updateImportControls();
      if (importStatus) {
        importStatus.textContent = "";
        importStatus.removeAttribute("data-variant");
      }
    });
  }

  if (importBtn) {
    importBtn.disabled = true;
    importBtn.addEventListener("click", async () => {
      if (!state.session || !state.session.token) {
        window.location.href = "login.html";
        return;
      }
      if (!importConsent || !importConsent.checked) {
        if (importStatus) {
          importStatus.textContent = "Confirm you have permission to invite these contacts.";
          importStatus.dataset.variant = "error";
        }
        return;
      }
      if (!importFile || !importFile.files || !importFile.files.length) {
        if (importStatus) {
          importStatus.textContent = "Choose a CSV file first.";
          importStatus.dataset.variant = "error";
        }
        return;
      }
      playUiClick();
      const file = importFile.files[0];
      importBtn.disabled = true;
      if (importStatus) {
        importStatus.textContent = "Reading contacts…";
        importStatus.dataset.variant = "loading";
      }
      let text = "";
      try {
        text = await file.text();
      } catch (error) {
        if (importStatus) {
          importStatus.textContent = "Couldn't read that file.";
          importStatus.dataset.variant = "error";
        }
        updateImportControls();
        return;
      }
      const handles = extractHandlesFromCsv(text).slice(0, 25);
      if (!handles.length) {
        if (importStatus) {
          importStatus.textContent = "No usernames found in that CSV.";
          importStatus.dataset.variant = "error";
        }
        updateImportControls();
        return;
      }
      let success = 0;
      const failures = [];
      if (importStatus) {
        importStatus.textContent = `Sending ${handles.length} follow request${handles.length === 1 ? "" : "s"}…`;
        importStatus.dataset.variant = "loading";
      }
      for (const handle of handles) {
        try {
          await followUserByUsername(handle, {
            note: getFollowNoteValue() || buildFollowNoteTemplate()
          });
          success += 1;
        } catch (error) {
          failures.push(handle);
        }
      }
      if (importStatus) {
        if (success) {
          const skipped = failures.length ? ` (${failures.length} skipped)` : "";
          importStatus.textContent = `Invited ${success} friend${success === 1 ? "" : "s"}${skipped}.`;
          importStatus.dataset.variant = failures.length ? "warning" : "success";
        } else {
          importStatus.textContent = "We couldn't send any invites from that file.";
          importStatus.dataset.variant = "error";
        }
      }
      updateImportControls();
    });
  }

  prefillFollowFromQuery();
  updateSocialInviteLink();
  resetSearchPanel();
  updateImportControls();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.session || !state.session.token) {
      window.location.href = "login.html";
      return;
    }

    const username = input.value.trim();
    if (username.length < 3) {
      setSocialStatus("Enter at least 3 characters to follow someone.", "error");
      input.focus();
      return;
    }

    submitBtn.disabled = true;
    setSocialStatus(`Following @${username.toLowerCase()}…`, "loading");

    try {
      await followUserByUsername(username, { note: getFollowNoteValue() });
      setSocialStatus(`Now following @${username.toLowerCase()}.`, "success");
      input.value = "";
      clearSearchResults({ hidePanel: true });
    } catch (error) {
      setSocialStatus(
        error instanceof Error ? error.message : "Couldn’t follow that user right now.",
        "error"
      );
    } finally {
      submitBtn.disabled = false;
    }
  });

  input.addEventListener("input", () => {
    if (!state.session || !state.session.token) {
      clearSearchResults({ hidePanel: true });
      return;
    }
    const value = input.value.trim();
    if (searchTimer) {
      window.clearTimeout(searchTimer);
      searchTimer = null;
    }
    if (value.length < SEARCH_MIN_CHARS) {
      lastQuery = "";
      resetSearchPanel();
      return;
    }
    searchTimer = window.setTimeout(() => {
      runSearch(value);
    }, 220);
  });

  input.addEventListener("focus", () => {
    if (!state.session || !state.session.token) {
      return;
    }
    const value = input.value.trim();
    if (value.length >= SEARCH_MIN_CHARS) {
      runSearch(value);
    }
  });

  document.addEventListener("click", (event) => {
    if (!searchPanel || searchPanel.hidden) {
      return;
    }
    const target = event.target;
    if (!target) {
      return;
    }
    if (
      target === input ||
      searchPanel.contains(target) ||
      (typeof target.closest === "function" && target.closest(".social-follow-search-item"))
    ) {
      return;
    }
    clearSearchResults({ hidePanel: true });
  });

  if (inviteCopyBtn && inviteStatus) {
    inviteCopyBtn.addEventListener("click", async () => {
      if (!state.session || !state.session.token) {
        window.location.href = "login.html";
        return;
      }
      const inviteLinkEl = $("socialInviteLink");
      if (!inviteLinkEl || !inviteLinkEl.value.trim()) {
        setInviteStatus("Generate your invite link first.", "error");
        return;
      }
      const linkValue = inviteLinkEl.value.trim();
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          await navigator.clipboard.writeText(linkValue);
        } else {
          inviteLinkEl.focus();
          inviteLinkEl.select();
          document.execCommand("copy");
          inviteLinkEl.setSelectionRange(inviteLinkEl.value.length, inviteLinkEl.value.length);
        }
        setInviteStatus("Link copied!", "success");
      } catch (error) {
        setInviteStatus(
          error instanceof Error ? error.message : "Couldn’t copy that link. Try manually instead.",
          "error"
        );
      }
    });
  }

  function runSearch(query) {
    if (!state.session || !state.session.token) {
      return;
    }
    const trimmed = query.trim();
    if (trimmed.length < SEARCH_MIN_CHARS) {
      resetSearchPanel();
      return;
    }
    lastQuery = trimmed;
    const currentRequest = ++searchRequestId;
    setSearchState("loading", `Searching for “${trimmed}”…`);
    searchSocialUsers(trimmed)
      .then((results) => {
        if (currentRequest !== searchRequestId) {
          return;
        }
        if (!Array.isArray(results) || !results.length) {
          setSearchState(
            "empty",
            `No members matched “${trimmed}” yet. Try a different name or handle.`
          );
          return;
        }
        renderSearchResults(results);
      })
      .catch((error) => {
        if (currentRequest !== searchRequestId) {
          return;
        }
        const message =
          error instanceof Error
            ? error.message
            : "We couldn’t search right now. Try again.";
        setSearchState("error", message);
      });
  }

  function renderSearchResults(results) {
    if (!searchPanel || !searchList) {
      return;
    }
    searchList.innerHTML = "";
    results.forEach((result) => {
      if (!result || !result.username) {
        return;
      }
      const item = document.createElement("li");
      item.className = "social-follow-search-item";
      item.role = "option";

      const infoButton = document.createElement("div");
      infoButton.className = "social-follow-search-info";
      infoButton.setAttribute("role", "button");
      infoButton.tabIndex = 0;
      const handleSelect = () => {
        input.value = result.username;
        input.focus();
        setSearchState(
          "hint",
          `Press Follow to add @${result.username.toLowerCase()} or keep browsing results.`
        );
      };
      infoButton.addEventListener("click", () => {
        handleSelect();
      });
      infoButton.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleSelect();
        }
      });

      const profileTrigger = createProfileButton(result.username, {
        className: "social-profile-trigger",
        ariaLabel: `View profile for ${
          result.displayName || formatSocialDisplayName(result.username)
        }`,
        stopPropagation: true
      });
      if (profileTrigger) {
        const name = document.createElement("span");
        name.className = "social-follow-name";
        name.textContent = result.displayName || formatSocialDisplayName(result.username);
        const handle = document.createElement("span");
        handle.className = "social-follow-handle";
        handle.textContent = `@${result.username}`;
        profileTrigger.appendChild(name);
        profileTrigger.appendChild(handle);
        infoButton.appendChild(profileTrigger);
      } else {
        const name = document.createElement("span");
        name.className = "social-follow-name";
        name.textContent = result.displayName || formatSocialDisplayName(result.username);
        const handle = document.createElement("span");
        handle.className = "social-follow-handle";
        handle.textContent = `@${result.username}`;
        infoButton.appendChild(name);
        infoButton.appendChild(handle);
      }

      if (result.reason) {
        const reason = document.createElement("span");
        reason.className = "social-follow-search-reason";
        reason.textContent = result.reason;
        infoButton.appendChild(reason);
      }

      if (Array.isArray(result.sharedInterests) && result.sharedInterests.length) {
        const tags = document.createElement("div");
        tags.className = "social-follow-search-tags";
        result.sharedInterests.slice(0, 2).forEach((interest) => {
          const tag = document.createElement("span");
          tag.className = "social-suggestion-tag";
          tag.dataset.variant = "interest";
          tag.textContent = interest;
          tags.appendChild(tag);
        });
        infoButton.appendChild(tags);
      }

      if (Array.isArray(result.sharedFavorites) && result.sharedFavorites.length) {
        const favs = document.createElement("div");
        favs.className = "social-follow-search-tags";
        result.sharedFavorites.slice(0, 2).forEach((favorite) => {
          const tag = document.createElement("span");
          tag.className = "social-suggestion-tag";
          tag.dataset.variant = "favorite";
          tag.textContent = favorite;
          favs.appendChild(tag);
        });
        infoButton.appendChild(favs);
      }

      if (Array.isArray(result.sharedWatchHistory) && result.sharedWatchHistory.length) {
        const watched = document.createElement("div");
        watched.className = "social-follow-search-tags";
        result.sharedWatchHistory.slice(0, 2).forEach((title) => {
          const tag = document.createElement("span");
          tag.className = "social-suggestion-tag";
          tag.dataset.variant = "watched";
          tag.textContent = title;
          watched.appendChild(tag);
        });
        infoButton.appendChild(watched);
      }

      if (Array.isArray(result.sharedWatchParties) && result.sharedWatchParties.length) {
        const parties = document.createElement("div");
        parties.className = "social-follow-search-tags";
        result.sharedWatchParties.slice(0, 2).forEach((summary) => {
          const tag = document.createElement("span");
          tag.className = "social-suggestion-tag";
          tag.dataset.variant = "party";
          tag.textContent = summary;
          parties.appendChild(tag);
        });
        infoButton.appendChild(parties);
      }

      item.appendChild(infoButton);

      const followBtn = document.createElement("button");
      followBtn.type = "button";
      followBtn.className = "btn-secondary social-follow-search-follow";
      followBtn.textContent = "Follow";
      followBtn.addEventListener("click", async () => {
        if (!state.session || !state.session.token) {
          window.location.href = "login.html";
          return;
        }
        playUiClick();
        followBtn.disabled = true;
        setSocialStatus(`Following @${result.username.toLowerCase()}…`, "loading");
        try {
          await followUserByUsername(result.username, { note: getFollowNoteValue() });
          setSocialStatus(`Now following @${result.username.toLowerCase()}.`, "success");
          runSearch(lastQuery);
        } catch (error) {
          setSocialStatus(
            error instanceof Error
              ? error.message
              : "Couldn’t follow that user right now.",
            "error"
          );
        } finally {
          followBtn.disabled = false;
        }
      });
      item.appendChild(followBtn);

      searchList.appendChild(item);
    });
    setSearchState(
      "results",
      results.length === 1
        ? "Found 1 member you might know."
        : `Found ${results.length} members who match.`
    );
  }

  function setSearchState(state, message) {
    if (!searchPanel) {
      return;
    }
    searchPanel.hidden = false;
    searchPanel.dataset.state = state;
    if (searchStatus) {
      if (message) {
        searchStatus.hidden = false;
        searchStatus.textContent = message;
      } else {
        searchStatus.hidden = true;
        searchStatus.textContent = "";
      }
    }
    if (searchList) {
      searchList.hidden = state !== "results";
    }
    if (searchEmpty) {
      if (state === "empty") {
        searchEmpty.hidden = false;
        if (message) {
          searchEmpty.textContent = message;
        }
      } else {
        searchEmpty.hidden = true;
      }
    }
  }

  function clearSearchResults({ hidePanel = false } = {}) {
    if (searchTimer) {
      window.clearTimeout(searchTimer);
      searchTimer = null;
    }
    searchRequestId++;
    lastQuery = "";
    if (searchList) {
      searchList.innerHTML = "";
      searchList.hidden = true;
    }
    if (searchEmpty) {
      searchEmpty.hidden = true;
    }
    if (searchStatus) {
      searchStatus.textContent = "";
      searchStatus.hidden = true;
    }
    if (searchPanel) {
      searchPanel.dataset.state = "idle";
      if (hidePanel) {
        searchPanel.hidden = true;
      }
    }
  }

  function resetSearchPanel() {
    if (!searchPanel) {
      return;
    }
    if (!state.session || !state.session.token) {
      clearSearchResults({ hidePanel: true });
      return;
    }
    searchPanel.hidden = false;
    searchPanel.dataset.state = "idle";
    if (searchStatus) {
      searchStatus.hidden = false;
      searchStatus.textContent = "Start typing to find friends by name or handle.";
    }
    if (searchList) {
      searchList.hidden = true;
    }
    if (searchEmpty) {
      searchEmpty.hidden = true;
    }
  }

  function prefillFollowFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const followValue = params.get("follow");
    if (!followValue) {
      return;
    }
    input.value = followValue;
    if (state.session && state.session.token && followValue.trim().length >= SEARCH_MIN_CHARS) {
      runSearch(followValue.trim());
    }
    if (typeof window.history.replaceState === "function") {
      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.delete("follow");
      const newSearch = currentUrl.searchParams.toString();
      const next = `${currentUrl.pathname}${newSearch ? `?${newSearch}` : ""}${currentUrl.hash}`;
      window.history.replaceState({}, document.title, next);
    }
  }

  function setInviteStatus(message, variant) {
    if (!inviteStatus) {
      return;
    }
    if (!message) {
      inviteStatus.textContent = "";
      inviteStatus.removeAttribute("data-variant");
      return;
    }
    inviteStatus.textContent = message;
    if (variant) {
      inviteStatus.dataset.variant = variant;
    } else {
      inviteStatus.removeAttribute("data-variant");
    }
    window.setTimeout(() => {
      if (inviteStatus.textContent === message) {
        inviteStatus.textContent = "";
        inviteStatus.removeAttribute("data-variant");
      }
    }, 4000);
  }
}
function wireCollaborativeForms() {
  const createForm = $("collabCreateForm");
  const listNameInput = $("collabListName");
  const listDescriptionInput = $("collabListDescription");
  const visibilitySelect = $("collabListVisibility");
  if (createForm && !createForm.dataset.wired) {
    createForm.dataset.wired = "true";
    createForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.session || !state.session.token) {
        window.location.href = "login.html";
        return;
      }
      const name = listNameInput ? listNameInput.value.trim() : "";
      if (name.length < 3) {
        setCollabStatus("Name your list with at least 3 characters.", "error");
        if (listNameInput) {
          listNameInput.focus();
        }
        return;
      }
      const description = listDescriptionInput ? listDescriptionInput.value.trim() : "";
      const visibility = visibilitySelect && visibilitySelect.value === "private" ? "private" : "friends";
      const selectedHandles = getSelectedCollaborativeHandles();
      const submitButton = createForm.querySelector("button[type=\"submit\"]");
      if (submitButton) {
        submitButton.disabled = true;
      }
      setCollabStatus("Creating collaborative list…", "loading");
      try {
        const response = await createCollaborativeListRemote({ name, description, visibility });
        const createdList = response && response.list ? response.list : null;
        setCollabStatus(`Created “${name}”.`, "success");
        createForm.reset();
        if (visibilitySelect) {
          visibilitySelect.value = "friends";
        }
        if (selectedHandles.length && createdList && createdList.id) {
          const { invited, failed } = await inviteSuggestedCollaboratorsToList(
            createdList.id,
            selectedHandles
          );
          if (invited.length && !failed.length) {
            setCollabStatus(
              `Invited ${formatCollaborativeHandleSummary(invited)} to collaborate.`,
              "success"
            );
          } else if (invited.length && failed.length) {
            setCollabStatus(
              `Invited ${formatCollaborativeHandleSummary(invited)}, but couldn’t reach ${formatCollaborativeHandleSummary(
                failed
              )}.`,
              "warning"
            );
          } else if (failed.length) {
            setCollabStatus(
              `Couldn’t invite ${formatCollaborativeHandleSummary(failed)} right now.`,
              "error"
            );
          }
        }
        clearCollaborativeSuggestionSelections();
        await refreshCollaborativeState();
      } catch (error) {
        setCollabStatus(
          error instanceof Error ? error.message : "Couldn’t create that list right now.",
          "error"
        );
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
        }
      }
    });
  }

  const watchForm = $("watchPartyForm");
  const watchTitleInput = $("watchPartyTitle");
  const watchTmdbInput = $("watchPartyTmdbId");
  const watchImdbInput = $("watchPartyImdbId");
  const watchDateInput = $("watchPartyDatetime");
  const watchNoteInput = $("watchPartyNote");
  const watchInviteInput = $("watchPartyInvitees");
  if (watchForm && !watchForm.dataset.wired) {
    watchForm.dataset.wired = "true";
    watchForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.session || !state.session.token) {
        window.location.href = "login.html";
        return;
      }
      const title = watchTitleInput ? watchTitleInput.value.trim() : "";
      if (title.length < 2) {
        setCollabStatus("Add a movie title for your watch party.", "error");
        if (watchTitleInput) {
          watchTitleInput.focus();
        }
        return;
      }
      const tmdbId = watchTmdbInput ? watchTmdbInput.value.trim() : "";
      const imdbId = watchImdbInput ? watchImdbInput.value.trim() : "";
      if (!tmdbId && !imdbId) {
        setCollabStatus("Provide a TMDB or IMDb ID so we can match the movie.", "error");
        if (watchTmdbInput) {
          watchTmdbInput.focus();
        }
        return;
      }
      const whenRaw = watchDateInput ? watchDateInput.value.trim() : "";
      if (!whenRaw) {
        setCollabStatus("Choose a date and time for your watch party.", "error");
        if (watchDateInput) {
          watchDateInput.focus();
        }
        return;
      }
      const whenDate = new Date(whenRaw);
      if (Number.isNaN(whenDate.getTime())) {
        setCollabStatus("Enter a valid date and time.", "error");
        if (watchDateInput) {
          watchDateInput.focus();
        }
        return;
      }
      const note = watchNoteInput ? watchNoteInput.value.trim() : "";
      const invitees = parseInviteHandles(watchInviteInput ? watchInviteInput.value : "");
      const suggestedHandles = getSelectedWatchPartyHandles();
      const combinedInvitees = Array.from(new Set([...invitees, ...suggestedHandles]));
      const submitButton = watchForm.querySelector("button[type=\"submit\"]");
      if (submitButton) {
        submitButton.disabled = true;
      }
      setCollabStatus("Scheduling watch party…", "loading");
      try {
        await scheduleWatchPartyRemote({
          movie: { title, tmdbId: tmdbId || null, imdbId: imdbId || null },
          scheduledFor: whenDate.toISOString(),
          note,
          invitees: combinedInvitees
        });
        setCollabStatus("Watch party scheduled!", "success");
        watchForm.reset();
        clearWatchPartySuggestionSelections();
        await refreshCollaborativeState();
      } catch (error) {
        setCollabStatus(
          error instanceof Error ? error.message : "Couldn’t schedule that watch party right now.",
          "error"
        );
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
        }
      }
    });
  }

  const refreshBtn = $("collabRefreshBtn");
  if (refreshBtn && !refreshBtn.dataset.wired) {
    refreshBtn.dataset.wired = "true";
    refreshBtn.addEventListener("click", async () => {
      if (!state.session || !state.session.token) {
        window.location.href = "login.html";
        return;
      }
      playUiClick();
      refreshBtn.disabled = true;
      setCollabStatus("Refreshing collaborative state…", "loading");
      try {
        await refreshCollaborativeState();
        setCollabStatus("Collaborative lists updated.", "success");
      } catch (error) {
        setCollabStatus(
          error instanceof Error ? error.message : "Couldn’t refresh collaborative data right now.",
          "error"
        );
      } finally {
        refreshBtn.disabled = false;
      }
    });
  }

  function parseInviteHandles(raw) {
    if (!raw) {
      return [];
    }
    const currentUser = state.session && state.session.username ? canonicalHandle(state.session.username) : null;
    const handles = raw
      .split(/[\s,]+/)
      .map((value) => canonicalHandle(value))
      .filter((value) => value && value !== currentUser);
    return Array.from(new Set(handles));
  }
}

function renderFriendsActivityFeed() {
  const panel = $("friendsActivityPanel");
  if (!panel) {
    return;
  }
  const signedOut = $("friendsActivitySignedOut");
  const content = $("friendsActivityContent");
  const isSignedIn = Boolean(state.session && state.session.token);
  if (!isSignedIn) {
    if (signedOut) {
      signedOut.hidden = false;
      signedOut.style.display = "";
      signedOut.setAttribute("aria-hidden", "false");
    }
    if (content) {
      content.hidden = true;
      content.setAttribute("aria-hidden", "true");
      content.style.display = "none";
    }
    return;
  }
  if (signedOut) {
    signedOut.hidden = true;
    signedOut.style.display = "none";
    signedOut.setAttribute("aria-hidden", "true");
  }
  if (content) {
    content.hidden = false;
    content.setAttribute("aria-hidden", "false");
    content.style.display = "";
  }
  renderFriendWatchActivity(buildFriendWatchActivityEntries());
  renderFriendListActivity(buildCollaborativeListActivityEntries());
}

function buildFriendWatchActivityEntries(limit = 4) {
  if (!Array.isArray(state.notifications) || !state.notifications.length) {
    return [];
  }
  const allowed = new Set(["friend_watchlist", "friend_favorite", "friend_review"]);
  return state.notifications
    .filter((entry) => entry && allowed.has(entry.type) && entry.actor)
    .sort((a, b) => {
      const aTime = Date.parse(a && a.createdAt ? a.createdAt : "") || 0;
      const bTime = Date.parse(b && b.createdAt ? b.createdAt : "") || 0;
      return bTime - aTime;
    })
    .slice(0, limit)
    .map((entry) => ({
      id: entry.id,
      username: entry.actor,
      movieTitle: entry.movieTitle || "",
      type: entry.type || "friend_watchlist",
      createdAt: entry.createdAt || null,
      metaLabel:
        entry.type === "friend_favorite"
          ? "Favorite"
          : entry.type === "friend_review"
          ? "Review"
          : "Watch log"
    }));
}

function renderFriendWatchActivity(entries) {
  const listEl = $("friendsWatchList");
  const emptyEl = $("friendsWatchEmpty");
  if (!listEl || !emptyEl) {
    return;
  }
  listEl.innerHTML = "";
  if (!entries.length) {
    listEl.hidden = true;
    emptyEl.hidden = false;
    return;
  }
  listEl.hidden = false;
  emptyEl.hidden = true;
  entries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "friends-activity-row";
    row.setAttribute("role", "listitem");
    const text = document.createElement("div");
    text.className = "friends-activity-text";
    const link =
      entry.username &&
      createInlineProfileLink(entry.username, {
        label: formatSocialDisplayName(entry.username),
        className: "friends-activity-link"
      });
    if (link) {
      text.appendChild(link);
    } else if (entry.username) {
      const fallback = document.createElement("span");
      fallback.className = "friends-activity-link";
      fallback.textContent = formatSocialDisplayName(entry.username);
      text.appendChild(fallback);
    } else {
      const anon = document.createElement("span");
      anon.textContent = "A friend";
      text.appendChild(anon);
    }
    const action = document.createElement("span");
    action.textContent = ` ${formatFriendActivityAction(entry)}`;
    text.appendChild(action);
    row.appendChild(text);
    const meta = document.createElement("div");
    meta.className = "friends-activity-meta";
    const category = document.createElement("span");
    category.textContent = entry.metaLabel;
    const time = document.createElement("span");
    time.textContent = entry.createdAt ? formatSyncTime(entry.createdAt) : "Just now";
    meta.appendChild(category);
    meta.appendChild(time);
    row.appendChild(meta);
    listEl.appendChild(row);
  });
}

function buildCollaborativeListActivityEntries(limit = 3) {
  const sharedLists =
    state.collaborativeState &&
    state.collaborativeState.lists &&
    Array.isArray(state.collaborativeState.lists.shared)
      ? state.collaborativeState.lists.shared.slice()
      : [];
  if (!sharedLists.length) {
    return [];
  }
  return sharedLists
    .sort((a, b) => {
      const aTime = Date.parse(a && (a.updatedAt || a.createdAt) ? a.updatedAt || a.createdAt : "") || 0;
      const bTime = Date.parse(b && (b.updatedAt || b.createdAt) ? b.updatedAt || b.createdAt : "") || 0;
      return bTime - aTime;
    })
    .slice(0, limit)
    .map((entry) => ({
      id: entry.id,
      owner: entry.owner || "",
      name: entry.name || "Untitled list",
      movieCount: Number.isFinite(entry.movieCount) ? entry.movieCount : 0,
      updatedAt: entry.updatedAt || entry.createdAt || null,
      preview: Array.isArray(entry.preview) ? entry.preview.slice(0, 3) : []
    }));
}

function renderFriendListActivity(entries) {
  const listEl = $("friendsListsList");
  const emptyEl = $("friendsListsEmpty");
  if (!listEl || !emptyEl) {
    return;
  }
  listEl.innerHTML = "";
  if (!entries.length) {
    listEl.hidden = true;
    emptyEl.hidden = false;
    return;
  }
  listEl.hidden = false;
  emptyEl.hidden = true;
  entries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "friends-activity-row";
    row.setAttribute("role", "listitem");
    const text = document.createElement("div");
    text.className = "friends-activity-text";
    const ownerLink =
      entry.owner &&
      createInlineProfileLink(entry.owner, {
        label: formatSocialDisplayName(entry.owner),
        className: "friends-activity-link"
      });
    if (ownerLink) {
      text.appendChild(ownerLink);
      text.appendChild(document.createTextNode(" updated "));
    } else if (entry.owner) {
      const owner = document.createElement("span");
      owner.className = "friends-activity-link";
      owner.textContent = formatSocialDisplayName(entry.owner);
      text.appendChild(owner);
      text.appendChild(document.createTextNode(" updated "));
    } else {
      text.appendChild(document.createTextNode("A collaborator updated "));
    }
    const name = document.createElement("strong");
    name.textContent = `“${entry.name}”`;
    text.appendChild(name);
    const countLabel = entry.movieCount === 1 ? "film" : "films";
    text.appendChild(document.createTextNode(` (${entry.movieCount} ${countLabel})`));
    row.appendChild(text);
    const meta = document.createElement("div");
    meta.className = "friends-activity-meta";
    const summary = document.createElement("span");
    summary.textContent = "Collaborative list";
    const time = document.createElement("span");
    time.textContent = entry.updatedAt ? formatSyncTime(entry.updatedAt) : "Just now";
    meta.appendChild(summary);
    meta.appendChild(time);
    row.appendChild(meta);
    if (entry.preview && entry.preview.length) {
      const chipWrap = document.createElement("div");
      chipWrap.className = "friends-activity-chips";
      entry.preview.forEach((movie) => {
        if (!movie || !movie.title) {
          return;
        }
        const chip = document.createElement("span");
        chip.className = "friends-activity-chip";
        chip.textContent = movie.title;
        chipWrap.appendChild(chip);
      });
      if (chipWrap.childNodes.length) {
        row.appendChild(chipWrap);
      }
    }
    listEl.appendChild(row);
  });
}

function formatFriendActivityAction(entry) {
  const movie = entry.movieTitle ? `“${entry.movieTitle}”` : "a movie";
  if (entry.type === "friend_favorite") {
    return `added ${movie} to favorites`;
  }
  if (entry.type === "friend_review") {
    return `reviewed ${movie}`;
  }
  return `logged ${movie}`;
}

function getPresenceOverviewMap(overview = state.socialOverview || getSocialOverviewSnapshot()) {
  if (overview && overview.presence && typeof overview.presence === 'object') {
    return overview.presence;
  }
  return {};
}

function buildPresenceSpotlights(limit = 2) {
  const overview = state.socialOverview || getSocialOverviewSnapshot();
  const following = Array.isArray(overview.following) ? overview.following : [];
  const presenceMap = getPresenceOverviewMap(overview);
  const entries = following
    .map((username) => {
      const normalized = canonicalHandle(username);
      if (!normalized) {
        return null;
      }
      return { username: normalized, presence: presenceMap[normalized] };
    })
    .filter((entry) => entry && entry.presence && entry.presence.state && entry.presence.state !== 'offline');
  if (!entries.length) {
    return [];
  }
  entries.sort((a, b) => presenceEntryWeight(b) - presenceEntryWeight(a));
  return entries.slice(0, limit).map((entry) => {
    const statusKey = getPresenceEntryStatusKey(entry);
    const preset = PRESENCE_STATUS_PRESET_MAP.get(statusKey);
    return {
      username: entry.username,
      displayName: formatSocialDisplayName(entry.username),
      message: buildPresenceHighlightSentence(entry),
      statusKey,
      icon: preset?.icon || '👥'
    };
  });
}

function presenceEntryWeight(entry) {
  if (!entry || !entry.presence) {
    return 0;
  }
  if (entry.presence.state === 'watching') {
    return 4;
  }
  const status = getPresenceEntryStatusKey(entry);
  if (status === 'available') {
    return 3;
  }
  if (status && status !== 'default') {
    return 2;
  }
  if (entry.presence.state === 'away') {
    return 0.5;
  }
  return 1;
}

function renderSocialConnections() {
  const overview = state.socialOverview || getSocialOverviewSnapshot();
  const collabState = state.collaborativeState || getCollaborativeStateSnapshot();
  const following = Array.isArray(overview.following) ? overview.following : [];
  const followers = Array.isArray(overview.followers) ? overview.followers : [];
  const mutualFollowers = Array.isArray(overview.mutualFollowers) ? overview.mutualFollowers : [];
  const suggestions = Array.isArray(overview.suggestions) ? overview.suggestions : [];
  const counts = overview && overview.counts ? overview.counts : {};
  const presence = overview && overview.presence && typeof overview.presence === 'object' ? overview.presence : {};
  const badges = Array.isArray(overview.badges) ? overview.badges : state.socialOverview?.badges || [];
  const collabLists = collabState && collabState.lists ? collabState.lists : { owned: [], shared: [], invites: [] };
  const watchParties =
    collabState && collabState.watchParties ? collabState.watchParties : { upcoming: [], invites: [] };
  const collaborations = {
    owned: Array.isArray(collabLists.owned) ? collabLists.owned.length : 0,
    shared: Array.isArray(collabLists.shared) ? collabLists.shared.length : 0,
    invites: Array.isArray(collabLists.invites) ? collabLists.invites.length : 0
  };

  const followingSet = new Set(following);
  const followersSet = new Set(followers);
  const availableSuggestions = suggestions.filter((suggestion) => {
    return suggestion && suggestion.username && !followingSet.has(suggestion.username);
  });
  renderCollaborativeSuggestions(availableSuggestions);
  renderWatchPartySuggestions(availableSuggestions);
  const activeEntries = following
    .map((username) => ({ username, presence: presence[username] }))
    .filter((entry) => entry.presence && entry.presence.state);
  const activeCount = activeEntries.length;
  const invitesWaitingCount =
    (Array.isArray(collabLists.invites) ? collabLists.invites.length : 0) +
    (Array.isArray(watchParties.invites) ? watchParties.invites.length : 0);
  const upcomingPartiesCount = Array.isArray(watchParties.upcoming) ? watchParties.upcoming.length : 0;

  updateSocialFirstRunCard(counts);

  const leadActiveName = activeEntries.length ? formatSocialDisplayName(activeEntries[0].username) : "";
  const activeOthersCount = Math.max(activeEntries.length - 1, 0);
  const leadHighlightSentence = activeEntries.length ? buildPresenceHighlightSentence(activeEntries[0]) : '';
  const effectiveHighlightSentence = leadHighlightSentence || 'is online now.';
  const effectiveHighlightClause = effectiveHighlightSentence.replace(/\.\s*$/, '');
  const activeMessages = {
    empty: "No friends online right now.",
    singular: leadActiveName
      ? `${leadActiveName} ${effectiveHighlightSentence}`
      : `One friend ${effectiveHighlightSentence}`,
    plural:
      leadActiveName && activeOthersCount > 0
        ? `${leadActiveName} ${effectiveHighlightClause}, plus ${formatCountLabel(
            activeOthersCount,
            "1 more friend",
            `${activeOthersCount.toLocaleString()} more friends`
          )} online.`
        : leadActiveName
        ? `${leadActiveName} ${effectiveHighlightSentence}`
        : `${activeCount.toLocaleString()} friends are online now.`
  };

  const invitesEmptyMessage =
    upcomingPartiesCount > 0
      ? formatCountLabel(
          upcomingPartiesCount,
          "One watch party is on your calendar.",
          `${upcomingPartiesCount.toLocaleString()} watch parties are on your calendar.`
        )
      : "You’re all caught up on invites.";
  const invitesMessages = {
    empty: invitesEmptyMessage,
    singular: "One invite waiting for you.",
    plural:
      invitesWaitingCount > 1
        ? `${invitesWaitingCount.toLocaleString()} invites waiting for you.`
        : "Multiple invites waiting for you."
  };

  const topSuggestion = availableSuggestions[0];
  const suggestionLeadName = topSuggestion
    ? topSuggestion.displayName || formatSocialDisplayName(topSuggestion.username)
    : "";
  const suggestionOthersCount = Math.max(availableSuggestions.length - 1, 0);
  const suggestionsMessages = {
    empty: "Follow more friends to get fresh matches.",
    singular: suggestionLeadName
      ? `${suggestionLeadName} is a promising match.`
      : "We found a promising match for you.",
    plural:
      suggestionLeadName && suggestionOthersCount > 0
        ? `${suggestionLeadName} and ${formatCountLabel(
            suggestionOthersCount,
            "1 more member",
            `${suggestionOthersCount.toLocaleString()} more members`
          )} look like great matches.`
        : `${availableSuggestions.length.toLocaleString()} promising matches waiting.`
  };

  updateSocialCount("followersCount", Number.isFinite(counts.followers) ? counts.followers : followers.length);
  updateSocialCount(
    "followingCount",
    Number.isFinite(counts.following) ? counts.following : following.length
  );
  updateSocialCount(
    "mutualFollowersCount",
    Number.isFinite(counts.mutual) ? counts.mutual : mutualFollowers.length
  );
  updateSocialCount(
    "socialFollowingHeadingCount",
    Number.isFinite(counts.following) ? counts.following : following.length
  );
  updateSocialCount(
    "socialFollowersHeadingCount",
    Number.isFinite(counts.followers) ? counts.followers : followers.length
  );

  updateSocialHighlight(
    "socialHighlightActive",
    "socialHighlightActiveCount",
    "socialHighlightActiveNote",
    activeCount,
    activeMessages
  );
  updateSocialHighlight(
    "socialHighlightInvites",
    "socialHighlightInvitesCount",
    "socialHighlightInvitesNote",
    invitesWaitingCount,
    invitesMessages
  );
  updateSocialHighlight(
    "socialHighlightSuggestions",
    "socialHighlightSuggestionsCount",
    "socialHighlightSuggestionsNote",
    availableSuggestions.length,
    suggestionsMessages
  );

  const badgeListEl = $("socialBadgeList");
  const badgeEmptyEl = $("socialBadgeEmpty");
  if (badgeListEl && badgeEmptyEl) {
    badgeListEl.innerHTML = "";
    if (!badges.length) {
      badgeListEl.hidden = true;
      badgeEmptyEl.hidden = false;
    } else {
      badges.forEach((badge) => {
        const chip = document.createElement("div");
        chip.className = "social-badge";
        const title = document.createElement("span");
        title.className = "social-badge-title";
        title.textContent = badge.label;
        const description = document.createElement("span");
        description.className = "social-badge-desc";
        description.textContent = badge.description || "";
        chip.appendChild(title);
        chip.appendChild(description);
        badgeListEl.appendChild(chip);
      });
      badgeListEl.hidden = false;
      badgeEmptyEl.hidden = true;
    }
  }

  const presenceListEl = $("socialPresenceList");
  if (presenceListEl) {
    presenceListEl.innerHTML = "";
    if (!activeEntries.length) {
      const empty = document.createElement("p");
      empty.className = "social-presence-empty";
      empty.textContent = "No friends online right now.";
      presenceListEl.appendChild(empty);
    } else {
      activeEntries.forEach((entry) => {
        const row = document.createElement("div");
        row.className = "social-presence-row";
        const nameButton = createProfileButton(entry.username, {
          className: "social-profile-plain social-presence-name",
          ariaLabel: `View profile for ${formatSocialDisplayName(entry.username)}`
        });
        if (nameButton) {
          row.appendChild(nameButton);
        } else {
          const name = document.createElement("span");
          name.className = "social-presence-name";
          name.textContent = formatSocialDisplayName(entry.username);
          row.appendChild(name);
        }
        const state = document.createElement("span");
        state.className = "social-presence-state";
        const statusKey = getPresenceEntryStatusKey(entry);
        state.dataset.state = entry.presence.state || "online";
        state.dataset.statusPreset = statusKey;
        state.textContent = formatPresenceListStatus(entry);
        row.appendChild(state);
        const shareForm = createPresenceShareForm(entry.username);
        const actions = document.createElement('div');
        actions.className = 'social-presence-actions';
        const inviteBtn = document.createElement('button');
        inviteBtn.type = 'button';
        inviteBtn.className = 'social-presence-action-btn';
        inviteBtn.textContent = 'Invite to party';
        inviteBtn.addEventListener('click', () => handlePresenceInviteAction(entry.username));
        actions.appendChild(inviteBtn);
        const shareBtn = document.createElement('button');
        shareBtn.type = 'button';
        shareBtn.className = 'social-presence-action-btn';
        shareBtn.textContent = 'Send a rec';
        shareBtn.addEventListener('click', () => togglePresenceShareForm(shareForm));
        actions.appendChild(shareBtn);
        row.appendChild(actions);
        if (shareForm) {
          row.appendChild(shareForm);
        }
        presenceListEl.appendChild(row);
      });
    }
  }

  const collabSummaryEl = $("socialCollabSummary");
  if (collabSummaryEl) {
    collabSummaryEl.innerHTML = "";
    const summary = collaborations || { owned: 0, shared: 0, invites: 0 };
    const owned = document.createElement("div");
    owned.className = "social-collab-pill";
    owned.innerHTML = `<strong>${summary.owned || 0}</strong> owned lists`;
    const shared = document.createElement("div");
    shared.className = "social-collab-pill";
    shared.innerHTML = `<strong>${summary.shared || 0}</strong> shared lists`;
    const invites = document.createElement("div");
    invites.className = "social-collab-pill";
    invites.innerHTML = `<strong>${summary.invites || 0}</strong> invites waiting`;
    collabSummaryEl.appendChild(owned);
    collabSummaryEl.appendChild(shared);
    collabSummaryEl.appendChild(invites);
  }

  renderCollaborativeSections(collabState);
  renderFriendsActivityFeed();

  const mutualListEl = $("socialMutualList");
  const mutualEmptyEl = $("socialMutualEmpty");
  if (mutualListEl && mutualEmptyEl) {
    mutualListEl.innerHTML = "";
    if (!mutualFollowers.length) {
      mutualListEl.hidden = true;
      mutualEmptyEl.hidden = false;
    } else {
      mutualFollowers.forEach((username) => {
        const chip = createProfileButton(username, {
          className: "social-chip social-chip--action",
          label: formatSocialDisplayName(username)
        });
        if (chip) {
          mutualListEl.appendChild(chip);
        }
      });
      mutualListEl.hidden = false;
      mutualEmptyEl.hidden = true;
    }
  }

  const followingListEl = $("socialFollowingList");
  const followingEmptyEl = $("socialFollowingEmpty");
  if (followingListEl && followingEmptyEl) {
    followingListEl.innerHTML = "";
    if (!following.length) {
      followingListEl.hidden = true;
      followingEmptyEl.hidden = false;
    } else {
      followingListEl.hidden = false;
      followingEmptyEl.hidden = true;
      following.forEach((username) => {
        const item = buildSocialListItem({
          username,
          isFollowing: true,
          followsYou: followersSet.has(username),
          mutualFollowers: mutualFollowers.filter((value) => value !== username),
          onPrimaryAction: (button) => {
            playUiClick();
            handleUnfollowUser(username, button);
          }
        });
        followingListEl.appendChild(item);
      });
    }
  }

  const followersListEl = $("socialFollowersList");
  const followersEmptyEl = $("socialFollowersEmpty");
  if (followersListEl && followersEmptyEl) {
    followersListEl.innerHTML = "";
    if (!followers.length) {
      followersListEl.hidden = true;
      followersEmptyEl.hidden = false;
    } else {
      followersListEl.hidden = false;
      followersEmptyEl.hidden = true;
      followers.forEach((username) => {
        const isFollowing = followingSet.has(username);
        const item = buildSocialListItem({
          username,
          isFollowing,
          followsYou: true,
          mutualFollowers: mutualFollowers.filter((value) => value !== username),
          onPrimaryAction: isFollowing
            ? null
            : (button) => {
                playUiClick();
                handleFollowFromList(username, button);
              }
        });
        followersListEl.appendChild(item);
      });
    }
  }

  const suggestionsListEl = $("socialSuggestionsList");
  const suggestionsEmptyEl = $("socialSuggestionsEmpty");
  if (suggestionsListEl && suggestionsEmptyEl) {
    suggestionsListEl.innerHTML = "";
    if (!availableSuggestions.length) {
      suggestionsListEl.hidden = true;
      suggestionsEmptyEl.hidden = false;
    } else {
      suggestionsListEl.hidden = false;
      suggestionsEmptyEl.hidden = true;
      availableSuggestions.forEach((suggestion) => {
        const card = buildSuggestionCard(suggestion, (button) => {
          playUiClick();
          handleFollowFromList(suggestion.username, button);
        });
        suggestionsListEl.appendChild(card);
      });
    }
  }
}

function handlePresenceInviteAction(username) {
  const normalized = canonicalHandle(username);
  if (!normalized) {
    return;
  }
  if (!state.session || !state.session.token) {
    showToast({
      title: 'Sign in to invite friends',
      text: 'Sign in to schedule a watch party with your friends.',
      icon: '🔒'
    });
    return;
  }
  const inviteInput = $("watchPartyInvitees");
  const form = $("watchPartyForm");
  if (!inviteInput || !form) {
    showToast({
      title: 'Open the watch party planner',
      text: 'Head to the Social tab to schedule a watch party.',
      icon: '🎬'
    });
    return;
  }
  const existing = inviteInput.value
    ? inviteInput.value
        .split(',')
        .map((value) => canonicalHandle(value))
        .filter(Boolean)
    : [];
  if (!existing.includes(normalized)) {
    existing.push(normalized);
  }
  inviteInput.value = existing.join(', ');
  inviteInput.dispatchEvent(new Event('input', { bubbles: true }));
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  showToast({
    title: 'Invite queued',
    text: `Added ${formatSocialDisplayName(normalized)} to your invite list.`,
    icon: '🎉'
  });
}

function createPresenceShareForm(username) {
  const form = document.createElement('form');
  form.className = 'social-presence-share';
  form.hidden = true;
  form.noValidate = true;
  const label = document.createElement('label');
  label.className = 'sr-only';
  label.textContent = `Recommend a title to ${formatSocialDisplayName(username)}`;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input-base input-text';
  input.placeholder = 'Movie or show title';
  input.maxLength = 80;
  input.required = true;
  const actions = document.createElement('div');
  actions.className = 'social-presence-share-actions';
  const sendBtn = document.createElement('button');
  sendBtn.type = 'submit';
  sendBtn.className = 'btn-secondary';
  sendBtn.textContent = 'Send recommendation';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-subtle';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => closePresenceShareForm(form));
  actions.appendChild(sendBtn);
  actions.appendChild(cancelBtn);
  const status = document.createElement('p');
  status.className = 'social-presence-share-status';
  status.setAttribute('aria-live', 'polite');
  form.appendChild(label);
  form.appendChild(input);
  form.appendChild(actions);
  form.appendChild(status);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    handlePresenceShareSubmit({ form, input, status, username });
  });
  return form;
}

function togglePresenceShareForm(form) {
  if (!form) {
    return;
  }
  if (activePresenceShareForm && activePresenceShareForm !== form) {
    closePresenceShareForm(activePresenceShareForm);
  }
  const willOpen = form.hidden;
  if (willOpen) {
    form.hidden = false;
    activePresenceShareForm = form;
    const input = form.querySelector('input');
    if (input) {
      input.focus();
    }
  } else {
    closePresenceShareForm(form);
  }
}

function closePresenceShareForm(form) {
  if (!form) {
    return;
  }
  form.hidden = true;
  const input = form.querySelector('input');
  if (input) {
    input.value = '';
  }
  const status = form.querySelector('.social-presence-share-status');
  if (status) {
    setPresenceShareStatus(status, '');
  }
  if (activePresenceShareForm === form) {
    activePresenceShareForm = null;
  }
}

function handlePresenceShareSubmit({ form, input, status, username }) {
  if (!state.session || !state.session.token) {
    setPresenceShareStatus(status, 'Sign in to send recommendations.', 'error');
    return;
  }
  const title = input.value.trim();
  if (!title) {
    setPresenceShareStatus(status, 'Add a movie title before sending.', 'error');
    input.focus();
    return;
  }
  setPresenceShareStatus(status, 'Sending your recommendation…', 'muted');
  window.setTimeout(() => {
    const displayName = formatSocialDisplayName(username) || 'your friend';
    setPresenceShareStatus(status, `Sent “${title}” to ${displayName}.`, 'success');
    showToast({
      title: 'Recommendation sent',
      text: `We’ll nudge ${displayName} to check out “${title}”.`,
      icon: '📮'
    });
    closePresenceShareForm(form);
  }, 200);
}

function setPresenceShareStatus(element, text, variant) {
  if (!element) {
    return;
  }
  if (!text) {
    element.textContent = '';
    element.removeAttribute('data-variant');
    return;
  }
  element.textContent = text;
  if (variant) {
    element.dataset.variant = variant;
  } else {
    element.removeAttribute('data-variant');
  }
}

function renderCollaborativeSuggestions(suggestions) {
  const container = $("collabSuggestedContainer");
  const emptyEl = $("collabSuggestedEmpty");
  if (!container || !emptyEl) {
    return;
  }
  container.innerHTML = "";
  const normalized = Array.isArray(suggestions)
    ? suggestions
        .map((entry) => ({
          username: canonicalHandle(entry.username || ""),
          displayName: entry.displayName || formatSocialDisplayName(entry.username),
          reason: entry.reason || entry.tagline || "High taste overlap"
        }))
        .filter((entry) => entry.username)
        .slice(0, MAX_SUGGESTED_COLLABORATORS)
    : [];
  const availableHandles = new Set(normalized.map((entry) => entry.username));
  Array.from(collabSuggestionSelections).forEach((handle) => {
    if (!availableHandles.has(handle)) {
      collabSuggestionSelections.delete(handle);
    }
  });
  if (!normalized.length) {
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  normalized.forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "collab-suggested-chip";
    button.dataset.handle = entry.username;
    button.dataset.collabSuggestChip = "true";
    button.title = entry.reason;
    const name = document.createElement("span");
    name.className = "collab-suggested-name";
    name.textContent = entry.displayName;
    button.appendChild(name);
    const reason = document.createElement("span");
    reason.className = "collab-suggested-reason";
    reason.textContent = entry.reason;
    button.appendChild(reason);
    button.addEventListener("click", () => {
      playUiClick();
      toggleCollaborativeSuggestion(entry.username);
    });
    container.appendChild(button);
  });
  updateCollaborativeSuggestionSelectionStates();
}

function toggleCollaborativeSuggestion(handle) {
  const normalized = canonicalHandle(handle);
  if (!normalized) {
    return;
  }
  if (collabSuggestionSelections.has(normalized)) {
    collabSuggestionSelections.delete(normalized);
  } else {
    collabSuggestionSelections.add(normalized);
  }
  updateCollaborativeSuggestionSelectionStates();
}

function updateCollaborativeSuggestionSelectionStates() {
  const chips = document.querySelectorAll('[data-collab-suggest-chip="true"]');
  chips.forEach((chip) => {
    const handle = canonicalHandle(chip.dataset.handle || "");
    const selected = handle && collabSuggestionSelections.has(handle);
    chip.dataset.selected = selected ? "true" : "false";
    chip.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

function getSelectedCollaborativeHandles() {
  return Array.from(collabSuggestionSelections);
}

function clearCollaborativeSuggestionSelections() {
  collabSuggestionSelections.clear();
  updateCollaborativeSuggestionSelectionStates();
}

function renderWatchPartySuggestions(suggestions) {
  const container = $("watchPartySuggestedContainer");
  const emptyEl = $("watchPartySuggestedEmpty");
  if (!container || !emptyEl) {
    return;
  }
  container.innerHTML = "";
  const normalized = Array.isArray(suggestions)
    ? suggestions
        .map((entry) => ({
          username: canonicalHandle(entry.username || ""),
          displayName: entry.displayName || formatSocialDisplayName(entry.username),
          reason: buildWatchPartySuggestionReason(entry)
        }))
        .filter((entry) => entry.username)
        .slice(0, MAX_WATCH_PARTY_SUGGESTIONS)
    : [];
  const availableHandles = new Set(normalized.map((entry) => entry.username));
  Array.from(watchPartySuggestionSelections).forEach((handle) => {
    if (!availableHandles.has(handle)) {
      watchPartySuggestionSelections.delete(handle);
    }
  });
  if (!normalized.length) {
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  normalized.forEach((entry) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "watch-party-suggested-chip";
    chip.dataset.watchPartySuggestChip = "true";
    chip.dataset.handle = entry.username;
    chip.setAttribute("aria-pressed", "false");
    const name = document.createElement("span");
    name.className = "watch-party-suggested-name";
    name.textContent = entry.displayName;
    chip.appendChild(name);
    const meta = document.createElement("span");
    meta.className = "watch-party-suggested-meta";
    meta.textContent = entry.reason;
    chip.appendChild(meta);
    chip.addEventListener("click", () => {
      toggleWatchPartySuggestion(entry.username);
    });
    container.appendChild(chip);
  });
  updateWatchPartySuggestionSelectionStates();
}

function buildWatchPartySuggestionReason(entry) {
  if (Array.isArray(entry.sharedWatchParties) && entry.sharedWatchParties.length) {
    return `Co-hosted ${formatPlural(entry.sharedWatchParties.length, "party", "parties")} together`;
  }
  if (Array.isArray(entry.sharedInterests) && entry.sharedInterests.length) {
    return `Also into ${formatFriendlyList(entry.sharedInterests, 2)}`;
  }
  if (Array.isArray(entry.sharedFavorites) && entry.sharedFavorites.length) {
    return `Bonded over ${formatFriendlyList(entry.sharedFavorites, 2)}`;
  }
  if (typeof entry.reason === "string" && entry.reason.trim()) {
    return entry.reason.trim();
  }
  return "High taste match";
}

function toggleWatchPartySuggestion(handle) {
  const normalized = canonicalHandle(handle);
  if (!normalized) {
    return;
  }
  if (watchPartySuggestionSelections.has(normalized)) {
    watchPartySuggestionSelections.delete(normalized);
  } else {
    watchPartySuggestionSelections.add(normalized);
  }
  updateWatchPartySuggestionSelectionStates();
}

function updateWatchPartySuggestionSelectionStates() {
  const chips = document.querySelectorAll('[data-watch-party-suggest-chip="true"]');
  chips.forEach((chip) => {
    const handle = canonicalHandle(chip.dataset.handle || "");
    const selected = handle && watchPartySuggestionSelections.has(handle);
    chip.dataset.selected = selected ? "true" : "false";
    chip.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

function getSelectedWatchPartyHandles() {
  return Array.from(watchPartySuggestionSelections);
}

function clearWatchPartySuggestionSelections() {
  watchPartySuggestionSelections.clear();
  updateWatchPartySuggestionSelectionStates();
}

async function inviteSuggestedCollaboratorsToList(listId, handles) {
  const invited = [];
  const failed = [];
  for (const handle of handles) {
    try {
      await inviteCollaboratorRemote({ listId, username: handle });
      invited.push(handle);
    } catch (error) {
      console.warn("Collaborative invite failed", handle, error);
      failed.push(handle);
    }
  }
  return { invited, failed };
}

function formatCollaborativeHandleSummary(handles) {
  if (!Array.isArray(handles) || !handles.length) {
    return "";
  }
  if (handles.length === 1) {
    return `@${handles[0]}`;
  }
  if (handles.length === 2) {
    return `@${handles[0]} and @${handles[1]}`;
  }
  return `@${handles[0]} and ${handles.length - 1} others`;
}

function renderCollaborativeSections(collabStateInput) {
  const collab = collabStateInput && typeof collabStateInput === "object"
    ? collabStateInput
    : getCollaborativeStateSnapshot();
  const lists = collab && typeof collab === "object" && collab.lists ? collab.lists : {};
  const watchParties = collab && typeof collab === "object" && collab.watchParties ? collab.watchParties : {};

  renderCollaborativeListCollection(lists.owned, "collabOwnedList", "collabOwnedEmpty", "owner");
  renderCollaborativeListCollection(lists.shared, "collabSharedList", "collabSharedEmpty", "shared");
  renderCollaborativeInviteCollection(lists.invites, "collabInviteList", "collabInviteEmpty");
  renderWatchPartyCollection(watchParties.upcoming, "watchPartyList", "watchPartyEmpty", "upcoming");
  renderWatchPartyCollection(watchParties.invites, "watchPartyInviteList", "watchPartyInviteEmpty", "invite");
}

function renderCollaborativeListCollection(entries, listId, emptyId, mode) {
  const container = $(listId);
  const empty = $(emptyId);
  if (!container || !empty) {
    return;
  }
  container.innerHTML = "";
  const list = Array.isArray(entries) ? entries.slice() : [];
  if (!list.length) {
    container.hidden = true;
    empty.hidden = false;
    return;
  }
  list.sort((a, b) => {
    const aTime = Math.max(toTimestamp(a?.updatedAt), toTimestamp(a?.createdAt));
    const bTime = Math.max(toTimestamp(b?.updatedAt), toTimestamp(b?.createdAt));
    return bTime - aTime;
  });
  container.hidden = false;
  empty.hidden = true;
  list.forEach((entry) => {
    const card = buildCollaborativeListCard(entry, mode);
    container.appendChild(card);
  });
}

function renderCollaborativeInviteCollection(entries, listId, emptyId) {
  const container = $(listId);
  const empty = $(emptyId);
  if (!container || !empty) {
    return;
  }
  container.innerHTML = "";
  const list = Array.isArray(entries) ? entries.slice() : [];
  if (!list.length) {
    container.hidden = true;
    empty.hidden = false;
    return;
  }
  list.sort((a, b) => {
    return toTimestamp(b?.invitedAt) - toTimestamp(a?.invitedAt);
  });
  container.hidden = false;
  empty.hidden = true;
  list.forEach((entry) => {
    const card = buildCollaborativeInviteCard(entry);
    container.appendChild(card);
  });
}

function renderWatchPartyCollection(entries, listId, emptyId, mode) {
  const container = $(listId);
  const empty = $(emptyId);
  if (!container || !empty) {
    return;
  }
  container.innerHTML = "";
  const list = Array.isArray(entries) ? entries.slice() : [];
  if (!list.length) {
    container.hidden = true;
    empty.hidden = false;
    return;
  }
  list.sort((a, b) => {
    const aTime = toTimestamp(a?.scheduledFor || a?.createdAt);
    const bTime = toTimestamp(b?.scheduledFor || b?.createdAt);
    return aTime - bTime;
  });
  container.hidden = false;
  empty.hidden = true;
  list.forEach((entry) => {
    const card = buildWatchPartyCard(entry, mode);
    container.appendChild(card);
  });
}

function buildCollaborativeListCard(entry, mode) {
  const card = document.createElement("article");
  card.className = "collab-list-card";
  card.dataset.role = mode;
  const canCollaborate = entry.role === "owner" || entry.role === "editor";

  const header = document.createElement("header");
  header.className = "collab-list-card-header";
  const title = document.createElement("h4");
  title.textContent = entry.name || "Untitled list";
  header.appendChild(title);
  const count = document.createElement("span");
  count.className = "collab-list-count";
  count.textContent = formatMovieCount(entry.movieCount);
  header.appendChild(count);
  card.appendChild(header);

  if (entry.description) {
    const desc = document.createElement("p");
    desc.className = "collab-list-desc";
    desc.textContent = entry.description;
    card.appendChild(desc);
  }

  const meta = document.createElement("div");
  meta.className = "collab-list-meta";
  const appendMetaText = (text) => {
    if (!text) {
      return;
    }
    if (meta.childNodes.length) {
      meta.appendChild(document.createTextNode(" • "));
    }
    meta.appendChild(document.createTextNode(text));
  };
  if (mode === "owner") {
    appendMetaText("You own this list");
  } else if (entry.owner) {
    appendMetaText("Owner: ");
    const ownerLink = createProfileButton(entry.owner, {
      className: "social-profile-link",
      label: `@${entry.owner}`,
      stopPropagation: true
    });
    if (ownerLink) {
      meta.appendChild(ownerLink);
    } else {
      meta.appendChild(document.createTextNode(`@${entry.owner}`));
    }
  }
  appendMetaText(entry.visibility === "private" ? "Private access" : "Friends can view");
  const updatedLabel = formatTimeAgo(entry.updatedAt || entry.createdAt);
  if (updatedLabel) {
    appendMetaText(`Updated ${updatedLabel}`);
  }
  card.appendChild(meta);

  if (Array.isArray(entry.preview) && entry.preview.length) {
    const preview = document.createElement("div");
    preview.className = "collab-list-preview";
    entry.preview.forEach((item) => {
      if (!item || !item.title) {
        return;
      }
      const pill = document.createElement("span");
      pill.className = "collab-chip";
      pill.dataset.variant = "movie";
      pill.textContent = item.title;
      preview.appendChild(pill);
    });
    card.appendChild(preview);
  }

  const presenceRow = buildCollaborativePresenceRow(entry);
  if (presenceRow) {
    card.appendChild(presenceRow);
  }

  const voteSection = buildCollaborativeVoteList(entry, canCollaborate);
  if (voteSection) {
    card.appendChild(voteSection);
  }

  const collaborators = Array.isArray(entry.collaborators)
    ? entry.collaborators.filter((handle) => canonicalHandle(handle) && canonicalHandle(handle) !== canonicalHandle(entry.owner))
    : [];
  if (collaborators.length) {
    const row = document.createElement("div");
    row.className = "collab-list-collaborators";
    const label = document.createElement("span");
    label.className = "collab-chip collab-chip--label";
    label.textContent = "Collaborators";
    row.appendChild(label);
    collaborators.forEach((handle) => {
      const chip = createProfileButton(handle, {
        className: "collab-chip collab-chip--action",
        label: formatSocialDisplayName(handle),
        stopPropagation: true
      });
      if (chip) {
        row.appendChild(chip);
      }
    });
    card.appendChild(row);
  }

  if (mode === "owner" && Array.isArray(entry.pendingInvites) && entry.pendingInvites.length) {
    const pending = document.createElement("p");
    pending.className = "collab-list-pending";
    pending.appendChild(document.createTextNode("Pending invites: "));
    entry.pendingInvites.forEach((handle, index) => {
      if (index > 0) {
        pending.appendChild(document.createTextNode(", "));
      }
      const inviteLink = createProfileButton(handle, {
        className: "social-profile-link",
        label: `@${handle}`,
        stopPropagation: true
      });
      if (inviteLink) {
        pending.appendChild(inviteLink);
      } else {
        pending.appendChild(document.createTextNode(`@${handle}`));
      }
    });
    card.appendChild(pending);
  }

  if (mode === "owner") {
    const actions = document.createElement("div");
    actions.className = "collab-list-actions";
    const inviteBtn = document.createElement("button");
    inviteBtn.type = "button";
    inviteBtn.className = "btn-subtle";
    inviteBtn.textContent = "Invite collaborator";
    inviteBtn.addEventListener("click", () => {
      playUiClick();
      handleInviteCollaboratorAction(entry, inviteBtn);
    });
    actions.appendChild(inviteBtn);
    card.appendChild(actions);
  }

  const discussionSection = buildCollaborativeDiscussionSection(entry, canCollaborate);
  if (discussionSection) {
    card.appendChild(discussionSection);
  }

  return card;
}

function buildCollaborativePresenceRow(entry) {
  const handles = new Set();
  if (entry.owner) {
    const ownerHandle = canonicalHandle(entry.owner);
    if (ownerHandle) {
      handles.add(ownerHandle);
    }
  }
  if (Array.isArray(entry.collaborators)) {
    entry.collaborators.forEach((handle) => {
      const normalized = canonicalHandle(handle);
      if (normalized) {
        handles.add(normalized);
      }
    });
  }
  if (!handles.size) {
    return null;
  }
  const presenceMap = getPresenceOverviewMap();
  const members = Array.from(handles)
    .map((username) => ({ username, presence: presenceMap[username] }))
    .filter((record) => record.presence && record.presence.state && record.presence.state !== 'offline');
  if (!members.length) {
    return null;
  }
  members.sort((a, b) => presenceEntryWeight(b) - presenceEntryWeight(a));
  const row = document.createElement('div');
  row.className = 'collab-presence-row';
  const label = document.createElement('span');
  label.className = 'collab-presence-label';
  label.textContent = 'Now online';
  row.appendChild(label);
  const chips = document.createElement('div');
  chips.className = 'collab-presence-chips';
  members.slice(0, 3).forEach((member) => {
    const chip = document.createElement('span');
    chip.className = 'collab-presence-chip';
    chip.dataset.status = getPresenceEntryStatusKey(member);
    chip.textContent = `${formatSocialDisplayName(member.username)} • ${formatPresenceChipSummary(member)}`;
    chips.appendChild(chip);
  });
  if (members.length > 3) {
    const more = document.createElement('span');
    more.className = 'collab-presence-chip';
    more.textContent = `+${members.length - 3} more`;
    chips.appendChild(more);
  }
  row.appendChild(chips);
  return row;
}

function buildCollaborativeVoteList(entry, canVote) {
  const listId = entry && entry.id ? entry.id : null;
  const highlights = Array.isArray(entry.voteHighlights)
    ? entry.voteHighlights.filter((item) => item && item.tmdbId)
    : [];
  if (!highlights.length && !canVote) {
    return null;
  }
  const section = document.createElement("div");
  section.className = "collab-vote-list";
  const heading = document.createElement("div");
  heading.className = "collab-vote-heading";
  heading.textContent = "Tonight’s frontrunners";
  section.appendChild(heading);
  if (!highlights.length) {
    const empty = document.createElement("p");
    empty.className = "collab-thread-empty";
    empty.textContent = "No votes yet — help prioritize the lineup.";
    section.appendChild(empty);
    return section;
  }
  highlights.forEach((item) => {
    const row = document.createElement("div");
    row.className = "collab-vote-row";
    const info = document.createElement("div");
    info.className = "collab-vote-info";
    const title = document.createElement("p");
    title.className = "collab-vote-title";
    title.textContent = item.title || "Untitled pick";
    info.appendChild(title);
    const score = document.createElement("div");
    score.className = "collab-vote-score";
    const summary = formatCollaborativeVoteSummary(item);
    score.textContent = summary.label;
    if (summary.trend) {
      score.dataset.trend = summary.trend;
    }
    info.appendChild(score);
    row.appendChild(info);
    if (canVote && listId) {
      const actions = document.createElement("div");
      actions.className = "collab-vote-actions";
      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.className = "collab-vote-btn";
      upBtn.textContent = `👍 ${item.yesCount || 0}`;
      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "collab-vote-btn";
      downBtn.textContent = `👎 ${item.noCount || 0}`;
      const isUpSelected = item.myVote === "yes";
      const isDownSelected = item.myVote === "no";
      upBtn.setAttribute("aria-pressed", isUpSelected ? "true" : "false");
      downBtn.setAttribute("aria-pressed", isDownSelected ? "true" : "false");
      upBtn.dataset.vote = "yes";
      downBtn.dataset.vote = "no";
      upBtn.addEventListener("click", () => {
        const nextVote = isUpSelected ? "clear" : "yes";
        handleCollaborativeVoteAction(listId, item.tmdbId, nextVote, upBtn, actions);
      });
      downBtn.addEventListener("click", () => {
        const nextVote = isDownSelected ? "clear" : "no";
        handleCollaborativeVoteAction(listId, item.tmdbId, nextVote, downBtn, actions);
      });
      actions.appendChild(upBtn);
      actions.appendChild(downBtn);
      row.appendChild(actions);
    }
    section.appendChild(row);
  });
  return section;
}

function formatCollaborativeVoteSummary(item) {
  const yes = Number.isFinite(item.yesCount) ? item.yesCount : 0;
  const no = Number.isFinite(item.noCount) ? item.noCount : 0;
  const score = yes - no;
  let trend = "";
  if (score > 0) {
    trend = "up";
  } else if (score < 0) {
    trend = "down";
  }
  const label = yes || no ? `${yes.toLocaleString()} 👍 · ${no.toLocaleString()} 👎` : "No votes yet";
  return { label, trend };
}

function buildCollaborativeDiscussionSection(entry, canComment) {
  const messages = Array.isArray(entry.discussionPreview) ? entry.discussionPreview : [];
  if (!messages.length && !canComment) {
    return null;
  }
  const section = document.createElement("div");
  section.className = "collab-thread";
  const heading = document.createElement("div");
  heading.className = "collab-thread-heading";
  heading.textContent = "Planning chat";
  if (Number.isFinite(entry.discussionCount) && entry.discussionCount > messages.length) {
    const count = document.createElement("span");
    count.className = "collab-thread-count";
    count.textContent = `${entry.discussionCount.toLocaleString()} messages total`;
    heading.appendChild(count);
  }
  section.appendChild(heading);
  if (messages.length) {
    const list = document.createElement("div");
    list.className = "collab-thread-messages";
    messages.forEach((message) => {
      const row = document.createElement("div");
      row.className = "collab-thread-message";
      const meta = document.createElement("div");
      meta.className = "collab-thread-meta";
      const author = createProfileButton(message.username, {
        className: "social-profile-link",
        label: formatSocialDisplayName(message.username),
        stopPropagation: true
      });
      if (author) {
        meta.appendChild(author);
      } else {
        const fallback = document.createElement("span");
        fallback.textContent = formatSocialDisplayName(message.username);
        meta.appendChild(fallback);
      }
      const time = document.createElement("span");
      time.textContent = formatTimeAgo(message.createdAt) || "Just now";
      meta.appendChild(time);
      row.appendChild(meta);
      const body = document.createElement("p");
      body.textContent = message.body;
      row.appendChild(body);
      list.appendChild(row);
    });
    section.appendChild(list);
  } else {
    const empty = document.createElement("p");
    empty.className = "collab-thread-empty";
    empty.textContent = "No chat yet — drop a note to kick things off.";
    section.appendChild(empty);
  }
  if (canComment && entry.id) {
    const form = document.createElement("form");
    form.className = "collab-thread-form";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "input-base collab-thread-input";
    input.placeholder = "Suggest a pick, snack, or vibe…";
    input.maxLength = COLLAB_DISCUSSION_MAX_LENGTH;
    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.className = "btn-subtle";
    submitBtn.textContent = "Send";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      playUiClick();
      handleCollaborativeNoteSubmit(entry.id, input, submitBtn, form);
    });
    form.appendChild(input);
    form.appendChild(submitBtn);
    section.appendChild(form);
  }
  return section;
}

async function handleCollaborativeVoteAction(listId, tmdbId, vote, button, actionGroup) {
  if (!listId || !tmdbId) {
    return;
  }
  const buttons = actionGroup
    ? Array.from(actionGroup.querySelectorAll("button"))
    : button
    ? [button]
    : [];
  buttons.forEach((btn) => {
    btn.disabled = true;
  });
  setCollabStatus("Updating list votes…", "loading");
  try {
    await voteCollaborativeItemRemote({ listId, tmdbId, vote });
    setCollabStatus("Vote recorded.", "success");
    await refreshCollaborativeState();
  } catch (error) {
    setCollabStatus(
      error instanceof Error ? error.message : "Unable to update that vote right now.",
      "error"
    );
  } finally {
    buttons.forEach((btn) => {
      btn.disabled = false;
    });
  }
}

async function handleCollaborativeNoteSubmit(listId, input, button, form) {
  if (!listId || !input) {
    return;
  }
  const message = input.value.trim();
  if (!message) {
    input.focus();
    return;
  }
  const buttons = form ? Array.from(form.querySelectorAll("button")) : button ? [button] : [];
  buttons.forEach((btn) => {
    btn.disabled = true;
  });
  setCollabStatus("Sharing your note…", "loading");
  try {
    await postCollaborativeNoteRemote({ listId, body: message });
    input.value = "";
    setCollabStatus("Shared with your collaborators.", "success");
    await refreshCollaborativeState();
  } catch (error) {
    setCollabStatus(
      error instanceof Error ? error.message : "We couldn’t post that note right now.",
      "error"
    );
  } finally {
    buttons.forEach((btn) => {
      btn.disabled = false;
    });
  }
}

function buildCollaborativeInviteCard(entry) {
  const card = document.createElement("article");
  card.className = "collab-list-card collab-list-card--invite";

  const header = document.createElement("header");
  header.className = "collab-list-card-header";
  const title = document.createElement("h4");
  title.textContent = entry.name || "Collaborative list invite";
  header.appendChild(title);
  card.appendChild(header);

  const meta = document.createElement("div");
  meta.className = "collab-list-meta";
  const appendMetaText = (text) => {
    if (!text) {
      return;
    }
    if (meta.childNodes.length) {
      meta.appendChild(document.createTextNode(" • "));
    }
    meta.appendChild(document.createTextNode(text));
  };
  if (entry.owner) {
    appendMetaText("Owner: ");
    const ownerLink = createProfileButton(entry.owner, {
      className: "social-profile-link",
      label: `@${entry.owner}`,
      stopPropagation: true
    });
    if (ownerLink) {
      meta.appendChild(ownerLink);
    } else {
      meta.appendChild(document.createTextNode(`@${entry.owner}`));
    }
  }
  const invitedAt = formatTimeAgo(entry.invitedAt);
  if (invitedAt) {
    appendMetaText(`Invited ${invitedAt}`);
  }
  card.appendChild(meta);

  if (entry.description) {
    const desc = document.createElement("p");
    desc.className = "collab-list-desc";
    desc.textContent = entry.description;
    card.appendChild(desc);
  }

  const actions = document.createElement("div");
  actions.className = "collab-list-actions";
  const acceptBtn = document.createElement("button");
  acceptBtn.type = "button";
  acceptBtn.className = "btn-secondary";
  acceptBtn.textContent = "Accept";
  acceptBtn.addEventListener("click", () => {
    playUiClick();
    handleCollaboratorInviteDecision(entry.id, "accept", acceptBtn, actions);
  });
  const declineBtn = document.createElement("button");
  declineBtn.type = "button";
  declineBtn.className = "btn-subtle btn-subtle-danger";
  declineBtn.textContent = "Decline";
  declineBtn.addEventListener("click", () => {
    playUiClick();
    handleCollaboratorInviteDecision(entry.id, "decline", declineBtn, actions);
  });
  actions.appendChild(acceptBtn);
  actions.appendChild(declineBtn);
  card.appendChild(actions);

  return card;
}

function buildWatchPartyCard(entry, mode) {
  const card = document.createElement("article");
  card.className = "watch-party-card";
  card.dataset.mode = mode;
  const invitees = Array.isArray(entry.invitees) ? entry.invitees : [];

  const header = document.createElement("header");
  header.className = "watch-party-card-header";
  const title = document.createElement("h4");
  title.textContent = entry.movie && entry.movie.title ? entry.movie.title : "Watch party";
  header.appendChild(title);
  card.appendChild(header);

  const meta = document.createElement("div");
  meta.className = "watch-party-meta";
  const schedule = formatWatchPartyDate(entry.scheduledFor);
  if (schedule) {
    meta.appendChild(document.createTextNode(schedule));
  }
  if (entry.host) {
    if (meta.childNodes.length) {
      meta.appendChild(document.createTextNode(" • "));
    }
    meta.appendChild(document.createTextNode("Host: "));
    const hostLink = createProfileButton(entry.host, {
      className: "social-profile-link",
      label: `@${entry.host}`,
      stopPropagation: true
    });
    if (hostLink) {
      meta.appendChild(hostLink);
    } else {
      meta.appendChild(document.createTextNode(`@${entry.host}`));
    }
  }
  card.appendChild(meta);

  if (entry.note) {
    const note = document.createElement("p");
    note.className = "watch-party-note";
    note.textContent = entry.note;
    card.appendChild(note);
  }

  const username = state.session && state.session.username ? canonicalHandle(state.session.username) : null;
  const myInvite = invitees.find((invite) => canonicalHandle(invite.username) === username);
  if (mode === "upcoming" && username && entry.host !== username && myInvite) {
    const response = document.createElement("p");
    response.className = "watch-party-response";
    response.textContent = `You responded: ${formatPartyResponse(myInvite.response)}`;
    card.appendChild(response);
  }

  const lobby = buildWatchPartyLobby(entry);
  if (lobby) {
    card.appendChild(lobby);
  }

  if (mode === "upcoming") {
    const summary = buildWatchPartySummary(entry);
    if (summary) {
      card.appendChild(summary);
      card.classList.add("watch-party-card--past");
    }
  }

  if (mode === "invite") {
    const vibeField = document.createElement("div");
    vibeField.className = "watch-party-vibe-field";
    const vibeLabel = document.createElement("span");
    vibeLabel.className = "field-label";
    vibeLabel.textContent = "What snack or vibe are you bringing?";
    vibeField.appendChild(vibeLabel);
    const vibeInput = document.createElement("input");
    vibeInput.type = "text";
    vibeInput.className = "input-base input-text watch-party-vibe-input";
    vibeInput.placeholder = "Popcorn, neon drinks, cozy blankets…";
    vibeInput.maxLength = 80;
    vibeInput.value = myInvite && myInvite.bringing ? myInvite.bringing : "";
    vibeField.appendChild(vibeInput);
    card.appendChild(vibeField);

    const actions = document.createElement("div");
    actions.className = "watch-party-actions";
    const acceptBtn = document.createElement("button");
    acceptBtn.type = "button";
    acceptBtn.className = "btn-secondary";
    acceptBtn.textContent = "Accept";
    acceptBtn.addEventListener("click", () => {
      playUiClick();
      handleWatchPartyResponseAction(entry.id, "accept", acceptBtn, actions, vibeInput);
    });
    const maybeBtn = document.createElement("button");
    maybeBtn.type = "button";
    maybeBtn.className = "btn-subtle";
    maybeBtn.textContent = "Maybe";
    maybeBtn.addEventListener("click", () => {
      playUiClick();
      handleWatchPartyResponseAction(entry.id, "maybe", maybeBtn, actions, vibeInput);
    });
    const declineBtn = document.createElement("button");
    declineBtn.type = "button";
    declineBtn.className = "btn-subtle btn-subtle-danger";
    declineBtn.textContent = "Decline";
    declineBtn.addEventListener("click", () => {
      playUiClick();
      handleWatchPartyResponseAction(entry.id, "decline", declineBtn, actions, vibeInput);
    });
    actions.appendChild(acceptBtn);
    actions.appendChild(maybeBtn);
    actions.appendChild(declineBtn);
    card.appendChild(actions);
  }

  return card;
}

function buildWatchPartyLobby(entry) {
  const invitees = Array.isArray(entry && entry.invitees) ? entry.invitees : [];
  if (!invitees.length) {
    return null;
  }
  const lobby = document.createElement("div");
  lobby.className = "watch-party-lobby";
  const statusWrap = document.createElement("div");
  statusWrap.className = "watch-party-lobby-status";
  const groups = [
    { key: "accept", label: "Going", dataset: "going" },
    { key: "maybe", label: "Maybe", dataset: "maybe" },
    { key: "pending", label: "Waiting", dataset: "waiting" }
  ];
  groups.forEach((group) => {
    const members = invitees.filter((invite) => normalizePartyResponse(invite.response) === group.key);
    if (!members.length) {
      return;
    }
    const section = document.createElement("div");
    section.className = "watch-party-lobby-group";
    section.dataset.state = group.dataset;
    const label = document.createElement("span");
    label.className = "watch-party-lobby-label";
    label.textContent = `${group.label} (${members.length})`;
    section.appendChild(label);
    const chips = document.createElement("div");
    chips.className = "watch-party-lobby-chips";
    members.forEach((member) => {
      if (!member || !member.username) {
        return;
      }
      const chip = document.createElement("span");
      chip.className = "watch-party-lobby-chip";
      chip.dataset.state = group.dataset;
      chip.textContent = formatSocialDisplayName(member.username);
      if (member.bringing) {
        chip.title = member.bringing;
      }
      chips.appendChild(chip);
    });
    section.appendChild(chips);
    statusWrap.appendChild(section);
  });
  if (statusWrap.childNodes.length) {
    lobby.appendChild(statusWrap);
  }
  const vibeRow = buildWatchPartyBringingRow(invitees);
  if (vibeRow) {
    lobby.appendChild(vibeRow);
  }
  return lobby.childNodes.length ? lobby : null;
}

function buildWatchPartyBringingRow(invitees) {
  const entries = invitees
    .map((invite) => {
      const text = typeof invite.bringing === "string" ? invite.bringing.trim() : "";
      if (!text) {
        return null;
      }
      return { username: invite.username, text };
    })
    .filter(Boolean);
  if (!entries.length) {
    return null;
  }
  const row = document.createElement("div");
  row.className = "watch-party-bringing";
  const label = document.createElement("span");
  label.className = "watch-party-bringing-label";
  label.textContent = "Snacks & vibes";
  row.appendChild(label);
  const chips = document.createElement("div");
  chips.className = "watch-party-bringing-chips";
  entries.slice(0, 6).forEach((entry) => {
    const chip = document.createElement("span");
    chip.className = "watch-party-chip watch-party-chip--vibe";
    chip.textContent = `${formatSocialDisplayName(entry.username)}: ${entry.text}`;
    chips.appendChild(chip);
  });
  row.appendChild(chips);
  return row;
}

function buildWatchPartySummary(entry) {
  const scheduledAt = toTimestamp(entry && entry.scheduledFor);
  if (!scheduledAt || Date.now() < scheduledAt) {
    return null;
  }
  const invitees = Array.isArray(entry && entry.invitees) ? entry.invitees : [];
  const going = invitees.filter((invite) => normalizePartyResponse(invite.response) === "accept");
  const maybe = invitees.filter((invite) => normalizePartyResponse(invite.response) === "maybe");
  const pending = invitees.filter((invite) => normalizePartyResponse(invite.response) === "pending");
  const summary = document.createElement("div");
  summary.className = "watch-party-summary";
  const line = document.createElement("p");
  line.className = "watch-party-summary-line";
  const parts = [];
  parts.push(
    formatCountLabel(
      going.length,
      "1 friend joined",
      `${going.length} friends joined`,
      "No RSVPs marked as joined yet"
    )
  );
  if (maybe.length) {
    parts.push(`${maybe.length} maybe ${maybe.length === 1 ? "reply" : "replies"}`);
  }
  if (pending.length) {
    parts.push(`${pending.length} awaiting reply`);
  }
  line.textContent = parts.filter(Boolean).join(" • ");
  summary.appendChild(line);
  const prompt = document.createElement("p");
  prompt.className = "watch-party-summary-prompt";
  prompt.textContent = "Share a quick review to capture the vibe while it’s fresh.";
  summary.appendChild(prompt);
  const cta = document.createElement("button");
  cta.type = "button";
  cta.className = "btn-link watch-party-summary-cta";
  cta.textContent = "Leave a quick review";
  cta.addEventListener("click", () => {
    showToast({
      title: "Review this party",
      text: `Tell friends how ${entry.movie && entry.movie.title ? entry.movie.title : "the night"} went.`,
      icon: "📝"
    });
  });
  summary.appendChild(cta);
  return summary;
}

async function handleInviteCollaboratorAction(entry, button) {
  if (!entry || !entry.id) {
    return;
  }
  const username = window.prompt("Invite which username to collaborate?");
  if (!username) {
    return;
  }
  const trimmed = username.trim();
  if (!trimmed) {
    return;
  }
  const previousDisabled = button.disabled;
  button.disabled = true;
  setCollabStatus(`Inviting @${trimmed.toLowerCase()}…`, "loading");
  try {
    await inviteCollaboratorRemote({ listId: entry.id, username: trimmed });
    setCollabStatus(`Invite sent to @${trimmed.toLowerCase()}.`, "success");
    await refreshCollaborativeState();
  } catch (error) {
    setCollabStatus(error instanceof Error ? error.message : "Couldn’t send that invite.", "error");
  } finally {
    button.disabled = previousDisabled;
  }
}

async function handleCollaboratorInviteDecision(listId, decision, button, actionGroup) {
  if (!listId) {
    return;
  }
  const buttons = actionGroup ? Array.from(actionGroup.querySelectorAll("button")) : [button];
  buttons.forEach((btn) => {
    btn.disabled = true;
  });
  setCollabStatus(
    decision === "accept" ? "Joining collaborative list…" : "Declining invite…",
    "loading"
  );
  try {
    await respondCollaboratorInviteRemote({ listId, decision });
    setCollabStatus(
      decision === "accept" ? "You’re now a collaborator!" : "Invite declined.",
      "success"
    );
    await refreshCollaborativeState();
  } catch (error) {
    setCollabStatus(
      error instanceof Error ? error.message : "Couldn’t update the invite right now.",
      "error"
    );
  } finally {
    buttons.forEach((btn) => {
      btn.disabled = false;
    });
  }
}

async function handleWatchPartyResponseAction(partyId, response, button, actionGroup, vibeInput) {
  if (!partyId) {
    return;
  }
  const buttons = actionGroup ? Array.from(actionGroup.querySelectorAll("button")) : [button];
  buttons.forEach((btn) => {
    btn.disabled = true;
  });
  setCollabStatus("Updating watch party RSVP…", "loading");
  const bringing = vibeInput && typeof vibeInput.value === "string" ? vibeInput.value.trim() : "";
  try {
    await respondWatchPartyRemote({ partyId, response, bringing });
    setCollabStatus("Response recorded.", "success");
    await refreshCollaborativeState();
  } catch (error) {
    setCollabStatus(
      error instanceof Error ? error.message : "Couldn’t update your RSVP right now.",
      "error"
    );
  } finally {
    buttons.forEach((btn) => {
      btn.disabled = false;
    });
  }
}

function setCollabStatus(message, variant) {
  const statusEl = $("socialCollabStatus");
  if (!statusEl) {
    return;
  }
  if (message) {
    statusEl.textContent = message;
  } else {
    statusEl.textContent = "";
  }
  if (variant) {
    statusEl.dataset.variant = variant;
  } else {
    statusEl.removeAttribute("data-variant");
  }
  if (message) {
    const stamp = String(Date.now());
    statusEl.dataset.stamp = stamp;
    window.setTimeout(() => {
      if (statusEl.dataset.stamp === stamp) {
        statusEl.textContent = "";
        statusEl.removeAttribute("data-variant");
        delete statusEl.dataset.stamp;
      }
    }, 5000);
  } else {
    delete statusEl.dataset.stamp;
  }
}

function setSocialStatus(message, variant) {
  const statusEl = $("socialFollowStatus");
  if (!statusEl) {
    return;
  }
  if (message) {
    statusEl.textContent = message;
  } else {
    statusEl.textContent = "";
  }
  if (variant) {
    statusEl.dataset.variant = variant;
  } else {
    statusEl.removeAttribute("data-variant");
  }
}

function getFollowNoteValue() {
  return typeof state.followNote === "string" ? state.followNote.trim() : "";
}

function setFollowNoteValue(note) {
  if (typeof note !== "string") {
    state.followNote = "";
    return state.followNote;
  }
  const trimmed = note.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, MAX_FOLLOW_NOTE_LENGTH).trim();
  state.followNote = trimmed;
  return state.followNote;
}

function buildFollowNoteTemplate() {
  const username = state.session && state.session.username ? state.session.username : "";
  const displayName = username ? formatSocialDisplayName(username) : "a movie fan";
  return `Hey! It's ${displayName} from Smart Movie Match—let's swap watchlists!`;
}

async function renderInviteQr(link) {
  const qrImage = $("socialInviteQrImage");
  const downloadBtn = $("socialInviteQrDownload");
  const statusEl = $("socialInviteQrStatus");
  if (!qrImage || !downloadBtn) {
    return;
  }

  if (!link) {
    state.inviteQr = { link: "", dataUrl: "", generating: false };
    qrImage.hidden = true;
    qrImage.removeAttribute("src");
    downloadBtn.disabled = true;
    delete downloadBtn.dataset.downloadUrl;
    if (statusEl) {
      statusEl.textContent = "";
      statusEl.removeAttribute("data-variant");
    }
    return;
  }

  if (state.inviteQr.link === link && state.inviteQr.dataUrl && !state.inviteQr.generating) {
    qrImage.src = state.inviteQr.dataUrl;
    qrImage.hidden = false;
    downloadBtn.disabled = false;
    if (statusEl) {
      statusEl.textContent = "Scan to swap movie lists.";
      statusEl.dataset.variant = "success";
    }
    return;
  }

  const requestId = ++inviteQrRequest;
  state.inviteQr = { link, dataUrl: "", generating: true };
  downloadBtn.disabled = true;
  if (statusEl) {
    statusEl.textContent = "Generating QR code…";
    statusEl.dataset.variant = "loading";
  }

  try {
    const dataUrl = await generateInviteQrRemote(link);
    if (requestId !== inviteQrRequest) {
      return;
    }
    state.inviteQr = { link, dataUrl, generating: false };
    qrImage.src = dataUrl;
    qrImage.hidden = false;
    downloadBtn.disabled = false;
    downloadBtn.dataset.downloadUrl = dataUrl;
    if (statusEl) {
      statusEl.textContent = "Scan to swap movie lists.";
      statusEl.dataset.variant = "success";
    }
  } catch (error) {
    if (requestId !== inviteQrRequest) {
      return;
    }
    state.inviteQr = { link: "", dataUrl: "", generating: false };
    qrImage.hidden = true;
    qrImage.removeAttribute("src");
    downloadBtn.disabled = true;
    delete downloadBtn.dataset.downloadUrl;
    if (statusEl) {
      statusEl.textContent =
        error instanceof Error ? error.message : "Couldn't create a QR code right now.";
      statusEl.dataset.variant = "error";
    }
  }
}

function downloadInviteQr() {
  const dataUrl = $("socialInviteQrDownload")?.dataset.downloadUrl;
  if (!dataUrl) {
    return;
  }
  const filename = state.session && state.session.username
    ? `smart-movie-match-${state.session.username}-invite.png`
    : "smart-movie-match-invite.png";
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function extractHandlesFromCsv(text) {
  if (typeof text !== "string") {
    return [];
  }
  const lines = text.split(/\r?\n/);
  if (!lines.length) {
    return [];
  }
  const handles = new Set();
  let headerIndex = -1;
  lines.forEach((line, index) => {
    if (!line) {
      return;
    }
    const cells = splitCsvLine(line);
    if (!cells.length) {
      return;
    }
    if (index === 0) {
      const possibleHeaderIndex = cells.findIndex((cell) => /handle/i.test(cell));
      if (possibleHeaderIndex !== -1) {
        headerIndex = possibleHeaderIndex;
        return;
      }
    }
    if (headerIndex >= 0 && headerIndex < cells.length) {
      const normalized = canonicalHandle(cells[headerIndex]);
      if (normalized) {
        handles.add(normalized);
      }
      return;
    }
    cells.forEach((cell) => {
      const normalized = canonicalHandle(cell);
      if (normalized) {
        handles.add(normalized);
      }
    });
  });
  return Array.from(handles);
}

function splitCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current !== "" || line.endsWith(",")) {
    result.push(current.trim());
  }
  return result;
}

function updateSocialInviteLink(session = state.session) {
  const inviteLinkEl = $("socialInviteLink");
  const inviteCopyBtn = $("socialInviteCopyBtn");
  const inviteStatus = $("socialInviteStatus");
  if (!inviteLinkEl || !inviteCopyBtn) {
    return;
  }
  const hasSession = Boolean(session && session.token);
  if (!hasSession) {
    inviteLinkEl.value = "";
    inviteLinkEl.placeholder = "Sign in to get your invite link";
    inviteLinkEl.readOnly = true;
    inviteCopyBtn.disabled = true;
    if (inviteStatus) {
      inviteStatus.textContent = "";
      inviteStatus.removeAttribute("data-variant");
    }
    renderInviteQr("");
    return;
  }
  const shareUrl = new URL(window.location.href);
  shareUrl.hash = "";
  shareUrl.search = "";
  shareUrl.searchParams.set("follow", session.username);
  inviteLinkEl.value = shareUrl.toString();
  inviteLinkEl.readOnly = true;
  inviteLinkEl.placeholder = "";
  inviteCopyBtn.disabled = false;
  if (inviteStatus) {
    inviteStatus.textContent = "";
    inviteStatus.removeAttribute("data-variant");
  }
  renderInviteQr(inviteLinkEl.value);
}

function updateSocialHighlight(cardId, countId, noteId, count, messages = {}) {
  const card = $(cardId);
  const countEl = $(countId);
  const noteEl = $(noteId);
  if (!card || !countEl || !noteEl) {
    return;
  }
  const safeCount = Number.isFinite(count) ? Number(count) : 0;
  countEl.textContent = safeCount.toLocaleString();
  if (safeCount <= 0) {
    card.dataset.state = "empty";
    noteEl.textContent = formatHighlightMessage(messages.empty, safeCount);
    return;
  }
  card.dataset.state = "active";
  if (safeCount === 1) {
    noteEl.textContent =
      formatHighlightMessage(messages.singular, safeCount) ||
      formatHighlightMessage(messages.plural, safeCount);
    return;
  }
  noteEl.textContent =
    formatHighlightMessage(messages.plural, safeCount) ||
    formatHighlightMessage(messages.singular, safeCount);
}

function formatHighlightMessage(template, count) {
  if (!template) {
    return "";
  }
  if (typeof template === "function") {
    try {
      return template(count);
    } catch (error) {
      return "";
    }
  }
  return String(template);
}

function formatCountLabel(count, singularLabel, pluralLabel, zeroLabel = "") {
  if (count === 1) {
    return singularLabel;
  }
  if (count > 1) {
    return pluralLabel;
  }
  return zeroLabel;
}

function updateSocialCount(id, value) {
  const el = $(id);
  if (!el) {
    return;
  }
  const number = Number.isFinite(value) ? Number(value) : 0;
  el.textContent = number.toLocaleString();
}

function initSocialProfileOverlay() {
  if (socialProfileInitialized) {
    return;
  }
  socialProfileOverlay = $("socialProfileOverlay");
  socialProfileCloseBtn = $("socialProfileClose");
  socialProfileTitleEl = $("socialProfileTitle");
  socialProfileSubtitleEl = $("socialProfileSubtitle");
  socialProfileBodyEl = $("socialProfileBody");
  socialProfileStatusEl = $("socialProfileStatus");
  if (socialProfileOverlay) {
    socialProfileOverlay.addEventListener("click", (event) => {
      if (event.target === socialProfileOverlay) {
        closeSocialProfileOverlay();
      }
    });
  }
  if (socialProfileCloseBtn) {
    socialProfileCloseBtn.addEventListener("click", () => {
      playUiClick();
      closeSocialProfileOverlay();
    });
  }
  socialProfileInitialized = Boolean(socialProfileOverlay);
}

function isSocialProfileOpen() {
  return Boolean(socialProfileOverlay && socialProfileOverlay.hasAttribute("open"));
}

function openSocialProfile(username) {
  const normalized = canonicalHandle(username);
  if (!normalized) {
    return;
  }
  const profileUrl = new URL("peeruser.html", window.location.origin);
  profileUrl.searchParams.set("user", normalized);
  window.location.href = profileUrl.toString();
}

function closeSocialProfileOverlay() {
  if (!socialProfileOverlay) {
    return;
  }
  socialProfileOverlay.removeAttribute("open");
  socialProfileOverlay.setAttribute("aria-hidden", "true");
  socialProfileOverlay.hidden = true;
  socialProfileActiveUsername = null;
  socialProfileRequestId += 1;
  socialProfilePageLoaded = false;
  if (socialProfileBodyEl) {
    socialProfileBodyEl.innerHTML = "";
  }
  setSocialProfileStatus("", null);
  if (socialProfileReturnFocus && typeof socialProfileReturnFocus.focus === "function") {
    try {
      socialProfileReturnFocus.focus();
    } catch (error) {
      // ignore focus restoration errors
    }
  }
  socialProfileReturnFocus = null;
}

function setSocialProfileStatus(message, variant) {
  if (!socialProfileStatusEl) {
    return;
  }
  if (!message) {
    socialProfileStatusEl.textContent = "";
    socialProfileStatusEl.hidden = true;
    socialProfileStatusEl.removeAttribute("data-variant");
    return;
  }
  socialProfileStatusEl.textContent = message;
  socialProfileStatusEl.hidden = false;
  if (variant) {
    socialProfileStatusEl.dataset.variant = variant;
  } else {
    socialProfileStatusEl.removeAttribute("data-variant");
  }
}

function fetchSocialProfileDetails(username) {
  const normalized = canonicalHandle(username);
  if (!normalized) {
    return Promise.resolve(null);
  }
  return searchSocialUsers(normalized).then((results) => {
    if (!Array.isArray(results)) {
      return null;
    }
    return results.find((entry) => canonicalHandle(entry.username) === normalized) || null;
  });
}

function loadSocialProfileForPage(username) {
  const normalized = canonicalHandle(username);
  if (!normalized) {
    if (socialProfileBodyEl) {
      socialProfileBodyEl.innerHTML = "";
    }
    socialProfileActiveUsername = null;
    socialProfilePageLoaded = false;
    setSocialProfileStatus("Select a username to view a shared profile.", "muted");
    return;
  }
  socialProfileActiveUsername = normalized;
  socialProfilePageLoaded = false;
  if (socialProfileBodyEl) {
    socialProfileBodyEl.innerHTML = "";
  }
  if (socialProfileTitleEl) {
    socialProfileTitleEl.textContent = formatSocialDisplayName(normalized);
  }
  if (socialProfileSubtitleEl) {
    socialProfileSubtitleEl.textContent = `@${normalized}`;
  }
  setSocialProfileStatus(`Loading @${normalized}…`, "loading");
  const requestId = ++socialProfileRequestId;
  fetchSocialProfileDetails(normalized)
    .then((profile) => {
      if (requestId !== socialProfileRequestId || socialProfileActiveUsername !== normalized) {
        return;
      }
      if (!profile) {
        setSocialProfileStatus("We couldn’t find that profile right now.", "error");
        return;
      }
      renderSocialProfileContent(profile);
      setSocialProfileStatus("", null);
    })
    .catch((error) => {
      if (requestId !== socialProfileRequestId) {
        return;
      }
      const message = error && error.message
        ? String(error.message)
        : "We couldn’t load that profile right now.";
      setSocialProfileStatus(message, "error");
    });
}

function getSocialProfileQueryHandle() {
  const params = new URLSearchParams(window.location.search);
  const keys = ["user", "username", "handle"];
  for (const key of keys) {
    const value = params.get(key);
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function maybeReloadSocialProfilePage(options = {}) {
  if (!isSocialProfileContext()) {
    return;
  }
  const rawHandle = getSocialProfileQueryHandle();
  if (!rawHandle) {
    if (socialProfileBodyEl) {
      socialProfileBodyEl.innerHTML = "";
    }
    socialProfileActiveUsername = null;
    socialProfilePageLoaded = false;
    setSocialProfileStatus("Select a username from your activity feed to view their profile.", "muted");
    return;
  }
  const normalized = canonicalHandle(rawHandle);
  if (socialProfileSubtitleEl && normalized) {
    socialProfileSubtitleEl.textContent = `@${normalized}`;
  }
  if (!state.session || !state.session.token) {
    if (socialProfileBodyEl) {
      socialProfileBodyEl.innerHTML = "";
    }
    socialProfilePageLoaded = false;
    setSocialProfileStatus("Sign in to view friend profiles.", "error");
    return;
  }
  if (!options.force && socialProfilePageLoaded && normalized && normalized === socialProfileActiveUsername) {
    return;
  }
  loadSocialProfileForPage(normalized || rawHandle);
}

function renderSocialProfileContent(profile) {
  if (!socialProfileBodyEl) {
    return;
  }
  socialProfileBodyEl.innerHTML = "";
  socialProfilePageLoaded = true;
  const normalized = canonicalHandle(profile && profile.username ? profile.username : socialProfileActiveUsername);
  const displayName = profile && profile.displayName
    ? profile.displayName
    : formatSocialDisplayName(normalized);
  if (socialProfileTitleEl) {
    socialProfileTitleEl.textContent = displayName;
  }
  const subtitleParts = [];
  if (normalized) {
    subtitleParts.push(`@${normalized}`);
  }
  if (profile && profile.followsYou) {
    subtitleParts.push("Follows you");
  }
  const isFollowing = Array.isArray(state.followingUsers)
    ? state.followingUsers.some((handle) => canonicalHandle(handle) === normalized)
    : false;
  if (isFollowing) {
    subtitleParts.push("You follow");
  }
  if (socialProfileSubtitleEl) {
    socialProfileSubtitleEl.textContent = subtitleParts.join(" • ");
  }

  const contextBanner = buildPeerContextBanner({ displayName, isFollowing });
  if (contextBanner) {
    socialProfileBodyEl.appendChild(contextBanner);
  }

  const hero = buildPeerHeroSection({ profile, normalized, displayName, isFollowing });
  if (hero) {
    socialProfileBodyEl.appendChild(hero);
  }

  const mutualStrip = createMutualFollowersStrip(profile);
  if (mutualStrip) {
    socialProfileBodyEl.appendChild(mutualStrip);
  }

  const personaGrid = buildSocialPersonaGrid(profile, normalized, { includeCompatibility: false });
  if (personaGrid) {
    personaGrid.dataset.peeruserSection = "world";
  }
  const insight = buildPeerInsight(profile);
  const overlapColumn = buildPeerOverlapColumn(profile);
  const worldColumn = buildPeerWorldColumn({ personaGrid, insight });
  const layout = document.createElement("div");
  layout.className = "peeruser-layout-grid";
  let layoutHasContent = false;
  if (overlapColumn) {
    layout.appendChild(overlapColumn);
    layoutHasContent = true;
  }
  if (worldColumn) {
    layout.appendChild(worldColumn);
    layoutHasContent = true;
  }
  if (layoutHasContent) {
    socialProfileBodyEl.appendChild(layout);
  }

  const hasDetails = Boolean(contextBanner || hero || mutualStrip || layoutHasContent);

  if (!hasDetails) {
    const empty = document.createElement("p");
    empty.className = "social-profile-meta";
    empty.textContent = "No shared activity yet. Follow to start swapping recommendations.";
    socialProfileBodyEl.appendChild(empty);
  }
}

function buildPeerContextBanner({ displayName, isFollowing }) {
  const params = new URLSearchParams(window.location.search);
  const contextType = params.get("context") || params.get("notification");
  let message = "";
  let actionLabel = "";
  let actionTarget = "";
  let actionType = "";
  const safeName = displayName || "This movie fan";
  switch (contextType) {
    case "follow":
      message = `${safeName} recently followed you.`;
      if (!isFollowing) {
        actionLabel = "Follow back";
        actionType = "follow";
      }
      break;
    case "party":
      message = `${safeName} invited you to a watch party.`;
      actionLabel = "View invite";
      actionTarget = "parties";
      break;
    case "reply":
      message = `${safeName} replied to your review.`;
      actionLabel = "Jump to highlights";
      actionTarget = "world";
      break;
    default:
      break;
  }
  if (!message) {
    return null;
  }
  const banner = document.createElement("div");
  banner.className = "peeruser-context-banner";
  const label = document.createElement("strong");
  label.textContent = message;
  banner.appendChild(label);
  if (actionLabel) {
    const actionBtn = document.createElement("button");
    actionBtn.type = "button";
    actionBtn.className = "btn-secondary";
    actionBtn.textContent = actionLabel;
    actionBtn.addEventListener("click", () => {
      if (actionType === "follow") {
        const target = document.querySelector('[data-peeruser-action="follow"]');
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          window.setTimeout(() => {
            target.focus();
          }, 200);
        }
        return;
      }
      if (actionTarget) {
        focusPeeruserSection(actionTarget);
      }
    });
    banner.appendChild(actionBtn);
  }
  return banner;
}

function buildPeerHeroSection({ profile, normalized, displayName, isFollowing }) {
  if (!normalized && !displayName) {
    return null;
  }
  const hero = document.createElement("section");
  hero.className = "peeruser-hero";

  const identity = document.createElement("div");
  identity.className = "peeruser-hero-identity";
  const avatar = createPeeruserAvatar(displayName, normalized);
  identity.appendChild(avatar);
  const textBlock = document.createElement("div");
  textBlock.className = "peeruser-hero-text";
  const title = document.createElement("h2");
  title.textContent = displayName;
  textBlock.appendChild(title);
  if (normalized) {
    const handle = document.createElement("div");
    handle.className = "peeruser-hero-handle";
    handle.textContent = `@${normalized}`;
    textBlock.appendChild(handle);
  }
  const taglineText = buildPeerTagline(profile);
  if (taglineText) {
    const tagline = document.createElement("p");
    tagline.className = "peeruser-hero-tagline";
    tagline.textContent = taglineText;
    textBlock.appendChild(tagline);
  }
  const statSummary = buildPeerOverlapSummary(profile);
  if (statSummary) {
    const stats = document.createElement("p");
    stats.className = "peeruser-stat-row";
    stats.textContent = statSummary;
    textBlock.appendChild(stats);
  }
  identity.appendChild(textBlock);
  hero.appendChild(identity);

  const compatibilityBlock = createHeroCompatibilityBlock(profile);
  if (compatibilityBlock) {
    hero.appendChild(compatibilityBlock);
  }

  const actions = createPeerHeroActions({ normalized, isFollowing, displayName });
  if (actions) {
    hero.appendChild(actions);
  }

  return hero;
}

function createHeroCompatibilityBlock(profile) {
  const compatibility = computeTasteCompatibility(profile);
  if (!compatibility) {
    return null;
  }
  const block = document.createElement("div");
  block.className = "peeruser-hero-compat";
  const badge = document.createElement("div");
  badge.className = "peeruser-compat-badge";
  const score = document.createElement("span");
  score.className = "peeruser-compat-score";
  score.textContent = `${compatibility.score}%`;
  const tier = document.createElement("span");
  tier.className = "peeruser-compat-tier";
  tier.textContent = compatibility.tier;
  badge.appendChild(score);
  badge.appendChild(tier);
  block.appendChild(badge);
  const summary = document.createElement("p");
  summary.className = "peeruser-compat-copy";
  summary.textContent = compatibility.summary;
  block.appendChild(summary);
  if (compatibility.highlights.length) {
    const chips = document.createElement("div");
    chips.className = "peeruser-compat-chips";
    compatibility.highlights.slice(0, 3).forEach((text) => {
      const chip = document.createElement("span");
      chip.className = "peeruser-compat-chip";
      chip.textContent = text;
      chips.appendChild(chip);
    });
    block.appendChild(chips);
  }
  return block;
}

function buildPeerOverlapSummary(profile) {
  const favorites = normalizeStringArray(profile && profile.sharedFavorites);
  const genres = normalizeStringArray(profile && profile.sharedInterests);
  const watches = normalizeStringArray(profile && profile.sharedWatchHistory);
  const parties = normalizeStringArray(profile && profile.sharedWatchParties);
  const summaryParts = [];
  if (favorites.length) {
    summaryParts.push(`Shared favorites: ${favorites.length}`);
  }
  if (genres.length) {
    summaryParts.push(`Shared genres: ${genres.length}`);
  }
  if (watches.length) {
    summaryParts.push(`Recent overlap: ${watches.length}`);
  }
  if (parties.length) {
    summaryParts.push(`Watch parties: ${parties.length}`);
  }
  return summaryParts.join(" • ");
}

function buildPeerTagline(profile) {
  if (profile && profile.tagline) {
    return profile.tagline;
  }
  if (profile && profile.reason) {
    const parts = profile.reason.split("•");
    if (parts.length) {
      return parts[0].trim();
    }
    return profile.reason;
  }
  return "";
}

function createPeerHeroActions({ normalized, isFollowing, displayName }) {
  const container = document.createElement("div");
  container.className = "peeruser-hero-actions";
  if (normalized) {
    const followBtn = document.createElement("button");
    followBtn.type = "button";
    followBtn.dataset.peeruserAction = "follow";
    followBtn.id = "peerHeroFollowBtn";
    if (isFollowing) {
      followBtn.className = "btn-subtle btn-subtle-danger";
      followBtn.textContent = "Unfollow";
      followBtn.addEventListener("click", async () => {
        setSocialProfileStatus(`Removing @${normalized}…`, "loading");
        await handleUnfollowUser(normalized, followBtn);
        setSocialProfileStatus("", null);
      });
    } else {
      followBtn.className = "btn-secondary";
      followBtn.textContent = "Follow";
      followBtn.addEventListener("click", async () => {
        setSocialProfileStatus(`Following @${normalized}…`, "loading");
        await handleFollowFromList(normalized, followBtn);
        setSocialProfileStatus("", null);
      });
    }
    container.appendChild(followBtn);
  }
  const secondary = document.createElement("div");
  secondary.className = "peeruser-secondary-actions";
  const partyBtn = document.createElement("button");
  partyBtn.type = "button";
  partyBtn.className = "btn-subtle";
  partyBtn.textContent = "Invite to watch party";
  partyBtn.addEventListener("click", () => {
    handlePeerSecondaryAction("party", displayName);
  });
  secondary.appendChild(partyBtn);
  const collabBtn = document.createElement("button");
  collabBtn.type = "button";
  collabBtn.className = "btn-subtle";
  collabBtn.textContent = "Add to collaborative list";
  collabBtn.addEventListener("click", () => {
    handlePeerSecondaryAction("collab", displayName);
  });
  secondary.appendChild(collabBtn);
  container.appendChild(secondary);
  return container.childElementCount ? container : null;
}

function handlePeerSecondaryAction(type, displayName) {
  const noun = type === "party" ? "watch party" : "collaborative list";
  const icon = type === "party" ? "🎬" : "👥";
  showToast({
    title: "Coming soon",
    text: `We’ll connect you with ${displayName || "this friend"} once ${noun} invites are live.`,
    icon
  });
}

function createPeeruserAvatar(displayName, normalized) {
  const avatar = document.createElement("div");
  avatar.className = "peeruser-avatar";
  avatar.textContent = computePeerInitials(displayName || normalized);
  return avatar;
}

function computePeerInitials(value) {
  if (!value) {
    return "SM";
  }
  const cleaned = value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  if (cleaned) {
    return cleaned;
  }
  return value.slice(0, 2).toUpperCase();
}

function createMutualFollowersStrip(profile) {
  if (!profile || !Array.isArray(profile.mutualFollowers) || !profile.mutualFollowers.length) {
    return null;
  }
  const strip = document.createElement("div");
  strip.className = "peeruser-mutuals";
  strip.dataset.peeruserSection = "mutuals";
  const label = document.createElement("strong");
  label.textContent = `Mutual followers: ${profile.mutualFollowers.length}`;
  strip.appendChild(label);
  const avatars = document.createElement("div");
  avatars.className = "peeruser-mutual-avatars";
  profile.mutualFollowers.slice(0, 3).forEach((handle) => {
    const button = createProfileButton(handle, {
      className: "peeruser-mutual-avatar",
      ariaLabel: `View profile for ${formatSocialDisplayName(handle)}`,
      label: computePeerInitials(handle)
    });
    if (button) {
      avatars.appendChild(button);
    }
  });
  if (avatars.childElementCount) {
    strip.appendChild(avatars);
  }
  if (profile.mutualFollowers.length > 3) {
    const more = document.createElement("span");
    more.className = "peeruser-mutual-more";
    more.textContent = `+${profile.mutualFollowers.length - 3} more`;
    strip.appendChild(more);
  }
  return strip;
}

function buildPeerOverlapColumn(profile) {
  const favorites = normalizeStringArray(profile && profile.sharedFavorites);
  const genres = normalizeStringArray(profile && profile.sharedInterests);
  const watches = normalizeStringArray(profile && profile.sharedWatchHistory);
  const parties = normalizeStringArray(profile && profile.sharedWatchParties);
  const sections = [
    {
      title: "Shared favorites",
      values: favorites,
      variant: "favorite",
      key: "favorites",
      emptyText: "Add more favorites to find common ground."
    },
    {
      title: "Shared genres",
      values: genres,
      variant: "interest",
      key: "genres",
      emptyText: "Tap a genre to nudge recommendations."
    },
    {
      title: "Recently watched overlap",
      values: watches,
      variant: "watched",
      key: "watched",
      emptyText: "Log your watches to see real-time overlap."
    },
    {
      title: "Watch parties together",
      values: parties,
      variant: "party",
      key: "parties",
      emptyText: "No parties yet — invite them to one!"
    }
  ];
  const cards = sections
    .map((section) => createOverlapCard(section))
    .filter(Boolean);
  if (!cards.length) {
    return null;
  }
  const column = document.createElement("section");
  column.className = "peeruser-column peeruser-column--overlap";
  column.dataset.peeruserSection = "overlap";
  const heading = document.createElement("h3");
  heading.className = "peeruser-section-title";
  heading.textContent = "How you overlap";
  column.appendChild(heading);
  const grid = document.createElement("div");
  grid.className = "peeruser-overlap-grid";
  cards.forEach((card) => {
    grid.appendChild(card);
  });
  column.appendChild(grid);
  return column;
}

function createOverlapCard({ title, values, variant, emptyText, key }) {
  const list = normalizeStringArray(values);
  const card = document.createElement("article");
  card.className = "peeruser-overlap-card";
  if (key) {
    card.dataset.peeruserSection = key;
  }
  const heading = document.createElement("h4");
  heading.textContent = title;
  const count = document.createElement("span");
  count.className = "peeruser-overlap-count";
  count.textContent = `${list.length}`;
  heading.appendChild(count);
  card.appendChild(heading);
  if (list.length) {
    const wrap = document.createElement("div");
    wrap.className = "peeruser-chip-wrap";
    list.slice(0, 8).forEach((value) => {
      const chip = document.createElement("span");
      chip.className = "social-suggestion-tag";
      chip.dataset.variant = variant;
      chip.textContent = value;
      wrap.appendChild(chip);
    });
    card.appendChild(wrap);
  } else if (emptyText) {
    const empty = document.createElement("p");
    empty.className = "peeruser-overlap-empty";
    empty.textContent = emptyText;
    card.appendChild(empty);
  }
  return card;
}

function buildPeerInsight(profile) {
  const reason = typeof profile?.reason === "string" ? profile.reason.trim() : "";
  if (!reason) {
    return null;
  }
  const insight = document.createElement("article");
  insight.className = "peeruser-insight";
  insight.dataset.peeruserSection = "insight";
  const heading = document.createElement("h4");
  heading.textContent = "Why they’re in your orbit";
  insight.appendChild(heading);
  const copy = document.createElement("p");
  copy.textContent = reason;
  insight.appendChild(copy);
  return insight;
}

function buildPeerWorldColumn({ personaGrid, insight }) {
  const sections = [];
  if (personaGrid) {
    sections.push(personaGrid);
  }
  if (insight) {
    sections.push(insight);
  }
  if (!sections.length) {
    return null;
  }
  const column = document.createElement("section");
  column.className = "peeruser-column peeruser-column--world";
  column.dataset.peeruserSection = "world";
  const heading = document.createElement("h3");
  heading.className = "peeruser-section-title";
  heading.textContent = "Their lists & highlights";
  column.appendChild(heading);
  sections.forEach((section) => {
    column.appendChild(section);
  });
  return column;
}

function focusPeeruserSection(sectionKey) {
  if (!sectionKey) {
    return;
  }
  const target = document.querySelector(`[data-peeruser-section="${sectionKey}"]`);
  if (!target) {
    return;
  }
  target.scrollIntoView({ behavior: "smooth", block: "center" });
}

function buildSocialPersonaGrid(profile, normalizedHandle, options = {}) {
  const container = document.createElement("div");
  container.className = "social-persona-grid";
  const includeCompatibility = options.includeCompatibility !== false;
  const cards = [];
  if (includeCompatibility) {
    cards.push(createTasteCompatibilityCard(profile));
  }
  cards.push(createFriendshipStoryCard(profile));
  cards.push(createPinnedPersonaCard(profile, normalizedHandle));
  cards.forEach((card) => {
    if (card) {
      container.appendChild(card);
    }
  });
  return container.childElementCount ? container : null;
}

function createTasteCompatibilityCard(profile) {
  const compatibility = computeTasteCompatibility(profile);
  if (!compatibility) {
    return null;
  }
  const card = document.createElement("article");
  card.className = "social-persona-card social-persona-card--compat";

  const eyebrow = document.createElement("span");
  eyebrow.className = "social-persona-eyebrow";
  eyebrow.textContent = "Taste match";
  card.appendChild(eyebrow);

  const badge = document.createElement("div");
  badge.className = "social-taste-badge";
  const score = document.createElement("span");
  score.className = "social-taste-score";
  score.textContent = `${compatibility.score}%`;
  const tier = document.createElement("span");
  tier.className = "social-taste-tier";
  tier.textContent = compatibility.tier;
  badge.appendChild(score);
  badge.appendChild(tier);
  card.appendChild(badge);

  const summary = document.createElement("p");
  summary.className = "social-persona-copy";
  summary.textContent = compatibility.summary;
  card.appendChild(summary);

  if (compatibility.highlights.length) {
    const chips = document.createElement("div");
    chips.className = "social-persona-chips";
    compatibility.highlights.forEach((text) => {
      const chip = document.createElement("span");
      chip.className = "social-persona-chip";
      chip.textContent = text;
      chips.appendChild(chip);
    });
    card.appendChild(chips);
  }

  return card;
}

function computeTasteCompatibility(profile) {
  const favorites = normalizeStringArray(profile && profile.sharedFavorites);
  const genres = normalizeStringArray(profile && profile.sharedInterests);
  const watches = normalizeStringArray(profile && profile.sharedWatchHistory);
  const parties = normalizeStringArray(profile && profile.sharedWatchParties);
  const totalSignals = favorites.length + genres.length + watches.length + parties.length;
  if (!totalSignals) {
    return null;
  }
  const weighted = favorites.length * 4 + genres.length * 3 + watches.length * 2 + (parties.length ? 3 : 0);
  const normalized = Math.min(1, weighted / 18);
  const score = Math.max(45, Math.min(100, Math.round(40 + normalized * 55)));
  const tier = score >= 85
    ? "High match"
    : score >= 65
    ? "Strong vibe"
    : score >= 50
    ? "Familiar tastes"
    : "Still exploring";
  const summaryParts = [];
  if (genres.length) {
    summaryParts.push(`You both love ${formatFriendlyList(genres)}`);
  }
  if (favorites.length) {
    summaryParts.push(`Favorites overlap on ${formatFriendlyList(favorites)}`);
  }
  if (!summaryParts.length && watches.length) {
    summaryParts.push(`Recently aligned on ${formatFriendlyList(watches)}`);
  }
  if (parties.length) {
    summaryParts.push(`Joined ${formatPlural(parties.length, "watch party")}`);
  }
  const summary = summaryParts.slice(0, 2).join(" • ") || "Swap more favorites to sharpen this match.";
  const highlights = [];
  genres.slice(0, 2).forEach((genre) => highlights.push(genre));
  if (favorites.length) {
    highlights.push(`${favorites.length} shared favorite${favorites.length === 1 ? "" : "s"}`);
  }
  if (watches.length) {
    highlights.push(`${watches.length} overlapping watch${watches.length === 1 ? "" : "es"}`);
  }
  if (parties.length) {
    const label = parties.length === 1 ? "watch party" : "watch parties";
    highlights.push(`${parties.length} ${label}`);
  }
  return { score, tier, summary, highlights };
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => Boolean(value));
}

function formatFriendlyList(values, limit = 3) {
  const list = normalizeStringArray(values).slice(0, limit);
  if (!list.length) {
    return "";
  }
  if (list.length === 1) {
    return list[0];
  }
  if (list.length === 2) {
    return `${list[0]} and ${list[1]}`;
  }
  return `${list.slice(0, list.length - 1).join(", ")}, and ${list[list.length - 1]}`;
}

function createFriendshipStoryCard(profile) {
  const favorites = normalizeStringArray(profile && profile.sharedFavorites);
  const genres = normalizeStringArray(profile && profile.sharedInterests);
  const watches = normalizeStringArray(profile && profile.sharedWatchHistory);
  const parties = normalizeStringArray(profile && profile.sharedWatchParties);
  const total = favorites.length + genres.length + watches.length + parties.length;
  if (!total) {
    return null;
  }
  const card = document.createElement("article");
  card.className = "social-persona-card social-persona-card--story";

  const eyebrow = document.createElement("span");
  eyebrow.className = "social-persona-eyebrow";
  eyebrow.textContent = "Story of this friendship";
  card.appendChild(eyebrow);

  const statGrid = document.createElement("dl");
  statGrid.className = "social-story-stats";
  statGrid.appendChild(createStoryStat("Shared favorites", formatPlural(favorites.length, "film")));
  statGrid.appendChild(createStoryStat("Shared genres", formatPlural(genres.length, "genre")));
  statGrid.appendChild(createStoryStat("Recent overlap", formatPlural(watches.length, "watch", "watches")));
  statGrid.appendChild(createStoryStat("Watch parties", formatPlural(parties.length, "party", "parties")));
  card.appendChild(statGrid);

  const summaryText = buildFriendshipStorySummary({ favorites, genres, watches, parties });
  if (summaryText) {
    const summary = document.createElement("p");
    summary.className = "social-persona-copy";
    summary.textContent = summaryText;
    card.appendChild(summary);
  }

  return card;
}

function createStoryStat(label, value) {
  const wrapper = document.createElement("div");
  wrapper.className = "social-story-stat";
  const term = document.createElement("dt");
  term.textContent = label;
  const data = document.createElement("dd");
  data.textContent = value;
  wrapper.appendChild(term);
  wrapper.appendChild(data);
  return wrapper;
}

function formatPlural(count, singular, plural = "") {
  const number = Number.isFinite(count) ? Math.max(0, count) : 0;
  let word;
  if (number === 1) {
    word = singular;
  } else if (plural) {
    word = plural;
  } else if (singular.endsWith("s")) {
    word = singular;
  } else {
    word = `${singular}s`;
  }
  return `${number} ${word}`;
}

function buildFriendshipStorySummary({ favorites, genres, watches, parties }) {
  const phrases = [];
  if (favorites.length) {
    phrases.push(`Bonded over ${formatFriendlyList(favorites)}`);
  }
  if (watches.length) {
    phrases.push(`Logged ${formatPlural(watches.length, "recent overlap", "recent overlaps")}`);
  }
  if (genres.length && phrases.length < 2) {
    phrases.push(`Lean into ${formatFriendlyList(genres)}`);
  }
  if (parties.length) {
    phrases.push(`Joined ${formatPlural(parties.length, "watch party", "watch parties")}`);
  }
  return phrases.slice(0, 2).join(" • ");
}

function createPinnedPersonaCard(profile, normalizedHandle) {
  const pinned = buildPinnedPersonaContent(profile);
  const hasPins = Boolean(pinned.list || pinned.review);
  const card = document.createElement("article");
  card.className = "social-persona-card social-persona-card--pinned";

  const eyebrow = document.createElement("span");
  eyebrow.className = "social-persona-eyebrow";
  eyebrow.textContent = "Pinned by them";
  card.appendChild(eyebrow);

  if (pinned.list) {
    card.appendChild(createPinnedBlock("list", pinned.list, normalizedHandle));
  }
  if (pinned.review) {
    card.appendChild(createPinnedBlock("review", pinned.review, normalizedHandle));
  }
  if (!hasPins) {
    card.appendChild(createPinnedEmptyState());
  }
  return card;
}

function buildPinnedPersonaContent(profile) {
  if (!profile) {
    return { list: null, review: null };
  }
  const explicitList = normalizePinnedList(profile.pinnedList);
  const explicitReview = normalizePinnedReview(profile.pinnedReview);
  if (explicitList || explicitReview) {
    return { list: explicitList, review: explicitReview };
  }
  const favorites = normalizeStringArray(profile.sharedFavorites);
  const genres = normalizeStringArray(profile.sharedInterests);
  const watches = normalizeStringArray(profile.sharedWatchHistory);
  const listFallback = favorites.length
    ? {
        title: "Comfort queue",
        description: `Built around ${formatFriendlyList(favorites)}.`,
        highlights: favorites.slice(0, 4)
      }
    : genres.length
    ? {
        title: "Pinned mood board",
        description: `Stacked with ${formatFriendlyList(genres)} vibes.`,
        highlights: genres.slice(0, 4)
      }
    : null;
  const reviewFallback = watches.length
    ? {
        title: watches[0],
        excerpt: `They logged ${watches[0]} recently — ask for the full review.`
      }
    : favorites.length
    ? {
        title: favorites[0],
        excerpt: `They can talk for days about ${favorites[0]}.`
      }
    : null;
  return { list: listFallback, review: reviewFallback };
}

function normalizePinnedList(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  if (!title) {
    return null;
  }
  const description = typeof payload.description === "string" ? payload.description.trim() : "";
  const highlights = normalizeStringArray(payload.highlights || payload.items || payload.movies);
  const href = typeof payload.href === "string"
    ? payload.href
    : typeof payload.url === "string"
    ? payload.url
    : "";
  return {
    title,
    description,
    highlights,
    href
  };
}

function normalizePinnedReview(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  if (!title) {
    return null;
  }
  const excerpt = typeof payload.excerpt === "string" ? payload.excerpt.trim() : "";
  const rating = typeof payload.rating === "number" ? payload.rating : null;
  const href = typeof payload.href === "string"
    ? payload.href
    : typeof payload.url === "string"
    ? payload.url
    : "";
  return {
    title,
    excerpt,
    rating,
    href
  };
}

function createPinnedBlock(type, payload, normalizedHandle) {
  const block = document.createElement("div");
  block.className = "social-pinned-block";
  block.dataset.variant = type;

  const heading = document.createElement("div");
  heading.className = "social-pinned-label";
  heading.textContent = type === "list" ? "Pinned list" : "Pinned review";
  block.appendChild(heading);

  const title = document.createElement("p");
  title.className = "social-pinned-title";
  title.textContent = payload.title;
  block.appendChild(title);

  const detailText = payload.description || payload.excerpt || "";
  if (detailText) {
    const detail = document.createElement("p");
    detail.className = "social-persona-copy";
    detail.textContent = detailText;
    block.appendChild(detail);
  }

  if (Array.isArray(payload.highlights) && payload.highlights.length) {
    const highlights = document.createElement("div");
    highlights.className = "social-persona-chips";
    payload.highlights.slice(0, 4).forEach((text) => {
      const chip = document.createElement("span");
      chip.className = "social-persona-chip";
      chip.textContent = text;
      highlights.appendChild(chip);
    });
    block.appendChild(highlights);
  }

  if (typeof payload.rating === "number") {
    const rating = document.createElement("span");
    rating.className = "social-pinned-rating";
    rating.textContent = `${payload.rating.toFixed(1)} / 10`;
    block.appendChild(rating);
  }

  const link = createPinnedLink(payload.href, normalizedHandle, type);
  if (link) {
    block.appendChild(link);
  }

  return block;
}

function createPinnedEmptyState() {
  const empty = document.createElement("p");
  empty.className = "social-persona-copy";
  empty.textContent = "No pinned lists or reviews yet — start chatting to inspire one.";
  return empty;
}

function createPinnedLink(explicitHref, normalizedHandle, type) {
  const href = explicitHref || (normalizedHandle ? `peeruser.html?user=${encodeURIComponent(normalizedHandle)}#${type}` : "");
  if (!href) {
    return null;
  }
  const link = document.createElement("a");
  link.className = "social-pinned-link";
  link.href = href;
  link.textContent = type === "list" ? "View list" : "Read review";
  return link;
}

function buildSocialListItem({ username, isFollowing, followsYou, mutualFollowers, onPrimaryAction }) {
  const item = document.createElement("div");
  item.className = "social-follow-item";

  const row = document.createElement("div");
  row.className = "social-follow-row";
  item.appendChild(row);

  const primary = document.createElement("div");
  primary.className = "social-follow-primary";
  const profileTrigger = createProfileButton(username, {
    className: "social-profile-trigger",
    ariaLabel: `View profile for ${formatSocialDisplayName(username)}`
  });
  if (profileTrigger) {
    const name = document.createElement("span");
    name.className = "social-follow-name";
    name.textContent = formatSocialDisplayName(username);
    const handle = document.createElement("span");
    handle.className = "social-follow-handle";
    handle.textContent = `@${username}`;
    profileTrigger.appendChild(name);
    profileTrigger.appendChild(handle);
    primary.appendChild(profileTrigger);
  } else {
    const name = document.createElement("span");
    name.className = "social-follow-name";
    name.textContent = formatSocialDisplayName(username);
    const handle = document.createElement("span");
    handle.className = "social-follow-handle";
    handle.textContent = `@${username}`;
    primary.appendChild(name);
    primary.appendChild(handle);
  }
  row.appendChild(primary);

  const badges = document.createElement("div");
  badges.className = "social-follow-badges";
  if (followsYou) {
    const badge = document.createElement("span");
    badge.className = "social-follow-badge";
    badge.textContent = "Follows you";
    badges.appendChild(badge);
  }
  if (isFollowing) {
    const badge = document.createElement("span");
    badge.className = "social-follow-badge social-follow-badge--accent";
    badge.textContent = followsYou ? "Mutual" : "Following";
    badges.appendChild(badge);
  }
  if (badges.childElementCount) {
    row.appendChild(badges);
  }

  const actions = document.createElement("div");
  actions.className = "social-follow-actions";
  if (typeof onPrimaryAction === "function") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = isFollowing ? "btn-subtle social-unfollow-btn" : "btn-secondary";
    button.textContent = isFollowing ? "Unfollow" : "Follow back";
    button.addEventListener("click", () => {
      onPrimaryAction(button);
    });
    actions.appendChild(button);
  } else if (isFollowing) {
    const status = document.createElement("span");
    status.className = "social-follow-status";
    status.textContent = followsYou ? "Following each other" : "Following";
    actions.appendChild(status);
  }
  row.appendChild(actions);

  const detail = buildMutualDescription({ isFollowing, followsYou, mutualFollowers });
  if (detail) {
    const secondary = document.createElement("div");
    secondary.className = "social-follow-secondary";
    secondary.textContent = detail;
    item.appendChild(secondary);
  }

  return item;
}

function buildSuggestionCard(suggestion, onFollow) {
  const card = document.createElement("article");
  card.className = "social-suggestion-card";

  const header = document.createElement("div");
  header.className = "social-suggestion-header";
  card.appendChild(header);

  const identity = document.createElement("div");
  identity.className = "social-suggestion-identity";
  header.appendChild(identity);

  const nameBlock = createProfileButton(suggestion.username, {
    className: "social-profile-trigger social-suggestion-names",
    ariaLabel: `View profile for ${
      suggestion.displayName || formatSocialDisplayName(suggestion.username)
    }`
  });
  if (nameBlock) {
    const name = document.createElement("span");
    name.className = "social-follow-name";
    name.textContent = suggestion.displayName || formatSocialDisplayName(suggestion.username);
    const handle = document.createElement("span");
    handle.className = "social-follow-handle";
    handle.textContent = `@${suggestion.username}`;
    nameBlock.appendChild(name);
    nameBlock.appendChild(handle);
    identity.appendChild(nameBlock);
  } else {
    const name = document.createElement("span");
    name.className = "social-follow-name";
    name.textContent = suggestion.displayName || formatSocialDisplayName(suggestion.username);
    const handle = document.createElement("span");
    handle.className = "social-follow-handle";
    handle.textContent = `@${suggestion.username}`;
    const fallback = document.createElement("div");
    fallback.className = "social-suggestion-names";
    fallback.appendChild(name);
    fallback.appendChild(handle);
    identity.appendChild(fallback);
  }

  if (suggestion.followsYou) {
    const badges = document.createElement("div");
    badges.className = "social-follow-badges";
    const badge = document.createElement("span");
    badge.className = "social-follow-badge";
    badge.textContent = "Follows you";
    badges.appendChild(badge);
    identity.appendChild(badges);
  }

  const actions = document.createElement("div");
  actions.className = "social-suggestion-actions";
  const followBtn = document.createElement("button");
  followBtn.type = "button";
  followBtn.className = "btn-secondary";
  followBtn.textContent = "Follow";
  if (typeof onFollow === "function") {
    followBtn.addEventListener("click", () => {
      onFollow(followBtn);
    });
  } else {
    followBtn.disabled = true;
  }
  actions.appendChild(followBtn);
  header.appendChild(actions);

  if (suggestion.tagline) {
    const tagline = document.createElement("p");
    tagline.className = "social-suggestion-tagline";
    tagline.textContent = suggestion.tagline;
    card.appendChild(tagline);
  }

  if (suggestion.reason) {
    const reason = document.createElement("p");
    reason.className = "social-suggestion-reason";
    reason.textContent = suggestion.reason;
    card.appendChild(reason);
  }

  const tags = document.createElement("div");
  tags.className = "social-suggestion-tags";
  const mutualSummary = summarizeNames(suggestion.mutualFollowers, 2);
  if (mutualSummary) {
    const tag = document.createElement("span");
    tag.className = "social-suggestion-tag";
    tag.dataset.variant = "mutual";
    tag.textContent = `Mutual: ${mutualSummary}`;
    tags.appendChild(tag);
  }
  suggestion.sharedInterests.slice(0, 2).forEach((interest) => {
    const tag = document.createElement("span");
    tag.className = "social-suggestion-tag";
    tag.dataset.variant = "interest";
    tag.textContent = interest;
    tags.appendChild(tag);
  });
  suggestion.sharedFavorites.slice(0, 2).forEach((favorite) => {
    const tag = document.createElement("span");
    tag.className = "social-suggestion-tag";
    tag.dataset.variant = "favorite";
    tag.textContent = favorite;
    tags.appendChild(tag);
  });
  suggestion.sharedWatchHistory.slice(0, 2).forEach((title) => {
    const tag = document.createElement("span");
    tag.className = "social-suggestion-tag";
    tag.dataset.variant = "watched";
    tag.textContent = title;
    tags.appendChild(tag);
  });
  suggestion.sharedWatchParties.slice(0, 2).forEach((summary) => {
    const tag = document.createElement("span");
    tag.className = "social-suggestion-tag";
    tag.dataset.variant = "party";
    tag.textContent = summary;
    tags.appendChild(tag);
  });
  if (tags.childElementCount) {
    card.appendChild(tags);
  }

  return card;
}

function buildMutualDescription({ isFollowing, followsYou, mutualFollowers }) {
  if (isFollowing && followsYou) {
    return "You follow each other.";
  }
  const mutualSummary = summarizeNames(mutualFollowers, 3);
  if (mutualSummary) {
    return `Mutual followers: ${mutualSummary}`;
  }
  if (followsYou && !isFollowing) {
    return "They follow you. Follow back to swap recommendations.";
  }
  if (!followsYou && isFollowing) {
    return "You’ll see their highlights in discovery.";
  }
  return "";
}

function formatSocialDisplayName(username) {
  if (!username) {
    return "";
  }
  return username
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function summarizeNames(list, max = 2) {
  if (!Array.isArray(list) || !list.length) {
    return "";
  }
  const formatted = list
    .map((value) => formatSocialDisplayName(value))
    .filter(Boolean);
  if (!formatted.length) {
    return "";
  }
  if (formatted.length <= max) {
    return formatted.join(", ");
  }
  const visible = formatted.slice(0, max);
  return `${visible.join(", ")} +${formatted.length - max} more`;
}

function toTimestamp(value) {
  if (!value) {
    return 0;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 0;
  }
  return date.getTime();
}

function formatMovieCount(count) {
  const number = Number.isFinite(count) ? Number(count) : 0;
  const safe = Math.max(0, number);
  return `${safe} film${safe === 1 ? "" : "s"}`;
}

function formatTimeAgo(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) {
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 45) {
    return "moments ago";
  }
  if (diffSeconds < 90) {
    return "about a minute ago";
  }
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 14) {
    return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

function formatWatchPartyDate(value) {
  if (!value) {
    return "Scheduled soon";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Scheduled soon";
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatPartyResponse(response) {
  switch (response) {
    case "accept":
    case "accepted":
      return "Attending";
    case "maybe":
      return "Maybe";
    case "decline":
    case "declined":
      return "Declined";
    case "host":
      return "Host";
    default:
      return "Pending";
  }
}

function normalizePartyResponse(response) {
  const value = typeof response === "string" ? response.toLowerCase() : "";
  if (value === "accept" || value === "accepted") {
    return "accept";
  }
  if (value === "maybe") {
    return "maybe";
  }
  if (value === "decline" || value === "declined") {
    return "decline";
  }
  return "pending";
}

function renderNotificationCenter(payload = {}) {
  const notifications = Array.isArray(payload.notifications)
    ? payload.notifications
    : Array.isArray(state.notifications)
    ? state.notifications
    : [];
  state.notifications = notifications.slice();
  const unreadCount = typeof payload.unreadCount === "number"
    ? payload.unreadCount
    : countUnreadNotifications();
  const unreadSocial = countUnreadSocialNotifications(notifications);
  const hasSession = Boolean(state.session && state.session.token);
  updateSocialActivityIndicator(hasSession && unreadSocial > 0);

  // Keep the friends activity feed in sync with the latest notification payload
  // even if the notification UI isn't present on the current page.
  renderFriendsActivityFeed();

  const bell = $("notificationBell");
  const countEl = $("notificationCount");
  const panel = $("notificationPanel");
  const overlay = $("notificationOverlay");
  const listEl = $("notificationList");
  const emptyEl = $("notificationEmpty");
  if (!bell || !countEl || !panel || !listEl || !emptyEl) {
    return;
  }

  bell.hidden = !hasSession;
  if (!hasSession) {
    state.notificationPanelOpen = false;
    bell.setAttribute("aria-expanded", "false");
    countEl.hidden = true;
    listEl.innerHTML = "";
    listEl.hidden = true;
    emptyEl.hidden = false;
    panel.hidden = true;
    panel.classList.remove("is-visible");
    if (overlay) {
      overlay.classList.remove("is-visible");
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
    }
    return;
  }

  if (unreadCount > 0) {
    countEl.hidden = false;
    countEl.textContent = String(unreadCount);
    bell.classList.add("has-unread");
  } else {
    countEl.hidden = true;
    bell.classList.remove("has-unread");
  }
  listEl.innerHTML = "";
  if (!notifications.length) {
    listEl.hidden = true;
    emptyEl.hidden = false;
  } else {
    listEl.hidden = false;
    emptyEl.hidden = true;
    const groups = groupNotificationsForDisplay(notifications);
    groups.forEach((group) => {
      const section = document.createElement("section");
      section.className = "notification-group";
      const header = document.createElement("div");
      header.className = "notification-group-header";
      const title = document.createElement("span");
      title.className = "notification-group-title";
      title.textContent = group.title;
      header.appendChild(title);
      if (group.description) {
        const description = document.createElement("span");
        description.className = "notification-group-description";
        description.textContent = group.description;
        header.appendChild(description);
      }
      section.appendChild(header);
      group.items.forEach((note) => {
        const item = buildNotificationItem(note);
        if (item) {
          section.appendChild(item);
        }
      });
      listEl.appendChild(section);
    });
  }

  if (state.notificationPanelOpen) {
    panel.hidden = false;
    panel.classList.add("is-visible");
    bell.setAttribute("aria-expanded", "true");
    if (overlay) {
      overlay.hidden = false;
      overlay.classList.add("is-visible");
      overlay.setAttribute("aria-hidden", "false");
    }
  } else {
    panel.hidden = true;
    panel.classList.remove("is-visible");
    bell.setAttribute("aria-expanded", "false");
    if (overlay) {
      overlay.classList.remove("is-visible");
      overlay.setAttribute("aria-hidden", "true");
      overlay.hidden = true;
    }
  }
}

function toggleNotificationPanel() {
  if (!state.session || !state.session.token) {
    window.location.href = "login.html";
    return;
  }
  state.notificationPanelOpen = !state.notificationPanelOpen;
  renderNotificationCenter();
  if (state.notificationPanelOpen) {
    acknowledgeNotifications();
  }
}

function countUnreadNotifications() {
  if (!Array.isArray(state.notifications)) {
    return 0;
  }
  return state.notifications.filter((note) => !note || note.readAt ? false : true).length;
}

function openNotificationPanel() {
  if (state.notificationPanelOpen) {
    return;
  }
  state.notificationPanelOpen = true;
  renderNotificationCenter();
  acknowledgeNotifications();
}

function closeNotificationPanel() {
  if (!state.notificationPanelOpen) {
    return;
  }
  state.notificationPanelOpen = false;
  renderNotificationCenter();
}

function getNotificationIcon(type) {
  switch (type) {
    case "follow":
      return "🤝";
    case "mention":
      return "📣";
    case "review_like":
      return "👍";
    case "friend_review":
      return "📝";
    case "friend_watchlist":
      return "👀";
    case "friend_favorite":
      return "❤️";
    default:
      return "🔔";
  }
}

function formatNotificationTimestamp(timestamp) {
  if (!timestamp) {
    return "";
  }
  return formatSyncTime(timestamp);
}

function groupNotificationsForDisplay(notifications) {
  const buckets = { social: [], system: [] };
  notifications.forEach((note) => {
    if (!note) {
      return;
    }
    const category = getNotificationCategory(note);
    const key = category === "social" ? "social" : "system";
    buckets[key].push(note);
  });
  return [
    {
      key: "social",
      title: "New from your friends",
      description: "Follows, reviews & invites",
      items: buckets.social
    },
    {
      key: "system",
      title: "Account & sync",
      description: "Security alerts & sync status",
      items: buckets.system
    }
  ].filter((group) => group.items.length);
}

function buildNotificationItem(note) {
  if (!note) {
    return null;
  }
  const item = document.createElement("div");
  item.className = "notification-item";
  item.setAttribute("role", "listitem");
  if (!note.readAt) {
    item.dataset.unread = "true";
  } else {
    delete item.dataset.unread;
  }
  const icon = document.createElement("span");
  icon.className = "notification-item-icon";
  icon.textContent = getNotificationIcon(note.type);
  icon.setAttribute("aria-hidden", "true");

  const body = document.createElement("div");
  body.className = "notification-item-body";
  const message = document.createElement("div");
  message.className = "notification-item-message";
  const rawMessage = typeof note.message === "string" ? note.message.trim() : "";
  const messageText = rawMessage || "Activity update.";
  const actorHandle = typeof note.actor === "string" ? note.actor.trim() : "";
  if (actorHandle) {
    const actorLabel = formatSocialDisplayName(actorHandle) || `@${actorHandle}`;
    const actorLink = createInlineProfileLink(actorHandle, {
      label: actorLabel,
      className: "notification-actor-link"
    });
    if (actorLink) {
      message.appendChild(actorLink);
      const normalizedMessage = messageText;
      const startsWithActor = normalizedMessage.toLowerCase().startsWith(actorHandle.toLowerCase());
      const remainder = startsWithActor
        ? normalizedMessage.slice(actorHandle.length)
        : normalizedMessage;
      if (remainder) {
        const needsSpace = !startsWithActor && !remainder.startsWith(" ");
        message.appendChild(document.createTextNode(needsSpace ? ` ${remainder}` : remainder));
      }
    } else {
      message.textContent = messageText;
    }
  } else {
    message.textContent = messageText;
  }

  const meta = document.createElement("div");
  meta.className = "notification-item-meta";
  meta.textContent = formatNotificationTimestamp(note.createdAt);

  body.appendChild(message);
  if (meta.textContent) {
    body.appendChild(meta);
  }

  const action = buildNotificationAction(note);
  if (action) {
    const actionRow = document.createElement("div");
    actionRow.className = "notification-item-actions";
    actionRow.appendChild(action);
    body.appendChild(actionRow);
  }

  item.appendChild(icon);
  item.appendChild(body);
  return item;
}

function buildNotificationAction(note) {
  const type = typeof note?.type === "string" ? note.type.toLowerCase() : "";
  switch (type) {
    case "follow":
      return createNotificationActionButton("Open social hub", () => openProfileDeepLink("social"));
    case "collab_invite":
      return createNotificationActionButton("Review invite", () => openProfileDeepLink("collab"));
    case "collab_accept":
      return createNotificationActionButton("See the list", () => openProfileDeepLink("collab"));
    case "watch_party":
      return createNotificationActionButton("View watch party", () => openProfileDeepLink("party"));
    case "watch_party_update":
    case "watch_party_reminder":
      return createNotificationActionButton("Open RSVP", () => openProfileDeepLink("party"));
    default:
      break;
  }
  if (note && (note.movieTmdbId || note.movieImdbId || note.movieTitle)) {
    const label = type && (type.includes("review") || type === "mention")
      ? "View discussion"
      : "Open movie";
    return createNotificationActionButton(label, () => {
      openMovieContextFromNotification(note, { context: "community" });
    });
  }
  return null;
}

function createNotificationActionButton(label, handler) {
  if (typeof handler !== "function") {
    return null;
  }
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "notification-action-btn";
  btn.textContent = label;
  btn.addEventListener("click", () => {
    playUiClick();
    handler();
  });
  return btn;
}

function openMovieContextFromNotification(note, options = {}) {
  if (!note) {
    return;
  }
  if (!state.session || !state.session.token) {
    window.location.href = "login.html";
    return;
  }
  const url = new URL("index.html", window.location.origin);
  const tmdbId = note.movieTmdbId || note.tmdbId;
  const imdbId = note.movieImdbId || note.imdbId;
  if (tmdbId) {
    url.searchParams.set("movie", String(tmdbId));
  } else if (imdbId) {
    url.searchParams.set("imdb", String(imdbId));
  } else if (note.movieTitle) {
    url.searchParams.set("title", note.movieTitle);
  } else {
    openProfileDeepLink("social");
    return;
  }
  const context = options.context || "community";
  url.searchParams.set("context", context);
  url.searchParams.set("source", "notification");
  window.location.href = url.toString();
}

function updateSocialActivityIndicator(hasUnread) {
  const indicator = $("socialActivityIndicator");
  const profileBtn = $("accountProfileBtn");
  if (!indicator || !profileBtn) {
    return;
  }
  if (hasUnread) {
    indicator.hidden = false;
    indicator.setAttribute("aria-hidden", "false");
  } else {
    indicator.hidden = true;
    indicator.setAttribute("aria-hidden", "true");
  }
  profileBtn.classList.toggle("has-social-unread", hasUnread);
}

function getNotificationCategory(note) {
  const type = typeof note?.type === "string" ? note.type.toLowerCase() : "";
  return SOCIAL_NOTIFICATION_TYPES.has(type) ? "social" : "system";
}

function countUnreadSocialNotifications(list = state.notifications) {
  if (!Array.isArray(list)) {
    return 0;
  }
  return list.filter((entry) => entry && !entry.readAt && getNotificationCategory(entry) === "social").length;
}

async function handleUnfollowUser(username, button) {
  if (!state.session || !state.session.token) {
    window.location.href = "login.html";
    return;
  }

  const normalized = typeof username === "string" ? username.trim() : "";
  if (!normalized) {
    return;
  }

  const handle = `@${normalized.toLowerCase()}`;
  const confirmed = window.confirm("Are you sure you want to unfollow?");
  if (!confirmed) {
    return;
  }

  if (button) {
    button.disabled = true;
  }
  setSocialStatus(`Removing ${handle}…`, "loading");

  try {
    await unfollowUserByUsername(normalized);
    setSocialStatus(`Unfollowed ${handle}.`, "success");
  } catch (error) {
    setSocialStatus(
      error instanceof Error ? error.message : "Couldn’t unfollow that user right now.",
      "error"
    );
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

async function handleFollowFromList(username, button) {
  if (!state.session || !state.session.token) {
    window.location.href = "login.html";
    return;
  }

  const normalized = typeof username === "string" ? username.trim() : "";
  if (!normalized) {
    return;
  }

  if (button) {
    button.disabled = true;
  }
  setSocialStatus(`Following @${normalized.toLowerCase()}…`, "loading");

  try {
    await followUserByUsername(normalized, { note: getFollowNoteValue() });
    setSocialStatus(`Now following @${normalized.toLowerCase()}.`, "success");
  } catch (error) {
    setSocialStatus(
      error instanceof Error ? error.message : "Couldn’t follow that user right now.",
      "error"
    );
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

function updateSocialSectionVisibility(session) {
  const section = $("socialConnectionsSection");
  if (!section) {
    return;
  }
  const signedOutCard = $("socialConnectionsSignedOut");
  const content = $("socialConnectionsContent");
  const submitBtn = $("socialFollowSubmit");
  const hasSession = Boolean(session && session.token);

  if (signedOutCard) {
    signedOutCard.hidden = hasSession;
    signedOutCard.style.display = hasSession ? "none" : "";
  }
  if (content) {
    content.hidden = !hasSession;
    content.style.display = hasSession ? "" : "none";
  }
  if (submitBtn) {
    submitBtn.disabled = !hasSession;
  }
  updatePresenceStatusAvailability(session);
  if (!hasSession) {
    setSocialStatus("", null);
  }
  renderFriendsActivityFeed();
}

function hydrateFromSession(session) {
  if (!session) {
    state.sessionHydration = {
      token: null,
      lastPreferencesSync: null,
      lastWatchedSync: null,
      lastFavoritesSync: null
    };
    if (state.watchedSyncTimer) {
      window.clearTimeout(state.watchedSyncTimer);
      state.watchedSyncTimer = null;
    }
    if (state.favoritesSyncTimer) {
      window.clearTimeout(state.favoritesSyncTimer);
      state.favoritesSyncTimer = null;
    }
    state.watchedMovies = [];
    state.favorites = [];
    refreshWatchedUi();
    refreshFavoritesUi();
    return;
  }

  const shouldHydrateWatched =
    Array.isArray(session.watchedHistory) &&
    (
      state.sessionHydration.token !== session.token ||
      session.lastWatchedSync !== state.sessionHydration.lastWatchedSync
    );
  const shouldHydratePreferences =
    session.preferencesSnapshot &&
    (
      state.sessionHydration.token !== session.token ||
      session.lastPreferencesSync !== state.sessionHydration.lastPreferencesSync
    );
  const shouldHydrateFavorites =
    Array.isArray(session.favoritesList) &&
    (
      state.sessionHydration.token !== session.token ||
      session.lastFavoritesSync !== state.sessionHydration.lastFavoritesSync
    );

  if (shouldHydrateWatched) {
    applyWatchedHistory(session.watchedHistory);
  }

  if (shouldHydratePreferences) {
    applyPreferencesSnapshot(session.preferencesSnapshot);
  }

  if (shouldHydrateFavorites) {
    applyFavoritesList(session.favoritesList);
  }

  state.sessionHydration = {
    token: session.token,
    lastPreferencesSync: session.lastPreferencesSync || null,
    lastWatchedSync: session.lastWatchedSync || null,
    lastFavoritesSync: session.lastFavoritesSync || null
  };

  refreshProfileOverviewCallout();
}


function applyPreferencesSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }

  if (state.activePreset) {
    state.activePreset = null;
    clearActivePresetUi();
  }

  if (Array.isArray(snapshot.selectedGenres)) {
    const selected = new Set(snapshot.selectedGenres.map(String));
    document.querySelectorAll('input[name="genre"]').forEach((checkbox) => {
      checkbox.checked = selected.has(checkbox.value);
    });
  }

  updatePreferencesPreview();
}

function applyWatchedHistory(history) {
  if (!Array.isArray(history)) {
    return;
  }

  const normalized = history
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const title = typeof entry.title === "string" ? entry.title : "";
      if (!title) {
        return null;
      }
      const ratingValue =
        typeof entry.rating === "number"
          ? entry.rating
          : typeof entry.rating === "string" && entry.rating.trim() !== ""
          ? Number(entry.rating)
          : null;
      const rawLoggedAt =
        entry.loggedAt ||
        entry.logged_at ||
        entry.updatedAt ||
        entry.updated_at ||
        entry.syncedAt ||
        entry.synced_at ||
        entry.timestamp ||
        null;
      let loggedAt = null;
      if (typeof rawLoggedAt === "number" && Number.isFinite(rawLoggedAt)) {
        loggedAt = rawLoggedAt;
      } else if (typeof rawLoggedAt === "string" && rawLoggedAt.trim()) {
        const parsedDate = new Date(rawLoggedAt);
        if (!Number.isNaN(parsedDate.getTime())) {
          loggedAt = parsedDate.getTime();
        }
      }
      return {
        imdbID: entry.imdbID || null,
        title,
        year: typeof entry.year === "string" ? entry.year : "",
        genres: Array.isArray(entry.genres)
          ? entry.genres.map((genre) => (typeof genre === "string" ? genre : "")).filter(Boolean)
          : [],
        rating: Number.isFinite(ratingValue) ? ratingValue : null,
        poster:
          typeof entry.poster === "string" && entry.poster.trim() !== ""
            ? entry.poster
            : null,
        loggedAt
      };
    })
    .filter(Boolean);

  state.watchedMovies = normalized;
  refreshWatchedUi();
}

function applyFavoritesList(favorites) {
  if (!Array.isArray(favorites)) {
    return;
  }

  const normalizeTimestamp = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return null;
  };

  const normalized = favorites
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const title = typeof entry.title === "string" ? entry.title : "";
      if (!title) {
        return null;
      }
      return {
        imdbID: entry.imdbID || null,
        title,
        year: typeof entry.year === "string" ? entry.year : "",
        poster: typeof entry.poster === "string" ? entry.poster : null,
        overview: typeof entry.overview === "string" ? entry.overview : "",
        genres: Array.isArray(entry.genres)
          ? entry.genres
              .map((genre) => (typeof genre === "string" ? genre : ""))
              .filter(Boolean)
          : [],
        rating:
          typeof entry.rating === "number"
            ? entry.rating
            : typeof entry.rating === "string" && entry.rating.trim() !== ""
            ? Number(entry.rating)
            : null,
        addedAt:
          normalizeTimestamp(
            entry.addedAt ||
              entry.added_at ||
              entry.syncedAt ||
              entry.synced_at ||
              entry.updatedAt ||
              entry.updated_at ||
              null
          )
      };
    })
    .filter(Boolean);

  state.favorites = normalized;
  refreshFavoritesUi();
}

function syncPreferencesSnapshot(snapshot) {
  if (!snapshot) {
    return;
  }

  if (!state.session) {
    if (
      snapshot.selectedGenres.length ||
      (Array.isArray(snapshot.favoriteTitles) && snapshot.favoriteTitles.length) ||
      state.watchedMovies.length
    ) {
      setSyncStatus(
        "Sign in to sync your taste profile across devices.",
        "muted"
      );
    }
    return;
  }

  setSyncStatus("Syncing your taste profile…", "loading");
  persistPreferencesRemote(state.session, snapshot)
    .then(() => {
      setSyncStatus("Taste profile synced moments ago.", "success");
    })
    .catch((error) => {
      console.warn("Preference sync failed", error);
      setSyncStatus(
        "Couldn’t sync your preferences right now. We’ll try again automatically.",
        "error"
      );
    });
}

function scheduleWatchedSync() {
  if (!state.session) {
    if (state.watchedMovies.length) {
      setSyncStatus("Sign in to sync your watched history.", "muted");
    }
    return;
  }

  if (state.watchedSyncTimer) {
    window.clearTimeout(state.watchedSyncTimer);
  }

  setSyncStatus("Syncing your watched history…", "loading");

  state.watchedSyncTimer = window.setTimeout(async () => {
    try {
      await persistWatchedRemote(state.session, state.watchedMovies);
      setSyncStatus("Watched history synced moments ago.", "success");
    } catch (error) {
      console.warn("Watched sync failed", error);
      setSyncStatus(
        "Couldn’t sync watched history right now. We’ll try again automatically.",
        "error"
      );
    } finally {
      state.watchedSyncTimer = null;
    }
  }, 600);
}

function scheduleFavoritesSync() {
  if (!state.session) {
    if (state.favorites.length) {
      setSyncStatus("Sign in to sync your favorites.", "muted");
    }
    return;
  }

  if (state.favoritesSyncTimer) {
    window.clearTimeout(state.favoritesSyncTimer);
  }

  setSyncStatus("Syncing your favorites…", "loading");

  state.favoritesSyncTimer = window.setTimeout(async () => {
    try {
      await persistFavoritesRemote(state.session, state.favorites);
      setSyncStatus("Favorites synced moments ago.", "success");
    } catch (error) {
      console.warn("Favorites sync failed", error);
      setSyncStatus(
        "Couldn’t sync favorites right now. We’ll try again automatically.",
        "error"
      );
    } finally {
      state.favoritesSyncTimer = null;
    }
  }, 600);
}
