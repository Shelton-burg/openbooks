'use client';
import {useEffect, useMemo, useRef, useState} from 'react';
import {Upload, Download, FileText, CheckCircle2, ArrowRight, ScanLine} from 'lucide-react';
import {accounts, bankCodes, bankName, money, shortDate, totals, type State} from '@/lib/books';
import {
  importKinds,
  kindLabels,
  importFields,
  readImportCsv,
  guessColumns,
  importSpecSchema,
  templates,
  type ImportSpec,
  type ImportKind,
  type ImportPlan,
} from '@/lib/imports';
import {download, Empty} from './book-ui';
const newSpec = (kind: ImportKind = 'contacts') => importSpecSchema.parse({kind});
const destination: Record<ImportKind, string> = {
  contacts: 'Contacts',
  bank: 'Bank reconciliation',
  invoice: 'Invoices',
  bill: 'Bills & expenses',
  trial_balance: 'Xero comparison',
  reference: 'Xero comparison',
};
export default function ImportCentre({
  state,
  onState,
  canWrite,
  onGo,
}: {
  state: State;
  onState: (s: State) => void;
  canWrite: boolean;
  onGo: (view: string) => void;
}) {
  const [sourceId, setSourceId] = useState(''),
    [spec, setSpec] = useState<ImportSpec>(newSpec),
    [previewId, setPreviewId] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [drag, setDrag] = useState(false),
    [original, setOriginal] = useState(''),
    [configured, setConfigured] = useState(false),
    [scanWarnings, setScanWarnings] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null),
    latest = useRef(state);
  latest.current = state;
  const files = state.events.filter(
      (e) => e.kind === 'attachment' && e.payload.target === 'import_inbox',
    ),
    source = files.find((e) => e.payload.id === sourceId),
    commit = state.events.find(
      (e) => e.kind === 'import_commit' && e.payload.sourceId === sourceId,
    ),
    preview = state.events.find(
      (e) => e.kind === 'import_preview' && e.payload.id === previewId,
    )?.payload,
    plan = preview?.plan as ImportPlan | undefined;
  const working = !busy && canWrite && !commit;
  function update(s: State) {
    latest.current = s;
    onState(s);
  }
  function edit(patch: Partial<ImportSpec>) {
    setSpec((s) => ({...s, ...patch}));
    setPreviewId('');
    setConfirmed(false);
    setMessage('');
  }
  useEffect(() => {
    if (canWrite)
      fetch('/api/import-scan')
        .then((r) => r.json() as Promise<{configured?: boolean}>)
        .then((d) => setConfigured(d.configured === true))
        .catch(() => {});
  }, [canWrite]);
  useEffect(() => {
    if (!source) return;
    let disposed = false,
      url = '';
    setOriginal('');
    fetch('/api/attachments?id=' + encodeURIComponent(sourceId))
      .then(async (r) => {
        if (!r.ok) throw new Error('Could not load the original file.');
        const blob = await r.blob();
        if (disposed) return;
        if (source.payload.type !== 'text/csv') {
          url = URL.createObjectURL(blob);
          setOriginal(url);
        }
      })
      .catch((e) => !disposed && setError(e.message));
    return () => {
      disposed = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [sourceId, source?.payload.type]);
  const table = useMemo(() => {
    if (!spec.text.trim() || spec.kind === 'reference')
      return {headers: [] as string[], rows: [] as string[][], error: ''};
    try {
      return {...readImportCsv(spec.text), error: ''};
    } catch (e) {
      return {headers: [], rows: [], error: (e as Error).message};
    }
  }, [spec.text, spec.kind]);
  const values = (key: string) => {
    const i = spec.columns[key] ?? -1;
    return [...new Set(table.rows.map((row) => (i < 0 ? '' : row[i]?.trim() || '')))].sort();
  };
  async function selectFile(id: string, s = latest.current) {
    setSourceId(id);
    setError('');
    setMessage('');
    setConfirmed(false);
    setScanWarnings([]);
    const committed = s.events.find(
      (e) => e.kind === 'import_commit' && e.payload.sourceId === id,
    )?.payload;
    const saved = (
      committed
        ? s.events.find((e) => e.kind === 'import_preview' && e.payload.id === committed.previewId)
        : s.events.filter((e) => e.kind === 'import_preview' && e.payload.sourceId === id).at(-1)
    )?.payload;
    setPreviewId(saved?.id || '');
    if (saved) {
      setSpec(saved.spec);
      setScanWarnings(
        s.events
          .filter(
            (e) =>
              e.kind === 'import_extraction' &&
              e.payload.sourceId === id &&
              e.payload.kind === saved.spec.kind,
          )
          .at(-1)?.payload.warnings || [],
      );
      return;
    }
    setSpec(newSpec());
    const f = s.events.find((e) => e.kind === 'attachment' && e.payload.id === id);
    if (f?.payload.type === 'text/csv') {
      setBusy('Reading CSV…');
      try {
        const r = await fetch('/api/attachments?id=' + encodeURIComponent(id));
        if (!r.ok) throw new Error('Could not read this CSV.');
        const text = await r.text();
        let columns = {};
        try {
          columns = guessColumns(readImportCsv(text).headers, 'contacts');
        } catch {}
        setSpec({...newSpec(), text, columns});
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy('');
      }
    }
  }
  async function upload(list: FileList | File[] | null) {
    if (!list || !canWrite || busy) return;
    const batch = Array.from(list);
    if (batch.length > 10) {
      setError('Choose up to 10 files at a time.');
      return;
    }
    setBusy('Uploading originals…');
    setError('');
    setMessage('');
    const errors: string[] = [];
    let first = '';
    try {
      for (const file of batch) {
        try {
          const isCsv = /\.csv$/i.test(file.name);
          if (file.size > (isCsv ? 2000000 : 8000000))
            throw new Error(isCsv ? 'CSV limit is 2 MB.' : 'File limit is 8 MB.');
          const bytes = await file.arrayBuffer(),
            hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
              .map((n) => n.toString(16).padStart(2, '0'))
              .join(''),
            body = new FormData();
          body.append('id', crypto.randomUUID());
          body.append('target', 'import_inbox');
          body.append('revision', latest.current.events.at(-1)?.id || 'empty');
          body.append('file', file);
          const r = await fetch('/api/attachments', {method: 'POST', body}),
            data = (await r.json()) as State & {error?: string; state?: State};
          if (!r.ok) {
            if (r.status === 409) {
              const refresh = await fetch('/api/books', {cache: 'no-store'});
              if (refresh.ok) update((await refresh.json()) as State);
            }
            throw new Error(data.error || 'Upload failed.');
          }
          update(data);
          const saved = data.events.find(
            (e: any) =>
              e.kind === 'attachment' &&
              e.payload.sha256 === hash &&
              e.payload.target === 'import_inbox',
          );
          if (!first && saved) first = saved.payload.id;
        } catch (e) {
          errors.push(file.name + ': ' + (e as Error).message);
        }
      }
      if (first) await selectFile(first, latest.current);
      setError(errors.join('\n'));
      setMessage(first ? 'Original files saved. Choose a file below to review its contents.' : '');
    } finally {
      setBusy('');
      if (input.current) input.current.value = '';
    }
  }
  async function action(body: object) {
    const r = await fetch('/api/books', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({...body, revision: latest.current.events.at(-1)?.id || 'empty'}),
      }),
      data = (await r.json()) as State & {error?: string; state?: State};
    if (!r.ok) {
      if (data.state) update(data.state);
      throw new Error(data.error || 'Could not save.');
    }
    update(data);
    return data as State;
  }
  async function prepare() {
    setBusy('Checking import…');
    setError('');
    setConfirmed(false);
    try {
      const id = crypto.randomUUID();
      await action({action: 'previewImport', id, sourceId, spec});
      setPreviewId(id);
      setMessage('Preview saved. Check the totals, warnings and original file before confirming.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function finish() {
    setBusy('Saving import…');
    setError('');
    try {
      await action({action: 'commitImport', previewId, confirmed});
      setConfirmed(false);
      setMessage(
        'Import saved. The original file and reviewed preview are retained in your history.',
      );
    } catch (e) {
      setError((e as Error).message);
      setConfirmed(false);
    } finally {
      setBusy('');
    }
  }
  async function scan() {
    setBusy('Reading document…');
    setError('');
    try {
      const r = await fetch('/api/import-scan', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({sourceId, kind: spec.kind}),
        }),
        d = (await r.json()) as {
          error?: string;
          state: State;
          extraction: {text: string; warnings: string[]};
        };
      if (!r.ok) {
        const refresh = await fetch('/api/books', {cache: 'no-store'});
        if (refresh.ok) update((await refresh.json()) as State);
        throw new Error(d.error || 'Automatic reading failed.');
      }
      update(d.state);
      edit({
        text: d.extraction.text,
        columns: guessColumns(readImportCsv(d.extraction.text).headers, spec.kind),
        accounts: {},
        taxes: {},
      });
      setScanWarnings(d.extraction.warnings);
      setMessage(
        'Suggested table loaded. Check every row against the original, including missing pages and totals.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  function changeKind(kind: ImportKind) {
    const next = {...newSpec(kind), text: spec.text};
    try {
      next.columns = guessColumns(readImportCsv(spec.text).headers, kind);
    } catch {}
    edit(next);
    setScanWarnings([]);
  }
  return (
    <div className="import-centre">
      <div className="notice">
        <FileText size={20} />
        <span>
          Bring your records into OpenBooks. Upload an original, review a working copy, then confirm
          the import. Trial balances and dashboard screenshots can be saved as references.
        </span>
      </div>
      <div
        className={'import-drop ' + (drag ? 'dragging' : '')}
        onDragOver={(e) => {
          e.preventDefault();
          if (canWrite && !busy) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void upload(e.dataTransfer.files);
        }}
      >
        <Upload size={30} />
        <h2>Drop your files here</h2>
        <p>CSV exports, PDFs, screenshots and receipt photos</p>
        <button
          className="btn primary"
          disabled={!canWrite || !!busy}
          onClick={() => input.current?.click()}
        >
          <Upload size={16} />
          Choose files
        </button>
        <input
          ref={input}
          type="file"
          className="sr-only"
          multiple
          accept=".csv,application/pdf,image/png,image/jpeg,image/webp"
          onChange={(e) => void upload(e.target.files)}
        />
        <small>Up to 10 files · CSV 2 MB · PDF / PNG / JPG / WebP 8 MB each</small>
      </div>
      {busy && (
        <p role="status" className="notice">
          {busy}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error import-message">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <section className="panel import-files">
        <div className="panel-heading">
          <div>
            <h2>Files & import history</h2>
            <p>{files.length} saved originals · Nothing posts automatically</p>
          </div>
          <button className="text-btn" onClick={() => onGo('Migration & backups')}>
            Backups & migration <ArrowRight size={16} />
          </button>
        </div>
        {files.length ? (
          <div className="import-file-list">
            {files
              .slice()
              .reverse()
              .map((f) => {
                const done = state.events.find(
                    (e) => e.kind === 'import_commit' && e.payload.sourceId === f.payload.id,
                  ),
                  saved = state.events.some(
                    (e) => e.kind === 'import_preview' && e.payload.sourceId === f.payload.id,
                  );
                return (
                  <button
                    key={f.id}
                    disabled={!!busy}
                    className={'import-file ' + (sourceId === f.payload.id ? 'active' : '')}
                    onClick={() => void selectFile(f.payload.id)}
                  >
                    <FileText size={19} />
                    <span>
                      <strong>{f.payload.name}</strong>
                      <small>
                        {Math.ceil(f.payload.size / 1024)} KB ·{' '}
                        {shortDate(f.createdAt.slice(0, 10))}
                      </small>
                    </span>
                    <span className={'status ' + (done ? 'paid' : 'draft')}>
                      {done
                        ? done.payload.referenceOnly
                          ? 'Reference saved'
                          : 'Imported'
                        : saved
                          ? 'Preview saved'
                          : 'Awaiting review'}
                    </span>
                  </button>
                );
              })}
          </div>
        ) : (
          <Empty title="Start with a Xero export or source document">
            Your original files will stay available here after you import them.
          </Empty>
        )}
      </section>
      {source && (
        <section className="panel import-review">
          <div className="panel-heading">
            <div>
              <h2>{source.payload.name}</h2>
              <p>{commit ? 'Saved import' : 'Review this file'}</p>
            </div>
            <a
              className="btn"
              href={'/api/attachments?id=' + encodeURIComponent(sourceId)}
              download
            >
              <Download size={16} />
              Original
            </a>
          </div>
          {commit && (
            <div className="notice">
              <CheckCircle2 size={20} />
              <span>
                {commit.payload.referenceOnly
                  ? 'Reference saved; your ledger was not changed.'
                  : commit.payload.count + ' records imported.'}{' '}
                {commit.payload.skipped.length} duplicate rows skipped.
              </span>
              <button onClick={() => onGo(destination[commit.payload.kind as ImportKind])}>
                Continue <ArrowRight size={16} />
              </button>
            </div>
          )}
          <fieldset disabled={!working} className="import-options">
            <label>
              What does this file contain?
              <select value={spec.kind} onChange={(e) => changeKind(e.target.value as ImportKind)}>
                {importKinds.map((k) => (
                  <option key={k} value={k}>
                    {kindLabels[k]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Notes about this import
              <textarea
                value={spec.notes}
                maxLength={2000}
                placeholder="Source, export period, or what this screenshot shows…"
                onChange={(e) => edit({notes: e.target.value})}
              />
            </label>
          </fieldset>
          <div className={'import-workbench ' + (original ? 'with-original' : '')}>
            {original && (
              <aside>
                <h3>Original document</h3>
                {source.payload.type === 'application/pdf' ? (
                  <object className="import-original" data={original} type="application/pdf">
                    <p>Use Download original to view this PDF.</p>
                  </object>
                ) : (
                  <img
                    className="import-original"
                    src={original}
                    alt="Uploaded source for checking the working table"
                  />
                )}
              </aside>
            )}
            <div className="import-working">
              {spec.kind !== 'reference' && (
                <>
                  {source.payload.type !== 'text/csv' && (
                    <div className="import-ai">
                      <h3>
                        <ScanLine size={18} />
                        Read a table from this document
                      </h3>
                      <p>
                        {configured
                          ? 'Read with AI sends this document to OpenAI. Review all suggested values against the original.'
                          : 'Automatic reading is not connected yet. Enter or paste a CSV table below, or save the document as a reference.'}
                      </p>
                      <button className="btn" disabled={!working || !configured} onClick={scan}>
                        Read with AI
                      </button>
                      {scanWarnings.length > 0 && (
                        <ul>
                          {scanWarnings.map((w, i) => (
                            <li key={i}>{w}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  <div className="section-actions">
                    <h3>Working copy</h3>
                    <button
                      className="text-btn"
                      disabled={!working}
                      onClick={() =>
                        edit({
                          text: importFields[spec.kind].map((f) => f.key).join(',') + '\n',
                          columns: {},
                          accounts: {},
                          taxes: {},
                        })
                      }
                    >
                      Start empty table
                    </button>
                    <button
                      className="text-btn"
                      onClick={() =>
                        download('example-' + spec.kind + '.csv', templates[spec.kind])
                      }
                    >
                      <Download size={14} />
                      Example CSV
                    </button>
                  </div>
                  <p className="fineprint">
                    Edit the working copy without changing your original file. Dates: DD/MM/YYYY or
                    YYYY-MM-DD. Example files contain fictional rows—replace them with your own
                    records.
                  </p>
                  <label>
                    CSV working table
                    <textarea
                      className="import-csv"
                      spellCheck={false}
                      disabled={!working}
                      value={spec.text}
                      onChange={(e) => {
                        let columns = spec.columns;
                        try {
                          const next = readImportCsv(e.target.value);
                          if (JSON.stringify(next.headers) !== JSON.stringify(table.headers))
                            columns = guessColumns(next.headers, spec.kind);
                        } catch {}
                        edit({text: e.target.value, columns});
                      }}
                      placeholder="Paste the header and rows from your export here…"
                    />
                  </label>
                  {table.error && <p className="form-error">{table.error}</p>}
                  {table.rows.length > 0 && (
                    <>
                      <details open>
                        <summary>Check source rows · {table.rows.length} rows</summary>
                        <div className="import-table-scroll">
                          <table>
                            <thead>
                              <tr>
                                {table.headers.map((h) => (
                                  <th key={h}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {table.rows.slice(0, 30).map((row, i) => (
                                <tr key={i}>
                                  {row.map((c, j) => (
                                    <td key={j}>{c}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {table.rows.length > 30 && (
                          <p className="fineprint">
                            Showing the first 30 rows. All {table.rows.length} rows are validated in
                            the preview.
                          </p>
                        )}
                      </details>
                      <fieldset disabled={!working}>
                        <h3>Match your columns</h3>
                        <div className="import-map-grid">
                          {importFields[spec.kind].map((f) => (
                            <label key={f.key}>
                              {f.label}
                              {f.required ? ' *' : ''}
                              <select
                                value={spec.columns[f.key] ?? -1}
                                onChange={(e) =>
                                  edit({
                                    columns: {...spec.columns, [f.key]: Number(e.target.value)},
                                    ...(f.key === 'account'
                                      ? {accounts: {}}
                                      : f.key === 'tax'
                                        ? {taxes: {}}
                                        : {}),
                                  })
                                }
                              >
                                <option value={-1}>Not supplied</option>
                                {table.headers.map((h, i) => (
                                  <option key={i} value={i}>
                                    {h}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
          {spec.kind !== 'reference' && (
            <fieldset disabled={!working} className="import-options">
              {spec.kind === 'contacts' && (
                <label>
                  Type when no contact-type column is supplied
                  <select
                    value={spec.defaultRole}
                    onChange={(e) =>
                      edit({defaultRole: e.target.value as ImportSpec['defaultRole']})
                    }
                  >
                    <option value="customer">Customer</option>
                    <option value="supplier">Supplier</option>
                    <option value="both">Customer & supplier</option>
                  </select>
                </label>
              )}
              {spec.kind === 'bank' && (
                <label>
                  Bank account
                  <select
                    value={spec.bankAccount}
                    onChange={(e) =>
                      edit({bankAccount: e.target.value as ImportSpec['bankAccount']})
                    }
                  >
                    {bankCodes.map((c) => (
                      <option key={c} value={c}>
                        {bankName(c, state.settings)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {['invoice', 'bill'].includes(spec.kind) && (
                <label>
                  Prices in this file
                  <select
                    value={spec.priceBasis}
                    onChange={(e) => edit({priceBasis: e.target.value as ImportSpec['priceBasis']})}
                  >
                    <option value="unconfirmed">Choose GST basis</option>
                    <option value="inclusive">Unit prices include GST</option>
                    <option value="exclusive">Unit prices exclude GST</option>
                  </select>
                </label>
              )}
              {spec.kind === 'trial_balance' && (
                <label>
                  Trial balance as at
                  <input
                    type="date"
                    value={spec.date || ''}
                    onChange={(e) => edit({date: e.target.value || undefined})}
                  />
                </label>
              )}
              {['invoice', 'bill', 'trial_balance'].includes(spec.kind) &&
                table.rows.length > 0 && (
                  <div className="import-full">
                    <h3>Match account codes</h3>
                    <p className="fineprint">
                      Choose each account explicitly. A blank source code needs a mapping too.
                    </p>
                    <div className="import-map-grid">
                      {values('account').map((v) => (
                        <label key={v}>
                          {v || '(blank source account)'}
                          <select
                            value={spec.accounts[v] || ''}
                            onChange={(e) =>
                              edit({accounts: {...spec.accounts, [v]: e.target.value}})
                            }
                          >
                            <option value="">Choose account</option>
                            {accounts
                              .filter(
                                (a) =>
                                  spec.kind === 'trial_balance' ||
                                  (spec.kind === 'invoice'
                                    ? a[2] === 'income'
                                    : a[2] === 'expense' || a[0] === '150'),
                              )
                              .map((a) => (
                                <option key={a[0]} value={a[0]}>
                                  {a[0]} · {a[1]}
                                </option>
                              ))}
                          </select>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              {['invoice', 'bill'].includes(spec.kind) && table.rows.length > 0 && (
                <div className="import-full">
                  <h3>Match tax treatment</h3>
                  <div className="import-map-grid">
                    {values('tax').map((v) => (
                      <label key={v}>
                        {v || '(blank source tax)'}
                        <select
                          value={spec.taxes[v] || ''}
                          onChange={(e) => {
                            const taxes = {...spec.taxes};
                            if (e.target.value)
                              taxes[v] = e.target.value as 'gst' | 'free' | 'none';
                            else delete taxes[v];
                            edit({taxes});
                          }}
                        >
                          <option value="">Choose tax treatment</option>
                          <option value="gst">10% GST</option>
                          <option value="free">GST-free</option>
                          <option value="none">No GST / out of scope</option>
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {spec.kind !== 'contacts' && (
                <label className="review-checkbox import-full">
                  <input
                    type="checkbox"
                    checked={spec.audConfirmed}
                    onChange={(e) => edit({audConfirmed: e.target.checked})}
                  />
                  I have checked that the source amounts are in Australian dollars.
                </label>
              )}
            </fieldset>
          )}
          {!commit && (
            <button
              className="btn primary"
              disabled={
                !working || !!table.error || (spec.kind !== 'reference' && !table.rows.length)
              }
              onClick={prepare}
            >
              Validate & save preview <ArrowRight size={16} />
            </button>
          )}
          {plan && (
            <section className="import-plan">
              <h3>Saved preview · {kindLabels[plan.kind]}</h3>
              <div className="import-totals">
                <div>
                  <small>
                    {['reference', 'trial_balance'].includes(plan.kind)
                      ? 'Reference records'
                      : 'Records to import'}
                  </small>
                  <strong>{plan.count}</strong>
                </div>
                <div>
                  <small>Duplicate rows skipped</small>
                  <strong>{plan.skipped.length}</strong>
                </div>
                {['invoice', 'bill', 'bank'].includes(plan.kind) && (
                  <div>
                    <small>{plan.kind === 'bank' ? 'Net bank movement' : 'Document total'}</small>
                    <strong>{money(plan.total)}</strong>
                  </div>
                )}
                {['invoice', 'bill'].includes(plan.kind) && (
                  <div>
                    <small>GST</small>
                    <strong>{money(plan.gst)}</strong>
                  </div>
                )}
                {plan.kind === 'trial_balance' && (
                  <>
                    <div>
                      <small>Debits</small>
                      <strong>{money(plan.debits)}</strong>
                    </div>
                    <div>
                      <small>Credits</small>
                      <strong>{money(plan.credits)}</strong>
                    </div>
                  </>
                )}
              </div>
              {plan.errors.length > 0 && (
                <div className="review-blockers">
                  <h3>Fix {plan.errors.length} errors before importing</h3>
                  <ul>
                    {plan.errors.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>
              )}
              {plan.warnings.length > 0 && (
                <div className="review-blockers">
                  <h3>Check before continuing</h3>
                  <ul>
                    {plan.warnings.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>
              )}
              {plan.skipped.length > 0 && (
                <details>
                  <summary>{plan.skipped.length} skipped duplicates</summary>
                  <ul>
                    {plan.skipped.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </details>
              )}
              <details>
                <summary>Reviewed records</summary>
                <div className="import-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Record</th>
                        <th>Details</th>
                        <th>Amount / balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.documents.map((d) => (
                        <tr key={d.id}>
                          <td>{d.number}</td>
                          <td>
                            {d.contact} · {d.lines.length} lines · {d.date} · draft
                          </td>
                          <td>{money(totals(d).total)}</td>
                        </tr>
                      ))}
                      {plan.contacts.map((c) => (
                        <tr key={c.id}>
                          <td>{c.name}</td>
                          <td>{c.email || c.role}</td>
                          <td>—</td>
                        </tr>
                      ))}
                      {plan.banks.map((b, i) => (
                        <tr key={i}>
                          <td>
                            {b.date} · {b.reference}
                          </td>
                          <td>{b.description}</td>
                          <td>{money(b.amount)}</td>
                        </tr>
                      ))}
                      {plan.balances.map((b) => (
                        <tr key={b.account}>
                          <td>
                            {b.source} → {b.account}
                          </td>
                          <td>{b.name}</td>
                          <td>{money(b.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
              {!commit && (
                <>
                  <label className="review-checkbox">
                    <input
                      type="checkbox"
                      disabled={!working || !!plan.errors.length}
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    I checked the original, all rows, totals, mappings and duplicate warnings.{' '}
                    {['reference', 'trial_balance'].includes(plan.kind)
                      ? 'Save this as a reference only.'
                      : plan.kind === 'bank'
                        ? 'Add these bank lines for reconciliation.'
                        : plan.kind === 'contacts'
                          ? 'Add the new contacts without overwriting existing ones.'
                          : 'Create these invoices or bills as drafts for review.'}
                  </label>
                  <button
                    className="btn primary"
                    disabled={!working || !confirmed || !!plan.errors.length}
                    onClick={finish}
                  >
                    {['reference', 'trial_balance'].includes(plan.kind)
                      ? 'Save reference'
                      : 'Confirm import'}
                  </button>
                </>
              )}
            </section>
          )}
        </section>
      )}
      <p className="fineprint">
        This imports selected records, not a complete Xero history. Paid invoices, credits and
        opening balances need a separate migration review. Keep Xero until your balances and
        supporting records have been compared.
      </p>
    </div>
  );
}
