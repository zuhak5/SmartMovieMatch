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

  subscribeToSession((session) => {
    if (session && session.username) {
      status.innerHTML =
        `<span class="status-success">Signed in as <strong>${session.username}</strong>. Redirecting…</span>`;
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

    if (!username || !password) {
      status.innerHTML =
        '<span class="status-error">Enter both username and password.</span>';
      return;
    }

    try {
      submitBtn.disabled = true;
      toggleBtn.disabled = true;
      status.innerHTML =
        '<span class="status-loading">Contacting the sync service…</span>';

      if (state.mode === "signup") {
        await registerUser({ username, password });
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

  if (state.mode === "signup") {
    title.textContent = "Create your account";
    toggleBtn.textContent = "Already have one? Log in";
    form.setAttribute("aria-describedby", "authStatus");
  } else {
    title.textContent = "Welcome back";
    toggleBtn.textContent = "Need an account? Sign up";
    form.setAttribute("aria-describedby", "authStatus");
  }
}
