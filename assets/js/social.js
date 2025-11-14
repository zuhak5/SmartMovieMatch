import { loadSession, subscribeToSession } from './auth.js';
import { createInlineProfileLink } from './profile-overlay.js';

const SOCIAL_ENDPOINT = '/api/social';
const MAX_REVIEW_LENGTH = 600;
const MAX_LONG_REVIEW_LENGTH = 2400;

const NOTIFICATION_POLL_INTERVAL = 45000;
const REVIEW_REACTIONS = ['👍', '❤️', '😂', '😮'];
const THREAD_PROMPTS = [
  'What would you pair this with?',
  'Agree or disagree with their take?',
  'Where did you watch it?',
  'Did it hold up on a rewatch?',
  'Which scene surprised you most?'
];
const REVIEW_SORT_OPTIONS = [
  { key: 'top-friends', label: 'Top from friends' },
  { key: 'most-liked', label: 'Most liked' },
  { key: 'newest', label: 'Newest' }
];
const DEFAULT_REVIEW_SORT = 'newest';
const MUTED_USERS_STORAGE_KEY = 'smm.social-muted.v1';

function loadMutedUsersFromStorage() {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(MUTED_USERS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((username) => canonicalUsername(username))
      .filter(Boolean);
  } catch (error) {
    console.warn('Failed to parse muted users from storage', error);
    return [];
  }
}

export const PRESENCE_STATUS_PRESETS = [
  {
    key: 'default',
    label: 'Just browsing',
    description: 'Keep it casual and appear online without extra context.',
    highlight: 'is online now.',
    shortLabel: 'Online',
    icon: '👀'
  },
  {
    key: 'available',
    label: 'Available for watch party',
    description: 'Ping me to co-host or jump into a movie night.',
    highlight: 'is ready for a watch party.',
    shortLabel: 'Available for watch party',
    icon: '🎉'
  },
  {
    key: 'comedy',
    label: 'In the mood for comedies',
    description: 'Serve up the funniest picks you can find.',
    highlight: 'is in the mood for comedies.',
    shortLabel: 'In the mood for comedies',
    icon: '😂'
  },
  {
    key: 'rewatch',
    label: 'Rewatching comfort classics',
    description: 'Cozy night with familiar favorites and throwbacks.',
    highlight: 'is rewatching comfort classics.',
    shortLabel: 'Rewatching comfort classics',
    icon: '🔁'
  }
];

const DEFAULT_PRESENCE_STATUS = 'default';
const PRESENCE_STATUS_PRESET_MAP = new Map(PRESENCE_STATUS_PRESETS.map((preset) => [preset.key, preset]));

const state = {
  session: loadSession(),
  following: [],
  followingLoaded: false,
  followingLoading: false,
  socialOverview: createDefaultSocialOverview(),
  presence: {},
  badges: [],
  sections: new Set(),
  sectionsByKey: new Map(),
  reviewCache: new Map(),
  notifications: [],
  notificationsLoaded: false,
  notificationsLoading: false,
  notificationTimer: null,
  notificationSeen: new Set(),
  toastHost: null,
  notificationStream: null,
  notificationRetry: 0,
  collabState: {
    lists: { owned: [], shared: [], invites: [] },
    watchParties: { upcoming: [], invites: [] }
  },
  presenceTicker: null,
  presenceStatusPreset: DEFAULT_PRESENCE_STATUS,
  blockedUsers: new Set(),
  mutedUsers: new Set(loadMutedUsersFromStorage())
};

const followingSubscribers = new Set();
const reviewSubscribers = new Map();
const notificationSubscribers = new Set();
const socialOverviewSubscribers = new Set();
const collaborativeSubscribers = new Set();
const presenceStatusSubscribers = new Set();
const mutedSubscribers = new Set();

function persistMutedUsers(handles) {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(MUTED_USERS_STORAGE_KEY, JSON.stringify(handles));
  } catch (error) {
    console.warn('Failed to persist muted users', error);
  }
}

function notifyMutedSubscribers() {
  const snapshot = Array.from(state.mutedUsers);
  mutedSubscribers.forEach((callback) => {
    try {
      callback(snapshot);
    } catch (error) {
      console.warn('Muted subscriber error', error);
    }
  });
}

function setMutedUsers(handles) {
  const normalized = Array.from(
    new Set(handles.map((handle) => canonicalUsername(handle)).filter(Boolean))
  );
  const hasChanged =
    normalized.length !== state.mutedUsers.size ||
    normalized.some((handle) => !state.mutedUsers.has(handle));
  if (!hasChanged) {
    return;
  }
  state.mutedUsers = new Set(normalized);
  persistMutedUsers(normalized);
  notifyMutedSubscribers();
  rerenderVisibleSections();
}

function applyBlockedUsers(handles = []) {
  const normalized = Array.isArray(handles)
    ? handles.map((handle) => canonicalUsername(handle)).filter(Boolean)
    : [];
  const hasChanged =
    normalized.length !== state.blockedUsers.size ||
    normalized.some((handle) => !state.blockedUsers.has(handle));
  if (!hasChanged) {
    return;
  }
  state.blockedUsers = new Set(normalized);
  rerenderVisibleSections();
}

function notifyPresenceStatusSubscribers() {
  const preset = getPresenceStatusPreset();
  presenceStatusSubscribers.forEach((callback) => {
    try {
      callback(preset);
    } catch (error) {
      console.warn('Presence status subscriber error', error);
    }
  });
}

function normalizePresenceStatusPreset(value) {
  if (typeof value !== 'string') {
    return DEFAULT_PRESENCE_STATUS;
  }
  const trimmed = value.trim().toLowerCase();
  return PRESENCE_STATUS_PRESET_MAP.has(trimmed) ? trimmed : DEFAULT_PRESENCE_STATUS;
}

function setLocalPresenceStatusPreset(presetKey, { notify = true } = {}) {
  const normalized = normalizePresenceStatusPreset(presetKey);
  if (state.presenceStatusPreset === normalized) {
    if (notify) {
      notifyPresenceStatusSubscribers();
    }
    return normalized;
  }
  state.presenceStatusPreset = normalized;
  if (notify) {
    notifyPresenceStatusSubscribers();
  }
  return normalized;
}

export function getPresenceStatusPreset() {
  return state.presenceStatusPreset || DEFAULT_PRESENCE_STATUS;
}

export function subscribeToPresenceStatusPreset(callback) {
  if (typeof callback !== 'function') {
    return () => {};
  }
  presenceStatusSubscribers.add(callback);
  try {
    callback(getPresenceStatusPreset());
  } catch (error) {
    console.warn('Presence status subscriber error', error);
  }
  return () => {
    presenceStatusSubscribers.delete(callback);
  };
}

export async function setPresenceStatusPreset(presetKey, options = {}) {
  const previous = getPresenceStatusPreset();
  const normalized = setLocalPresenceStatusPreset(presetKey);
  const shouldSync = options.sync !== false;
  const silent = options.silent === true;
  if (!shouldSync) {
    return normalized;
  }
  if (!state.session || !state.session.token) {
    setLocalPresenceStatusPreset(previous);
    throw new Error('Sign in to share a status with friends.');
  }
  try {
    await pingPresence('online', { statusPreset: normalized, silent });
    return normalized;
  } catch (error) {
    setLocalPresenceStatusPreset(previous);
    throw error;
  }
}

subscribeToSession((session) => {
  state.session = session;
  const hasSession = Boolean(session && session.token);
  if (!hasSession) {
    state.following = [];
    state.followingLoaded = false;
    state.followingLoading = false;
    state.socialOverview = createDefaultSocialOverview();
    state.blockedUsers = new Set();
    state.presence = {};
    state.presenceStatusPreset = DEFAULT_PRESENCE_STATUS;
    state.badges = [];
    state.collabState = {
      lists: { owned: [], shared: [], invites: [] },
      watchParties: { upcoming: [], invites: [] }
    };
    state.reviewCache.clear();
    state.notifications = [];
    state.notificationsLoaded = false;
    state.notificationsLoading = false;
    state.notificationSeen.clear();
    stopNotificationPolling();
    stopNotificationStream();
    stopPresenceTicker();
    notifyPresenceStatusSubscribers();
    notifyNotificationSubscribers();
    notifyFollowingSubscribers();
    notifySocialOverviewSubscribers();
    notifyCollaborativeSubscribers();
    state.sections.forEach((section) => hideSection(section));
    return;
  }
  state.followingLoaded = false;
  state.followingLoading = false;
  state.socialOverview = createDefaultSocialOverview();
  state.blockedUsers = new Set();
  loadFollowing().catch(() => {});
  state.notificationsLoaded = false;
  state.notificationsLoading = false;
  loadNotifications().catch(() => {});
  startNotificationPolling();
  startNotificationStream();
  startPresenceTicker();
  loadCollaborativeState().catch(() => {});
  state.sections.forEach((section) => showSection(section));
});

export function initSocialFeatures() {
  if (state.session && state.session.token && !state.followingLoaded && !state.followingLoading) {
    loadFollowing().catch(() => {});
  }
  if (state.session && state.session.token && !state.notificationsLoaded && !state.notificationsLoading) {
    loadNotifications().catch(() => {});
    startNotificationPolling();
  }
  if (state.session && state.session.token) {
    startNotificationStream();
    startPresenceTicker();
    loadCollaborativeState().catch(() => {});
  }
}

export function refreshCollaborativeState() {
  return loadCollaborativeState();
}

export function subscribeToCollaborativeState(callback) {
  if (typeof callback !== 'function') {
    return () => {};
  }
  collaborativeSubscribers.add(callback);
  try {
    callback(cloneCollaborativeState(state.collabState));
  } catch (error) {
    console.warn('Collaborative subscriber error', error);
  }
  return () => {
    collaborativeSubscribers.delete(callback);
  };
}

export function getCollaborativeStateSnapshot() {
  return cloneCollaborativeState(state.collabState);
}

export async function createCollaborativeListRemote({ name, description, visibility = 'friends' }) {
  return callSocial('createCollaborativeList', { name, description, visibility });
}

export async function inviteCollaboratorRemote({ listId, username }) {
  return callSocial('inviteCollaborator', { listId, username });
}

export async function respondCollaboratorInviteRemote({ listId, decision }) {
  return callSocial('respondCollaboratorInvite', { listId, decision });
}

export async function scheduleWatchPartyRemote({ movie, scheduledFor, note, invitees }) {
  return callSocial('scheduleWatchParty', { movie, scheduledFor, note, invitees });
}

export async function respondWatchPartyRemote({ partyId, response, note }) {
  return callSocial('respondWatchParty', { partyId, response, note });
}

export async function voteCollaborativeItemRemote({ listId, tmdbId, vote }) {
  return callSocial('voteCollaborativeItem', { listId, tmdbId, vote });
}

export async function postCollaborativeNoteRemote({ listId, body }) {
  return callSocial('postCollaborativeNote', { listId, body });
}

export async function generateInviteQrRemote(link) {
  const trimmed = typeof link === 'string' ? link.trim() : '';
  if (!trimmed) {
    throw new Error('Provide a profile link before creating a QR code.');
  }
  const response = await callSocial('generateInviteQr', { link: trimmed });
  if (!response || typeof response.dataUrl !== 'string' || !response.dataUrl.startsWith('data:image/')) {
    throw new Error('Unable to create a QR code right now.');
  }
  return response.dataUrl;
}

export function buildCommunitySection(movieContext) {
  const tmdbId = normalizeId(movieContext && movieContext.tmdbId);
  const title = typeof movieContext?.title === 'string' ? movieContext.title : '';
  if (!tmdbId || !title) {
    return null;
  }

  const headerSummary = movieContext && movieContext.headerSummary ? movieContext.headerSummary : null;
  const condensedContainer =
    headerSummary && headerSummary.container instanceof HTMLElement ? headerSummary.container : null;
  const condensedAvatars =
    headerSummary && headerSummary.avatars instanceof HTMLElement ? headerSummary.avatars : null;
  const condensedOverall =
    headerSummary && headerSummary.overall instanceof HTMLElement ? headerSummary.overall : null;
  const condensedFriends =
    headerSummary && headerSummary.friends instanceof HTMLElement ? headerSummary.friends : null;
  const condensedActivity =
    headerSummary && headerSummary.activity instanceof HTMLElement ? headerSummary.activity : null;
  const condensedBadge =
    headerSummary && headerSummary.badge instanceof HTMLElement ? headerSummary.badge : null;

  const section = document.createElement('section');
  section.className = 'community-notes';
  section.hidden = true;
  section.dataset.tmdbId = tmdbId;

  const header = document.createElement('header');
  header.className = 'community-notes-header';
  const heading = document.createElement('h3');
  heading.textContent = 'Community notes';
  header.appendChild(heading);

  const helper = document.createElement('p');
  helper.className = 'community-notes-helper';
  helper.textContent = 'Swap quick takes with friends and see how they rated it.';
  header.appendChild(helper);
  section.appendChild(header);

  const summary = createSummaryElements();
  section.appendChild(summary.container);

  const form = document.createElement('form');
  form.className = 'community-form';
  form.noValidate = true;

  const ratingField = document.createElement('div');
  ratingField.className = 'community-form-field';
  const ratingLabel = document.createElement('label');
  ratingLabel.textContent = 'Your rating';
  ratingLabel.setAttribute('for', `communityRating-${tmdbId}`);
  const ratingInput = document.createElement('input');
  ratingInput.type = 'number';
  ratingInput.min = '0';
  ratingInput.max = '10';
  ratingInput.step = '0.5';
  ratingInput.required = true;
  ratingInput.className = 'input-base input-text community-rating-input';
  ratingInput.id = `communityRating-${tmdbId}`;
  ratingInput.placeholder = '0 – 10';
  ratingField.appendChild(ratingLabel);
  ratingField.appendChild(ratingInput);

  const textField = document.createElement('div');
  textField.className = 'community-form-field';
  const textLabel = document.createElement('label');
  textLabel.setAttribute('for', `communityText-${tmdbId}`);
  textLabel.textContent = 'Short review';
  const textArea = document.createElement('textarea');
  textArea.id = `communityText-${tmdbId}`;
  textArea.className = 'input-base community-textarea';
  textArea.maxLength = MAX_REVIEW_LENGTH;
  textArea.rows = 3;
  textArea.placeholder = 'Keep it spoiler-free unless you mark it below…';
  textField.appendChild(textLabel);
  textField.appendChild(textArea);
  const toneHint = document.createElement('p');
  toneHint.className = 'community-tone-hint';
  toneHint.textContent = 'Keep it constructive and mark spoilers. Use [spoiler]…[/spoiler] for big reveals.';
  textField.appendChild(toneHint);

  const advancedDetails = document.createElement('details');
  advancedDetails.className = 'community-advanced';
  const advancedSummary = document.createElement('summary');
  advancedSummary.textContent = 'Add long-form thoughts & spoiler tags';
  advancedDetails.appendChild(advancedSummary);
  const longField = document.createElement('div');
  longField.className = 'community-form-field';
  const longLabel = document.createElement('label');
  longLabel.setAttribute('for', `communityLong-${tmdbId}`);
  longLabel.textContent = 'Extended review (optional)';
  const longArea = document.createElement('textarea');
  longArea.id = `communityLong-${tmdbId}`;
  longArea.className = 'input-base community-long-textarea';
  longArea.rows = 6;
  longArea.maxLength = MAX_LONG_REVIEW_LENGTH;
  longArea.placeholder = 'Go deeper here. Wrap spoilers like [spoiler]This text[/spoiler].';
  const helperText = document.createElement('p');
  helperText.className = 'community-advanced-hint';
  helperText.textContent = 'Use [spoiler]…[/spoiler] to hide specific paragraphs. The short review above stays as your quick take.';
  longField.appendChild(longLabel);
  longField.appendChild(longArea);
  longField.appendChild(helperText);
  advancedDetails.appendChild(longField);

  const flagsRow = document.createElement('div');
  flagsRow.className = 'community-flags-row';
  const spoilerLabel = document.createElement('label');
  spoilerLabel.className = 'community-flag';
  const spoilerInput = document.createElement('input');
  spoilerInput.type = 'checkbox';
  spoilerInput.id = `communitySpoiler-${tmdbId}`;
  const spoilerText = document.createElement('span');
  spoilerText.textContent = 'Contains spoilers';
  spoilerLabel.appendChild(spoilerInput);
  spoilerLabel.appendChild(spoilerText);
  flagsRow.appendChild(spoilerLabel);

  const visibilityField = document.createElement('div');
  visibilityField.className = 'community-form-field community-visibility-field';
  const visibilityLabel = document.createElement('label');
  visibilityLabel.setAttribute('for', `communityVisibility-${tmdbId}`);
  visibilityLabel.textContent = 'Who can see this?';
  const visibilitySelect = document.createElement('select');
  visibilitySelect.id = `communityVisibility-${tmdbId}`;
  visibilitySelect.className = 'input-base community-visibility-select';
  [
    { value: 'public', label: 'Public (everyone)' },
    { value: 'friends', label: 'Friends only' },
    { value: 'private', label: 'Only me' }
  ].forEach((option) => {
    const node = document.createElement('option');
    node.value = option.value;
    node.textContent = option.label;
    visibilitySelect.appendChild(node);
  });
  const visibilityHint = document.createElement('p');
  visibilityHint.className = 'community-visibility-hint';
  visibilityHint.textContent = 'Dial down visibility per diary entry to keep vulnerable takes comfy.';
  visibilityField.appendChild(visibilityLabel);
  visibilityField.appendChild(visibilitySelect);
  visibilityField.appendChild(visibilityHint);
  flagsRow.appendChild(visibilityField);

  const submitRow = document.createElement('div');
  submitRow.className = 'community-submit-row';
  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'btn-secondary';
  submitBtn.textContent = 'Post review';
  submitRow.appendChild(submitBtn);

  const statusEl = document.createElement('div');
  statusEl.className = 'community-status';
  statusEl.setAttribute('aria-live', 'polite');
  submitRow.appendChild(statusEl);

  form.appendChild(ratingField);
  form.appendChild(textField);
  form.appendChild(advancedDetails);
  form.appendChild(flagsRow);
  form.appendChild(submitRow);
  section.appendChild(form);

  const filterControls = createFilterControls();
  section.appendChild(filterControls.container);

  const reactionSummary = createReactionSummaryControls();
  section.appendChild(reactionSummary.container);

  const friendsHighlight = createFriendsHighlight();
  section.appendChild(friendsHighlight.container);

  const listWrapper = document.createElement('div');
  listWrapper.className = 'community-reviews';
  const list = document.createElement('div');
  list.className = 'community-review-list';
  const empty = document.createElement('div');
  empty.className = 'community-empty-state';
  empty.textContent = 'No reviews yet. Be the first!';
  listWrapper.appendChild(list);
  listWrapper.appendChild(empty);
  section.appendChild(listWrapper);

  const loadingIndicator = document.createElement('div');
  loadingIndicator.className = 'community-loading';
  loadingIndicator.textContent = 'Loading community notes…';
  section.appendChild(loadingIndicator);

  const errorMessage = document.createElement('div');
  errorMessage.className = 'community-error';
  section.appendChild(errorMessage);

  const sectionState = {
    key: tmdbId,
    movie: {
      tmdbId,
      imdbId: movieContext?.imdbId || movieContext?.imdbID || null,
      title
    },
    container: section,
    form,
    ratingInput,
    textArea,
    fullTextArea: longArea,
    advancedDetails,
    spoilerInput,
    visibilitySelect,
    submitBtn,
    statusEl,
    filter: 'all',
    sort: DEFAULT_REVIEW_SORT,
    reactionFilter: null,
    filterControls,
    friendsHighlight,
    reactionSummary,
    summaryEl: summary.container,
    summaryOverallValue: summary.overallValue,
    summaryOverallMeta: summary.overallMeta,
    summaryFriendsCard: summary.friendCard,
    summaryFriendsValue: summary.friendValue,
    summaryFriendsMeta: summary.friendMeta,
    summaryUpdated: summary.updated,
    condensedEl: condensedContainer,
    condensedAvatars,
    condensedOverall,
    condensedFriends,
    condensedActivity,
    condensedBadge,
    friendActivityInitialized: false,
    friendActivitySeenAt: null,
    lastFriendActivity: null,
    lastRenderOrigin: null,
    friendToastAt: null,
    list,
    empty,
    emptyDefaultMessage: empty.textContent,
    loadingIndicator,
    errorMessage,
    visible: false,
    unsubscribe: null
  };

  if (filterControls.allButton) {
    filterControls.allButton.addEventListener('click', () => {
      setSectionFilter(sectionState, 'all');
    });
  }
  if (filterControls.friendsButton) {
    filterControls.friendsButton.addEventListener('click', () => {
      setSectionFilter(sectionState, 'friends');
    });
  }
  if (filterControls.sortButtons) {
    Object.entries(filterControls.sortButtons).forEach(([key, button]) => {
      button.addEventListener('click', () => {
        setSectionSort(sectionState, key);
      });
    });
  }
  if (reactionSummary.buttons) {
    Object.entries(reactionSummary.buttons).forEach(([emoji, button]) => {
      button.addEventListener('click', () => {
        if (button.disabled) {
          return;
        }
        toggleReactionFilter(sectionState, emoji);
      });
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await handleSubmit(sectionState);
  });

  state.sections.add(sectionState);
  state.sectionsByKey.set(sectionState.key, sectionState);
  if (state.session && state.session.token) {
    showSection(sectionState);
  }

  section.addEventListener('DOMNodeRemoved', () => {
    if (sectionState.unsubscribe) {
      sectionState.unsubscribe();
      sectionState.unsubscribe = null;
    }
    state.sections.delete(sectionState);
    state.sectionsByKey.delete(sectionState.key);
  });

  return section;
}

export function subscribeToFollowing(callback) {
  if (typeof callback !== 'function') {
    return () => {};
  }
  followingSubscribers.add(callback);
  try {
    callback(state.following.slice());
  } catch (error) {
    console.warn('Following subscriber error', error);
  }
  return () => {
    followingSubscribers.delete(callback);
  };
}

export function getMutedUsers() {
  return Array.from(state.mutedUsers);
}

export function subscribeToMutedUsers(callback) {
  if (typeof callback !== 'function') {
    return () => {};
  }
  mutedSubscribers.add(callback);
  try {
    callback(getMutedUsers());
  } catch (error) {
    console.warn('Muted subscriber error', error);
  }
  return () => {
    mutedSubscribers.delete(callback);
  };
}

export function muteUser(username) {
  const normalized = canonicalUsername(username);
  if (!normalized) {
    throw new Error('Select a valid username to mute.');
  }
  const next = new Set(state.mutedUsers);
  next.add(normalized);
  setMutedUsers(Array.from(next));
}

export function unmuteUser(username) {
  const normalized = canonicalUsername(username);
  if (!normalized || !state.mutedUsers.has(normalized)) {
    return;
  }
  const next = Array.from(state.mutedUsers).filter((handle) => handle !== normalized);
  setMutedUsers(next);
}

export function isUserMuted(username) {
  const normalized = canonicalUsername(username);
  return Boolean(normalized && state.mutedUsers.has(normalized));
}

export function isUserBlocked(username) {
  const normalized = canonicalUsername(username);
  return Boolean(normalized && state.blockedUsers.has(normalized));
}

export function subscribeToSocialOverview(callback) {
  if (typeof callback !== 'function') {
    return () => {};
  }
  socialOverviewSubscribers.add(callback);
  try {
    callback(cloneSocialOverview(state.socialOverview));
  } catch (error) {
    console.warn('Social overview subscriber error', error);
  }
  return () => {
    socialOverviewSubscribers.delete(callback);
  };
}

export function subscribeToNotifications(callback) {
  if (typeof callback !== 'function') {
    return () => {};
  }
  notificationSubscribers.add(callback);
  try {
    callback({
      notifications: state.notifications.slice(),
      unreadCount: countUnreadNotifications()
    });
  } catch (error) {
    console.warn('Notification subscriber error', error);
  }
  return () => {
    notificationSubscribers.delete(callback);
  };
}

export async function acknowledgeNotifications() {
  if (!state.session || !state.session.token || !state.notificationsLoaded) {
    return;
  }
  try {
    const response = await callSocial('ackNotifications');
    applyNotificationPayload(response);
  } catch (error) {
    console.warn('Failed to acknowledge notifications', error);
  }
}

export async function recordLibraryActivity(action, movie) {
  if (!state.session || !state.session.token) {
    return;
  }
  const payload = normalizeMovieForApi(movie);
  if (!payload) {
    return;
  }
  try {
    await callSocial('recordLibraryAction', { action, movie: payload });
  } catch (error) {
    console.warn('Failed to record library activity', error);
  }
}

export async function followUserByUsername(username, options = {}) {
  const normalized = canonicalUsername(username);
  if (!normalized) {
    throw new Error('Enter a username to follow.');
  }
  const note = typeof options.note === 'string' ? options.note.trim() : '';
  const payload = note ? { target: normalized, note } : { target: normalized };
  await callSocial('followUser', payload);
  await loadFollowing(true);
  refreshAllSections();
}

export async function unfollowUserByUsername(username) {
  const normalized = canonicalUsername(username);
  if (!normalized) {
    throw new Error('Enter a username to unfollow.');
  }
  await callSocial('unfollowUser', { target: normalized });
  await loadFollowing(true);
  refreshAllSections();
}

export async function blockUserByUsername(username) {
  const normalized = canonicalUsername(username);
  if (!normalized) {
    throw new Error('Enter a username to block.');
  }
  await callSocial('blockUser', { target: normalized });
  await loadFollowing(true);
  rerenderVisibleSections();
}

export async function unblockUserByUsername(username) {
  const normalized = canonicalUsername(username);
  if (!normalized) {
    throw new Error('Enter a username to unblock.');
  }
  await callSocial('unblockUser', { target: normalized });
  await loadFollowing(true);
  rerenderVisibleSections();
}

export async function searchSocialUsers(query) {
  const trimmed = typeof query === 'string' ? query.trim() : '';
  if (!trimmed) {
    return [];
  }
  const response = await callSocial('searchUsers', { query: trimmed });
  if (!response || !Array.isArray(response.results)) {
    return [];
  }
  return response.results.map((entry) => ({
    username: entry.username,
    displayName: entry.displayName,
    tagline: entry.tagline || '',
    sharedInterests: Array.isArray(entry.sharedInterests) ? entry.sharedInterests.slice() : [],
    sharedFavorites: Array.isArray(entry.sharedFavorites) ? entry.sharedFavorites.slice() : [],
    sharedWatchHistory: Array.isArray(entry.sharedWatchHistory) ? entry.sharedWatchHistory.slice() : [],
    sharedWatchParties: Array.isArray(entry.sharedWatchParties) ? entry.sharedWatchParties.slice() : [],
    mutualFollowers: Array.isArray(entry.mutualFollowers) ? entry.mutualFollowers.slice() : [],
    followsYou: entry.followsYou === true,
    reason: typeof entry.reason === 'string' ? entry.reason : '',
    pinnedList: entry.pinnedList || null,
    pinnedReview: entry.pinnedReview || null
  }));
}

export function getFollowingSnapshot() {
  return state.following.slice();
}

export function getSocialOverviewSnapshot() {
  return cloneSocialOverview(state.socialOverview);
}

export function acknowledgeFriendActivity(key) {
  const normalized = normalizeId(key);
  if (!normalized) {
    return;
  }
  const sectionState = state.sectionsByKey.get(normalized);
  if (!sectionState) {
    return;
  }
  sectionState.friendActivityInitialized = true;
  sectionState.friendActivitySeenAt = sectionState.lastFriendActivity || null;
  if (sectionState.condensedBadge) {
    sectionState.condensedBadge.hidden = true;
    sectionState.condensedBadge.classList.remove('is-visible');
    sectionState.condensedBadge.removeAttribute('aria-label');
  }
}

function hideSection(sectionState) {
  sectionState.visible = false;
  sectionState.container.hidden = true;
  sectionState.form.reset();
  sectionState.submitBtn.disabled = true;
  sectionState.loadingIndicator.hidden = true;
  sectionState.errorMessage.textContent = '';
  sectionState.statusEl.textContent = '';
  if (sectionState.summaryEl) {
    sectionState.summaryEl.hidden = true;
  }
  if (sectionState.summaryUpdated) {
    sectionState.summaryUpdated.textContent = '';
    sectionState.summaryUpdated.hidden = true;
  }
  if (sectionState.condensedEl) {
    sectionState.condensedEl.hidden = true;
  }
  if (sectionState.condensedActivity) {
    sectionState.condensedActivity.hidden = true;
    sectionState.condensedActivity.textContent = '';
  }
  if (sectionState.condensedBadge) {
    sectionState.condensedBadge.hidden = true;
    sectionState.condensedBadge.classList.remove('is-visible');
    sectionState.condensedBadge.removeAttribute('aria-label');
  }
  sectionState.filter = 'all';
  if (sectionState.filterControls) {
    sectionState.filterControls.container.hidden = true;
    if (sectionState.filterControls.friendsButton) {
      sectionState.filterControls.friendsButton.disabled = true;
      sectionState.filterControls.friendsButton.setAttribute('aria-disabled', 'true');
    }
    updateFilterButtonState(sectionState);
  }
  sectionState.friendActivityInitialized = false;
  sectionState.friendActivitySeenAt = null;
  sectionState.lastFriendActivity = null;
  sectionState.lastRenderOrigin = null;
  sectionState.friendToastAt = null;
  if (sectionState.unsubscribe) {
    sectionState.unsubscribe();
    sectionState.unsubscribe = null;
  }
}

function showSection(sectionState) {
  sectionState.container.hidden = false;
  sectionState.submitBtn.disabled = false;
  sectionState.visible = true;
  sectionState.loadingIndicator.hidden = false;
  sectionState.errorMessage.textContent = '';
  if (!sectionState.unsubscribe) {
    sectionState.unsubscribe = subscribeToReviews(sectionState.key, (data) => {
      renderSection(sectionState, data);
    });
  }
  ensureReviewsLoaded(sectionState.key, sectionState.movie, false, 'load');
}

async function ensureReviewsLoaded(key, movie, force = false, origin = 'load') {
  const cache = state.reviewCache.get(key);
  if (!force && cache && !cache.loading) {
    return;
  }
  await fetchReviews(key, movie, force, origin);
}

async function fetchReviews(key, movie, force = false, origin = 'load') {
  if (!state.session || !state.session.token) {
    return;
  }
  let cache = state.reviewCache.get(key);
  if (!cache) {
    cache = { loading: false, error: null, reviews: [], myReview: null, stats: null, lastOrigin: null };
    state.reviewCache.set(key, cache);
  }
  if (cache.loading && !force) {
    return;
  }
  cache.loading = true;
  cache.error = null;
  notifyReviewSubscribers(key);
  try {
    const response = await callSocial('getMovieReviews', { movie });
    cache.reviews = Array.isArray(response.reviews) ? response.reviews : [];
    cache.myReview = response.myReview || null;
    cache.stats = response.stats || computeReviewStats(cache.reviews);
    cache.lastOrigin = origin;
  } catch (error) {
    cache.error = error instanceof Error ? error.message : 'Unable to load reviews.';
  } finally {
    cache.loading = false;
    notifyReviewSubscribers(key);
  }
}

async function handleSubmit(sectionState) {
  if (!state.session || !state.session.token) {
    sectionState.statusEl.textContent = 'Sign in to post a review.';
    sectionState.statusEl.dataset.variant = 'error';
    return;
  }

  const ratingValue = sectionState.ratingInput.value;
  const ratingNumber = ratingValue === '' ? null : Number(ratingValue);
  if (!Number.isFinite(ratingNumber) || ratingNumber < 0 || ratingNumber > 10) {
    sectionState.statusEl.textContent = 'Enter a rating between 0 and 10.';
    sectionState.statusEl.dataset.variant = 'error';
    sectionState.ratingInput.focus();
    return;
  }
  const visibilityValue = sectionState.visibilitySelect
    ? sectionState.visibilitySelect.value
    : 'public';

  sectionState.submitBtn.disabled = true;
  sectionState.statusEl.textContent = 'Saving your review…';
  sectionState.statusEl.dataset.variant = 'loading';

  try {
    const longForm = sectionState.fullTextArea ? sectionState.fullTextArea.value.trim() : '';
    const hasMarkupSpoilers = /\[spoiler\]/i.test(longForm);
    await callSocial('upsertReview', {
      movie: sectionState.movie,
      review: {
        rating: ratingNumber,
        body: sectionState.textArea.value.trim(),
        fullText: longForm,
        hasSpoilers: sectionState.spoilerInput.checked || hasMarkupSpoilers,
        visibility: visibilityValue
      }
    });
    sectionState.statusEl.textContent = 'Review saved.';
    sectionState.statusEl.dataset.variant = 'success';
    await fetchReviews(sectionState.key, sectionState.movie, true);
  } catch (error) {
    sectionState.statusEl.textContent =
      error instanceof Error ? error.message : 'Could not save your review. Try again later.';
    sectionState.statusEl.dataset.variant = 'error';
  } finally {
    sectionState.submitBtn.disabled = false;
  }
}

function renderSection(sectionState, cache) {
  if (!sectionState.visible) {
    return;
  }
  const data = cache || state.reviewCache.get(sectionState.key) || {};
  const {
    reviews = [],
    myReview = null,
    loading = false,
    error = null,
    stats = null,
    lastOrigin = 'load'
  } = data;

  sectionState.lastRenderOrigin = lastOrigin || 'load';

  if (loading) {
    sectionState.loadingIndicator.hidden = false;
  } else {
    sectionState.loadingIndicator.hidden = true;
  }

  sectionState.errorMessage.textContent = error ? String(error) : '';
  sectionState.errorMessage.hidden = !error;

  const summaryStats = stats || computeReviewStats(reviews);
  renderSummary(sectionState, summaryStats, reviews);
  updateFilterControls(sectionState, summaryStats, myReview, reviews);

  if (myReview) {
    sectionState.ratingInput.value = myReview.rating != null ? String(myReview.rating) : '';
    sectionState.textArea.value = myReview.body || '';
    sectionState.spoilerInput.checked = Boolean(myReview.hasSpoilers);
    if (sectionState.fullTextArea) {
      sectionState.fullTextArea.value = myReview.fullText || '';
      if (sectionState.fullTextArea.value && sectionState.advancedDetails && !sectionState.advancedDetails.open) {
        sectionState.advancedDetails.open = true;
      }
    }
    if (sectionState.visibilitySelect) {
      sectionState.visibilitySelect.value = myReview.visibility || 'public';
    }
  } else if (sectionState.visibilitySelect) {
    sectionState.visibilitySelect.value = 'public';
  }

  sectionState.list.innerHTML = '';
  const filteredReviews = filterReviewsForDisplay(reviews, sectionState.filter);
  updateReactionSummary(sectionState, filteredReviews);
  updateFriendsHighlight(sectionState, reviews);
  const reactionFilteredReviews = filterReviewsByReaction(filteredReviews, sectionState.reactionFilter);
  const sortedReviews = sortReviewsForDisplay(reactionFilteredReviews, sectionState.sort);

  if (!sortedReviews.length) {
    const hasAnyReviews = reviews.length > 0;
    const hasFilteredReviews = filteredReviews.length > 0;
    if (!hasAnyReviews) {
      sectionState.empty.textContent = sectionState.emptyDefaultMessage;
    } else if (!hasFilteredReviews || sectionState.filter === 'friends') {
      sectionState.empty.textContent =
        'No friend reviews yet. Switch back to everyone to see all community notes.';
    } else if (sectionState.reactionFilter) {
      sectionState.empty.textContent = `No reviews with ${sectionState.reactionFilter} yet. Try another reaction or clear the filter.`;
    } else {
      sectionState.empty.textContent = sectionState.emptyDefaultMessage;
    }
    sectionState.empty.hidden = false;
    return;
  }
  sectionState.empty.hidden = true;

  sortedReviews.forEach((review) => {
    sectionState.list.appendChild(renderReviewItem(review, sectionState));
  });
}

function updateFilterControls(sectionState, stats, myReview, reviews) {
  const controls = sectionState.filterControls;
  if (!controls || !controls.container) {
    return;
  }

  const totalReviews = stats && typeof stats.totalReviews === 'number' ? stats.totalReviews : 0;
  const hasAnyReviews = totalReviews > 0 || (Array.isArray(reviews) && reviews.length > 0);
  controls.container.hidden = !hasAnyReviews;

  const friendButton = controls.friendsButton;
  if (friendButton) {
    const friendReviews = stats && typeof stats.friendReviews === 'number' ? stats.friendReviews : 0;
    const hasFriendReviews =
      friendReviews > 0 || Boolean(myReview && (myReview.isFriend || myReview.isSelf));
    friendButton.disabled = !hasFriendReviews;
    if (hasFriendReviews) {
      friendButton.removeAttribute('aria-disabled');
    } else {
      friendButton.setAttribute('aria-disabled', 'true');
    }
    if (!hasFriendReviews && sectionState.filter === 'friends') {
      sectionState.filter = 'all';
    }
  }

  updateFilterButtonState(sectionState);
}

function updateFilterButtonState(sectionState) {
  const controls = sectionState.filterControls;
  if (!controls) {
    return;
  }
  const active = sectionState.filter === 'friends' ? 'friends' : 'all';
  const { allButton, friendsButton } = controls;
  if (allButton) {
    const isActive = active === 'all';
    allButton.classList.toggle('is-active', isActive);
    allButton.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  }
  if (friendsButton) {
    const isActive = active === 'friends';
    friendsButton.classList.toggle('is-active', isActive);
    friendsButton.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  }
  if (controls.sortButtons) {
    const sortKey = normalizeReviewSort(sectionState.sort);
    Object.entries(controls.sortButtons).forEach(([key, button]) => {
      const isActive = key === sortKey;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }
}

function filterReviewsForDisplay(reviews, filter) {
  if (!Array.isArray(reviews) || reviews.length === 0) {
    return [];
  }
  if (filter === 'friends') {
    return reviews.filter((review) => review && (review.isFriend || review.isSelf));
  }
  return reviews.slice();
}

function filterReviewsByReaction(reviews, reaction) {
  if (!Array.isArray(reviews) || !reaction) {
    return reviews ? reviews.slice() : [];
  }
  return reviews.filter((review) => {
    if (!review || !review.reactions || !review.reactions.totals) {
      return false;
    }
    const count = review.reactions.totals[reaction];
    return Number.isFinite(count) && count > 0;
  });
}

function setSectionFilter(sectionState, nextFilter) {
  if (!sectionState || !sectionState.filterControls) {
    return;
  }
  const normalized = nextFilter === 'friends' ? 'friends' : 'all';
  if (
    normalized === 'friends' &&
    sectionState.filterControls.friendsButton &&
    sectionState.filterControls.friendsButton.disabled
  ) {
    return;
  }
  if (sectionState.filter === normalized) {
    return;
  }
  sectionState.filter = normalized;
  updateFilterButtonState(sectionState);
  const cache = state.reviewCache.get(sectionState.key) || {};
  renderSection(sectionState, cache);
}

function setSectionSort(sectionState, nextSort) {
  if (!sectionState || !sectionState.filterControls) {
    return;
  }
  const normalized = normalizeReviewSort(nextSort);
  if (sectionState.sort === normalized) {
    return;
  }
  sectionState.sort = normalized;
  updateFilterButtonState(sectionState);
  const cache = state.reviewCache.get(sectionState.key) || {};
  renderSection(sectionState, cache);
}

function toggleReactionFilter(sectionState, emoji) {
  if (!sectionState) {
    return;
  }
  const normalized = REVIEW_REACTIONS.includes(emoji) ? emoji : null;
  const next = sectionState.reactionFilter === normalized ? null : normalized;
  if (sectionState.reactionFilter === next) {
    return;
  }
  sectionState.reactionFilter = next;
  const cache = state.reviewCache.get(sectionState.key) || {};
  renderSection(sectionState, cache);
}

function renderReviewItem(review, sectionState) {
  const item = document.createElement('article');
  item.className = 'community-review-item';

  const header = document.createElement('header');
  header.className = 'community-review-header';

  const rawUsername = typeof review.username === 'string' ? review.username : '';
  const normalizedAuthor = canonicalUsername(rawUsername);
  const authorLabel = review.isSelf ? 'You' : rawUsername || 'Unknown reviewer';
  const hiddenReason = isUserBlocked(normalizedAuthor)
    ? 'blocked'
    : isUserMuted(normalizedAuthor)
    ? 'muted'
    : null;
  const hiddenSections = [];

  const author = createInlineProfileLink(rawUsername, {
    label: authorLabel,
    className: 'community-review-author'
  });
  if (author) {
    header.appendChild(author);
  } else {
    const fallback = document.createElement('span');
    fallback.className = 'community-review-author';
    fallback.textContent = authorLabel;
    header.appendChild(fallback);
  }

  const presenceKey = normalizedAuthor;
  const presence = presenceKey && state.presence ? state.presence[presenceKey] : null;
  if (presence && presence.state) {
    const presencePill = document.createElement('span');
    presencePill.className = 'community-presence-pill';
    presencePill.dataset.state = presence.state;
    const statusKey = normalizePresenceStatusPreset(presence.statusPreset || 'default');
    presencePill.dataset.statusPreset = statusKey;
    const preset = PRESENCE_STATUS_PRESET_MAP.get(statusKey);
    let label = 'Online';
    if (presence.state === 'watching' && presence.movieTitle) {
      label = `Watching now: ${presence.movieTitle}`;
    } else if (presence.state === 'away') {
      label = 'Away';
    } else if (preset && preset.key !== 'default') {
      const shortLabel = preset.shortLabel || preset.label;
      label = preset.icon ? `${preset.icon} ${shortLabel}` : shortLabel;
    }
    presencePill.textContent = label;
    header.appendChild(presencePill);
  }

  if (review.isFriend) {
    const friendBadge = document.createElement('span');
    friendBadge.className = 'community-review-badge';
    friendBadge.textContent = 'Friend';
    header.appendChild(friendBadge);
  } else if (review.isSelf) {
    const selfBadge = document.createElement('span');
    selfBadge.className = 'community-review-badge';
    selfBadge.textContent = 'Your review';
    header.appendChild(selfBadge);
    if (review.visibility && review.visibility !== 'public') {
      const visibilityBadge = document.createElement('span');
      visibilityBadge.className = 'community-review-badge community-review-badge--visibility';
      visibilityBadge.textContent = review.visibility === 'friends' ? 'Friends only' : 'Only you';
      header.appendChild(visibilityBadge);
    }
  }

  const rating = document.createElement('span');
  rating.className = 'community-review-rating';
  rating.textContent = formatRating(review.rating);
  header.appendChild(rating);

  const timestamp = document.createElement('span');
  timestamp.className = 'community-review-timestamp';
  timestamp.textContent = formatRelativeTime(review.updatedAt || review.createdAt);
  header.appendChild(timestamp);

  item.appendChild(header);

  let hiddenNotice = null;
  if (hiddenReason) {
    hiddenNotice = createHiddenReviewNotice({
      reason: hiddenReason,
      username: authorLabel,
      onReveal: () => {
        hiddenSections.forEach((element) => {
          if (element) {
            element.hidden = false;
          }
        });
        item.classList.remove('community-review-item--hidden');
      }
    });
    item.classList.add('community-review-item--hidden');
    item.appendChild(hiddenNotice);
  }

  const bodyContainer = document.createElement('div');
  bodyContainer.className = 'community-review-body';
  renderReviewContent(bodyContainer, review);
  if (hiddenReason) {
    bodyContainer.hidden = true;
    hiddenSections.push(bodyContainer);
  }
  item.appendChild(bodyContainer);

  const metaBar = document.createElement('div');
  metaBar.className = 'community-review-meta';
  if (hiddenReason) {
    metaBar.hidden = true;
    hiddenSections.push(metaBar);
  }

  if (!review.isSelf && review.username) {
    const followBtn = document.createElement('button');
    followBtn.type = 'button';
    followBtn.className = 'btn-subtle community-follow-btn';
    updateFollowButtonState(followBtn, review.username);
    followBtn.addEventListener('click', async () => {
      const target = canonicalUsername(review.username);
      if (!target) {
        return;
      }
      const currentlyFollowing = state.following.includes(target);
      followBtn.disabled = true;
      followBtn.classList.add('is-loading');
      try {
        if (currentlyFollowing) {
          await unfollowUserByUsername(target);
          queueToast(`Unfollowed ${review.username}.`);
        } else {
          await followUserByUsername(target);
          queueToast(`Following ${review.username}.`);
        }
      } catch (error) {
        queueToast(
          error instanceof Error ? error.message : 'Unable to update follow status right now.',
          { variant: 'error' }
        );
      } finally {
        followBtn.classList.remove('is-loading');
        updateFollowButtonState(followBtn, review.username);
        followBtn.disabled = false;
      }
    });
    metaBar.appendChild(followBtn);
  }

  const likeMeta = normalizeLikeMeta(review.likes);
  const likeBtn = document.createElement('button');
  likeBtn.type = 'button';
  likeBtn.className = 'btn-subtle community-like-btn';
  if (review.isSelf) {
    likeBtn.disabled = true;
    likeBtn.setAttribute('aria-disabled', 'true');
  }
  updateLikeButtonState(likeBtn, likeMeta);
  likeBtn.addEventListener('click', () => {
    if (!sectionState || !sectionState.movie || review.isSelf) {
      return;
    }
    toggleReviewLike(sectionState, review, likeBtn);
  });
  metaBar.appendChild(likeBtn);

  item.appendChild(metaBar);

  const reactionBar = renderReactionBar(review, sectionState);
  if (reactionBar) {
    if (hiddenReason) {
      reactionBar.hidden = true;
      hiddenSections.push(reactionBar);
    }
    item.appendChild(reactionBar);
  }

  const thread = renderCommentThread(review, sectionState);
  if (thread) {
    if (hiddenReason) {
      thread.hidden = true;
      hiddenSections.push(thread);
    }
    item.appendChild(thread);
  }

  return item;
}

function createHiddenReviewNotice({ reason, username, onReveal }) {
  const wrap = document.createElement('div');
  wrap.className = 'community-review-hidden';
  const text = document.createElement('p');
  text.className = 'community-review-hidden-text';
  const readableName = username && username !== 'You' ? username : 'this member';
  text.textContent =
    reason === 'blocked'
      ? `You blocked ${readableName}. Their review stays hidden unless you show it.`
      : `${readableName} is muted. Their review is hidden.`;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn-subtle community-review-hidden-btn';
  button.textContent = 'Show anyway';
  button.addEventListener('click', () => {
    wrap.remove();
    if (typeof onReveal === 'function') {
      onReveal();
    }
  });
  wrap.appendChild(text);
  wrap.appendChild(button);
  return wrap;
}

function renderReviewContent(container, review) {
  container.innerHTML = '';
  const previewText = review.capsule || review.body || '';
  const hasPreview = Boolean(previewText);
  if (hasPreview) {
    const previewEl = document.createElement('p');
    previewEl.className = 'community-review-text';
    previewEl.textContent = previewText;
    container.appendChild(previewEl);
  }
  const segments = Array.isArray(review.segments) ? review.segments : [];
  const hasExtended = review.fullText && review.fullText !== previewText && segments.length;
  if (hasExtended) {
    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'btn-subtle community-expand-btn';
    expandBtn.textContent = 'Read full review';
    const longWrap = document.createElement('div');
    longWrap.className = 'community-review-full';
    longWrap.hidden = true;
    renderReviewSegments(longWrap, segments);
    expandBtn.addEventListener('click', () => {
      longWrap.hidden = !longWrap.hidden;
      expandBtn.textContent = longWrap.hidden ? 'Read full review' : 'Hide full review';
    });
    container.appendChild(expandBtn);
    container.appendChild(longWrap);
  } else if (review.hasSpoilers && segments.length) {
    const spoilerWrap = document.createElement('div');
    spoilerWrap.className = 'community-review-full';
    renderReviewSegments(spoilerWrap, segments);
    container.appendChild(spoilerWrap);
  }
  if (!hasPreview && !segments.length) {
    const empty = document.createElement('p');
    empty.className = 'community-review-text community-review-text--empty';
    empty.textContent = 'No written thoughts yet.';
    container.appendChild(empty);
  }
}

function renderReviewSegments(container, segments) {
  segments.forEach((segment) => {
    const text = typeof segment.text === 'string' ? segment.text : '';
    if (!text) {
      return;
    }
    const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
    if (segment.spoiler) {
      paragraphs.forEach((paragraph) => {
        const wrap = document.createElement('div');
        wrap.className = 'community-spoiler-block';
        const notice = document.createElement('div');
        notice.className = 'community-spoiler-notice';
        notice.textContent = 'Spoiler hidden';
        const revealBtn = document.createElement('button');
        revealBtn.type = 'button';
        revealBtn.className = 'btn-subtle community-spoiler-btn';
        revealBtn.textContent = 'Reveal';
        const paragraphEl = document.createElement('p');
        paragraphEl.className = 'community-review-text is-spoiler is-hidden';
        paragraphEl.textContent = paragraph;
        revealBtn.addEventListener('click', () => {
          paragraphEl.classList.remove('is-hidden');
          revealBtn.remove();
          notice.textContent = 'Spoiler revealed';
        });
        wrap.appendChild(notice);
        wrap.appendChild(revealBtn);
        wrap.appendChild(paragraphEl);
        container.appendChild(wrap);
      });
    } else {
      paragraphs.forEach((paragraph) => {
        const paragraphEl = document.createElement('p');
        paragraphEl.className = 'community-review-text';
        paragraphEl.textContent = paragraph;
        container.appendChild(paragraphEl);
      });
    }
  });
}

function renderReactionBar(review, sectionState) {
  if (!Array.isArray(REVIEW_REACTIONS) || !REVIEW_REACTIONS.length) {
    return null;
  }
  const summary = review && review.reactions && typeof review.reactions === 'object' ? review.reactions : {};
  const bar = document.createElement('div');
  bar.className = 'community-review-reactions';
  REVIEW_REACTIONS.forEach((emoji) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'community-reaction-btn';
    button.dataset.emoji = emoji;
    const count = summary.totals && Number.isFinite(summary.totals[emoji]) ? Number(summary.totals[emoji]) : 0;
    button.textContent = `${emoji} ${count}`;
    if (summary.mine === emoji) {
      button.classList.add('is-selected');
    }
    if (review.isSelf) {
      button.disabled = true;
    }
    button.addEventListener('click', () => {
      toggleReviewReaction(sectionState, review, emoji, button);
    });
    bar.appendChild(button);
  });
  const tally = document.createElement('span');
  tally.className = 'community-reaction-count';
  const total = Number.isFinite(summary.count) ? Number(summary.count) : 0;
  tally.textContent = `${total} ${total === 1 ? 'reaction' : 'reactions'}`;
  bar.appendChild(tally);
  return bar;
}

function renderCommentThread(review, sectionState) {
  const comments = Array.isArray(review.comments) ? review.comments : [];
  const container = document.createElement('div');
  container.className = 'community-review-thread';
  if (!comments.length) {
    const empty = document.createElement('p');
    empty.className = 'community-thread-empty';
    empty.textContent = 'No replies yet. Start the conversation!';
    container.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'community-comment-list';
    comments.forEach((comment) => {
      const node = renderCommentNode(comment, review, sectionState, 0);
      if (node) {
        list.appendChild(node);
      }
    });
    container.appendChild(list);
  }
  if (state.session && state.session.token) {
    const form = createReplyForm(review, null, sectionState);
    container.appendChild(form);
  }
  return container;
}

function renderCommentNode(comment, review, sectionState, depth) {
  if (!comment || typeof comment !== 'object') {
    return null;
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'community-comment';
  if (depth > 0) {
    wrapper.classList.add('community-comment--nested');
  }
  const header = document.createElement('div');
  header.className = 'community-comment-header';
  const rawUsername = typeof comment.username === 'string' ? comment.username : '';
  const isSelfComment = state.session?.username
    ? rawUsername === state.session.username
    : false;
  const commentLabel = isSelfComment ? 'You' : rawUsername || 'Anonymous';
  let author = createInlineProfileLink(rawUsername, {
    label: commentLabel,
    className: 'community-comment-author'
  });
  if (!author) {
    author = document.createElement('span');
    author.className = 'community-comment-author';
    author.textContent = commentLabel;
  }
  header.appendChild(author);
  const timestamp = document.createElement('span');
  timestamp.className = 'community-comment-timestamp';
  timestamp.textContent = formatRelativeTime(comment.createdAt);
  header.appendChild(timestamp);
  wrapper.appendChild(header);

  const body = document.createElement('p');
  body.className = 'community-comment-body';
  body.textContent = comment.body || '';
  wrapper.appendChild(body);

  if (state.session && state.session.token) {
    const replyBtn = document.createElement('button');
    replyBtn.type = 'button';
    replyBtn.className = 'btn-subtle community-reply-btn';
    replyBtn.textContent = 'Reply';
    let replyForm = null;
    replyBtn.addEventListener('click', () => {
      if (replyForm) {
        replyForm.remove();
        replyForm = null;
        replyBtn.setAttribute('aria-expanded', 'false');
        return;
      }
      replyForm = createReplyForm(review, comment.id, sectionState);
      wrapper.appendChild(replyForm);
      replyBtn.setAttribute('aria-expanded', 'true');
    });
    wrapper.appendChild(replyBtn);
  }

  if (Array.isArray(comment.replies) && comment.replies.length) {
    const childList = document.createElement('div');
    childList.className = 'community-comment-children';
    comment.replies.forEach((reply) => {
      const node = renderCommentNode(reply, review, sectionState, depth + 1);
      if (node) {
        childList.appendChild(node);
      }
    });
    wrapper.appendChild(childList);
  }
  return wrapper;
}

function createReplyForm(review, parentId, sectionState) {
  const form = document.createElement('form');
  form.className = 'community-reply-form';
  const textarea = document.createElement('textarea');
  textarea.className = 'input-base community-reply-input';
  textarea.rows = 2;
  textarea.required = true;
  textarea.placeholder = parentId ? 'Reply to this comment…' : 'Leave a reply…';
  form.appendChild(textarea);
  const promptsRow = createReplyPromptRow(parentId);
  if (promptsRow) {
    form.appendChild(promptsRow);
  }
  const footer = document.createElement('div');
  footer.className = 'community-reply-footer';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn-secondary';
  submit.textContent = 'Post';
  footer.appendChild(submit);
  const status = document.createElement('span');
  status.className = 'community-reply-status';
  status.setAttribute('aria-live', 'polite');
  footer.appendChild(status);
  form.appendChild(footer);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitReviewReply(sectionState, review, textarea, status, parentId);
  });
  return form;
}

async function submitReviewReply(sectionState, review, textarea, statusEl, parentId) {
  if (!state.session || !state.session.token) {
    queueToast('Sign in to reply to community notes.', { variant: 'error' });
    return;
  }
  const message = textarea.value.trim();
  if (!message) {
    statusEl.textContent = 'Enter a reply first.';
    statusEl.dataset.variant = 'error';
    textarea.focus();
    return;
  }
  const payload = normalizeMovieForApi(sectionState.movie);
  const target = canonicalUsername(review.username);
  if (!payload || !target) {
    return;
  }
  statusEl.textContent = 'Posting reply…';
  statusEl.dataset.variant = 'loading';
  try {
    await callSocial('postReviewReply', {
      movie: payload,
      reviewUsername: target,
      reviewId: review.id,
      parentId: parentId || undefined,
      body: message
    });
    textarea.value = '';
    statusEl.textContent = 'Reply posted.';
    statusEl.dataset.variant = 'success';
    await fetchReviews(sectionState.key, sectionState.movie, true, 'reply');
  } catch (error) {
    statusEl.textContent =
      error instanceof Error ? error.message : 'Unable to post that reply right now.';
    statusEl.dataset.variant = 'error';
  }
}

function createReplyPromptRow(parentId) {
  const pool = Array.isArray(THREAD_PROMPTS) ? THREAD_PROMPTS.slice() : [];
  if (!pool.length) {
    return null;
  }
  const promptCount = parentId ? 1 : 2;
  const selection = pickReplyPrompts(promptCount, pool);
  if (!selection.length) {
    return null;
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'community-reply-prompts';
  const label = document.createElement('span');
  label.className = 'community-reply-prompts-label';
  label.textContent = parentId ? 'Keep the thread going:' : 'Need a prompt?';
  wrapper.appendChild(label);
  const list = document.createElement('div');
  list.className = 'community-reply-prompts-list';
  selection.forEach((text) => {
    const chip = document.createElement('span');
    chip.className = 'community-reply-prompt';
    chip.textContent = text;
    list.appendChild(chip);
  });
  wrapper.appendChild(list);
  return wrapper;
}

function pickReplyPrompts(count, pool) {
  if (!Array.isArray(pool) || !pool.length) {
    return [];
  }
  const available = pool.slice();
  const chosen = [];
  while (available.length && chosen.length < count) {
    const index = Math.floor(Math.random() * available.length);
    const [prompt] = available.splice(index, 1);
    if (prompt) {
      chosen.push(prompt);
    }
  }
  return chosen;
}

async function toggleReviewReaction(sectionState, review, emoji, button) {
  if (!state.session || !state.session.token) {
    queueToast('Sign in to react to community notes.', { variant: 'error' });
    return;
  }
  const payload = normalizeMovieForApi(sectionState.movie);
  const target = canonicalUsername(review.username);
  if (!payload || !target) {
    return;
  }
  const currentReaction = review.reactions && review.reactions.mine ? review.reactions.mine : null;
  const removing = currentReaction === emoji;
  if (button) {
    button.disabled = true;
    button.classList.add('is-loading');
  }
  try {
    const action = removing ? 'removeReviewReaction' : 'reactToReview';
    const body = {
      movie: payload,
      reviewUsername: target,
      reviewId: review.id
    };
    if (!removing) {
      body.reaction = emoji;
    }
    await callSocial(action, body);
    await fetchReviews(sectionState.key, sectionState.movie, true, 'reaction');
  } catch (error) {
    queueToast(
      error instanceof Error ? error.message : 'Unable to update reactions right now.',
      { variant: 'error' }
    );
  } finally {
    if (button) {
      button.disabled = false;
      button.classList.remove('is-loading');
    }
  }
}

function updateFollowButtonState(button, username) {
  if (!button) {
    return;
  }
  const normalized = canonicalUsername(username);
  const isFollowing = normalized ? state.following.includes(normalized) : false;
  button.dataset.following = isFollowing ? 'true' : 'false';
  button.textContent = isFollowing ? 'Following' : 'Follow';
  if (isFollowing) {
    button.classList.add('is-active');
    button.setAttribute('aria-pressed', 'true');
  } else {
    button.classList.remove('is-active');
    button.setAttribute('aria-pressed', 'false');
  }
}

function normalizeLikeMeta(likes) {
  if (!likes || typeof likes !== 'object') {
    return { count: 0, hasLiked: false };
  }
  const count = typeof likes.count === 'number' ? likes.count : 0;
  const hasLiked = Boolean(likes.hasLiked);
  return { count, hasLiked };
}

function updateLikeButtonState(button, meta) {
  if (!button) {
    return;
  }
  const normalized = normalizeLikeMeta(meta);
  const countLabel = normalized.count === 1 ? 'Like' : 'Likes';
  button.textContent = `👍 ${normalized.count} ${countLabel}`;
  button.dataset.count = String(normalized.count);
  if (normalized.hasLiked) {
    button.classList.add('is-liked');
    button.setAttribute('aria-pressed', 'true');
  } else {
    button.classList.remove('is-liked');
    button.setAttribute('aria-pressed', 'false');
  }
}

async function toggleReviewLike(sectionState, review, button) {
  if (!state.session || !state.session.token) {
    queueToast('Sign in to react to community notes.', { variant: 'error' });
    return;
  }
  const payload = normalizeMovieForApi(sectionState && sectionState.movie);
  const target = canonicalUsername(review && review.username ? review.username : '');
  if (!payload || !target) {
    return;
  }
  const currentlyLiked = button && button.classList.contains('is-liked');
  if (button) {
    button.disabled = true;
    button.classList.add('is-loading');
  }
  try {
    const response = await callSocial(currentlyLiked ? 'unlikeReview' : 'likeReview', {
      movie: payload,
      reviewUsername: target,
      reviewId: review && review.id ? review.id : review && review.reviewId ? review.reviewId : undefined
    });
    if (response && response.likes) {
      updateLikeButtonState(button, response.likes);
    }
    await fetchReviews(
      sectionState.key,
      sectionState.movie,
      true,
      currentlyLiked ? 'unlike' : 'like'
    );
  } catch (error) {
    queueToast(
      error instanceof Error ? error.message : 'Unable to react to this review right now.',
      { variant: 'error' }
    );
  } finally {
    if (button) {
      button.disabled = false;
      button.classList.remove('is-loading');
    }
  }
}

function renderSummary(sectionState, stats, reviews = []) {
  if (!sectionState.summaryEl) {
    return;
  }

  if (!stats || !stats.totalReviews) {
    sectionState.summaryEl.hidden = true;
    if (sectionState.summaryUpdated) {
      sectionState.summaryUpdated.textContent = '';
      sectionState.summaryUpdated.hidden = true;
    }
    updateCondensedHeader(sectionState, null, reviews);
    updateFriendBadge(sectionState, null);
    return;
  }

  sectionState.summaryEl.hidden = false;

  if (sectionState.summaryOverallValue) {
    sectionState.summaryOverallValue.textContent = formatSummaryScore(stats.averageRating);
  }
  if (sectionState.summaryOverallMeta) {
    const reviewLabel = stats.totalReviews === 1 ? 'review' : 'reviews';
    sectionState.summaryOverallMeta.textContent = `Based on ${stats.totalReviews} ${reviewLabel}`;
  }

  if (sectionState.summaryFriendsValue) {
    sectionState.summaryFriendsValue.textContent = formatSummaryScore(stats.friendAverageRating);
  }
  if (sectionState.summaryFriendsMeta) {
    if (stats.friendReviews > 0) {
      const friendLabel = stats.friendReviews === 1 ? 'friend review' : 'friend reviews';
      sectionState.summaryFriendsMeta.textContent = `${stats.friendReviews} ${friendLabel}`;
    } else {
      sectionState.summaryFriendsMeta.textContent = 'No friend reviews yet';
    }
  }
  if (sectionState.summaryFriendsCard) {
    sectionState.summaryFriendsCard.dataset.empty = stats.friendReviews > 0 ? 'false' : 'true';
  }

  if (sectionState.summaryUpdated) {
    const activityTimestamp = stats.friendLastReviewAt || stats.lastReviewAt;
    if (activityTimestamp) {
      const label = stats.friendLastReviewAt ? 'Friend review' : 'Last activity';
      sectionState.summaryUpdated.textContent = `${label} ${formatRelativeTime(activityTimestamp)}`;
      sectionState.summaryUpdated.hidden = false;
    } else {
      sectionState.summaryUpdated.textContent = '';
      sectionState.summaryUpdated.hidden = true;
    }
  }

  updateCondensedHeader(sectionState, stats, reviews);
  updateFriendBadge(sectionState, stats.friendLastReviewAt || null);
}

function createFilterControls() {
  const container = document.createElement('div');
  container.className = 'community-filter-bar';
  container.hidden = true;

  const filterGroup = document.createElement('div');
  filterGroup.className = 'community-filter-group';
  container.appendChild(filterGroup);

  const label = document.createElement('span');
  label.className = 'community-filter-label';
  label.textContent = 'Show';
  filterGroup.appendChild(label);

  const buttonGroup = document.createElement('div');
  buttonGroup.className = 'community-filter-buttons';
  filterGroup.appendChild(buttonGroup);

  const allButton = document.createElement('button');
  allButton.type = 'button';
  allButton.className = 'community-filter-btn is-active';
  allButton.textContent = 'Everyone';
  allButton.setAttribute('aria-pressed', 'true');
  buttonGroup.appendChild(allButton);

  const friendsButton = document.createElement('button');
  friendsButton.type = 'button';
  friendsButton.className = 'community-filter-btn';
  friendsButton.textContent = 'Friends';
  friendsButton.disabled = true;
  friendsButton.setAttribute('aria-pressed', 'false');
  friendsButton.setAttribute('aria-disabled', 'true');
  buttonGroup.appendChild(friendsButton);

  const sortGroup = document.createElement('div');
  sortGroup.className = 'community-filter-group community-sort-group';
  container.appendChild(sortGroup);

  const sortLabel = document.createElement('span');
  sortLabel.className = 'community-filter-label';
  sortLabel.textContent = 'Sort';
  sortGroup.appendChild(sortLabel);

  const sortButtonsWrap = document.createElement('div');
  sortButtonsWrap.className = 'community-filter-buttons';
  sortGroup.appendChild(sortButtonsWrap);

  const sortButtons = {};
  REVIEW_SORT_OPTIONS.forEach((option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'community-filter-btn';
    button.textContent = option.label;
    button.dataset.sort = option.key;
    const isDefault = option.key === DEFAULT_REVIEW_SORT;
    button.setAttribute('aria-pressed', isDefault ? 'true' : 'false');
    if (isDefault) {
      button.classList.add('is-active');
    }
    sortButtonsWrap.appendChild(button);
    sortButtons[option.key] = button;
  });

  return {
    container,
    label,
    buttonGroup,
    allButton,
    friendsButton,
    sortLabel,
    sortButtonsWrap,
    sortButtons
  };
}

function createReactionSummaryControls() {
  const container = document.createElement('div');
  container.className = 'community-reaction-summary';
  container.hidden = true;

  const label = document.createElement('span');
  label.className = 'community-reaction-summary-label';
  label.textContent = 'Sentiment snapshot';
  container.appendChild(label);

  const buttonsWrap = document.createElement('div');
  buttonsWrap.className = 'community-reaction-summary-buttons';
  container.appendChild(buttonsWrap);

  const buttons = {};
  REVIEW_REACTIONS.forEach((emoji) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'community-reaction-filter-btn';
    button.textContent = `${emoji} ×0`;
    button.disabled = true;
    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('aria-pressed', 'false');
    button.dataset.emoji = emoji;
    buttonsWrap.appendChild(button);
    buttons[emoji] = button;
  });

  return { container, label, buttonsWrap, buttons };
}

function createFriendsHighlight() {
  const container = document.createElement('div');
  container.className = 'community-friends-highlight';
  container.hidden = true;

  const label = document.createElement('span');
  label.className = 'community-friends-highlight-label';
  label.textContent = 'From your friends';
  container.appendChild(label);

  const list = document.createElement('div');
  list.className = 'community-friends-highlight-list';
  container.appendChild(list);

  return { container, label, list };
}

function updateCondensedHeader(sectionState, stats, reviews = []) {
  const container = sectionState.condensedEl;
  const avatars = sectionState.condensedAvatars;
  const overall = sectionState.condensedOverall;
  const friends = sectionState.condensedFriends;
  const activity = sectionState.condensedActivity;
  const hasStats = Boolean(stats && stats.totalReviews);
  const friendHighlight = buildFriendReviewHighlight(reviews);

  if (!hasStats) {
    if (container) {
      container.hidden = false;
      container.dataset.state = 'idle';
    }
    if (overall) {
      overall.textContent = 'Community intel warming up';
    }
    if (avatars) {
      avatars.innerHTML = '';
    }
    if (activity) {
      activity.hidden = false;
      activity.textContent = 'Leave a quick note to start the thread.';
    }
    if (friends) {
      friends.dataset.empty = 'true';
      friends.textContent = 'No friend reviews yet';
    }
    return;
  }

  if (container) {
    container.hidden = false;
    container.dataset.state = 'active';
    if (overall) {
      overall.textContent = `Community ${formatCondensedScore(stats.averageRating)}`;
    }
    if (friends) {
      if (stats.friendReviews > 0) {
        const countLabel = stats.friendReviews === 1 ? '1 friend review' : `${stats.friendReviews} friend reviews`;
        const avgLabel = Number.isFinite(stats.friendAverageRating)
          ? ` • Avg ${formatCondensedScore(stats.friendAverageRating)}`
          : '';
        friends.textContent = `${countLabel}${avgLabel}`;
        friends.dataset.empty = 'false';
      } else {
        friends.textContent = 'No friend reviews yet';
        friends.dataset.empty = 'true';
      }
    }
  }

  if (avatars) {
    const friendName = friendHighlight
      ? formatDisplayNameFromHandle(friendHighlight.username) ||
        (friendHighlight.username ? `@${friendHighlight.username}` : 'A friend')
      : null;
    const decoratedHighlight = friendHighlight
      ? { ...friendHighlight, displayName: friendName }
      : null;
    renderCondensedAvatars(avatars, stats, decoratedHighlight);
  }

  if (activity) {
    const activityTimestamp = stats.friendLastReviewAt || stats.lastReviewAt;
    if (friendHighlight) {
      const friendName =
        formatDisplayNameFromHandle(friendHighlight.username) ||
        (friendHighlight.username ? `@${friendHighlight.username}` : 'A friend');
      const ratingLabel = friendHighlight.ratingLabel || '';
      const extras = friendHighlight.extraCount
        ? ` · +${friendHighlight.extraCount} more friend${friendHighlight.extraCount === 1 ? '' : 's'}`
        : '';
      const timeLabel = friendHighlight.timestamp
        ? ` · ${formatRelativeTime(friendHighlight.timestamp)}`
        : '';
      activity.textContent = `${friendName}${ratingLabel}${extras}${timeLabel}`;
      activity.hidden = false;
    } else if (activityTimestamp) {
      const prefix = stats.friendLastReviewAt ? 'Friend review' : 'Last review';
      activity.textContent = `${prefix} ${formatRelativeTime(activityTimestamp)}`;
      activity.hidden = false;
    } else {
      activity.textContent = '';
      activity.hidden = true;
    }
  }
}

function renderCondensedAvatars(container, stats, friendHighlight) {
  container.innerHTML = '';
  if (friendHighlight) {
    container.appendChild(
      createCondensedAvatar(friendHighlight.displayName || 'Friend', {
        ariaLabel: friendHighlight.displayName || 'Friend review'
      })
    );
    if (friendHighlight.extraCount > 0) {
      container.appendChild(
        createCondensedAvatar(`+${friendHighlight.extraCount}`, {
          variant: 'count',
          ariaLabel: `+${friendHighlight.extraCount} more friend${friendHighlight.extraCount === 1 ? '' : 's'}`
        })
      );
    }
    return;
  }
  if (stats && stats.friendReviews > 0) {
    const label = stats.friendReviews > 9 ? `${Math.min(stats.friendReviews, 9)}+` : String(stats.friendReviews);
    container.appendChild(
      createCondensedAvatar(label, {
        variant: 'count',
        ariaLabel: `${stats.friendReviews} friend reviews`
      })
    );
  }
}

function createCondensedAvatar(label, options = {}) {
  const avatar = document.createElement('span');
  avatar.className = 'movie-community-avatar';
  const variant = options.variant === 'count' ? 'count' : 'initial';
  if (variant === 'count') {
    avatar.classList.add('movie-community-avatar--count');
    avatar.textContent = label;
  } else {
    const initial = getAvatarInitial(label);
    avatar.textContent = initial;
    if (label) {
      avatar.title = label;
    }
  }
  if (options.ariaLabel) {
    avatar.setAttribute('aria-label', options.ariaLabel);
  } else if (label) {
    avatar.setAttribute('aria-label', label);
  }
  return avatar;
}

function getAvatarInitial(label) {
  if (!label) {
    return '?';
  }
  const trimmed = label.trim();
  if (!trimmed) {
    return '?';
  }
  return trimmed.charAt(0).toUpperCase();
}

function buildFriendReviewHighlight(reviews) {
  if (!Array.isArray(reviews) || !reviews.length) {
    return null;
  }
  const friendReviews = reviews.filter((review) => review && review.isFriend);
  if (!friendReviews.length) {
    return null;
  }
  const decorated = friendReviews
    .map((review) => ({ review, timestamp: getReviewTimestamp(review) }))
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const latest = decorated[0];
  const ratingValue =
    typeof latest.review.rating === 'number'
      ? latest.review.rating
      : typeof latest.review.rating === 'string'
      ? Number(latest.review.rating)
      : null;
  const ratingLabel = Number.isFinite(ratingValue)
    ? ` rated ${formatRating(ratingValue)}`
    : ' shared a take';
  return {
    username: latest.review.username || '',
    ratingLabel,
    timestamp: latest.timestamp,
    extraCount: Math.max(friendReviews.length - 1, 0)
  };
}

function getReviewTimestamp(review) {
  if (!review) {
    return null;
  }
  const raw = review.updatedAt || review.createdAt || null;
  if (!raw) {
    return null;
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

function getReviewRatingValue(review) {
  if (!review) {
    return null;
  }
  if (typeof review.rating === 'number') {
    return review.rating;
  }
  if (typeof review.rating === 'string') {
    const parsed = Number(review.rating);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function normalizeReviewSort(value) {
  const requested = typeof value === 'string' ? value : DEFAULT_REVIEW_SORT;
  const found = REVIEW_SORT_OPTIONS.find((option) => option.key === requested);
  return found ? found.key : DEFAULT_REVIEW_SORT;
}

function sortReviewsForDisplay(reviews, sortKey) {
  if (!Array.isArray(reviews)) {
    return [];
  }
  const normalized = normalizeReviewSort(sortKey);
  const list = reviews.slice();
  if (normalized === 'most-liked') {
    return list.sort((a, b) => {
      const likesA = normalizeLikeMeta(a && a.likes).count;
      const likesB = normalizeLikeMeta(b && b.likes).count;
      if (likesA === likesB) {
        return (getReviewTimestamp(b) || 0) - (getReviewTimestamp(a) || 0);
      }
      return likesB - likesA;
    });
  }
  if (normalized === 'top-friends') {
    const friendReviews = [];
    const otherReviews = [];
    list.forEach((review) => {
      if (review && (review.isFriend || review.isSelf)) {
        friendReviews.push(review);
      } else {
        otherReviews.push(review);
      }
    });
    const compareByRating = (a, b) => {
      const ratingA = getReviewRatingValue(a);
      const ratingB = getReviewRatingValue(b);
      if (ratingA === ratingB) {
        return (getReviewTimestamp(b) || 0) - (getReviewTimestamp(a) || 0);
      }
      if (ratingA == null) {
        return 1;
      }
      if (ratingB == null) {
        return -1;
      }
      return ratingB - ratingA;
    };
    friendReviews.sort(compareByRating);
    otherReviews.sort(compareByRating);
    return friendReviews.concat(otherReviews);
  }
  return list.sort((a, b) => (getReviewTimestamp(b) || 0) - (getReviewTimestamp(a) || 0));
}

function computeReactionTotals(reviews) {
  const totals = {};
  REVIEW_REACTIONS.forEach((emoji) => {
    totals[emoji] = 0;
  });
  if (!Array.isArray(reviews)) {
    return totals;
  }
  reviews.forEach((review) => {
    if (!review || !review.reactions || !review.reactions.totals) {
      return;
    }
    REVIEW_REACTIONS.forEach((emoji) => {
      const value = review.reactions.totals[emoji];
      if (Number.isFinite(value)) {
        totals[emoji] += value;
      }
    });
  });
  return totals;
}

function updateReactionSummary(sectionState, reviews) {
  if (!sectionState || !sectionState.reactionSummary) {
    return;
  }
  const summary = sectionState.reactionSummary;
  const totals = computeReactionTotals(reviews);
  const hasAny = REVIEW_REACTIONS.some((emoji) => totals[emoji] > 0);
  if (!hasAny) {
    summary.container.hidden = true;
    if (sectionState.reactionFilter) {
      sectionState.reactionFilter = null;
    }
    Object.values(summary.buttons || {}).forEach((button) => {
      button.textContent = `${button.dataset.emoji} ×0`;
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
      button.setAttribute('aria-pressed', 'false');
      button.classList.remove('is-active');
    });
    return;
  }
  summary.container.hidden = false;
  const activeFilter = sectionState.reactionFilter;
  if (activeFilter && totals[activeFilter] === 0) {
    sectionState.reactionFilter = null;
  }
  REVIEW_REACTIONS.forEach((emoji) => {
    const button = summary.buttons ? summary.buttons[emoji] : null;
    if (!button) {
      return;
    }
    const count = totals[emoji] || 0;
    button.textContent = `${emoji} ×${count}`;
    if (count === 0) {
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
      button.classList.remove('is-active');
      button.setAttribute('aria-pressed', 'false');
    } else {
      button.disabled = false;
      button.removeAttribute('aria-disabled');
      const isActive = sectionState.reactionFilter === emoji;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }
  });
}

function updateFriendsHighlight(sectionState, reviews = []) {
  if (!sectionState || !sectionState.friendsHighlight) {
    return;
  }
  const highlight = sectionState.friendsHighlight;
  if (sectionState.filter === 'friends') {
    highlight.container.hidden = true;
    highlight.list.innerHTML = '';
    return;
  }
  const friendReviews = Array.isArray(reviews)
    ? reviews.filter((review) => review && (review.isFriend || review.isSelf))
    : [];
  if (!friendReviews.length) {
    highlight.container.hidden = true;
    highlight.list.innerHTML = '';
    return;
  }
  const decorated = friendReviews
    .slice()
    .sort((a, b) => (getReviewTimestamp(b) || 0) - (getReviewTimestamp(a) || 0))
    .slice(0, 3);
  highlight.list.innerHTML = '';
  decorated.forEach((review) => {
    const item = document.createElement('div');
    item.className = 'community-friends-highlight-item';
    let author = createInlineProfileLink(review.username, {
      label: formatDisplayNameFromHandle(review.username) || review.username || 'Friend',
      className: 'community-friends-highlight-author'
    });
    if (!author) {
      author = document.createElement('span');
      author.className = 'community-friends-highlight-author';
      author.textContent = formatDisplayNameFromHandle(review.username) || review.username || 'Friend';
    }
    item.appendChild(author);
    const ratingLabel = formatFriendHighlightRating(review);
    if (ratingLabel) {
      const rating = document.createElement('span');
      rating.className = 'community-friends-highlight-rating';
      rating.textContent = ratingLabel;
      item.appendChild(rating);
    }
    const snippet = buildFriendHighlightSnippet(review);
    if (snippet) {
      const quote = document.createElement('span');
      quote.className = 'community-friends-highlight-quote';
      quote.textContent = snippet;
      item.appendChild(quote);
    }
    highlight.list.appendChild(item);
  });
  highlight.container.hidden = false;
}

function formatFriendHighlightRating(review) {
  const value = getReviewRatingValue(review);
  if (!Number.isFinite(value)) {
    return '';
  }
  return `${(Math.round(value * 10) / 10).toFixed(1)}/10`;
}

function buildFriendHighlightSnippet(review) {
  const text = review && typeof review.capsule === 'string' && review.capsule.trim()
    ? review.capsule.trim()
    : review && typeof review.body === 'string'
    ? review.body.trim()
    : '';
  if (!text) {
    return '';
  }
  if (text.length <= 60) {
    return `“${text}”`;
  }
  return `“${text.slice(0, 57).trim()}…”`;
}

function updateFriendBadge(sectionState, friendTimestamp) {
  const badge = sectionState.condensedBadge;
  const wasInitialized = sectionState.friendActivityInitialized;
  let seen = sectionState.friendActivitySeenAt;

  sectionState.lastFriendActivity = friendTimestamp || null;

  if (!wasInitialized) {
    sectionState.friendActivityInitialized = true;
    sectionState.friendActivitySeenAt = friendTimestamp || null;
    seen = sectionState.friendActivitySeenAt;
  }

  if (!badge) {
    return;
  }

  const card = sectionState.container.closest('.movie-card');
  if (card && card.classList.contains('expanded') && friendTimestamp) {
    sectionState.friendActivitySeenAt = friendTimestamp;
    seen = sectionState.friendActivitySeenAt;
  }

  if (!friendTimestamp) {
    badge.hidden = true;
    badge.classList.remove('is-visible');
    badge.removeAttribute('aria-label');
    return;
  }

  let shouldShow = false;
  if (!wasInitialized) {
    shouldShow = false;
  } else if (!seen) {
    shouldShow = true;
  } else if (friendTimestamp > seen) {
    shouldShow = true;
  }

  if (shouldShow) {
    badge.hidden = false;
    badge.classList.add('is-visible');
    badge.setAttribute('aria-label', 'New friend review');
    if (
      sectionState.lastRenderOrigin === 'refresh' &&
      friendTimestamp &&
      sectionState.friendToastAt !== friendTimestamp &&
      sectionState.movie &&
      sectionState.movie.title
    ) {
      queueToast(`New friend review for “${sectionState.movie.title}”.`, { variant: 'success' });
      sectionState.friendToastAt = friendTimestamp;
    }
  } else {
    badge.hidden = true;
    badge.classList.remove('is-visible');
    badge.removeAttribute('aria-label');
  }
}

function createSummaryElements() {
  const container = document.createElement('div');
  container.className = 'community-summary';
  container.hidden = true;

  const grid = document.createElement('div');
  grid.className = 'community-summary-grid';

  const overall = createSummaryCard('All reviewers');
  grid.appendChild(overall.card);

  const friends = createSummaryCard('Friends');
  friends.card.dataset.variant = 'friends';
  friends.metaEl.textContent = 'No friend reviews yet';
  friends.card.dataset.empty = 'true';
  grid.appendChild(friends.card);

  container.appendChild(grid);

  const updated = document.createElement('div');
  updated.className = 'community-summary-updated';
  updated.hidden = true;
  container.appendChild(updated);

  return {
    container,
    overallValue: overall.valueEl,
    overallMeta: overall.metaEl,
    friendCard: friends.card,
    friendValue: friends.valueEl,
    friendMeta: friends.metaEl,
    updated
  };
}

function createSummaryCard(labelText) {
  const card = document.createElement('div');
  card.className = 'community-summary-card';

  const label = document.createElement('div');
  label.className = 'community-summary-label';
  label.textContent = labelText;
  card.appendChild(label);

  const value = document.createElement('div');
  value.className = 'community-summary-value';
  value.textContent = '–';
  card.appendChild(value);

  const meta = document.createElement('div');
  meta.className = 'community-summary-meta';
  card.appendChild(meta);

  return {
    card,
    valueEl: value,
    metaEl: meta
  };
}

function computeReviewStats(reviews) {
  if (!Array.isArray(reviews) || reviews.length === 0) {
    return {
      totalReviews: 0,
      totalRatings: 0,
      averageRating: null,
      friendReviews: 0,
      friendRatings: 0,
      friendAverageRating: null,
      lastReviewAt: null
    };
  }

  let totalReviews = 0;
  let totalRatings = 0;
  let ratingSum = 0;
  let friendReviews = 0;
  let friendRatings = 0;
  let friendRatingSum = 0;
  let lastReviewAt = null;
  let friendLastReviewAt = null;

  reviews.forEach((review) => {
    if (!review) {
      return;
    }
    totalReviews += 1;

    const ratingValue =
      typeof review.rating === 'number'
        ? review.rating
        : typeof review.rating === 'string'
        ? Number(review.rating)
        : null;
    if (Number.isFinite(ratingValue)) {
      totalRatings += 1;
      ratingSum += ratingValue;
      if (review.isFriend) {
        friendRatings += 1;
        friendRatingSum += ratingValue;
      }
    }

    const timestamp = review.updatedAt || review.createdAt || null;
    if (review.isFriend) {
      friendReviews += 1;
      if (timestamp && typeof timestamp === 'string') {
        if (!friendLastReviewAt || timestamp > friendLastReviewAt) {
          friendLastReviewAt = timestamp;
        }
      }
    }
    if (timestamp && typeof timestamp === 'string') {
      if (!lastReviewAt || timestamp > lastReviewAt) {
        lastReviewAt = timestamp;
      }
    }
  });

  return {
    totalReviews,
    totalRatings,
    averageRating: totalRatings ? Math.round((ratingSum / totalRatings) * 10) / 10 : null,
    friendReviews,
    friendRatings,
    friendAverageRating: friendRatings ? Math.round((friendRatingSum / friendRatings) * 10) / 10 : null,
    lastReviewAt,
    friendLastReviewAt
  };
}

function subscribeToReviews(key, callback) {
  let listeners = reviewSubscribers.get(key);
  if (!listeners) {
    listeners = new Set();
    reviewSubscribers.set(key, listeners);
  }
  listeners.add(callback);
  try {
    const cache = state.reviewCache.get(key);
    callback(cache);
  } catch (error) {
    console.warn('Review subscriber error', error);
  }
  return () => {
    const current = reviewSubscribers.get(key);
    if (!current) {
      return;
    }
    current.delete(callback);
    if (current.size === 0) {
      reviewSubscribers.delete(key);
    }
  };
}

function notifyReviewSubscribers(key) {
  const listeners = reviewSubscribers.get(key);
  if (!listeners || !listeners.size) {
    return;
  }
  const cache = state.reviewCache.get(key);
  listeners.forEach((listener) => {
    try {
      listener(cache);
    } catch (error) {
      console.warn('Review subscriber error', error);
    }
  });
}

async function loadFollowing(force = false) {
  if (!state.session || !state.session.token) {
    state.following = [];
    state.followingLoaded = false;
    state.socialOverview = createDefaultSocialOverview();
    notifyFollowingSubscribers();
    notifySocialOverviewSubscribers();
    return;
  }
  if (state.followingLoading && !force) {
    return;
  }
  state.followingLoading = true;
  try {
    const response = await callSocial('listFollowing');
    const overview = normalizeSocialOverview(response);
    state.socialOverview = overview;
    state.following = overview.following.slice();
    applyBlockedUsers(overview.blocked);
    state.presence = overview.presence || {};
    state.badges = Array.isArray(overview.badges) ? overview.badges.slice() : [];
    state.followingLoaded = true;
    notifyFollowingSubscribers();
    notifySocialOverviewSubscribers();
  } catch (error) {
    console.warn('Failed to load following list', error);
  } finally {
    state.followingLoading = false;
  }
}

function notifyFollowingSubscribers() {
  const snapshot = state.following.slice();
  followingSubscribers.forEach((callback) => {
    try {
      callback(snapshot);
    } catch (error) {
      console.warn('Following subscriber error', error);
    }
  });
}

function notifySocialOverviewSubscribers() {
  const snapshot = cloneSocialOverview(state.socialOverview);
  socialOverviewSubscribers.forEach((callback) => {
    try {
      callback(snapshot);
    } catch (error) {
      console.warn('Social overview subscriber error', error);
    }
  });
}

function notifyCollaborativeSubscribers() {
  const snapshot = cloneCollaborativeState(state.collabState);
  collaborativeSubscribers.forEach((callback) => {
    try {
      callback(snapshot);
    } catch (error) {
      console.warn('Collaborative subscriber error', error);
    }
  });
}

function notifyNotificationSubscribers() {
  const payload = {
    notifications: state.notifications.slice(),
    unreadCount: countUnreadNotifications()
  };
  notificationSubscribers.forEach((callback) => {
    try {
      callback(payload);
    } catch (error) {
      console.warn('Notification subscriber error', error);
    }
  });
}

function countUnreadNotifications() {
  return state.notifications.filter((entry) => !entry.readAt).length;
}

async function loadNotifications(force = false) {
  if (!state.session || !state.session.token) {
    return;
  }
  if (state.notificationsLoading && !force) {
    return;
  }
  state.notificationsLoading = true;
  try {
    const response = await callSocial('listNotifications');
    applyNotificationPayload(response);
  } catch (error) {
    console.warn('Failed to load notifications', error);
  } finally {
    state.notificationsLoading = false;
  }
}

function applyNotificationPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return;
  }
  const list = Array.isArray(payload.notifications) ? payload.notifications : [];
  const normalized = list.map((entry) => ({
    id: entry.id || String(Math.random()),
    type: entry.type || 'activity',
    actor: entry.actor || null,
    movieTitle: entry.movieTitle || null,
    movieTmdbId: entry.movieTmdbId || null,
    movieImdbId: entry.movieImdbId || null,
    message: entry.message || '',
    createdAt: entry.createdAt || null,
    readAt: entry.readAt || null
  }));
  const seenBefore = new Set(state.notifications.map((entry) => entry.id));
  const newNotifications = normalized.filter((entry) => !seenBefore.has(entry.id));
  state.notifications = normalized;
  const shouldAnnounce = state.notificationsLoaded;
  state.notificationsLoaded = true;
  newNotifications.forEach((entry) => {
    if (!state.notificationSeen.has(entry.id)) {
      if (entry.message && shouldAnnounce) {
        queueToast(entry.message, { source: 'notification' });
      }
      state.notificationSeen.add(entry.id);
    }
  });
  notifyNotificationSubscribers();
}

function startNotificationPolling() {
  if (state.notificationTimer) {
    window.clearInterval(state.notificationTimer);
    state.notificationTimer = null;
  }
  if (!state.session || !state.session.token) {
    return;
  }
  state.notificationTimer = window.setInterval(() => {
    loadNotifications(true).catch(() => {});
  }, NOTIFICATION_POLL_INTERVAL);
}

function stopNotificationPolling() {
  if (state.notificationTimer) {
    window.clearInterval(state.notificationTimer);
    state.notificationTimer = null;
  }
}

function startNotificationStream() {
  if (!window.EventSource || !state.session || !state.session.token) {
    return;
  }
  if (state.notificationStream) {
    return;
  }
  const url = `/api/social?channel=notifications&token=${encodeURIComponent(state.session.token)}`;
  try {
    const source = new EventSource(url);
    state.notificationStream = source;
    state.notificationRetry = 0;
    source.addEventListener('ready', (event) => {
      try {
        const data = event && event.data ? JSON.parse(event.data) : {};
        if (data && data.presence) {
          state.presence = data.presence;
          state.socialOverview.presence = data.presence;
          if (state.session && state.session.username) {
            const myUsername = canonicalUsername(state.session.username);
            if (myUsername) {
              const entry = data.presence[myUsername];
              const presetKey =
                entry && typeof entry.statusPreset === 'string' ? entry.statusPreset : DEFAULT_PRESENCE_STATUS;
              setLocalPresenceStatusPreset(presetKey);
            }
          }
          notifySocialOverviewSubscribers();
        }
      } catch (error) {
        console.warn('Stream ready parse error', error);
      }
    });
    source.addEventListener('notification', (event) => handleStreamNotification(event));
    source.addEventListener('presence', (event) => handleStreamPresence(event));
    source.onerror = () => {
      stopNotificationStream();
      if (!state.session || !state.session.token) {
        return;
      }
      const delay = Math.min(30000, 2000 * Math.max(1, state.notificationRetry + 1));
      state.notificationRetry += 1;
      window.setTimeout(() => startNotificationStream(), delay);
    };
  } catch (error) {
    console.warn('Failed to open notification stream', error);
  }
}

function stopNotificationStream() {
  if (state.notificationStream) {
    try {
      state.notificationStream.close();
    } catch (error) {
      // ignore
    }
    state.notificationStream = null;
  }
  state.notificationRetry = 0;
}

function handleStreamNotification(event) {
  if (!event || !event.data) {
    return;
  }
  let payload;
  try {
    payload = JSON.parse(event.data);
  } catch (error) {
    console.warn('Invalid notification event payload', error);
    return;
  }
  const entry = payload && payload.notification ? payload.notification : null;
  if (!entry || !entry.id) {
    return;
  }
  const normalized = {
    id: entry.id,
    type: entry.type || 'activity',
    actor: entry.actor || null,
    movieTitle: entry.movieTitle || null,
    movieTmdbId: entry.movieTmdbId || null,
    movieImdbId: entry.movieImdbId || null,
    message: entry.message || '',
    createdAt: entry.createdAt || new Date().toISOString(),
    readAt: entry.readAt || null
  };
  const existingIndex = state.notifications.findIndex((item) => item.id === normalized.id);
  if (existingIndex >= 0) {
    state.notifications[existingIndex] = { ...state.notifications[existingIndex], ...normalized };
  } else {
    state.notifications.unshift(normalized);
  }
  state.notificationsLoaded = true;
  if (!state.notificationSeen.has(normalized.id) && normalized.message) {
    queueToast(normalized.message, { source: 'notification' });
    state.notificationSeen.add(normalized.id);
  }
  notifyNotificationSubscribers();
}

function handleStreamPresence(event) {
  if (!event || !event.data) {
    return;
  }
  try {
    const payload = JSON.parse(event.data);
    const presence = payload && payload.presence ? payload.presence : {};
    state.presence = presence;
    if (state.socialOverview && typeof state.socialOverview === 'object') {
      state.socialOverview.presence = presence;
    }
    if (state.session && state.session.username) {
      const myUsername = canonicalUsername(state.session.username);
      if (myUsername) {
        const entry = presence[myUsername];
        const presetKey = entry && typeof entry.statusPreset === 'string' ? entry.statusPreset : DEFAULT_PRESENCE_STATUS;
        setLocalPresenceStatusPreset(presetKey);
      }
    }
    notifySocialOverviewSubscribers();
  } catch (error) {
    console.warn('Invalid presence event payload', error);
  }
}

function startPresenceTicker() {
  if (!state.session || !state.session.token) {
    return;
  }
  if (state.presenceTicker) {
    return;
  }
  pingPresence('online', { silent: true }).catch(() => {});
  state.presenceTicker = window.setInterval(() => {
    pingPresence('online', { silent: true }).catch(() => {});
  }, 60000);
}

function stopPresenceTicker() {
  if (state.presenceTicker) {
    window.clearInterval(state.presenceTicker);
    state.presenceTicker = null;
  }
}

async function pingPresence(stateLabel = 'online', options = {}) {
  if (!state.session || !state.session.token) {
    return;
  }
  const statusPreset =
    typeof options.statusPreset === 'string'
      ? normalizePresenceStatusPreset(options.statusPreset)
      : getPresenceStatusPreset();
  const payload = { state: stateLabel, statusPreset };
  if (options.movie && typeof options.movie === 'object') {
    payload.movie = options.movie;
  }
  try {
    await callSocial('updatePresence', payload);
  } catch (error) {
    if (!options.silent) {
      throw error;
    }
  }
}

async function loadCollaborativeState() {
  if (!state.session || !state.session.token) {
    state.collabState = {
      lists: { owned: [], shared: [], invites: [] },
      watchParties: { upcoming: [], invites: [] }
    };
    notifyCollaborativeSubscribers();
    return;
  }
  try {
    const response = await callSocial('listCollaborativeState');
    state.collabState = normalizeCollaborativeState(response);
    if (state.socialOverview && typeof state.socialOverview === 'object') {
      state.socialOverview.collaborations = {
        owned: state.collabState.lists.owned.length,
        shared: state.collabState.lists.shared.length,
        invites: state.collabState.lists.invites.length
      };
    }
    notifySocialOverviewSubscribers();
    notifyCollaborativeSubscribers();
  } catch (error) {
    console.warn('Failed to load collaborative state', error);
  }
}

function queueToast(message, options = {}) {
  if (!message) {
    return;
  }
  const host = getToastHost();
  const toast = document.createElement('div');
  toast.className = 'toast';
  const variant = options.variant || 'info';
  toast.dataset.variant = variant;
  toast.textContent = message;
  host.appendChild(toast);
  window.requestAnimationFrame(() => {
    toast.classList.add('is-visible');
  });
  const timeout = typeof options.duration === 'number' ? options.duration : 5000;
  window.setTimeout(() => {
    toast.classList.remove('is-visible');
    window.setTimeout(() => {
      toast.remove();
    }, 300);
  }, timeout);
}

function getToastHost() {
  if (state.toastHost && document.body.contains(state.toastHost)) {
    return state.toastHost;
  }
  const host = document.createElement('div');
  host.className = 'toast-host';
  document.body.appendChild(host);
  state.toastHost = host;
  return host;
}

function normalizeSocialOverview(payload) {
  const rawFollowing = Array.isArray(payload && payload.following) ? payload.following : [];
  const rawFollowers = Array.isArray(payload && payload.followers) ? payload.followers : [];
  const following = Array.from(
    new Set(rawFollowing.map((username) => canonicalUsername(username)).filter(Boolean))
  ).sort();
  const followers = Array.from(
    new Set(rawFollowers.map((username) => canonicalUsername(username)).filter(Boolean))
  ).sort();
  const followingSet = new Set(following);
  const followersSet = new Set(followers);
  const rawMutual = Array.isArray(payload && payload.mutualFollowers)
    ? payload.mutualFollowers
    : [];
  const mutualFollowers = rawMutual.length
    ? Array.from(
        new Set(
          rawMutual
            .map((username) => canonicalUsername(username))
            .filter((username) => username && (followingSet.has(username) || followersSet.has(username)))
        )
      ).sort()
    : following.filter((username) => followersSet.has(username));
  const countsPayload = payload && payload.counts ? payload.counts : {};
  const counts = {
    following: Number.isFinite(countsPayload.following)
      ? Number(countsPayload.following)
      : following.length,
    followers: Number.isFinite(countsPayload.followers)
      ? Number(countsPayload.followers)
      : followers.length,
    mutual: Number.isFinite(countsPayload.mutual)
      ? Number(countsPayload.mutual)
      : mutualFollowers.length
  };
  const rawSuggestions = Array.isArray(payload && payload.suggestions) ? payload.suggestions : [];
  const suggestions = rawSuggestions
    .map((entry) => normalizeSocialSuggestion(entry, followersSet, followingSet))
    .filter(Boolean);
  const presence = payload && typeof payload.presence === 'object' && payload.presence ? payload.presence : {};
  const badges = Array.isArray(payload && payload.badges)
    ? payload.badges
        .map((badge) => {
          if (!badge || typeof badge !== 'object') {
            return null;
          }
          return {
            key: String(badge.key || '').trim() || canonicalUsername(badge.label || ''),
            label: badge.label || '',
            description: badge.description || ''
          };
        })
        .filter((badge) => badge && badge.label)
    : [];
  const collabRaw = payload && typeof payload.collaborations === 'object' ? payload.collaborations : {};
  const collaborations = {
    owned: Number.isFinite(collabRaw.owned) ? Number(collabRaw.owned) : 0,
    shared: Number.isFinite(collabRaw.shared) ? Number(collabRaw.shared) : 0,
    invites: Number.isFinite(collabRaw.invites) ? Number(collabRaw.invites) : 0
  };
  const blocked = Array.isArray(payload && payload.blocked)
    ? payload.blocked.map((handle) => canonicalUsername(handle)).filter(Boolean)
    : [];
  return {
    following,
    followers,
    mutualFollowers,
    counts,
    suggestions,
    presence,
    badges,
    collaborations,
    blocked
  };
}

function normalizeSocialSuggestion(entry, followersSet, followingSet) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const username = canonicalUsername(entry.username);
  if (!username || followingSet.has(username)) {
    return null;
  }
  const displayName = typeof entry.displayName === 'string' && entry.displayName.trim()
    ? entry.displayName.trim()
    : formatDisplayNameFromHandle(username);
  const tagline = typeof entry.tagline === 'string' ? entry.tagline.trim() : '';
  const reason = typeof entry.reason === 'string' ? entry.reason.trim() : '';
  const sharedInterests = Array.isArray(entry.sharedInterests)
    ? entry.sharedInterests
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
    : [];
  const sharedFavorites = Array.isArray(entry.sharedFavorites)
    ? entry.sharedFavorites
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
    : [];
  const mutualFollowers = Array.isArray(entry.mutualFollowers)
    ? Array.from(
        new Set(
          entry.mutualFollowers
            .map((value) => canonicalUsername(value))
            .filter((value) => value && (followersSet.has(value) || followingSet.has(value)))
        )
      ).sort()
    : [];
  const followsYou = entry.followsYou === true || followersSet.has(username);
  return {
    username,
    displayName,
    tagline,
    sharedInterests,
    sharedFavorites,
    mutualFollowers,
    followsYou,
    reason
  };
}

function normalizeCollaborativeState(payload) {
  const listsRaw = payload && typeof payload.lists === 'object' ? payload.lists : {};
  const watchPartiesRaw = payload && typeof payload.watchParties === 'object' ? payload.watchParties : {};
  return {
    lists: {
      owned: Array.isArray(listsRaw.owned) ? listsRaw.owned.map(normalizeCollaborativeListSummary).filter(Boolean) : [],
      shared: Array.isArray(listsRaw.shared) ? listsRaw.shared.map(normalizeCollaborativeListSummary).filter(Boolean) : [],
      invites: Array.isArray(listsRaw.invites) ? listsRaw.invites.map(normalizeCollaborativeInvite).filter(Boolean) : []
    },
    watchParties: {
      upcoming: Array.isArray(watchPartiesRaw.upcoming)
        ? watchPartiesRaw.upcoming.map(normalizeWatchPartySummary).filter(Boolean)
        : [],
      invites: Array.isArray(watchPartiesRaw.invites)
        ? watchPartiesRaw.invites.map(normalizeWatchPartySummary).filter(Boolean)
        : []
    }
  };
}

function normalizeCollaborativeListSummary(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  return {
    id: entry.id,
    name: entry.name || 'Untitled list',
    description: entry.description || '',
    role: entry.role || 'viewer',
    owner: entry.owner || '',
    movieCount: Number.isFinite(entry.movieCount) ? Number(entry.movieCount) : 0,
    collaborators: Array.isArray(entry.collaborators) ? entry.collaborators.slice() : [],
    pendingInvites: Array.isArray(entry.pendingInvites) ? entry.pendingInvites.slice() : [],
    updatedAt: entry.updatedAt || null,
    createdAt: entry.createdAt || null,
    visibility: entry.visibility || 'friends',
    preview: Array.isArray(entry.preview)
      ? entry.preview.map((item) => ({
          tmdbId: item.tmdbId || null,
          imdbId: item.imdbId || null,
          title: item.title || '',
          addedBy: item.addedBy || null,
          addedAt: item.addedAt || null
        }))
      : [],
    voteHighlights: Array.isArray(entry.voteHighlights)
      ? entry.voteHighlights.map(normalizeCollaborativeVoteHighlight).filter(Boolean)
      : [],
    discussionPreview: Array.isArray(entry.discussionPreview)
      ? entry.discussionPreview.map(normalizeCollaborativeDiscussionMessage).filter(Boolean)
      : [],
    discussionCount: Number.isFinite(entry.discussionCount) ? Number(entry.discussionCount) : 0
  };
}

function normalizeCollaborativeVoteHighlight(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const tmdbId = normalizeId(entry.tmdbId || entry.movieTmdbId || entry.id);
  if (!tmdbId) {
    return null;
  }
  return {
    tmdbId,
    title: entry.title || 'Untitled pick',
    yesCount: Number.isFinite(entry.yesCount) ? Number(entry.yesCount) : 0,
    noCount: Number.isFinite(entry.noCount) ? Number(entry.noCount) : 0,
    score: Number.isFinite(entry.score) ? Number(entry.score) : 0,
    myVote: entry.myVote === 'no' ? 'no' : entry.myVote === 'yes' ? 'yes' : null
  };
}

function normalizeCollaborativeDiscussionMessage(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const id = entry.id || entry.messageId || null;
  const username = entry.username || entry.author || null;
  const body = typeof entry.body === 'string' ? entry.body : '';
  if (!id || !username || !body.trim()) {
    return null;
  }
  return {
    id,
    username,
    body: body.trim(),
    createdAt: entry.createdAt || entry.timestamp || null
  };
}

function normalizeCollaborativeInvite(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  return {
    id: entry.id,
    name: entry.name || 'Untitled list',
    owner: entry.owner || '',
    invitedAt: entry.invitedAt || null,
    description: entry.description || ''
  };
}

function normalizeWatchPartySummary(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  return {
    id: entry.id,
    host: entry.host || '',
    movie: entry.movie || { title: '', tmdbId: null, imdbId: null },
    scheduledFor: entry.scheduledFor || null,
    createdAt: entry.createdAt || null,
    note: entry.note || '',
    response: entry.response || 'pending',
    invitees: Array.isArray(entry.invitees) ? entry.invitees.slice() : []
  };
}

function cloneSocialOverview(overview) {
  if (!overview || typeof overview !== 'object') {
    return createDefaultSocialOverview();
  }
  return {
    following: Array.isArray(overview.following) ? overview.following.slice() : [],
    followers: Array.isArray(overview.followers) ? overview.followers.slice() : [],
    mutualFollowers: Array.isArray(overview.mutualFollowers)
      ? overview.mutualFollowers.slice()
      : [],
    counts: {
      following: Number.isFinite(overview.counts && overview.counts.following)
        ? Number(overview.counts.following)
        : Array.isArray(overview.following)
        ? overview.following.length
        : 0,
      followers: Number.isFinite(overview.counts && overview.counts.followers)
        ? Number(overview.counts.followers)
        : Array.isArray(overview.followers)
        ? overview.followers.length
        : 0,
      mutual: Number.isFinite(overview.counts && overview.counts.mutual)
        ? Number(overview.counts.mutual)
        : Array.isArray(overview.mutualFollowers)
        ? overview.mutualFollowers.length
        : 0
    },
    suggestions: Array.isArray(overview.suggestions)
      ? overview.suggestions.map((entry) => ({
          username: entry.username,
          displayName: entry.displayName,
          tagline: entry.tagline,
          sharedInterests: Array.isArray(entry.sharedInterests)
            ? entry.sharedInterests.slice()
            : [],
          sharedFavorites: Array.isArray(entry.sharedFavorites)
            ? entry.sharedFavorites.slice()
            : [],
          sharedWatchHistory: Array.isArray(entry.sharedWatchHistory)
            ? entry.sharedWatchHistory.slice()
            : [],
          sharedWatchParties: Array.isArray(entry.sharedWatchParties)
            ? entry.sharedWatchParties.slice()
            : [],
          mutualFollowers: Array.isArray(entry.mutualFollowers)
            ? entry.mutualFollowers.slice()
            : [],
          followsYou: Boolean(entry.followsYou),
          reason: entry.reason || ''
        }))
      : [],
    presence:
      overview.presence && typeof overview.presence === 'object'
        ? { ...overview.presence }
        : {},
    badges: Array.isArray(overview.badges)
      ? overview.badges.map((badge) => ({
          key: badge.key,
          label: badge.label,
          description: badge.description
        }))
      : [],
    collaborations:
      overview.collaborations && typeof overview.collaborations === 'object'
        ? {
            owned: Number.isFinite(overview.collaborations.owned)
              ? Number(overview.collaborations.owned)
              : 0,
            shared: Number.isFinite(overview.collaborations.shared)
              ? Number(overview.collaborations.shared)
              : 0,
            invites: Number.isFinite(overview.collaborations.invites)
              ? Number(overview.collaborations.invites)
              : 0
          }
        : { owned: 0, shared: 0, invites: 0 }
  };
}

function cloneCollaborativeState(collabState) {
  if (!collabState || typeof collabState !== 'object') {
    return {
      lists: { owned: [], shared: [], invites: [] },
      watchParties: { upcoming: [], invites: [] }
    };
  }
  const mapList = (entry) => ({
    ...entry,
    collaborators: Array.isArray(entry.collaborators) ? entry.collaborators.slice() : [],
    pendingInvites: Array.isArray(entry.pendingInvites) ? entry.pendingInvites.slice() : [],
    preview: Array.isArray(entry.preview)
      ? entry.preview.map((item) => ({ ...item }))
      : []
  });
  return {
    lists: {
      owned: Array.isArray(collabState.lists?.owned)
        ? collabState.lists.owned.map(mapList)
        : [],
      shared: Array.isArray(collabState.lists?.shared)
        ? collabState.lists.shared.map(mapList)
        : [],
      invites: Array.isArray(collabState.lists?.invites)
        ? collabState.lists.invites.map((entry) => ({ ...entry }))
        : []
    },
    watchParties: {
      upcoming: Array.isArray(collabState.watchParties?.upcoming)
        ? collabState.watchParties.upcoming.map((entry) => ({
            ...entry,
            movie: entry.movie ? { ...entry.movie } : { title: '', tmdbId: null, imdbId: null },
            invitees: Array.isArray(entry.invitees)
              ? entry.invitees.map((invite) => ({
                  ...invite,
                  bringing: typeof invite.bringing === 'string' ? invite.bringing : ''
                }))
              : []
          }))
        : [],
      invites: Array.isArray(collabState.watchParties?.invites)
        ? collabState.watchParties.invites.map((entry) => ({
            ...entry,
            movie: entry.movie ? { ...entry.movie } : { title: '', tmdbId: null, imdbId: null },
            invitees: Array.isArray(entry.invitees)
              ? entry.invitees.map((invite) => ({
                  ...invite,
                  bringing: typeof invite.bringing === 'string' ? invite.bringing : ''
                }))
              : []
          }))
        : []
    }
  };
}

function createDefaultSocialOverview() {
  return {
    following: [],
    followers: [],
    mutualFollowers: [],
    counts: {
      following: 0,
      followers: 0,
      mutual: 0
    },
    suggestions: [],
    presence: {},
    badges: [],
    collaborations: { owned: 0, shared: 0, invites: 0 },
    blocked: []
  };
}

function formatDisplayNameFromHandle(handle) {
  if (!handle) {
    return '';
  }
  return handle
    .replace(/[_\-.]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => toTitleCase(part))
    .join(' ');
}

function toTitleCase(value) {
  if (!value) {
    return '';
  }
  const lower = value.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function normalizeMovieForApi(movie) {
  if (!movie || typeof movie !== 'object') {
    return null;
  }
  const tmdbId = normalizeId(movie.tmdbId || movie.tmdbID || movie.id);
  const title = typeof movie.title === 'string' ? movie.title : movie.movieTitle || '';
  if (!tmdbId || !title) {
    return null;
  }
  return {
    tmdbId,
    imdbId: movie.imdbId || movie.imdbID || null,
    title
  };
}

function rerenderVisibleSections() {
  state.sections.forEach((section) => {
    if (section.visible) {
      const cache = state.reviewCache.get(section.key) || {};
      renderSection(section, cache);
    }
  });
}

function refreshAllSections() {
  state.sections.forEach((section) => {
    if (section.visible) {
      fetchReviews(section.key, section.movie, true, 'refresh');
    }
  });
  loadNotifications(true).catch(() => {});
}

async function callSocial(action, payload = {}) {
  if (!state.session || !state.session.token) {
    throw new Error('Sign in to use social features.');
  }
  const body = { action, ...payload, token: state.session.token };
  let response;
  try {
    response = await fetch(SOCIAL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${state.session.token}`
      },
      body: JSON.stringify(body)
    });
  } catch (error) {
    throw new Error('Unable to reach the social service. Check your connection.');
  }
  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }
  if (!response.ok) {
    const message = data && data.error ? data.error : 'Social request failed.';
    throw new Error(message);
  }
  return data || {};
}

function canonicalUsername(username) {
  if (typeof username !== 'string') {
    return '';
  }
  return username.trim().toLowerCase();
}

function normalizeId(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value).trim();
  return str;
}

function formatCondensedScore(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '–';
  }
  const number = Math.max(0, Math.min(10, Number(value)));
  return (Math.round(number * 10) / 10).toFixed(1);
}

function formatSummaryScore(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '–';
  }
  const number = Math.max(0, Math.min(10, Number(value)));
  const rounded = (Math.round(number * 10) / 10).toFixed(1);
  return `${rounded} / 10`;
}

function formatRating(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '–';
  }
  const number = Math.max(0, Math.min(10, Number(value)));
  return `${(Math.round(number * 10) / 10).toFixed(1)} / 10`;
}

function formatRelativeTime(timestamp) {
  if (!timestamp) {
    return '';
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) {
    return 'moments ago';
  }
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 60) {
    return 'moments ago';
  }
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes} min ago`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} hr ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
