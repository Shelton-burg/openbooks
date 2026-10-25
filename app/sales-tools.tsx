'use client';
import {useEffect, useState} from 'react';
import {derive, today, type State} from '@/lib/books';
import {operations} from '@/lib/operations';
import {recurringRules} from '@/lib/invoicing';
import {Choice} from './book-ui';
export function EmailCentre({
  state,
  onState,
  canWrite,
  docId,
}: {
  state: State;
  onState: (s: State) => void;
  canWrite: boolean;
  docId?: string;
}) {
  const [configured, setConfigured] = useState(false),
    [kind, setKind] = useState('invoice'),
    [target, setTarget] = useState(docId || ''),
    [note, setNote] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [selected, setSelected] = useState('');
  const docs = derive(state.events).docs.filter(
      (d) => d.type === 'invoice' && d.posted && d.status !== 'void',
    ),
    contacts = operations(state.events).contacts.filter(
      (c) => !c.archived && c.role !== 'supplier',
    ),
    prepared = state.events
      .filter((e) => e.kind === 'email_prepared')
      .slice()
      .reverse(),
    current = prepared.find((e) => e.payload.id === selected)?.payload;
  useEffect(() => {
    fetch('/api/email')
      .then((r) => r.json())
      .then((r: any) => setConfigured(r.configured))
      .catch(() => {});
  }, []);
  async function send(body: unknown) {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/email', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
      });
      const data: any = await r.json();
      if (data.state) onState(data.state);
      if (!r.ok) throw new Error(data.error);
      if (data.draft) setSelected(data.draft.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel settings-panel book-form">
      <h2>Invoice email & statements</h2>
      <p className="notice">
        {configured
          ? 'Email service configured. Review the recipient and message before sending.'
          : 'Email sending needs a verified sender and Resend API connection. You can prepare and review messages now.'}
      </p>
      <Choice
        label="Message type"
        value={kind}
        onChange={(v) => {
          setKind(v);
          setTarget('');
        }}
        options={[
          ['invoice', 'Invoice'],
          ['reminder', 'Overdue reminder'],
          ['statement', 'Customer statement'],
        ]}
      />
      <Choice
        label="Customer or invoice"
        value={target || 'none'}
        onChange={(v) => setTarget(v === 'none' ? '' : v)}
        options={[
          ['none', 'Choose a record'],
          ...(kind === 'statement'
            ? contacts.map((c) => [c.id, c.name])
            : docs.map((d) => [d.id, d.number + ' · ' + d.contact])),
        ]}
      />
      <label>
        Personal message
        <textarea value={note} maxLength={1500} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button
        className="btn"
        disabled={!canWrite || busy || !target}
        onClick={() =>
          send({
            action: 'prepare',
            id: crypto.randomUUID(),
            kind,
            ...(kind === 'statement' ? {contactId: target} : {docId: target}),
            note,
          })
        }
      >
        Prepare email
      </button>
      {current && (
        <div className="attachment-section">
          <h3>{current.subject}</h3>
          <p>
            <strong>To: {current.to}</strong>
          </p>
          <div className="delivery-preview">{current.text}</div>
          <p className="fineprint">
            The full invoice or statement is included in the email. Payment details are shown above.
          </p>
          <button
            className="btn primary"
            disabled={!configured || !canWrite || busy}
            onClick={() => send({action: 'send', id: current.id, confirmed: true})}
          >
            Confirm recipient & send email
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <h3>Prepared messages & delivery history</h3>
      {prepared.map((e) => {
        const p = e.payload,
          status = state.events
            .filter((x) => x.kind === 'email_status' && x.payload.id === p.id)
            .at(-1)?.payload;
        return (
          <div className="match-row" key={e.id}>
            <div>
              <strong>{p.subject}</strong>
              <p>
                {p.to} · {status?.status || 'Prepared, not sent'}
              </p>
              {status?.detail && <p>{status.detail}</p>}
            </div>
            <button className="btn small" disabled={busy} onClick={() => setSelected(p.id)}>
              Review
            </button>
            {status?.providerId && (
              <button
                className="btn small"
                disabled={busy || !configured || !canWrite}
                onClick={() => send({action: 'status', id: p.id})}
              >
                Check delivery
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
export function RecurringInvoices({
  state,
  canWrite,
  mutate,
}: {
  state: State;
  canWrite: boolean;
  mutate: (b: unknown) => Promise<boolean>;
}) {
  const docs = derive(state.events).docs.filter((d) => d.type === 'invoice' && d.status !== 'void'),
    rules = recurringRules(state.events);
  const [name, setName] = useState(''),
    [templateId, setTemplate] = useState(''),
    [start, setStart] = useState(today()),
    [cadence, setCadence] = useState('monthly'),
    [terms, setTerms] = useState('14');
  return (
    <section className="panel settings-panel book-form">
      <h2>Recurring invoice drafts</h2>
      <p>
        Use a saved invoice as a template. Due occurrences create drafts once each. Review and post
        them before sending.
      </p>
      <form
        className="book-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await mutate({
              action: 'recurringRule',
              record: {
                id: crypto.randomUUID(),
                name,
                templateId,
                start,
                cadence,
                termsDays: Number(terms),
                paused: false,
              },
            })
          )
            setName('');
        }}
      >
        <label>
          Schedule name
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <Choice
          label="Template invoice"
          value={templateId || 'none'}
          onChange={setTemplate}
          options={[
            ['none', 'Choose an invoice'],
            ...docs.map((d) => [d.id, d.number + ' · ' + d.contact]),
          ]}
        />
        <label>
          First invoice date
          <input required type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <Choice
          label="Repeat"
          value={cadence}
          onChange={setCadence}
          options={[
            ['monthly', 'Monthly'],
            ['weekly', 'Weekly'],
          ]}
        />
        <label>
          Payment terms in days
          <input
            type="number"
            min="0"
            max="180"
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
          />
        </label>
        <button className="btn primary" disabled={!canWrite || !templateId}>
          Save recurring schedule
        </button>
      </form>
      <button className="btn" disabled={!canWrite} onClick={() => mutate({action: 'runRecurring'})}>
        Generate due drafts now
      </button>
      <p className="fineprint">
        Creates up to 12 due drafts per run. Dates in locked periods are skipped. Background
        generation uses the maintenance schedule when connected.
      </p>
      {rules.map((r) => (
        <div className="match-row" key={r.id}>
          <div>
            <strong>{r.name}</strong>
            <p>
              {r.cadence} from {r.start} · {r.paused ? 'Paused' : 'Active'}
            </p>
          </div>
          <button
            className="btn"
            disabled={!canWrite}
            onClick={() => mutate({action: 'recurringRule', record: {...r, paused: !r.paused}})}
          >
            {r.paused ? 'Resume' : 'Pause'}
          </button>
        </div>
      ))}
    </section>
  );
}
