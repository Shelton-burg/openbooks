'use client';
import {useEffect, useState} from 'react';
import {type Receipt, receiptSchema} from '@/lib/receipt';
import {attachments} from '@/lib/reliability';
import type {State} from '@/lib/books';
export default function ReceiptUpload({
  file,
  onFile,
  onRead,
  disabled,
  onBusy,
  state,
  onState,
  attachmentId,
  onAttachment,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  onRead: (r: Receipt) => void;
  disabled: boolean;
  onBusy: (b: boolean) => void;
  state: State;
  onState: (s: State) => void;
  attachmentId: string;
  onAttachment: (id: string) => void;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [preview, setPreview] = useState('');
  const saved = attachments(state.events),
    selected = saved.find((e) => e.payload.id === attachmentId),
    inbox = saved.filter((e) => e.payload.target === 'inbox');
  useEffect(() => {
    fetch('/api/receipt-scan', {cache: 'no-store'})
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((r) => setConfigured((r as {configured: boolean}).configured))
      .catch(() => setError('Unable to check the AI connection.'));
  }, []);
  useEffect(() => {
    if (!file) {
      setPreview('');
      return;
    }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  async function selectFile(f: File | undefined) {
    if (!f) return;
    setError('');
    if (!f.size || f.size > 8000000) {
      setError('Choose a file up to 8 MB.');
      return;
    }
    setBusy(true);
    onBusy(true);
    try {
      const body = new FormData();
      body.append('id', crypto.randomUUID());
      body.append('target', 'inbox');
      body.append('revision', state.events.at(-1)?.id || 'empty');
      body.append('file', f);
      const r = await fetch('/api/attachments', {method: 'POST', body});
      const data = (await r.json()) as State & {error?: string};
      if (!r.ok) throw new Error(data.error);
      onState(data);
      const digest = [
        ...new Uint8Array(await crypto.subtle.digest('SHA-256', await f.arrayBuffer())),
      ]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const entry = attachments(data.events).find((e) => e.payload.sha256 === digest);
      if (!entry)
        throw new Error(
          'Upload could not be confirmed. Open the saved receipt inbox to recover it.',
        );
      onAttachment(entry.payload.id);
      onFile(f);
    } catch (e) {
      setError((e as Error).message);
      const r = await fetch('/api/books', {cache: 'no-store'});
      if (r.ok) onState((await r.json()) as State);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  async function recover(id: string) {
    setError('');
    if (!id) {
      onAttachment('');
      onFile(null);
      return;
    }
    setBusy(true);
    onBusy(true);
    try {
      const e = saved.find((e) => e.payload.id === id);
      const r = await fetch('/api/attachments?id=' + id);
      if (!r.ok) throw new Error('Could not load this receipt.');
      onFile(new File([await r.blob()], e?.payload.name || 'receipt', {type: e?.payload.type}));
      onAttachment(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  async function scan() {
    if (!file || !attachmentId) return;
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      const r = await fetch('/api/receipt-scan', {method: 'POST', body});
      const data = (await r.json()) as {error?: string; receipt?: unknown};
      if (!r.ok) throw new Error(data.error || 'Unable to scan receipt.');
      onRead(receiptSchema.parse(data.receipt));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <section className="attachment-section receipt-capture">
      <h3>Receipt capture</h3>
      <p className="fineprint">
        PDF, PNG, JPEG or WebP · up to 8 MB. Uploads are saved to your receipt inbox immediately.
      </p>
      <div className="section-actions">
        <label className="btn">
          Choose receipt
          <input
            className="sr-only"
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            disabled={disabled || busy}
            onChange={(e) => {
              void selectFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        <label className="btn">
          Take photo
          <input
            className="sr-only"
            type="file"
            accept="image/*"
            capture="environment"
            disabled={disabled || busy}
            onChange={(e) => {
              void selectFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {inbox.length > 0 && (
        <label>
          Recover an uploaded receipt
          <select
            value={inbox.some((e) => e.payload.id === attachmentId) ? attachmentId : ''}
            disabled={disabled || busy}
            onChange={(e) => recover(e.target.value)}
          >
            <option value="">Select from inbox</option>
            {inbox.map((e) => (
              <option key={e.id} value={e.payload.id}>
                {e.payload.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {selected && (
        <p className="notice">
          Saved: {selected.payload.name}{' '}
          {!file && (
            <button
              className="text-btn"
              type="button"
              disabled={busy || disabled}
              onClick={() => recover(attachmentId)}
            >
              View receipt
            </button>
          )}{' '}
          <button
            className="text-btn"
            type="button"
            disabled={busy || disabled}
            onClick={() => {
              onAttachment('');
              onFile(null);
            }}
          >
            Use a different receipt
          </button>
        </p>
      )}
      {preview &&
        (file?.type === 'application/pdf' ? (
          <object className="receipt-preview" data={preview} type="application/pdf">
            <a href={preview} target="_blank" rel="noreferrer">
              Open PDF preview
            </a>
          </object>
        ) : (
          <img className="receipt-preview" src={preview} alt="Uploaded supplier receipt" />
        ))}
      <button
        className="btn"
        type="button"
        disabled={!file || !attachmentId || !configured || busy || disabled}
        onClick={scan}
      >
        {busy ? 'Working…' : 'Scan receipt with AI'}
      </button>
      {configured === false && (
        <p className="fineprint">
          AI scanning needs its API connection. Your original receipt can still be saved and linked
          to the bill.
        </p>
      )}
      {configured && (
        <p className="fineprint">
          Scanning sends this receipt to OpenAI. Review the suggestions before applying them.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
