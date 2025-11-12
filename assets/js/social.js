import { loadSession, subscribeToSession } from './auth.js';

const SOCIAL_ENDPOINT = '/api/social';
const MAX_REVIEW_LENGTH = 600;

const NOTIFICATION_POLL_INTERVAL = 45000;

const state = {
  session: loadSession(),
  following: [],
  followingLoaded: false,
  followingLoading: false,
  sections: new Set(),
  sectionsByKey: new Map(),
  reviewCache: new Map(),
  notifications: [],
  notificationsLoaded: false,
  notificationsLoading: false,
  notificationTimer: null,
  notificationSeen: new Set(),
  toastHost: null
};

const followingSubscribers = new Set();
const reviewSubscribers = new Map();
const notificationSubscribers = new Set();

subscribeToSession((session) => {
  state.session = session;
  const hasSession = Boolean(session && session.token);
  if (!hasSession) {
    state.following = [];
    state.followingLoaded = false;
    state.followingLoading = false;
    state.reviewCache.clear();
    state.notifications = [];
    state.notificationsLoaded = false;
    state.notificationsLoading = false;
    state.notificationSeen.clear();
    stopNotificationPolling();
    notifyNotificationSubscribers();
    notifyFollowingSubscribers();
    state.sections.forEach((section) => hideSection(section));
    return;
  }
  state.followingLoaded = false;
  state.followingLoading = false;
  loadFollowing().catch(() => {});
  state.notificationsLoaded = false;
  state.notificationsLoading = false;
  loadNotifications().catch(() => {});
  startNotificationPolling();
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
  form.appendChild(flagsRow);
  form.appendChild(submitRow);
  section.appendChild(form);

  const filterControls = createFilterControls();
  section.appendChild(filterControls.container);

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
    spoilerInput,
    submitBtn,
    statusEl,
    filter: 'all',
    filterControls,
    summaryEl: summary.container,
    summaryOverallValue: summary.overallValue,
    summaryOverallMeta: summary.overallMeta,
    summaryFriendsCard: summary.friendCard,
    summaryFriendsValue: summary.friendValue,
    summaryFriendsMeta: summary.friendMeta,
    summaryUpdated: summary.updated,
    condensedEl: condensedContainer,
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

export async function followUserByUsername(username) {
  const normalized = canonicalUsername(username);
  if (!normalized) {
    throw new Error('Enter a username to follow.');
  }
  await callSocial('followUser', { target: normalized });
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

export function getFollowingSnapshot() {
  return state.following.slice();
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

  sectionState.submitBtn.disabled = true;
  sectionState.statusEl.textContent = 'Saving your review…';
  sectionState.statusEl.dataset.variant = 'loading';

  try {
    await callSocial('upsertReview', {
      movie: sectionState.movie,
      review: {
        rating: ratingNumber,
        body: sectionState.textArea.value.trim(),
        hasSpoilers: sectionState.spoilerInput.checked
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
  renderSummary(sectionState, summaryStats);
  updateFilterControls(sectionState, summaryStats, myReview, reviews);

  if (myReview) {
    sectionState.ratingInput.value = myReview.rating != null ? String(myReview.rating) : '';
    sectionState.textArea.value = myReview.body || '';
    sectionState.spoilerInput.checked = Boolean(myReview.hasSpoilers);
  }

  sectionState.list.innerHTML = '';
  const filteredReviews = filterReviewsForDisplay(reviews, sectionState.filter);

  if (!filteredReviews.length) {
    const hasAnyReviews = reviews.length > 0;
    if (!hasAnyReviews) {
      sectionState.empty.textContent = sectionState.emptyDefaultMessage;
    } else if (sectionState.filter === 'friends') {
      sectionState.empty.textContent =
        'No friend reviews yet. Switch back to everyone to see all community notes.';
    } else {
      sectionState.empty.textContent = sectionState.emptyDefaultMessage;
    }
    sectionState.empty.hidden = false;
    return;
  }
  sectionState.empty.hidden = true;

  filteredReviews.forEach((review) => {
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

function renderReviewItem(review, sectionState) {
  const item = document.createElement('article');
  item.className = 'community-review-item';

  const header = document.createElement('div');
  header.className = 'community-review-header';

  const name = document.createElement('span');
  name.className = 'community-review-author';
  name.textContent = review.isSelf ? 'You' : review.username;
  header.appendChild(name);

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

  const actions = document.createElement('div');
  actions.className = 'community-review-actions';

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
    actions.appendChild(followBtn);
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
  actions.appendChild(likeBtn);

  item.appendChild(actions);

  if (review.body) {
    if (review.hasSpoilers) {
      const spoilerWrap = document.createElement('div');
      spoilerWrap.className = 'community-spoiler-wrap';
      const notice = document.createElement('div');
      notice.className = 'community-spoiler-notice';
      notice.textContent = 'Spoiler hidden';
      const revealBtn = document.createElement('button');
      revealBtn.type = 'button';
      revealBtn.className = 'btn-subtle community-spoiler-btn';
      revealBtn.textContent = 'Reveal spoilers';
      const body = document.createElement('p');
      body.className = 'community-review-text is-spoiler is-hidden';
      body.textContent = review.body;
      revealBtn.addEventListener('click', () => {
        body.classList.remove('is-hidden');
        revealBtn.remove();
        notice.textContent = 'Spoiler revealed';
      });
      spoilerWrap.appendChild(notice);
      spoilerWrap.appendChild(revealBtn);
      spoilerWrap.appendChild(body);
      item.appendChild(spoilerWrap);
    } else {
      const body = document.createElement('p');
      body.className = 'community-review-text';
      body.textContent = review.body;
      item.appendChild(body);
    }
  }

  return item;
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

function renderSummary(sectionState, stats) {
  if (!sectionState.summaryEl) {
    return;
  }

  if (!stats || !stats.totalReviews) {
    sectionState.summaryEl.hidden = true;
    if (sectionState.summaryUpdated) {
      sectionState.summaryUpdated.textContent = '';
      sectionState.summaryUpdated.hidden = true;
    }
    updateCondensedHeader(sectionState, null);
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

  updateCondensedHeader(sectionState, stats);
  updateFriendBadge(sectionState, stats.friendLastReviewAt || null);
}

function createFilterControls() {
  const container = document.createElement('div');
  container.className = 'community-filter-bar';
  container.hidden = true;

  const label = document.createElement('span');
  label.className = 'community-filter-label';
  label.textContent = 'Show';
  container.appendChild(label);

  const buttonGroup = document.createElement('div');
  buttonGroup.className = 'community-filter-buttons';
  container.appendChild(buttonGroup);

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

  return { container, label, buttonGroup, allButton, friendsButton };
}

function updateCondensedHeader(sectionState, stats) {
  const container = sectionState.condensedEl;
  const overall = sectionState.condensedOverall;
  const friends = sectionState.condensedFriends;
  const activity = sectionState.condensedActivity;
  const hasStats = Boolean(stats && stats.totalReviews);

  if (!hasStats) {
    if (container) {
      container.hidden = true;
    }
    if (activity) {
      activity.hidden = true;
      activity.textContent = '';
    }
    if (friends) {
      friends.dataset.empty = 'true';
    }
    return;
  }

  if (container) {
    container.hidden = false;
    if (overall) {
      overall.textContent = `Community ${formatCondensedScore(stats.averageRating)}`;
    }
    if (friends) {
      if (stats.friendReviews > 0) {
        friends.textContent = `Friends ${formatCondensedScore(stats.friendAverageRating)}`;
        friends.dataset.empty = 'false';
      } else {
        friends.textContent = 'Friends —';
        friends.dataset.empty = 'true';
      }
    }
  }

  if (activity) {
    const activityTimestamp = stats.friendLastReviewAt || stats.lastReviewAt;
    if (activityTimestamp) {
      const prefix = stats.friendLastReviewAt ? 'Friend review' : 'Last review';
      activity.textContent = `${prefix} ${formatRelativeTime(activityTimestamp)}`;
      activity.hidden = false;
    } else {
      activity.textContent = '';
      activity.hidden = true;
    }
  }
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
    notifyFollowingSubscribers();
    return;
  }
  if (state.followingLoading && !force) {
    return;
  }
  state.followingLoading = true;
  try {
    const response = await callSocial('listFollowing');
    const list = Array.isArray(response.following) ? response.following : [];
    state.following = list.map((username) => canonicalUsername(username)).filter(Boolean).sort();
    state.followingLoaded = true;
    notifyFollowingSubscribers();
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
