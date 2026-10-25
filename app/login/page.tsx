'use client';
import {useEffect, useState} from 'react';
export default function Login() {
  const [token, setToken] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [name, setName] = useState(''),
    [showPassword, setShowPassword] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(location.hash.slice(1));
    setToken(params.get('invite') || '');
    if (location.hash) history.replaceState(null, '', '/login');
  }, []);
  return (
    <main className="ob-login">
      <aside className="ob-login-brand">
        <div className="ob-wordmark">
          <span className="ob-dot">OB</span>
          OpenBooks
          <small>AU · self-hosted</small>
        </div>
        <div>
          <h1>
            Welcome {token ? 'aboard' : 'back'} to your <em>books</em>.
          </h1>
          <p>
            {token
              ? 'Use the invited email. Existing members should enter their current password.'
              : 'This installation runs on your computer. Your session, your data, your rules.'}
          </p>
          <dl className="ob-install">
            <div>
              <dt>Installation</dt>
              <dd>local · 127.0.0.1</dd>
            </div>
            <div>
              <dt>Business</dt>
              <dd>your private workspace</dd>
            </div>
            <div>
              <dt>Backups</dt>
              <dd>verified daily</dd>
            </div>
          </dl>
        </div>
        <p className="ob-secure">
          Sessions hashed · passwords salted with scrypt · nothing leaves this machine
        </p>
      </aside>
      <section className="ob-login-form">
        <div className="ob-login-card">
          <p className="ob-eyebrow">OpenBooks</p>
          <h2>{token ? 'Accept your invitation' : 'Sign in'}</h2>
          <p className="ob-sub">
            {token
              ? 'Join the business workspace you were invited to.'
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
              <label className="ob-field">
                Your name
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  placeholder="e.g. Sam Smith"
                />
              </label>
            )}
            <label className="ob-field">
              Email
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@yourbusiness.com.au"
                required
              />
            </label>
            <label className="ob-field">
              Password
              <span className="ob-password">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={token ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••••"
                  required
                  maxLength={128}
                />
                <button
                  type="button"
                  className="ob-reveal"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </span>
              {token && (
                <small className="ob-hint">
                  New accounts need a password of at least 14 characters.
                </small>
              )}
            </label>
            <button className="ob-btn" disabled={busy}>
              {busy ? 'Signing in…' : token ? 'Join business →' : 'Sign in →'}
            </button>
            {error && (
              <p role="alert" className="ob-error">
                {error}
              </p>
            )}
          </form>
          <p className="ob-fineprint">
            Access is by invitation from the installation owner. Forgotten password? Ask them for
            recovery — the app never emails you about it. First installation? Run{' '}
            <code>npm run setup</code> on your server.
          </p>
        </div>
      </section>
    </main>
  );
}
