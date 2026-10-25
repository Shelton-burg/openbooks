'use client';
import {useRef, useState} from 'react';
import {Download, Paperclip} from 'lucide-react';
import {type State} from '@/lib/books';
import {attachments} from '@/lib/reliability';
export default function Attachments({
  target,
  state,
  canWrite,
  onState,
}: {
  target: string;
  state: State;
  canWrite: boolean;
  onState: (s: State) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    input = useRef<HTMLInputElement>(null),
    importSources = new Set(
      state.events
        .filter(
          (e) => e.kind === 'import_commit' && e.payload.records?.some((r: any) => r.id === target),
        )
        .map((e) => e.payload.sourceId),
    ),
    files = attachments(state.events).filter(
      (e) => e.payload.target === target || importSources.has(e.payload.id),
    );
  async function upload(file: File | undefined) {
    if (!file) return;
    setError('');
    if (file.size > 8000000) {
      setError('Choose a file up to 8 MB.');
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.append('id', crypto.randomUUID());
      body.append('target', target);
      body.append('revision', state.events.at(-1)?.id || 'empty');
      body.append('file', file);
      const response = await fetch('/api/attachments', {method: 'POST', body});
      const result = (await response.json()) as State & {error?: string};
      if (!response.ok) {
        if (response.status === 409) {
          const latest = await fetch('/api/books', {cache: 'no-store'});
          if (latest.ok) onState(await latest.json());
        }
        throw new Error(result.error);
      }
      onState(result);
      if (input.current) input.current.value = '';
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="attachment-section">
      <div className="section-actions">
        <h3>
          <Paperclip size={16} />
          Supporting documents
        </h3>
        <label className="btn">
          <input
            ref={input}
            className="sr-only"
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            disabled={!canWrite || busy}
            onChange={(e) => upload(e.target.files?.[0])}
          />
          {busy ? 'Uploading…' : 'Attach file'}
        </label>
      </div>
      <p className="fineprint">
        PDF, JPEG, PNG or WebP · up to 8 MB each · saved privately with this record
      </p>
      {files.map((e) => (
        <a
          key={e.id}
          className="attachment-link"
          href={'/api/attachments?id=' + encodeURIComponent(e.payload.id)}
          download
        >
          <Paperclip size={16} />
          <span>
            {e.payload.name}
            <small>{Math.ceil(e.payload.size / 1024)} KB</small>
          </span>
          <Download size={16} />
        </a>
      ))}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  );
}
