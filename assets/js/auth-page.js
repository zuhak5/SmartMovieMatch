import {
  registerUser,
  loginUser,
  subscribeToSession,
  requestPasswordReset
} from "./auth.js";
import { $ } from "./dom.js";

const state = {
  mode: "login"
};

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
    status.innerHTML = `<span class="${className}">${message}</span>`;
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
    });
  }

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

  updateModeUi({ nameGroup, avatarGroup });
  applyPasswordStrength(passwordInput.value, passwordStrength);

  toggleBtn.addEventListener("click", () => {
    state.mode = state.mode === "login" ? "signup" : "login";
    if (state.mode === "login") {
      if (nameInput) {
        nameInput.value = "";
      }
      if (avatarInput) {
        avatarInput.value = "";
      }
      clearAvatarPreview();
    }
    updateModeUi({ nameGroup, avatarGroup });
    applyPasswordStrength(passwordInput.value, passwordStrength);
    status.innerHTML = "";
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

    if (state.mode === "signup" && password.length < 8) {
      status.innerHTML =
        '<span class="status-error">Passwords need at least 8 characters when signing up.</span>';
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

function updateModeUi({ nameGroup, avatarGroup }) {
  const title = $("authTitle");
  const toggleBtn = $("authModeToggle");
  const form = $("authForm");

  if (!title || !toggleBtn || !form) {
    return;
  }

  if (state.mode === "signup") {
    title.textContent = "Create your account";
    toggleBtn.textContent = "Already have one? Log in";
    form.setAttribute("aria-describedby", "authStatus");
    if (nameGroup) {
      nameGroup.hidden = false;
      nameGroup.style.display = "flex";
    }
    if (avatarGroup) {
      avatarGroup.hidden = false;
      avatarGroup.style.display = "flex";
    }
  } else {
    title.textContent = "Welcome back";
    toggleBtn.textContent = "Need an account? Sign up";
    form.setAttribute("aria-describedby", "authStatus");
    if (nameGroup) {
      nameGroup.hidden = true;
      nameGroup.style.display = "none";
    }
    if (avatarGroup) {
      avatarGroup.hidden = true;
      avatarGroup.style.display = "none";
    }
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
