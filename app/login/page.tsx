'use client';
import {useEffect, useState} from 'react';
export default function Login() {
  const [token, setToken] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [name, setName] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(location.hash.slice(1));
    setToken(params.get('invite') || '');
    if (location.hash) history.replaceState(null, '', '/login');
  }, []);
  return (
    <main className="community-login">
      <div className="community-login-card">
        <p className="eyebrow">TRADEDESK BOOKS · COMMUNITY</p>
        <h1>{token ? 'Accept your invitation' : 'Welcome back'}</h1>
        <p>
          {token
            ? 'Use the invited email. Existing members should enter their current password.'
            : 'Sign in to your private business workspace.'}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const r = await fetch('/api/account', {
                  method: 'POST',
                  headers: {'Content-Type': 'application/json'},
                  body: JSON.stringify({
                    action: token ? 'accept' : 'login',
                    token,
                    email,
                    name,
                    password,
                  }),
                }),
                d = await r.json();
              if (!r.ok) throw new Error(d.error);
              location.assign('/');
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {token && (
            <label>
              Your name
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
              />
            </label>
          )}
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete={token ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              maxLength={128}
            />
          </label>
          {token && <small>New accounts need a password of at least 14 characters.</small>}
          <button className="btn primary" disabled={busy}>
            {busy ? 'Signing in…' : token ? 'Join business' : 'Sign in'}
          </button>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </form>
        <p className="fineprint">
          Invite-only beta. Ask your installation owner for access or password recovery. First
          installation? Run <code>npm run setup</code> on your server.
        </p>
      </div>
    </main>
  );
}
