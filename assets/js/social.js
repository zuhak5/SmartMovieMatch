import { loadSession, subscribeToSession } from './auth.js';

const SOCIAL_ENDPOINT = '/api/social';
const MAX_REVIEW_LENGTH = 600;

const state = {
  session: loadSession(),
  following: [],
  followingLoaded: false,
  followingLoading: false,
  sections: new Set(),
  reviewCache: new Map()
};

const followingSubscribers = new Set();
const reviewSubscribers = new Map();

subscribeToSession((session) => {
  state.session = session;
  const hasSession = Boolean(session && session.token);
  if (!hasSession) {
    state.following = [];
    state.followingLoaded = false;
    state.followingLoading = false;
    state.reviewCache.clear();
    notifyFollowingSubscribers();
    state.sections.forEach((section) => hideSection(section));
    return;
  }
  state.followingLoaded = false;
  state.followingLoading = false;
  loadFollowing().catch(() => {});
  state.sections.forEach((section) => showSection(section));
});

export function initSocialFeatures() {
  if (state.session && state.session.token && !state.followingLoaded && !state.followingLoading) {
    loadFollowing().catch(() => {});
  }
}

export function buildCommunitySection(movieContext) {
  const tmdbId = normalizeId(movieContext && movieContext.tmdbId);
  const title = typeof movieContext?.title === 'string' ? movieContext.title : '';
  if (!tmdbId || !title) {
    return null;
  }

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
    summaryEl: summary.container,
    summaryOverallValue: summary.overallValue,
    summaryOverallMeta: summary.overallMeta,
    summaryFriendsCard: summary.friendCard,
    summaryFriendsValue: summary.friendValue,
    summaryFriendsMeta: summary.friendMeta,
    summaryUpdated: summary.updated,
    list,
    empty,
    loadingIndicator,
    errorMessage,
    visible: false,
    unsubscribe: null
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await handleSubmit(sectionState);
  });

  state.sections.add(sectionState);
  if (state.session && state.session.token) {
    showSection(sectionState);
  }

  section.addEventListener('DOMNodeRemoved', () => {
    if (sectionState.unsubscribe) {
      sectionState.unsubscribe();
      sectionState.unsubscribe = null;
    }
    state.sections.delete(sectionState);
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
  ensureReviewsLoaded(sectionState.key, sectionState.movie);
}

async function ensureReviewsLoaded(key, movie, force = false) {
  const cache = state.reviewCache.get(key);
  if (!force && cache && !cache.loading) {
    return;
  }
  await fetchReviews(key, movie, force);
}

async function fetchReviews(key, movie, force = false) {
  if (!state.session || !state.session.token) {
    return;
  }
  let cache = state.reviewCache.get(key);
  if (!cache) {
    cache = { loading: false, error: null, reviews: [], myReview: null, stats: null };
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
    stats = null
  } = data;

  if (loading) {
    sectionState.loadingIndicator.hidden = false;
  } else {
    sectionState.loadingIndicator.hidden = true;
  }

  sectionState.errorMessage.textContent = error ? String(error) : '';
  sectionState.errorMessage.hidden = !error;

  const summaryStats = stats || computeReviewStats(reviews);
  renderSummary(sectionState, summaryStats);

  if (myReview) {
    sectionState.ratingInput.value = myReview.rating != null ? String(myReview.rating) : '';
    sectionState.textArea.value = myReview.body || '';
    sectionState.spoilerInput.checked = Boolean(myReview.hasSpoilers);
  }

  sectionState.list.innerHTML = '';
  if (!reviews.length) {
    sectionState.empty.hidden = false;
    return;
  }
  sectionState.empty.hidden = true;

  reviews.forEach((review) => {
    sectionState.list.appendChild(renderReviewItem(review));
  });
}

function renderReviewItem(review) {
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
    if (stats.lastReviewAt) {
      sectionState.summaryUpdated.textContent = `Last activity ${formatRelativeTime(stats.lastReviewAt)}`;
      sectionState.summaryUpdated.hidden = false;
    } else {
      sectionState.summaryUpdated.textContent = '';
      sectionState.summaryUpdated.hidden = true;
    }
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

    if (review.isFriend) {
      friendReviews += 1;
    }

    const timestamp = review.updatedAt || review.createdAt || null;
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
    lastReviewAt
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

function refreshAllSections() {
  state.sections.forEach((section) => {
    if (section.visible) {
      fetchReviews(section.key, section.movie, true);
    }
  });
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
