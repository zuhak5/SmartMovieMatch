import {
  registerUser,
  loginUser,
  subscribeToSession
} from "./auth.js";
import { $ } from "./dom.js";

const state = {
  mode: "login"
};

document.addEventListener("DOMContentLoaded", () => {
  const form = $("authForm");
  const toggleBtn = $("authModeToggle");
  const status = $("authStatus");
  const submitBtn = $("authSubmit");
  const nameInput = $("displayNameInput");

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

  updateModeUi();

  toggleBtn.addEventListener("click", () => {
    state.mode = state.mode === "login" ? "signup" : "login";
    updateModeUi();
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
        await registerUser({ username, password, name: displayNameValue });
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
});

function updateModeUi() {
  const title = $("authTitle");
  const toggleBtn = $("authModeToggle");
  const form = $("authForm");
  const nameGroup = $("displayNameGroup");

  if (state.mode === "signup") {
    title.textContent = "Create your account";
    toggleBtn.textContent = "Already have one? Log in";
    form.setAttribute("aria-describedby", "authStatus");
    if (nameGroup) {
      nameGroup.hidden = false;
      nameGroup.style.display = "flex";
    }
  } else {
    title.textContent = "Welcome back";
    toggleBtn.textContent = "Need an account? Sign up";
    form.setAttribute("aria-describedby", "authStatus");
    if (nameGroup) {
      nameGroup.hidden = true;
      nameGroup.style.display = "none";
    }
  }
}
