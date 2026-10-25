'use client';
import {contactStatement} from '@/lib/finance';
import {useState} from 'react';
import {
  Plus,
  Download,
  Search,
  ArrowRight,
  FileText,
  CheckCircle2,
  Archive,
  Users,
  Package,
  Receipt,
  Landmark,
  ShieldCheck,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {Table, TableHeader, TableBody, TableHead, TableRow, TableCell} from '@/components/ui/table';
import {Tabs, TabsList, TabsTrigger, TabsContent} from '@/components/ui/tabs';
import {Choice, Empty, download} from './book-ui';
import {
  accounts,
  bankCodes,
  bankName,
  cents,
  csv,
  parseCsv,
  derive,
  report,
  today,
  shortDate,
  money,
  validAbn,
  type State,
  type Doc,
  type ViewDoc,
  type Journal,
} from '@/lib/books';
import {
  operations,
  agedDocuments,
  cashForecast,
  contractorWorksheet,
  docLabel,
  isSale,
  isLedger,
  manualJournal,
  ruleMatches,
  contactSchema,
  type Contact,
  type Product,
  type BankRule,
  type Asset,
} from '@/lib/operations';
type Props = {state: State; canWrite: boolean; mutate: (body: unknown) => Promise<boolean>};
const saveText = 'Save changes';
function Toolbar({
  query,
  onQuery,
  children,
}: {
  query: string;
  onQuery: (s: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="table-toolbar">
      <div className="search-field">
        <Search size={18} />
        <input
          aria-label="Search records"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search records…"
        />
      </div>
      {children}
    </div>
  );
}
export function Contacts({
  state,
  canWrite,
  mutate,
  onDocument,
  onNew,
  initialRole = 'all',
}: Props & {
  onDocument: (id: string) => void;
  onNew: (type: Doc['type'], contact: Contact) => void;
  initialRole?: string;
}) {
  const {contacts} = operations(state.events),
    docs = derive(state.events).docs;
  const [query, setQuery] = useState(''),
    [role, setRole] = useState(initialRole),
    [archived, setArchived] = useState(false),
    [edit, setEdit] = useState<Contact | null>(null),
    [detail, setDetail] = useState<string | null>(null),
    [importing, setImporting] = useState(false);
  const active = contacts.find((c) => c.id === detail),
    linked = docs.filter((d) => d.contactId === detail && isLedger(d.type));
  const filtered = contacts.filter(
    (c) =>
      c.archived === archived &&
      (role === 'all' || c.role === role || c.role === 'both') &&
      (c.name + ' ' + c.email + ' ' + c.phone).toLowerCase().includes(query.toLowerCase()),
  );
  function newContact() {
    setEdit({
      id: crypto.randomUUID(),
      name: '',
      role: role === 'supplier' ? 'supplier' : 'customer',
      email: '',
      phone: '',
      address: '',
      abn: '',
      notes: '',
      termsDays: 14,
      contractor: false,
      archived: false,
    });
  }
  return (
    <>
      <div className="section-actions">
        <div className="section-stat">
          <Users size={21} />
          <strong>{contacts.filter((c) => !c.archived).length}</strong> active contacts
        </div>
        <button className="btn" disabled={!canWrite} onClick={() => setImporting(true)}>
          Import CSV
        </button>
        <button className="btn primary" disabled={!canWrite} onClick={newContact}>
          <Plus size={17} />
          New contact
        </button>
      </div>
      <section className="panel">
        <Toolbar query={query} onQuery={setQuery}>
          <Choice
            label="Contact type"
            value={role}
            onChange={setRole}
            options={[
              ['all', 'All contacts'],
              ['customer', 'Customers'],
              ['supplier', 'Suppliers'],
            ]}
          />
          <button className="btn" onClick={() => setArchived(!archived)}>
            {archived ? 'Show active' : 'Show archived'}
          </button>
          <button
            className="btn"
            onClick={() =>
              download(
                'contacts.csv',
                csv([
                  ['Name', 'Role', 'Email', 'Phone', 'Address', 'ABN', 'TermsDays', 'Contractor'],
                  ...filtered.map((c) => [
                    c.name,
                    c.role,
                    c.email,
                    c.phone,
                    c.address,
                    c.abn,
                    c.termsDays,
                    c.contractor ? 'yes' : 'no',
                  ]),
                ]),
              )
            }
          >
            <Download size={16} />
            Export
          </button>
        </Toolbar>
        {filtered.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Email / phone</TableHead>
                <TableHead className="number">Receivable</TableHead>
                <TableHead className="number">Payable</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <button className="record-link" onClick={() => setDetail(c.id)}>
                      {c.name}
                    </button>
                    {c.contractor && <div className="secondary">Contractor worksheet enabled</div>}
                  </TableCell>
                  <TableCell>{c.role}</TableCell>
                  <TableCell>
                    {c.email || '—'}
                    <div className="secondary">{c.phone}</div>
                  </TableCell>
                  {(['invoice', 'bill'] as const).map((type) => (
                    <TableCell className="number" key={type}>
                      {money(
                        docs
                          .filter(
                            (d) => d.contactId === c.id && d.type === type && d.status === 'open',
                          )
                          .reduce((n, d) => n + d.balance, 0),
                      )}
                    </TableCell>
                  ))}
                  <TableCell>
                    <button className="btn small" disabled={!canWrite} onClick={() => setEdit(c)}>
                      Edit
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Empty title="No contacts in this view">
            Save customers and suppliers here, then select them on quotes, invoices and bills.
          </Empty>
        )}
      </section>
      <Dialog open={!!edit} onOpenChange={(o) => !o && canWrite && setEdit(null)}>
        <DialogContent className="large-dialog">
          <DialogHeader>
            <DialogTitle>
              {contacts.some((c) => c.id === edit?.id) ? 'Edit contact' : 'New contact'}
            </DialogTitle>
            <DialogDescription>
              Saved details fill your documents. Existing documents keep their original details.
            </DialogDescription>
          </DialogHeader>
          {edit && (
            <form
              className="book-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await mutate({action: 'contact', record: edit})) setEdit(null);
              }}
            >
              <div className="form-grid">
                <label>
                  Name
                  <input
                    required
                    maxLength={160}
                    value={edit.name}
                    onChange={(e) => setEdit({...edit, name: e.target.value})}
                  />
                </label>
                <label>
                  Type
                  <Choice
                    value={edit.role}
                    label="Contact role"
                    onChange={(x) => setEdit({...edit, role: x as Contact['role']})}
                    options={[
                      ['customer', 'Customer'],
                      ['supplier', 'Supplier'],
                      ['both', 'Customer and supplier'],
                    ]}
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={edit.email}
                    onChange={(e) => setEdit({...edit, email: e.target.value})}
                  />
                </label>
                <label>
                  Phone
                  <input
                    value={edit.phone}
                    onChange={(e) => setEdit({...edit, phone: e.target.value})}
                  />
                </label>
                <label>
                  ABN
                  <input
                    value={edit.abn}
                    onChange={(e) => setEdit({...edit, abn: e.target.value})}
                  />
                </label>
                <label>
                  Payment terms (days)
                  <input
                    type="number"
                    required
                    min={0}
                    max={180}
                    value={edit.termsDays}
                    onChange={(e) => setEdit({...edit, termsDays: Number(e.target.value)})}
                  />
                </label>
                <label className="full-width">
                  Address
                  <textarea
                    value={edit.address}
                    onChange={(e) => setEdit({...edit, address: e.target.value})}
                  />
                </label>
                <label className="full-width">
                  Notes
                  <textarea
                    maxLength={2000}
                    value={edit.notes}
                    onChange={(e) => setEdit({...edit, notes: e.target.value})}
                  />
                </label>
                <label>
                  Include in contractor worksheet
                  <Choice
                    value={edit.contractor ? 'yes' : 'no'}
                    label="Contractor worksheet"
                    options={[
                      ['no', 'No'],
                      ['yes', 'Yes — review payments for TPAR'],
                    ]}
                    onChange={(x) => setEdit({...edit, contractor: x === 'yes'})}
                  />
                </label>
                <label>
                  Contact status
                  <Choice
                    value={edit.archived ? 'archived' : 'active'}
                    label="Contact status"
                    options={[
                      ['active', 'Active'],
                      ['archived', 'Archived'],
                    ]}
                    onChange={(x) => setEdit({...edit, archived: x === 'archived'})}
                  />
                </label>
              </div>
              <button className="btn primary" disabled={!canWrite}>
                {saveText}
              </button>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Sheet open={!!active} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="document-sheet">
          <SheetHeader>
            <SheetTitle>{active?.name}</SheetTitle>
            <SheetDescription>Contact details and account activity</SheetDescription>
          </SheetHeader>
          {active && (
            <div className="sheet-body">
              <div className="contact-details">
                <p>{active.email}</p>
                <p>{active.phone}</p>
                <p>{active.address}</p>
                <p>{active.abn ? 'ABN ' + active.abn : ''}</p>
                <p>{active.notes}</p>
              </div>
              <div className="detail-buttons">
                {active.role !== 'supplier' && (
                  <>
                    <button
                      className="btn primary"
                      disabled={!canWrite || active.archived}
                      onClick={() => {
                        setDetail(null);
                        onNew('invoice', active);
                      }}
                    >
                      New invoice
                    </button>
                    <button
                      className="btn"
                      disabled={!canWrite || active.archived}
                      onClick={() => {
                        setDetail(null);
                        onNew('quote', active);
                      }}
                    >
                      New quote
                    </button>
                  </>
                )}
                {active.role !== 'customer' && (
                  <button
                    className="btn primary"
                    disabled={!canWrite || active.archived}
                    onClick={() => {
                      setDetail(null);
                      onNew('bill', active);
                    }}
                  >
                    New bill
                  </button>
                )}
                <button
                  className="btn"
                  onClick={() =>
                    download(
                      'contact-statement.csv',
                      csv([
                        ['Contact', active.name],
                        ['As at', today()],
                        [
                          'Includes linked documents, payments, credits, refunds and held customer funds. Unassigned opening balances are excluded.',
                        ],
                        ...(['invoice', 'bill'] as const).flatMap((type) => [
                          [
                            type === 'invoice'
                              ? 'CUSTOMER ACCOUNT — positive means customer owes you'
                              : 'SUPPLIER ACCOUNT — positive means you owe supplier',
                          ],
                          [
                            'Date',
                            'Reference',
                            'Description',
                            'Charge / refund',
                            'Payment / credit',
                            'Running balance',
                          ],
                          ...contactStatement(state.events, active.id, type, today()).map((r) => [
                            r.date,
                            r.reference,
                            r.description,
                            r.debit / 100,
                            r.credit / 100,
                            r.balance / 100,
                          ]),
                        ]),
                      ]),
                    )
                  }
                >
                  <Download size={16} />
                  Statement CSV
                </button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="number">Outstanding</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linked.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>
                        <button
                          className="record-link"
                          onClick={() => {
                            setDetail(null);
                            onDocument(d.id);
                          }}
                        >
                          {d.number}
                        </button>
                        <div className="secondary">{shortDate(d.date)}</div>
                      </TableCell>
                      <TableCell>{d.status}</TableCell>
                      <TableCell className="number">
                        {money(d.status === 'open' ? d.balance : 0)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!linked.length && (
                <Empty title="No linked documents">
                  New documents selected from this contact will appear here. Earlier documents
                  entered as text are not automatically linked.
                </Empty>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
      <Dialog open={importing} onOpenChange={(o) => canWrite && setImporting(o)}>
        <DialogContent className="large-dialog">
          <DialogHeader>
            <DialogTitle>Import contacts</DialogTitle>
            <DialogDescription>
              Preview up to 300 contacts. Existing names are rejected to prevent accidental
              duplicate imports.
            </DialogDescription>
          </DialogHeader>
          <ContactImport
            canWrite={canWrite}
            onSave={async (rows) => {
              if (await mutate({action: 'importContacts', rows})) setImporting(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
function ContactImport({
  canWrite,
  onSave,
}: {
  canWrite: boolean;
  onSave: (rows: Contact[]) => Promise<void>;
}) {
  const [rows, setRows] = useState<Contact[]>([]),
    [error, setError] = useState('');
  return (
    <div className="book-form">
      <button
        className="text-btn"
        onClick={() =>
          download(
            'contacts-template.csv',
            'Name,Role,Email,Phone,Address,ABN,TermsDays,Contractor\r\nExample customer,customer,,,,,14,no\r\n',
          )
        }
      >
        Download template
      </button>
      <label>
        Contact CSV
        <input
          type="file"
          accept=".csv"
          onChange={async (e) => {
            setError('');
            setRows([]);
            try {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 500000) throw new Error('Choose a CSV smaller than 500 KB.');
              const data = parseCsv((await f.text()).replace(/^\uFEFF/, '')),
                headers = data.shift()?.map((x) => x.toLowerCase()) || [];
              if (!['name', 'role'].every((x) => headers.includes(x)))
                throw new Error('Name and Role columns are required.');
              if (!data.length || data.length > 300) throw new Error('Import 1–300 rows.');
              setRows(
                data.map((r, i) => {
                  const get = (k: string) => r[headers.indexOf(k)] || '';
                  const p = contactSchema.safeParse({
                    id: crypto.randomUUID(),
                    name: get('name'),
                    role: get('role').toLowerCase(),
                    email: get('email'),
                    phone: get('phone'),
                    address: get('address'),
                    abn: get('abn'),
                    termsDays: Number(get('termsdays') || 14),
                    contractor: get('contractor').toLowerCase() === 'yes',
                    notes: '',
                    archived: false,
                  });
                  if (!p.success)
                    throw new Error('Row ' + (i + 2) + ': ' + p.error.issues[0].message);
                  return p.data;
                }),
              );
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      </label>
      {error && <p className="form-error">{error}</p>}
      {rows.length > 0 && (
        <>
          <div className="import-preview">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>ABN</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.name}</TableCell>
                    <TableCell>{c.role}</TableCell>
                    <TableCell>{c.email}</TableCell>
                    <TableCell>{c.abn}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <button className="btn primary" disabled={!canWrite} onClick={() => onSave(rows)}>
            Import {rows.length} contacts
          </button>
        </>
      )}
    </div>
  );
}
export function Products({state, canWrite, mutate}: Props) {
  const {products} = operations(state.events),
    [query, setQuery] = useState(''),
    [archived, setArchived] = useState(false),
    [edit, setEdit] = useState<Product | null>(null);
  const filtered = products.filter(
    (p) =>
      p.archived === archived &&
      (p.code + ' ' + p.name).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="section-actions">
        <p>Reusable prices and descriptions · untracked items · prices exclude GST</p>
        <button
          className="btn primary"
          disabled={!canWrite}
          onClick={() =>
            setEdit({
              id: crypto.randomUUID(),
              code: '',
              name: '',
              description: '',
              salePrice: '0.00',
              costPrice: '0.00',
              tax: state.settings.gst === 'yes' ? 'gst' : 'none',
              saleAccount: '400',
              costAccount: '500',
              archived: false,
            })
          }
        >
          <Plus size={17} />
          New item
        </button>
      </div>
      <section className="panel">
        <Toolbar query={query} onQuery={setQuery}>
          <button className="btn" onClick={() => setArchived(!archived)}>
            {archived ? 'Show active' : 'Show archived'}
          </button>
          <button
            className="btn"
            onClick={() =>
              download(
                'products-services.csv',
                csv([
                  [
                    'Code',
                    'Name',
                    'Description',
                    'SalePriceExGST',
                    'CostPriceExGST',
                    'Tax',
                    'SaleAccount',
                    'CostAccount',
                  ],
                  ...filtered.map((p) => [
                    p.code,
                    p.name,
                    p.description,
                    p.salePrice,
                    p.costPrice,
                    p.tax,
                    p.saleAccount,
                    p.costAccount,
                  ]),
                ]),
              )
            }
          >
            <Download size={16} />
            Export
          </button>
        </Toolbar>
        {filtered.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code / item</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="number">Sell price</TableHead>
                <TableHead className="number">Cost price</TableHead>
                <TableHead>Tax</TableHead>
                <TableHead>Edit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <strong>{p.code}</strong>
                    <div className="secondary">{p.name}</div>
                  </TableCell>
                  <TableCell className="wrap-cell">{p.description}</TableCell>
                  <TableCell className="number">{money(cents(p.salePrice))}</TableCell>
                  <TableCell className="number">{money(cents(p.costPrice))}</TableCell>
                  <TableCell>
                    {p.tax === 'gst' ? '10% GST' : p.tax === 'free' ? 'GST-free' : 'No GST'}
                  </TableCell>
                  <TableCell>
                    <button className="btn small" disabled={!canWrite} onClick={() => setEdit(p)}>
                      Edit
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Empty title="Build your price list">
            Add labour rates, call-out fees, fittings and common services, then reuse them on
            documents.
          </Empty>
        )}
      </section>
      <Dialog open={!!edit} onOpenChange={(o) => !o && canWrite && setEdit(null)}>
        <DialogContent className="large-dialog">
          <DialogHeader>
            <DialogTitle>Product or service</DialogTitle>
            <DialogDescription>
              Item prices are defaults. You can change them on each document. Stock quantities are
              not tracked.
            </DialogDescription>
          </DialogHeader>
          {edit && (
            <form
              className="book-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await mutate({action: 'product', record: edit})) setEdit(null);
              }}
            >
              <div className="form-grid">
                {(['code', 'name', 'description', 'salePrice', 'costPrice'] as const).map((k) => (
                  <label key={k} className={k === 'description' ? 'full-width' : ''}>
                    {
                      {
                        code: 'Item code',
                        name: 'Name',
                        description: 'Description',
                        salePrice: 'Sell price excluding GST $',
                        costPrice: 'Cost price excluding GST $',
                      }[k]
                    }
                    <input
                      required={k !== 'description'}
                      value={edit[k]}
                      onChange={(e) => setEdit({...edit, [k]: e.target.value})}
                    />
                  </label>
                ))}
                <label>
                  Tax
                  <Choice
                    value={edit.tax}
                    label="Item tax"
                    options={[
                      ['gst', 'GST 10%'],
                      ['free', 'GST-free'],
                      ['none', 'No GST'],
                    ]}
                    onChange={(x) => setEdit({...edit, tax: x as Product['tax']})}
                  />
                </label>
                <label>
                  Sales account
                  <Choice
                    value={edit.saleAccount}
                    label="Sales account"
                    options={accounts.filter((a) => a[2] === 'income')}
                    onChange={(x) => setEdit({...edit, saleAccount: x})}
                  />
                </label>
                <label>
                  Purchases account
                  <Choice
                    value={edit.costAccount}
                    label="Purchases account"
                    options={accounts.filter((a) => a[2] === 'expense')}
                    onChange={(x) => setEdit({...edit, costAccount: x})}
                  />
                </label>
                <label>
                  Status
                  <Choice
                    value={edit.archived ? 'archived' : 'active'}
                    label="Item status"
                    options={[
                      ['active', 'Active'],
                      ['archived', 'Archived'],
                    ]}
                    onChange={(x) => setEdit({...edit, archived: x === 'archived'})}
                  />
                </label>
              </div>
              <button className="btn primary" disabled={!canWrite}>
                {saveText}
              </button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
export function BankRules({state, canWrite, mutate}: Props) {
  const {rules} = operations(state.events),
    v = derive(state.events),
    [edit, setEdit] = useState<BankRule | null>(null);
  return (
    <>
      <div className="section-actions">
        <p>Rules suggest a category when the bank description matches. You review every posting.</p>
        <button
          className="btn primary"
          disabled={!canWrite}
          onClick={() =>
            setEdit({
              id: crypto.randomUUID(),
              name: '',
              contains: '',
              direction: 'out',
              account: '500',
              tax: state.settings.gst === 'yes' ? 'gst' : 'none',
              archived: false,
            })
          }
        >
          <Plus size={17} />
          New rule
        </button>
      </div>
      <section className="panel">
        {rules.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rule</TableHead>
                <TableHead>Description contains</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Waiting matches</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Edit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell>
                    {r.contains}
                    <div className="secondary">Money {r.direction}</div>
                  </TableCell>
                  <TableCell>
                    {accounts.find((a) => a[0] === r.account)?.[1]}
                    <div className="secondary">{r.tax === 'gst' ? 'GST included' : r.tax}</div>
                  </TableCell>
                  <TableCell>
                    {v.banks.filter((b) => !v.usedBanks.has(b.id) && ruleMatches(r, b)).length}
                  </TableCell>
                  <TableCell>{r.archived ? 'Archived' : 'Active'}</TableCell>
                  <TableCell>
                    <button className="btn small" disabled={!canWrite} onClick={() => setEdit(r)}>
                      Edit
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Empty title="No bank rules yet">
            Create a rule for a recurring supplier, fuel station or bank fee. Suggestions appear
            while reconciling.
          </Empty>
        )}
      </section>
      <Dialog open={!!edit} onOpenChange={(o) => !o && canWrite && setEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bank rule</DialogTitle>
            <DialogDescription>
              Use a distinctive phrase from the statement description.
            </DialogDescription>
          </DialogHeader>
          {edit && (
            <form
              className="book-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await mutate({action: 'bank_rule', record: edit})) setEdit(null);
              }}
            >
              <label>
                Rule name
                <input
                  required
                  value={edit.name}
                  onChange={(e) => setEdit({...edit, name: e.target.value})}
                />
              </label>
              <label>
                Description contains
                <input
                  required
                  minLength={3}
                  value={edit.contains}
                  onChange={(e) => setEdit({...edit, contains: e.target.value})}
                />
              </label>
              <label>
                Direction
                <Choice
                  value={edit.direction}
                  label="Direction"
                  options={[
                    ['out', 'Money out'],
                    ['in', 'Money in'],
                  ]}
                  onChange={(x) =>
                    setEdit({
                      ...edit,
                      direction: x as 'in' | 'out',
                      account: x === 'in' ? '400' : '500',
                    })
                  }
                />
              </label>
              <label>
                Account
                <Choice
                  value={edit.account}
                  label="Rule account"
                  options={accounts.filter(
                    (a) =>
                      a[2] === (edit.direction === 'in' ? 'income' : 'expense') ||
                      ['300', '250'].includes(a[0]),
                  )}
                  onChange={(x) =>
                    setEdit({
                      ...edit,
                      account: x,
                      tax: ['300', '250'].includes(x) ? 'none' : edit.tax,
                    })
                  }
                />
              </label>
              <label>
                Tax
                <Choice
                  value={edit.tax}
                  label="Rule tax"
                  options={[
                    ['none', 'No GST'],
                    ['free', 'GST-free'],
                    ['gst', 'GST included'],
                  ]}
                  onChange={(x) => setEdit({...edit, tax: x as BankRule['tax']})}
                />
              </label>
              <label>
                Status
                <Choice
                  value={edit.archived ? 'archived' : 'active'}
                  label="Rule status"
                  options={[
                    ['active', 'Active'],
                    ['archived', 'Archived'],
                  ]}
                  onChange={(x) => setEdit({...edit, archived: x === 'archived'})}
                />
              </label>
              <button className="btn primary" disabled={!canWrite}>
                Save rule
              </button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
export function AdvancedReports({
  state,
  view,
  onDocument,
}: {
  state: State;
  view: string;
  onDocument: (id: string) => void;
}) {
  const current = today(),
    fy = Number(current.slice(0, 4)) - (Number(current.slice(5, 7)) < 7 ? 1 : 0);
  const [at, setAt] = useState(current),
    [from, setFrom] = useState(fy + '-07-01'),
    [to, setTo] = useState(fy + 1 + '-06-30'),
    [type, setType] = useState<'invoice' | 'bill'>('invoice');
  const aged = agedDocuments(state.events, at, type),
    forecast = cashForecast(state.events, at),
    r = report(state.events, from, to, state.settings.gstBasis);
  const bucketNames = ['Current', '1–30 days', '31–60 days', '61–90 days', '90+ days'];
  if (view === 'Aged balances')
    return (
      <>
        <div className="report-controls">
          <label>
            As at
            <input
              type="date"
              required
              value={at}
              onChange={(e) => e.target.value && setAt(e.target.value)}
            />
          </label>
          <Choice
            label="Aged report"
            value={type}
            onChange={(x) => setType(x as 'invoice' | 'bill')}
            options={[
              ['invoice', 'Aged receivables'],
              ['bill', 'Aged payables'],
            ]}
          />
          <button
            className="btn"
            onClick={() =>
              download(
                'aged-' + type + 's.csv',
                csv([
                  ['As at', at],
                  ['Document', 'Contact', 'Due', 'Age band', 'Outstanding'],
                  ...aged.map((d) => [d.number, d.contact, d.due, d.bucket, d.balance / 100]),
                ]),
              )
            }
          >
            <Download size={16} />
            Export
          </button>
        </div>
        <div className="aging-metrics">
          {bucketNames.map((name) => (
            <div className="metric" key={name}>
              <span>{name}</span>
              <strong>
                {money(aged.filter((d) => d.bucket === name).reduce((n, d) => n + d.balance, 0))}
              </strong>
            </div>
          ))}
        </div>
        <section className="panel">
          {aged.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document / contact</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead className="number">Original</TableHead>
                  <TableHead className="number">Outstanding</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aged
                  .sort((a, b) => a.due.localeCompare(b.due))
                  .map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>
                        <button className="record-link" onClick={() => onDocument(d.id)}>
                          {d.number}
                        </button>
                        <div className="secondary">{d.contact}</div>
                      </TableCell>
                      <TableCell>{shortDate(d.due)}</TableCell>
                      <TableCell>
                        <span className={'status ' + (d.days > 0 ? 'overdue' : 'open')}>
                          {d.bucket}
                        </span>
                      </TableCell>
                      <TableCell className="number">{money(d.total)}</TableCell>
                      <TableCell className="number strong">{money(d.balance)}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          ) : (
            <Empty title="No outstanding balances at this date">
              This report uses posted documents and payments effective on or before your selected
              date.
            </Empty>
          )}
        </section>
      </>
    );
  if (view === 'Cash flow')
    return (
      <>
        <div className="report-controls">
          <label>
            Start date
            <input
              type="date"
              value={at}
              required
              onChange={(e) => e.target.value && setAt(e.target.value)}
            />
          </label>
          <button
            className="btn"
            onClick={() =>
              download(
                'cash-projection.csv',
                csv([
                  ['Week', 'Opening', 'Expected receipts', 'Expected payments', 'Closing'],
                  ...forecast.map((w) => [
                    w.start,
                    w.opening / 100,
                    w.income / 100,
                    w.out / 100,
                    w.closing / 100,
                  ]),
                ]),
              )
            }
          >
            <Download size={16} />
            Export projection
          </button>
        </div>
        <div className="notice">
          Eight-week projection using posted bank balances and outstanding invoices and bills at the
          start date. Assumes payment on the due date; overdue amounts fall in week one. Excludes
          quotes, purchase orders, unrecorded costs and future jobs.
        </div>
        <section className="panel">
          <div className="panel-heading">
            <h2>Expected weekly cash position</h2>
            <span className="status draft">Projection</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Week starting</TableHead>
                <TableHead className="number">Opening cash</TableHead>
                <TableHead className="number">Receipts</TableHead>
                <TableHead className="number">Payments</TableHead>
                <TableHead className="number">Closing cash</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {forecast.map((w) => (
                <TableRow key={w.start}>
                  <TableCell>{shortDate(w.start)}</TableCell>
                  <TableCell className="number">{money(w.opening)}</TableCell>
                  <TableCell className="number positive">{money(w.income)}</TableCell>
                  <TableCell className="number">{money(w.out)}</TableCell>
                  <TableCell className={'number strong ' + (w.closing < 0 ? 'negative' : '')}>
                    {money(w.closing)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      </>
    );

  const lines = r.journal
    .filter((j) => j.source !== 'opening' && j.source !== 'transfer')
    .flatMap((j) => j.lines)
    .filter((l) => bankCodes.some((c) => c === l.account));
  return (
    <>
      <div className="report-controls">
        <label>
          From
          <input
            type="date"
            value={from}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
          />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
        <button
          className="btn"
          onClick={() =>
            download(
              'cash-summary.csv',
              csv([
                ['From', from, 'To', to],
                ['Account', 'Money in', 'Money out', 'Net movement'],
                ...bankCodes.map((code) => {
                  const ls = lines.filter((l) => l.account === code),
                    income = ls.reduce((n, l) => n + l.debit, 0),
                    out = ls.reduce((n, l) => n + l.credit, 0);
                  return [
                    bankName(code, state.settings),
                    income / 100,
                    out / 100,
                    (income - out) / 100,
                  ];
                }),
              ]),
            )
          }
        >
          <Download size={16} />
          Export
        </button>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Cash summary</h2>
          <p>Excludes opening balances and internal transfers</p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead className="number">Money in</TableHead>
              <TableHead className="number">Money out</TableHead>
              <TableHead className="number">Net movement</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bankCodes.map((code) => {
              const ls = lines.filter((l) => l.account === code),
                income = ls.reduce((n, l) => n + l.debit, 0),
                out = ls.reduce((n, l) => n + l.credit, 0);
              return (
                <TableRow key={code}>
                  <TableCell>{bankName(code, state.settings)}</TableCell>
                  <TableCell className="number">{money(income)}</TableCell>
                  <TableCell className="number">{money(out)}</TableCell>
                  <TableCell className="number">{money(income - out)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>
    </>
  );
}
export function AccountingTools({state, canWrite, mutate, view}: Props & {view: string}) {
  const [query, setQuery] = useState(''),
    [account, setAccount] = useState('all'),
    [from, setFrom] = useState(
      String(Number(today().slice(0, 4)) - (Number(today().slice(5, 7)) < 7 ? 1 : 0)) + '-07-01',
    ),
    [to, setTo] = useState(today()),
    [journal, setJournal] = useState<Journal | null>(null),
    [reverse, setReverse] = useState<string | null>(null),
    [reason, setReason] = useState(''),
    [date, setDate] = useState(today());
  const v = derive(state.events),
    r = report(state.events, '0000-01-01', to, state.settings.gstBasis),
    manuals = state.events.filter((e) => e.kind === 'manual_journal'),
    filtered = v.journal
      .filter(
        (j) =>
          j.date >= from &&
          j.date <= to &&
          (j.reference + ' ' + j.description).toLowerCase().includes(query.toLowerCase()),
      )
      .flatMap((j) =>
        j.lines.filter((l) => account === 'all' || l.account === account).map((l) => ({...l, j})),
      );
  if (view === 'Chart of accounts')
    return (
      <section className="panel">
        <Toolbar query={query} onQuery={setQuery}>
          <button
            className="btn"
            onClick={() =>
              download(
                'chart-of-accounts.csv',
                csv([
                  ['Code', 'Name', 'Type', 'Ledger balance'],
                  ...r.trial.map((a) => [
                    a.code,
                    bankCodes.some((c) => c === a.code) ? bankName(a.code, state.settings) : a.name,
                    a.type,
                    a.balance / 100,
                  ]),
                ]),
              )
            }
          >
            <Download size={16} />
            Export chart
          </button>
        </Toolbar>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="number">Balance as at {shortDate(to)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.trial
              .filter((a) => (a.code + ' ' + a.name).toLowerCase().includes(query.toLowerCase()))
              .map((a) => (
                <TableRow key={a.code}>
                  <TableCell>{a.code}</TableCell>
                  <TableCell>
                    {bankCodes.some((c) => c === a.code)
                      ? bankName(a.code, state.settings)
                      : a.name}
                  </TableCell>
                  <TableCell>{a.type}</TableCell>
                  <TableCell className="number">{money(a.balance)}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
        <p className="fineprint panel-note">
          Account codes are fixed to keep historical postings consistent. Bank account labels can be
          changed in Settings. Debits are positive; credits are negative.
        </p>
      </section>
    );
  if (view === 'Bookkeeping checks') {
    const openInvoices = v.docs
        .filter((d) => d.type === 'invoice' && d.status === 'open')
        .reduce((n, d) => n + d.balance, 0),
      openBills = v.docs
        .filter((d) => d.type === 'bill' && d.status === 'open')
        .reduce((n, d) => n + d.balance, 0),
      full = report(state.events, '0000-01-01', '9999-12-31', 'accrual');
    const checks = [
      [
        'Trial balance',
        full.trial.reduce((n, a) => n + a.balance, 0) === 0,
        'Total debits equal total credits.',
      ],
      [
        'Receivables control',
        full.trial.find((a) => a.code === '110')!.balance === openInvoices,
        'Compare the receivables account with outstanding invoices. Opening receivables can explain a difference.',
      ],
      [
        'Payables control',
        -full.trial.find((a) => a.code === '200')!.balance === openBills,
        'Compare the payables account with outstanding bills. Opening payables can explain a difference.',
      ],
      [
        'Customer credit control',
        -full.trial.find((a) => a.code === '220')!.balance ===
          v.credits.filter((c) => c.type === 'invoice').reduce((n, c) => n + c.balance, 0),
        'Customer credits agree with their control account.',
      ],
      [
        'Supplier credit control',
        full.trial.find((a) => a.code === '130')!.balance ===
          v.credits.filter((c) => c.type === 'bill').reduce((n, c) => n + c.balance, 0),
        'Supplier credits agree with their control account.',
      ],
      [
        'Statement review',
        v.banks.length > 0 && v.usedBanks.size === v.banks.length,
        v.banks.length
          ? `${v.banks.length - v.usedBanks.size} imported bank lines waiting for review.`
          : 'No statement lines imported yet.',
      ],
      [
        'Business setup',
        state.settings.gst !== 'unconfirmed' &&
          (state.settings.gst !== 'yes' || validAbn(state.settings.abn)),
        'GST registration and business details must be confirmed before posting.',
      ],
      [
        'Period lock',
        !!state.settings.lockDate,
        state.settings.lockDate
          ? 'Transactions are locked through ' + shortDate(state.settings.lockDate)
          : 'No closed period has been set.',
      ],
    ] as const;
    return (
      <>
        <div className="notice">
          These checks identify differences in the records saved here. They do not establish that
          all business transactions have been imported or that tax treatment is correct.
        </div>
        <div className="check-grid">
          {checks.map(([title, pass, detail]) => (
            <section className="panel check-card" key={title}>
              <ShieldCheck size={23} />
              <h2>{title}</h2>
              <span className={'status ' + (pass ? 'paid' : 'draft')}>
                {pass ? 'Pass' : 'Review'}
              </span>
              <p>{detail}</p>
            </section>
          ))}
        </div>
      </>
    );
  }
  return (
    <>
      <div className="section-actions">
        <p>
          {view === 'Manual journals'
            ? 'Post balanced adjustments with an audit trail. Bank, receivable, payable and GST accounts use their own workflows.'
            : 'Find ledger entries and prepare a dated reclassification between income or expense accounts.'}
        </p>
        <button
          className="btn primary"
          disabled={!canWrite}
          onClick={() =>
            setJournal({
              date: today(),
              reference: 'ADJ-' + (manuals.length + 1),
              description: '',
              lines: [
                {account: '580', debit: 0, credit: 0},
                {account: '151', debit: 0, credit: 0},
              ],
            })
          }
        >
          <Plus size={16} />
          New journal
        </button>
      </div>
      {view === 'Manual journals' ? (
        <section className="panel">
          {manuals.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Reference / reason</TableHead>
                  <TableHead>Entries</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {manuals
                  .slice()
                  .reverse()
                  .map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>{shortDate(e.payload.journal.date)}</TableCell>
                      <TableCell>
                        <strong>{e.payload.journal.reference}</strong>
                        <div className="secondary wrap-cell">{e.payload.journal.description}</div>
                      </TableCell>
                      <TableCell>
                        <details>
                          <summary>{e.payload.journal.lines.length} lines</summary>
                          {e.payload.journal.lines.map((l: any, i: number) => (
                            <p key={i}>
                              {l.account} · Dr {money(l.debit)} · Cr {money(l.credit)}
                            </p>
                          ))}
                        </details>
                      </TableCell>
                      <TableCell>
                        {state.events.some((x) => x.payload.reverses === e.id) ? (
                          <span className="status void">Reversed</span>
                        ) : (
                          <button
                            className="btn small"
                            disabled={!canWrite}
                            onClick={() => {
                              setReverse(e.id);
                              setReason('');
                              setDate(today());
                            }}
                          >
                            Reverse
                          </button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          ) : (
            <Empty title="No manual adjustments">
              Use this for accountant-reviewed reclassifications, accruals and depreciation. Every
              journal must balance.
            </Empty>
          )}
        </section>
      ) : (
        <>
          <div className="report-controls">
            <label>
              From
              <input
                type="date"
                value={from}
                onChange={(e) => e.target.value && setFrom(e.target.value)}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={to}
                onChange={(e) => e.target.value && setTo(e.target.value)}
              />
            </label>
            <Choice
              label="Ledger account"
              value={account}
              onChange={setAccount}
              options={[['all', 'All accounts'], ...accounts]}
            />
          </div>
          <section className="panel">
            <Toolbar query={query} onQuery={setQuery}>
              <button
                className="btn"
                onClick={() =>
                  download(
                    'filtered-ledger.csv',
                    csv([
                      ['Date', 'Reference', 'Description', 'Account', 'Debit', 'Credit'],
                      ...filtered.map((l) => [
                        l.j.date,
                        l.j.reference,
                        l.j.description,
                        l.account,
                        l.debit / 100,
                        l.credit / 100,
                      ]),
                    ]),
                  )
                }
              >
                <Download size={16} />
                Export results
              </button>
            </Toolbar>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date / reference</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="number">Debit</TableHead>
                  <TableHead className="number">Credit</TableHead>
                  <TableHead>Adjust</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      {shortDate(l.j.date)}
                      <div className="secondary">{l.j.reference}</div>
                    </TableCell>
                    <TableCell className="wrap-cell">{l.j.description}</TableCell>
                    <TableCell>{l.account}</TableCell>
                    <TableCell className="number">{money(l.debit)}</TableCell>
                    <TableCell className="number">{money(l.credit)}</TableCell>
                    <TableCell>
                      {['income', 'expense'].includes(
                        accounts.find((a) => a[0] === l.account)?.[2] || '',
                      ) &&
                      (l.debit || l.credit) ? (
                        <button
                          className="btn small"
                          disabled={!canWrite}
                          onClick={() =>
                            setJournal({
                              date: today(),
                              reference: 'RECLASS ' + l.j.reference.slice(0, 45),
                              description: 'Reclassify ' + l.j.description,
                              lines: [
                                {account: l.account, debit: l.credit, credit: l.debit},
                                {account: l.account, debit: l.debit, credit: l.credit},
                              ],
                            })
                          }
                        >
                          Reclassify
                        </button>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!filtered.length && (
              <Empty title="No entries in this period">
                Change your filters or post a transaction.
              </Empty>
            )}
          </section>
        </>
      )}
      <Dialog open={!!journal} onOpenChange={(o) => !o && canWrite && setJournal(null)}>
        <DialogContent className="large-dialog">
          <DialogHeader>
            <DialogTitle>Manual journal</DialogTitle>
            <DialogDescription>
              Review the accounts, date and reason. Posting changes your reports immediately and
              preserves the original entries.
            </DialogDescription>
          </DialogHeader>
          {journal && (
            <JournalForm
              initial={journal}
              canWrite={canWrite}
              onSave={async (j) => {
                if (await mutate({action: 'manualJournal', journal: j})) setJournal(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!reverse} onOpenChange={(o) => !o && canWrite && setReverse(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse journal</DialogTitle>
            <DialogDescription>
              An opposite journal will be posted on the chosen date.
            </DialogDescription>
          </DialogHeader>
          <form
            className="book-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await mutate({action: 'reverseJournal', id: reverse, date, reason}))
                setReverse(null);
            }}
          >
            <label>
              Date
              <input required type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              Reason
              <textarea
                required
                minLength={5}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button className="btn primary" disabled={!canWrite}>
              Post reversal
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
function JournalForm({
  initial,
  canWrite,
  onSave,
}: {
  initial: Journal;
  canWrite: boolean;
  onSave: (j: Journal) => Promise<void>;
}) {
  const [j, setJ] = useState(initial),
    [lines, setLines] = useState(
      initial.lines.map((l) => ({
        account: l.account,
        debit: (l.debit / 100).toFixed(2),
        credit: (l.credit / 100).toFixed(2),
      })),
    ),
    [error, setError] = useState('');
  const allowed = accounts.filter(
    (a) => ![...bankCodes, '110', '120', '130', '200', '210', '220', '225'].some((c) => c === a[0]),
  );
  let difference = 0;
  try {
    difference = lines.reduce((n, l) => n + cents(l.debit || '0') - cents(l.credit || '0'), 0);
  } catch {}
  return (
    <form
      className="book-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setError('');
        try {
          const p = manualJournal({
            ...j,
            lines: lines.map((l) => ({
              account: l.account,
              debit: cents(l.debit || '0'),
              credit: cents(l.credit || '0'),
            })),
          });
          await onSave(p);
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <div className="form-grid">
        <label>
          Date
          <input
            type="date"
            required
            value={j.date}
            onChange={(e) => setJ({...j, date: e.target.value})}
          />
        </label>
        <label>
          Reference
          <input
            required
            maxLength={60}
            value={j.reference}
            onChange={(e) => setJ({...j, reference: e.target.value})}
          />
        </label>
        <label className="full-width">
          Reason
          <textarea
            required
            minLength={5}
            maxLength={500}
            value={j.description}
            onChange={(e) => setJ({...j, description: e.target.value})}
          />
        </label>
      </div>
      {lines.map((l, i) => (
        <div className="journal-edit-row" key={i}>
          <label>
            Account
            <Choice
              label={'Journal account ' + (i + 1)}
              value={l.account}
              options={allowed}
              onChange={(x) => setLines(lines.map((v, k) => (k === i ? {...v, account: x} : v)))}
            />
          </label>
          {(['debit', 'credit'] as const).map((k) => (
            <label key={k}>
              {k === 'debit' ? 'Debit $' : 'Credit $'}
              <input
                inputMode="decimal"
                value={l[k]}
                onChange={(e) =>
                  setLines(lines.map((v, n) => (n === i ? {...v, [k]: e.target.value} : v)))
                }
              />
            </label>
          ))}
          <button
            type="button"
            className="btn small"
            disabled={lines.length === 2}
            onClick={() => setLines(lines.filter((_, n) => n !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="text-btn"
        disabled={lines.length >= 60}
        onClick={() => setLines([...lines, {account: '590', debit: '0.00', credit: '0.00'}])}
      >
        + Add line
      </button>
      <div className="notice">
        Difference: {money(difference)}. Choose different accounts to move a cost; a journal using
        only one account has no net effect. GST is unchanged by manual journals.
      </div>
      {error && <p className="form-error">{error}</p>}
      <button className="btn primary" disabled={!canWrite || difference !== 0}>
        Post journal
      </button>
    </form>
  );
}
export function Assets({state, canWrite, mutate}: Props) {
  const {assets} = operations(state.events),
    [edit, setEdit] = useState<Asset | null>(null),
    [error, setError] = useState(''),
    [cost, setCost] = useState(''),
    [residual, setResidual] = useState('0.00');
  function open(a?: Asset) {
    setError('');
    setCost(a ? (a.cost / 100).toFixed(2) : '');
    setResidual(a ? (a.residual / 100).toFixed(2) : '0.00');
    setEdit(
      a || {
        id: crypto.randomUUID(),
        name: '',
        serial: '',
        purchaseDate: today(),
        cost: 0,
        residual: 0,
        lifeMonths: 60,
        notes: '',
        archived: false,
      },
    );
  }
  return (
    <>
      <div className="section-actions">
        <p>
          Equipment register and straight-line planning estimates. Saved assets do not post to the
          ledger.
        </p>
        <button
          className="btn"
          onClick={() =>
            download(
              'asset-register.csv',
              csv([
                [
                  'Asset',
                  'Serial',
                  'Purchase date',
                  'Recorded cost',
                  'Residual',
                  'Useful life months',
                  'Monthly estimate',
                  'Status',
                ],
                ...assets.map((a) => [
                  a.name,
                  a.serial,
                  a.purchaseDate,
                  a.cost / 100,
                  a.residual / 100,
                  a.lifeMonths,
                  Math.round((a.cost - a.residual) / a.lifeMonths) / 100,
                  a.archived ? 'archived' : 'active',
                ]),
              ]),
            )
          }
        >
          <Download size={16} />
          Export register
        </button>
        <button className="btn primary" disabled={!canWrite} onClick={() => open()}>
          <Plus size={17} />
          New asset
        </button>
      </div>
      <div className="notice">
        Record the cost basis, residual value and useful life agreed with your accountant. Monthly
        figures are estimates, not tax depreciation calculations. Record acquisitions and
        depreciation through reviewed bookkeeping entries.
      </div>
      <section className="panel">
        {assets.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset / serial</TableHead>
                <TableHead>Purchase date</TableHead>
                <TableHead className="number">Cost basis</TableHead>
                <TableHead className="number">Residual</TableHead>
                <TableHead>Life</TableHead>
                <TableHead className="number">Monthly estimate</TableHead>
                <TableHead>Edit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assets.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    {a.name}
                    <div className="secondary">
                      {a.serial} {a.archived ? '· Archived' : ''}
                    </div>
                  </TableCell>
                  <TableCell>{shortDate(a.purchaseDate)}</TableCell>
                  <TableCell className="number">{money(a.cost)}</TableCell>
                  <TableCell className="number">{money(a.residual)}</TableCell>
                  <TableCell>{a.lifeMonths} months</TableCell>
                  <TableCell className="number">
                    {money(Math.round((a.cost - a.residual) / a.lifeMonths))}
                  </TableCell>
                  <TableCell>
                    <button className="btn small" disabled={!canWrite} onClick={() => open(a)}>
                      Edit
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Empty title="Keep track of your equipment">
            Record vehicles, drain cameras, jetters and other business assets, with useful lives
            confirmed by your accountant.
          </Empty>
        )}
      </section>
      <Dialog open={!!edit} onOpenChange={(o) => !o && canWrite && setEdit(null)}>
        <DialogContent className="large-dialog">
          <DialogHeader>
            <DialogTitle>Fixed asset record</DialogTitle>
            <DialogDescription>This register is separate from ledger postings.</DialogDescription>
          </DialogHeader>
          {edit && (
            <form
              className="book-form"
              onSubmit={async (e) => {
                e.preventDefault();
                setError('');
                try {
                  if (
                    await mutate({
                      action: 'asset',
                      record: {...edit, cost: cents(cost), residual: cents(residual)},
                    })
                  )
                    setEdit(null);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <div className="form-grid">
                <label>
                  Asset name
                  <input
                    required
                    value={edit.name}
                    onChange={(e) => setEdit({...edit, name: e.target.value})}
                  />
                </label>
                <label>
                  Serial / registration
                  <input
                    value={edit.serial}
                    onChange={(e) => setEdit({...edit, serial: e.target.value})}
                  />
                </label>
                <label>
                  Purchase date
                  <input
                    type="date"
                    required
                    value={edit.purchaseDate}
                    onChange={(e) => setEdit({...edit, purchaseDate: e.target.value})}
                  />
                </label>
                <label>
                  Cost basis $
                  <input
                    required
                    inputMode="decimal"
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                  />
                </label>
                <label>
                  Residual value $
                  <input
                    required
                    inputMode="decimal"
                    value={residual}
                    onChange={(e) => setResidual(e.target.value)}
                  />
                </label>
                <label>
                  Useful life (months)
                  <input
                    type="number"
                    min={1}
                    max={600}
                    required
                    value={edit.lifeMonths}
                    onChange={(e) => setEdit({...edit, lifeMonths: Number(e.target.value)})}
                  />
                </label>
                <label className="full-width">
                  Notes
                  <textarea
                    value={edit.notes}
                    onChange={(e) => setEdit({...edit, notes: e.target.value})}
                  />
                </label>
                <label>
                  Status
                  <Choice
                    label="Asset status"
                    value={edit.archived ? 'archived' : 'active'}
                    options={[
                      ['active', 'Active'],
                      ['archived', 'Archived'],
                    ]}
                    onChange={(x) => setEdit({...edit, archived: x === 'archived'})}
                  />
                </label>
              </div>
              {error && <p className="form-error">{error}</p>}
              <button className="btn primary" disabled={!canWrite}>
                Save asset
              </button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
export function BusinessArea({
  state,
  area,
  onGo,
  onDocument,
  onNew,
  canWrite,
}: {
  state: State;
  area: 'sales' | 'purchases';
  onGo: (view: string) => void;
  onDocument: (id: string) => void;
  onNew: (type: Doc['type']) => void;
  canWrite: boolean;
}) {
  const sale = area === 'sales',
    v = derive(state.events),
    docs = v.docs.filter((d) => d.type === (sale ? 'invoice' : 'bill')),
    orders = v.docs.filter((d) => d.type === (sale ? 'quote' : 'purchase_order')),
    open = docs.filter((d) => d.status === 'open'),
    overdue = open.filter((d) => d.due < today()),
    goals = sale
      ? [
          ['Quotes', 'Prepare a job estimate'],
          ['Invoices', 'Record work and collect payment'],
          ['Products & services', 'Reuse your labour rates and prices'],
          ['Customers', 'View customer balances'],
        ]
      : [
          ['Purchase orders', 'Plan supplier purchases'],
          ['Bills & expenses', 'Record and pay supplier bills'],
          ['Expense payments', 'Review categorised bank expenses'],
          ['Suppliers', 'View supplier balances'],
        ];
  return (
    <>
      <div className="section-actions">
        <p>
          {sale ? 'Your jobs from quote to payment.' : 'Your purchases from order to bill payment.'}
        </p>
        <button
          className="btn primary"
          disabled={!canWrite}
          onClick={() => onNew(sale ? 'quote' : 'purchase_order')}
        >
          <Plus size={17} />
          {sale ? 'New quote' : 'New purchase order'}
        </button>
      </div>
      <div className="metrics">
        <div className="metric balance">
          <span>{sale ? 'Customers owe you' : 'Suppliers to pay'}</span>
          <strong>{money(open.reduce((n, d) => n + d.balance, 0))}</strong>
          <small>{open.length} outstanding documents</small>
        </div>
        <div className="metric">
          <span>Overdue</span>
          <strong>{money(overdue.reduce((n, d) => n + d.balance, 0))}</strong>
          <small>{overdue.length} documents past due</small>
        </div>
        <div className="metric">
          <span>{sale ? 'Open quotes' : 'Open purchase orders'}</span>
          <strong>
            {orders.filter((d) => ['draft', 'issued', 'accepted'].includes(d.status)).length}
          </strong>
          <small>No ledger effect until converted and posted</small>
        </div>
        <div className="metric">
          <span>Draft {sale ? 'invoices' : 'bills'}</span>
          <strong>{docs.filter((d) => d.status === 'draft').length}</strong>
          <small>Ready to review</small>
        </div>
      </div>
      <div className="workflow-links">
        {goals.map(([name, desc]) => (
          <button className="panel workflow-link" key={name} onClick={() => onGo(name)}>
            <div>
              <h2>{name}</h2>
              <p>{desc}</p>
            </div>
            <ArrowRight size={20} />
          </button>
        ))}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Upcoming & overdue payments</h2>
        </div>
        {open.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead>Contact / job</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="number">Outstanding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {open
                .sort((a, b) => a.due.localeCompare(b.due))
                .slice(0, 10)
                .map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <button className="record-link" onClick={() => onDocument(d.id)}>
                        {d.number}
                      </button>
                    </TableCell>
                    <TableCell>
                      {d.contact}
                      <div className="secondary">{d.job}</div>
                    </TableCell>
                    <TableCell>{shortDate(d.due)}</TableCell>
                    <TableCell className="number">{money(d.balance)}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        ) : (
          <Empty title="No payments outstanding">
            Posted invoices and bills will appear here until fully paid.
          </Empty>
        )}
      </section>
    </>
  );
}
export function ExpensePayments({state, onGo}: {state: State; onGo: (s: string) => void}) {
  const [query, setQuery] = useState(''),
    v = derive(state.events),
    rows = state.events.filter(
      (e) =>
        e.kind === 'cash' &&
        e.payload.journal.lines.some((l: any) =>
          accounts.some((a) => a[0] === l.account && a[2] === 'expense'),
        ) &&
        v.banks.find((b) => b.id === e.payload.bankId)!.amount < 0 &&
        (e.payload.journal.description + ' ' + e.payload.journal.reference)
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
  return (
    <>
      <div className="section-actions">
        <p>Expenses recorded directly from bank lines. Supplier bills are in Bills & expenses.</p>
        <button className="btn primary" onClick={() => onGo('Bank reconciliation')}>
          <Landmark size={17} />
          Record from bank statement
        </button>
      </div>
      <section className="panel">
        <Toolbar query={query} onQuery={setQuery}>
          <button
            className="btn"
            onClick={() =>
              download(
                'expense-payments.csv',
                csv([
                  ['Date', 'Description', 'Reference', 'Gross', 'GST', 'Bank'],
                  ...rows.map((e) => {
                    const b = v.banks.find((b) => b.id === e.payload.bankId)!;
                    return [
                      b.date,
                      b.description,
                      b.reference,
                      -b.amount / 100,
                      e.payload.gstPurchases / 100,
                      bankName(b.account || '100', state.settings),
                    ];
                  }),
                ]),
              )
            }
          >
            <Download size={16} />
            Export
          </button>
        </Toolbar>
        {rows.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Expense</TableHead>
                <TableHead>Categories</TableHead>
                <TableHead className="number">GST</TableHead>
                <TableHead className="number">Paid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => {
                const b = v.banks.find((b) => b.id === e.payload.bankId)!;
                return (
                  <TableRow key={e.id}>
                    <TableCell>{shortDate(b.date)}</TableCell>
                    <TableCell>
                      {b.description}
                      <div className="secondary">{b.reference}</div>
                    </TableCell>
                    <TableCell>
                      {e.payload.journal.lines
                        .filter(
                          (l: any) =>
                            !bankCodes.some((c) => c === l.account) && l.account !== '120',
                        )
                        .map((l: any) => accounts.find((a) => a[0] === l.account)?.[1])
                        .join(', ')}
                    </TableCell>
                    <TableCell className="number">{money(e.payload.gstPurchases)}</TableCell>
                    <TableCell className="number">{money(-b.amount)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <Empty title="No direct expense payments">
            Import a statement and categorise expenses that do not already have a bill.
          </Empty>
        )}
      </section>
    </>
  );
}
export function WorkflowActions({
  doc,
  state,
  canWrite,
  mutate,
  onOpen,
}: {
  doc: ViewDoc;
  state: State;
  canWrite: boolean;
  mutate: Props['mutate'];
  onOpen: (id: string) => void;
}) {
  const [convert, setConvert] = useState(false),
    [date, setDate] = useState(today()),
    [due, setDue] = useState(today()),
    [confirm, setConfirm] = useState<string | null>(null);
  return (
    <>
      <div className="detail-buttons">
        {doc.status === 'draft' && (
          <button className="btn primary" disabled={!canWrite} onClick={() => setConfirm('issued')}>
            Mark {doc.type === 'quote' ? 'quote' : 'order'} issued
          </button>
        )}
        {doc.type === 'quote' && doc.status === 'issued' && (
          <>
            <button
              className="btn primary"
              disabled={!canWrite}
              onClick={() => setConfirm('accepted')}
            >
              Record acceptance
            </button>
            <button className="btn" disabled={!canWrite} onClick={() => setConfirm('declined')}>
              Record decline
            </button>
          </>
        )}
        {((doc.type === 'quote' && doc.status === 'accepted') ||
          (doc.type === 'purchase_order' && doc.status === 'issued')) && (
          <button
            className="btn primary"
            disabled={!canWrite}
            onClick={() => {
              setDate(today());
              setDue(today());
              setConvert(true);
            }}
          >
            Convert to {doc.type === 'quote' ? 'invoice' : 'bill'}
          </button>
        )}
        {['draft', 'issued', 'accepted'].includes(doc.status) && (
          <button className="btn" disabled={!canWrite} onClick={() => setConfirm('void')}>
            Void {docLabel(doc.type).toLowerCase()}
          </button>
        )}
        {doc.convertedId && (
          <button className="btn primary" onClick={() => onOpen(doc.convertedId!)}>
            Open linked {doc.type === 'quote' ? 'invoice' : 'bill'}
          </button>
        )}
      </div>
      <p className="fineprint">
        Status changes are recorded by you. Documents are not emailed and customer acceptance is not
        collected online.
      </p>
      <Dialog open={!!confirm} onOpenChange={(o) => !o && canWrite && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record {confirm} status?</DialogTitle>
            <DialogDescription>
              {confirm === 'accepted'
                ? 'Confirm that the customer has accepted this quote.'
                : confirm === 'issued'
                  ? 'Confirm that this document is ready and has been issued through your normal process. The document becomes read-only.'
                  : 'This changes the document status and keeps its history.'}
            </DialogDescription>
          </DialogHeader>
          <button
            className="btn primary"
            disabled={!canWrite}
            onClick={async () => {
              if (await mutate({action: 'workflowStatus', id: doc.id, status: confirm}))
                setConfirm(null);
            }}
          >
            Confirm status
          </button>
        </DialogContent>
      </Dialog>
      <Dialog open={convert} onOpenChange={(o) => canWrite && setConvert(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create {doc.type === 'quote' ? 'invoice' : 'bill'} draft</DialogTitle>
            <DialogDescription>
              {doc.type === 'quote'
                ? 'Copies the accepted quote into one linked invoice draft. Review the work and amounts before posting.'
                : 'Copies this order into one linked bill draft. Check the actual supplier invoice, prices and reference before posting.'}
            </DialogDescription>
          </DialogHeader>
          <form
            className="book-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await mutate({action: 'convert', id: doc.id, date, due})) setConvert(false);
            }}
          >
            <label>
              Issue date
              <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              Due date
              <input
                type="date"
                min={date}
                required
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
            <button className="btn primary" disabled={!canWrite}>
              Create linked draft
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
export function Connections({state, onGo}: {state: State; onGo: (s: string) => void}) {
  return (
    <>
      <div className="notice">
        This platform currently records transactions you enter or import. The services below require
        separate integrations before they can operate here.
      </div>
      <div className="check-grid">
        {[
          [
            'Bank feeds',
            'Statement CSV import is available. Live bank connections are not configured.',
            'Bank reconciliation',
          ],
          [
            'Online payments',
            'Invoices show your bank transfer details. Card checkout and payment links are not configured.',
            'Settings',
          ],
          [
            'Xero migration',
            'Reviewed draft document imports and a cutover checklist are available. Full historical migration still needs source exports and comparison.',
            'Migration & backups',
          ],
          [
            'Tax lodgment',
            'GST and contractor review worksheets are available. BAS and TPAR cannot be lodged here.',
            'Reports',
          ],
          [
            'Payroll',
            'This workspace covers bookkeeping. Pay runs, superannuation and STP are outside the selected scope.',
            'Settings',
          ],
          [
            'Receipt capture',
            'Upload originals while creating bills, recover unsaved uploads, review AI suggestions when its API is connected.',
            'Bills & expenses',
          ],
          [
            'Invoice delivery',
            'Prepare invoices, statements and reminders. Actual email sending needs a verified Resend sender and API secret.',
            'Email & reminders',
          ],
          [
            'Recurring invoices',
            'Save a schedule and generate reviewable drafts. Maintenance can generate due drafts while the app is closed.',
            'Recurring invoices',
          ],
          [
            'Record exports',
            'Download records with original attachments and verify the backup balances. Recovery centre adds stored snapshots, isolated restore tests and background-run status.',
            'Migration & backups',
          ],
        ].map(([name, desc, view]) => (
          <section className="panel check-card" key={name}>
            <h2>{name}</h2>
            <p>{desc}</p>
            <button className="text-btn" onClick={() => onGo(view)}>
              Open {view.toLowerCase()} <ArrowRight size={16} />
            </button>
          </section>
        ))}
      </div>
    </>
  );
}
