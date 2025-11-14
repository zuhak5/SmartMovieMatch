import {
  registerUser,
  loginUser,
  subscribeToSession,
  requestPasswordReset
} from "./auth.js";
import { $ } from "./dom.js";
import { playUiClick } from "./sound.js";

const state = {
  mode: "login"
};

const THEME_STORAGE_KEY = "smm.theme.v1";

const THEME_COLOR_MAP = {
  dark: "#020617",
  light: "#f3f5ff"
};

const COLOR_SCHEME_META_CONTENT = {
  dark: "dark light",
  light: "light dark"
};

const authMetaThemeColor = document.querySelector('meta[name="theme-color"]');
const authMetaColorScheme = document.querySelector('meta[name="color-scheme"]');
const authRootElement = document.documentElement;

function resolveStoredTheme() {
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

function applyResolvedTheme(theme) {
  const normalized = theme === "light" ? "light" : "dark";
  if (authRootElement) {
    authRootElement.dataset.theme = normalized;
    authRootElement.style.setProperty("color-scheme", normalized);
  }
  if (document.body) {
    document.body.dataset.theme = normalized;
    document.body.style.setProperty("color-scheme", normalized);
  }
  if (authMetaColorScheme) {
    const content =
      COLOR_SCHEME_META_CONTENT[normalized] || COLOR_SCHEME_META_CONTENT.dark;
    authMetaColorScheme.setAttribute("content", content);
  }
  if (authMetaThemeColor) {
    const color = THEME_COLOR_MAP[normalized] || THEME_COLOR_MAP.dark;
    authMetaThemeColor.setAttribute("content", color);
  }
}

applyResolvedTheme(resolveStoredTheme());

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = (event) => reject(event);
    reader.readAsDataURL(file);
  });
}

function initAuthPage() {
  const form = $("authForm");
  const toggleBtn = $("authModeToggle");
  const status = $("authStatus");
  const avatarInput = $("avatarInput");
  const avatarGroup = $("avatarGroup");
  const submitBtn = $("authSubmit");
  const nameGroup = $("displayNameGroup");
  const nameInput = $("displayNameInput");
  const passwordInput = $("passwordInput");
  const passwordStrength = $("passwordStrength");
  const forgotPasswordBtn = $("forgotPasswordBtn");
  const passwordChecklist = document.getElementById("authPasswordChecklist");
  const passwordToggleButtons = Array.from(
    document.querySelectorAll('[data-password-toggle]')
  );
  const socialButtons = Array.from(document.querySelectorAll(".auth-social-btn"));
  const modeTabs = Array.from(document.querySelectorAll('[data-auth-mode]'));

  if (!form || !toggleBtn || !status || !submitBtn || !passwordInput) {
    return;
  }

  const avatarCircle = document.querySelector(".avatar-circle");
  const avatarPlaceholder = avatarCircle
    ? avatarCircle.querySelector(".avatar-placeholder")
    : null;
  let avatarPreviewUrl = null;

  function setStatus(message, variant = "info") {
    if (!status) {
      return;
    }
    const className =
      variant === "error"
        ? "status-error"
        : variant === "success"
          ? "status-success"
          : variant === "loading"
            ? "status-loading"
            : "status-info";
    const labelText =
      variant === "error"
        ? "Error"
        : variant === "success"
          ? "Success"
          : variant === "loading"
            ? "Working"
            : "Info";
    status.innerHTML = `<span class="${className}" data-status-label="${labelText}">${message}</span>`;
  }

  function clearAvatarPreview() {
    if (avatarPreviewUrl) {
      URL.revokeObjectURL(avatarPreviewUrl);
      avatarPreviewUrl = null;
    }
    if (avatarCircle) {
      const existingImg = avatarCircle.querySelector("img");
      if (existingImg) {
        existingImg.remove();
      }
      avatarCircle.classList.remove("avatar-circle--has-image");
    }
    if (avatarPlaceholder) {
      avatarPlaceholder.style.display = "";
    }
  }

  const applyMode = (nextMode) => {
    const normalized = nextMode === "signup" ? "signup" : "login";
    if (state.mode === normalized) {
      return;
    }
    state.mode = normalized;
    if (state.mode === "login") {
      if (nameInput) {
        nameInput.value = "";
      }
      if (avatarInput) {
        avatarInput.value = "";
      }
      clearAvatarPreview();
    }
    updateModeUi({ nameGroup, avatarGroup, passwordChecklist, modeTabs });
    applyPasswordStrength(passwordInput.value, passwordStrength);
    applyPasswordChecklist(passwordInput.value, passwordChecklist);
    status.innerHTML = "";
  };

  if (avatarInput && avatarCircle) {
    avatarInput.addEventListener("change", () => {
      const file = avatarInput.files && avatarInput.files[0];
      if (!file) {
        clearAvatarPreview();
        return;
      }

      if (!file.type.startsWith("image/")) {
        setStatus("Please choose an image file.", "error");
        avatarInput.value = "";
        clearAvatarPreview();
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        setStatus("Image must be 5 MB or smaller.", "error");
        avatarInput.value = "";
        clearAvatarPreview();
        return;
      }

      const objectUrl = URL.createObjectURL(file);
      avatarPreviewUrl = objectUrl;

      let img = avatarCircle.querySelector("img");
      if (!img) {
        img = document.createElement("img");
        img.alt = "Selected profile picture preview";
        avatarCircle.appendChild(img);
      }
      img.src = objectUrl;
      avatarCircle.classList.add("avatar-circle--has-image");
      if (avatarPlaceholder) {
        avatarPlaceholder.style.display = "none";
      }
    });
  }

  subscribeToSession((session) => {
    const displayName = session
      ? session.displayName || session.username || ""
      : "";
    if (!displayName) {
      return;
    }
    setStatus(`Signed in as <strong>${displayName}</strong>. Redirecting…`, "success");
    window.setTimeout(() => {
      window.location.href = "index.html";
    }, 850);
  });

  if (passwordInput) {
    passwordInput.addEventListener("input", () => {
      applyPasswordStrength(passwordInput.value, passwordStrength);
      applyPasswordChecklist(passwordInput.value, passwordChecklist);
    });
  }

  passwordToggleButtons.forEach((button) => setupPasswordToggle(button));

  socialButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const provider = button.getAttribute("data-provider") || "social";
      const providerLabel = formatProviderLabel(provider);
      playUiClick();
      setStatus(
        `${providerLabel} sign-in is coming soon. Use your username and password for now.`,
        "info"
      );
    });
  });

  if (forgotPasswordBtn) {
    forgotPasswordBtn.addEventListener("click", async () => {
      const username = window.prompt("Enter your username to reset your password:");
      if (!username) {
        return;
      }
      try {
        forgotPasswordBtn.disabled = true;
        setStatus("Sending reset instructions…", "loading");
        const response = await requestPasswordReset(username.trim());
        const message =
          response && response.message
            ? response.message
            : "If that username exists, check your email for next steps.";
        setStatus(message, "success");
      } catch (error) {
        setStatus(
          error && error.message
            ? error.message
            : "We couldn’t start a reset right now.",
          "error"
        );
      } finally {
        forgotPasswordBtn.disabled = false;
      }
    });
  }

  updateModeUi({ nameGroup, avatarGroup, passwordChecklist, modeTabs });
  applyPasswordStrength(passwordInput.value, passwordStrength);
  applyPasswordChecklist(passwordInput.value, passwordChecklist);

  toggleBtn.addEventListener("click", () => {
    playUiClick();
    const nextMode = state.mode === "login" ? "signup" : "login";
    applyMode(nextMode);
  });

  modeTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const tabMode = tab.getAttribute("data-auth-mode") === "signup" ? "signup" : "login";
      if (tabMode !== state.mode) {
        playUiClick();
        applyMode(tabMode);
      }
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const usernameInput = $("usernameInput");
    const passwordField = $("passwordInput");
    const username = usernameInput ? usernameInput.value.trim() : "";
    const password = passwordField ? passwordField.value : "";
    const displayNameValue = nameInput ? nameInput.value.trim() : "";

    if (!username || !password) {
      setStatus("Enter both username and password.", "error");
      return;
    }

    if (state.mode === "signup" && password.length < 8) {
      setStatus("Passwords need at least 8 characters when signing up.", "error");
      return;
    }

    if (state.mode === "signup" && displayNameValue.length < 2) {
      setStatus("Add your name so we can personalize things.", "error");
      return;
    }

    try {
      submitBtn.disabled = true;
      toggleBtn.disabled = true;
      setStatus("Contacting the sync service…", "loading");

      if (state.mode === "signup") {
        let avatarBase64 = null;
        let avatarFileName = null;
        if (avatarInput && avatarInput.files && avatarInput.files[0]) {
          const file = avatarInput.files[0];
          avatarBase64 = await fileToBase64(file);
          avatarFileName = file.name;
        }
        await registerUser({
          username,
          password,
          name: displayNameValue,
          avatarBase64,
          avatarFileName
        });
        setStatus("Account created! Redirecting…", "success");
      } else {
        await loginUser({ username, password });
        setStatus("Welcome back! Redirecting…", "success");
      }

      window.setTimeout(() => {
        window.location.href = "index.html";
      }, 850);
    } catch (error) {
      setStatus(error && error.message ? error.message : "Sign in failed.", "error");
    } finally {
      submitBtn.disabled = false;
      toggleBtn.disabled = false;
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAuthPage, { once: true });
} else {
  initAuthPage();
}

function updateModeUi({ nameGroup, avatarGroup, passwordChecklist, modeTabs }) {
  const title = $("authTitle");
  const toggleBtn = $("authModeToggle");
  const form = $("authForm");
  const subtitle = $("authSubtitle");

  if (!title || !toggleBtn || !form) {
    return;
  }

  if (state.mode === "signup") {
    title.textContent = "Create your account";
    toggleBtn.textContent = "Already have one? Log in";
    form.setAttribute("aria-describedby", "authStatus");
    if (subtitle) {
      subtitle.textContent = "Set a name and avatar so your profile feels personal.";
    }
    if (nameGroup) {
      nameGroup.hidden = false;
      nameGroup.style.display = "flex";
    }
    if (avatarGroup) {
      avatarGroup.hidden = false;
      avatarGroup.style.display = "flex";
    }
    if (passwordChecklist) {
      passwordChecklist.hidden = false;
      passwordChecklist.setAttribute("aria-hidden", "false");
    }
  } else {
    title.textContent = "Welcome back";
    toggleBtn.textContent = "Need an account? Sign up";
    form.setAttribute("aria-describedby", "authStatus");
    if (subtitle) {
      subtitle.textContent = "Sign in to sync your taste profile and watched history across devices.";
    }
    if (nameGroup) {
      nameGroup.hidden = true;
      nameGroup.style.display = "none";
    }
    if (avatarGroup) {
      avatarGroup.hidden = true;
      avatarGroup.style.display = "none";
    }
    if (passwordChecklist) {
      passwordChecklist.hidden = true;
      passwordChecklist.setAttribute("aria-hidden", "true");
    }
  }

  if (Array.isArray(modeTabs) && modeTabs.length) {
    modeTabs.forEach((tab) => {
      const tabMode = tab.getAttribute("data-auth-mode") === "signup" ? "signup" : "login";
      const active = tabMode === state.mode;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
  }
}

function applyPasswordStrength(value, statusNode) {
  if (!statusNode) {
    return;
  }
  const password = value || "";
  if (!password) {
    statusNode.textContent = state.mode === "signup"
      ? "Aim for 8+ characters with a mix of types."
      : "";
    statusNode.removeAttribute("data-level");
    return;
  }

  const score = assessPasswordStrength(password);
  let level = "weak";
  let message = "Weak — add more characters and variety.";
  if (score >= 4) {
    level = "strong";
    message = "Strong — great job keeping it secure.";
  } else if (score === 3) {
    level = "fair";
    message = "Fair — add symbols or numbers to strengthen it.";
  }
  statusNode.textContent = message;
  statusNode.dataset.level = level;
}

function assessPasswordStrength(password) {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return score;
}

function evaluatePasswordRules(password) {
  const value = typeof password === "string" ? password : "";
  return {
    length: value.length >= 8,
    upper: /[a-z]/.test(value) && /[A-Z]/.test(value),
    number: /\d/.test(value),
    symbol: /[^A-Za-z0-9]/.test(value)
  };
}

function applyPasswordChecklist(password, listEl) {
  if (!listEl) {
    return;
  }
  const isSignup = state.mode === "signup";
  if (!isSignup) {
    listEl.hidden = true;
    listEl.setAttribute("aria-hidden", "true");
    listEl.querySelectorAll("[data-password-rule]").forEach((item) => {
      item.dataset.state = "pending";
    });
    return;
  }

  listEl.hidden = false;
  listEl.setAttribute("aria-hidden", "false");
  const rules = evaluatePasswordRules(password);
  listEl.querySelectorAll("[data-password-rule]").forEach((item) => {
    const key = item.getAttribute("data-password-rule");
    if (!key) {
      return;
    }
    item.dataset.state = rules[key] ? "met" : "pending";
  });
}

function setupPasswordToggle(button) {
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

  const syncState = () => {
    const isPassword = input.getAttribute("type") === "password";
    button.setAttribute("aria-pressed", isPassword ? "false" : "true");
    button.setAttribute("aria-label", isPassword ? showAria : hideAria);
    if (labelNode) {
      labelNode.textContent = isPassword ? showLabel : hideLabel;
    } else {
      button.textContent = isPassword ? showLabel : hideLabel;
    }
  };

  syncState();

  button.addEventListener("click", () => {
    const isPassword = input.getAttribute("type") === "password";
    input.setAttribute("type", isPassword ? "text" : "password");
    syncState();
    playUiClick();
    input.focus();
  });
}

function formatProviderLabel(provider) {
  const value = String(provider || "").toLowerCase();
  if (!value) {
    return "Social";
  }
  if (value === "google") {
    return "Google";
  }
  if (value === "apple") {
    return "Apple";
  }
  if (value === "github") {
    return "GitHub";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}
