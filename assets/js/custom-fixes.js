import { logoutSession } from './auth.js';
import {
  subscribeToFollowing,
  followUserByUsername,
  unfollowUserByUsername
} from './social.js';

function initCustomFixes() {
  enhanceLogoutButtons();
  wireFollowButtons();
  subscribeToFollowing((following) => {
    const lower = following.map((handle) => String(handle || '').toLowerCase());
    document.querySelectorAll('[data-follow-action]').forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) {
        return;
      }
      const username = (button.getAttribute('data-username') || '').trim().toLowerCase();
      if (!username) {
        return;
      }
      const isFollowing = lower.includes(username);
      button.dataset.following = isFollowing ? 'true' : 'false';
      const followingLabel = button.dataset.followingLabel || button.dataset.unfollowLabel;
      const followLabel = button.dataset.followLabel || button.textContent?.trim() || 'Follow';
      button.textContent = isFollowing ? followingLabel || 'Following' : followLabel || 'Follow';
    });
  });
  const observer = new MutationObserver(() => {
    wireFollowButtons();
    enhanceLogoutButtons();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function enhanceLogoutButtons() {
  const buttons = document.querySelectorAll('[data-action="logout"], [data-global-signout="true"]');
  buttons.forEach((button) => {
    if (!(button instanceof HTMLElement) || button.dataset.customLogoutBound === 'true') {
      return;
    }
    button.dataset.customLogoutBound = 'true';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      logoutSession();
      try {
        window.localStorage?.removeItem('smartMovieMatch.sessionCache');
      } catch (_) {
        // Ignore storage errors.
      }
      window.location.assign('index.html');
    });
  });
}

function wireFollowButtons() {
  const followButtons = document.querySelectorAll('[data-follow-action]');
  followButtons.forEach((button) => {
    if (!(button instanceof HTMLButtonElement) || button.dataset.followPatch === 'bound') {
      return;
    }
    const username = (button.getAttribute('data-username') || '').trim();
    if (!username) {
      return;
    }
    button.dataset.followPatch = 'bound';
    button.dataset.customFollowBound = 'true';
    const initialState = button.dataset.following === 'true' || button.dataset.followAction === 'unfollow';
    button.dataset.following = initialState ? 'true' : 'false';
    const followLabel = button.dataset.followLabel || button.textContent?.trim() || 'Follow';
    const followingLabel = button.dataset.followingLabel || button.dataset.unfollowLabel || 'Following';
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) {
        return;
      }
      const currentlyFollowing = button.dataset.following === 'true';
      button.disabled = true;
      button.classList.add('is-loading');
      const loadingLabel = button.dataset.followLoadingLabel || 'Working…';
      button.textContent = loadingLabel;
      try {
        if (currentlyFollowing) {
          await unfollowUserByUsername(username);
        } else {
          await followUserByUsername(username);
        }
        const nowFollowing = !currentlyFollowing;
        button.dataset.following = nowFollowing ? 'true' : 'false';
        button.textContent = nowFollowing ? followingLabel : followLabel;
      } catch (error) {
        console.warn('Custom fix: follow/unfollow failed', error);
        button.textContent = currentlyFollowing ? followingLabel : followLabel;
      } finally {
        button.disabled = false;
        button.classList.remove('is-loading');
      }
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCustomFixes);
} else {
  initCustomFixes();
}
