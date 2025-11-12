import { playUiClick } from "./sound.js";

const SOCIAL_PROFILE_EVENT = "smm:open-profile";

export function canonicalHandle(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
}

export function requestOpenSocialProfile(username, { sourceEvent } = {}) {
  const normalized = canonicalHandle(username);
  if (!normalized) {
    return;
  }
  const detail = {
    username: normalized,
    sourceEvent: sourceEvent || null
  };
  const event = new CustomEvent(SOCIAL_PROFILE_EVENT, { detail });
  window.dispatchEvent(event);
}

export function subscribeToProfileOpens(handler) {
  if (typeof handler !== "function") {
    return () => {};
  }
  const listener = (event) => {
    const username = event && event.detail ? event.detail.username : null;
    if (!username) {
      return;
    }
    try {
      handler(username, event);
    } catch (error) {
      console.warn("Profile open handler error", error);
    }
  };
  window.addEventListener(SOCIAL_PROFILE_EVENT, listener);
  return () => window.removeEventListener(SOCIAL_PROFILE_EVENT, listener);
}

export function createProfileButton(username, options = {}) {
  const normalized = canonicalHandle(username);
  if (!normalized) {
    return null;
  }
  const button = document.createElement("button");
  button.type = "button";
  if (options.className) {
    button.className = options.className;
  }
  if (options.label) {
    button.textContent = options.label;
  }
  if (options.ariaLabel) {
    button.setAttribute("aria-label", options.ariaLabel);
  }
  if (options.title) {
    button.title = options.title;
  }
  button.dataset.profileUsername = normalized;
  const stopPropagation = options.stopPropagation === true;
  const activate = (event) => {
    if (stopPropagation) {
      event.stopPropagation();
    }
    requestOpenSocialProfile(normalized, { sourceEvent: event });
  };
  button.addEventListener("click", (event) => {
    event.preventDefault();
    playUiClick();
    activate(event);
  });
  button.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (stopPropagation) {
        event.stopPropagation();
      }
      playUiClick();
      activate(event);
    }
  });
  return button;
}

export function createInlineProfileLink(username, options = {}) {
  const className = options.className
    ? `${options.className} social-profile-link`
    : "social-profile-link";
  const button = createProfileButton(username, {
    className,
    ariaLabel: options.ariaLabel,
    title: options.title,
    stopPropagation: options.stopPropagation === true,
    label: options.label
  });
  if (!button) {
    return null;
  }
  if (!options.label && !button.textContent) {
    const normalized = canonicalHandle(username);
    if (normalized) {
      button.textContent = `@${normalized}`;
    }
  }
  if (!options.ariaLabel) {
    const label = button.textContent || "profile";
    const accessible = label.toLowerCase() === "you"
      ? "View your profile"
      : `View profile for ${label}`;
    button.setAttribute("aria-label", accessible);
  }
  return button;
}
