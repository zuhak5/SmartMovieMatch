import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL =
  window.SUPABASE_URL || window.env?.SUPABASE_URL || window.__env?.SUPABASE_URL || "";
const SUPABASE_ANON_KEY =
  window.SUPABASE_ANON_KEY ||
  window.env?.SUPABASE_ANON_KEY ||
  window.__env?.SUPABASE_ANON_KEY ||
  "";

const supabase = SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

function getDisplayName(user) {
  const meta = user?.user_metadata || {};
  return meta.full_name || meta.name || meta.display_name || user?.email || "Signed in";
}

function getHandle(user) {
  const meta = user?.user_metadata || {};
  const handle = meta.username || meta.preferred_username || meta.user_name;
  if (handle) return `@${handle}`;
  if (user?.email) {
    const [prefix] = user.email.split("@");
    return `@${prefix}`;
  }
  return "@member";
}

function getAvatarDetails(user) {
  const meta = user?.user_metadata || {};
  const avatarUrl = meta.avatar_url || meta.picture || "";
  const displayName = getDisplayName(user);
  const initials = displayName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return { avatarUrl, initials };
}

function renderLoggedOut(container, { reason } = {}) {
  if (!container) return;
  container.innerHTML = "";
  const stack = document.createElement("div");
  stack.className = "stack auth-stack";

  const helper = document.createElement("div");
  helper.className = "small-text subtle";
  helper.textContent = reason === "missing-config"
    ? "Add SUPABASE_URL & SUPABASE_ANON_KEY to enable auth."
    : "You're browsing as a guest.";

  const cta = document.createElement("button");
  cta.className = "btn btn-primary auth-cta";
  cta.textContent = "Sign in / Sign up";
  cta.addEventListener("click", () => {
    const detail = { supabaseClient: supabase };
    const event = new CustomEvent("auth:open", { detail });
    window.dispatchEvent(event);
    if (!supabase) {
      console.info("Supabase client not configured; emitted auth:open for host handling.");
    }
  });

  stack.append(helper, cta);
  container.append(stack);
}

function renderSignedIn(container, user) {
  if (!container) return;
  container.innerHTML = "";
  const sessionWrapper = document.createElement("div");
  sessionWrapper.className = "user-session";

  const chip = document.createElement("button");
  chip.className = "user-chip";
  chip.setAttribute("aria-haspopup", "true");
  chip.setAttribute("aria-expanded", "false");

  const { avatarUrl, initials } = getAvatarDetails(user);
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = initials;
  if (avatarUrl) {
    avatar.style.backgroundImage = `url(${avatarUrl})`;
    avatar.style.backgroundSize = "cover";
    avatar.style.backgroundPosition = "center";
  }

  const meta = document.createElement("div");
  meta.className = "stack user-meta";
  const name = document.createElement("strong");
  name.textContent = getDisplayName(user);
  const handle = document.createElement("div");
  handle.className = "small-text subtle";
  handle.textContent = getHandle(user);
  meta.append(name, handle);

  const caret = document.createElement("span");
  caret.className = "caret";
  caret.textContent = "▾";

  chip.append(avatar, meta, caret);

  const menu = document.createElement("div");
  menu.className = "user-menu";
  const profileBtn = document.createElement("button");
  profileBtn.textContent = "Profile";
  profileBtn.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("auth:profile", { detail: { user } }));
    menu.classList.remove("is-open");
    chip.setAttribute("aria-expanded", "false");
  });

  const settingsBtn = document.createElement("button");
  settingsBtn.textContent = "Settings";
  settingsBtn.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("auth:settings", { detail: { user } }));
    menu.classList.remove("is-open");
    chip.setAttribute("aria-expanded", "false");
  });

  const logoutBtn = document.createElement("button");
  logoutBtn.textContent = "Logout";
  logoutBtn.addEventListener("click", async () => {
    menu.classList.remove("is-open");
    chip.setAttribute("aria-expanded", "false");
    if (supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.warn("Logout failed", error);
      }
    } else {
      console.info("No Supabase client configured; dispatching auth:logout.");
      window.dispatchEvent(new CustomEvent("auth:logout"));
    }
  });

  menu.append(profileBtn, settingsBtn, logoutBtn);

  const closeMenu = (event) => {
    if (!menu.contains(event.target) && !chip.contains(event.target)) {
      menu.classList.remove("is-open");
      chip.setAttribute("aria-expanded", "false");
      document.removeEventListener("click", closeMenu);
    }
  };

  chip.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = menu.classList.toggle("is-open");
    chip.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) {
      document.addEventListener("click", closeMenu);
    } else {
      document.removeEventListener("click", closeMenu);
    }
  });

  sessionWrapper.append(chip, menu);
  container.append(sessionWrapper);
}

export async function initAuthUI(container) {
  if (!container) return;
  if (!supabase) {
    renderLoggedOut(container, { reason: "missing-config" });
    return;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.warn("Failed to load session", error);
    renderLoggedOut(container);
  } else if (data?.session?.user) {
    renderSignedIn(container, data.session.user);
  } else {
    renderLoggedOut(container);
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) {
      renderSignedIn(container, session.user);
    } else {
      renderLoggedOut(container);
    }
  });
}

export function getSupabaseClient() {
  return supabase;
}
