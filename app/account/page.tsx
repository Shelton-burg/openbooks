'use client';
import {useEffect, useState} from 'react';
export default function Account() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [inviteUrl, setInviteUrl] = useState('');
  async function load() {
    const r = await fetch('/api/account', {cache: 'no-store'});
    if (r.status === 401) {
      location.assign('/login');
      return;
    }
    if (!r.ok) throw new Error('Could not load account.');
    setData(await r.json());
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function act(body: object) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const r = await fetch('/api/account', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(body),
        }),
        d = await r.json();
      if (!r.ok) throw new Error(d.error);
      await load();
      return d;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="community-account">
      <a className="text-btn" href="/">
        ← Back to books
      </a>
      <h1>Business & access</h1>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && <p className="notice">{message}</p>}
      {!data ? (
        <p>Loading account…</p>
      ) : (
        <>
          <p>
            Signed in as {data.user.name} · {data.user.email}
          </p>
          <section className="panel settings-panel">
            <h2>Your businesses</h2>
            {data.workspaces.map((w: any) => (
              <div className="community-member" key={w.id}>
                <span>
                  <strong>{w.name}</strong>
                  <small>{w.role}</small>
                </span>
                <button
                  className="btn"
                  disabled={busy || w.id === data.user.workspaceId}
                  onClick={async () => {
                    if (await act({action: 'switch', id: w.id})) location.assign('/');
                  }}
                >
                  {w.id === data.user.workspaceId ? 'Current business' : 'Open books'}
                </button>
              </div>
            ))}
            {data.user.role === 'owner' && (
              <form
                className="book-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  if (await act({action: 'create', name: form.get('name')})) location.assign('/');
                }}
              >
                <label>
                  New business name
                  <input name="name" required maxLength={160} />
                </label>
                <button className="btn" disabled={busy}>
                  Create separate business
                </button>
              </form>
            )}
          </section>
          {data.user.role === 'owner' && (
            <>
              <section className="panel settings-panel">
                <h2>People with access</h2>
                <p>
                  Owners manage access. Bookkeepers edit books. Viewers can read and export records.
                </p>
                {data.members.map((m: any) => (
                  <div className="community-member" key={m.id}>
                    <span>
                      <strong>{m.name}</strong>
                      <small>{m.email}</small>
                    </span>
                    {m.role === 'owner' ? (
                      <span>Owner</span>
                    ) : (
                      <>
                        <select
                          aria-label={'Role for ' + m.name}
                          value={m.role}
                          disabled={busy}
                          onChange={(e) => act({action: 'role', id: m.id, role: e.target.value})}
                        >
                          <option value="bookkeeper">Bookkeeper</option>
                          <option value="viewer">Viewer / accountant review</option>
                        </select>
                        <button
                          className="btn"
                          disabled={busy}
                          onClick={() => {
                            if (
                              confirm(
                                'Remove access for ' +
                                  m.name +
                                  '? Their active sessions for this business will end.',
                              )
                            )
                              act({action: 'role', id: m.id, role: 'remove'});
                          }}
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </section>
              <section className="panel settings-panel">
                <h2>Invite a colleague or accountant</h2>
                <form
                  className="book-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setInviteUrl('');
                    const f = new FormData(e.currentTarget),
                      r = await act({
                        action: 'invite',
                        email: f.get('email'),
                        role: f.get('role'),
                      });
                    if (r) setInviteUrl(r.url);
                  }}
                >
                  <label>
                    Invited email
                    <input name="email" required type="email" />
                  </label>
                  <label>
                    Access
                    <select name="role">
                      <option value="viewer">Viewer — read and export</option>
                      <option value="bookkeeper">Bookkeeper — edit records</option>
                    </select>
                  </label>
                  <button className="btn primary" disabled={busy}>
                    Create invitation link
                  </button>
                </form>
                {inviteUrl && (
                  <div className="notice">
                    <div>
                      <strong>Share this link privately with the invited person.</strong>
                      <p>No email was sent. This link expires in 72 hours and can be used once.</p>
                      <input aria-label="Invitation link" readOnly value={inviteUrl} />
                      <button
                        className="btn"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(inviteUrl);
                            setMessage('Invitation link copied.');
                          } catch {
                            setMessage('Select and copy the invitation link.');
                          }
                        }}
                      >
                        Copy link
                      </button>
                    </div>
                  </div>
                )}
                {data.invitations.map((i: any) => (
                  <div className="community-member" key={i.hash}>
                    <span>
                      {i.email}
                      <small>
                        {i.role} · expires {new Date(i.expires_at).toLocaleDateString('en-AU')}
                      </small>
                    </span>
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() => act({action: 'revoke', hash: i.hash})}
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </section>
              <details className="panel settings-panel">
                <summary>Access history</summary>
                {data.audit.map((a: any, i: number) => (
                  <p key={i}>
                    {new Date(a.created_at).toLocaleString('en-AU')} ·{' '}
                    {a.action.replaceAll('_', ' ')} · {a.detail}
                  </p>
                ))}
              </details>
            </>
          )}
          <section className="panel settings-panel">
            <h2>Change password</h2>
            <form
              className="book-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                if (
                  await act({
                    action: 'password',
                    current: f.get('current'),
                    password: f.get('password'),
                  })
                )
                  location.assign('/login');
              }}
            >
              <label>
                Current password
                <input name="current" type="password" required autoComplete="current-password" />
              </label>
              <label>
                New password
                <input
                  name="password"
                  type="password"
                  minLength={14}
                  maxLength={128}
                  required
                  autoComplete="new-password"
                />
              </label>
              <button className="btn" disabled={busy}>
                Change password & sign out
              </button>
            </form>
          </section>
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              await act({action: 'logout'});
              location.assign('/login');
            }}
          >
            Sign out
          </button>
        </>
      )}
    </main>
  );
}
