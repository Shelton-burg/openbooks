'use client';
import {useEffect, useState} from 'react';
import {derive, report, money, type State} from '@/lib/books';
export default function Recovery({
  state,
  onState,
  canWrite,
}: {
  state: State;
  onState: (s: State) => void;
  canWrite: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [copy, setCopy] = useState<State | null>(null),
    [copyId, setCopyId] = useState(''),
    [maintenance, setMaintenance] = useState<any>(null);
  const snapshots = state.events.filter((e) => e.kind === 'backup_snapshot').reverse(),
    restores = state.events.filter((e) => e.kind === 'recovery_verified').reverse();
  useEffect(() => {
    fetch('/api/maintenance')
      .then((r) => r.json())
      .then(setMaintenance)
      .catch(() => {});
  }, [state.events.length]);
  async function act(action: string, id?: string) {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/recovery', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({action, id}),
      });
      const result: any = await r.json();
      if (!r.ok) throw new Error(result.error);
      onState(result.state);
      if (action === 'restore') await view(result.result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function view(id: string) {
    setError('');
    try {
      const r = await fetch('/api/recovery?id=' + id);
      const data: any = await r.json();
      if (!r.ok) throw new Error(data.error);
      setCopy(data);
      setCopyId(id);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="panel settings-panel book-form">
      <h2>Backup & recovery centre</h2>
      <p>
        Saved snapshots copy the records and original files. Restore into an isolated database copy
        and check its balances and attachments without replacing your live books.
      </p>
      <p className="notice">
        Background maintenance:{' '}
        {maintenance?.enabled ? 'Enabled; run schedule is managed on your server' : 'Not enabled'} ·
        Last run: {maintenance?.latest?.status || 'No run recorded'}
        {maintenance?.latest?.message ? ' · ' + maintenance.latest.message : ''}
      </p>
      <button className="btn primary" disabled={!canWrite || busy} onClick={() => act('snapshot')}>
        {busy ? 'Working…' : 'Create recovery snapshot'}
      </button>
      <p className="fineprint">
        Snapshots remain in this hosting account. Also keep downloaded ZIP backups somewhere
        independent.
      </p>
      {snapshots.map((e) => (
        <div className="match-row" key={e.id}>
          <div>
            <strong>{new Date(e.payload.createdAt).toLocaleString('en-AU')}</strong>
            <p>
              {e.payload.summary.documents} documents · {e.payload.summary.attachments} files
            </p>
          </div>
          <button
            className="btn"
            disabled={!canWrite || busy}
            onClick={() => act('restore', e.payload.id)}
          >
            Restore isolated copy & verify
          </button>
        </div>
      ))}
      {restores.map((e) => (
        <button key={e.id} className="text-btn" onClick={() => view(e.payload.id)}>
          Open verified recovery · {new Date(e.payload.createdAt).toLocaleString('en-AU')}
        </button>
      ))}
      {copy && (
        <div className="recovery-banner">
          <h3>Isolated recovery copy — read only</h3>
          <p>
            {copy.settings.name} · {derive(copy.events).docs.length} documents
          </p>
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Restored balance</th>
              </tr>
            </thead>
            <tbody>
              {report(copy.events, '0001-01-01', '9999-12-31', copy.settings.gstBasis)
                .trial.filter((a) => a.balance)
                .map((a) => (
                  <tr key={a.code}>
                    <td>
                      {a.code} {a.name}
                    </td>
                    <td>{money(a.balance)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <details>
            <summary>Recovered documents</summary>
            {derive(copy.events).docs.map((d) => (
              <p key={d.id}>
                {d.number} · {d.contact} · {money(d.total)} · {d.status}
              </p>
            ))}
          </details>
          <details>
            <summary>Recovered original files</summary>
            {copy.events
              .filter((e) => e.kind === 'attachment')
              .map((e) => (
                <p key={e.id}>
                  <a href={'/api/recovery?id=' + copyId + '&file=' + e.payload.id} download>
                    {e.payload.name}
                  </a>
                </p>
              ))}
          </details>
          <p>
            Your live books have not been replaced. A production recovery is a separate, reviewed
            operation.
          </p>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
