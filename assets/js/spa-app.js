import {
  fetchFromSearch,
  fetchFromOmdb,
  fetchFromTmdb,
  fetchTrendingMovies,
  fetchStreamingProviders
} from "./api.js";
import {
  discoverCandidateMovies,
  scoreAndSelectCandidates,
  fetchOmdbForCandidates
} from "./recommendations.js";
import {
  getConfigValue,
  getExperimentVariant,
  getFeatureFlag,
  refreshAppConfig,
  subscribeToConfig
} from "./app-config.js";
import { TMDB_GENRES } from "./config.js";
import { createMovieCard as createGlassMovieCard } from "./movie-card.js";
import {
  loadSession,
  loginUser,
  logoutSession,
  registerUser,
  subscribeToSession,
  persistFavoritesRemote,
  persistPreferencesRemote,
  updateProfile
} from "./auth.js";
import {
  initSocialFeatures,
  subscribeToSocialOverview,
  subscribeToNotifications,
  followUserByUsername,
  unfollowUserByUsername,
  subscribeToCollaborativeState,
  refreshCollaborativeState,
  recordLibraryActivity,
  listConversationsRemote,
  listConversationMessagesRemote,
  postConversationMessageRemote,
  startDirectConversationRemote,
  joinWatchPartyRemote,
  listWatchPartyMessagesRemote,
  postWatchPartyMessageRemote,
  searchSocialUsers,
  acknowledgeNotifications
} from "./social.js";
import { logRecommendationEvent, logSearchEvent } from "./analytics.js";

const defaultTabs = {
  friends: "feed",
  discover: "movies",
  home: "for-you",
  messages: "inbox",
  library: "favorites",
  profile: "overview"
};

const FAVORITE_DECADE_OPTIONS = [
  "1960s",
  "1970s",
  "1980s",
  "1990s",
  "2000s",
  "2010s",
  "2020s"
];

const STREAMING_PROVIDER_OPTIONS = [
  { value: "netflix", label: "Netflix" },
  { value: "prime-video", label: "Prime Video" },
  { value: "disney-plus", label: "Disney+" },
  { value: "max", label: "Max" },
  { value: "hulu", label: "Hulu" },
  { value: "apple-tv", label: "Apple TV+" },
  { value: "peacock", label: "Peacock" },
  { value: "paramount-plus", label: "Paramount+" }
];

const onboardingCompletionMap = {};
const ONBOARDING_STEPS = ["taste", "providers", "import"];
let authAvatarPreviewUrl = null;
let detachDocumentHandlers = null;

const state = {
  activeTabs: { ...defaultTabs },
  activeSection: "home",
  discoverFilter: "popular",
  discoverAbort: null,
  discoverSeriesAbort: null,
  discoverPeopleAbort: null,
  discoverDropdownAbort: null,
  trendingAbort: null,
  recommendationsAbort: null,
  recommendationSeed: Math.random(),
  homeRecommendations: [],
  trendingMovies: [],
  trendingWindow: "weekly",
  trendingLoading: false,
  trendingError: "",
  discoverPeople: [],
  peopleSearchActive: false,
  session: loadSession(),
  socialOverview: null,
  accountMenuOpen: false,
  authMode: "login",
  authPasswordVisible: false,
  authSubmitting: false,
  profileEditorOpen: false,
  profileEditorSaving: false,
  onboardingOpen: false,
  onboardingStep: ONBOARDING_STEPS[0],
  onboardingSubmitting: false,
  onboardingSelections: {
    favoriteGenres: [],
    favoriteDecades: [],
    streamingProviders: [],
    importChoice: "later"
  },
  onboardingDismissed: false,
  collabState: { watchParties: { upcoming: [], invites: [] } },
  favorites: [],
  watchedHistory: [],
  favoritesSaving: false,
  favoritesStatus: "",
  notifications: [],
  unreadNotifications: 0,
  notificationsLoaded: false,
  notificationMenuOpen: false,
  conversations: [],
  conversationsLoaded: false,
  conversationsLoading: false,
  conversationsError: "",
  conversationMessages: new Map(),
  conversationMessagesLoading: null,
  conversationMessagesError: "",
  conversationMessageSending: false,
  profileContextHandle: "",
  activeConversationId: null,
  activeWatchParty: null,
  watchPartyMessages: [],
  watchPartyMessagesPartyId: null,
  watchPartyMessagesLoading: false,
  watchPartyMessageSending: false,
  appConfig: {
    config: {},
    experiments: { experiments: [], assignments: {} },
    loaded: false,
    error: ""
  }
};

let unsubscribeNotifications = null;

function getUiLimit(key, fallback) {
  const value = getConfigValue(key, fallback);
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function applyFeatureFlags() {
  const watchPartyEnabled = getFeatureFlag("feature.watchParties.enabled", true);
  if (watchPartyPanel) {
    if (watchPartyEnabled) {
      watchPartyPanel.removeAttribute("hidden");
    } else {
      watchPartyPanel.setAttribute("hidden", "true");
    }
  }
  if (watchPartyEmpty) {
    if (watchPartyEnabled) {
      watchPartyEmpty.removeAttribute("hidden");
    } else {
      watchPartyEmpty.setAttribute("hidden", "true");
    }
  }

  const notificationsEnabled = getFeatureFlag("feature.notifications.enabled", true);
  if (notificationButton) {
    notificationButton.disabled = !notificationsEnabled;
    notificationButton.classList.toggle("is-disabled", !notificationsEnabled);
    notificationButton.setAttribute("aria-hidden", notificationsEnabled ? "false" : "true");
    if (!notificationsEnabled) {
      closeNotificationMenu();
    }
  }
  if (notificationMenu) {
    notificationMenu.toggleAttribute("hidden", !notificationsEnabled);
  }
  if (notificationDot) {
    notificationDot.toggleAttribute("hidden", !notificationsEnabled);
  }
  if (notificationCount) {
    notificationCount.toggleAttribute("hidden", !notificationsEnabled);
  }

  toggleSectionAvailability("messages", getFeatureFlag("feature.messages.enabled", true));
}

async function loadStreamingProviders() {
  try {
    const data = await fetchStreamingProviders({ token: state.session?.token });
    const providers = Array.isArray(data?.providers)
      ? data.providers.map(normalizeStreamingProvider)
      : [];
    const userProviders = Array.isArray(data?.userProviders)
      ? data.userProviders.filter(Boolean)
      : [];

    state.streamingProviders = providers;

    if (userProviders.length && !state.onboardingSelections.streamingProviders.length) {
      state.onboardingSelections.streamingProviders = userProviders;
    }
  } catch (error) {
    state.streamingProviders = STREAMING_PROVIDER_OPTIONS.map((provider) => ({
      key: provider.value,
      displayName: provider.label,
      brandColor: null
    }));
  } finally {
    ensureOnboardingOptionChips();
    updateOnboardingCounts();
  }
}

function toggleSectionAvailability(sectionKey, enabled) {
  const navButton = document.querySelector(`[data-section-button="${sectionKey}"]`);
  const panel = document.querySelector(`[data-section-panel="${sectionKey}"]`);
  if (navButton) {
    navButton.disabled = !enabled;
    navButton.classList.toggle("is-disabled", !enabled);
    if (!enabled) {
      navButton.setAttribute("aria-disabled", "true");
    } else {
      navButton.removeAttribute("aria-disabled");
    }
  }
  if (panel) {
    if (enabled) {
      panel.removeAttribute("hidden");
    } else {
      panel.setAttribute("hidden", "true");
    }
  }
  if (!enabled && state.activeSection === sectionKey) {
    setSection("home");
  }
}

const authRequiredViews = [
  {
    section: "friends",
    message: "Sign in to see your friends feed and requests."
  },
  {
    section: "messages",
    message: "Sign in to view your conversations."
  },
  {
    section: "library",
    message: "Sign in to view your favorites and watched titles."
  },
  {
    section: "profile",
    message: "Sign in to view your profile."
  },
  {
    section: "home",
    tab: "with-friends",
    message: "Sign in to plan watch parties with friends."
  }
];

const navButtons = document.querySelectorAll("[data-section-button]");
const sections = document.querySelectorAll("[data-section-panel]");
const tabGroups = document.querySelectorAll("[data-section-tabs]");
const discoverSearchInput = document.querySelector("[data-discover-search]");
const discoverDropdown = document.querySelector("[data-discover-dropdown]");
const discoverGrid = document.querySelector('[data-grid="discover-movies"]');
const discoverSeriesGrid = document.querySelector('[data-grid="discover-series"]');
const discoverPeopleList = document.querySelector('[data-list="discover-people"]');
const trendingRow = document.querySelector('[data-row="discover-trending"]');
const trendingStatus = document.querySelector('[data-trending-status]');
const trendingWindowSelect = document.querySelector('[data-trending-window]');
const homeRecommendationsRow = document.querySelector('[data-row="home-recommendations"]');
const tonightPickCard = document.querySelector("[data-tonight-pick]");
const groupPicksList = document.querySelector('[data-list="group-picks"]');
const watchPartyPanel = document.querySelector('[data-watch-party-panel]');
const watchPartyEmpty = document.querySelector('[data-watch-party-empty]');
const watchPartyTitle = document.querySelector('[data-watch-party-title]');
const watchPartyMeta = document.querySelector('[data-watch-party-meta]');
const watchPartyTime = document.querySelector('[data-watch-party-time]');
const watchPartyParticipants = document.querySelector('[data-watch-party-participants]');
const watchPartyJoinButton = document.querySelector('[data-watch-party-join]');
const watchPartyMessagesList = document.querySelector('[data-watch-party-messages]');
const watchPartyForm = document.querySelector('[data-watch-party-chat-form]');
const watchPartyInput = document.querySelector('[data-watch-party-input]');
const watchPartyStatus = document.querySelector('[data-watch-party-status]');
const conversationList = document.querySelector('[data-conversation-list]');
const conversationStatus = document.querySelector('[data-conversation-status]');
const conversationPreview = document.querySelector('[data-conversation-preview]');
const conversationPlaceholder = document.querySelector('[data-conversation-placeholder]');
const conversationThread = document.querySelector('[data-conversation-thread]');
const conversationPreviewTitle = document.querySelector('[data-conversation-preview-title]');
const conversationPreviewMeta = document.querySelector('[data-conversation-preview-meta]');
const conversationPreviewBody = document.querySelector('[data-conversation-preview-body]');
const conversationMessages = document.querySelector('[data-conversation-messages]');
const conversationThreadStatus = document.querySelector('[data-conversation-thread-status]');
const conversationForm = document.querySelector('[data-conversation-form]');
const conversationInput = document.querySelector('[data-conversation-input]');
const conversationSendButton = document.querySelector('[data-conversation-send]');
const favoritesPanel = document.querySelector('[data-favorites-panel]');
const favoritesList = document.querySelector('[data-favorites-list]');
const favoritesEmpty = document.querySelector('[data-favorites-empty]');
const favoritesStatus = document.querySelector('[data-favorites-status]');
const watchedPanel = document.querySelector('[data-watched-panel]');
const watchedList = document.querySelector('[data-watched-list]');
const watchedEmpty = document.querySelector('[data-watched-empty]');
const authOverlay = document.querySelector("[data-auth-overlay]");
const authForm = document.querySelector("[data-auth-form]");
const authStatus = document.querySelector("[data-auth-status]");
const authUsernameInput = document.querySelector("[data-auth-username]");
const authPasswordInput = document.querySelector("[data-auth-password]");
const authPasswordToggle = document.querySelector("[data-auth-password-toggle]");
const authDisplayNameRow = document.querySelector("[data-auth-display-name-row]");
const authDisplayNameInput = document.querySelector("[data-auth-display-name]");
const authModeButtons = document.querySelectorAll("[data-auth-mode]");
const authTitle = document.querySelector("[data-auth-title]");
const authSubtitle = document.querySelector("[data-auth-subtitle]");
const authOpenButton = document.querySelector("[data-auth-open]");
const authCloseButton = document.querySelector("[data-auth-close]");
const authSubmitButton = document.querySelector("[data-auth-submit]");
const authAvatarRow = document.querySelector("[data-auth-avatar-row]");
const authAvatarInput = document.querySelector("[data-auth-avatar-input]");
const authAvatarTrigger = document.querySelector("[data-auth-avatar-trigger]");
const authAvatarClear = document.querySelector("[data-auth-avatar-clear]");
const authAvatarPreview = document.querySelector("[data-auth-avatar-preview]");
const authAvatarPlaceholder = document.querySelector("[data-auth-avatar-placeholder]");
const accountMenu = document.querySelector("[data-account-menu]");
const accountToggle = document.querySelector("[data-account-toggle]");
const accountHandle = document.querySelector("[data-account-handle]");
const accountAvatar = document.querySelector("[data-account-avatar]");
const accountLogoutButton = document.querySelector("[data-account-logout]");
const accountProfileButton = document.querySelector("[data-account-profile]");
const accountSettingsButton = document.querySelector("[data-account-settings]");
const notificationButton = document.querySelector("[data-notification-toggle]");
const notificationMenu = document.querySelector("[data-notification-menu]");
const notificationList = document.querySelector("[data-notification-list]");
const notificationEmpty = document.querySelector("[data-notification-empty]");
const notificationStatus = document.querySelector("[data-notification-status]");
const notificationCount = document.querySelector("[data-notification-count]");
const notificationDot = document.querySelector("[data-notification-dot]");
const notificationMarkRead = document.querySelector("[data-notification-mark-read]");
const profileName = document.querySelector("[data-profile-name]");
const profileHandle = document.querySelector("[data-profile-handle]");
const profileBio = document.querySelector("[data-profile-bio]");
const profileLocation = document.querySelector("[data-profile-location]");
const profileWebsite = document.querySelector("[data-profile-website]");
const profileAvatar = document.querySelector("[data-profile-avatar]");
const profileStats = {
  favorites: document.querySelector('[data-profile-stat="favorites"]'),
  watched: document.querySelector('[data-profile-stat="watched"]'),
  followers: document.querySelector('[data-profile-stat="followers"]'),
  following: document.querySelector('[data-profile-stat="following"]')
};
const profilePrivacy = document.querySelector("[data-profile-privacy]");
const profileProgressFill = document.querySelector("[data-profile-progress-fill]");
const profileProgressLabel = document.querySelector("[data-profile-progress-label]");
const profileFavoritesPreview = document.querySelector("[data-profile-favorites-preview]");
const profileWatchedPreview = document.querySelector("[data-profile-watched-preview]");
const profileFavoritesCount = document.querySelector("[data-profile-favorites-count]");
const profileWatchedCount = document.querySelector("[data-profile-watched-count]");
const profileGenreChips = document.querySelector("[data-profile-genre-chips]");
const profileDecadeChips = document.querySelector("[data-profile-decade-chips]");
const profileProviderChips = document.querySelector("[data-profile-provider-chips]");
const profileAvailabilityStatus = document.querySelector("[data-profile-availability-status]");
const profileSettingsName = document.querySelector("[data-profile-settings-name]");
const profileSettingsHandle = document.querySelector("[data-profile-settings-handle]");
const profileSettingsPrivacy = document.querySelector("[data-profile-settings-privacy]");
const profileSettingsLocation = document.querySelector("[data-profile-settings-location]");
const profileSettingsWebsite = document.querySelector("[data-profile-settings-website]");
const profileSettingsProviders = document.querySelector("[data-profile-settings-providers]");
const profileSettingsGenres = document.querySelector("[data-profile-settings-genres]");
const profileSettingsTaste = document.querySelector("[data-profile-settings-taste]");
const profileSettingsActivity = document.querySelector("[data-profile-settings-activity]");
const profileEditOverlay = document.querySelector("[data-profile-editor]");
const profileEditForm = document.querySelector("[data-profile-editor-form]");
const profileEditStatus = document.querySelector("[data-profile-editor-status]");
const profileEditDisplayName = document.querySelector("[data-profile-editor-display-name]");
const profileEditBio = document.querySelector("[data-profile-editor-bio]");
const profileEditLocation = document.querySelector("[data-profile-editor-location]");
const profileEditWebsite = document.querySelector("[data-profile-editor-website]");
const profileEditPrivate = document.querySelector("[data-profile-editor-private]");
const profileGenreOptions = document.querySelector("[data-profile-genre-options]");
const profileDecadeOptions = document.querySelector("[data-profile-decade-options]");
const profileGenreCount = document.querySelector("[data-profile-genre-count]");
const profileDecadeCount = document.querySelector("[data-profile-decade-count]");
const profileEditOpenButton = document.querySelector("[data-profile-edit-open]");
const profileEditCloseButton = document.querySelector("[data-profile-editor-close]");
const profileEditCancelButton = document.querySelector("[data-profile-editor-cancel]");
const profileMessageButton = document.querySelector("[data-profile-message]");
const onboardingOverlay = document.querySelector("[data-onboarding]");
const onboardingSteps = document.querySelectorAll("[data-onboarding-step]");
const onboardingProgress = document.querySelector("[data-onboarding-progress]");
const onboardingStatus = document.querySelector("[data-onboarding-status]");
const onboardingCloseButton = document.querySelector("[data-onboarding-close]");
const onboardingBackButton = document.querySelector("[data-onboarding-back]");
const onboardingNextButton = document.querySelector("[data-onboarding-next]");
const onboardingFinishButton = document.querySelector("[data-onboarding-finish]");
const onboardingGenreOptions = document.querySelector("[data-onboarding-genre-options]");
const onboardingDecadeOptions = document.querySelector("[data-onboarding-decade-options]");
const onboardingProviderOptions = document.querySelector("[data-onboarding-provider-options]");
const onboardingGenreCount = document.querySelector("[data-onboarding-genre-count]");
const onboardingDecadeCount = document.querySelector("[data-onboarding-decade-count]");
const onboardingProviderCount = document.querySelector("[data-onboarding-provider-count]");
const onboardingImportOptions = document.querySelectorAll("[data-onboarding-import]");
const onboardingOpenButtons = document.querySelectorAll("[data-onboarding-open]");

subscribeToConfig((configState) => {
  state.appConfig = configState;
  applyFeatureFlags();
});

function hasActiveSession() {
  return Boolean(state.session && state.session.token);
}

function getAuthGuard(section, tab) {
  return authRequiredViews.find(
    (entry) =>
      entry.section === section &&
      (entry.tab === undefined || entry.tab === null || entry.tab === tab)
  );
}

function canAccessView(section, tab) {
  const guard = getAuthGuard(section, tab);
  return !guard || hasActiveSession();
}

function promptForAuth(section, tab) {
  const guard = getAuthGuard(section, tab);
  if (!guard) return;
  setAuthStatus(guard.message, "error");
  openAuthOverlay("login");
}

function ensureAccessibleSection() {
  const section = state.activeSection;
  const tab = state.activeTabs[section] || defaultTabs[section];
  if (canAccessView(section, tab)) return;
  setSection("discover");
}

function setSection(section) {
  const targetTab = state.activeTabs[section] || defaultTabs[section];
  if (!canAccessView(section, targetTab)) {
    promptForAuth(section, targetTab);
    return;
  }

  state.activeSection = section;
  navButtons.forEach((btn) => {
    const isActive = btn.dataset.sectionButton === section;
    btn.classList.toggle("is-active", isActive);
  });

  sections.forEach((panel) => {
    const isActive = panel.dataset.sectionPanel === section;
    panel.classList.toggle("is-active", isActive);
  });

  tabGroups.forEach((group) => {
    const isActive = group.dataset.sectionTabs === section;
    group.classList.toggle("is-active", isActive);
  });

  setTab(section, targetTab);

  if (section === "messages" && hasActiveSession()) {
    loadConversations();
  }
}

function setTab(section, tab) {
  if (!canAccessView(section, tab)) {
    promptForAuth(section, tab);
    return;
  }

  state.activeTabs[section] = tab;
  const group = document.querySelector(`[data-section-tabs="${section}"]`);
  const panels = document.querySelectorAll(
    `[data-section-panel="${section}"] [data-tab-panel]`
  );

  if (group) {
    group.querySelectorAll("[data-tab]").forEach((btn) => {
      const isActive = btn.dataset.tab === tab;
      btn.classList.toggle("is-active", isActive);
    });
  }

  panels.forEach((panel) => {
    const isActive = panel.dataset.tabPanel === tab;
    panel.classList.toggle("is-active", isActive);
  });
  if (section === "discover") {
    updateDiscoverPlaceholder();
  }
}

function createPoster(url) {
  const poster = document.createElement("div");
  poster.className = "poster";
  if (url) {
    poster.style.backgroundImage = `url(${url})`;
    poster.style.backgroundSize = "cover";
    poster.style.backgroundPosition = "center";
  }
  return poster;
}

function formatCompactNumber(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(numericValue);
}

function formatTrendScore(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "";
  if (Math.abs(numericValue) >= 100) return Math.round(numericValue).toString();
  if (Math.abs(numericValue) >= 10) return numericValue.toFixed(1);
  return numericValue.toFixed(2);
}

function buildGlassMovieCard(normalized, options = {}) {
  if (!normalized || !normalized.title) return null;

  const imdbScore = normalized.rating ? `${normalized.rating.toFixed(1)}/10` : "";
  const primaryLabel = imdbScore ? "TMDB" : "Score";

  let secondaryLabel = "RT";
  let rtScore = "";
  if (normalized.watchCount) {
    secondaryLabel = "Logs";
    rtScore = `${formatCompactNumber(normalized.watchCount)}`;
  } else if (normalized.trendScore) {
    secondaryLabel = "Buzz";
    rtScore = `${formatTrendScore(normalized.trendScore)}`;
  }

  const card = createGlassMovieCard({
    posterUrl: normalized.posterUrl || "",
    title: normalized.title,
    year: normalized.releaseYear || "",
    imdbScore,
    rtScore,
    primaryLabel,
    secondaryLabel,
    liked: isFavoriteMovie(normalized),
    watched: Boolean(options.watched),
    onToggleLike: async (isLiked) => {
      const result = await toggleFavorite(normalized);
      if (typeof card.setState === "function" && typeof result === "boolean" && result !== isLiked) {
        card.setState({ liked: result });
      }
    },
    onToggleWatched: (isWatched) => {
      if (typeof options.onWatched === "function") {
        options.onWatched(isWatched, card);
      }
    }
  });

  card.dataset.tmdbId = normalized.tmdbId ? String(normalized.tmdbId) : "";
  card.dataset.imdbId = normalized.imdbId || "";
  card.dataset.title = normalized.title ? normalized.title.trim().toLowerCase() : "";

  return card;
}

function decorateMovieCard(card, { meta, chips = [] } = {}) {
  const body = card?.querySelector(".movie-card__body");
  const actions = card?.querySelector(".movie-card__actions");
  if (!body || !actions) return;

  if (meta) {
    const metaRow = document.createElement("small");
    metaRow.className = "microcopy";
    metaRow.textContent = meta;
    body.insertBefore(metaRow, actions);
  }

  if (Array.isArray(chips) && chips.length) {
    const chipRow = document.createElement("div");
    chipRow.className = "movie-card__ratings";
    chips.forEach((chip) => chip && chipRow.append(chip));
    body.insertBefore(chipRow, actions);
  }

}

function formatGenres(genres = []) {
  if (!Array.isArray(genres)) return "";
  const names = genres
    .map((value) => {
      if (typeof value === "string") {
        return value.trim();
      }
      if (typeof value === "number") {
        return TMDB_GENRES[value] || "";
      }
      return "";
    })
    .filter(Boolean)
    .slice(0, 2);
  return names.join(" · ");
}

function buildMovieKey(movie) {
  if (!movie || typeof movie !== "object") return "";
  const imdbId = movie.imdbId || movie.imdbID || null;
  if (imdbId) {
    return String(imdbId).trim().toLowerCase();
  }
  const tmdbId = movie.tmdbId || movie.tmdbID || movie.id || null;
  return tmdbId ? String(tmdbId).trim() : "";
}

function initialsFromName(name = "") {
  if (!name) return "👤";
  const letters = name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return letters || "👤";
}

function setAvatarContent(element, { imageUrl = "", initials = "", label = "" } = {}) {
  if (!element) return;
  const cleanUrl = typeof imageUrl === "string" ? imageUrl.trim() : "";
  const displayInitials = initials || initialsFromName(label);
  const existingImg = element.querySelector("img");
  if (existingImg) {
    existingImg.remove();
  }
  element.style.backgroundImage = "";
  element.classList.toggle("has-image", Boolean(cleanUrl));
  if (cleanUrl) {
    const img = document.createElement("img");
    img.src = cleanUrl;
    img.alt = label || "User avatar";
    element.textContent = "";
    element.appendChild(img);
  } else {
    element.textContent = displayInitials || "";
  }
}

function canonicalHandle(value = "") {
  if (typeof value !== "string") return "";
  return value.replace(/^@/, "").trim().toLowerCase();
}

function sanitizeProfileText(value, maxLength = 200) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, maxLength);
}

function normalizeWebsite(value) {
  const trimmed = sanitizeProfileText(value || "", 200);
  if (!trimmed) return "";
  const normalized = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(normalized);
    return url.toString();
  } catch (error) {
    return "";
  }
}

function uniqueStringList(list, maxItems = 12, maxLength = 60) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const result = [];
  list.forEach((value) => {
    if (typeof value !== "string" && typeof value !== "number") return;
    const normalized = String(value).trim();
    if (!normalized || normalized.length > maxLength || seen.has(normalized)) return;
    seen.add(normalized);
    if (result.length < maxItems) {
      result.push(normalized);
    }
  });
  return result;
}

function readOnboardingLocalMap() {
  return { ...onboardingCompletionMap };
}

function isOnboardingLocallyComplete(username = "anonymous") {
  const map = readOnboardingLocalMap();
  return Boolean(map[username] || map.anonymous);
}

function markOnboardingCompleteLocally(username = "anonymous") {
  onboardingCompletionMap[username] = true;
}

function arraysEqual(a = [], b = []) {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function setAuthStatus(message, variant = "info") {
  if (!authStatus) return;
  authStatus.textContent = message || "";
  authStatus.classList.remove("error", "success");
  if (variant === "error") {
    authStatus.classList.add("error");
  }
  if (variant === "success") {
    authStatus.classList.add("success");
  }
}

function setAuthPasswordVisibility(visible = false) {
  if (!authPasswordInput) return;
  const isVisible = Boolean(visible);
  state.authPasswordVisible = isVisible;
  authPasswordInput.type = isVisible ? "text" : "password";
  if (authPasswordToggle) {
    authPasswordToggle.setAttribute("aria-pressed", isVisible ? "true" : "false");
    authPasswordToggle.setAttribute(
      "aria-label",
      isVisible ? "Hide password" : "Show password"
    );
    authPasswordToggle.classList.toggle("is-active", isVisible);
    authPasswordToggle.textContent = isVisible ? "🙈 Hide" : "👁 Show";
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

function clearAuthAvatarPreview() {
  if (authAvatarPreviewUrl) {
    URL.revokeObjectURL(authAvatarPreviewUrl);
    authAvatarPreviewUrl = null;
  }
  if (authAvatarPreview) {
    authAvatarPreview.style.removeProperty("--avatar-preview-image");
    authAvatarPreview.classList.remove("has-image");
  }
  if (authAvatarPlaceholder) {
    authAvatarPlaceholder.hidden = false;
  }
  if (authAvatarInput) {
    authAvatarInput.value = "";
  }
}

function applyAuthAvatarPreview(file) {
  if (!file || !authAvatarPreview) return;
  clearAuthAvatarPreview();
  const objectUrl = URL.createObjectURL(file);
  authAvatarPreviewUrl = objectUrl;
  authAvatarPreview.style.setProperty("--avatar-preview-image", `url(${objectUrl})`);
  authAvatarPreview.classList.add("has-image");
  if (authAvatarPlaceholder) {
    authAvatarPlaceholder.hidden = true;
  }
}

function renderWebsiteLink(element, url, fallbackText = "Website not added") {
  if (!element) return;
  element.innerHTML = "";
  const normalized = typeof url === "string" ? url.trim() : "";
  if (normalized) {
    const link = document.createElement("a");
    link.href = normalized;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = normalized.replace(/^https?:\/\//i, "");
    element.append(link);
  } else {
    element.textContent = fallbackText;
  }
}

function setAuthMode(mode) {
  state.authMode = mode === "signup" ? "signup" : "login";
  authModeButtons.forEach((btn) => {
    const isActive = btn.dataset.authMode === state.authMode;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  if (authDisplayNameRow) {
    authDisplayNameRow.classList.toggle("is-hidden", state.authMode !== "signup");
  }
  if (authAvatarRow) {
    const isSignup = state.authMode === "signup";
    authAvatarRow.classList.toggle("is-hidden", !isSignup);
    if (!isSignup) {
      clearAuthAvatarPreview();
    }
  }
  if (authTitle) {
    authTitle.textContent =
      state.authMode === "signup"
        ? "Create your Smart Movie Match account"
        : "Sign in to Smart Movie Match";
  }
  if (authSubtitle) {
    authSubtitle.textContent =
      state.authMode === "signup"
        ? "Add a display name and avatar so friends recognize you."
        : "Sign in to keep your favorites, diaries, and parties in sync.";
  }
  if (authPasswordInput) {
    authPasswordInput.autocomplete =
      state.authMode === "signup" ? "new-password" : "current-password";
  }
}

function openAuthOverlay(mode = state.authMode) {
  setAuthMode(mode);
  setAuthStatus("");
  setAuthPasswordVisibility(false);
  state.authSubmitting = false;
  if (authOverlay) {
    authOverlay.hidden = false;
    authOverlay.classList.add("is-visible");
  }
  if (authUsernameInput) {
    authUsernameInput.focus();
  }
}

function closeAuthOverlay() {
  if (!authOverlay) return;
  authOverlay.classList.remove("is-visible");
  authOverlay.hidden = true;
}

function toggleAccountMenu(forceOpen = null) {
  if (!state.session || !state.session.token) return;
  const next = forceOpen === null ? !state.accountMenuOpen : Boolean(forceOpen);
  state.accountMenuOpen = next;
  if (accountMenu) {
    accountMenu.classList.toggle("is-open", next);
  }
  if (accountToggle) {
    accountToggle.setAttribute("aria-expanded", next ? "true" : "false");
  }
}

function updateAccountUi(session) {
  const previousUsername = state.session && state.session.username;
  state.session = session || null;
  const hasSession = Boolean(state.session && state.session.token);
  if (authOpenButton) {
    authOpenButton.classList.toggle("is-hidden", hasSession);
  }
  if (accountToggle) {
    accountToggle.classList.toggle("is-visible", hasSession);
    accountToggle.setAttribute("aria-expanded", hasSession && state.accountMenuOpen ? "true" : "false");
  }
  if (accountMenu && !hasSession) {
    accountMenu.classList.remove("is-open");
    state.accountMenuOpen = false;
  }
  if (accountHandle) {
    accountHandle.textContent = hasSession && state.session.username
      ? `@${state.session.username}`
      : "@guest";
  }
  if (accountAvatar) {
    const name = hasSession ? state.session.displayName || state.session.username : "Guest";
    setAvatarContent(accountAvatar, {
      imageUrl: hasSession ? state.session.avatarUrl : "",
      initials: initialsFromName(name),
      label: `${name} avatar`
    });
  }

  if (notificationButton) {
    notificationButton.disabled = !hasSession;
    notificationButton.setAttribute("aria-disabled", hasSession ? "false" : "true");
  }
  if (!hasSession) {
    resetNotificationsUi();
  } else {
    renderNotificationBadge();
  }

  if (!hasSession) {
    ensureAccessibleSection();
    closeOnboarding(false);
    state.onboardingDismissed = false;
  }

  if (hasSession && previousUsername !== state.session.username) {
    state.onboardingDismissed = false;
  }

  renderProfileOverview();
}

function setNotificationStatus(message, variant = "") {
  if (!notificationStatus) return;
  notificationStatus.textContent = message || "";
  if (variant) {
    notificationStatus.dataset.variant = variant;
  } else {
    notificationStatus.removeAttribute("data-variant");
  }
}

function countUnreadNotificationsLocal(list = state.notifications) {
  if (!Array.isArray(list)) return 0;
  return list.filter((entry) => entry && !entry.readAt).length;
}

function formatTitleCase(text = "") {
  return text
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatNotificationMeta(entry) {
  const parts = [];
  if (entry.actor) {
    parts.push(`@${canonicalHandle(entry.actor)}`);
  }
  if (entry.type) {
    parts.push(formatTitleCase(String(entry.type).replace(/[-_]/g, " ")));
  }
  parts.push(formatRelativeTimestamp(entry.createdAt));
  return parts.filter(Boolean).join(" · ");
}

function renderNotificationBadge() {
  if (!notificationButton) return;
  const count = Math.max(0, Number(state.unreadNotifications) || 0);
  notificationButton.classList.toggle("is-active", state.notificationMenuOpen);
  notificationButton.setAttribute("aria-expanded", state.notificationMenuOpen ? "true" : "false");
  notificationButton.setAttribute(
    "aria-label",
    count > 0 ? `Open notifications (${count} unread)` : "Open notifications"
  );
  if (notificationCount) {
    notificationCount.textContent = count > 99 ? "99+" : String(count);
    notificationCount.hidden = count <= 0;
  }
  if (notificationDot) {
    notificationDot.hidden = count <= 0;
  }
  if (!hasActiveSession()) {
    notificationButton.disabled = true;
    notificationButton.setAttribute("aria-disabled", "true");
  } else {
    notificationButton.disabled = false;
    notificationButton.removeAttribute("aria-disabled");
  }
}

function renderNotificationList() {
  if (!notificationList || !notificationEmpty) return;
  notificationList.innerHTML = "";
  const notifications = Array.isArray(state.notifications)
    ? [...state.notifications].sort(
        (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
      )
    : [];
  if (!notifications.length) {
    notificationEmpty.hidden = false;
    return;
  }
  notificationEmpty.hidden = true;
  notifications.forEach((entry) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "notification-item";
    if (!entry.readAt) {
      item.dataset.unread = "true";
    }
    const title = document.createElement("div");
    title.className = "notification-item-title";
    title.textContent = entry.message || "New activity";
    const meta = document.createElement("div");
    meta.className = "notification-item-meta";
    const typePill = document.createElement("span");
    typePill.className = "pill";
    typePill.textContent = entry.type ? formatTitleCase(entry.type.replace(/[-_]/g, " ")) : "Activity";
    const metaText = document.createElement("span");
    metaText.textContent = formatNotificationMeta(entry);
    meta.append(typePill, metaText);
    item.append(title, meta);
    item.addEventListener("click", () => handleNotificationClick(entry));
    notificationList.append(item);
  });
}

function markNotificationAsRead(notificationId) {
  if (!notificationId) return;
  const now = new Date().toISOString();
  let hasChanged = false;
  state.notifications = state.notifications.map((entry) => {
    if (entry.id === notificationId && !entry.readAt) {
      hasChanged = true;
      return { ...entry, readAt: now };
    }
    return entry;
  });
  if (hasChanged) {
    state.unreadNotifications = countUnreadNotificationsLocal();
    renderNotificationBadge();
    renderNotificationList();
  }
}

function maybeNavigateForNotification(entry) {
  if (!entry || !entry.type) return;
  const type = String(entry.type).toLowerCase();
  if (type.includes("message")) {
    setSection("messages");
  } else if (type.includes("party")) {
    setSection("home");
    setTab("home", "with-friends");
  } else if (type.includes("follow") || type.includes("friend")) {
    setSection("friends");
    setTab("friends", "requests");
  } else if (type.includes("review")) {
    setSection("friends");
    setTab("friends", "feed");
  }
}

function handleNotificationClick(entry) {
  if (!entry) return;
  if (!hasActiveSession()) {
    setAuthStatus("Sign in to view notifications.", "error");
    openAuthOverlay("login");
    return;
  }
  markNotificationAsRead(entry.id);
  toggleNotificationMenu(false);
  acknowledgeNotifications();
  maybeNavigateForNotification(entry);
}

function handleMarkAllNotificationsRead() {
  if (!hasActiveSession()) {
    setAuthStatus("Sign in to view notifications.", "error");
    openAuthOverlay("login");
    return;
  }
  if (!state.notifications.length) return;
  const now = new Date().toISOString();
  state.notifications = state.notifications.map((entry) => ({ ...entry, readAt: entry.readAt || now }));
  state.unreadNotifications = 0;
  renderNotificationBadge();
  renderNotificationList();
  acknowledgeNotifications();
}

function toggleNotificationMenu(forceOpen = null) {
  if (!hasActiveSession()) {
    setAuthStatus("Sign in to view notifications.", "error");
    openAuthOverlay("login");
    return;
  }
  const next = forceOpen === null ? !state.notificationMenuOpen : Boolean(forceOpen);
  state.notificationMenuOpen = next;
  if (notificationMenu) {
    notificationMenu.classList.toggle("is-open", next);
  }
  renderNotificationBadge();
  if (next && !state.notificationsLoaded) {
    setNotificationStatus("Loading notifications…");
  } else if (!next) {
    setNotificationStatus("");
  }
}

function closeNotificationMenu() {
  if (!state.notificationMenuOpen) return;
  toggleNotificationMenu(false);
}

function resetNotificationsUi() {
  state.notifications = [];
  state.unreadNotifications = 0;
  state.notificationsLoaded = false;
  state.notificationMenuOpen = false;
  if (notificationMenu) {
    notificationMenu.classList.remove("is-open");
  }
  renderNotificationBadge();
  renderNotificationList();
  setNotificationStatus("");
}

function mapStreamingProviderLabel(value) {
  if (!value) return "";
  const normalized = String(value).trim();
  const fromState = (state.streamingProviders || []).find((provider) => provider.key === normalized);
  if (fromState) return fromState.displayName || fromState.label || fromState.key || normalized;
  const fallback = STREAMING_PROVIDER_OPTIONS.find((option) => option.value === normalized);
  return (fallback && fallback.label) || normalized;
}

function renderProfileChipCollection(host, values = [], emptyText = "") {
  if (!host) return;
  host.innerHTML = "";
  const cleaned = Array.isArray(values)
    ? values.map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean)
    : [];
  if (!cleaned.length) {
    const empty = document.createElement("div");
    empty.className = "profile-chip-empty";
    empty.textContent = emptyText;
    host.append(empty);
    return;
  }
  cleaned.slice(0, 12).forEach((value) => {
    const chip = document.createElement("span");
    chip.className = "profile-chip-tag";
    chip.textContent = value;
    host.append(chip);
  });
}

function renderProfilePreviewList(host, items = [], emptyText = "") {
  if (!host) return;
  host.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "profile-pill-empty";
    empty.textContent = emptyText;
    host.append(empty);
    return;
  }
  items.slice(0, 4).forEach((item) => {
    const row = document.createElement("li");
    row.className = "profile-pill-item";
    const title = document.createElement("span");
    title.className = "profile-pill-title";
    title.textContent = item.title || "Saved pick";
    const meta = document.createElement("span");
    meta.className = "profile-pill-meta";
    meta.textContent = item.meta || "";
    row.append(title, meta);
    host.append(row);
  });
}

function renderProfileOverview() {
  const hasSession = Boolean(state.session && state.session.token);
  const preferences = (state.session && state.session.preferencesSnapshot) || {};
  const profilePrefs = preferences.profile || {};
  const streamingPrefs = preferences.streaming || {};
  const bio = sanitizeProfileText(profilePrefs.bio || "", 280);
  const location = sanitizeProfileText(profilePrefs.location || "", 120);
  const website = typeof profilePrefs.website === "string" ? profilePrefs.website : "";
  const favoriteGenres = Array.isArray(profilePrefs.favoriteGenres)
    ? profilePrefs.favoriteGenres.filter(Boolean)
    : [];
  const favoriteDecades = Array.isArray(profilePrefs.favoriteDecades)
    ? profilePrefs.favoriteDecades.filter(Boolean)
    : [];
  const providerSelections = Array.isArray(streamingPrefs.providers)
    ? streamingPrefs.providers
    : Array.isArray(state.onboardingSelections.streamingProviders)
    ? state.onboardingSelections.streamingProviders
    : [];
  const favorites = Array.isArray(state.favorites) ? state.favorites : [];
  const watchedHistory = Array.isArray(state.watchedHistory) ? state.watchedHistory : [];
  const favoritesCount = favorites.length;
  const watchedCount = watchedHistory.length;
  const followers =
    state.socialOverview && state.socialOverview.counts
      ? Number(state.socialOverview.counts.followers || 0)
      : 0;
  const following =
    state.socialOverview && state.socialOverview.counts
      ? Number(state.socialOverview.counts.following || 0)
      : 0;
  const profile = {
    name: hasSession ? state.session.displayName || state.session.username : "Guest",
    handle: hasSession && state.session.username ? `@${state.session.username}` : "@guest",
    bio:
      bio ||
      (hasSession
        ? "Add a short bio so friends know your vibe."
        : "Sign in to add a bio and location for your profile."),
    location: location || (hasSession ? "Location not set" : "Location unknown"),
    website: website || "",
    isPrivate: Boolean(profilePrefs.isPrivate),
    avatarUrl: hasSession && state.session.avatarUrl ? state.session.avatarUrl : null,
    stats: {
      favorites: favoritesCount,
      watched: watchedCount,
      followers,
      following
    }
  };

  state.profileContextHandle = canonicalHandle(profile.handle || "");
  if (profileMessageButton) {
    const isSelfProfile =
      Boolean(state.session && canonicalHandle(state.session.username) === state.profileContextHandle);
    profileMessageButton.hidden = !hasSession;
    profileMessageButton.disabled = !state.profileContextHandle;
    profileMessageButton.textContent = isSelfProfile ? "Message yourself" : "Message";
    profileMessageButton.dataset.profileHandle = state.profileContextHandle;
  }

  if (profileName) {
    profileName.textContent = profile.name;
  }
  if (profileHandle) {
    profileHandle.textContent = profile.handle;
  }
  if (profileBio) {
    profileBio.textContent = profile.bio;
  }
  if (profileLocation) {
    profileLocation.textContent = profile.location;
  }
  if (profileWebsite) {
    const fallback = profile.isPrivate ? "Profile is private" : "Website not added";
    renderWebsiteLink(profileWebsite, profile.website, fallback);
  }
  if (profileAvatar) {
    setAvatarContent(profileAvatar, {
      imageUrl: profile.avatarUrl,
      initials: initialsFromName(profile.name),
      label: `${profile.name} avatar`
    });
  }
  if (profilePrivacy) {
    profilePrivacy.textContent = profile.isPrivate
      ? "Private profile"
      : hasSession
      ? "Public profile"
      : "Guest mode";
  }

  const completionParts = [
    Boolean(bio),
    Boolean(location),
    Boolean(website),
    favoriteGenres.length > 0,
    favoriteDecades.length > 0,
    providerSelections.length > 0,
    favoritesCount > 0,
    watchedCount > 0
  ];
  const completionPercent = Math.round(
    (completionParts.filter(Boolean).length / completionParts.length) * 100
  );
  if (profileProgressFill) {
    profileProgressFill.style.width = `${Math.max(12, completionPercent)}%`;
  }
  if (profileProgressLabel) {
    profileProgressLabel.textContent = completionPercent >= 60
      ? "Looking good—keep logging watches for richer stats."
      : "Add taste and services to sharpen matches.";
  }

  Object.entries(profileStats).forEach(([key, element]) => {
    if (!element) return;
    const value = profile.stats[key] || 0;
    element.textContent = value.toLocaleString();
  });

  if (profileFavoritesCount) {
    profileFavoritesCount.textContent = `${favoritesCount} saved`;
  }
  if (profileWatchedCount) {
    profileWatchedCount.textContent = `${watchedCount} logged`;
  }

  const favoritePreview = favorites
    .slice(-4)
    .reverse()
    .map((favorite) => {
      const title = favorite.title || favorite.originalTitle || "Saved pick";
      const year = favorite.releaseYear || favorite.year || "";
      const runtime = favorite.runtime ? `${favorite.runtime} min` : "";
      const metaParts = [year, runtime].filter(Boolean);
      return { title, meta: metaParts.join(" • ") };
    });
  renderProfilePreviewList(
    profileFavoritesPreview,
    favoritePreview,
    hasSession
      ? "Tap a heart on a movie card to save favorites."
      : "Sign in to start a favorites list."
  );

  const watchedPreview = watchedHistory
    .slice(-4)
    .reverse()
    .map((entry) => {
      const title = entry.title || "Logged title";
      const year = entry.releaseYear || entry.year || "";
      const rating = Number.isFinite(entry.rating) ? `${entry.rating}/10` : "";
      const loggedAt = entry.loggedAt ? new Date(entry.loggedAt).toLocaleDateString() : "";
      const metaParts = [year, rating, loggedAt].filter(Boolean);
      return { title, meta: metaParts.join(" • ") };
    });
  renderProfilePreviewList(
    profileWatchedPreview,
    watchedPreview,
    hasSession ? "Log watches to see them here." : "Sign in to track what you watch."
  );

  const providerLabels = providerSelections.map(mapStreamingProviderLabel);
  renderProfileChipCollection(
    profileGenreChips,
    favoriteGenres,
    hasSession ? "Pick a few genres in settings." : "Sign in to add genres."
  );
  renderProfileChipCollection(
    profileDecadeChips,
    favoriteDecades,
    hasSession ? "Add decades you love." : "Sign in to save favorite eras."
  );
  renderProfileChipCollection(
    profileProviderChips,
    providerLabels,
    hasSession
      ? "Add streaming apps to show availability."
      : "Sign in to sync streaming services."
  );

  if (profileAvailabilityStatus) {
    profileAvailabilityStatus.textContent = providerLabels.length
      ? "We’ll highlight matches available on your services."
      : hasSession
      ? "Add streaming apps to surface what’s playable tonight."
      : "Sign in to personalize availability.";
  }

  if (profileSettingsName) {
    profileSettingsName.textContent = profile.name;
  }
  if (profileSettingsHandle) {
    profileSettingsHandle.textContent = profile.handle;
  }
  if (profileSettingsPrivacy) {
    profileSettingsPrivacy.textContent = profile.isPrivate
      ? "Private profile"
      : hasSession
      ? "Public profile"
      : "Guest mode";
  }
  if (profileSettingsLocation) {
    profileSettingsLocation.textContent = profile.location;
  }
  if (profileSettingsWebsite) {
    profileSettingsWebsite.textContent = profile.website || "Website not added";
  }
  renderProfileChipCollection(
    profileSettingsProviders,
    providerLabels,
    "No services selected yet."
  );
  renderProfileChipCollection(
    profileSettingsGenres,
    favoriteGenres,
    "Add favorite genres to shape recs."
  );
  if (profileSettingsTaste) {
    const tasteSummary = favoriteGenres.length || favoriteDecades.length
      ? `${favoriteGenres.length} genres • ${favoriteDecades.length || 0} decades`
      : "Add genres and decades to shape recs.";
    profileSettingsTaste.textContent = tasteSummary;
  }
  if (profileSettingsActivity) {
    profileSettingsActivity.textContent = `${watchedCount + favoritesCount} logged entries`;
  }
}


function renderDiscoverMovies(movies = []) {
  if (!discoverGrid) return;
  discoverGrid.innerHTML = "";
  if (!movies.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    if (state.discoverFilter === "streaming") {
      empty.textContent = hasActiveSession()
        ? "No matches on your streaming services yet. Try another genre or add more services."
        : "Sign in and choose your streaming services to filter results.";
    } else {
      empty.textContent = "Nothing matched—try a different filter.";
    }
    discoverGrid.append(empty);
    return;
  }

  movies.forEach((movie) => {
    const normalized = normalizeDiscoverMovie(movie);
    if (!normalized) return;
    const card = buildGlassMovieCard(normalized);

    if (!card) return;
    const meta = [normalized.releaseYear ? String(normalized.releaseYear) : "", formatGenres(normalized.genres)]
      .filter(Boolean)
      .join(" • ");
    const providerBadges = (normalized.streamingProviders || [])
      .slice(0, 4)
      .map((provider) => createProviderBadge(provider));
    decorateMovieCard(card, { meta, chips: providerBadges });
    discoverGrid.append(card);
  });
}

function renderDiscoverSeries(series = []) {
  if (!discoverSeriesGrid) return;
  discoverSeriesGrid.innerHTML = "";
  if (!series.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No series matched—try a different filter.";
    discoverSeriesGrid.append(empty);
    return;
  }

  series.forEach((show) => {
    const normalized = normalizeDiscoverSeries(show);
    if (!normalized) return;
    const card = buildGlassMovieCard(normalized);

    if (!card) return;
    const meta = [normalized.releaseYear ? String(normalized.releaseYear) : "", formatGenres(normalized.genres)]
      .filter(Boolean)
      .join(" • ");
    const providerBadges = (normalized.streamingProviders || [])
      .slice(0, 4)
      .map((provider) => createProviderBadge(provider));
    decorateMovieCard(card, { meta, chips: providerBadges });
    discoverSeriesGrid.append(card);
  });
}

function renderTrendingStatus() {
  if (!trendingStatus) return;
  trendingStatus.textContent = "";
  trendingStatus.classList.add("muted");

  if (state.trendingLoading) {
    trendingStatus.textContent = "Loading trending movies…";
    return;
  }

  if (state.trendingError) {
    trendingStatus.textContent = state.trendingError;
    return;
  }

  if (!state.trendingMovies.length) {
    trendingStatus.textContent = "No trending movies for this window yet.";
    return;
  }

  const label =
    state.trendingWindow === "daily"
      ? "today"
      : state.trendingWindow === "monthly"
      ? "this month"
      : "this week";
  trendingStatus.textContent = `Trending ${label} on TMDB right now.`;
}

function renderTrendingMovies(movies = []) {
  if (!trendingRow) return;
  trendingRow.innerHTML = "";

  const normalized = movies.map(normalizeDiscoverMovie).filter(Boolean);

  if (state.trendingLoading) {
    const loading = document.createElement("div");
    loading.className = "small-text muted";
    loading.textContent = "Loading trending movies…";
    trendingRow.append(loading);
    renderTrendingStatus();
    return;
  }

  if (!normalized.length) {
    const empty = document.createElement("div");
    empty.className = "small-text muted";
    empty.textContent = state.trendingError || "No trending picks right now.";
    trendingRow.append(empty);
    renderTrendingStatus();
    return;
  }

  normalized.forEach((movie, index) => {
    const card = buildGlassMovieCard(movie);

    if (!card) return;
    const providerBadges = (movie.streamingProviders || [])
      .slice(0, 4)
      .map((provider) => createProviderBadge(provider));

    const meta = [movie.releaseYear ? String(movie.releaseYear) : "", formatGenres(movie.genres)]
      .filter(Boolean)
      .join(" • ");
    const rankBadge = document.createElement("span");
    rankBadge.className = "badge trend";
    const rankValue = movie.rank || index + 1;
    rankBadge.textContent = rankValue ? `#${rankValue}` : "Trending";
    const statBadge = document.createElement("span");
    statBadge.className = "badge rating";
    if (movie.stats?.watchCount) {
      statBadge.textContent = `${movie.stats.watchCount} logs`;
    } else if (movie.stats?.favorites) {
      statBadge.textContent = `${movie.stats.favorites} favorites`;
    } else {
      statBadge.textContent = movie.trendScore ? `${movie.trendScore.toFixed(1)} score` : "Buzzing";
    }

    decorateMovieCard(card, { meta, chips: [rankBadge, statBadge, ...providerBadges] });
    trendingRow.append(card);
  });

  renderTrendingStatus();
}

function normalizeStreamingProviders(raw = []) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => {
      const key = entry.key || entry.provider_key || entry.value || "";
      const name = entry.name || entry.displayName || entry.label || key;
      if (!key && !name) return null;
      return {
        key,
        name,
        url: entry.url || entry.deeplink || entry.link || "",
        region: entry.region || null,
        deeplink: entry.deeplink || null,
        brandColor: entry.brandColor || entry.color || entry.brand_color || null
      };
    })
    .filter(Boolean);
}

function normalizeDiscoverMovie(movie = {}) {
  if (!movie || typeof movie !== "object") {
    return null;
  }
  const posterUrl = movie.posterUrl
    ? movie.posterUrl
    : movie.poster_url
    ? movie.poster_url
    : movie.poster_path
    ? `https://image.tmdb.org/t/p/w342${movie.poster_path}`
    : "";

  const releaseYear =
    movie.releaseYear ||
    movie.release_year ||
    (movie.release_date ? movie.release_date.slice(0, 4) : null) ||
    (movie.first_air_date ? movie.first_air_date.slice(0, 4) : null);

  const rating =
    Number.isFinite(movie.avgRating) && movie.avgRating >= 0
      ? movie.avgRating
      : Number.isFinite(movie.vote_average)
      ? movie.vote_average
      : null;

  const stats = movie.stats && typeof movie.stats === "object" ? movie.stats : {};
  const watchCount = Number.isFinite(Number(stats.watchCount)) ? Number(stats.watchCount) : 0;
  const favorites = Number.isFinite(Number(stats.favorites)) ? Number(stats.favorites) : 0;
  const reviews = Number.isFinite(Number(stats.reviews)) ? Number(stats.reviews) : 0;
  const rank = Number.isFinite(Number(movie.rank)) ? Number(movie.rank) : null;
  const trendScoreCandidate = movie.trendScore ?? movie.trend_score;
  const trendScore = Number.isFinite(Number(trendScoreCandidate)) ? Number(trendScoreCandidate) : null;
  const timeWindow = movie.timeWindow || movie.time_window || null;

  return {
    tmdbId: movie.tmdbId || movie.tmdb_id || movie.id || movie.tmdbID || null,
    imdbId: movie.imdbId || movie.imdb_id || null,
    title: movie.title || movie.original_title || movie.name || "Untitled",
    genres: movie.genres || movie.genre_ids || [],
    posterUrl,
    releaseYear,
    rating,
    watchCount,
    favorites,
    reviews,
    synopsis: movie.synopsis || movie.overview || "",
    stats: { watchCount, favorites, reviews },
    rank,
    trendScore,
    timeWindow,
    streamingProviders: normalizeStreamingProviders(
      movie.streamingProviders || movie.streaming_providers || []
    )
  };
}

function normalizeDiscoverSeries(show = {}) {
  if (!show || typeof show !== "object") {
    return null;
  }

  const normalized = normalizeDiscoverMovie({
    ...show,
    releaseYear:
      show.releaseYear ||
      show.release_year ||
      (show.first_air_date ? show.first_air_date.slice(0, 4) : null)
  });

  if (!normalized) return null;

  return {
    ...normalized,
    title: show.name || show.original_name || normalized.title,
    releaseYear:
      normalized.releaseYear ||
      (show.first_air_date ? show.first_air_date.slice(0, 4) : null)
  };
}

function createFavoriteToggleButton(movie) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn-ghost btn";

  const updateLabel = () => {
    const isFavorite = isFavoriteMovie(movie);
    button.textContent = isFavorite ? "Saved ❤️" : "♡ Favorite";
    button.setAttribute("aria-pressed", isFavorite ? "true" : "false");
  };

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleFavorite(movie).then(updateLabel);
  });

  updateLabel();
  return button;
}

function createProviderBadge(provider) {
  const badge = document.createElement("span");
  badge.className = "badge provider";
  badge.textContent = provider.name || provider.key || "Stream";
  if (provider.brandColor) {
    badge.style.borderColor = provider.brandColor;
    badge.style.color = provider.brandColor;
  }
  if (provider.region) {
    badge.title = provider.region;
  }
  return badge;
}

function renderPeople(people = [], { source = "tmdb" } = {}) {
  if (!discoverPeopleList) return;
  discoverPeopleList.innerHTML = "";
  if (!people.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = source === "social"
      ? "Invite friends or search by handle to start following people."
      : "No people found yet.";
    discoverPeopleList.append(empty);
    return;
  }

  if (source === "social") {
    people.forEach((person) => {
      const handle = canonicalHandle(person?.username);
      if (!handle) return;
      const card = document.createElement("article");
      card.className = "card";

      const avatar = document.createElement("div");
      avatar.className = "avatar";
      const displayName = person.displayName || `@${handle}`;
      const avatarUrl =
        (typeof person.avatarUrl === "string" && person.avatarUrl.trim()) ||
        (typeof person.avatar_url === "string" && person.avatar_url.trim()) ||
        "";
      setAvatarContent(avatar, {
        imageUrl: avatarUrl,
        initials: initialsFromName(displayName),
        label: `${displayName} avatar`
      });

      const stack = document.createElement("div");
      stack.className = "stack";
      const name = document.createElement("strong");
      name.textContent = displayName;
      const handleLine = document.createElement("div");
      handleLine.className = "small-text muted";
      handleLine.textContent = `@${handle}`;
      const meta = document.createElement("div");
      meta.className = "small-text";
      meta.textContent = person.tagline || buildSocialSuggestionSummary(person);
      const overlaps = buildSocialSuggestionSummary(person, { detailed: true });
      const overlapLine = document.createElement("div");
      overlapLine.className = "small-text muted";
      overlapLine.textContent = overlaps || "Let them know what you’re watching.";

      const badgeRow = document.createElement("div");
      badgeRow.className = "action-row";
      const badges = [];
      if (person.followsYou) {
        badges.push("Follows you");
      }
      const mutualCount = Array.isArray(person.mutualFollowers) ? person.mutualFollowers.length : 0;
      if (mutualCount) {
        badges.push(`${mutualCount} mutual`);
      }
      badges.forEach((label) => {
        const pill = document.createElement("span");
        pill.className = "badge";
        pill.textContent = label;
        badgeRow.append(pill);
      });
      if (!badgeRow.childElementCount) {
        badgeRow.classList.add("muted");
        badgeRow.textContent = "Smart Movie Match member";
      }

      const actions = document.createElement("div");
      actions.className = "action-row";
      const followBtn = createFollowButton(handle);
      const messageBtn = createMessageButton(handle);
      actions.append(followBtn, messageBtn);

      stack.append(name, handleLine, meta, overlapLine, badgeRow, actions);
      card.append(avatar, stack);
      discoverPeopleList.append(card);
    });
    return;
  }

  people.forEach((person) => {
    const card = document.createElement("article");
    card.className = "card";

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    const initials = person.name
      ? person.name
          .split(" ")
          .map((part) => part[0])
          .join("")
          .slice(0, 2)
      : "?";
    const displayName = person.name || "Unknown";
    const avatarUrl =
      (typeof person.avatarUrl === "string" && person.avatarUrl.trim()) ||
      (typeof person.avatar_url === "string" && person.avatar_url.trim()) ||
      "";
    setAvatarContent(avatar, {
      imageUrl: avatarUrl,
      initials,
      label: `${displayName} avatar`
    });

    const stack = document.createElement("div");
    stack.className = "stack";
    const name = document.createElement("strong");
    name.textContent = displayName;
    const meta = document.createElement("div");
    meta.className = "small-text";
    const known = Array.isArray(person.known_for)
      ? person.known_for
          .map((item) => item.title || item.original_title || item.name)
          .filter(Boolean)
          .slice(0, 2)
          .join(", ")
      : "";
    meta.textContent = known ? `Known for: ${known}` : "Trending performer";

    stack.append(name, meta);
    card.append(avatar, stack);
    discoverPeopleList.append(card);
  });
}

function buildSocialSuggestionSummary(person, { detailed = false } = {}) {
  if (!person) return "";
  const parts = [];
  const sharedInterests = Array.isArray(person.sharedInterests)
    ? person.sharedInterests.filter(Boolean)
    : [];
  const sharedFavorites = Array.isArray(person.sharedFavorites)
    ? person.sharedFavorites.filter(Boolean)
    : [];
  const sharedWatchHistory = Array.isArray(person.sharedWatchHistory)
    ? person.sharedWatchHistory.filter(Boolean)
    : [];
  const sharedWatchParties = Array.isArray(person.sharedWatchParties)
    ? person.sharedWatchParties.filter(Boolean)
    : [];
  const mutualCount = Array.isArray(person.mutualFollowers) ? person.mutualFollowers.length : 0;

  if (sharedInterests.length) {
    parts.push(`Into ${sharedInterests.slice(0, 2).join(", ")}`);
  }
  if (sharedFavorites.length) {
    parts.push(`Favorites overlap on ${sharedFavorites.slice(0, 2).join(", ")}`);
  }
  if (detailed && sharedWatchHistory.length) {
    parts.push(`Recently watched ${sharedWatchHistory.slice(0, 2).join(", ")}`);
  }
  if (detailed && sharedWatchParties.length) {
    parts.push(sharedWatchParties[0]);
  }
  if (mutualCount) {
    parts.push(`${mutualCount} mutual ${mutualCount === 1 ? "follow" : "follows"}`);
  }

  return parts.join(" • ");
}

function getFollowingHandles() {
  const handles = Array.isArray(state.socialOverview?.following)
    ? state.socialOverview.following
    : [];
  return handles.map((handle) => canonicalHandle(handle)).filter(Boolean);
}

function isFollowingUser(handle) {
  const normalized = canonicalHandle(handle);
  if (!normalized) return false;
  return getFollowingHandles().includes(normalized);
}

function updateLocalFollowingCache(handle, shouldFollow) {
  const normalized = canonicalHandle(handle);
  if (!normalized || !state.socialOverview) return;
  const next = new Set(getFollowingHandles());
  if (shouldFollow) {
    next.add(normalized);
  } else {
    next.delete(normalized);
  }
  state.socialOverview.following = Array.from(next);
  if (state.socialOverview.counts) {
    state.socialOverview.counts.following = next.size;
  }
}

function createFollowButton(handle) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-secondary";

  const setLabel = (loading = false) => {
    const following = isFollowingUser(handle);
    if (loading) {
      button.textContent = following ? "Updating…" : "Following…";
    } else {
      button.textContent = following ? "Unfollow" : "Follow";
    }
    button.className = following ? "btn btn-ghost" : "btn btn-secondary";
    button.disabled = loading;
  };

  setLabel();

  button.addEventListener("click", async () => {
    if (!hasActiveSession()) {
      openAuthOverlay("login");
      return;
    }
    const currentlyFollowing = isFollowingUser(handle);
    setLabel(true);
    try {
      if (currentlyFollowing) {
        await unfollowUserByUsername(handle);
        updateLocalFollowingCache(handle, false);
      } else {
        await followUserByUsername(handle);
        updateLocalFollowingCache(handle, true);
      }
      renderProfileOverview();
    } catch (error) {
      console.warn("Follow toggle failed", error);
    } finally {
      setLabel(false);
    }
  });

  return button;
}

function createMessageButton(handle, { label = "Message" } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-primary";
  button.textContent = label;

  const normalized = canonicalHandle(handle);
  if (!normalized) {
    button.disabled = true;
    return button;
  }

  const setLoading = (loading = false) => {
    button.disabled = loading;
    button.textContent = loading ? "Opening…" : label;
  };

  button.addEventListener("click", async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    setLoading(true);
    await startConversationWithHandle(normalized);
    setLoading(false);
  });

  return button;
}

function renderPeopleSection() {
  if (state.peopleSearchActive) {
    renderPeople(state.discoverPeople, { source: "tmdb" });
    return;
  }
  const suggestions = Array.isArray(state.socialOverview?.suggestions)
    ? state.socialOverview.suggestions
    : [];
  if (hasActiveSession() && suggestions.length) {
    renderPeople(suggestions, { source: "social" });
    return;
  }
  renderPeople(state.discoverPeople, { source: "tmdb" });
}

function setFavoritesStatus(message, tone = "") {
  if (!favoritesStatus) return;
  favoritesStatus.textContent = message || "";
  favoritesStatus.className = "small-text muted";
  if (tone === "error") {
    favoritesStatus.classList.add("error-text");
  } else if (tone === "success") {
    favoritesStatus.classList.add("success-text");
  }
}

function getFavoriteKey(movie) {
  if (!movie || typeof movie !== "object") return "";
  const imdbId = typeof movie.imdbId === "string" ? movie.imdbId.trim() : "";
  if (imdbId) return imdbId.toLowerCase();
  const tmdbId = movie.tmdbId || movie.tmdb_id || movie.id || null;
  if (tmdbId) return String(tmdbId);
  const title = typeof movie.title === "string" ? movie.title.trim().toLowerCase() : "";
  return title;
}

function normalizeFavoriteMovie(movie = {}) {
  const normalized = normalizeDiscoverMovie(movie);
  if (!normalized || !normalized.title) return null;
  return {
    title: normalized.title,
    imdbId: normalized.imdbId || null,
    tmdbId: normalized.tmdbId || null,
    poster: normalized.posterUrl || "",
    releaseYear: normalized.releaseYear || "",
    genres: Array.isArray(normalized.genres) ? normalized.genres : [],
    rating: Number.isFinite(normalized.rating) ? normalized.rating : null,
    synopsis: normalized.synopsis || "",
    rtScore:
      Number.isFinite(normalized.rtScore)
        ? normalized.rtScore
        : Number.isFinite(normalized.trendScore)
        ? Math.round(normalized.trendScore)
        : null
  };
}

function isFavoriteMovie(movie) {
  const key = getFavoriteKey(movie);
  if (!key) return false;
  return state.favorites.some((entry) => getFavoriteKey(entry) === key);
}

async function syncFavoritesRemote() {
  if (!hasActiveSession()) return;
  if (state.favoritesSaving) return;
  state.favoritesSaving = true;
  setFavoritesStatus("Syncing favorites…");
  try {
    await persistFavoritesRemote(state.session, state.favorites);
    setFavoritesStatus("Favorites synced", "success");
  } catch (error) {
    console.warn("Favorites sync failed", error);
    setFavoritesStatus("Couldn’t sync favorites right now.", "error");
  } finally {
    state.favoritesSaving = false;
  }
}

async function toggleFavorite(movie) {
  const normalized = normalizeFavoriteMovie(movie);
  if (!normalized || !normalized.title) {
    return false;
  }
  if (!hasActiveSession()) {
    setFavoritesStatus("Sign in to save favorites.", "error");
    openAuthOverlay("login");
    return false;
  }
  const key = getFavoriteKey(normalized);
  const alreadyFavorite = isFavoriteMovie(normalized);
  if (alreadyFavorite) {
    state.favorites = state.favorites.filter((entry) => getFavoriteKey(entry) !== key);
    setFavoritesStatus("Removed from favorites.");
  } else {
    state.favorites = [...state.favorites, normalized].slice(-100);
    setFavoritesStatus(`Added “${normalized.title}” to favorites.`, "success");
    recordLibraryActivity("favorite_add", normalized).catch((error) => {
      console.warn("Failed to log favorite add", error);
    });
  }
  renderFavoritesList();
  await syncFavoritesRemote();
  return !alreadyFavorite;
}

function renderFavoritesList() {
  if (!favoritesPanel || !favoritesList) return;
  favoritesList.innerHTML = "";
  favoritesList.classList.add("library-card-grid");
  favoritesList.classList.remove("stack");
  const favorites = Array.isArray(state.favorites) ? state.favorites : [];
  if (!favorites.length) {
    favoritesPanel.classList.add("is-empty");
    if (favoritesEmpty) favoritesEmpty.hidden = false;
    setFavoritesStatus("Tap a heart on a movie card to save it here.");
    return;
  }

  favoritesPanel.classList.remove("is-empty");
  if (favoritesEmpty) favoritesEmpty.hidden = true;

  favorites.forEach((favorite) => {
    const card = buildLibraryCard(favorite, {
      onToggleFavorite: () => toggleFavorite(favorite),
      onToggleWatched: () => setFavoritesStatus("Watched tracking coming soon.")
    });
    favoritesList.append(card);
  });
}

function normalizeWatchedEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const title = typeof entry.title === "string" ? entry.title.trim() : "";
  if (!title) return null;
  const releaseYear = typeof entry.year === "string" ? entry.year.trim() : "";
  const ratingValue =
    typeof entry.rating === "number"
      ? entry.rating
      : typeof entry.rating === "string" && entry.rating.trim() !== ""
      ? Number(entry.rating)
      : null;

  const rawLoggedAt =
    entry.loggedAt || entry.logged_at || entry.updatedAt || entry.updated_at || entry.syncedAt || entry.synced_at;
  let loggedAt = null;
  if (typeof rawLoggedAt === "number" && Number.isFinite(rawLoggedAt)) {
    loggedAt = rawLoggedAt;
  } else if (typeof rawLoggedAt === "string" && rawLoggedAt.trim()) {
    const parsed = Date.parse(rawLoggedAt);
    if (!Number.isNaN(parsed)) {
      loggedAt = parsed;
    }
  }

  return {
    title,
    imdbId: entry.imdbID || entry.imdbId || null,
    tmdbId: entry.tmdbId || entry.tmdbID || null,
    poster: typeof entry.poster === "string" ? entry.poster : "",
    releaseYear,
    genres: Array.isArray(entry.genres)
      ? entry.genres.map((genre) => (typeof genre === "string" ? genre.trim() : "")).filter(Boolean)
      : [],
    rating: Number.isFinite(ratingValue) ? ratingValue : null,
    synopsis: typeof entry.overview === "string" ? entry.overview : "",
    loggedAt,
    watched: true
  };
}

function normalizeWatchedHistory(history = []) {
  return history.map(normalizeWatchedEntry).filter(Boolean);
}

function formatWatchedDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function renderWatchedList() {
  if (!watchedPanel || !watchedList) return;
  watchedList.innerHTML = "";
  watchedList.classList.add("library-card-grid");
  watchedList.classList.remove("stack");

  const watchedEntries = Array.isArray(state.watchedHistory) ? state.watchedHistory : [];
  if (!watchedEntries.length) {
    watchedPanel.classList.add("is-empty");
    if (watchedEmpty) watchedEmpty.hidden = false;
    return;
  }

  watchedPanel.classList.remove("is-empty");
  if (watchedEmpty) watchedEmpty.hidden = true;

  watchedEntries.forEach((entry) => {
    const card = buildLibraryCard(
      { ...entry, watched: true },
      {
        onToggleFavorite: () => toggleFavorite(entry),
        onToggleWatched: (watchedActive) => {
          if (!watchedActive) {
            const key = getFavoriteKey(entry);
            state.watchedHistory = state.watchedHistory.filter((item) => getFavoriteKey(item) !== key);
            renderWatchedList();
          }
        }
      }
    );

    const badges = card.querySelector(".library-card__ratings");
    if (badges && entry.loggedAt) {
      badges.append(createLibraryBadge("Watched", formatWatchedDate(entry.loggedAt)));
    }

    watchedList.append(card);
  });
}

function buildLibraryCard(movie, { onToggleFavorite, onToggleWatched } = {}) {
  const imdbScore = Number.isFinite(movie.rating) ? movie.rating.toFixed(1) : "—";
  const rtScore = Number.isFinite(movie.rtScore)
    ? `${Math.round(movie.rtScore)}%`
    : "—";
  const synopsis = movie.synopsis && movie.synopsis.trim()
    ? movie.synopsis.trim()
    : "Saved to your Library.";

  const card = document.createElement("article");
  card.className = "library-card";

  const poster = document.createElement("div");
  poster.className = "library-card__poster";
  if (movie.poster) {
    const img = document.createElement("img");
    img.src = movie.poster;
    img.alt = `${movie.title} poster`;
    poster.appendChild(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "library-card__poster-placeholder";
    placeholder.textContent = "🎬";
    poster.appendChild(placeholder);
  }

  const content = document.createElement("div");
  content.className = "library-card__content";

  const header = document.createElement("div");
  header.className = "library-card__header";
  const title = document.createElement("h3");
  title.className = "library-card__title";
  title.textContent = movie.title || "Untitled";
  const year = document.createElement("span");
  year.className = "library-card__year";
  year.textContent = movie.releaseYear || "—";
  header.append(title, year);

  const description = document.createElement("p");
  description.className = "library-card__description";
  description.textContent = synopsis;

  const ratingsRow = document.createElement("div");
  ratingsRow.className = "library-card__ratings";
  ratingsRow.append(
    createLibraryBadge("IMDb", imdbScore),
    createLibraryBadge("RT", rtScore)
  );

  const actions = document.createElement("div");
  actions.className = "library-card__actions";
  const favoriteBtn = createLibraryActionButton({
    label: "Favorite",
    active: true,
    ariaLabel: "Remove from favorites",
    icon: createHeartIcon(true),
    onClick: (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof onToggleFavorite === "function") {
        onToggleFavorite();
      }
    }
  });

  let watchedActive = Boolean(movie.watched);
  const watchedBtn = createLibraryActionButton({
    label: watchedActive ? "Watched" : "Watch",
    active: watchedActive,
    ariaLabel: watchedActive ? "Mark as unwatched" : "Mark as watched",
    icon: createCheckIcon(watchedActive),
    onClick: (event) => {
      event.preventDefault();
      event.stopPropagation();
      watchedActive = !watchedActive;
      updateLibraryActionButton(watchedBtn, {
        label: watchedActive ? "Watched" : "Watch",
        active: watchedActive,
        icon: createCheckIcon(watchedActive),
        ariaLabel: watchedActive ? "Mark as unwatched" : "Mark as watched"
      });
      if (typeof onToggleWatched === "function") {
        onToggleWatched(watchedActive);
      }
    }
  });

  actions.append(favoriteBtn, watchedBtn);

  content.append(header, description, ratingsRow, actions);
  card.append(poster, content);
  return card;
}

function createLibraryBadge(label, value) {
  const badge = document.createElement("span");
  badge.className = "library-card__badge";
  const labelEl = document.createElement("span");
  labelEl.className = "library-card__badge-label";
  labelEl.textContent = label;
  const valueEl = document.createElement("span");
  valueEl.className = "library-card__badge-value";
  valueEl.textContent = value;
  badge.append(labelEl, valueEl);
  return badge;
}

function createLibraryActionButton({ label, active, ariaLabel, icon, onClick }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "library-card__action-btn";
  btn.setAttribute("aria-label", ariaLabel || label);
  const iconWrap = document.createElement("span");
  iconWrap.className = "library-card__action-icon";
  iconWrap.appendChild(icon);
  const text = document.createElement("span");
  text.className = "library-card__action-text";
  text.textContent = label;
  btn.append(iconWrap, text);
  updateLibraryActionButton(btn, { active });
  if (typeof onClick === "function") {
    btn.addEventListener("click", onClick);
  }
  return btn;
}

function updateLibraryActionButton(btn, { active, label, icon, ariaLabel } = {}) {
  if (!btn) return;
  btn.classList.toggle("is-active", Boolean(active));
  if (label) {
    const text = btn.querySelector(".library-card__action-text");
    if (text) text.textContent = label;
  }
  if (icon) {
    const iconWrap = btn.querySelector(".library-card__action-icon");
    if (iconWrap) {
      iconWrap.innerHTML = "";
      iconWrap.appendChild(icon);
    }
  }
  if (ariaLabel) {
    btn.setAttribute("aria-label", ariaLabel);
  }
}

function createHeartIcon(filled) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", filled ? "currentColor" : "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    "M12 21s-6.5-4.35-9-9c-1.9-3.6.6-7.5 4-7.5 2 0 3.2 1.1 5 3 1.8-1.9 3-3 5-3 3.4 0 5.9 3.9 4 7.5-2.5 4.65-9 9-9 9Z"
  );
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}

function createCheckIcon(filled) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", filled ? "currentColor" : "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M20 6 9 17l-5-5");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}

function getDefaultCollaborativeState() {
  return { watchParties: { upcoming: [], invites: [] } };
}

function selectPrimaryWatchParty(collabState) {
  const upcoming = Array.isArray(collabState?.watchParties?.upcoming)
    ? collabState.watchParties.upcoming
    : [];
  if (!upcoming.length) {
    return null;
  }
  const sorted = [...upcoming].sort((a, b) => {
    const aTime = new Date(a.scheduledFor || a.createdAt || 0).getTime();
    const bTime = new Date(b.scheduledFor || b.createdAt || 0).getTime();
    return aTime - bTime;
  });
  return sorted[0];
}

function setActiveWatchParty(party) {
  const previousId = state.activeWatchParty ? state.activeWatchParty.id : null;
  state.activeWatchParty = party || null;
  if (!party) {
    state.watchPartyMessages = [];
    state.watchPartyMessagesPartyId = null;
    state.watchPartyMessagesLoading = false;
    setWatchPartyStatus("", null);
    renderWatchPartyPanel();
    return;
  }
  setWatchPartyStatus("", null);
  renderWatchPartyPanel();
  if (party.id && party.id !== previousId) {
    state.watchPartyMessages = [];
    state.watchPartyMessagesPartyId = party.id;
    loadWatchPartyMessages(party.id);
  }
}

function canChatInActiveParty() {
  if (!hasActiveSession()) {
    return false;
  }
  const party = state.activeWatchParty;
  if (!party) {
    return false;
  }
  const response = typeof party.response === "string" ? party.response.toLowerCase() : "";
  return ["host", "joined", "accept", "accepted", "yes", "maybe", "waiting"].includes(response);
}

function renderWatchPartyPanel() {
  if (!watchPartyPanel || !watchPartyEmpty) return;
  const party = state.activeWatchParty;
  if (!party || !hasActiveSession()) {
    watchPartyPanel.hidden = true;
    watchPartyEmpty.hidden = false;
    return;
  }

  watchPartyEmpty.hidden = true;
  watchPartyPanel.hidden = false;
  const title = party.movie?.title || party.note || "Watch party";
  if (watchPartyTitle) {
    watchPartyTitle.textContent = title;
  }
  if (watchPartyMeta) {
    const host = party.host ? `Hosted by @${canonicalHandle(party.host)}` : "Watch party";
    const visibility = party.visibility ? `${formatWatchPartyVisibilityLabel(party.visibility)} • ` : "";
    watchPartyMeta.textContent = `${visibility}${host}`;
  }
  if (watchPartyTime) {
    watchPartyTime.textContent = formatWatchPartyTime(party.scheduledFor || party.createdAt);
  }
  renderWatchPartyParticipants(party.participants || []);
  renderWatchPartyMessages();
  if (watchPartyJoinButton) {
    const chatAllowed = canChatInActiveParty();
    watchPartyJoinButton.hidden = chatAllowed;
    watchPartyJoinButton.disabled = state.watchPartyMessageSending;
  }
  if (watchPartyInput) {
    watchPartyInput.disabled = !canChatInActiveParty();
  }
}

function renderWatchPartyParticipants(participants = []) {
  if (!watchPartyParticipants) return;
  watchPartyParticipants.innerHTML = "";
  if (!participants.length) {
    const empty = document.createElement("p");
    empty.className = "small-text muted";
    empty.textContent = "No participants yet.";
    watchPartyParticipants.append(empty);
    return;
  }
  participants.forEach((participant) => {
    const row = document.createElement("div");
    row.className = "watch-party-participant";
    row.dataset.presence = participant.metadata?.presence || "online";
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    const participantName = participant.username || "?";
    const avatarUrl =
      (typeof participant.avatarUrl === "string" && participant.avatarUrl.trim()) ||
      (typeof participant.avatar_url === "string" && participant.avatar_url.trim()) ||
      "";
    setAvatarContent(avatar, {
      imageUrl: avatarUrl,
      initials: initialsFromName(participantName),
      label: `${participantName} avatar`
    });
    const stack = document.createElement("div");
    stack.className = "stack";
    const name = document.createElement("strong");
    name.textContent = `@${canonicalHandle(participant.username)}`;
    const role = document.createElement("span");
    role.className = "watch-party-participant-role";
    role.textContent = participant.role ? participant.role : "guest";
    stack.append(name, role);
    const meta = document.createElement("span");
    meta.className = "watch-party-participant-meta";
    if (participant.metadata?.bringing) {
      meta.textContent = `Bringing: ${participant.metadata.bringing}`;
    } else if (participant.lastActiveAt) {
      meta.textContent = `Seen ${formatWatchPartyTime(participant.lastActiveAt)}`;
    }
    row.append(avatar, stack, meta);
    watchPartyParticipants.append(row);
  });
}

function renderWatchPartyMessages() {
  if (!watchPartyMessagesList) return;
  watchPartyMessagesList.innerHTML = "";
  if (state.watchPartyMessagesLoading) {
    const loading = document.createElement("p");
    loading.className = "small-text muted";
    loading.textContent = "Loading chat…";
    watchPartyMessagesList.append(loading);
    return;
  }
  const messages = Array.isArray(state.watchPartyMessages)
    ? [...state.watchPartyMessages].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
    : [];
  if (!messages.length) {
    const empty = document.createElement("p");
    empty.className = "small-text muted";
    empty.textContent = "No chat yet—say hi!";
    watchPartyMessagesList.append(empty);
    return;
  }
  messages.forEach((message) => {
    const row = document.createElement("div");
    row.className = "watch-party-message";
    const header = document.createElement("div");
    header.className = "watch-party-message-meta";
    header.textContent = `@${canonicalHandle(message.username)} · ${formatWatchPartyTime(message.createdAt)}`;
    const body = document.createElement("p");
    body.textContent = message.body;
    row.append(header, body);
    watchPartyMessagesList.append(row);
  });
  watchPartyMessagesList.scrollTop = watchPartyMessagesList.scrollHeight;
}

function formatWatchPartyTime(value) {
  if (!value) {
    return "Time to be decided";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Time to be decided";
  }
  const now = Date.now();
  const diffMinutes = Math.round((date.getTime() - now) / 60000);
  if (Math.abs(diffMinutes) < 60) {
    if (diffMinutes > 0) {
      return `in ${diffMinutes} min`;
    }
    return `${Math.abs(diffMinutes)} min ago`;
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatWatchPartyVisibilityLabel(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "public") {
    return "Public";
  }
  if (normalized.startsWith("invite")) {
    return "Invite-only";
  }
  return "Friends";
}

function formatRelativeTimestamp(value) {
  if (!value) {
    return "Just now";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Just now";
  }
  const diffMinutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMinutes < 1) {
    return "Just now";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function setWatchPartyStatus(message, variant = null) {
  if (!watchPartyStatus) return;
  watchPartyStatus.textContent = message || "";
  if (variant) {
    watchPartyStatus.dataset.variant = variant;
  } else {
    watchPartyStatus.removeAttribute("data-variant");
  }
}

async function loadWatchPartyMessages(partyId) {
  if (!partyId || state.watchPartyMessagesLoading) {
    return;
  }
  state.watchPartyMessagesLoading = true;
  setWatchPartyStatus("Loading chat…", "loading");
  try {
    const messages = await listWatchPartyMessagesRemote({ partyId });
    if (state.activeWatchParty && state.activeWatchParty.id === partyId) {
      state.watchPartyMessages = messages;
      renderWatchPartyMessages();
      setWatchPartyStatus("", null);
    }
  } catch (error) {
    setWatchPartyStatus(error.message || "Unable to load watch party chat.", "error");
  } finally {
    state.watchPartyMessagesLoading = false;
  }
}

async function handleWatchPartyMessageSubmit(event) {
  if (event) {
    event.preventDefault();
  }
  if (!state.activeWatchParty) {
    setWatchPartyStatus("Select a watch party first.", "error");
    return;
  }
  if (!hasActiveSession()) {
    openAuthOverlay("login");
    return;
  }
  if (!canChatInActiveParty()) {
    setWatchPartyStatus("Join the party to chat.", "error");
    return;
  }
  const message = watchPartyInput ? watchPartyInput.value.trim() : "";
  if (!message) {
    if (watchPartyInput) {
      watchPartyInput.focus();
    }
    return;
  }
  state.watchPartyMessageSending = true;
  setWatchPartyStatus("Sending…", "loading");
  if (watchPartyInput) {
    watchPartyInput.disabled = true;
  }
  try {
    const sent = await postWatchPartyMessageRemote({ partyId: state.activeWatchParty.id, body: message });
    if (sent) {
      state.watchPartyMessages = [...state.watchPartyMessages, sent];
      renderWatchPartyMessages();
    }
    if (watchPartyInput) {
      watchPartyInput.value = "";
    }
    setWatchPartyStatus("Message sent", "success");
  } catch (error) {
    setWatchPartyStatus(error.message || "Unable to send chat message.", "error");
  } finally {
    state.watchPartyMessageSending = false;
    if (watchPartyInput) {
      watchPartyInput.disabled = !canChatInActiveParty();
    }
  }
}

async function handleJoinWatchParty(event) {
  if (event) {
    event.preventDefault();
  }
  if (!state.activeWatchParty || !state.activeWatchParty.id) {
    return;
  }
  if (!hasActiveSession()) {
    openAuthOverlay("login");
    return;
  }
  setWatchPartyStatus("Joining…", "loading");
  try {
    await joinWatchPartyRemote({ partyId: state.activeWatchParty.id, note: "" });
    await refreshCollaborativeState();
    setWatchPartyStatus("Joined the watch party.", "success");
  } catch (error) {
    setWatchPartyStatus(error.message || "Could not join this watch party.", "error");
  }
}

function resetConversationsState() {
  state.conversations = [];
  state.conversationsLoaded = false;
  state.conversationsLoading = false;
  state.conversationsError = "";
  state.conversationMessages = new Map();
  state.conversationMessagesLoading = null;
  state.conversationMessagesError = "";
  state.conversationMessageSending = false;
  state.activeConversationId = null;
  renderConversationList();
}

function setConversationStatusMessage(message, { isError = false } = {}) {
  if (!conversationStatus) return;
  conversationStatus.textContent = message || "";
  conversationStatus.classList.toggle("error", Boolean(isError));
}

function upsertConversation(conversation) {
  if (!conversation || !conversation.id) return;
  const existingIndex = state.conversations.findIndex((entry) => entry.id === conversation.id);
  const merged =
    existingIndex >= 0
      ? { ...state.conversations[existingIndex], ...conversation }
      : conversation;
  const remaining = state.conversations.filter((entry) => entry.id !== conversation.id);
  state.conversations = [merged, ...remaining].sort(
    (a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0)
  );
  state.conversationsLoaded = true;
}

function getConversationTitle(conversation) {
  if (!conversation) return "Direct messages";
  if (conversation.title) return conversation.title;
  const selfHandle = canonicalHandle(state.session && state.session.username);
  const handles = (conversation.participants || [])
    .map((participant) => canonicalHandle(participant.username))
    .filter(Boolean);
  const others = handles.filter((handle) => handle !== selfHandle);
  const names = (others.length ? others : handles).slice(0, 3);
  if (!names.length) return "Direct messages";
  const label = names.join(", ");
  if (handles.length > names.length) {
    return `${label} +${handles.length - names.length}`;
  }
  return label;
}

function getConversationPreviewSnippet(conversation) {
  if (!conversation || !conversation.lastMessage) {
    return "No messages yet.";
  }
  const sender = conversation.lastMessage.senderUsername
    ? `@${canonicalHandle(conversation.lastMessage.senderUsername)}: `
    : "";
  const body = conversation.lastMessage.body || "";
  const combined = `${sender}${body}`.trim();
  if (!combined) {
    return "No messages yet.";
  }
  return combined.length > 140 ? `${combined.slice(0, 137)}…` : combined;
}

function renderConversationList() {
  if (!conversationList) return;
  conversationList.innerHTML = "";
  if (conversationStatus) {
    conversationStatus.textContent = "";
    conversationStatus.classList.remove("error");
  }

  if (state.conversationsLoading) {
    if (conversationStatus) {
      conversationStatus.textContent = "Loading conversations…";
    }
    renderConversationPreview();
    return;
  }

  if (state.conversationsError) {
    if (conversationStatus) {
      conversationStatus.textContent = state.conversationsError;
    }
    renderConversationPreview();
    return;
  }

  if (!state.conversations.length) {
    if (conversationStatus) {
      conversationStatus.textContent = "No conversations yet. Start one from a profile.";
    }
    renderConversationPreview();
    return;
  }

  state.conversations.forEach((conversation) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "conversation-row";
    row.dataset.conversationId = conversation.id || "";
    if (conversation.id && conversation.id === state.activeConversationId) {
      row.classList.add("is-active");
    }

    const conversationTitle = getConversationTitle(conversation);
    const conversationAvatarUrl =
      (typeof conversation.avatarUrl === "string" && conversation.avatarUrl.trim()) ||
      (typeof conversation.avatar_url === "string" && conversation.avatar_url.trim()) ||
      "";

    const avatar = document.createElement("div");
    avatar.className = "avatar conversation-avatar";
    setAvatarContent(avatar, {
      imageUrl: conversationAvatarUrl,
      initials: initialsFromName(conversationTitle),
      label: `${conversationTitle} avatar`
    });

    const stack = document.createElement("div");
    stack.className = "stack";

    const title = document.createElement("div");
    title.className = "conversation-title";
    title.textContent = conversationTitle;

    const meta = document.createElement("div");
    meta.className = "conversation-meta";
    meta.textContent = formatRelativeTimestamp(conversation.lastMessageAt);

    const snippet = document.createElement("p");
    snippet.className = "conversation-snippet";
    snippet.textContent = getConversationPreviewSnippet(conversation);

    stack.append(title, meta, snippet);
    row.append(avatar, stack);
    row.addEventListener("click", () => setActiveConversation(conversation.id));
    conversationList.append(row);
  });

  renderConversationPreview();
}

function getConversationMessages(conversationId) {
  if (!conversationId) return [];
  return state.conversationMessages.get(conversationId) || [];
}

function renderConversationMessages(conversation) {
  if (!conversationMessages) return;
  conversationMessages.innerHTML = "";

  const isLoading = state.conversationMessagesLoading === conversation.id;
  const statusMessage = state.conversationMessagesError
    ? state.conversationMessagesError
    : isLoading
    ? "Loading messages…"
    : "";
  if (conversationThreadStatus) {
    conversationThreadStatus.textContent = statusMessage;
    conversationThreadStatus.classList.toggle("error", Boolean(state.conversationMessagesError));
  }

  if (isLoading) {
    const loading = document.createElement("div");
    loading.className = "small-text muted";
    loading.textContent = "Loading messages…";
    conversationMessages.append(loading);
    return;
  }

  if (state.conversationMessagesError) {
    const error = document.createElement("div");
    error.className = "small-text error";
    error.textContent = state.conversationMessagesError;
    conversationMessages.append(error);
    return;
  }

  const messages = getConversationMessages(conversation.id);
  if (!messages.length) {
    const empty = document.createElement("div");
    empty.className = "small-text muted";
    empty.textContent = "No messages yet. Start the conversation.";
    conversationMessages.append(empty);
    return;
  }

  messages.forEach((message) => {
    const row = document.createElement("div");
    row.className = "conversation-message";
    if (state.session && canonicalHandle(state.session.username) === canonicalHandle(message.senderUsername)) {
      row.classList.add("is-self");
    }
    const meta = document.createElement("div");
    meta.className = "conversation-message-meta";
    const author = canonicalHandle(message.senderUsername);
    const timestamp = message.createdAt ? formatRelativeTimestamp(message.createdAt) : "Just now";
    meta.textContent = `@${author} · ${timestamp}`;
    const body = document.createElement("div");
    body.className = "conversation-message-body";
    body.textContent = message.body || "";
    row.append(meta, body);
    conversationMessages.append(row);
  });
}

function renderConversationPreview() {
  if (!conversationPreview || !conversationPlaceholder || !conversationThread) return;
  const conversation = state.conversations.find((entry) => entry.id === state.activeConversationId);
  if (!conversation) {
    conversationPlaceholder.hidden = false;
    conversationThread.hidden = true;
    if (conversationMessages) {
      conversationMessages.innerHTML = "";
    }
    if (conversationThreadStatus) {
      conversationThreadStatus.textContent = "";
      conversationThreadStatus.classList.remove("error");
    }
    return;
  }

  conversationPlaceholder.hidden = true;
  conversationThread.hidden = false;
  if (conversationPreviewTitle) {
    conversationPreviewTitle.textContent = getConversationTitle(conversation);
  }
  if (conversationPreviewMeta) {
    const participantHandles = (conversation.participants || [])
      .map((participant) => `@${canonicalHandle(participant.username)}`)
      .filter(Boolean);
    const details = [];
    if (participantHandles.length) {
      details.push(participantHandles.join(", "));
    }
    if (conversation.lastMessageAt) {
      details.push(formatRelativeTimestamp(conversation.lastMessageAt));
    }
    conversationPreviewMeta.textContent = details.join(" · ") || "Conversation";
  }
  if (conversationPreviewBody) {
    conversationPreviewBody.textContent = getConversationPreviewSnippet(conversation);
  }

  renderConversationMessages(conversation);

  const disableInputs = !hasActiveSession() || state.conversationMessageSending;
  if (conversationInput) {
    conversationInput.disabled = disableInputs;
  }
  if (conversationSendButton) {
    conversationSendButton.disabled = disableInputs;
  }
}

function setActiveConversation(conversationId) {
  state.activeConversationId = conversationId || null;
  state.conversationMessagesError = "";
  renderConversationList();
  if (state.activeConversationId) {
    loadConversationMessages(state.activeConversationId);
  }
}

async function startConversationWithHandle(handle) {
  const normalized = canonicalHandle(handle);
  if (!normalized) {
    setConversationStatusMessage("Choose someone to message first.", { isError: true });
    return;
  }
  if (!hasActiveSession()) {
    promptForAuth("messages", "inbox");
    return;
  }
  setConversationStatusMessage(`Opening chat with @${normalized}…`);
  try {
    const conversation = await startDirectConversationRemote(normalized);
    upsertConversation(conversation);
    state.activeConversationId = conversation.id;
    setSection("messages");
    setTab("messages", "inbox");
    renderConversationList();
    await loadConversationMessages(conversation.id, true);
    setConversationStatusMessage("");
  } catch (error) {
    setConversationStatusMessage(error.message || "Unable to start that conversation.", { isError: true });
  }
}

async function loadConversationMessages(conversationId = state.activeConversationId, force = false) {
  const targetId = conversationId || state.activeConversationId;
  if (!targetId || state.conversationMessagesLoading === targetId) {
    return;
  }
  if (!hasActiveSession()) {
    state.conversationMessagesError = "Sign in to view messages.";
    renderConversationPreview();
    return;
  }
  if (!force && state.conversationMessages.has(targetId)) {
    renderConversationPreview();
    return;
  }
  state.conversationMessagesLoading = targetId;
  state.conversationMessagesError = "";
  renderConversationPreview();
  try {
    const messages = await listConversationMessagesRemote(targetId);
    state.conversationMessages.set(targetId, messages);
  } catch (error) {
    state.conversationMessagesError = error.message || "Unable to load messages.";
  } finally {
    state.conversationMessagesLoading = null;
    renderConversationPreview();
  }
}

async function handleConversationMessageSubmit(event) {
  if (event) {
    event.preventDefault();
  }
  if (!state.activeConversationId) {
    state.conversationMessagesError = "Select a conversation first.";
    renderConversationPreview();
    return;
  }
  if (!hasActiveSession()) {
    openAuthOverlay("login");
    return;
  }
  const body = conversationInput ? conversationInput.value.trim() : "";
  if (!body) {
    if (conversationInput) {
      conversationInput.focus();
    }
    return;
  }

  state.conversationMessageSending = true;
  state.conversationMessagesError = "";
  if (conversationInput) {
    conversationInput.disabled = true;
  }
  if (conversationSendButton) {
    conversationSendButton.disabled = true;
  }
  renderConversationPreview();

  try {
    const sent = await postConversationMessageRemote({
      conversationId: state.activeConversationId,
      body
    });
    const existing = getConversationMessages(state.activeConversationId);
    const merged = [...existing, sent].sort(
      (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
    );
    state.conversationMessages.set(state.activeConversationId, merged);
    if (conversationInput) {
      conversationInput.value = "";
    }
    const lastMessageAt = sent.createdAt || new Date().toISOString();
    state.conversations = state.conversations
      .map((conversation) =>
        conversation.id === state.activeConversationId
          ? { ...conversation, lastMessage: sent, lastMessageAt }
          : conversation
      )
      .sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));
    renderConversationList();
  } catch (error) {
    state.conversationMessagesError = error.message || "Unable to send message.";
  } finally {
    state.conversationMessageSending = false;
    renderConversationPreview();
  }
}

async function loadConversations(force = false) {
  if (!hasActiveSession()) {
    resetConversationsState();
    return;
  }
  if (state.conversationsLoading || (state.conversationsLoaded && !force)) {
    return;
  }
  state.conversationsLoading = true;
  state.conversationsError = "";
  renderConversationList();
  try {
    const conversations = await listConversationsRemote();
    state.conversations = conversations;
    state.conversationsLoaded = true;
    if (state.activeConversationId && !conversations.some((entry) => entry.id === state.activeConversationId)) {
      state.activeConversationId = null;
    }
    if (!state.activeConversationId && conversations.length) {
      state.activeConversationId = conversations[0].id;
    }
    if (state.activeConversationId) {
      loadConversationMessages(state.activeConversationId, true);
    }
  } catch (error) {
    state.conversationsError = error.message || "Unable to load conversations.";
    state.conversationsLoaded = false;
  } finally {
    state.conversationsLoading = false;
    renderConversationList();
  }
}

async function loadDiscover(filter = "popular") {
  state.discoverFilter = filter;
  const filterButtons = document.querySelectorAll("[data-filter]");
  filterButtons.forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.filter === filter);
  });
  await loadDiscoverResults({ query: discoverSearchInput ? discoverSearchInput.value : "" });
}

async function loadTrendingPeople(query = "", { signal } = {}) {
  state.peopleSearchActive = Boolean(query && query.length >= 2);
  const searchPath = query && query.length >= 3 ? "search/person" : "trending/person/week";
  const params = query && query.length >= 3 ? { query, include_adult: "false" } : { page: 1 };
  try {
    const data = await fetchFromTmdb(searchPath, params, { signal });
    const limit = getUiLimit("ui.discover.maxPeople", 6);
    state.discoverPeople = Array.isArray(data?.results) ? data.results.slice(0, limit) : [];
    renderPeopleSection();
  } catch (error) {
    if (error.name === "AbortError") return;
    console.warn("people fetch failed", error);
    state.discoverPeople = [];
    renderPeopleSection();
  }
}

async function loadTrendingMovies(timeWindow = state.trendingWindow) {
  if (state.trendingAbort) {
    state.trendingAbort.abort();
  }

  state.trendingWindow = timeWindow || "weekly";
  state.trendingLoading = true;
  state.trendingError = "";
  renderTrendingStatus();
  renderTrendingMovies(state.trendingMovies);

  const controller = new AbortController();
  state.trendingAbort = controller;

  try {
    const limit = getUiLimit("ui.discover.trendingCount", 8);
    const data = await fetchTrendingMovies(
      {
        time_window: state.trendingWindow,
        limit
      },
      { signal: controller.signal }
    );

    const movies = Array.isArray(data?.movies) ? data.movies.slice(0, limit) : [];
    state.trendingMovies = await attachOmdbMetadata(movies, {
      signal: controller.signal,
      max: Math.min(6, limit)
    });
  } catch (error) {
    if (error.name === "AbortError") return;
    console.warn("trending fetch failed", error);
    state.trendingMovies = [];
    state.trendingError = "Unable to load trending movies right now.";
  } finally {
    state.trendingAbort = null;
    state.trendingLoading = false;
    renderTrendingMovies(state.trendingMovies);
    renderTrendingStatus();
  }
}

async function loadHomeRecommendations() {
  if (state.recommendationsAbort) {
    state.recommendationsAbort.abort();
  }
  const controller = new AbortController();
  state.recommendationsAbort = controller;

  try {
    const candidates = await discoverCandidateMovies(
      {
        mood: "any",
        selectedGenres: [],
        favoriteTitles: [],
        seed: state.recommendationSeed
      },
      { signal: controller.signal }
    );

    const maxRecs = getUiLimit("ui.home.maxRecommendations", 10);
    const scored = scoreAndSelectCandidates(candidates, { maxCount: maxRecs }, []);
    const enriched = await fetchOmdbForCandidates(scored, { signal: controller.signal });
    if (!enriched.length) {
      state.homeRecommendations = [];
      renderHomeRecommendations(state.homeRecommendations);
      renderGroupPicks([]);
      return;
    }
    state.homeRecommendations = enriched;
    renderHomeRecommendations(enriched);
    renderGroupPicks(enriched.slice(0, getUiLimit("ui.home.groupPicks", 3)));
    logRecommendationEvent({
      action: "home_recommendations_generated",
      metadata: { count: enriched.length, seed: state.recommendationSeed }
    });
  } catch (error) {
    if (error.name === "AbortError") return;
    console.warn("recommendations failed", error);
    state.homeRecommendations = [];
    renderHomeRecommendations(state.homeRecommendations);
    renderGroupPicks([]);
  }

  state.recommendationsAbort = null;
}

function renderHomeRecommendations(items = []) {
  if (!homeRecommendationsRow) return;
  homeRecommendationsRow.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No picks yet. Try again soon.";
    homeRecommendationsRow.append(empty);
    return;
  }

  const maxRecs = getUiLimit("ui.home.maxRecommendations", 10);
  const layoutVariant = getExperimentVariant("home_recs_layout", "hero");
  const limitedItems = items.slice(0, maxRecs);
  const visibleItems =
    layoutVariant === "stacked"
      ? limitedItems.slice(0, Math.max(3, Math.min(6, maxRecs)))
      : limitedItems;

  const heroSource = limitedItems[0];
  updateTonightPick(heroSource);
  homeRecommendationsRow.dataset.layout = layoutVariant;

  visibleItems.forEach((item) => {
    const posterUrl = item.tmdb?.poster_path
      ? `https://image.tmdb.org/t/p/w342${item.tmdb.poster_path}`
      : item.omdb?.Poster && item.omdb.Poster !== "N/A"
      ? item.omdb.Poster
      : "";
    const year = item.omdb?.Year || (item.tmdb?.release_date || "").slice(0, 4);
    const normalized = {
      tmdbId: item.tmdb?.id || null,
      imdbId: item.omdb?.imdbID || null,
      title: item.omdb?.Title || item.tmdb?.title || "Untitled",
      posterUrl,
      releaseYear: year,
      genres: Array.isArray(item.tmdb?.genre_ids) ? item.tmdb.genre_ids : [],
      rating: typeof item.tmdb?.vote_average === "number" ? item.tmdb.vote_average : null
    };

    const card = buildGlassMovieCard(normalized);

    if (!card) return;
    const tmdbScore = item.tmdb?.vote_average;
    const badge = document.createElement("span");
    badge.className = "badge rating poster-badge";
    badge.textContent = tmdbScore ? tmdbScore.toFixed(1) : "New";
    const meta = [formatGenres(normalized.genres), year].filter(Boolean).join(" • ");
    decorateMovieCard(card, { meta, chips: [badge] });
    homeRecommendationsRow.append(card);
  });
}

function updateTonightPick(item) {
  if (!tonightPickCard || !item) return;
  const title = tonightPickCard.querySelector("[data-tonight-pick-title]");
  const overview = tonightPickCard.querySelector("[data-tonight-pick-overview]");
  const posterHost = tonightPickCard.querySelector("[data-tonight-pick-poster]");
  const trailerBtn = tonightPickCard.querySelector("[data-tonight-pick-trailer]");
  const detailsBtn = tonightPickCard.querySelector("[data-tonight-pick-details]");

  const titleText = item.omdb?.Title || item.tmdb?.title || "Tonight's pick";
  const year = item.omdb?.Year || (item.tmdb?.release_date || "").slice(0, 4);
  if (title) {
    title.textContent = year ? `${titleText} (${year})` : titleText;
  }
  if (overview) {
    overview.textContent = item.tmdb?.overview || item.omdb?.Plot || "A fresh discovery for you.";
  }
  if (posterHost) {
    const posterUrl = item.tmdb?.poster_path
      ? `https://image.tmdb.org/t/p/w342${item.tmdb.poster_path}`
      : item.omdb?.Poster && item.omdb.Poster !== "N/A"
      ? item.omdb.Poster
      : "";
    const posterEl = createPoster(posterUrl);
    posterHost.replaceWith(posterEl);
    posterEl.setAttribute("data-tonight-pick-poster", "");
  }

  if (trailerBtn) {
    trailerBtn.onclick = () => {
      const query = `${titleText} ${year || ""} official trailer`;
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      window.open(url, "_blank", "noopener");
    };
  }

  if (detailsBtn) {
    detailsBtn.onclick = () => {
      const url = item.tmdb?.id
        ? `https://www.themoviedb.org/movie/${item.tmdb.id}`
        : `https://www.google.com/search?q=${encodeURIComponent(titleText)}`;
      window.open(url, "_blank", "noopener");
    };
  }
}

function renderGroupPicks(items = []) {
  if (!groupPicksList) return;
  groupPicksList.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Add friends to see group picks.";
    groupPicksList.append(empty);
    return;
  }

  items.forEach((item, index) => {
    const posterUrl = item.tmdb?.poster_path
      ? `https://image.tmdb.org/t/p/w342${item.tmdb.poster_path}`
      : item.omdb?.Poster && item.omdb.Poster !== "N/A"
      ? item.omdb.Poster
      : "";
    const year = item.omdb?.Year || (item.tmdb?.release_date || "").slice(0, 4);
    const normalized = {
      tmdbId: item.tmdb?.id || null,
      imdbId: item.omdb?.imdbID || null,
      title: item.omdb?.Title || item.tmdb?.title || "Untitled",
      posterUrl,
      releaseYear: year,
      genres: Array.isArray(item.tmdb?.genre_ids) ? item.tmdb.genre_ids : [],
      rating: typeof item.tmdb?.vote_average === "number" ? item.tmdb.vote_average : null
    };

    const card = buildGlassMovieCard(normalized);

    if (!card) return;
    const badge = document.createElement("span");
    badge.className = "badge match";
    badge.textContent = `${82 + index * 4}% match`;
    const meta = [formatGenres(normalized.genres), year].filter(Boolean).join(" · ");
    decorateMovieCard(card, { meta, chips: [badge] });
    groupPicksList.append(card);
  });
}

function updateDiscoverPlaceholder() {
  if (!discoverSearchInput) return;
  const tab = state.activeTabs.discover;
  const text = tab === "series" ? "Search series…" : tab === "people" ? "Search people…" : "Search movies…";
  discoverSearchInput.placeholder = text;
}

function openDiscoverResults(tab, query) {
  setSection("discover");
  setTab("discover", tab);
  if (discoverSearchInput) discoverSearchInput.value = query;
  if (tab === "people") {
    loadDiscoverPeople(query);
  } else {
    loadDiscoverResults({ query });
  }
  hideDiscoverDropdown();
}

function hideDiscoverDropdown() {
  if (discoverDropdown) {
    discoverDropdown.hidden = true;
  }
  if (discoverSearchInput) {
    discoverSearchInput.setAttribute("aria-expanded", "false");
  }
}

function renderDiscoverDropdown(items = [], mode = "movies", query = "") {
  if (!discoverDropdown) return;
  discoverDropdown.innerHTML = "";
  discoverDropdown.hidden = false;
  if (discoverSearchInput) {
    discoverSearchInput.setAttribute("aria-expanded", "true");
  }
  const container = document.createElement("div");
  container.className = "stack";

  if (mode === "people") {
    const list = document.createElement("div");
    const max = getUiLimit("ui.discover.maxPeople", 6);
    (items || []).slice(0, max).forEach((person) => {
      const row = document.createElement("div");
      row.className = "search-dropdown-item";
      row.setAttribute("role", "option");
      const avatar = document.createElement("div");
      avatar.className = "avatar";
      const display = person.displayName || person.name || "Member";
      const handle = person.username || "";
      const avatarUrl = person.avatarUrl || person.avatar_url || "";
      setAvatarContent(avatar, { imageUrl: avatarUrl, initials: initialsFromName(display), label: `${display} avatar` });
      const text = document.createElement("div");
      text.className = "stack";
      const name = document.createElement("strong");
      name.textContent = display;
      const meta = document.createElement("div");
      meta.className = "small-text muted";
      meta.textContent = handle ? `@${canonicalHandle(handle)}` : "";
      text.append(name, meta);
      row.append(avatar, text);
      list.append(row);
    });
    container.append(list);
  } else {
    const first = Array.isArray(items) && items.length ? items[0] : null;
    if (!first) {
      const empty = document.createElement("div");
      empty.className = "small-text muted";
      empty.textContent = "No matches";
      container.append(empty);
    } else {
      const normalized = mode === "series" ? normalizeDiscoverSeries(first) : normalizeDiscoverMovie(first);
      const row = document.createElement("div");
      row.className = "search-dropdown-item";
      row.setAttribute("role", "option");
      const poster = createPoster(normalized?.posterUrl || "");
      const body = document.createElement("div");
      body.className = "stack";
      const title = document.createElement("strong");
      const year = normalized?.releaseYear ? ` (${normalized.releaseYear})` : "";
      title.textContent = `${normalized?.title || "Untitled"}${year}`;
      const rating = document.createElement("div");
      rating.className = "small-text";
      rating.textContent = Number.isFinite(normalized?.rating) ? `${normalized.rating.toFixed(1)} / 10` : "";
      body.append(title, rating);
      row.append(poster, body);
      container.append(row);
    }
  }

  const footer = document.createElement("div");
  footer.className = "search-dropdown-footer";
  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "btn btn-primary";
  moreBtn.textContent = "Show more results";
  const tab = mode === "series" ? "series" : mode === "people" ? "people" : "movies";
  moreBtn.addEventListener("click", () => openDiscoverResults(tab, query));
  footer.append(moreBtn);
  discoverDropdown.append(container, footer);
}

async function loadDiscoverDropdown(query = "") {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) {
    hideDiscoverDropdown();
    return;
  }
  if (state.discoverDropdownAbort) {
    state.discoverDropdownAbort.abort();
  }
  const controller = new AbortController();
  state.discoverDropdownAbort = controller;
  if (discoverDropdown) {
    discoverDropdown.hidden = false;
    discoverDropdown.innerHTML = "<div class=\"small-text muted\">Searching…</div>";
    if (discoverSearchInput) discoverSearchInput.setAttribute("aria-expanded", "true");
  }
  try {
    const mode = state.activeTabs.discover === "series" ? "series" : state.activeTabs.discover === "people" ? "people" : "movies";
    if (mode === "people") {
      const people = await searchSocialUsers(trimmed);
      if (controller.signal.aborted) return;
      renderDiscoverDropdown(people, "people", trimmed);
    } else if (mode === "series") {
      const series = await fetchDiscoverSeriesOnline({ query: trimmed, filter: state.discoverFilter, signal: controller.signal, limitOverride: 1 });
      renderDiscoverDropdown(series, "series", trimmed);
    } else {
      const movies = await fetchDiscoverMoviesOnline({ query: trimmed, filter: state.discoverFilter, signal: controller.signal, limitOverride: 1 });
      renderDiscoverDropdown(movies, "movies", trimmed);
    }
  } catch (_) {
    if (discoverDropdown) {
      discoverDropdown.innerHTML = "<div class=\"small-text muted\">Couldn’t search right now.</div>";
    }
  } finally {
    state.discoverDropdownAbort = null;
  }
}

function handleDiscoverSearchInput(value) {
  const query = value.trim();
  state.peopleSearchActive = query.length >= 2;
  loadDiscoverResults({ query });
  loadDiscoverPeople(query);
  if (query.length >= 2) {
    loadDiscoverDropdown(query);
  } else {
    hideDiscoverDropdown();
  }
}

async function loadDiscoverPeople(query = "") {
  const trimmed = query.trim();
  if (state.discoverPeopleAbort) {
    state.discoverPeopleAbort.abort();
  }

  const controller = new AbortController();
  state.discoverPeopleAbort = controller;

  if (!trimmed) {
    await loadTrendingPeople();
    state.discoverPeopleAbort = null;
    return;
  }

  try {
    const socialMatches = await searchSocialUsers(trimmed);
    if (controller.signal.aborted) return;
    if (Array.isArray(socialMatches) && socialMatches.length) {
      state.discoverPeople = socialMatches;
      renderPeople(state.discoverPeople, { source: "social" });
      state.discoverPeopleAbort = null;
      return;
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      console.warn("social user search failed", error);
    }
  }

  try {
    await loadTrendingPeople(trimmed, { signal: controller.signal });
  } finally {
    state.discoverPeopleAbort = null;
  }
}

function buildDiscoverParams(filter = "popular", query = "") {
  const params = {
    language: "en-US",
    include_adult: "false",
    page: 1
  };

  if (query) {
    params.query = query;
    return { path: "search/movie", params };
  }

  switch (filter) {
    case "top-rated":
      params.sort_by = "vote_average.desc";
      params["vote_count.gte"] = 500;
      break;
    case "new":
      params.sort_by = "primary_release_date.desc";
      params["primary_release_date.gte"] = formatRecentDate(120);
      break;
    case "streaming":
      params.sort_by = "popularity.desc";
      params.with_watch_monetization_types = "flatrate|ads|free";
      params.watch_region = "US";
      break;
    case "friends":
      params.sort_by = "popularity.desc";
      break;
    default:
      params.sort_by = "popularity.desc";
  }

  return { path: "discover/movie", params };
}

function buildDiscoverSeriesParams(filter = "popular", query = "") {
  const params = {
    language: "en-US",
    include_adult: "false",
    page: 1
  };

  if (query) {
    params.query = query;
    return { path: "search/tv", params };
  }

  switch (filter) {
    case "top-rated":
      params.sort_by = "vote_average.desc";
      params["vote_count.gte"] = 300;
      break;
    case "new":
      params.sort_by = "first_air_date.desc";
      params["first_air_date.gte"] = formatRecentDate(120);
      break;
    case "streaming":
      params.sort_by = "popularity.desc";
      params.with_watch_monetization_types = "flatrate|ads|free";
      params.watch_region = "US";
      break;
    case "friends":
      params.sort_by = "popularity.desc";
      break;
    default:
      params.sort_by = "popularity.desc";
  }

  return { path: "discover/tv", params };
}

function formatRecentDate(daysAgo = 120) {
  const boundary = new Date();
  boundary.setDate(boundary.getDate() - daysAgo);
  return boundary.toISOString().slice(0, 10);
}

async function attachOmdbMetadata(movies, { signal, max = 6 } = {}) {
  const sample = movies.slice(0, max);
  const lookups = await Promise.all(
    sample.map(async (movie) => {
      const title = movie.title || movie.original_title || movie.name || "";
      if (!title) return null;
      const year = movie.release_date ? movie.release_date.slice(0, 4) : movie.releaseYear || "";
      try {
        const omdb = await fetchFromOmdb({ t: title, y: year }, { signal });
        if (omdb && omdb.Response !== "False") {
          return { imdbId: omdb.imdbID || movie.imdbId || movie.imdb_id || null, omdb };
        }
      } catch (error) {
        if (error.name === "AbortError") throw error;
        console.warn("OMDb lookup failed", error);
      }
      return null;
    })
  );

  return movies.map((movie, index) => {
    const enrichment = index < lookups.length ? lookups[index] : null;
    if (enrichment && enrichment.omdb) {
      return { ...movie, imdbId: enrichment.imdbId, omdb: enrichment.omdb };
    }
    return movie;
  });
}

async function fetchDiscoverMoviesOnline({ query = "", filter = "popular", signal, limitOverride } = {}) {
  const limit = Number.isFinite(limitOverride) && limitOverride > 0 ? limitOverride : getUiLimit("ui.discover.maxMovies", 12);
  const { path, params } = buildDiscoverParams(filter, query);
  const data = await fetchFromTmdb(path, params, { signal });
  const results = Array.isArray(data?.results) ? data.results.slice(0, limit) : [];
  return attachOmdbMetadata(results, { signal, max: Math.min(6, limit) });
}

async function fetchDiscoverSeriesOnline({ query = "", filter = "popular", signal, limitOverride } = {}) {
  const limit = Number.isFinite(limitOverride) && limitOverride > 0 ? limitOverride : getUiLimit("ui.discover.maxSeries", 12);
  const { path, params } = buildDiscoverSeriesParams(filter, query);
  const data = await fetchFromTmdb(path, params, { signal });
  const results = Array.isArray(data?.results) ? data.results.slice(0, limit) : [];
  return results;
}

async function loadDiscoverMovieResults({ query = "" } = {}) {
  const trimmedQuery = query.trim();
  if (state.discoverAbort) {
    state.discoverAbort.abort();
  }
  const controller = new AbortController();
  state.discoverAbort = controller;

  try {
    const movieResults = await fetchDiscoverMoviesOnline({
      query: trimmedQuery,
      filter: state.discoverFilter,
      signal: controller.signal
    });
    renderDiscoverMovies(movieResults);
    if (trimmedQuery.length >= 2) {
      logSearchEvent({
        query: trimmedQuery,
        filters: { source: "discover", sort: state.discoverFilter },
        resultsCount: movieResults.length,
        clientContext: { hasSession: Boolean(state.session?.token) }
      });
    }
  } catch (error) {
    if (error.name === "AbortError") return;
    console.warn("search failed", error);
    renderDiscoverMovies([]);
  } finally {
    state.discoverAbort = null;
  }
}

async function loadDiscoverSeriesResults({ query = "" } = {}) {
  const trimmedQuery = query.trim();
  if (state.discoverSeriesAbort) {
    state.discoverSeriesAbort.abort();
  }
  const controller = new AbortController();
  state.discoverSeriesAbort = controller;

  try {
    const seriesResults = await fetchDiscoverSeriesOnline({
      query: trimmedQuery,
      filter: state.discoverFilter,
      signal: controller.signal
    });
    renderDiscoverSeries(seriesResults);
    if (trimmedQuery.length >= 2) {
      logSearchEvent({
        query: trimmedQuery,
        filters: { source: "discover-series", sort: state.discoverFilter },
        resultsCount: seriesResults.length,
        clientContext: { hasSession: Boolean(state.session?.token) }
      });
    }
  } catch (error) {
    if (error.name === "AbortError") return;
    console.warn("series search failed", error);
    renderDiscoverSeries([]);
  } finally {
    state.discoverSeriesAbort = null;
  }
}

async function loadDiscoverResults({ query = "" } = {}) {
  const trimmedQuery = query.trim();
  const discoverTab = state.activeTabs.discover;
  if (discoverTab === "series") {
    await loadDiscoverSeriesResults({ query: trimmedQuery });
    return;
  }

  await loadDiscoverMovieResults({ query: trimmedQuery });
}

async function handleAuthSubmit(event) {
  if (event) {
    event.preventDefault();
  }
  if (!authUsernameInput || !authPasswordInput) return;
  if (state.authSubmitting) return;

  const username = authUsernameInput.value ? authUsernameInput.value.trim() : "";
  const password = authPasswordInput.value || "";
  const displayName =
    authDisplayNameInput && authDisplayNameInput.value
      ? authDisplayNameInput.value.trim()
      : "";
  const avatarFile =
    state.authMode === "signup" && authAvatarInput && authAvatarInput.files
      ? authAvatarInput.files[0] || null
      : null;

  if (!username || !password) {
    setAuthStatus("Enter your username and password.", "error");
    return;
  }

  if (avatarFile && !avatarFile.type.startsWith("image/")) {
    setAuthStatus("Please choose an image for your avatar.", "error");
    return;
  }

  if (avatarFile && avatarFile.size > 5 * 1024 * 1024) {
    setAuthStatus("Avatar images must be 5 MB or smaller.", "error");
    return;
  }

  state.authSubmitting = true;
  if (authSubmitButton) {
    authSubmitButton.setAttribute("disabled", "true");
  }
  setAuthStatus(
    state.authMode === "signup" ? "Creating your account…" : "Signing you in…"
  );

  try {
    let avatarBase64 = null;
    let avatarFileName = null;

    if (state.authMode === "signup" && avatarFile) {
      avatarBase64 = await fileToBase64(avatarFile);
      avatarFileName = avatarFile.name;
    }

    const session =
      state.authMode === "signup"
        ? await registerUser({
            username,
            password,
            name: displayName,
            avatarBase64,
            avatarFileName
          })
        : await loginUser({ username, password });
    setAuthStatus("You're signed in!", "success");
    closeAuthOverlay();
    updateAccountUi(session);
  } catch (error) {
    const message =
      (error && error.message) ||
      "Unable to complete the request. Please try again.";
    setAuthStatus(message, "error");
  } finally {
    state.authSubmitting = false;
    if (authSubmitButton) {
      authSubmitButton.removeAttribute("disabled");
    }
  }
}

function setProfileEditorStatus(message, variant = "info") {
  if (!profileEditStatus) return;
  profileEditStatus.textContent = message || "";
  profileEditStatus.classList.remove("error", "success");
  if (variant === "error") {
    profileEditStatus.classList.add("error");
  }
  if (variant === "success") {
    profileEditStatus.classList.add("success");
  }
}

function buildChipOptions(host, entries = []) {
  if (!host) return;
  host.innerHTML = "";
  entries.forEach(({ value, label }) => {
    const option = document.createElement("label");
    option.className = "chip-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = value;
    const text = document.createElement("span");
    text.textContent = label;
    option.append(input, text);
    host.append(option);
  });
}

function ensureProfileOptionChips() {
  if (profileGenreOptions && !profileGenreOptions.dataset.built) {
    const genres = Object.entries(TMDB_GENRES)
      .map(([key, label]) => ({ value: String(key), label }))
      .sort((a, b) => a.label.localeCompare(b.label));
    buildChipOptions(profileGenreOptions, genres);
    profileGenreOptions.dataset.built = "true";
  }
  if (profileDecadeOptions && !profileDecadeOptions.dataset.built) {
    const decades = FAVORITE_DECADE_OPTIONS.map((label) => ({ value: label, label }));
    buildChipOptions(profileDecadeOptions, decades);
    profileDecadeOptions.dataset.built = "true";
  }
}

function setSelectedOptions(host, selectedValues = []) {
  if (!host) return;
  const selected = new Set(uniqueStringList(selectedValues));
  const inputs = host.querySelectorAll('input[type="checkbox"]');
  inputs.forEach((input) => {
    input.checked = selected.has(input.value);
  });
}

function getSelectedOptionValues(host) {
  if (!host) return [];
  const inputs = host.querySelectorAll('input[type="checkbox"]:checked');
  return uniqueStringList(Array.from(inputs).map((input) => input.value));
}

function updateProfileEditorCounts() {
  if (profileGenreCount && profileGenreOptions) {
    const count = profileGenreOptions.querySelectorAll('input[type="checkbox"]:checked').length;
    profileGenreCount.textContent = `${count} selected`;
  }
  if (profileDecadeCount && profileDecadeOptions) {
    const count = profileDecadeOptions.querySelectorAll('input[type="checkbox"]:checked').length;
    profileDecadeCount.textContent = `${count} selected`;
  }
}

function populateProfileEditor() {
  ensureProfileOptionChips();
  const profilePrefs =
    (state.session && state.session.preferencesSnapshot && state.session.preferencesSnapshot.profile) || {};
  if (profileEditDisplayName) {
    profileEditDisplayName.value =
      (state.session && (state.session.displayName || state.session.username)) || "";
  }
  if (profileEditBio) {
    profileEditBio.value = profilePrefs.bio || "";
  }
  if (profileEditLocation) {
    profileEditLocation.value = profilePrefs.location || "";
  }
  if (profileEditWebsite) {
    profileEditWebsite.value = profilePrefs.website || "";
  }
  if (profileEditPrivate) {
    profileEditPrivate.checked = Boolean(profilePrefs.isPrivate);
  }

  const favoriteGenres = profilePrefs.favoriteGenres || [];
  const favoriteDecades = profilePrefs.favoriteDecades || [];
  setSelectedOptions(profileGenreOptions, favoriteGenres);
  setSelectedOptions(profileDecadeOptions, favoriteDecades);
  updateProfileEditorCounts();
  setProfileEditorStatus("", "info");
}

function toggleProfileEditor(open) {
  const shouldOpen = open === undefined ? !state.profileEditorOpen : open;
  state.profileEditorOpen = shouldOpen;
  if (!profileEditOverlay) return;
  if (shouldOpen) {
    profileEditOverlay.hidden = false;
    profileEditOverlay.classList.add("is-visible");
    populateProfileEditor();
    if (profileEditDisplayName) {
      window.setTimeout(() => profileEditDisplayName.focus(), 30);
    }
  } else {
    profileEditOverlay.classList.remove("is-visible");
    profileEditOverlay.hidden = true;
    state.profileEditorSaving = false;
    setProfileEditorStatus("", "info");
  }
}

function closeProfileEditor() {
  toggleProfileEditor(false);
}

function setOnboardingStatus(message, variant = "info") {
  if (!onboardingStatus) return;
  onboardingStatus.textContent = message || "";
  onboardingStatus.classList.remove("error", "success");
  if (variant === "error") {
    onboardingStatus.classList.add("error");
  }
  if (variant === "success") {
    onboardingStatus.classList.add("success");
  }
}

function ensureOnboardingOptionChips() {
  if (onboardingGenreOptions && !onboardingGenreOptions.dataset.built) {
    const genres = Object.entries(TMDB_GENRES)
      .map(([key, label]) => ({ value: String(key), label }))
      .sort((a, b) => a.label.localeCompare(b.label));
    buildChipOptions(onboardingGenreOptions, genres);
    onboardingGenreOptions.dataset.built = "true";
  }
  if (onboardingDecadeOptions && !onboardingDecadeOptions.dataset.built) {
    const decades = FAVORITE_DECADE_OPTIONS.map((label) => ({ value: label, label }));
    buildChipOptions(onboardingDecadeOptions, decades);
    onboardingDecadeOptions.dataset.built = "true";
  }
  if (onboardingProviderOptions) {
    const providerOptions = getStreamingProviderOptions();
    const signature = providerOptions.map((option) => option.value).join(",");
    if (onboardingProviderOptions.dataset.built !== signature) {
      buildChipOptions(onboardingProviderOptions, providerOptions);
      onboardingProviderOptions.dataset.built = signature;
    }
  }
}

function getStreamingProviderOptions() {
  const providers = state.streamingProviders.length
    ? state.streamingProviders
    : STREAMING_PROVIDER_OPTIONS.map((provider) => ({
        key: provider.value,
        displayName: provider.label
      }));

  return providers.map((provider) => ({
    value: provider.key || provider.value,
    label: provider.displayName || provider.label || provider.key,
    brandColor: provider.brandColor || provider.metadata?.brand_color || null
  }));
}

function normalizeStreamingProvider(provider = {}) {
  return {
    key: provider.key || provider.value || "",
    displayName:
      provider.displayName || provider.display_name || provider.label || provider.key || "Streaming provider",
    url: provider.url || (provider.metadata && provider.metadata.url) || "",
    brandColor: provider.brandColor || provider.metadata?.brand_color || null
  };
}

function updateOnboardingCounts() {
  if (onboardingGenreCount && onboardingGenreOptions) {
    const count = onboardingGenreOptions.querySelectorAll('input[type="checkbox"]:checked').length;
    onboardingGenreCount.textContent = `${count} selected`;
  }
  if (onboardingDecadeCount && onboardingDecadeOptions) {
    const count = onboardingDecadeOptions.querySelectorAll('input[type="checkbox"]:checked').length;
    onboardingDecadeCount.textContent = `${count} selected`;
  }
  if (onboardingProviderCount && onboardingProviderOptions) {
    const count = onboardingProviderOptions.querySelectorAll('input[type="checkbox"]:checked').length;
    onboardingProviderCount.textContent = `${count} selected`;
  }
}

function getSelectedImportChoice() {
  const checked = Array.from(onboardingImportOptions || []).find((input) => input.checked);
  return (checked && checked.value) || "later";
}

function populateOnboardingSelections() {
  ensureOnboardingOptionChips();
  const preferences = (state.session && state.session.preferencesSnapshot) || {};
  const profilePrefs = preferences.profile || {};
  const streamingPrefs = preferences.streaming || {};
  const onboardingPrefs = preferences.onboarding || {};

  const favoriteGenres =
    state.onboardingSelections.favoriteGenres.length
      ? state.onboardingSelections.favoriteGenres
      : profilePrefs.favoriteGenres || [];
  const favoriteDecades =
    state.onboardingSelections.favoriteDecades.length
      ? state.onboardingSelections.favoriteDecades
      : profilePrefs.favoriteDecades || [];
  const streamingProviders =
    state.onboardingSelections.streamingProviders.length
      ? state.onboardingSelections.streamingProviders
      : streamingPrefs.providers || [];
  const importChoice =
    state.onboardingSelections.importChoice || onboardingPrefs.importChoice || "later";

  setSelectedOptions(onboardingGenreOptions, favoriteGenres);
  setSelectedOptions(onboardingDecadeOptions, favoriteDecades);
  setSelectedOptions(onboardingProviderOptions, streamingProviders);
  (onboardingImportOptions || []).forEach((input) => {
    input.checked = input.value === importChoice;
  });

  state.onboardingSelections = {
    favoriteGenres,
    favoriteDecades,
    streamingProviders,
    importChoice
  };

  updateOnboardingCounts();
  setOnboardingStatus("Pick a few quick options to personalize your feed.");
}

function readOnboardingSelections() {
  state.onboardingSelections = {
    favoriteGenres: getSelectedOptionValues(onboardingGenreOptions),
    favoriteDecades: getSelectedOptionValues(onboardingDecadeOptions),
    streamingProviders: getSelectedOptionValues(onboardingProviderOptions),
    importChoice: getSelectedImportChoice()
  };
  updateOnboardingCounts();
}

function setOnboardingStep(step) {
  const safeStep = ONBOARDING_STEPS.includes(step) ? step : ONBOARDING_STEPS[0];
  state.onboardingStep = safeStep;
  const activeIndex = ONBOARDING_STEPS.indexOf(safeStep);
  onboardingSteps.forEach((panel) => {
    const isActive = panel.dataset.onboardingStep === safeStep;
    panel.hidden = !isActive;
    panel.classList.toggle("is-active", isActive);
  });

  const labelMap = {
    taste: "Taste profile",
    providers: "Streaming services",
    import: "Import & history"
  };
  if (onboardingProgress) {
    onboardingProgress.textContent = `Step ${activeIndex + 1} of ${
      ONBOARDING_STEPS.length
    } · ${labelMap[safeStep] || "Onboarding"}`;
  }

  if (onboardingBackButton) {
    onboardingBackButton.disabled = activeIndex <= 0;
  }
  if (onboardingNextButton) {
    onboardingNextButton.hidden = activeIndex >= ONBOARDING_STEPS.length - 1;
  }
  if (onboardingFinishButton) {
    onboardingFinishButton.hidden = activeIndex < ONBOARDING_STEPS.length - 1;
  }
}

function openOnboarding() {
  if (!hasActiveSession() || !onboardingOverlay) return;
  state.onboardingOpen = true;
  onboardingOverlay.hidden = false;
  onboardingOverlay.classList.add("is-visible");
  populateOnboardingSelections();
  setOnboardingStep(state.onboardingStep);
}

function closeOnboarding(markDismissed = true) {
  if (!onboardingOverlay) return;
  onboardingOverlay.classList.remove("is-visible");
  onboardingOverlay.hidden = true;
  state.onboardingOpen = false;
  if (markDismissed) {
    state.onboardingDismissed = true;
  }
}

function shouldOpenOnboarding() {
  if (!hasActiveSession()) return false;
  if (state.onboardingOpen || state.onboardingDismissed) return false;
  const username = (state.session && state.session.username) || "anonymous";
  const preferences = (state.session && state.session.preferencesSnapshot) || {};
  const onboardingPrefs = preferences.onboarding || {};
  if (onboardingPrefs.completedAt) return false;
  return !isOnboardingLocallyComplete(username);
}

function maybeOpenOnboarding(force = false) {
  if (force) {
    state.onboardingDismissed = false;
  }
  if (!onboardingOverlay) return;
  if (force || shouldOpenOnboarding()) {
    state.onboardingStep = ONBOARDING_STEPS[0];
    openOnboarding();
  }
}

function getEventPath(event) {
  if (!event) return [];
  if (typeof event.composedPath === "function") {
    return event.composedPath();
  }
  const path = [];
  let node = event.target;
  while (node) {
    path.push(node);
    node = node.parentNode;
  }
  return path;
}

function eventPathIncludes(event, element) {
  if (!element) {
    return false;
  }
  return getEventPath(event).some((node) => node === element);
}

async function completeOnboardingFlow() {
  if (!hasActiveSession()) {
    closeOnboarding();
    promptForAuth("home", "for-you");
    return;
  }
  if (state.onboardingSubmitting) return;

  readOnboardingSelections();
  state.onboardingSubmitting = true;
  setOnboardingStatus("Saving your preferences...");
  if (onboardingFinishButton) {
    onboardingFinishButton.setAttribute("disabled", "disabled");
  }

  try {
    const workingSession = state.session;
    const existingSnapshot = (workingSession && workingSession.preferencesSnapshot) || {};
    const profilePrefs = existingSnapshot.profile || {};
    const streamingPrefs = existingSnapshot.streaming || {};
    const onboardingPrefs = existingSnapshot.onboarding || {};

    const favoriteGenres = uniqueStringList(state.onboardingSelections.favoriteGenres, 12, 60);
    const favoriteDecades = uniqueStringList(
      state.onboardingSelections.favoriteDecades,
      FAVORITE_DECADE_OPTIONS.length,
      20
    );
    const streamingProviders = uniqueStringList(state.onboardingSelections.streamingProviders, 12, 30);
    const importChoice = state.onboardingSelections.importChoice || "later";

    const nextSnapshot = {
      ...existingSnapshot,
      profile: { ...profilePrefs, favoriteGenres, favoriteDecades },
      streaming: { ...streamingPrefs, providers: streamingProviders },
      onboarding: {
        ...onboardingPrefs,
        completedAt: new Date().toISOString(),
        importChoice
      }
    };

    const updatedSession = await persistPreferencesRemote(workingSession, nextSnapshot);
    state.session = updatedSession || workingSession;
    markOnboardingCompleteLocally(state.session.username || "anonymous");
    setOnboardingStatus("Preferences saved. You're all set!", "success");
    updateAccountUi(state.session);
    renderProfileOverview();
    state.onboardingDismissed = true;
    window.setTimeout(() => closeOnboarding(), 180);
  } catch (error) {
    const message =
      (error && error.message) || "We couldn't save your onboarding preferences just yet.";
    setOnboardingStatus(message, "error");
  } finally {
    state.onboardingSubmitting = false;
    if (onboardingFinishButton) {
      onboardingFinishButton.removeAttribute("disabled");
    }
  }
}

async function handleProfileEditorSubmit(event) {
  event.preventDefault();
  if (state.profileEditorSaving) return;
  if (!hasActiveSession()) {
    closeProfileEditor();
    promptForAuth("profile", "overview");
    return;
  }

  const desiredName = sanitizeProfileText(
    (profileEditDisplayName && profileEditDisplayName.value) || "",
    120
  );
  const bio = sanitizeProfileText(profileEditBio && profileEditBio.value, 280);
  const location = sanitizeProfileText(profileEditLocation && profileEditLocation.value, 120);
  const website = normalizeWebsite(profileEditWebsite && profileEditWebsite.value);
  const isPrivate = profileEditPrivate ? Boolean(profileEditPrivate.checked) : false;
  const favoriteGenres = getSelectedOptionValues(profileGenreOptions);
  const favoriteDecades = getSelectedOptionValues(profileDecadeOptions);

  const nextProfilePrefs = {
    bio,
    location,
    website,
    favoriteGenres,
    favoriteDecades,
    isPrivate
  };

  state.profileEditorSaving = true;
  setProfileEditorStatus("Saving profile…");

  try {
    let workingSession = state.session;
    if (desiredName && workingSession && desiredName !== workingSession.displayName) {
      workingSession = await updateProfile({ displayName: desiredName });
    }

    const existingSnapshot = (workingSession && workingSession.preferencesSnapshot) || {};
    const existingProfile = existingSnapshot.profile || {};
    const mergedProfile = { ...existingProfile, ...nextProfilePrefs };
    mergedProfile.favoriteGenres = uniqueStringList(mergedProfile.favoriteGenres || []);
    mergedProfile.favoriteDecades = uniqueStringList(
      mergedProfile.favoriteDecades || [],
      FAVORITE_DECADE_OPTIONS.length,
      20
    );
    if (!mergedProfile.bio) delete mergedProfile.bio;
    if (!mergedProfile.location) delete mergedProfile.location;
    if (!mergedProfile.website) delete mergedProfile.website;
    const nextSnapshot = { ...existingSnapshot, profile: mergedProfile };

    const updatedSession = await persistPreferencesRemote(workingSession, nextSnapshot);
    state.session = updatedSession || workingSession;
    setProfileEditorStatus("Profile saved.", "success");
    updateAccountUi(state.session);
    renderProfileOverview();
    window.setTimeout(() => closeProfileEditor(), 200);
  } catch (error) {
    const message =
      (error && error.message) ||
      "We couldn’t save those changes. Please try again.";
    setProfileEditorStatus(message, "error");
  } finally {
    state.profileEditorSaving = false;
  }
}

function handleOutsideClick(event) {
  if (state.accountMenuOpen && accountMenu && accountToggle) {
    const insideAccountMenu =
      eventPathIncludes(event, accountMenu) || eventPathIncludes(event, accountToggle);
    if (!insideAccountMenu) {
      toggleAccountMenu(false);
    }
  }
  if (state.profileEditorOpen && profileEditOverlay && event.target === profileEditOverlay) {
    closeProfileEditor();
  }
  if (state.onboardingOpen && onboardingOverlay && event.target === onboardingOverlay) {
    closeOnboarding();
  }
  if (state.notificationMenuOpen && notificationMenu && notificationButton) {
    const insideNotificationUi =
      eventPathIncludes(event, notificationMenu) || eventPathIncludes(event, notificationButton);
    if (!insideNotificationUi) {
      closeNotificationMenu();
    }
  }
  if (discoverDropdown && !discoverDropdown.hidden) {
    const insideDropdown =
      eventPathIncludes(event, discoverDropdown) || eventPathIncludes(event, discoverSearchInput);
    if (!insideDropdown) {
      hideDiscoverDropdown();
    }
  }
}

function handleEscape(event) {
  if (event.key === "Escape") {
    if (state.accountMenuOpen) {
      toggleAccountMenu(false);
    }
    if (state.notificationMenuOpen) {
      closeNotificationMenu();
    }
    if (authOverlay && !authOverlay.hidden) {
      closeAuthOverlay();
    }
    if (state.profileEditorOpen) {
      closeProfileEditor();
    }
    if (state.onboardingOpen) {
      closeOnboarding();
    }
    hideDiscoverDropdown();
  }
}

function attachDocumentHandlers() {
  if (typeof detachDocumentHandlers === "function") {
    detachDocumentHandlers();
  }

  const clickHandler = (event) => handleOutsideClick(event);
  const keydownHandler = (event) => handleEscape(event);

  document.addEventListener("click", clickHandler);
  document.addEventListener("keydown", keydownHandler);

  detachDocumentHandlers = () => {
    document.removeEventListener("click", clickHandler);
    document.removeEventListener("keydown", keydownHandler);
  };
}

function attachListeners() {
  navButtons.forEach((btn) => {
    btn.addEventListener("click", () => setSection(btn.dataset.sectionButton));
  });

  tabGroups.forEach((group) => {
    group.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const section = group.dataset.sectionTabs;
        const tab = btn.dataset.tab;
        setTab(section, tab);
        if (section === "discover") {
          if (tab === "people") {
            loadDiscoverPeople(discoverSearchInput ? discoverSearchInput.value : "");
          } else {
            loadDiscover(state.discoverFilter);
          }
        }
      });
    });
  });

  const filterButtons = document.querySelectorAll("[data-filter]");
  filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextFilter = btn.dataset.filter;
      loadDiscover(nextFilter);
    });
  });

  if (trendingWindowSelect) {
    trendingWindowSelect.addEventListener("change", (event) => {
      loadTrendingMovies(event.target.value || "weekly");
    });
  }

  if (discoverSearchInput) {
    let handle;
    discoverSearchInput.addEventListener("input", (event) => {
      const { value } = event.target;
      window.clearTimeout(handle);
      handle = window.setTimeout(() => handleDiscoverSearchInput(value), 140);
    });
    discoverSearchInput.addEventListener("focus", () => {
      const q = discoverSearchInput.value || "";
      if (q.trim().length >= 2) {
        loadDiscoverDropdown(q.trim());
      }
    });
  }

  if (authPasswordInput) {
    setAuthPasswordVisibility(false);
  }

  if (authPasswordToggle && authPasswordInput) {
    authPasswordToggle.addEventListener("click", () => {
      setAuthPasswordVisibility(!state.authPasswordVisible);
      authPasswordInput.focus();
      const valueLength = authPasswordInput.value ? authPasswordInput.value.length : 0;
      if (typeof authPasswordInput.setSelectionRange === "function") {
        authPasswordInput.setSelectionRange(valueLength, valueLength);
      }
    });
  }

  authModeButtons.forEach((btn) => {
    btn.addEventListener("click", () => setAuthMode(btn.dataset.authMode));
  });

  if (authOpenButton) {
    authOpenButton.addEventListener("click", () => openAuthOverlay("login"));
  }

  if (authCloseButton) {
    authCloseButton.addEventListener("click", closeAuthOverlay);
  }

  if (authOverlay) {
    authOverlay.addEventListener("click", (event) => {
      if (event.target === authOverlay) {
        closeAuthOverlay();
      }
    });
  }

  const openAuthAvatarPicker = () => {
    if (authAvatarInput) {
      authAvatarInput.click();
    }
  };

  if (authAvatarTrigger && authAvatarInput) {
    authAvatarTrigger.addEventListener("click", openAuthAvatarPicker);
  }

  if (authAvatarPreview && authAvatarInput) {
    authAvatarPreview.addEventListener("click", openAuthAvatarPicker);
    authAvatarPreview.addEventListener("keydown", (event) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        openAuthAvatarPicker();
      }
    });
  }

  if (authAvatarClear) {
    authAvatarClear.addEventListener("click", () => {
      clearAuthAvatarPreview();
      setAuthStatus("Avatar removed. You can keep going without one.");
    });
  }

  if (authAvatarInput) {
    authAvatarInput.addEventListener("change", () => {
      const file = authAvatarInput.files && authAvatarInput.files[0];
      if (!file) {
        clearAuthAvatarPreview();
        return;
      }

      if (!file.type.startsWith("image/")) {
        setAuthStatus("Please choose an image for your avatar.", "error");
        clearAuthAvatarPreview();
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        setAuthStatus("Images must be 5 MB or smaller.", "error");
        clearAuthAvatarPreview();
        return;
      }

      applyAuthAvatarPreview(file);
    });
  }

  if (authForm) {
    authForm.addEventListener("submit", handleAuthSubmit);
  }

  if (accountToggle) {
    accountToggle.addEventListener("click", () => toggleAccountMenu());
    accountToggle.addEventListener("keydown", (event) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        toggleAccountMenu();
      }
    });
  }

  if (accountLogoutButton) {
    accountLogoutButton.addEventListener("click", () => {
      logoutSession();
      toggleAccountMenu(false);
      updateAccountUi(null);
    });
  }

  if (accountProfileButton) {
    accountProfileButton.addEventListener("click", () => {
      setSection("profile");
      toggleAccountMenu(false);
    });
  }

  if (accountSettingsButton) {
    accountSettingsButton.addEventListener("click", () => {
      setSection("profile");
      setTab("profile", "settings");
      toggleAccountMenu(false);
    });
  }

  if (notificationButton) {
    notificationButton.addEventListener("click", () => toggleNotificationMenu());
  }

  if (notificationMarkRead) {
    notificationMarkRead.addEventListener("click", handleMarkAllNotificationsRead);
  }

  if (profileEditOpenButton) {
    profileEditOpenButton.addEventListener("click", () => {
      if (!hasActiveSession()) {
        promptForAuth("profile", "overview");
        return;
      }
      toggleProfileEditor(true);
    });
  }

  if (profileEditCloseButton) {
    profileEditCloseButton.addEventListener("click", closeProfileEditor);
  }

  if (profileEditCancelButton) {
    profileEditCancelButton.addEventListener("click", closeProfileEditor);
  }

  if (profileMessageButton) {
    profileMessageButton.addEventListener("click", () => {
      const targetHandle =
        (profileMessageButton.dataset && profileMessageButton.dataset.profileHandle) ||
        state.profileContextHandle ||
        "";
      startConversationWithHandle(targetHandle);
    });
  }

  if (profileEditForm) {
    profileEditForm.addEventListener("submit", handleProfileEditorSubmit);
  }

  if (profileGenreOptions) {
    profileGenreOptions.addEventListener("change", updateProfileEditorCounts);
  }

  if (profileDecadeOptions) {
    profileDecadeOptions.addEventListener("change", updateProfileEditorCounts);
  }

  if (onboardingOpenButtons && onboardingOpenButtons.length) {
    onboardingOpenButtons.forEach((button) => {
      button.addEventListener("click", () => {
        if (!hasActiveSession()) {
          promptForAuth("profile", "settings");
          return;
        }
        state.onboardingStep = ONBOARDING_STEPS[0];
        openOnboarding();
      });
    });
  }

  const goToAdjacentOnboardingStep = (offset) => {
    readOnboardingSelections();
    const currentIndex = Math.max(0, ONBOARDING_STEPS.indexOf(state.onboardingStep));
    const targetIndex = Math.min(
      Math.max(currentIndex + offset, 0),
      ONBOARDING_STEPS.length - 1
    );
    setOnboardingStep(ONBOARDING_STEPS[targetIndex]);
  };

  if (onboardingCloseButton) {
    onboardingCloseButton.addEventListener("click", () => closeOnboarding());
  }
  if (onboardingBackButton) {
    onboardingBackButton.addEventListener("click", () => goToAdjacentOnboardingStep(-1));
  }
  if (onboardingNextButton) {
    onboardingNextButton.addEventListener("click", () => goToAdjacentOnboardingStep(1));
  }
  if (onboardingFinishButton) {
    onboardingFinishButton.addEventListener("click", completeOnboardingFlow);
  }
  if (onboardingOverlay) {
    onboardingOverlay.addEventListener("click", (event) => {
      if (event.target === onboardingOverlay) {
        closeOnboarding();
      }
    });
  }
  if (onboardingGenreOptions) {
    onboardingGenreOptions.addEventListener("change", () => {
      readOnboardingSelections();
    });
  }
  if (onboardingDecadeOptions) {
    onboardingDecadeOptions.addEventListener("change", () => {
      readOnboardingSelections();
    });
  }
  if (onboardingProviderOptions) {
    onboardingProviderOptions.addEventListener("change", () => {
      readOnboardingSelections();
    });
  }
  if (onboardingImportOptions && onboardingImportOptions.length) {
    onboardingImportOptions.forEach((input) => {
      input.addEventListener("change", () => readOnboardingSelections());
    });
  }

  if (conversationForm) {
    conversationForm.addEventListener("submit", handleConversationMessageSubmit);
  }

  if (watchPartyForm) {
    watchPartyForm.addEventListener("submit", handleWatchPartyMessageSubmit);
  }
  if (watchPartyJoinButton) {
    watchPartyJoinButton.addEventListener("click", handleJoinWatchParty);
  }

  attachDocumentHandlers();
}

function init() {
  setAuthMode(state.authMode);
  updateAccountUi(state.session);
  renderFavoritesList();
  renderWatchedList();
  subscribeToSocialOverview((overview) => {
    state.socialOverview = overview;
    renderProfileOverview();
    renderPeopleSection();
  });
  subscribeToCollaborativeState((collabState) => {
    state.collabState = collabState || getDefaultCollaborativeState();
    setActiveWatchParty(selectPrimaryWatchParty(state.collabState));
  });
  if (unsubscribeNotifications) {
    unsubscribeNotifications();
  }
  unsubscribeNotifications = subscribeToNotifications((payload) => {
    const notifications = Array.isArray(payload?.notifications) ? payload.notifications : [];
    state.notifications = notifications;
    state.unreadNotifications =
      typeof payload?.unreadCount === "number"
        ? payload.unreadCount
        : countUnreadNotificationsLocal(notifications);
    state.notificationsLoaded = true;
    renderNotificationBadge();
    renderNotificationList();
    setNotificationStatus("");
  });
  subscribeToSession((session) => {
    updateAccountUi(session);
    loadStreamingProviders();
    if (session && session.token) {
      state.favorites = Array.isArray(session.favoritesList) ? session.favoritesList : [];
      state.watchedHistory = normalizeWatchedHistory(session.watchedHistory);
      renderFavoritesList();
      renderWatchedList();
      closeAuthOverlay();
      refreshCollaborativeState();
      if (state.activeSection === "messages") {
        loadConversations(true);
      }
      state.notifications = [];
      state.unreadNotifications = 0;
      renderNotificationBadge();
      renderNotificationList();
      state.notificationsLoaded = false;
      setNotificationStatus("Loading notifications…");
    } else {
      state.favorites = [];
      state.watchedHistory = [];
      renderFavoritesList();
      renderWatchedList();
      state.collabState = getDefaultCollaborativeState();
      setActiveWatchParty(null);
      resetConversationsState();
      resetNotificationsUi();
    }
    maybeOpenOnboarding();
    refreshAppConfig();
  });
  initSocialFeatures();
  attachListeners();
  refreshAppConfig();
  loadStreamingProviders();
  setSection("home");
  loadTrendingMovies(state.trendingWindow);
  loadDiscover(state.discoverFilter);
  loadDiscoverPeople();
  loadHomeRecommendations();
}

init();
