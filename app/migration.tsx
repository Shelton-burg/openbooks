'use client';
import {useState} from 'react';
import {Download, Upload, ShieldCheck, ArrowRight} from 'lucide-react';
import {Tabs, TabsList, TabsTrigger, TabsContent} from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {Table, TableHeader, TableBody, TableHead, TableRow, TableCell} from '@/components/ui/table';
import {Choice, Empty, download} from './book-ui';
import {accounts, derive, money, today, totals, type State, type Doc} from '@/lib/books';
import {inspectDocumentCSV, documentImport} from '@/lib/migration';
import {verifyBackup} from '@/lib/backup';
type Props = {
  state: State;
  canWrite: boolean;
  mutate: (v: unknown) => Promise<boolean>;
  onGo: (view: string) => void;
};
const areas = [
  [
    'exports',
    'Preserve Xero records',
    'Export the general ledger, trial balance, contacts, unpaid invoices and bills, bank statements, GST reports and original supporting files.',
  ],
  [
    'opening',
    'Agree the opening balances',
    'Choose a cutover date and map the trial balance with your accountant. Coordinate control accounts with opening documents so balances are not counted twice.',
  ],
  [
    'bank',
    'Reconcile every bank account',
    'Compare imported statement coverage and closing balances for all bank and cash accounts, not just the main account.',
  ],
  [
    'receivables',
    'Check what customers owe',
    'Match each unpaid invoice and any customer credit or advance to Xero. Partly paid opening documents require a separate migration calculation.',
  ],
  [
    'payables',
    'Check what you owe suppliers',
    'Match every unpaid bill, supplier credit and outstanding payment to Xero.',
  ],
  [
    'gst',
    'Compare a full GST period',
    'Use the same cash/non-cash basis and reporting dates. Review all GST evidence, credits, refunds and late claims.',
  ],
  [
    'backup',
    'Verify records and recovery',
    'Download the full backup and verify its files and reconstructed balances here. A tested live restore is still required before cutover.',
  ],
  [
    'accountant',
    'Record independent review',
    'Record your accountant’s findings and unresolved items. A self-checked item is not independent approval.',
  ],
] as const;
export default function MigrationHub({state, canWrite, mutate, onGo}: Props) {
  const [edit, setEdit] = useState<{
      area: string;
      status: string;
      notes: string;
      date: string;
    } | null>(null),
    latest = new Map(
      state.events
        .filter((e) => e.kind === 'migration_note')
        .map((e) => [e.payload.area, e.payload]),
    ),
    v = derive(state.events);
  return (
    <>
      <div className="notice">
        <span>Import files with column matching, validation and saved previews.</span>
        <button onClick={() => onGo('Import centre')}>Open Import centre</button>
      </div>
      <div className="setup-strip">
        <div className="setup-symbol">
          <ShieldCheck size={24} />
        </div>
        <div>
          <h3>Work toward leaving Xero</h3>
          <p>
            Payroll is excluded. Track the migration evidence and practical checks needed before
            switching your official books.
          </p>
        </div>
      </div>
      <Tabs defaultValue="checklist">
        <TabsList className="report-tabs">
          <TabsTrigger value="checklist">Cutover checklist</TabsTrigger>
          <TabsTrigger value="import">Import invoices & bills</TabsTrigger>
          <TabsTrigger value="backup">Backup & verification</TabsTrigger>
        </TabsList>
        <TabsContent value="checklist">
          <div className="notice">
            {areas.filter(([key]) => latest.get(key)?.status === 'owner_checked').length} of{' '}
            {areas.length} items marked checked by you. These notes do not prove that the migration
            is complete or authorize cancellation of Xero.
          </div>
          <section className="panel">
            {areas.map(([key, name, detail]) => (
              <div className="compliance-check" key={key}>
                <ShieldCheck size={20} />
                <div>
                  <h3>{name}</h3>
                  <p>{detail}</p>
                  {latest.get(key)?.notes && (
                    <p className="migration-notes">{latest.get(key).notes}</p>
                  )}
                </div>
                <button
                  className="btn small"
                  onClick={() =>
                    setEdit(
                      latest.get(key) || {area: key, status: 'todo', notes: '', date: today()},
                    )
                  }
                >
                  {latest.get(key)?.status === 'owner_checked'
                    ? 'Owner checked'
                    : latest.get(key)?.status === 'in_progress'
                      ? 'In progress'
                      : 'Add review'}
                </button>
              </div>
            ))}
          </section>
          <div className="section-actions">
            <button className="btn" onClick={() => onGo('Contacts')}>
              Import contacts first
            </button>
            <button className="btn" onClick={() => onGo('Australian tax review')}>
              GST and accountant packs
            </button>
            <button className="btn" onClick={() => onGo('Bookkeeping checks')}>
              Check control accounts
            </button>
          </div>
          <p className="fineprint">
            Currently recorded: {v.docs.length} documents · {v.banks.length} statement lines ·{' '}
            {v.credits.length} credit notes. Screenshots alone do not migrate balances or
            transaction history.
          </p>
        </TabsContent>
        <TabsContent value="import">
          <DocumentImport state={state} canWrite={canWrite} mutate={mutate} />
        </TabsContent>
        <TabsContent value="backup">
          <BackupPanel state={state} canDownload={canWrite} />
        </TabsContent>
      </Tabs>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Migration review note</DialogTitle>
            <DialogDescription>
              Keep evidence references, differences and questions together. No automatic accountant
              sign-off is recorded.
            </DialogDescription>
          </DialogHeader>
          {edit && (
            <form
              className="book-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await mutate({action: 'migrationNote', record: edit})) setEdit(null);
              }}
            >
              <Choice
                label="Migration review status"
                value={edit.status}
                onChange={(x) => setEdit({...edit, status: x})}
                options={[
                  ['todo', 'To do'],
                  ['in_progress', 'In progress'],
                  ['owner_checked', 'Checked by me — evidence recorded'],
                ]}
              />
              <label>
                Review date
                <input
                  type="date"
                  required
                  value={edit.date}
                  onChange={(e) => setEdit({...edit, date: e.target.value})}
                />
              </label>
              <label>
                Evidence and findings
                <textarea
                  minLength={10}
                  maxLength={2000}
                  required
                  value={edit.notes}
                  onChange={(e) => setEdit({...edit, notes: e.target.value})}
                />
              </label>
              <button className="btn primary" disabled={!canWrite}>
                Save review note
              </button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function DocumentImport({state, canWrite, mutate}: Omit<Props, 'onGo'>) {
  const [text, setText] = useState(''),
    [filename, setFilename] = useState(''),
    [type, setType] = useState<'invoice' | 'bill'>('invoice'),
    [priceBasis, setPriceBasis] = useState('unconfirmed'),
    [mapping, setMapping] = useState<{
      accounts: Record<string, string>;
      taxes: Record<string, string>;
    }>({accounts: {}, taxes: {}}),
    [preview, setPreview] = useState<Doc[]>([]),
    [error, setError] = useState('');
  let inspected: ReturnType<typeof inspectDocumentCSV> | null = null;
  try {
    if (text) inspected = inspectDocumentCSV(text);
  } catch {}
  function reset() {
    setPreview([]);
    setError('');
  }
  return (
    <>
      <div className="notice">
        Imports create drafts only. Payment history, opening balances, credits and bank transactions
        are not imported by this form. Use reviewed unpaid-document exports; check partially paid
        opening records separately before posting.
      </div>
      <section className="panel settings-panel book-form">
        <div className="section-actions">
          <h2>Review a document CSV</h2>
          <button
            className="text-btn"
            onClick={() =>
              download(
                'document-import-template.csv',
                'Contact,Number,Date,Due,Description,Quantity,UnitPrice,Tax,Account,Reference,Job\r\nExample customer,INV-EXAMPLE,2026-09-01,2026-09-15,Plumbing labour,1,100.00,GST,Labour,Example reference,Example site\r\n',
              )
            }
          >
            <Download size={16} />
            Template
          </button>
        </div>
        <p className="fineprint">
          Accepts the template or matching ContactName, InvoiceNumber, InvoiceDate, DueDate,
          UnitAmount, TaxType and AccountCode headings. Each row is one line item. Dates: YYYY-MM-DD
          or DD/MM/YYYY. Up to 600 lines and 200 documents per batch.
        </p>
        <div className="form-grid">
          <label>
            Document type
            <Choice
              label="Import document type"
              value={type}
              onChange={(x) => {
                setType(x as 'invoice' | 'bill');
                setMapping({...mapping, accounts: {}});
                reset();
              }}
              options={[
                ['invoice', 'Customer invoices'],
                ['bill', 'Supplier bills'],
              ]}
            />
          </label>
          <label>
            Prices in this file
            <Choice
              label="Import price treatment"
              value={priceBasis}
              onChange={(x) => {
                setPriceBasis(x);
                reset();
              }}
              options={[
                ['unconfirmed', 'Confirm from the export'],
                ['exclusive', 'Unit prices exclude GST'],
                ['inclusive', 'Unit prices include GST'],
              ]}
            />
          </label>
        </div>
        <label className="upload-box">
          <Upload size={24} />
          <strong>Choose invoice or bill CSV</strong>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              reset();
              setText('');
              setMapping({accounts: {}, taxes: {}});
              try {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 700000) throw new Error('Choose a CSV up to 700 KB.');
                const value = await f.text();
                inspectDocumentCSV(value);
                setText(value);
                setFilename(f.name);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
        </label>
        {inspected && (
          <>
            <h3>
              {filename} · {inspected.rows.length} line items
            </h3>
            <p className="fineprint">
              Map source codes explicitly. A Xero account number can mean something different in
              these books.
            </p>
            <div className="form-grid">
              {inspected.accounts.map((code) => (
                <label key={'a' + code}>
                  Source account: {code || '(blank)'}
                  <Choice
                    label={'Map account ' + code}
                    value={mapping.accounts[code] || 'none'}
                    options={[
                      ['none', 'Choose OpenBooks account'],
                      ...accounts.filter(
                        (a) =>
                          a[2] === (type === 'invoice' ? 'income' : 'expense') ||
                          (type === 'bill' && a[0] === '150'),
                      ),
                    ]}
                    onChange={(x) => {
                      setMapping({
                        ...mapping,
                        accounts: {...mapping.accounts, [code]: x === 'none' ? '' : x},
                      });
                      reset();
                    }}
                  />
                </label>
              ))}
              {inspected.taxes.map((code) => (
                <label key={'t' + code}>
                  Source tax: {code || '(blank)'}
                  <Choice
                    label={'Map tax ' + code}
                    value={mapping.taxes[code] || 'unconfirmed'}
                    options={[
                      ['unconfirmed', 'Choose GST treatment'],
                      ['gst', 'GST 10%'],
                      ['free', 'GST-free'],
                      ['none', 'No GST / BAS excluded'],
                    ]}
                    onChange={(x) => {
                      setMapping({
                        ...mapping,
                        taxes: {...mapping.taxes, [code]: x === 'unconfirmed' ? '' : x},
                      });
                      reset();
                    }}
                  />
                </label>
              ))}
            </div>
            <button
              className="btn"
              disabled={priceBasis === 'unconfirmed'}
              onClick={() => {
                setError('');
                setPreview([]);
                try {
                  setPreview(
                    documentImport(text, state, type, priceBasis === 'inclusive', mapping),
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Preview draft documents
            </button>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {preview.length > 0 && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number / customer or supplier</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Lines</TableHead>
                  <TableHead className="number">GST</TableHead>
                  <TableHead className="number">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      {d.number}
                      <div className="secondary">
                        {d.contact} · {d.contactId ? 'saved contact' : 'text only'}
                      </div>
                    </TableCell>
                    <TableCell>{d.date}</TableCell>
                    <TableCell>{d.lines.length}</TableCell>
                    <TableCell className="number">{money(totals(d).taxTotal)}</TableCell>
                    <TableCell className="number">{money(totals(d).total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <button
              className="btn primary"
              disabled={!canWrite}
              onClick={async () => {
                if (await mutate({action: 'importDocuments', documents: preview})) {
                  setPreview([]);
                  setText('');
                }
              }}
            >
              Import {preview.length} drafts
            </button>
          </>
        )}
      </section>
    </>
  );
}
function BackupPanel({state, canDownload}: {state: State; canDownload: boolean}) {
  const [checking, setChecking] = useState(false),
    [progress, setProgress] = useState(''),
    [error, setError] = useState(''),
    [result, setResult] = useState<Awaited<ReturnType<typeof verifyBackup>> | null>(null);
  return (
    <>
      <section className="panel settings-panel book-form">
        <h2>Download your complete records</h2>
        <p>
          A ZIP containing your settings, records, audit history and original uploaded files.
          Includes checksums and balance totals for checking the saved copy. Keep copies somewhere
          independent of this app.
        </p>
        <a
          className="btn primary"
          href={canDownload ? '/api/backup' : undefined}
          aria-disabled={!canDownload}
          download
        >
          <Download size={17} />
          Download full backup ZIP
        </a>
        <p className="fineprint">
          Currently {state.events.filter((e) => e.kind === 'attachment').length} attachments. Up to
          500 MB per archive and 12 MB of record history. If a file cannot be read, the backup is
          incomplete and verification will fail. Use Recovery centre for saved snapshots, isolated
          restore tests and background-run status. Replacing live books still requires a reviewed
          recovery.
        </p>
      </section>
      <section className="panel settings-panel book-form">
        <h2>Verify a saved backup</h2>
        <p>
          Select the ZIP you downloaded. This checks each file, reconstructs the books and compares
          the saved balances. Your live records stay as they are.
        </p>
        <label>
          Backup ZIP
          <input
            disabled={checking}
            type="file"
            accept=".zip,application/zip"
            onChange={async (e) => {
              setResult(null);
              setError('');
              setProgress('');
              const file = e.target.files?.[0];
              if (!file) return;
              setChecking(true);
              try {
                setResult(await verifyBackup(file, setProgress));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setChecking(false);
              }
            }}
          />
        </label>
        {checking && <p role="status">{progress || 'Checking archive…'}</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {result && (
          <>
            <div className="notice">
              <ShieldCheck size={20} />
              <span>File checks and reconstructed balances agree for {result.business}.</span>
            </div>
            <p>
              Saved {new Date(result.createdAt).toLocaleString('en-AU')} ·{' '}
              {result.summary.documents} documents · {result.summary.bankLines} bank lines ·{' '}
              {result.summary.attachments} attachments
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead className="number">Reconstructed balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.summary.trial
                  .filter((a) => a.balance !== 0)
                  .map((a) => (
                    <TableRow key={a.code}>
                      <TableCell>
                        {a.code} · {accounts.find((x) => x[0] === a.code)?.[1]}
                      </TableCell>
                      <TableCell className="number">{money(a.balance)}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
            <p className="fineprint">{result.notice}</p>
          </>
        )}
      </section>
    </>
  );
}
