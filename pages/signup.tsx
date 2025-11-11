import React, { useState, FormEvent, ChangeEvent, useEffect, useRef } from 'react';

export default function SignupPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const allowedAvatarTypes = ['image/jpeg', 'image/png'];

  const openAvatarPicker = () => {
    fileInputRef.current?.click();
  };

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
    <div className="page">
      <div className="card">
        <h1>Create your account</h1>
        <p className="subtitle">Join SmartMovieMatch and start curating your perfect watchlist.</p>

        <form onSubmit={handleSubmit} className="form">
          <label className="field">
            <span>Username</span>
            <input name="username" required placeholder="Enter a unique username" />
          </label>

          <label className="field">
            <span>Display name</span>
            <input name="display_name" required placeholder="How should we greet you?" />
          </label>

          <label className="field">
            <span>Password</span>
            <input name="password" type="password" required placeholder="Create a strong password" />
          </label>

          <div className="field">
            <span>Avatar (optional)</span>
            <div className="avatar-section">
              <button
                type="button"
                className={`avatar-selector ${avatarPreview ? 'has-image' : ''}`}
                onClick={openAvatarPicker}
                aria-controls="avatar"
                aria-describedby={`avatar-hint${avatarError ? ' avatar-error' : ''}`}
                aria-label={avatarPreview ? 'Change avatar photo' : 'Upload avatar photo'}
              >
                {avatarPreview ? (
                  <>
                    <img src={avatarPreview} alt="Selected avatar preview" />
                    <span className="avatar-overlay">Change photo</span>
                    <span className="sr-only">Choose a different avatar</span>
                  </>
                ) : (
                  <div className="avatar-placeholder">
                    <span className="icon" aria-hidden="true">📷</span>
                    <span className="upload-title">Add photo</span>
                  </div>
                )}
              </button>

              <div className="avatar-actions">
                <p className="hint" id="avatar-hint">
                  Tap the photo to upload. Maximum size 5 MB.
                </p>
                {avatarPreview && (
                  <button type="button" onClick={clearAvatarSelection} className="secondary">
                    Remove photo
                  </button>
                )}
              </div>
            </div>
            {avatarError && (
              <p className="avatar-error" role="alert" id="avatar-error">
                {avatarError}
              </p>
            )}
            <input
              id="avatar"
              name="avatar"
              type="file"
              accept=".jpg,.jpeg,.png"
              onChange={handleAvatarChange}
              className="file-input"
              ref={fileInputRef}
            />
          </div>

          <button type="submit" disabled={loading} className="submit">
            {loading ? 'Signing you up…' : 'Create account'}
          </button>

          {error && <p className="error">{error}</p>}
        </form>
      </div>

      <style jsx>{`
        .page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 3rem 1.5rem;
          background: radial-gradient(circle at top, #ff9f7d, transparent 55%),
            radial-gradient(circle at bottom, #7da4ff, transparent 45%),
            #0f172a;
          color: #0f172a;
        }

        .card {
          width: 100%;
          max-width: 480px;
          background: #ffffff;
          padding: 2.5rem;
          border-radius: 24px;
          box-shadow: 0 30px 70px rgba(15, 23, 42, 0.25);
          position: relative;
          overflow: hidden;
        }

        .card::after {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: linear-gradient(135deg, rgba(124, 58, 237, 0.1), transparent 60%);
        }

        h1 {
          font-size: 2rem;
          margin: 0 0 0.5rem;
          font-weight: 700;
          color: #0f172a;
        }

        .subtitle {
          margin: 0 0 2rem;
          color: #475569;
          line-height: 1.5;
        }

        .form {
          display: grid;
          gap: 1.5rem;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .field span {
          font-weight: 600;
          color: #1e293b;
        }

        input[type='text'],
        input[type='password'],
        input[type='email'] {
          border: 1px solid #cbd5f5;
          border-radius: 12px;
          padding: 0.75rem 1rem;
          font-size: 1rem;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }

        input[type='text']:focus,
        input[type='password']:focus,
        input[type='email']:focus {
          outline: none;
          border-color: #6366f1;
          box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.15);
        }

        .avatar-section {
          display: flex;
          align-items: center;
          gap: 1.5rem;
        }

        .avatar-selector {
          appearance: none;
          width: 120px;
          height: 120px;
          border-radius: 50%;
          border: 2px dashed #cbd5f5;
          background: rgba(99, 102, 241, 0.06);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
          position: relative;
          overflow: hidden;
          padding: 0;
          color: inherit;
          font: inherit;
        }

        .avatar-selector:hover,
        .avatar-selector:focus-visible {
          border-color: #6366f1;
          background: rgba(99, 102, 241, 0.12);
          box-shadow: 0 12px 24px rgba(99, 102, 241, 0.15);
          outline: none;
        }

        .avatar-selector.has-image {
          border-style: solid;
          border-color: transparent;
          background: transparent;
          box-shadow: 0 12px 25px rgba(15, 23, 42, 0.25);
        }

        .avatar-selector img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .avatar-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(15, 23, 42, 0.55);
          color: #fff;
          font-weight: 600;
          font-size: 0.9rem;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.2s ease;
        }

        .avatar-selector:hover .avatar-overlay,
        .avatar-selector:focus-visible .avatar-overlay {
          opacity: 1;
        }

        .avatar-placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.35rem;
          color: #475569;
          text-align: center;
          padding: 1rem;
        }

        .icon {
          font-size: 1.75rem;
        }

        .upload-title {
          font-weight: 600;
          color: #1e293b;
        }

        .avatar-actions {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          align-items: flex-start;
        }

        .hint {
          font-size: 0.85rem;
          color: #64748b;
        }

        .avatar-error {
          margin: 0.75rem 0 0;
          font-size: 0.9rem;
          color: #b91c1c;
        }

        .secondary {
          border: none;
          background: rgba(15, 23, 42, 0.08);
          color: #1e293b;
          font-weight: 600;
          padding: 0.5rem 1rem;
          border-radius: 999px;
          cursor: pointer;
          transition: background 0.2s ease, transform 0.2s ease;
          width: fit-content;
        }

        .secondary:hover {
          background: rgba(15, 23, 42, 0.15);
          transform: translateY(-1px);
        }

        .file-input {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          border: 0;
        }

        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }

        .submit {
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          border: none;
          border-radius: 12px;
          padding: 0.85rem 1.25rem;
          font-size: 1rem;
          font-weight: 700;
          color: white;
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .submit:disabled {
          cursor: not-allowed;
          opacity: 0.7;
          transform: none;
          box-shadow: none;
        }

        .submit:not(:disabled):hover {
          transform: translateY(-2px);
          box-shadow: 0 18px 30px rgba(99, 102, 241, 0.35);
        }

        .error {
          margin: 0;
          padding: 0.75rem 1rem;
          background: rgba(239, 68, 68, 0.1);
          color: #b91c1c;
          border-radius: 12px;
          border: 1px solid rgba(239, 68, 68, 0.2);
        }

        @media (max-width: 600px) {
          .card {
            padding: 2rem 1.5rem;
            border-radius: 20px;
          }

          .avatar-section {
            flex-direction: column;
            gap: 1rem;
            align-items: center;
          }

          .avatar-actions {
            align-items: center;
          }

          .avatar-selector {
            width: 100px;
            height: 100px;
          }
        }
      `}</style>
    </div>
  );
}
