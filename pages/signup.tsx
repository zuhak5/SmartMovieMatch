import React, { useState, FormEvent, ChangeEvent, useEffect, useRef } from 'react';

export default function SignupPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
      if (file.size > 5 * 1024 * 1024) {
        setError('Avatar must be 5 MB or smaller.');
        event.target.value = '';
        setAvatarFile(null);
        setAvatarPreview(null);
        return;
      }
      setError((prev) => (prev === 'Avatar must be 5 MB or smaller.' ? null : prev));
      const previewUrl = URL.createObjectURL(file);
      setAvatarFile(file);
      setAvatarPreview(previewUrl);
    } else {
      setAvatarFile(null);
      setAvatarPreview(null);
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
    setError((prev) => (prev === 'Avatar must be 5 MB or smaller.' ? null : prev));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const username = String(formData.get('username') || '');
    const display_name = String(formData.get('display_name') || '');
    const password = String(formData.get('password') || '');
    const avatar = avatarFile;

    let avatarBase64: string | null = null;
    let avatarFileName: string | null = null;

    if (avatar && avatar.size > 0) {
      const arrayBuffer = await avatar.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      avatarBase64 = base64;
      avatarFileName = avatar.name;
    }

    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, display_name, password, avatarBase64, avatarFileName }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data?.error || 'Signup failed');
      return;
    }

    alert('Signup successful! Token: ' + data.token);
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
            <label className={`upload-area ${avatarPreview ? 'has-preview' : ''}`} htmlFor="avatar">
              {avatarPreview ? (
                <div className="preview">
                  <img src={avatarPreview} alt="Avatar preview" />
                  <div className="preview-actions">
                    <button type="button" onClick={clearAvatarSelection} className="secondary">
                      Remove
                    </button>
                    <span className="hint">Upload a different photo</span>
                  </div>
                </div>
              ) : (
                <div className="upload-content">
                  <span className="icon" aria-hidden="true">📷</span>
                  <p className="upload-title">Upload a profile photo</p>
                  <p className="hint">PNG or JPG, up to 5 MB</p>
                  <span className="upload-btn">Browse files</span>
                </div>
              )}
            </label>
            <input
              id="avatar"
              name="avatar"
              type="file"
              accept="image/*"
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

        .upload-area {
          border: 2px dashed #cbd5f5;
          border-radius: 16px;
          padding: 1.75rem;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(99, 102, 241, 0.04);
          cursor: pointer;
          transition: border-color 0.2s ease, background 0.2s ease, transform 0.2s ease;
          position: relative;
        }

        .upload-area:hover {
          border-color: #6366f1;
          background: rgba(99, 102, 241, 0.08);
          transform: translateY(-1px);
        }

        .upload-area.has-preview {
          padding: 1rem;
        }

        .upload-content {
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
          color: #475569;
        }

        .icon {
          font-size: 2rem;
        }

        .upload-title {
          font-weight: 600;
          color: #1e293b;
        }

        .hint {
          font-size: 0.85rem;
          color: #64748b;
        }

        .upload-btn {
          margin-top: 0.5rem;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0.5rem 1rem;
          border-radius: 999px;
          background: #6366f1;
          color: white;
          font-weight: 600;
          font-size: 0.9rem;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .upload-area:hover .upload-btn {
          transform: translateY(-1px);
          box-shadow: 0 10px 20px rgba(99, 102, 241, 0.3);
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

        .preview {
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.75rem;
        }

        .preview img {
          width: 120px;
          height: 120px;
          border-radius: 50%;
          object-fit: cover;
          box-shadow: 0 12px 25px rgba(15, 23, 42, 0.25);
        }

        .preview-actions {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.35rem;
        }

        .secondary {
          border: none;
          background: rgba(15, 23, 42, 0.08);
          color: #1e293b;
          font-weight: 600;
          padding: 0.4rem 0.9rem;
          border-radius: 999px;
          cursor: pointer;
          transition: background 0.2s ease, transform 0.2s ease;
        }

        .secondary:hover {
          background: rgba(15, 23, 42, 0.15);
          transform: translateY(-1px);
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

          .upload-area {
            padding: 1.5rem;
          }

          .preview img {
            width: 100px;
            height: 100px;
          }
        }
      `}</style>
    </div>
  );
}
