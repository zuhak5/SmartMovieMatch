import React, {
  useState,
  FormEvent,
  ChangeEvent,
  useEffect,
  useRef,
  KeyboardEvent,
} from 'react';

type NavKey = 'home' | 'lists' | 'friends' | 'profile' | 'account';

type PrimaryNavLink = { href: string; label: string; nav: NavKey; icon: string };

const primaryNavLinks: Array<PrimaryNavLink> = [
  { href: 'index.html', label: 'Home', nav: 'home', icon: '🏠' },
  { href: 'profile.html#collectionsPanel', label: 'My Lists', nav: 'lists', icon: '🎯' },
  { href: 'peeruser.html', label: 'Friends', nav: 'friends', icon: '🤝' },
  { href: 'profile.html', label: 'Profile', nav: 'profile', icon: '👤' },
  { href: 'account-settings.html', label: 'Account', nav: 'account', icon: '⚙️' },
];

function SiteHeader({ activeNav }: { activeNav: NavKey }) {
  return (
    <header className="site-header pad-inline">
      <div className="site-header__inner">
        <div className="site-header__primary">
          <nav className="site-header__nav" aria-label="Primary navigation">
            {primaryNavLinks.map(({ href, label, nav, icon }) => (
              <a
                key={nav}
                className="site-header__link"
                href={href}
                data-nav={nav}
                aria-current={activeNav === nav ? 'page' : undefined}
              >
                <span className="site-header__icon" aria-hidden="true">{icon}</span>
                <span className="site-header__label">{label}</span>
              </a>
            ))}
          </nav>
        </div>
        <div className="site-header__secondary">
          <div className="site-header__controls">
            <div className="site-header__control-group">
              <button
                id="themeToggle"
                className="btn-theme-toggle"
                type="button"
                aria-label="Switch to light theme"
                data-theme-target="light"
              >
                <span className="btn-theme-icon" aria-hidden="true">🌙</span>
                <span className="btn-theme-label">Dark</span>
              </button>
              <button
                id="notificationBell"
                className="notification-bell"
                type="button"
                aria-haspopup="true"
                aria-expanded="false"
                aria-controls="notificationPanel"
                hidden
              >
                <span className="notification-icon" aria-hidden="true">🔔</span>
                <span id="notificationCount" className="notification-count" hidden>
                  0
                </span>
                <span className="sr-only">Open notifications</span>
              </button>
            </div>
            <div className="account-bar" role="navigation" data-account-state="guest">
              <div className="account-bar__content">
                <div className="account-bar-actions">
                  <a id="accountLoginLink" className="account-link" href="login.html">
                    Log in / Sign up
                  </a>
                </div>
                <div id="accountProfile" className="account-profile" hidden>
                  <button
                    id="accountProfileBtn"
                    className="account-pill"
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded="false"
                    aria-controls="accountMenu"
                  >
                    <span className="account-avatar" id="accountAvatar" aria-hidden="true">
                      <span id="accountAvatarInitials" className="account-avatar-initials">GM</span>
                      <img id="accountAvatarImg" alt="" />
                    </span>
                    <span className="account-pill-text">
                      <span id="accountName" className="account-name">Guest</span>
                      <span id="accountPillSync" className="account-pill-sub">Cloud sync inactive</span>
                    </span>
                    <span className="account-pill-caret" aria-hidden="true">▾</span>
                  </button>
                  <ul id="accountMenu" className="account-menu" role="menu" aria-label="Account actions">
                    <li>
                      <button className="account-menu-item" type="button" data-action="profile" role="menuitem">
                        Profile overview
                      </button>
                    </li>
                    <li>
                      <button className="account-menu-item" type="button" data-action="settings" role="menuitem">
                        Account settings
                      </button>
                    </li>
                    <li>
                      <button
                        className="account-menu-item account-menu-item--danger"
                        type="button"
                        data-action="logout"
                        role="menuitem"
                      >
                        Sign out
                      </button>
                    </li>
                  </ul>
                  <span id="socialActivityIndicator" className="social-activity-indicator" hidden aria-hidden="true" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

export default function SignupPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const allowedAvatarTypes = ['image/jpeg', 'image/png'];

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const existing = document.getElementById('smm-mobile-css');
    if (!existing) {
      const link = document.createElement('link');
      link.id = 'smm-mobile-css';
      link.rel = 'stylesheet';
      link.href = '/assets/css/mobile.css';
      document.head.appendChild(link);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (avatarPreview) {
        URL.revokeObjectURL(avatarPreview);
      }
    };
  }, [avatarPreview]);

  function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;

    if (avatarPreview) {
      URL.revokeObjectURL(avatarPreview);
    }

    if (file) {
      if (!allowedAvatarTypes.includes(file.type)) {
        setAvatarError('Only JPG or PNG images are supported. Please choose a different file under 5 MB.');
        event.target.value = '';
        setAvatarFile(null);
        setAvatarPreview(null);
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setAvatarError('Avatar must be 5 MB or smaller. Only JPG or PNG images are supported.');
        event.target.value = '';
        setAvatarFile(null);
        setAvatarPreview(null);
        return;
      }
      setAvatarError(null);
      const previewUrl = URL.createObjectURL(file);
      setAvatarFile(file);
      setAvatarPreview(previewUrl);
    } else {
      setAvatarFile(null);
      setAvatarPreview(null);
      setAvatarError(null);
    }
  }

  function clearAvatarSelection() {
    if (avatarPreview) {
      URL.revokeObjectURL(avatarPreview);
    }
    setAvatarFile(null);
    setAvatarPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setAvatarError(null);
  }

  function handleAvatarKeyDown(event: KeyboardEvent<HTMLLabelElement>) {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      fileInputRef.current?.click();
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setAvatarError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const username = String(formData.get('username') || '');
    const display_name = String(formData.get('display_name') || '');
    const password = String(formData.get('password') || '');
    const avatar = avatarFile;

    let avatarBase64: string | null = null;
    let avatarFileName: string | null = null;

    if (avatar && avatar.size > 0) {
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result;
            if (typeof result === 'string') {
              const [, data = ''] = result.split(',');
              resolve(data);
            } else {
              reject(new Error('Unable to read avatar preview.'));
            }
          };
          reader.onerror = () => {
            reject(new Error('Failed to read avatar file.'));
          };
          reader.readAsDataURL(avatar);
        });

        avatarBase64 = base64;
        avatarFileName = avatar.name;
      } catch (readError) {
        setLoading(false);
        setError(readError instanceof Error ? readError.message : 'Failed to process avatar file.');
        return;
      }
    }

    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, display_name, password, avatarBase64, avatarFileName }),
      });

      const data = await res.json();
      setLoading(false);

      if (!res.ok) {
        if (data?.error === 'Avatar upload failed') {
          setAvatarError('We couldn\'t upload that image. Only JPG or PNG images under 5 MB are supported.');
        } else {
          setError(data?.error || 'Signup failed');
        }
        return;
      }

      alert('Signup successful! Token: ' + data.token);
    } catch (networkError) {
      setLoading(false);
      setError('Unable to complete signup. Please try again.');
      console.error('Signup request failed', networkError);
    }
  }

  return (
    <div className="site-shell site-shell--auth">
      <SiteHeader activeNav="account" />
      <main className="site-main site-main--auth">
        <div className="site-main__backdrop" aria-hidden="true"></div>
        <div className="site-main__glow" aria-hidden="true"></div>
        <div className="site-main__inner pad-inline">
          <div className="site-main__grid">
            <section className="site-main__content site-main__content--auth">
              <div className="page signup-page">
                <div className="card signup-card">
          <h1 className="signup-title">Create your account</h1>
          <p className="signup-subtitle">Join SmartMovieMatch and start curating your perfect watchlist.</p>

        <form onSubmit={handleSubmit} className="signup-form">
          <label className="signup-field">
            <span className="signup-field-label">Username</span>
            <input
              name="username"
              required
              placeholder="Enter a unique username"
              className="signup-input"
            />
          </label>

          <label className="signup-field">
            <span className="signup-field-label">Display name</span>
            <input
              name="display_name"
              required
              placeholder="How should we greet you?"
              className="signup-input"
            />
          </label>

          <label className="signup-field">
            <span className="signup-field-label">Password</span>
            <input
              name="password"
              type="password"
              required
              placeholder="Create a strong password"
              className="signup-input"
            />
          </label>

          <div className="signup-field signup-avatar-field">
            <span className="signup-field-label">Avatar (optional)</span>
            <div className="signup-avatar">
              <label
                className={`signup-avatar-circle${avatarPreview ? ' has-image' : ''}`}
                htmlFor="avatar"
                aria-describedby={`avatar-hint${avatarError ? ' avatar-error' : ''}`}
                role="button"
                tabIndex={0}
                onKeyDown={handleAvatarKeyDown}
              >
                {avatarPreview ? (
                  <img src={avatarPreview} alt="Selected avatar preview" />
                ) : (
                  <span className="signup-avatar-placeholder" aria-hidden="true">
                    +
                  </span>
                )}
                <span className="sr-only">
                  {avatarPreview ? 'Change avatar photo' : 'Upload avatar photo'}
                </span>
              </label>

              <div className="signup-avatar-actions">
                <p className="signup-hint" id="avatar-hint">
                  Tap the photo to upload. Maximum size 5 MB.
                </p>
                {avatarPreview && (
                  <button type="button" onClick={clearAvatarSelection} className="signup-secondary-btn">
                    Remove photo
                  </button>
                )}
              </div>
            </div>
            {avatarError && (
              <p className="signup-avatar-error" role="alert" id="avatar-error">
                {avatarError}
              </p>
            )}
            <input
              id="avatar"
              name="avatar"
              type="file"
              accept=".jpg,.jpeg,.png"
              onChange={handleAvatarChange}
              className="sr-only"
              ref={fileInputRef}
            />
          </div>

          <button type="submit" disabled={loading} className="signup-submit">
            {loading ? 'Signing you up…' : 'Create account'}
          </button>

          {error && <p className="signup-error">{error}</p>}
        </form>
                </div>
              </div>
            </section>
            <aside className="site-main__sidebar site-main__sidebar--auth" aria-label="Signup highlights">
              <section className="site-sidebar-card">
                <p className="site-sidebar-card__eyebrow">What you get</p>
                <h2 className="site-sidebar-card__title">Curated nights, synced</h2>
                <p className="site-sidebar-card__body">
                  Build a taste profile, follow friends, and let the engine queue perfect sessions.
                </p>
                <div className="site-main__stat-grid">
                  <div className="site-main__stat">
                    <span className="site-main__stat-value">Realtime</span>
                    <span className="site-main__stat-label">Taste map</span>
                  </div>
                  <div className="site-main__stat">
                    <span className="site-main__stat-value">5+</span>
                    <span className="site-main__stat-label">Collaborative modes</span>
                  </div>
                </div>
              </section>
              <section className="site-sidebar-card">
                <p className="site-sidebar-card__eyebrow">Fast track</p>
                <ul className="site-main__checklist">
                  <li className="site-main__check-item">
                    <span className="site-main__check-icon" aria-hidden="true">⚡</span>
                    <div>
                      <p className="site-main__check-title">One-minute signup</p>
                      <p className="site-main__check-subtitle">Pick a handle and avatar—no credit card required.</p>
                    </div>
                  </li>
                  <li className="site-main__check-item">
                    <span className="site-main__check-icon" aria-hidden="true">🧭</span>
                    <div>
                      <p className="site-main__check-title">Guided onboarding</p>
                      <p className="site-main__check-subtitle">Initial prompts teach the algorithm your mood quickly.</p>
                    </div>
                  </li>
                  <li className="site-main__check-item">
                    <span className="site-main__check-icon" aria-hidden="true">🧑‍🤝‍🧑</span>
                    <div>
                      <p className="site-main__check-title">Instant friend sync</p>
                      <p className="site-main__check-subtitle">Find people via handle or email to start sharing queues.</p>
                    </div>
                  </li>
                </ul>
              </section>
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}
