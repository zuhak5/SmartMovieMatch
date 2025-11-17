import { fetchFromSearch, fetchFromTmdb, fetchTrendingMovies } from "./api.js";
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
  listUserListsRemote,
  getUserListItemsRemote,
  createUserListRemote,
  updateUserListRemote,
  deleteUserListRemote,
  addUserListItemRemote,
  removeUserListItemRemote,
  acknowledgeNotifications,
  subscribeToDiaryEntries,
  refreshDiaryEntries,
  saveDiaryEntry
} from "./social.js";
import { logRecommendationEvent, logSearchEvent } from "./analytics.js";

const defaultTabs = {
  friends: "feed",
  discover: "movies",
  home: "for-you",
  messages: "inbox",
  library: "watchlist",
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

const ONBOARDING_STORAGE_KEY = "smartMovieMatch.onboardingComplete";
const ONBOARDING_STEPS = ["taste", "providers", "import"];

const state = {
  activeTabs: { ...defaultTabs },
  activeSection: "home",
  discoverFilter: "popular",
  discoverAbort: null,
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
  discoverLists: [],
  session: loadSession(),
  socialOverview: null,
  accountMenuOpen: false,
  authMode: "login",
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
  collabState: {
    lists: { owned: [], shared: [], invites: [] },
    watchParties: { upcoming: [], invites: [] }
  },
  userLists: [],
  userListsLoading: false,
  userListsError: "",
  favorites: [],
  favoritesSaving: false,
  favoritesStatus: "",
  activeListId: "",
  activeListItems: [],
  activeListLoading: false,
  activeListError: "",
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
  diaryEntries: [],
  diaryLoading: false,
  diaryError: "",
  diarySelection: null,
  diarySearchResults: [],
  diarySearchAbort: null,
  diarySubmitting: false,
  appConfig: {
    config: {},
    experiments: { experiments: [], assignments: {} },
    loaded: false,
    error: ""
  }
};

let unsubscribeNotifications = null;

subscribeToConfig((configState) => {
  state.appConfig = configState;
  applyFeatureFlags();
});

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

  toggleSectionAvailability("messages", getFeatureFlag("feature.messages.enabled", true));
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
    message: "Sign in to view your watchlist and lists."
  },
  {
    section: "profile",
    message: "Sign in to view your profile and diary."
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
const discoverGrid = document.querySelector('[data-grid="discover-movies"]');
const discoverPeopleList = document.querySelector('[data-list="discover-people"]');
const discoverListCards = document.querySelector('[data-list="discover-lists"]');
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
const diaryForm = document.querySelector('[data-diary-form]');
const diaryList = document.querySelector('[data-diary-list]');
const diaryEmpty = document.querySelector('[data-diary-empty]');
const diaryStatus = document.querySelector('[data-diary-status]');
const diarySearchInput = document.querySelector('[data-diary-search]');
const diarySearchResults = document.querySelector('[data-diary-search-results]');
const diarySelected = document.querySelector('[data-diary-selected]');
const diaryDateInput = document.querySelector('[data-diary-date]');
const diaryRatingInput = document.querySelector('[data-diary-rating]');
const diaryTagsInput = document.querySelector('[data-diary-tags]');
const diaryRewatchInput = document.querySelector('[data-diary-rewatch]');
const diaryVisibilitySelect = document.querySelector('[data-diary-visibility]');
const diarySourceSelect = document.querySelector('[data-diary-source]');
const diaryDeviceSelect = document.querySelector('[data-diary-device]');
const diarySubmitButton = document.querySelector('[data-diary-submit]');
const libraryListsContainer = document.querySelector('[data-library-lists]');
const libraryListsEmpty = document.querySelector('[data-library-lists-empty]');
const listStatus = document.querySelector('[data-list-status]');
const listCreateToggle = document.querySelector('[data-list-create-toggle]');
const listRefreshButton = document.querySelector('[data-list-refresh]');
const listCreateForm = document.querySelector('[data-list-create-form]');
const listCreateCancel = document.querySelector('[data-list-cancel]');
const listNameInput = document.querySelector('[data-list-name]');
const listDescriptionInput = document.querySelector('[data-list-description]');
const listVisibilitySelect = document.querySelector('[data-list-visibility]');
const listCollaborativeInput = document.querySelector('[data-list-collaborative]');
const activeListPanel = document.querySelector('[data-active-list-panel]');
const activeListTitle = document.querySelector('[data-active-list-title]');
const activeListMeta = document.querySelector('[data-active-list-meta]');
const listItemContainer = document.querySelector('[data-list-item-container]');
const listItemStatus = document.querySelector('[data-list-item-status]');
const listEditButton = document.querySelector('[data-list-edit]');
const listDeleteButton = document.querySelector('[data-list-delete]');
const listEditForm = document.querySelector('[data-list-edit-form]');
const listEditCancel = document.querySelector('[data-list-edit-cancel]');
const listEditNameInput = document.querySelector('[data-list-edit-name]');
const listEditDescriptionInput = document.querySelector('[data-list-edit-description]');
const listEditVisibilitySelect = document.querySelector('[data-list-edit-visibility]');
const listEditCollaborativeInput = document.querySelector('[data-list-edit-collaborative]');
const favoritesPanel = document.querySelector('[data-favorites-panel]');
const favoritesList = document.querySelector('[data-favorites-list]');
const favoritesEmpty = document.querySelector('[data-favorites-empty]');
const favoritesStatus = document.querySelector('[data-favorites-status]');
const authOverlay = document.querySelector("[data-auth-overlay]");
const authForm = document.querySelector("[data-auth-form]");
const authStatus = document.querySelector("[data-auth-status]");
const authUsernameInput = document.querySelector("[data-auth-username]");
const authPasswordInput = document.querySelector("[data-auth-password]");
const authDisplayNameRow = document.querySelector("[data-auth-display-name-row]");
const authDisplayNameInput = document.querySelector("[data-auth-display-name]");
const authModeButtons = document.querySelectorAll("[data-auth-mode]");
const authTitle = document.querySelector("[data-auth-title]");
const authOpenButton = document.querySelector("[data-auth-open]");
const authCloseButton = document.querySelector("[data-auth-close]");
const authSubmitButton = document.querySelector("[data-auth-submit]");
const accountMenu = document.querySelector("[data-account-menu]");
const accountToggle = document.querySelector("[data-account-toggle]");
const accountName = document.querySelector("[data-account-name]");
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
  films: document.querySelector('[data-profile-stat="films"]'),
  diary: document.querySelector('[data-profile-stat="diary"]'),
  followers: document.querySelector('[data-profile-stat="followers"]'),
  following: document.querySelector('[data-profile-stat="following"]')
};
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

  if (section === "library" && tab === "lists" && hasActiveSession()) {
    loadUserLists();
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
  if (typeof window === "undefined" || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.warn("Unable to read onboarding state", error);
    return {};
  }
}

function isOnboardingLocallyComplete(username = "anonymous") {
  const map = readOnboardingLocalMap();
  return Boolean(map[username] || map.anonymous);
}

function markOnboardingCompleteLocally(username = "anonymous") {
  if (typeof window === "undefined" || !window.localStorage) return;
  const map = readOnboardingLocalMap();
  map[username] = true;
  try {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(map));
  } catch (error) {
    console.warn("Unable to persist onboarding completion", error);
  }
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
  if (authTitle) {
    authTitle.textContent =
      state.authMode === "signup"
        ? "Create your Smart Movie Match account"
        : "Sign in to Smart Movie Match";
  }
  if (authPasswordInput) {
    authPasswordInput.autocomplete =
      state.authMode === "signup" ? "new-password" : "current-password";
  }
}

function openAuthOverlay(mode = state.authMode) {
  setAuthMode(mode);
  setAuthStatus("");
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
  if (accountName) {
    accountName.textContent = hasSession
      ? state.session.displayName || state.session.username
      : "Guest";
  }
  if (accountHandle) {
    accountHandle.textContent = hasSession && state.session.username
      ? `@${state.session.username}`
      : "@guest";
  }
  if (accountAvatar) {
    accountAvatar.style.backgroundImage = "";
    if (hasSession && state.session.avatarUrl) {
      accountAvatar.style.backgroundImage = `url(${state.session.avatarUrl})`;
      accountAvatar.textContent = "";
    } else {
      accountAvatar.textContent = initialsFromName(
        hasSession
          ? state.session.displayName || state.session.username
          : "Guest"
      );
    }
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
  } else if (type.includes("review") || type.includes("diary")) {
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

function renderProfileOverview() {
  const hasSession = Boolean(state.session && state.session.token);
  const preferences = (state.session && state.session.preferencesSnapshot) || {};
  const profilePrefs = preferences.profile || {};
  const bio = sanitizeProfileText(profilePrefs.bio || "", 280);
  const location = sanitizeProfileText(profilePrefs.location || "", 120);
  const website = typeof profilePrefs.website === "string" ? profilePrefs.website : "";
  const diaryCount = Array.isArray(state.diaryEntries) ? state.diaryEntries.length : null;
  const filmsLogged =
    state.session &&
    state.session.preferencesSnapshot &&
    Number.isFinite(state.session.preferencesSnapshot.filmsLogged)
      ? state.session.preferencesSnapshot.filmsLogged
      : 0;
  const diaryLogged =
    diaryCount !== null
      ? diaryCount
      : state.session &&
          state.session.preferencesSnapshot &&
          Number.isFinite(state.session.preferencesSnapshot.diaryEntries)
        ? state.session.preferencesSnapshot.diaryEntries
        : 0;
  const profile = {
    name: hasSession
      ? state.session.displayName || state.session.username
      : "Guest",
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
      films: filmsLogged,
      diary: diaryLogged,
      followers:
        state.socialOverview && state.socialOverview.counts
          ? Number(state.socialOverview.counts.followers || 0)
          : 0,
      following:
        state.socialOverview && state.socialOverview.counts
          ? Number(state.socialOverview.counts.following || 0)
          : 0
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
    profileAvatar.style.backgroundImage = "";
    if (profile.avatarUrl) {
      profileAvatar.style.backgroundImage = `url(${profile.avatarUrl})`;
      profileAvatar.textContent = "";
    } else {
      profileAvatar.textContent = initialsFromName(profile.name);
    }
  }

  Object.entries(profileStats).forEach(([key, element]) => {
    if (!element) return;
    const value = profile.stats[key] || 0;
    element.textContent = value.toLocaleString();
  });
}

function setDiaryStatus(message, variant = "") {
  if (!diaryStatus) return;
  diaryStatus.textContent = message || "";
  if (variant) {
    diaryStatus.dataset.variant = variant;
  } else {
    delete diaryStatus.dataset.variant;
  }
}

function formatDiaryDate(value) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Just now";
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDiaryRating(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "–";
  }
  return `${Math.round(value * 10) / 10}/10`;
}

function buildDiaryMeta(entry) {
  const parts = [];
  if (entry.rewatchNumber && entry.rewatchNumber > 1) {
    parts.push(`Rewatch #${entry.rewatchNumber}`);
  }
  if (entry.source) {
    parts.push(entry.source);
  }
  if (entry.device) {
    parts.push(entry.device);
  }
  if (Array.isArray(entry.tags) && entry.tags.length) {
    parts.push(`#${entry.tags.slice(0, 3).join(" #")}`);
  }
  if (entry.visibility && entry.visibility !== "public") {
    parts.push(entry.visibility === "friends" ? "Friends" : "Private");
  }
  return parts.join(" • ");
}

function renderDiaryEntries() {
  if (!diaryList || !diaryEmpty) return;
  diaryList.innerHTML = "";
  if (state.diaryLoading) {
    setDiaryStatus("Loading diary…", "loading");
    diaryEmpty.hidden = true;
    return;
  }
  if (state.diaryError) {
    setDiaryStatus(state.diaryError, "error");
  } else {
    setDiaryStatus("", "");
  }
  const entries = Array.isArray(state.diaryEntries) ? state.diaryEntries : [];
  if (!entries.length) {
    diaryEmpty.hidden = false;
    diaryList.hidden = true;
    return;
  }
  diaryList.hidden = false;
  diaryEmpty.hidden = true;
  entries.forEach((entry) => {
    const card = document.createElement("div");
    card.className = "card diary-row";
    const poster = document.createElement("div");
    poster.className = "poster";
    if (entry.movie && entry.movie.posterUrl) {
      poster.style.backgroundImage = `url(${entry.movie.posterUrl})`;
    }
    const stack = document.createElement("div");
    stack.className = "stack";
    const labelRow = document.createElement("div");
    labelRow.className = "label-row";
    const date = document.createElement("span");
    date.className = "small-text";
    date.textContent = formatDiaryDate(entry.watchedOn || entry.createdAt);
    const rating = document.createElement("span");
    rating.className = "badge rating";
    rating.textContent = formatDiaryRating(entry.rating);
    labelRow.append(date, rating);
    const title = document.createElement("strong");
    title.textContent = (entry.movie && entry.movie.title) || "Untitled";
    const meta = document.createElement("p");
    meta.className = "small-text";
    meta.textContent = buildDiaryMeta(entry);
    const actions = document.createElement("div");
    actions.className = "label-row diary-actions";
    const rewatchButton = document.createElement("button");
    rewatchButton.type = "button";
    rewatchButton.className = "btn-ghost btn";
    const nextRewatchNumber =
      (Number.isFinite(entry.rewatchNumber) ? entry.rewatchNumber : 1) + 1;
    rewatchButton.textContent = `Log rewatch #${nextRewatchNumber}`;
    rewatchButton.addEventListener("click", () => handleDiaryRewatch(entry, rewatchButton));
    actions.append(rewatchButton);
    stack.append(labelRow, title, meta, actions);
    card.append(poster, stack);
    diaryList.append(card);
  });
}

async function handleDiaryRewatch(entry, button) {
  if (!entry || !entry.movie || !entry.movie.imdbId) {
    setDiaryStatus("Missing movie details for this diary entry.", "error");
    return;
  }
  if (!hasActiveSession()) {
    setDiaryStatus("Sign in to log a rewatch.", "error");
    openAuthOverlay("login");
    return;
  }
  const targetButton = button || null;
  if (targetButton) {
    targetButton.disabled = true;
  }
  const currentRewatchNumber = Number.isFinite(entry.rewatchNumber) ? entry.rewatchNumber : 1;
  const nextRewatchNumber = currentRewatchNumber + 1;
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    movie: {
      imdbId: entry.movie.imdbId,
      tmdbId: entry.movie.tmdbId || null,
      title: entry.movie.title || "",
      releaseYear: entry.movie.releaseYear || null
    },
    watchedOn: today,
    rating: typeof entry.rating === "number" ? entry.rating : null,
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    rewatchNumber: nextRewatchNumber,
    visibility: entry.visibility || "public",
    source: entry.source || null,
    device: entry.device || null
  };
  try {
    setDiaryStatus(`Logging rewatch #${nextRewatchNumber}…`, "loading");
    await saveDiaryEntry(payload);
    setDiaryStatus(`Logged rewatch #${nextRewatchNumber}.`, "success");
  } catch (error) {
    setDiaryStatus(
      error instanceof Error ? error.message : "Could not log your rewatch.",
      "error"
    );
  } finally {
    if (targetButton) {
      targetButton.disabled = false;
    }
  }
}

function renderDiarySearchResults() {
  if (!diarySearchResults) return;
  diarySearchResults.innerHTML = "";
  if (!state.diarySearchResults.length) {
    diarySearchResults.hidden = true;
    return;
  }
  diarySearchResults.hidden = false;
  state.diarySearchResults.forEach((movie) => {
    if (!movie || !movie.imdbId) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pill";
    const year = movie.releaseYear ? ` (${movie.releaseYear})` : "";
    button.textContent = `${movie.title}${year}`;
    button.addEventListener("click", () => selectDiaryMovie(movie));
    diarySearchResults.append(button);
  });
}

function selectDiaryMovie(movie) {
  if (!movie || !movie.imdbId) {
    state.diarySelection = null;
    if (diarySelected) {
      diarySelected.textContent = "Search to choose a movie to log.";
    }
    return;
  }
  state.diarySelection = {
    imdbId: movie.imdbId,
    tmdbId: movie.tmdbId || null,
    title: movie.title || "Untitled",
    releaseYear: movie.releaseYear || null
  };
  if (diarySelected) {
    const year = state.diarySelection.releaseYear ? ` (${state.diarySelection.releaseYear})` : "";
    diarySelected.textContent = `Selected: ${state.diarySelection.title}${year}`;
  }
  if (diarySearchInput) {
    diarySearchInput.value = state.diarySelection.title;
  }
}

async function handleDiarySearchInput(event) {
  const query = event.target && typeof event.target.value === "string" ? event.target.value.trim() : "";
  state.diarySelection = null;
  if (diarySelected) {
    diarySelected.textContent = "Search to choose a movie to log.";
  }
  if (state.diarySearchAbort) {
    state.diarySearchAbort.abort();
  }
  if (query.length < 2) {
    state.diarySearchResults = [];
    renderDiarySearchResults();
    return;
  }
  const controller = new AbortController();
  state.diarySearchAbort = controller;
  try {
    const response = await fetchFromSearch({ q: query, limit: 6 }, { signal: controller.signal });
    if (controller !== state.diarySearchAbort) {
      return;
    }
    state.diarySearchResults = Array.isArray(response.movies) ? response.movies : [];
    renderDiarySearchResults();
  } catch (error) {
    if (error && error.name === "AbortError") {
      return;
    }
    setDiaryStatus("Unable to search for that movie right now.", "error");
  }
}

function readDiaryFormValues() {
  const tagsRaw = diaryTagsInput && typeof diaryTagsInput.value === "string" ? diaryTagsInput.value : "";
  const parsedTags = tagsRaw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  const rewatchRaw = diaryRewatchInput ? diaryRewatchInput.value : "";
  const rewatchNumber = Number.isFinite(Number(rewatchRaw)) ? Number(rewatchRaw) : 1;
  return {
    watchedOn:
      diaryDateInput && diaryDateInput.value
        ? diaryDateInput.value
        : new Date().toISOString().slice(0, 10),
    rating:
      diaryRatingInput && diaryRatingInput.value !== ""
        ? Number(diaryRatingInput.value)
        : null,
    tags: parsedTags,
    rewatchNumber: Number.isFinite(rewatchNumber) && rewatchNumber > 0 ? rewatchNumber : 1,
    visibility: diaryVisibilitySelect ? diaryVisibilitySelect.value : "public",
    source: diarySourceSelect ? diarySourceSelect.value : null,
    device: diaryDeviceSelect ? diaryDeviceSelect.value : null
  };
}

async function handleDiarySubmit(event) {
  event.preventDefault();
  if (!hasActiveSession()) {
    setAuthStatus("Sign in to log diary entries.", "error");
    openAuthOverlay("login");
    return;
  }
  if (!state.diarySelection || !state.diarySelection.imdbId) {
    setDiaryStatus("Choose a movie from search before saving.", "error");
    return;
  }
  if (state.diarySubmitting) return;
  state.diarySubmitting = true;
  if (diarySubmitButton) {
    diarySubmitButton.disabled = true;
  }
  setDiaryStatus("Saving your diary entry…", "loading");
  try {
    const payload = { ...readDiaryFormValues(), movie: state.diarySelection };
    await saveDiaryEntry(payload);
    setDiaryStatus("Diary entry saved.", "success");
    if (diaryTagsInput) diaryTagsInput.value = "";
    if (diaryRatingInput) diaryRatingInput.value = "";
    if (diaryRewatchInput) diaryRewatchInput.value = "1";
    state.diarySelection = null;
    if (diarySelected) {
      diarySelected.textContent = "Search to choose a movie to log.";
    }
    state.diarySearchResults = [];
    renderDiarySearchResults();
  } catch (error) {
    setDiaryStatus(
      error instanceof Error ? error.message : "Could not save your diary entry.",
      "error"
    );
  } finally {
    state.diarySubmitting = false;
    if (diarySubmitButton) {
      diarySubmitButton.disabled = false;
    }
  }
}

function renderDiscoverMovies(movies = []) {
  if (!discoverGrid) return;
  discoverGrid.innerHTML = "";
  if (!movies.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Nothing matched—try a different filter.";
    discoverGrid.append(empty);
    return;
  }

  movies.forEach((movie) => {
    const normalized = normalizeDiscoverMovie(movie);
    if (!normalized) return;

    const card = document.createElement("article");
    card.className = "card";
    card.style.flexDirection = "column";
    card.style.alignItems = "flex-start";

    card.appendChild(createPoster(normalized.posterUrl));

    const stack = document.createElement("div");
    stack.className = "stack";
    const title = document.createElement("strong");
    title.textContent = normalized.title;
    const meta = document.createElement("div");
    meta.className = "small-text";
    const year = normalized.releaseYear ? String(normalized.releaseYear) : "";
    const genres = formatGenres(normalized.genres);
    meta.textContent = [year, genres].filter(Boolean).join(" · ");
    const rating = document.createElement("span");
    rating.className = "badge rating";
    rating.textContent = normalized.rating
      ? normalized.rating.toFixed(1)
      : normalized.watchCount
      ? `${normalized.watchCount} logs`
      : "N/A";

    const actions = document.createElement("div");
    actions.className = "action-row";
    actions.append(rating);

    if (hasActiveSession()) {
      const saveButton = document.createElement("button");
      saveButton.type = "button";
      saveButton.className = "btn-ghost btn";
      saveButton.textContent = "Save to list";
      saveButton.addEventListener("click", async () => {
        saveButton.disabled = true;
        saveButton.textContent = "Saving…";
        await handleAddMovieToList(normalized);
        saveButton.textContent = "Saved";
        window.setTimeout(() => {
          saveButton.textContent = "Save to list";
          saveButton.disabled = false;
        }, 900);
      });
      actions.append(saveButton);
    }

    stack.append(title, meta, actions);
    card.append(stack);
    discoverGrid.append(card);
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
  trendingStatus.textContent = `Trending ${label} from community activity.`;
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
    const card = document.createElement("div");
    card.className = "card match-card";
    card.appendChild(createPoster(movie.posterUrl));

    const stack = document.createElement("div");
    stack.className = "stack";
    const title = document.createElement("strong");
    title.textContent = movie.title;
    const meta = document.createElement("div");
    meta.className = "small-text";
    const year = movie.releaseYear ? String(movie.releaseYear) : "";
    meta.textContent = [year, formatGenres(movie.genres)].filter(Boolean).join(" · ");

    const badgeRow = document.createElement("div");
    badgeRow.className = "action-row";
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

    badgeRow.append(rankBadge, statBadge);
    const favoriteToggle = createFavoriteToggleButton(movie);
    const actions = document.createElement("div");
    actions.className = "action-row";
    actions.append(favoriteToggle);

    stack.append(title, meta, badgeRow, actions);
    card.append(stack);
    trendingRow.append(card);
  });

  renderTrendingStatus();
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
    (movie.release_date ? movie.release_date.slice(0, 4) : null);

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
    timeWindow
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
      avatar.textContent = initialsFromName(person.displayName || handle);

      const stack = document.createElement("div");
      stack.className = "stack";
      const name = document.createElement("strong");
      name.textContent = person.displayName || `@${handle}`;
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
    avatar.textContent = initials;

    const stack = document.createElement("div");
    stack.className = "stack";
    const name = document.createElement("strong");
    name.textContent = person.name || "Unknown";
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

function renderListCards(lists = []) {
  if (!discoverListCards) return;
  discoverListCards.innerHTML = "";
  if (!lists.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No lists yet—search to populate.";
    discoverListCards.append(empty);
    return;
  }

  lists.forEach((list) => {
    const card = document.createElement("article");
    card.className = "card";
    card.style.flexDirection = "column";
    card.style.alignItems = "flex-start";

    const collage = document.createElement("div");
    collage.className = "list-collage";
    list.posters.forEach((posterUrl) => {
      const mini = document.createElement("div");
      mini.className = "mini-poster";
      if (posterUrl) {
        mini.style.backgroundImage = `url(${posterUrl})`;
        mini.style.backgroundSize = "cover";
        mini.style.backgroundPosition = "center";
      }
      collage.append(mini);
    });

    const title = document.createElement("strong");
    title.textContent = list.title;
    const owner = document.createElement("div");
    owner.className = "small-text";
    owner.textContent = list.owner;
    const description = document.createElement("p");
    description.className = "small-text";
    description.textContent = list.description;
    const badge = document.createElement("span");
    badge.className = "badge trend";
    badge.textContent = list.badge;

    card.append(collage, title, owner, description, badge);
    discoverListCards.append(card);
  });
}

function setListStatus(message, tone = "") {
  if (!listStatus) return;
  listStatus.textContent = message || "";
  listStatus.className = "small-text muted";
  if (tone === "error") {
    listStatus.classList.add("error-text");
  } else if (tone === "success") {
    listStatus.classList.add("success-text");
  }
}

function setListItemStatus(message, tone = "") {
  if (!listItemStatus) return;
  listItemStatus.textContent = message || "";
  listItemStatus.className = "small-text muted";
  if (tone === "error") {
    listItemStatus.classList.add("error-text");
  } else if (tone === "success") {
    listItemStatus.classList.add("success-text");
  }
}

function renderUserLists() {
  if (!libraryListsContainer) return;
  libraryListsContainer.innerHTML = "";
  const lists = Array.isArray(state.userLists) ? state.userLists : [];
  const loading = state.userListsLoading;
  if (!hasActiveSession()) {
    setListStatus("Sign in to sync lists.", "error");
  }
  if (loading) {
    const loadingRow = document.createElement("div");
    loadingRow.className = "small-text muted";
    loadingRow.textContent = "Loading lists…";
    libraryListsContainer.append(loadingRow);
  }
  if (!lists.length) {
    if (libraryListsEmpty) libraryListsEmpty.hidden = false;
    if (activeListPanel) activeListPanel.hidden = true;
    return;
  }
  if (libraryListsEmpty) libraryListsEmpty.hidden = true;
  lists.forEach((list) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "card";
    button.style.flexDirection = "column";
    button.style.alignItems = "flex-start";
    if (list.id === state.activeListId) {
      button.classList.add("active");
    }

    const collage = document.createElement("div");
    collage.className = "list-collage";
    const posters = Array.isArray(list.posters) ? list.posters : [];
    if (!posters.length) {
      const placeholder = document.createElement("div");
      placeholder.className = "mini-poster";
      collage.append(placeholder);
    }
    posters.forEach((posterUrl) => {
      const mini = document.createElement("div");
      mini.className = "mini-poster";
      if (posterUrl) {
        mini.style.backgroundImage = `url(${posterUrl})`;
        mini.style.backgroundSize = "cover";
        mini.style.backgroundPosition = "center";
      }
      collage.append(mini);
    });

    const title = document.createElement("strong");
    title.textContent = list.name || "Untitled list";
    const meta = document.createElement("div");
    meta.className = "small-text";
    const visibility = list.isPublic ? "Public" : "Private";
    const collab = list.isCollaborative ? " · Collaborative" : "";
    const count = list.itemCount || 0;
    meta.textContent = `${count} ${count === 1 ? "movie" : "movies"} · ${visibility}${collab}`;

    button.append(title, meta, collage);
    button.addEventListener("click", () => {
      setActiveList(list.id);
    });
    libraryListsContainer.append(button);
  });
}

function renderActiveListPanel() {
  if (!activeListPanel) return;
  const active = state.userLists.find((entry) => entry.id === state.activeListId);
  if (!active || !hasActiveSession()) {
    activeListPanel.hidden = true;
    return;
  }
  activeListPanel.hidden = false;
  if (activeListTitle) {
    activeListTitle.textContent = active.name || "Untitled list";
  }
  if (activeListMeta) {
    const visibility = active.isPublic ? "Public" : "Private";
    const collab = active.isCollaborative ? " • Collaborative" : "";
    const count = active.itemCount || state.activeListItems.length || 0;
    activeListMeta.textContent = `${visibility}${collab} • ${count} ${count === 1 ? "movie" : "movies"}`;
  }
  renderListItems(state.activeListItems);
}

function renderListItems(items = []) {
  if (!listItemContainer) return;
  listItemContainer.innerHTML = "";
  if (state.activeListLoading) {
    const loadingRow = document.createElement("div");
    loadingRow.className = "small-text muted";
    loadingRow.textContent = "Loading list…";
    listItemContainer.append(loadingRow);
    return;
  }
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No movies in this list yet.";
    listItemContainer.append(empty);
    return;
  }

  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "card";
    card.style.alignItems = "flex-start";

    const poster = createPoster(item.movie?.posterUrl || "");
    const stack = document.createElement("div");
    stack.className = "stack";
    const title = document.createElement("strong");
    title.textContent = item.movie?.title || item.movie?.imdbId || "Movie";
    const meta = document.createElement("div");
    meta.className = "small-text";
    const year = item.movie?.releaseYear ? String(item.movie.releaseYear) : "";
    meta.textContent = [year, item.movie?.imdbId].filter(Boolean).join(" · ");

    const actions = document.createElement("div");
    actions.className = "inline-actions";
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn-ghost btn";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", async () => {
      await handleRemoveListItem(item.movie?.imdbId);
    });
    actions.append(removeBtn);

    stack.append(title, meta, actions);
    card.append(poster, stack);
    listItemContainer.append(card);
  });
}

async function loadUserLists(preferredId = state.activeListId) {
  if (!hasActiveSession()) {
    state.userLists = [];
    state.activeListId = "";
    state.activeListItems = [];
    renderUserLists();
    renderActiveListPanel();
    return;
  }
  state.userListsLoading = true;
  renderUserLists();
  try {
    const lists = await listUserListsRemote();
    state.userLists = lists;
    state.userListsError = "";
    const fallbackId = preferredId && lists.some((entry) => entry.id === preferredId)
      ? preferredId
      : lists.length
      ? lists[0].id
      : "";
    state.activeListId = fallbackId;
  } catch (error) {
    state.userListsError = error instanceof Error ? error.message : "Unable to load lists.";
    setListStatus(state.userListsError, "error");
  }
  state.userListsLoading = false;
  renderUserLists();
  if (state.activeListId) {
    await loadActiveListItems(state.activeListId);
  } else {
    renderActiveListPanel();
  }
}

async function loadActiveListItems(listId = state.activeListId) {
  if (!listId || !hasActiveSession()) {
    state.activeListItems = [];
    renderActiveListPanel();
    return;
  }
  state.activeListLoading = true;
  renderActiveListPanel();
  try {
    const { list, items } = await getUserListItemsRemote(listId);
    if (list) {
      state.activeListId = list.id;
      state.userLists = state.userLists.map((entry) =>
        entry.id === list.id ? { ...entry, itemCount: list.itemCount ?? items.length } : entry
      );
    }
    state.activeListItems = items;
    setListItemStatus(items.length ? "" : "Add movies from search to fill this list.");
  } catch (error) {
    setListItemStatus(error instanceof Error ? error.message : "Unable to load this list.", "error");
  }
  state.activeListLoading = false;
  renderUserLists();
  renderActiveListPanel();
}

function setActiveList(listId) {
  if (!listId) return;
  state.activeListId = listId;
  renderUserLists();
  loadActiveListItems(listId);
}

function resetListCreateForm() {
  if (listCreateForm) {
    listCreateForm.hidden = true;
  }
  if (listNameInput) listNameInput.value = "";
  if (listDescriptionInput) listDescriptionInput.value = "";
  if (listVisibilitySelect) listVisibilitySelect.value = "public";
  if (listCollaborativeInput) listCollaborativeInput.checked = false;
}

async function handleListCreateSubmit(event) {
  event.preventDefault();
  if (!hasActiveSession()) {
    setListStatus("Sign in to create a list.", "error");
    openAuthOverlay("login");
    return;
  }
  const name = listNameInput ? listNameInput.value.trim() : "";
  const description = listDescriptionInput ? listDescriptionInput.value.trim() : "";
  const visibility = listVisibilitySelect ? listVisibilitySelect.value : "public";
  const isCollaborative = listCollaborativeInput ? listCollaborativeInput.checked : false;
  if (!name) {
    setListStatus("Give your list a name first.", "error");
    return;
  }
  setListStatus("Saving list…", "");
  try {
    const created = await createUserListRemote({ name, description, visibility, isCollaborative });
    setListStatus("List saved.", "success");
    resetListCreateForm();
    await loadUserLists(created?.id || state.activeListId);
  } catch (error) {
    setListStatus(error instanceof Error ? error.message : "Could not save list.", "error");
  }
}

function openListEditForm() {
  const active = state.userLists.find((entry) => entry.id === state.activeListId);
  if (!active || !listEditForm) return;
  listEditForm.hidden = false;
  if (listEditNameInput) listEditNameInput.value = active.name || "";
  if (listEditDescriptionInput) listEditDescriptionInput.value = active.description || "";
  if (listEditVisibilitySelect) listEditVisibilitySelect.value = active.isPublic ? "public" : "private";
  if (listEditCollaborativeInput) listEditCollaborativeInput.checked = Boolean(active.isCollaborative);
}

async function handleListEditSubmit(event) {
  event.preventDefault();
  if (!state.activeListId) return;
  setListStatus("Updating list…", "");
  try {
    const updated = await updateUserListRemote({
      listId: state.activeListId,
      name: listEditNameInput ? listEditNameInput.value.trim() : undefined,
      description: listEditDescriptionInput ? listEditDescriptionInput.value.trim() : undefined,
      visibility: listEditVisibilitySelect ? listEditVisibilitySelect.value : undefined,
      isCollaborative: listEditCollaborativeInput ? listEditCollaborativeInput.checked : undefined
    });
    if (updated) {
      state.userLists = state.userLists.map((entry) => (entry.id === updated.id ? { ...entry, ...updated } : entry));
      setListStatus("List updated.", "success");
      if (listEditForm) listEditForm.hidden = true;
      renderUserLists();
      renderActiveListPanel();
    }
  } catch (error) {
    setListStatus(error instanceof Error ? error.message : "Could not update list.", "error");
  }
}

async function handleListDelete() {
  if (!state.activeListId) return;
  const confirmDelete = typeof window !== "undefined" ? window.confirm("Delete this list?") : true;
  if (!confirmDelete) return;
  setListStatus("Deleting list…", "");
  try {
    await deleteUserListRemote(state.activeListId);
    state.activeListId = "";
    state.activeListItems = [];
    await loadUserLists();
    setListStatus("List deleted.", "success");
  } catch (error) {
    setListStatus(error instanceof Error ? error.message : "Could not delete list.", "error");
  }
}

function getPreferredListId() {
  if (state.activeListId) return state.activeListId;
  const first = Array.isArray(state.userLists) && state.userLists.length ? state.userLists[0].id : "";
  return first || "";
}

async function handleAddMovieToList(movie) {
  if (!hasActiveSession()) {
    setListStatus("Sign in to save movies to lists.", "error");
    openAuthOverlay("login");
    return;
  }
  if (!movie || !movie.tmdbId || !movie.title) {
    setListItemStatus("Unable to save this movie right now.", "error");
    return;
  }
  const targetListId = getPreferredListId();
  if (!targetListId) {
    setListStatus("Create a list first.", "error");
    setSection("library");
    setTab("library", "lists");
    return;
  }
  setListItemStatus("Saving to list…");
  try {
    const items = await addUserListItemRemote({ listId: targetListId, movie });
    state.activeListId = targetListId;
    if (targetListId === state.activeListId) {
      state.activeListItems = items;
    }
    await loadUserLists(targetListId);
    setListItemStatus("Saved to list.", "success");
  } catch (error) {
    setListItemStatus(error instanceof Error ? error.message : "Could not save to list.", "error");
  }
}

async function handleRemoveListItem(imdbId) {
  if (!imdbId || !state.activeListId) return;
  setListItemStatus("Removing…");
  try {
    const items = await removeUserListItemRemote({ listId: state.activeListId, imdbId });
    state.activeListItems = items;
    await loadUserLists(state.activeListId);
    setListItemStatus(items.length ? "" : "Add more movies from search to fill this list.");
  } catch (error) {
    setListItemStatus(error instanceof Error ? error.message : "Could not remove movie.", "error");
  }
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
    genres: Array.isArray(normalized.genres) ? normalized.genres : []
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
    const row = document.createElement("div");
    row.className = "inline-actions";
    const meta = document.createElement("div");
    meta.className = "stack";
    const title = document.createElement("strong");
    title.textContent = favorite.title;
    const details = document.createElement("div");
    details.className = "small-text muted";
    const pieces = [];
    if (favorite.releaseYear) pieces.push(favorite.releaseYear);
    if (Array.isArray(favorite.genres) && favorite.genres.length) {
      pieces.push(formatGenres(favorite.genres));
    }
    details.textContent = pieces.join(" • ");
    meta.append(title, details);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn-ghost btn";
    remove.textContent = "Remove";
    remove.addEventListener("click", (event) => {
      event.preventDefault();
      const key = getFavoriteKey(favorite);
      state.favorites = state.favorites.filter((entry) => getFavoriteKey(entry) !== key);
      renderFavoritesList();
      syncFavoritesRemote();
      setFavoritesStatus(`Removed “${favorite.title}” from favorites.`);
    });

    row.append(meta, remove);
    favoritesList.append(row);
  });
}

function getDefaultCollaborativeState() {
  return { lists: { owned: [], shared: [], invites: [] }, watchParties: { upcoming: [], invites: [] } };
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
    watchPartyMeta.textContent = host;
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
    avatar.textContent = initialsFromName(participant.username || "?");
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

    const avatar = document.createElement("div");
    avatar.className = "avatar conversation-avatar";
    avatar.textContent = initialsFromName(getConversationTitle(conversation));

    const stack = document.createElement("div");
    stack.className = "stack";

    const title = document.createElement("div");
    title.className = "conversation-title";
    title.textContent = getConversationTitle(conversation);

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

async function loadTrendingPeople(query = "") {
  state.peopleSearchActive = Boolean(query && query.length >= 3);
  const searchPath = query && query.length >= 3 ? "search/person" : "trending/person/week";
  const params = query && query.length >= 3 ? { query, include_adult: "false" } : { page: 1 };
  try {
    const data = await fetchFromTmdb(searchPath, params);
    const limit = getUiLimit("ui.discover.maxPeople", 6);
    state.discoverPeople = Array.isArray(data?.results) ? data.results.slice(0, limit) : [];
    renderPeopleSection();
  } catch (error) {
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
  renderTrendingMovies(state.trendingMovies);

  const controller = new AbortController();
  state.trendingAbort = controller;

  try {
    const data = await fetchTrendingMovies(
      {
        time_window: state.trendingWindow,
        limit: getUiLimit("ui.discover.trendingCount", 8)
      },
      { signal: controller.signal }
    );

    state.trendingMovies = Array.isArray(data?.movies) ? data.movies : [];
    renderTrendingMovies(state.trendingMovies);
  } catch (error) {
    if (error.name === "AbortError") return;
    console.warn("trending fetch failed", error);
    state.trendingMovies = [];
    state.trendingError = "Unable to load trending movies.";
    renderTrendingMovies([]);
  } finally {
    state.trendingAbort = null;
    state.trendingLoading = false;
    renderTrendingStatus();
  }
}

function buildListsFromMovies(movies = []) {
  const cleanMovies = (movies || []).filter(Boolean);
  if (!cleanMovies.length) return [];
  const listLimit = getUiLimit("ui.home.maxRecommendations", 10);
  const top = cleanMovies.slice(0, Math.max(4, listLimit));
  const splitPoint = Math.ceil(top.length / 2);
  const split = [top.slice(0, splitPoint), top.slice(splitPoint)];
  return split
    .filter((bucket) => bucket.length)
    .map((bucket, index) => ({
      title: index === 0 ? "Fresh discoveries" : "From your vibe",
      owner: index === 0 ? "by SmartMovieMatch" : "from your session",
      description:
        index === 0
          ? "A quick reel of what’s trending this week."
          : "Built from your selected moods and recent views.",
      badge: index === 0 ? "Trending" : "Personalized",
      posters: bucket.map((movie) => normalizeDiscoverMovie(movie)?.posterUrl || "")
    }));
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
    state.homeRecommendations = enriched;
    renderHomeRecommendations(enriched);
    renderGroupPicks(enriched.slice(0, getUiLimit("ui.home.groupPicks", 3)));
    renderListCards(
      buildListsFromMovies(enriched.map((item) => item.tmdb || item.candidate))
    );
    logRecommendationEvent({
      action: "home_recommendations_generated",
      metadata: { count: enriched.length, seed: state.recommendationSeed }
    });
  } catch (error) {
    if (error.name === "AbortError") return;
    console.warn("recommendations failed", error);
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
    const card = document.createElement("article");
    card.className = "card media-card";

    const posterUrl = item.tmdb?.poster_path
      ? `https://image.tmdb.org/t/p/w342${item.tmdb.poster_path}`
      : item.omdb?.Poster && item.omdb.Poster !== "N/A"
      ? item.omdb.Poster
      : "";

    const posterFrame = document.createElement("div");
    posterFrame.className = "poster-frame";
    posterFrame.appendChild(createPoster(posterUrl));
    const badge = document.createElement("span");
    badge.className = "badge rating poster-badge";
    const tmdbScore = item.tmdb?.vote_average;
    badge.textContent = tmdbScore ? tmdbScore.toFixed(1) : "New";
    posterFrame.appendChild(badge);

    const stack = document.createElement("div");
    stack.className = "stack tight";
    const title = document.createElement("strong");
    title.textContent = item.omdb?.Title || item.tmdb?.title || "Untitled";
    const meta = document.createElement("div");
    meta.className = "small-text";
    const year = item.omdb?.Year || (item.tmdb?.release_date || "").slice(0, 4);
    const genres = formatGenres(item.tmdb?.genre_ids || []);
    meta.textContent = [genres, year].filter(Boolean).join(" · ");

    stack.append(title, meta);
    card.append(posterFrame, stack);
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
    const card = document.createElement("div");
    card.className = "card match-card";
    const posterUrl = item.tmdb?.poster_path
      ? `https://image.tmdb.org/t/p/w185${item.tmdb.poster_path}`
      : item.omdb?.Poster && item.omdb.Poster !== "N/A"
      ? item.omdb.Poster
      : "";
    card.appendChild(createPoster(posterUrl));

    const stack = document.createElement("div");
    stack.className = "stack";
    const title = document.createElement("strong");
    title.textContent = item.omdb?.Title || item.tmdb?.title || "Untitled";
    const meta = document.createElement("div");
    meta.className = "small-text";
    const genres = formatGenres(item.tmdb?.genre_ids || []);
    const year = item.omdb?.Year || (item.tmdb?.release_date || "").slice(0, 4);
    meta.textContent = [genres, year].filter(Boolean).join(" · ");
    const badge = document.createElement("span");
    badge.className = "badge match";
    badge.textContent = `${82 + index * 4}% match`;
    stack.append(title, meta, badge);
    card.append(stack);
    groupPicksList.append(card);
  });
}

function handleDiscoverSearchInput(value) {
  const query = value.trim();
  state.peopleSearchActive = query.length >= 3;
  loadDiscoverResults({ query });
  if (state.peopleSearchActive) {
    loadTrendingPeople(query);
  } else {
    loadTrendingPeople();
  }
}

async function loadDiscoverResults({ query = "" } = {}) {
  const trimmedQuery = query.trim();
  if (state.discoverAbort) {
    state.discoverAbort.abort();
  }
  const controller = new AbortController();
  state.discoverAbort = controller;

  const params = {
    filter: state.discoverFilter,
    limit: getUiLimit("ui.discover.maxMovies", 12)
  };

  if (trimmedQuery.length >= 2) {
    params.q = trimmedQuery;
  }

  try {
    const data = await fetchFromSearch(params, {
      signal: controller.signal,
      token: state.session?.token
    });
    const movieResults = Array.isArray(data?.movies) ? data.movies : [];
    renderDiscoverMovies(movieResults);
    const listSource = movieResults.length
      ? movieResults
      : state.homeRecommendations.map((item) => item.tmdb || item.candidate);
    renderListCards(buildListsFromMovies(listSource));
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

  if (!username || !password) {
    setAuthStatus("Enter your username and password.", "error");
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
    const session =
      state.authMode === "signup"
        ? await registerUser({ username, password, name: displayName })
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
  if (onboardingProviderOptions && !onboardingProviderOptions.dataset.built) {
    buildChipOptions(onboardingProviderOptions, STREAMING_PROVIDER_OPTIONS);
    onboardingProviderOptions.dataset.built = "true";
  }
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
    const target = event.target;
    if (!accountMenu.contains(target) && !accountToggle.contains(target)) {
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
    const target = event.target;
    if (!notificationMenu.contains(target) && !notificationButton.contains(target)) {
      closeNotificationMenu();
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
  }
}

function attachListeners() {
  navButtons.forEach((btn) => {
    btn.addEventListener("click", () => setSection(btn.dataset.sectionButton));
  });

  tabGroups.forEach((group) => {
    group.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const section = group.dataset.sectionTabs;
        setTab(section, btn.dataset.tab);
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
      handle = window.setTimeout(() => handleDiscoverSearchInput(value), 240);
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
      setTab("profile", "overview");
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

  if (diarySearchInput) {
    diarySearchInput.addEventListener("input", handleDiarySearchInput);
  }

  if (diaryForm) {
    diaryForm.addEventListener("submit", handleDiarySubmit);
  }

  if (profileGenreOptions) {
    profileGenreOptions.addEventListener("change", updateProfileEditorCounts);
  }

  if (profileDecadeOptions) {
    profileDecadeOptions.addEventListener("change", updateProfileEditorCounts);
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

  if (listCreateForm) {
    listCreateForm.addEventListener("submit", handleListCreateSubmit);
  }
  if (listCreateToggle) {
    listCreateToggle.addEventListener("click", () => {
      if (listCreateForm) {
        listCreateForm.hidden = !listCreateForm.hidden;
      }
    });
  }
  if (listCreateCancel) {
    listCreateCancel.addEventListener("click", resetListCreateForm);
  }
  if (listRefreshButton) {
    listRefreshButton.addEventListener("click", () => loadUserLists());
  }
  if (listEditButton) {
    listEditButton.addEventListener("click", openListEditForm);
  }
  if (listEditForm) {
    listEditForm.addEventListener("submit", handleListEditSubmit);
  }
  if (listEditCancel) {
    listEditCancel.addEventListener("click", () => {
      if (listEditForm) listEditForm.hidden = true;
    });
  }
  if (listDeleteButton) {
    listDeleteButton.addEventListener("click", handleListDelete);
  }

  document.addEventListener("click", handleOutsideClick);
  document.addEventListener("keydown", handleEscape);
}

function init() {
  setAuthMode(state.authMode);
  updateAccountUi(state.session);
  renderFavoritesList();
  subscribeToSocialOverview((overview) => {
    state.socialOverview = overview;
    renderProfileOverview();
    renderPeopleSection();
  });
  subscribeToDiaryEntries((payload) => {
    state.diaryEntries = Array.isArray(payload?.entries) ? payload.entries : [];
    state.diaryLoading = Boolean(payload?.loading);
    state.diaryError = payload?.error || "";
    renderDiaryEntries();
    renderProfileOverview();
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
    if (session && session.token) {
      state.favorites = Array.isArray(session.favoritesList) ? session.favoritesList : [];
      renderFavoritesList();
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
      loadUserLists();
    } else {
      state.favorites = [];
      renderFavoritesList();
      state.collabState = getDefaultCollaborativeState();
      setActiveWatchParty(null);
      resetConversationsState();
      resetNotificationsUi();
      state.userLists = [];
      state.activeListId = "";
      state.activeListItems = [];
      renderUserLists();
      renderActiveListPanel();
    }
    maybeOpenOnboarding();
    refreshAppConfig();
  });
  initSocialFeatures();
  if (diaryDateInput && !diaryDateInput.value) {
    diaryDateInput.value = new Date().toISOString().slice(0, 10);
  }
  attachListeners();
  refreshAppConfig();
  setSection("home");
  loadTrendingMovies(state.trendingWindow);
  loadDiscover(state.discoverFilter);
  loadTrendingPeople();
  loadHomeRecommendations();
  refreshDiaryEntries();
  loadUserLists();
}

init();
