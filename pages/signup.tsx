import React, {
  useState,
  FormEvent,
  ChangeEvent,
  useEffect,
  useRef,
  KeyboardEvent,
} from 'react';

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
  );
}
