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
      const comma = result.indexOf(",");
      // strip "data:*/*;base64," prefix if present
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = (e) => reject(e);
    reader.readAsDataURL(file);
  });
}

document.addEventListener("DOMContentLoaded", () => {

  const form = $("authForm");
  const toggleBtn = $("authModeToggle");
  const status = $("authStatus");
  const avatarInput = $("avatarInput");
  const avatarGroup = $("avatarGroup");
  const submitBtn = $("authSubmit");
  const nameInput = $("displayNameInput");
  const passwordInput = $("passwordInput");
  const passwordStrength = $("passwordStrength");
  const forgotPasswordBtn = $("forgotPasswordBtn");

  const avatarCircle = document.querySelector(".avatar-circle");
  const avatarPlaceholder = avatarCircle
    ? avatarCircle.querySelector(".avatar-placeholder")
    : null;

  let avatarPreviewUrl = null;

  function clearAvatarPreview() {
    if (!avatarCircle) return;

    if (avatarPreviewUrl) {
      URL.revokeObjectURL(avatarPreviewUrl);
      avatarPreviewUrl = null;
    }

    const existingImg = avatarCircle.querySelector("img");
    if (existingImg) {
      existingImg.remove();
    }

    avatarCircle.classList.remove("avatar-circle--has-image");
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
        status.innerHTML =
          '<span class="status-error">Please choose an image file.</span>';
        avatarInput.value = "";
        clearAvatarPreview();
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        status.innerHTML =
          '<span class="status-error">Image must be 5 MB or smaller.</span>';
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
    if (displayName) {
      status.innerHTML =
        `<span class="status-success">Signed in as <strong>${displayName}</strong>. Redirecting…</span>`;
      setTimeout(() => {
        window.location.href = "index.html";
      }, 850);
    }
  });

  if (passwordInput) {
    passwordInput.addEventListener("input", () => {
      applyPasswordStrength(passwordInput.value);
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
        status.innerHTML = '<span class="status-loading">Sending reset instructions…</span>';
        const response = await requestPasswordReset(username.trim());
        const message = response && response.message
          ? response.message
          : 'If that username exists, check your email for next steps.';
        status.innerHTML = `<span class="status-success">${message}</span>`;
      } catch (error) {
        status.innerHTML = `<span class="status-error">${error.message || 'We couldn’t start a reset right now.'}</span>`;
      } finally {
        forgotPasswordBtn.disabled = false;
      }
    });
  }

  updateModeUi();
  applyPasswordStrength(passwordInput ? passwordInput.value : "");

  toggleBtn.addEventListener("click", () => {
    state.mode = state.mode === "login" ? "signup" : "login";
    updateModeUi();
    applyPasswordStrength(passwordInput ? passwordInput.value : "");
    status.textContent = "";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = $("usernameInput").value.trim();
    const password = $("passwordInput").value;
    const displayNameValue = nameInput ? nameInput.value.trim() : "";

    if (!username || !password) {
      status.innerHTML =
        '<span class="status-error">Enter both username and password.</span>';
      return;
    }

    if (state.mode === "signup" && password.length < 8) {
      status.innerHTML =
        '<span class="status-error">Passwords need at least 8 characters when signing up.</span>';
      return;
    }

    if (state.mode === "signup" && displayNameValue.length < 2) {
      status.innerHTML =
        '<span class="status-error">Add your name so we can personalize things.</span>';
      return;
    }

    try {
      submitBtn.disabled = true;
      toggleBtn.disabled = true;
      status.innerHTML =
        '<span class="status-loading">Contacting the sync service…</span>';

      if (state.mode === "signup") {
let avatarBase64 = null;
let avatarFileName = null;
if (avatarInput && avatarInput.files && avatarInput.files[0]) {
  const file = avatarInput.files[0];
  avatarBase64 = await fileToBase64(file);
  avatarFileName = file.name;
}
await registerUser({ username, password, name: displayNameValue, avatarBase64, avatarFileName });

        status.innerHTML =
          '<span class="status-success">Account created! Redirecting…</span>';
      } else {
        await loginUser({ username, password });
        status.innerHTML =
          '<span class="status-success">Welcome back! Redirecting…</span>';
      }

      setTimeout(() => {
        window.location.href = "index.html";
      }, 850);
    } catch (error) {
      status.innerHTML = `<span class="status-error">${error.message}</span>`;
    } finally {
      submitBtn.disabled = false;
      toggleBtn.disabled = false;
    }
  });

  function applyPasswordStrength(value) {
    if (!passwordStrength) {
      return;
    }
    const password = value || "";
    if (!password) {
      passwordStrength.textContent = state.mode === "signup"
        ? "Aim for 8+ characters with a mix of types."
        : "";
      passwordStrength.removeAttribute("data-level");
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
    passwordStrength.textContent = message;
    passwordStrength.dataset.level = level;
  }
});

  function updateModeUi() {
    const title = $("authTitle");
    const toggleBtn = $("authModeToggle");
    const form = $("authForm");
    const nameGroup = $("displayNameGroup");
    const avatarGroup = $("avatarGroup");

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
});

function assessPasswordStrength(password) {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return score;
}
