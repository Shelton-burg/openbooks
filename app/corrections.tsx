'use client';
import {useState} from 'react';
import {activeEvents, money, type State} from '@/lib/books';
import {unmatchPlan} from '@/lib/reliability';
export default function Corrections({
  state,
  canWrite,
  mutate,
}: {
  state: State;
  canWrite: boolean;
  mutate: (b: unknown) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState(''),
    [reason, setReason] = useState(''),
    [error, setError] = useState('');
  const rows = activeEvents(state.events)
    .filter((e) => ['payment', 'cash', 'transfer', 'settle'].includes(e.kind))
    .reverse();
  return (
    <section className="panel settings-panel">
      <h2>Correct a bank match</h2>
      <p>
        Undo an incorrect match or categorisation, then reconcile the statement line again. The
        original and the reason stay in your audit history. Locked periods and dependent adjustments
        are protected.
      </p>
      <label>
        Current match
        <select
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setError('');
          }}
        >
          <option value="">Choose a match</option>
          {rows.map((e) => (
            <option key={e.id} value={e.id}>
              {e.payload.journal?.date || e.payload.date} ·{' '}
              {e.payload.journal?.reference || e.payload.docId} · {e.kind}
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <form
          className="book-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            try {
              unmatchPlan(state.events, selected, reason, state.settings);
              if (await mutate({action: 'unmatch', eventId: selected, reason})) {
                setSelected('');
                setReason('');
              }
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <label>
            Why is this being corrected?
            <textarea
              required
              minLength={10}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button className="btn" disabled={!canWrite}>
            Undo match and return to reconciliation
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  );
}
