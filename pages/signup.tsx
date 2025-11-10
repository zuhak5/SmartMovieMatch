import React, { useState, FormEvent } from 'react';

export default function SignupPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const username = String(formData.get('username') || '');
    const display_name = String(formData.get('display_name') || '');
    const password = String(formData.get('password') || '');
    const avatar = formData.get('avatar') as File | null;

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
    <div style={{ maxWidth: 480, margin: '2rem auto' }}>
      <h1>Create your account</h1>
      <form onSubmit={handleSubmit}>
        <label>Username<br /><input name="username" required /></label><br />
        <label>Display name<br /><input name="display_name" required /></label><br />
        <label>Password<br /><input name="password" type="password" required /></label><br />
        <label>Avatar (optional)<br /><input name="avatar" type="file" accept="image/*" /></label><br />
        <button type="submit" disabled={loading}>{loading ? 'Signing up...' : 'Sign up'}</button>
        {error && <p style={{ color: 'red' }}>{error}</p>}
      </form>
    </div>
  );
}
