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
  subscribeToCollaborativeState,
  getCollaborativeStateSnapshot
} from "./social.js";
import {
  renderWatchedList,
  updateWatchedSummary,
  renderRecommendations,
  renderFavoritesList,
  updateFavoritesSummary,
  showSkeletons,
  setRecStatus,
  setRecError
} from "./ui.js";
import { $ } from "./dom.js";
import { playUiClick, playExpandSound } from "./sound.js";

const RECOMMENDATIONS_PAGE_SIZE = 20;

const state = {
  watchedMovies: [],
  favorites: [],
  followingUsers: [],
  socialOverview: getSocialOverviewSnapshot(),
  collaborativeState: getCollaborativeStateSnapshot(),
  lastRecSeed: Math.random(),
  activeCollectionView: "favorites",
  session: null,
  accountMenuOpen: false,
  notificationPanelOpen: false,
  notifications: [],
  accountAvatarPreviewUrl: null,
  accountRemoveAvatar: false,
  socialSearchReset: null,
  watchedSyncTimer: null,
  favoritesSyncTimer: null,
  activeRecToken: null,
  activeRecAbort: null,
  recommendations: [],
  visibleRecommendations: 0,
  recommendationContext: null,
  sessionHydration: {
    token: null,
    lastPreferencesSync: null,
    lastWatchedSync: null,
    lastFavoritesSync: null
  }
};

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
  state.watchedMovies = [];
  state.favorites = [];
  state.session = loadSession();
  setupSocialFeatures();
  hydrateFromSession(state.session);
  refreshWatchedUi();
  refreshFavoritesUi();
  switchCollectionView(state.activeCollectionView);
  updateAccountUi(state.session);
  updateSnapshotPreviews(state.session);
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
    state.session = session;
    hydrateFromSession(session);
    updateAccountUi(session);
    updateSnapshotPreviews(session);
    updateSocialSectionVisibility(session);
    updateSocialInviteLink(session);
    if (!session || !session.token) {
      if (typeof state.socialSearchReset === "function") {
        state.socialSearchReset({ hidePanel: true });
      }
    } else if (typeof state.socialSearchReset === "function") {
      state.socialSearchReset({ showPrompt: true });
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
    if (isAccountSettingsContext()) {
      populateAccountSettings();
      if (window.location.hash === "#snapshots" && session && session.token) {
        window.requestAnimationFrame(() => {
          openAccountSettings("snapshots");
        });
      }
    }
  });

  wireEvents();
  renderNotificationCenter();

  if (window.location.hash === "#profileOverview" || window.location.hash === "#overview") {
    window.requestAnimationFrame(() => {
      highlightProfileOverview();
    });
  }

  if (isAccountSettingsContext() && window.location.hash === "#snapshots" && state.session && state.session.token) {
    window.requestAnimationFrame(() => {
      openAccountSettings("snapshots");
    });
  }
}

function wireEvents() {
  const accountProfileBtn = $("accountProfileBtn");
  const accountMenu = $("accountMenu");
  const accountProfile = $("accountProfile");
  const viewSnapshotsBtn = $("viewSnapshotsBtn");
  const profileForm = $("accountProfileForm");
  const securityForm = $("accountSecurityForm");
  const avatarInput = $("accountAvatarInput");
  const avatarUploadBtn = $("accountAvatarUpload");
  const avatarRemoveBtn = $("accountAvatarRemove");
  const notificationBell = $("notificationBell");
  const notificationPanel = $("notificationPanel");
  const notificationMarkRead = $("notificationMarkRead");

  if (accountProfileBtn && accountMenu) {
    accountProfileBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      playUiClick();
      toggleAccountMenu();
    });
  }

  if (notificationBell) {
    notificationBell.addEventListener("click", (event) => {
      event.stopPropagation();
      playUiClick();
      toggleNotificationPanel();
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
      if (state.accountMenuOpen) {
        closeAccountMenu();
      }
      if (state.notificationPanelOpen) {
        closeNotificationPanel();
      }
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (state.accountMenuOpen) {
        closeAccountMenu(true);
      }
    }
  });

  if (viewSnapshotsBtn) {
    viewSnapshotsBtn.addEventListener("click", () => {
      playUiClick();
      openAccountSettings("snapshots");
    });
  }

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

  document
    .querySelectorAll('input[name="genre"]')
    .forEach((checkbox) =>
      checkbox.addEventListener("change", () => {
        updatePreview();
      })
    );

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
      highlightProfileOverview();
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

function highlightProfileOverview() {
  const section = $("profileOverview");
  if (section && !section.hidden) {
    section.scrollIntoView({ behavior: "smooth", block: "start" });
    section.classList.add("account-insights--pulse");
    window.setTimeout(() => {
      section.classList.remove("account-insights--pulse");
    }, 1200);
    return;
  }

  const signedOutCard = $("profileOverviewSignedOut");
  if (signedOutCard && !signedOutCard.hidden) {
    signedOutCard.scrollIntoView({ behavior: "smooth", block: "start" });
    signedOutCard.classList.add("account-insights--pulse");
    window.setTimeout(() => {
      signedOutCard.classList.remove("account-insights--pulse");
    }, 1200);
    return;
  }

  const page = document.body ? document.body.getAttribute("data-page") : null;
  if (page !== "profile-overview") {
    window.location.href = "profile.html#profileOverview";
  }
}

function isAccountSettingsContext() {
  const page = document.body ? document.body.getAttribute("data-page") : null;
  return page === "account-settings";
}

function isAccountSettingsOpen() {
  return isAccountSettingsContext();
}

function openAccountSettings(section = "profile") {
  if (!state.session || !state.session.token) {
    window.location.href = "login.html";
    return;
  }

  const page = document.body ? document.body.getAttribute("data-page") : null;

  if (page === "account-settings") {
    populateAccountSettings();
    window.setTimeout(() => {
      if (section === "snapshots") {
        const anchor = document.getElementById("snapshots");
        if (anchor) {
          anchor.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      } else {
        const displayNameInput = $("accountDisplayName");
        if (displayNameInput) {
          displayNameInput.focus();
        }
      }
      if (section === "snapshots" || section === "profile") {
        const targetHash = `#${section}`;
        if (window.location.hash !== targetHash) {
          window.history.replaceState(null, "", targetHash);
        }
      }
    }, 60);
    return;
  }

  let target = "account-settings.html";
  if (section === "snapshots") {
    target += "#snapshots";
  } else if (section === "profile") {
    target += "#profile";
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

  if (!currentInput || !newInput || !confirmInput || !statusEl) {
    return;
  }

  const currentPassword = currentInput.value;
  const newPassword = newInput.value;
  const confirmPassword = confirmInput.value;

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
  renderWatchedList(state.watchedMovies, { onRemove: handleRemoveWatched });
  updateWatchedSummary(state.watchedMovies);
  updateCollectionVisibility();
  updatePreferencesPreview();
  refreshProfileOverviewCallout();
  if (state.recommendations.length && !state.activeRecAbort) {
    updateRecommendationsView();
  }
}

function refreshFavoritesUi() {
  renderFavoritesList(state.favorites, { onRemove: handleRemoveFavorite });
  updateFavoritesSummary(state.favorites);
  updateCollectionVisibility();
  updatePreferencesPreview();
  refreshProfileOverviewCallout();
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
    }
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
      "Thinking through your taste and calling TMDB / OMDb / YouTube...",
      true
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
      state.visibleRecommendations = 0;
      updateRecommendationsView();
      return;
    }

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
      state.visibleRecommendations = 0;
      updateRecommendationsView();
      return;
    }

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
      state.visibleRecommendations = 0;
      updateRecommendationsView();
      return;
    }

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
      state.visibleRecommendations = 0;
      updateRecommendationsView();
      finalizeRequest();
      return;
    }

    state.recommendations = filteredRecommendations;
    state.visibleRecommendations = Math.min(
      RECOMMENDATIONS_PAGE_SIZE,
      filteredRecommendations.length
    );

    setRecStatus(
      "Here’s a curated batch based on your input. Mark anything you’ve already seen – I’ll keep learning.",
      false
    );
    updateRecommendationsView();
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
    state.visibleRecommendations = 0;
    updateRecommendationsView();
  } finally {
    finalizeRequest();
  }
}

function resetRecommendationsState() {
  state.recommendations = [];
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
  const total = state.recommendations.length;
  const fallbackVisible = total ? Math.min(total, RECOMMENDATIONS_PAGE_SIZE) : 0;
  const visible = total
    ? Math.min(total, state.visibleRecommendations || fallbackVisible)
    : 0;
  const items = total ? state.recommendations.slice(0, visible) : [];
  renderRecommendations(items, state.watchedMovies, {
    favorites: state.favorites,
    onMarkWatched: handleMarkWatched,
    onToggleFavorite: handleToggleFavorite,
    community: {
      buildSection: buildCommunitySection
    }
  });
  updateShowMoreButton();
  updateRecommendationsMeta();
}

function updateShowMoreButton() {
  const container = $("recommendationsActions");
  const button = $("showMoreRecsBtn");
  if (!container || !button) {
    return;
  }

  const total = state.recommendations.length;
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
  const visible = total ? Math.min(total, state.visibleRecommendations || total) : 0;

  if (!total) {
    metaEl.textContent = `${context.baseMeta} No matches yet – try adjusting your vibe.`;
    return;
  }

  if (visible >= total) {
    metaEl.textContent = `${context.baseMeta} Showing all ${total} movies.`;
  } else {
    metaEl.textContent = `${context.baseMeta} Showing ${visible} of ${total} movies.`;
  }
}

function revealMoreRecommendations() {
  if (!state.recommendations.length) {
    return;
  }
  const total = state.recommendations.length;
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
    rating
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
    poster
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

  updateSyncInsights(session);
}

function setSyncStatus(message, variant = "muted") {
  const el = $("syncStatus");
  if (!el) {
    return;
  }
  el.textContent = message;
  el.dataset.variant = variant;
}

function updateSyncInsights(session) {
  const overviewSection = $("profileOverview");
  const overviewSignedOut = $("profileOverviewSignedOut");
  const preferencesValue = $("profileOverviewPreferencesValue");
  const watchedValue = $("profileOverviewWatchedValue");
  const favoritesValue = $("profileOverviewFavoritesValue");
  const viewSnapshotsBtn = $("viewSnapshotsBtn");

  const hasSession = Boolean(session && session.token);

  const prefCount = session && session.preferencesSnapshot && Array.isArray(session.preferencesSnapshot.selectedGenres)
    ? session.preferencesSnapshot.selectedGenres.length
    : 0;
  const watchedCount = session && Array.isArray(session.watchedHistory) ? session.watchedHistory.length : 0;
  const favoritesCount = session && Array.isArray(session.favoritesList) ? session.favoritesList.length : 0;

  const prefSuffix = prefCount ? ` • ${prefCount} genre${prefCount === 1 ? "" : "s"}` : "";
  const watchedSuffix = watchedCount ? ` • ${watchedCount} title${watchedCount === 1 ? "" : "s"}` : "";
  const favoritesSuffix = favoritesCount ? ` • ${favoritesCount} favorite${favoritesCount === 1 ? "" : "s"}` : "";

  const prefText = hasSession ? `${formatSyncTime(session.lastPreferencesSync)}${prefSuffix}` : "Sign in to sync";
  const watchedText = hasSession ? `${formatSyncTime(session.lastWatchedSync)}${watchedSuffix}` : "Sign in to sync";
  const favoritesText = hasSession ? `${formatSyncTime(session.lastFavoritesSync)}${favoritesSuffix}` : "Sign in to sync";

  if (preferencesValue) {
    preferencesValue.textContent = prefText;
  }
  if (watchedValue) {
    watchedValue.textContent = watchedText;
  }
  if (favoritesValue) {
    favoritesValue.textContent = favoritesText;
  }

  if (overviewSection) {
    const shouldHideOverview = !hasSession;
    overviewSection.hidden = shouldHideOverview;
    overviewSection.setAttribute("aria-hidden", shouldHideOverview ? "true" : "false");
    overviewSection.style.display = shouldHideOverview ? "none" : "";
  }
  if (overviewSignedOut) {
    const shouldHideSignedOut = hasSession;
    overviewSignedOut.hidden = shouldHideSignedOut;
    overviewSignedOut.setAttribute("aria-hidden", shouldHideSignedOut ? "true" : "false");
    overviewSignedOut.style.display = shouldHideSignedOut ? "none" : "";
  }
  if (overviewSignedOut) {
    overviewSignedOut.hidden = hasSession;
  }
  if (viewSnapshotsBtn) {
    viewSnapshotsBtn.disabled = !hasSession;
  }

  refreshProfileOverviewCallout();
}

function updateSnapshotPreviews(session) {
  const preferencesEl = $("snapshotPreferences");
  const watchedEl = $("snapshotWatched");
  const favoritesEl = $("snapshotFavorites");

  if (!preferencesEl || !watchedEl || !favoritesEl) {
    return;
  }

  if (!session || !session.token) {
    preferencesEl.textContent = "Sign in to sync your preferences.";
    watchedEl.textContent = "Sign in to sync your watched history.";
    favoritesEl.textContent = "Sign in to sync your favorites.";
    return;
  }

  const prettify = (value, fallback) => {
    if (!value || (Array.isArray(value) && value.length === 0)) {
      return fallback;
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch (error) {
      return fallback;
    }
  };

  preferencesEl.textContent = prettify(session.preferencesSnapshot, "No preference snapshot stored yet.");
  watchedEl.textContent = prettify(session.watchedHistory, "No watched history stored yet.");
  favoritesEl.textContent = prettify(session.favoritesList, "No favorites stored yet.");
}

function setupSocialFeatures() {
  initSocialFeatures();
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
  });
  state.collaborativeState = getCollaborativeStateSnapshot();
  renderSocialConnections();
  wireFollowForm();
  wireCollaborativeForms();
  if (unsubscribeNotifications) {
    unsubscribeNotifications();
  }
  unsubscribeNotifications = subscribeToNotifications((payload) => {
    renderNotificationCenter(payload);
  });
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
  if (!form || !input || !submitBtn || !statusEl) {
    return;
  }

  const SEARCH_MIN_CHARS = 2;
  let searchTimer = null;
  let searchRequestId = 0;
  let lastQuery = "";

  prefillFollowFromQuery();
  updateSocialInviteLink();
  resetSearchPanel();

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
      await followUserByUsername(username);
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
      if (!inviteLinkEl || !inviteLinkEl.value) {
        updateSocialInviteLink();
      }
      const linkValue = inviteLinkEl ? inviteLinkEl.value.trim() : "";
      if (!linkValue) {
        setInviteStatus("Invite link not ready yet. Try again in a moment.", "error");
        return;
      }
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          await navigator.clipboard.writeText(linkValue);
        } else if (inviteLinkEl) {
          inviteLinkEl.focus();
          inviteLinkEl.select();
          document.execCommand("copy");
          inviteLinkEl.setSelectionRange(inviteLinkEl.value.length, inviteLinkEl.value.length);
        }
        setInviteStatus("Link copied! Share it with friends.", "success");
      } catch (error) {
        setInviteStatus("Copy failed. Select the link and copy it manually.", "error");
      }
    });
  }

  state.socialSearchReset = (options = {}) => {
    if (options.hidePanel) {
      clearSearchResults({ hidePanel: true });
      return;
    }
    if (options.showPrompt) {
      resetSearchPanel();
      return;
    }
    clearSearchResults();
    resetSearchPanel();
  };

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

      const infoButton = document.createElement("button");
      infoButton.type = "button";
      infoButton.className = "social-follow-search-info";
      infoButton.addEventListener("click", () => {
        input.value = result.username;
        input.focus();
        setSearchState(
          "hint",
          `Press Follow to add @${result.username.toLowerCase()} or keep browsing results.`
        );
      });

      const name = document.createElement("span");
      name.className = "social-follow-name";
      name.textContent = result.displayName || formatSocialDisplayName(result.username);
      const handle = document.createElement("span");
      handle.className = "social-follow-handle";
      handle.textContent = `@${result.username}`;

      infoButton.appendChild(name);
      infoButton.appendChild(handle);

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
          await followUserByUsername(result.username);
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
      const submitButton = createForm.querySelector("button[type=\"submit\"]");
      if (submitButton) {
        submitButton.disabled = true;
      }
      setCollabStatus("Creating collaborative list…", "loading");
      try {
        await createCollaborativeListRemote({ name, description, visibility });
        setCollabStatus(`Created “${name}”.`, "success");
        createForm.reset();
        if (visibilitySelect) {
          visibilitySelect.value = "friends";
        }
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
          invitees
        });
        setCollabStatus("Watch party scheduled!", "success");
        watchForm.reset();
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
    return raw
      .split(/[\s,]+/)
      .map((value) => canonicalHandle(value))
      .filter((value) => value && value !== currentUser);
  }
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
  const collaborations = {
    owned: Array.isArray(collabLists.owned) ? collabLists.owned.length : 0,
    shared: Array.isArray(collabLists.shared) ? collabLists.shared.length : 0,
    invites: Array.isArray(collabLists.invites) ? collabLists.invites.length : 0
  };

  const followingSet = new Set(following);
  const followersSet = new Set(followers);
  const mutualSet = new Set(mutualFollowers);

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
    const activeEntries = following
      .map((username) => ({ username, presence: presence[username] }))
      .filter((entry) => entry.presence && entry.presence.state);
    if (!activeEntries.length) {
      const empty = document.createElement("p");
      empty.className = "social-presence-empty";
      empty.textContent = "No friends online right now.";
      presenceListEl.appendChild(empty);
    } else {
      activeEntries.forEach((entry) => {
        const row = document.createElement("div");
        row.className = "social-presence-row";
        const name = document.createElement("span");
        name.className = "social-presence-name";
        name.textContent = formatSocialDisplayName(entry.username);
        const state = document.createElement("span");
        state.className = "social-presence-state";
        state.dataset.state = entry.presence.state;
        if (entry.presence.state === "watching" && entry.presence.movieTitle) {
          state.textContent = `Watching ${entry.presence.movieTitle}`;
        } else if (entry.presence.state === "away") {
          state.textContent = "Away";
        } else {
          state.textContent = "Online";
        }
        row.appendChild(name);
        row.appendChild(state);
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

  const mutualListEl = $("socialMutualList");
  const mutualEmptyEl = $("socialMutualEmpty");
  if (mutualListEl && mutualEmptyEl) {
    mutualListEl.innerHTML = "";
    if (!mutualFollowers.length) {
      mutualListEl.hidden = true;
      mutualEmptyEl.hidden = false;
    } else {
      mutualFollowers.forEach((username) => {
        const chip = document.createElement("span");
        chip.className = "social-chip";
        chip.textContent = formatSocialDisplayName(username);
        chip.dataset.handle = username;
        mutualListEl.appendChild(chip);
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
    const availableSuggestions = suggestions.filter((suggestion) => {
      return suggestion && suggestion.username && !followingSet.has(suggestion.username);
    });
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
  const metaParts = [];
  if (mode === "owner") {
    metaParts.push("You own this list");
  } else if (entry.owner) {
    metaParts.push(`Owner: @${entry.owner}`);
  }
  if (entry.visibility === "private") {
    metaParts.push("Private access");
  } else {
    metaParts.push("Friends can view");
  }
  const updatedLabel = formatTimeAgo(entry.updatedAt || entry.createdAt);
  if (updatedLabel) {
    metaParts.push(`Updated ${updatedLabel}`);
  }
  meta.textContent = metaParts.join(" • ");
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
      const chip = document.createElement("span");
      chip.className = "collab-chip";
      chip.textContent = formatSocialDisplayName(handle);
      row.appendChild(chip);
    });
    card.appendChild(row);
  }

  if (mode === "owner" && Array.isArray(entry.pendingInvites) && entry.pendingInvites.length) {
    const pending = document.createElement("p");
    pending.className = "collab-list-pending";
    pending.textContent = `Pending invites: ${entry.pendingInvites.map((handle) => `@${handle}`).join(", ")}`;
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

  return card;
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
  const parts = [];
  if (entry.owner) {
    parts.push(`Owner: @${entry.owner}`);
  }
  const invitedAt = formatTimeAgo(entry.invitedAt);
  if (invitedAt) {
    parts.push(`Invited ${invitedAt}`);
  }
  meta.textContent = parts.join(" • ");
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

  const header = document.createElement("header");
  header.className = "watch-party-card-header";
  const title = document.createElement("h4");
  title.textContent = entry.movie && entry.movie.title ? entry.movie.title : "Watch party";
  header.appendChild(title);
  card.appendChild(header);

  const meta = document.createElement("div");
  meta.className = "watch-party-meta";
  const metaParts = [];
  const schedule = formatWatchPartyDate(entry.scheduledFor);
  if (schedule) {
    metaParts.push(schedule);
  }
  if (entry.host) {
    metaParts.push(`Host: @${entry.host}`);
  }
  meta.textContent = metaParts.join(" • ");
  card.appendChild(meta);

  if (entry.note) {
    const note = document.createElement("p");
    note.className = "watch-party-note";
    note.textContent = entry.note;
    card.appendChild(note);
  }

  if (mode === "upcoming" && Array.isArray(entry.invitees) && entry.invitees.length) {
    const roster = document.createElement("div");
    roster.className = "watch-party-roster";
    entry.invitees.forEach((invite) => {
      if (!invite || !invite.username) {
        return;
      }
      const chip = document.createElement("span");
      chip.className = "watch-party-chip";
      chip.dataset.state = invite.response || "pending";
      chip.textContent = `${formatSocialDisplayName(invite.username)} – ${formatPartyResponse(invite.response)}`;
      roster.appendChild(chip);
    });
    card.appendChild(roster);
  }

  const username = state.session && state.session.username ? canonicalHandle(state.session.username) : null;
  if (mode === "upcoming" && username && entry.host !== username) {
    const mine = Array.isArray(entry.invitees)
      ? entry.invitees.find((invite) => canonicalHandle(invite.username) === username)
      : null;
    if (mine) {
      const response = document.createElement("p");
      response.className = "watch-party-response";
      response.textContent = `You responded: ${formatPartyResponse(mine.response)}`;
      card.appendChild(response);
    }
  }

  if (mode === "invite") {
    const actions = document.createElement("div");
    actions.className = "watch-party-actions";
    const acceptBtn = document.createElement("button");
    acceptBtn.type = "button";
    acceptBtn.className = "btn-secondary";
    acceptBtn.textContent = "Accept";
    acceptBtn.addEventListener("click", () => {
      playUiClick();
      handleWatchPartyResponseAction(entry.id, "accept", acceptBtn, actions);
    });
    const maybeBtn = document.createElement("button");
    maybeBtn.type = "button";
    maybeBtn.className = "btn-subtle";
    maybeBtn.textContent = "Maybe";
    maybeBtn.addEventListener("click", () => {
      playUiClick();
      handleWatchPartyResponseAction(entry.id, "maybe", maybeBtn, actions);
    });
    const declineBtn = document.createElement("button");
    declineBtn.type = "button";
    declineBtn.className = "btn-subtle btn-subtle-danger";
    declineBtn.textContent = "Decline";
    declineBtn.addEventListener("click", () => {
      playUiClick();
      handleWatchPartyResponseAction(entry.id, "decline", declineBtn, actions);
    });
    actions.appendChild(acceptBtn);
    actions.appendChild(maybeBtn);
    actions.appendChild(declineBtn);
    card.appendChild(actions);
  }

  return card;
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

async function handleWatchPartyResponseAction(partyId, response, button, actionGroup) {
  if (!partyId) {
    return;
  }
  const buttons = actionGroup ? Array.from(actionGroup.querySelectorAll("button")) : [button];
  buttons.forEach((btn) => {
    btn.disabled = true;
  });
  setCollabStatus("Updating watch party RSVP…", "loading");
  try {
    await respondWatchPartyRemote({ partyId, response });
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
}

function updateSocialCount(id, value) {
  const el = $(id);
  if (!el) {
    return;
  }
  const number = Number.isFinite(value) ? Number(value) : 0;
  el.textContent = number.toLocaleString();
}

function buildSocialListItem({ username, isFollowing, followsYou, mutualFollowers, onPrimaryAction }) {
  const item = document.createElement("div");
  item.className = "social-follow-item";

  const row = document.createElement("div");
  row.className = "social-follow-row";
  item.appendChild(row);

  const primary = document.createElement("div");
  primary.className = "social-follow-primary";
  const name = document.createElement("span");
  name.className = "social-follow-name";
  name.textContent = formatSocialDisplayName(username);
  const handle = document.createElement("span");
  handle.className = "social-follow-handle";
  handle.textContent = `@${username}`;
  primary.appendChild(name);
  primary.appendChild(handle);
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

  const nameBlock = document.createElement("div");
  nameBlock.className = "social-suggestion-names";
  const name = document.createElement("span");
  name.className = "social-follow-name";
  name.textContent = suggestion.displayName || formatSocialDisplayName(suggestion.username);
  const handle = document.createElement("span");
  handle.className = "social-follow-handle";
  handle.textContent = `@${suggestion.username}`;
  nameBlock.appendChild(name);
  nameBlock.appendChild(handle);
  identity.appendChild(nameBlock);

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

function canonicalHandle(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
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

function renderNotificationCenter(payload = {}) {
  const bell = $("notificationBell");
  const countEl = $("notificationCount");
  const panel = $("notificationPanel");
  const listEl = $("notificationList");
  const emptyEl = $("notificationEmpty");
  if (!bell || !countEl || !panel || !listEl || !emptyEl) {
    return;
  }

  const hasSession = Boolean(state.session && state.session.token);
  bell.hidden = !hasSession;
  if (!hasSession) {
    state.notificationPanelOpen = false;
    bell.setAttribute("aria-expanded", "false");
    countEl.hidden = true;
    listEl.innerHTML = "";
    listEl.hidden = true;
    emptyEl.hidden = false;
    panel.hidden = true;
    return;
  }

  const notifications = Array.isArray(payload.notifications)
    ? payload.notifications
    : Array.isArray(state.notifications)
    ? state.notifications
    : [];
  state.notifications = notifications.slice();
  const unreadCount = typeof payload.unreadCount === "number"
    ? payload.unreadCount
    : countUnreadNotifications();

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
    notifications.forEach((note) => {
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
      message.textContent = note.message || "Activity update.";

      const meta = document.createElement("div");
      meta.className = "notification-item-meta";
      meta.textContent = formatNotificationTimestamp(note.createdAt);

      body.appendChild(message);
      if (meta.textContent) {
        body.appendChild(meta);
      }
      item.appendChild(icon);
      item.appendChild(body);
      listEl.appendChild(item);
    });
  }

  if (state.notificationPanelOpen) {
    panel.hidden = false;
    bell.setAttribute("aria-expanded", "true");
  } else {
    panel.hidden = true;
    bell.setAttribute("aria-expanded", "false");
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
    await followUserByUsername(normalized);
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
  if (!hasSession) {
    setSocialStatus("", null);
  }
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
    updateSyncInsights(null);
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

  updateSyncInsights(session);
  refreshProfileOverviewCallout();
}


function applyPreferencesSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return;
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
            : null
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
            : null
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
