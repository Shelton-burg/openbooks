'use client';
import {useEffect, useMemo, useState, type FormEvent} from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  BookOpen,
  Building2,
  ChartNoAxesCombined,
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  FileText,
  History,
  Landmark,
  LayoutDashboard,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  Wallet,
  Wrench,
  X,
  Printer,
} from 'lucide-react';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger,
} from '@/components/ui/sidebar';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {Table, TableHeader, TableBody, TableHead, TableRow, TableCell} from '@/components/ui/table';
import {Tabs, TabsList, TabsTrigger, TabsContent} from '@/components/ui/tabs';
import {Skeleton} from '@/components/ui/skeleton';
import {Toaster, toast} from 'sonner';
import {Choice, Empty, download} from './book-ui';
import {
  Contacts,
  Products,
  BankRules,
  Assets,
  AdvancedReports,
  AccountingTools,
  BusinessArea,
  ExpensePayments,
  WorkflowActions,
  Connections,
} from './operations';
import {
  operations,
  isSale,
  isLedger,
  docLabel,
  nextNumber,
  ruleMatches,
  type Contact,
} from '@/lib/operations';
import Attachments from './attachments';
import {EmailCentre, RecurringInvoices} from './sales-tools';
import Cutover from './cutover';
import Recovery from './recovery';
import Corrections from './corrections';
import ReceiptUpload from './receipt-upload';
import {receiptDraft, type Receipt as ScannedReceipt} from '@/lib/receipt';
import Reconcile from './bank-review';
import AustralianTaxReview, {GSTWorkpaper, ContractorReview} from './compliance';
import MigrationHub from './migration';
import ImportCentre from './import-centre';
import {Credits, CustomerFunds, CreditPrint} from './finance';
import type {Credit} from '@/lib/finance';
import {invoiceChecks} from '@/lib/compliance';
import XeroReferencePanel from './xero-reference';
import type {XeroReference} from '@/lib/xero-reference';
import {
  accounts,
  bankCodes,
  bankName,
  defaultSettings,
  derive,
  report,
  money,
  today,
  shortDate,
  totals,
  parseCsv,
  csv,
  cents,
  type State,
  type Doc,
  type ViewDoc,
  type Line,
  type Settings,
  type Bank,
} from '@/lib/books';
import {demoState} from '@/lib/demo';
const navGroups = [
  [
    'WORKSPACE',
    [
      ['Overview', LayoutDashboard],
      ['Import centre', Upload],
      ['Contacts', Building2],
      ['Xero reference', BookOpen],
    ],
  ],
  [
    'SALES',
    [
      ['Sales overview', ChartNoAxesCombined],
      ['Quotes', FileText],
      ['Invoices', Receipt],
      ['Email & reminders', FileText],
      ['Recurring invoices', History],
      ['Credits & refunds', Receipt],
      ['Customer funds', Wallet],
      ['Products & services', Wrench],
      ['Customers', Building2],
    ],
  ],
  [
    'PURCHASES',
    [
      ['Purchases overview', Wallet],
      ['Purchase orders', FileText],
      ['Bills & expenses', Receipt],
      ['Expense payments', Wallet],
      ['Suppliers', Building2],
    ],
  ],
  [
    'REPORTING',
    [
      ['Reports', ChartNoAxesCombined],
      ['Aged balances', History],
      ['Cash flow', ChartNoAxesCombined],
      ['Cash summary', Wallet],
    ],
  ],
  [
    'ACCOUNTING',
    [
      ['Bank reconciliation', Landmark],
      ['Correct bank matches', History],
      ['Bank rules', Settings2],
      ['Chart of accounts', BookOpen],
      ['Fixed assets', Wrench],
      ['Manual journals', FileText],
      ['Find & reclassify', Search],
      ['Bookkeeping checks', ShieldCheck],
      ['Audit history', History],
    ],
  ],
  [
    'TAX & SETTINGS',
    [
      ['Australian tax review', ShieldCheck],
      ['Contractor worksheet', Receipt],
      ['Settings', Settings2],
      ['Migration & backups', ShieldCheck],
      ['Recovery centre', ShieldCheck],
      ['Xero comparison', BookOpen],
      ['Connections & migration', Building2],
    ],
  ],
] as const;
function Status({doc}: {doc: ViewDoc}) {
  const status = doc.status === 'open' && doc.due < today() ? 'overdue' : doc.status;
  return (
    <span className={'status ' + status}>
      {status === 'open'
        ? doc.paid > 0
          ? 'Part paid'
          : 'Awaiting payment'
        : status === 'paid'
          ? doc.credited
            ? 'Settled'
            : 'Paid'
          : status[0].toUpperCase() + status.slice(1)}
    </span>
  );
}
export default function Books({
  displayName,
  accessRole = 'owner',
  businessName = '',
  demoOnly = false,
}: {
  displayName: string;
  accessRole?: 'owner' | 'bookkeeper' | 'viewer';
  businessName?: string;
  demoOnly?: boolean;
}) {
  const [real, setReal] = useState<State>({events: [], settings: defaultSettings}),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [sample, setSample] = useState(demoOnly),
    [view, setView] = useState('Overview'),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all');
  const [create, setCreate] = useState<Doc['type'] | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [importing, setImporting] = useState(false),
    [bankSelected, setBankSelected] = useState<Bank | null>(null),
    [printDoc, setPrintDoc] = useState<ViewDoc | null>(null);
  const [action, setAction] = useState<{type: string; id: string} | null>(null),
    [reason, setReason] = useState(''),
    [reversalDate, setReversalDate] = useState(today());
  const [creditSource, setCreditSource] = useState<string | undefined>(),
    [printCredit, setPrintCredit] = useState<Credit | null>(null);
  const [editDoc, setEditDoc] = useState<Doc | null>(null),
    [seedContact, setSeedContact] = useState<Contact | null>(null);
  function startDocument(type: Doc['type'], contact?: Contact) {
    setEditDoc(null);
    setSeedContact(contact || null);
    setCreate(type);
  }
  const [activeBank, setActiveBank] = useState('100');
  const [from, setFrom] = useState(today().slice(0, 7) + '-01'),
    [to, setTo] = useState(today());
  const sampleData = useMemo(() => demoState(), []),
    s = sample ? sampleData : real,
    v = useMemo(() => derive(s.events), [s.events]),
    r = useMemo(() => report(s.events, from, to, s.settings.gstBasis), [s, from, to]);
  const selectedDoc = v.docs.find((d) => d.id === selected),
    unmatched = v.banks.filter((b) => !v.usedBanks.has(b.id));
  const accountLines = v.banks.filter((b) => (b.account || '100') === activeBank),
    accountUnmatched = accountLines.filter((b) => !v.usedBanks.has(b.id));
  const reference = s.events
    .slice()
    .reverse()
    .find((e) => e.kind === 'xero_reference')?.payload as XeroReference | undefined;
  async function load() {
    if (demoOnly) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/books', {cache: 'no-store'}),
        data = (await res.json()) as State & {error?: string};
      if (!res.ok) throw new Error(data.error);
      setReal(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function mutate(body: unknown) {
    if (sample || accessRole === 'viewer') {
      toast('Exit the sample view to save your own records.');
      return false;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/books', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({...(body as object), revision: real.events.at(-1)?.id || 'empty'}),
      });
      const data = (await response.json()) as State & {error?: string};
      if (!response.ok) {
        if ((data as any).state) setReal((data as any).state);
        throw new Error(data.error);
      }
      setReal(data);
      toast.success('Saved to your books');
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function go(name: string) {
    if (name !== 'Credits & refunds') setCreditSource(undefined);
    if (name === 'Xero reference' && !demoOnly) setSample(false);
    setView(name);
    setQuery('');
    setFilter('all');
  }
  const canWrite = accessRole !== 'viewer' && !busy && !sample && !loading && !error;
  const invoices = v.docs.filter((d) => d.type === 'invoice'),
    bills = v.docs.filter((d) => d.type === 'bill');
  const owed = invoices.filter((d) => d.status === 'open').reduce((n, d) => n + d.balance, 0),
    payable = bills.filter((d) => d.status === 'open').reduce((n, d) => n + d.balance, 0),
    overdue = invoices.filter((d) => d.status === 'open' && d.due < today());
  const listType: Doc['type'] =
    view === 'Quotes'
      ? 'quote'
      : view === 'Purchase orders'
        ? 'purchase_order'
        : view === 'Bills & expenses'
          ? 'bill'
          : 'invoice';
  const listDocs = v.docs.filter((d) => d.type === listType);
  const bankBalance = r.trial
    .filter((a) => bankCodes.some((c) => c === a.code))
    .reduce((n, a) => n + a.balance, 0);
  function DocTable({docs}: {docs: ViewDoc[]}) {
    return docs.length ? (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Reference / contact</TableHead>
            <TableHead>Job</TableHead>
            <TableHead>Due date</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="number">Amount</TableHead>
            <TableHead>
              <span className="sr-only">Open</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {docs.map((d) => (
            <TableRow key={d.id}>
              <TableCell>
                <button className="record-link" onClick={() => setSelected(d.id)}>
                  {d.number}
                </button>
                <div className="secondary">{d.contact}</div>
              </TableCell>
              <TableCell>{d.job || '—'}</TableCell>
              <TableCell>{shortDate(d.due)}</TableCell>
              <TableCell>
                <Status doc={d} />
              </TableCell>
              <TableCell className="number strong">
                {money(d.total)}
                {d.status === 'open' && d.paid > 0 && (
                  <div className="secondary">{money(d.balance)} remaining</div>
                )}
              </TableCell>
              <TableCell>
                <button
                  className="icon-btn"
                  aria-label={'Open ' + d.number}
                  onClick={() => setSelected(d.id)}
                >
                  <ChevronRight size={18} />
                </button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    ) : (
      <Empty title="No documents here yet">
        Create an invoice or bill to start keeping your books.
      </Empty>
    );
  }
  const lastMaintenance = s.events.filter((e) => e.kind === 'maintenance_result').at(-1)?.payload;
  const maintenanceIssue =
    lastMaintenance &&
    (lastMaintenance.status === 'failed' ||
      Date.parse(today()) - Date.parse(lastMaintenance.date) > 2 * 86400000);
  const setupComplete =
    s.settings.gst !== 'unconfirmed' && s.settings.name !== 'My plumbing business';
  return (
    <>
      <SidebarProvider style={{'--sidebar-width': '15.5rem'} as React.CSSProperties}>
        <Sidebar className="books-sidebar">
          <SidebarHeader className="brand">
            <div className="brand-icon">
              <Wrench size={23} />
            </div>
            <div>
              <b>TradeDesk</b>
              <span>BOOKS</span>
            </div>
          </SidebarHeader>
          <div className="business-chip">
            <div className="business-monogram">{sample ? 'CP' : 'AP'}</div>
            <div>
              <strong>
                {sample
                  ? 'Coastal Plumbing'
                  : s.settings.name === 'My plumbing business'
                    ? businessName
                    : s.settings.name}
              </strong>
              <small>{sample ? 'Sample business' : 'Private workspace'}</small>
            </div>
          </div>
          <SidebarContent>
            {navGroups.map(([group, items]) => (
              <div key={group}>
                <p className="nav-caption">{group}</p>
                <SidebarMenu>
                  {items.map(([name, Icon]) => (
                    <SidebarMenuItem key={name}>
                      <SidebarMenuButton
                        isActive={view === name}
                        onClick={() => go(name)}
                        className="nav-button"
                      >
                        <Icon />
                        <span>{name}</span>
                        {name === 'Bank reconciliation' && unmatched.length > 0 && (
                          <b className="nav-count">{unmatched.length}</b>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </div>
            ))}
          </SidebarContent>
          <SidebarFooter>
            <div className="sidebar-note">
              <ShieldCheck size={19} />
              <div>
                {demoOnly ? 'Fictional records only' : 'Business workspace'}
                <small>Australian dollars · AUD</small>
              </div>
            </div>
            <div className="user-chip">
              <div className="avatar">{displayName.slice(0, 2).toUpperCase()}</div>
              <div>
                <strong>{displayName.includes('@') ? 'Your account' : displayName}</strong>
                <small>{demoOnly ? 'Demo visitor' : accessRole}</small>
              </div>
            </div>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset className="workspace">
          <header className="topbar">
            <div className="breadcrumb">
              <SidebarTrigger />
              <span>Books</span>
              <ChevronRight size={14} />
              <strong>{view}</strong>
            </div>
            <div className="top-actions">
              {!demoOnly && (
                <a className="text-btn" href="/account">
                  Business & access
                </a>
              )}
              <button
                className={'sample-toggle ' + (sample ? 'selected' : '')}
                disabled={demoOnly}
                onClick={() => {
                  setSample(!sample);
                  go(sample ? 'Overview' : 'Overview');
                }}
              >
                {demoOnly ? 'Community demo' : sample ? 'Exit sample view' : 'Explore sample books'}
              </button>
              <span className="private-label">
                <ShieldCheck size={15} /> {demoOnly ? 'Demo' : 'Private'}
              </span>
            </div>
          </header>
          <main className="content">
            <div className="page-heading">
              <div>
                <p className="eyebrow">{shortDate(today())} · GOLD COAST</p>
                <h1>
                  {view === 'Xero reference'
                    ? reference?.company || 'Your Xero reference'
                    : view === 'Overview'
                      ? 'Your working books'
                      : view}
                </h1>
                <p className="subheading">
                  {view === 'Xero reference'
                    ? 'Your business priorities, based on the information you shared.'
                    : view === 'Overview'
                      ? 'Balances and activity posted in TradeDesk Books.'
                      : view === 'Invoices'
                        ? 'Create, review and track your customer invoices.'
                        : view === 'Bills & expenses'
                          ? 'Keep supplier costs and job expenses together.'
                          : view === 'Bank reconciliation'
                            ? 'Match statement lines to invoices and bills, or categorise a payment.'
                            : view === 'Reports'
                              ? 'Financial reports built from your posted records.'
                              : view === 'Audit history'
                                ? 'Every saved action, in the order it happened.'
                                : (
                                    {
                                      Quotes: 'Prepare, issue and convert job estimates.',
                                      'Purchase orders':
                                        'Plan supplier purchases and turn orders into reviewed bills.',
                                      Contacts: 'Your saved customers and suppliers.',
                                      Customers: 'Customer details and outstanding balances.',
                                      Suppliers: 'Supplier details and outstanding balances.',
                                      'Products & services':
                                        'Your reusable prices, materials and labour rates.',
                                      Settings:
                                        'Your business details and bookkeeping preferences.',
                                    } as Record<string, string>
                                  )[view] || ''}
                </p>
              </div>
              {['Overview', 'Invoices', 'Bills & expenses', 'Quotes', 'Purchase orders'].includes(
                view,
              ) && (
                <button
                  className="btn primary"
                  disabled={!canWrite}
                  onClick={() => startDocument(listType)}
                >
                  <Plus size={18} />
                  {'New ' + docLabel(listType).toLowerCase()}
                </button>
              )}
            </div>
            {accessRole === 'viewer' && !sample && (
              <div className="notice">
                Read-only access. You can review records and download exports.
              </div>
            )}
            {sample && (
              <div className="notice sample-notice">
                <BookOpen size={19} />
                <span>
                  <strong>Sample books.</strong> These are fictional records for exploring the
                  workspace. Saving is disabled.
                </span>
                {!demoOnly && (
                  <button onClick={() => setSample(false)}>
                    Back to my books <ArrowRight size={16} />
                  </button>
                )}
              </div>
            )}
            {error && !sample && (
              <div className="notice error-notice" role="alert">
                <span>{error}</span>
                <button onClick={load}>
                  <RefreshCw size={16} />
                  Try again
                </button>
              </div>
            )}
            {loading && !sample ? (
              <div className="loading-grid">
                <Skeleton className="h-36" />
                <Skeleton className="h-36" />
                <Skeleton className="h-72 col-span-2" />
              </div>
            ) : error && !sample ? null : (
              <>
                {view === 'Xero reference' &&
                  (reference ? (
                    <XeroReferencePanel
                      reference={reference}
                      onBank={(account) => {
                        setActiveBank(account);
                        go('Bank reconciliation');
                      }}
                      onBooks={() => go('Overview')}
                    />
                  ) : (
                    <Empty title="No Xero reference for this account">
                      Your working books are available from Overview.
                    </Empty>
                  ))}
                {view === 'Overview' && (
                  <>
                    {maintenanceIssue && !sample && (
                      <div className="notice error-notice" role="alert">
                        <span>
                          {lastMaintenance.status === 'failed'
                            ? 'The last backup run failed: ' + lastMaintenance.message
                            : 'Your last recorded maintenance run is over two days old.'}
                        </span>
                        <button onClick={() => go('Recovery centre')}>Review backups</button>
                      </div>
                    )}
                    {reference && !sample && (
                      <div className="notice">
                        <BookOpen size={18} />
                        <span>
                          These are your new ledger balances. Screenshot totals are kept in{' '}
                          <button className="inline-link" onClick={() => go('Xero reference')}>
                            Xero reference
                          </button>{' '}
                          until the underlying records are imported.
                        </span>
                      </div>
                    )}
                    {!setupComplete && !sample && (
                      <div className="setup-strip">
                        <div className="setup-symbol">
                          <Building2 size={24} />
                        </div>
                        <div>
                          <h3>Let’s set up your books</h3>
                          <p>
                            Add your business details and confirm GST registration before posting
                            transactions.
                          </p>
                        </div>
                        <button className="btn" onClick={() => go('Settings')}>
                          Business settings <ArrowRight size={16} />
                        </button>
                      </div>
                    )}
                    <div className="metrics">
                      <article className="metric balance">
                        <span>
                          <Wallet size={18} /> Combined book bank balance
                        </span>
                        <strong>{money(bankBalance)}</strong>
                        <small>Posted ledger balance as at {shortDate(to)}</small>
                      </article>
                      <button className="metric" onClick={() => go('Invoices')}>
                        <span>
                          <ArrowDownLeft size={18} /> Customers owe you
                        </span>
                        <strong>{money(owed)}</strong>
                        <small>
                          {invoices.filter((d) => d.status === 'open').length} invoices awaiting
                          payment
                        </small>
                      </button>
                      <button className="metric" onClick={() => go('Bills & expenses')}>
                        <span>
                          <ArrowUpRight size={18} /> Bills to pay
                        </span>
                        <strong>{money(payable)}</strong>
                        <small>
                          {bills.filter((d) => d.status === 'open').length} supplier bills
                          outstanding
                        </small>
                      </button>
                      <button className="metric" onClick={() => go('Bank reconciliation')}>
                        <span>
                          <Landmark size={18} /> To reconcile
                        </span>
                        <strong>
                          {unmatched.length}
                          <em>statement lines</em>
                        </strong>
                        <small>
                          {unmatched.length
                            ? 'Ready for your review'
                            : 'Your imported lines are up to date'}
                        </small>
                      </button>
                    </div>
                    <div className="overview-grid">
                      <section className="panel">
                        <div className="panel-heading">
                          <div>
                            <h2>Money in & out</h2>
                            <p>Reconciled bank movements · last 6 months</p>
                          </div>
                          <span className="unit">AUD</span>
                        </div>
                        <CashChart journal={v.journal} />
                        <div className="chart-legend">
                          <span>
                            <i className="in" />
                            Money in
                          </span>
                          <span>
                            <i className="out" />
                            Money out
                          </span>
                        </div>
                      </section>
                      <section className="panel attention">
                        <div className="panel-heading">
                          <h2>Needs your attention</h2>
                          <span className="attention-badge">
                            {overdue.length + unmatched.length}
                          </span>
                        </div>
                        <button
                          className="attention-row"
                          onClick={() => {
                            go('Invoices');
                            setFilter('overdue');
                          }}
                        >
                          <div className="attention-icon amber">
                            <FileText />
                          </div>
                          <div>
                            <strong>{overdue.length} overdue invoices</strong>
                            <p>
                              {money(overdue.reduce((a, d) => a + d.balance, 0))} waiting to be
                              collected
                            </p>
                          </div>
                          <ChevronRight />
                        </button>
                        <button className="attention-row" onClick={() => go('Bank reconciliation')}>
                          <div className="attention-icon blue">
                            <Landmark />
                          </div>
                          <div>
                            <strong>{unmatched.length} bank lines to review</strong>
                            <p>Match payments to your books</p>
                          </div>
                          <ChevronRight />
                        </button>
                        <button
                          className="attention-row"
                          onClick={() => {
                            go('Invoices');
                            setFilter('draft');
                          }}
                        >
                          <div className="attention-icon neutral">
                            <FileText />
                          </div>
                          <div>
                            <strong>
                              {invoices.filter((d) => d.status === 'draft').length} draft invoices
                            </strong>
                            <p>Review before posting</p>
                          </div>
                          <ChevronRight />
                        </button>
                        <div className="attention-foot">
                          <ShieldCheck size={17} /> Drafts stay out of your reports.
                        </div>
                      </section>
                    </div>
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Recent invoices</h2>
                          <p>Your latest customer jobs</p>
                        </div>
                        <button className="text-btn" onClick={() => go('Invoices')}>
                          View all invoices <ArrowRight size={16} />
                        </button>
                      </div>
                      <DocTable docs={invoices.slice().reverse().slice(0, 5)} />
                    </section>
                    <div className="setup-strip">
                      <div>
                        <h3>Bring your existing books across</h3>
                        <p>
                          Upload CSV exports, PDFs and screenshots, then review before importing.
                        </p>
                      </div>
                      <button className="btn" onClick={() => go('Import centre')}>
                        <Upload size={17} />
                        Import centre
                      </button>
                    </div>
                    <div className="pilot-note">
                      <ShieldCheck size={18} />
                      <p>
                        <strong>Pilot workspace.</strong> Compare these books with Xero before
                        switching. Live bank feeds, card payments, complete Xero migration and tax
                        lodgment still require separate work.
                      </p>
                    </div>
                  </>
                )}
                {['Invoices', 'Bills & expenses', 'Quotes', 'Purchase orders'].includes(view) && (
                  <>
                    <div className="list-summary">
                      <div>
                        <small>{isLedger(listType) ? 'Outstanding' : 'Active value'}</small>
                        <strong>
                          {money(
                            listDocs
                              .filter((d) =>
                                isLedger(listType)
                                  ? d.status === 'open'
                                  : ['draft', 'issued', 'accepted'].includes(d.status),
                              )
                              .reduce((n, d) => n + (isLedger(listType) ? d.balance : d.total), 0),
                          )}
                        </strong>
                      </div>
                      <div>
                        <small>Drafts</small>
                        <strong>{listDocs.filter((d) => d.status === 'draft').length}</strong>
                      </div>
                      <div>
                        <small>
                          {isLedger(listType) ? 'Paid documents' : 'Converted documents'}
                        </small>
                        <strong>
                          {
                            listDocs.filter(
                              (d) => d.status === (isLedger(listType) ? 'paid' : 'converted'),
                            ).length
                          }
                        </strong>
                      </div>
                    </div>
                    <section className="panel">
                      <div className="table-toolbar">
                        <div className="search-field">
                          <Search size={18} />
                          <input
                            aria-label="Search documents"
                            placeholder="Search reference, contact or job…"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                          />
                        </div>
                        <Choice
                          value={filter}
                          onChange={setFilter}
                          label="Document status"
                          options={(isLedger(listType)
                            ? ['all', 'draft', 'open', 'overdue', 'paid', 'void']
                            : [
                                'all',
                                'draft',
                                'issued',
                                'accepted',
                                'declined',
                                'converted',
                                'void',
                              ]
                          ).map((x) => [
                            x,
                            x === 'all'
                              ? 'All statuses'
                              : x === 'open'
                                ? 'Awaiting payment'
                                : x[0].toUpperCase() + x.slice(1),
                          ])}
                        />
                        <button
                          className="btn"
                          onClick={() =>
                            download(
                              'documents.csv',
                              csv([
                                [
                                  'Type',
                                  'Reference',
                                  'Contact',
                                  'Job',
                                  'Date',
                                  'Due',
                                  'Status',
                                  'Net',
                                  'GST',
                                  'Total',
                                  'Cash paid',
                                  'Credits / funds applied',
                                  'Outstanding',
                                ],
                                ...listDocs.map((d) => [
                                  d.type,
                                  d.number,
                                  d.contact,
                                  d.job,
                                  d.date,
                                  d.due,
                                  d.status,
                                  d.net / 100,
                                  d.taxTotal / 100,
                                  d.total / 100,
                                  d.paid / 100,
                                  d.credited / 100,
                                  d.status === 'open' ? d.balance / 100 : 0,
                                ]),
                              ]),
                            )
                          }
                        >
                          <Download size={16} />
                          Export
                        </button>
                      </div>
                      <DocTable
                        docs={listDocs
                          .filter(
                            (d) =>
                              (filter === 'all' ||
                                d.status === filter ||
                                (filter === 'overdue' && d.status === 'open' && d.due < today())) &&
                              (d.number + ' ' + d.contact + ' ' + d.job)
                                .toLowerCase()
                                .includes(query.toLowerCase()),
                          )
                          .slice()
                          .reverse()}
                      />
                    </section>
                    <p className="fineprint">
                      {isLedger(listType)
                        ? 'Posting records this document in your ledger. It does not email anyone or send money.'
                        : 'Quotes and purchase orders do not affect your ledger. Convert them into a draft invoice or bill, review it, then post.'}
                    </p>
                  </>
                )}
                {['Contacts', 'Customers', 'Suppliers'].includes(view) && (
                  <Contacts
                    key={view}
                    state={s}
                    canWrite={canWrite}
                    mutate={mutate}
                    onDocument={setSelected}
                    onNew={startDocument}
                    initialRole={
                      view === 'Customers' ? 'customer' : view === 'Suppliers' ? 'supplier' : 'all'
                    }
                  />
                )}
                {view === 'Australian tax review' && (
                  <AustralianTaxReview
                    state={s}
                    canWrite={canWrite}
                    mutate={mutate}
                    onState={setReal}
                    onGo={go}
                  />
                )}
                {view === 'Contractor worksheet' && <ContractorReview state={s} onGo={go} />}
                {view === 'Credits & refunds' && (
                  <Credits
                    state={s}
                    canWrite={canWrite}
                    mutate={mutate}
                    onState={setReal}
                    onGo={go}
                    initialDocId={creditSource}
                    onPrint={(c) => {
                      setPrintDoc(null);
                      setPrintCredit(c);
                      setTimeout(() => window.print(), 100);
                    }}
                  />
                )}
                {view === 'Customer funds' && (
                  <CustomerFunds
                    state={s}
                    canWrite={canWrite}
                    mutate={mutate}
                    onState={setReal}
                    onGo={go}
                  />
                )}
                {view === 'Email & reminders' && (
                  <EmailCentre state={s} onState={setReal} canWrite={canWrite} />
                )}
                {view === 'Recurring invoices' && (
                  <RecurringInvoices state={s} canWrite={canWrite} mutate={mutate} />
                )}
                {view === 'Recovery centre' && (
                  <Recovery state={s} onState={setReal} canWrite={canWrite} />
                )}
                {view === 'Xero comparison' && (
                  <Cutover state={s} canWrite={canWrite} mutate={mutate} />
                )}
                {view === 'Products & services' && (
                  <Products state={s} canWrite={canWrite} mutate={mutate} />
                )}
                {view === 'Correct bank matches' && (
                  <Corrections state={s} canWrite={canWrite} mutate={mutate} />
                )}
                {view === 'Bank rules' && (
                  <BankRules state={s} canWrite={canWrite} mutate={mutate} />
                )}
                {view === 'Fixed assets' && (
                  <Assets state={s} canWrite={canWrite} mutate={mutate} />
                )}
                {['Aged balances', 'Cash flow', 'Cash summary'].includes(view) && (
                  <AdvancedReports key={view} state={s} view={view} onDocument={setSelected} />
                )}
                {[
                  'Manual journals',
                  'Chart of accounts',
                  'Find & reclassify',
                  'Bookkeeping checks',
                ].includes(view) && (
                  <AccountingTools
                    key={view}
                    state={s}
                    canWrite={canWrite}
                    mutate={mutate}
                    view={view}
                  />
                )}
                {['Sales overview', 'Purchases overview'].includes(view) && (
                  <BusinessArea
                    state={s}
                    area={view === 'Sales overview' ? 'sales' : 'purchases'}
                    onGo={go}
                    onDocument={setSelected}
                    onNew={startDocument}
                    canWrite={canWrite}
                  />
                )}
                {view === 'Expense payments' && <ExpensePayments state={s} onGo={go} />}
                {view === 'Import centre' && (
                  <ImportCentre state={s} onState={setReal} canWrite={canWrite} onGo={go} />
                )}
                {view === 'Migration & backups' && (
                  <MigrationHub state={s} canWrite={canWrite} mutate={mutate} onGo={go} />
                )}
                {view === 'Connections & migration' && <Connections state={s} onGo={go} />}
                {view === 'Bank reconciliation' && (
                  <>
                    <div className="bank-account-grid">
                      {bankCodes.map((code) => {
                        const balance = v.journal
                            .flatMap((j) => j.lines)
                            .filter((l) => l.account === code)
                            .reduce((a, l) => a + l.debit - l.credit, 0),
                          waiting = unmatched.filter((b) => (b.account || '100') === code).length;
                        return (
                          <button
                            key={code}
                            className={'bank-account-card ' + (activeBank === code ? 'active' : '')}
                            onClick={() => setActiveBank(code)}
                            aria-pressed={activeBank === code}
                          >
                            <Landmark size={19} />
                            <strong>{bankName(code, s.settings)}</strong>
                            <span>{money(balance)}</span>
                            <small>Book balance · {waiting} to reconcile</small>
                          </button>
                        );
                      })}
                    </div>
                    <section className="bank-header">
                      <div className="bank-symbol">
                        <Landmark />
                      </div>
                      <div>
                        <h2>{bankName(activeBank, s.settings)}</h2>
                        <p>CSV statements · AUD · No live feed connected</p>
                      </div>
                      <div className="bank-total">
                        <small>Book balance in this account</small>
                        <strong>
                          {money(
                            v.journal
                              .flatMap((j) => j.lines)
                              .filter((l) => l.account === activeBank)
                              .reduce((a, l) => a + l.debit - l.credit, 0),
                          )}
                        </strong>
                      </div>
                      <button
                        className="btn primary"
                        disabled={!canWrite}
                        onClick={() => setImporting(true)}
                      >
                        <Upload size={17} />
                        Import statement
                      </button>
                    </section>
                    <div className="notice">
                      Imported lines enter your ledger only after you match, categorise or record an
                      account transfer. Import each statement into its own account.
                    </div>
                    <section className="panel">
                      <div className="table-toolbar">
                        <h2>{accountUnmatched.length} lines to reconcile</h2>
                        <Choice
                          value={filter}
                          onChange={setFilter}
                          label="Bank line status"
                          options={[
                            ['all', 'Unreconciled'],
                            ['done', 'Reconciled'],
                          ]}
                        />
                      </div>
                      {(filter === 'done'
                        ? accountLines.filter((b) => v.usedBanks.has(b.id))
                        : accountUnmatched
                      ).length ? (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead>Statement details</TableHead>
                              <TableHead className="number">Money out</TableHead>
                              <TableHead className="number">Money in</TableHead>
                              <TableHead>Action</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(filter === 'done'
                              ? accountLines.filter((b) => v.usedBanks.has(b.id))
                              : accountUnmatched
                            )
                              .slice()
                              .reverse()
                              .map((b) => (
                                <TableRow key={b.id}>
                                  <TableCell>{shortDate(b.date)}</TableCell>
                                  <TableCell>
                                    <strong>{b.description}</strong>
                                    <div className="secondary">{b.reference}</div>
                                  </TableCell>
                                  <TableCell className="number">
                                    {b.amount < 0 ? money(-b.amount) : '—'}
                                  </TableCell>
                                  <TableCell className="number positive">
                                    {b.amount > 0 ? money(b.amount) : '—'}
                                  </TableCell>
                                  <TableCell>
                                    {filter === 'done' ? (
                                      <span className="status paid">
                                        <Check size={13} />
                                        Reconciled
                                      </span>
                                    ) : (
                                      <button
                                        className="btn small"
                                        onClick={() => setBankSelected(b)}
                                      >
                                        Review <ArrowRight size={15} />
                                      </button>
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                          </TableBody>
                        </Table>
                      ) : (
                        <Empty
                          title={
                            filter === 'done'
                              ? 'No reconciled lines in this account'
                              : 'Nothing waiting in this account'
                          }
                        >
                          {accountLines.length
                            ? 'All imported statement lines in this account have been reviewed.'
                            : 'Import a CSV statement for ' +
                              bankName(activeBank, s.settings) +
                              ' to get started. Screenshot totals are reference information only.'}
                        </Empty>
                      )}
                    </section>
                  </>
                )}
                {view === 'Reports' && (
                  <>
                    <div className="report-controls">
                      <label>
                        From
                        <input
                          type="date"
                          value={from}
                          max={to}
                          onChange={(e) => e.target.value && setFrom(e.target.value)}
                        />
                      </label>
                      <label>
                        To
                        <input
                          type="date"
                          value={to}
                          min={from}
                          onChange={(e) => e.target.value && setTo(e.target.value)}
                        />
                      </label>
                      <span className="basis-label">P&L: accrual · GST: {s.settings.gstBasis}</span>
                      <button
                        className="btn"
                        onClick={() =>
                          download(
                            'general-ledger.csv',
                            csv([
                              ['Date', 'Reference', 'Description', 'Account', 'Debit', 'Credit'],
                              ...r.journal.flatMap((j) =>
                                j.lines.map((l) => [
                                  j.date,
                                  j.reference,
                                  j.description,
                                  l.account,
                                  l.debit / 100,
                                  l.credit / 100,
                                ]),
                              ),
                            ]),
                          )
                        }
                      >
                        <Download size={16} />
                        Export ledger
                      </button>
                    </div>
                    {from > to ? (
                      <div className="notice error-notice">
                        Choose an end date on or after the start date.
                      </div>
                    ) : (
                      <Tabs defaultValue="profit">
                        <TabsList className="report-tabs">
                          <TabsTrigger value="profit">Profit & loss</TabsTrigger>
                          <TabsTrigger value="balance">Balance sheet</TabsTrigger>
                          <TabsTrigger value="trial">Trial balance</TabsTrigger>
                          <TabsTrigger value="gst">GST worksheet</TabsTrigger>
                        </TabsList>
                        <TabsContent value="profit">
                          <section className="panel report-paper">
                            <div className="report-title">
                              <BookOpen />
                              <h2>Profit & loss</h2>
                              <p>
                                {s.settings.name} · {shortDate(from)} – {shortDate(to)}
                              </p>
                            </div>
                            <h3 className="report-section">Income</h3>
                            {r.movements
                              .filter((x) => x.type === 'income')
                              .map((x) => (
                                <div className="report-row" key={x.code}>
                                  <span>{x.name}</span>
                                  <strong>{money(-x.value)}</strong>
                                </div>
                              ))}
                            <div className="report-row subtotal">
                              <span>Total income</span>
                              <strong>{money(r.income)}</strong>
                            </div>
                            <h3 className="report-section">Expenses</h3>
                            {r.movements
                              .filter((x) => x.type === 'expense')
                              .map((x) => (
                                <div className="report-row" key={x.code}>
                                  <span>{x.name}</span>
                                  <strong>{money(x.value)}</strong>
                                </div>
                              ))}
                            <div className="report-row subtotal">
                              <span>Total expenses</span>
                              <strong>{money(r.expenses)}</strong>
                            </div>
                            <div className="report-row grand-total">
                              <span>Net profit / (loss)</span>
                              <strong>{money(r.profit)}</strong>
                            </div>
                          </section>
                        </TabsContent>
                        <TabsContent value="balance">
                          <section className="panel report-paper">
                            <div className="report-title">
                              <h2>Balance sheet</h2>
                              <p>As at {shortDate(to)} · Accrual basis</p>
                            </div>
                            {['asset', 'liability', 'equity'].map((type) => (
                              <div key={type}>
                                <h3 className="report-section">
                                  {type === 'asset'
                                    ? 'Assets'
                                    : type === 'liability'
                                      ? 'Liabilities'
                                      : 'Equity'}
                                </h3>
                                {r.trial
                                  .filter((x) => x.type === type)
                                  .map((x) => (
                                    <div className="report-row" key={x.code}>
                                      <span>{x.name}</span>
                                      <strong>
                                        {money(type === 'asset' ? x.balance : -x.balance)}
                                      </strong>
                                    </div>
                                  ))}
                              </div>
                            ))}
                            <div className="report-row">
                              <span>Accumulated profit in this ledger</span>
                              <strong>
                                {money(
                                  -r.trial
                                    .filter((x) => x.type === 'income' || x.type === 'expense')
                                    .reduce((a, x) => a + x.balance, 0),
                                )}
                              </strong>
                            </div>
                            <div className="report-row grand-total">
                              <span>Assets less liabilities</span>
                              <strong>
                                {money(
                                  r.trial
                                    .filter((x) => x.type === 'asset' || x.type === 'liability')
                                    .reduce((a, x) => a + x.balance, 0),
                                )}
                              </strong>
                            </div>
                            <p className="fineprint">
                              Includes only balances recorded here. Opening balances and historical
                              records must be verified before using this as your business balance
                              sheet.
                            </p>
                          </section>
                        </TabsContent>
                        <TabsContent value="trial">
                          <section className="panel">
                            <div className="panel-heading">
                              <h2>Trial balance · {shortDate(to)}</h2>
                              <span className="status paid">
                                {r.trial.reduce((a, x) => a + x.balance, 0) === 0
                                  ? 'Balanced'
                                  : 'Out of balance'}
                              </span>
                            </div>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Code</TableHead>
                                  <TableHead>Account</TableHead>
                                  <TableHead className="number">Debit</TableHead>
                                  <TableHead className="number">Credit</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {r.trial.map((a) => (
                                  <TableRow key={a.code}>
                                    <TableCell>{a.code}</TableCell>
                                    <TableCell>{a.name}</TableCell>
                                    <TableCell className="number">{money(a.debit)}</TableCell>
                                    <TableCell className="number">{money(a.credit)}</TableCell>
                                  </TableRow>
                                ))}
                                <TableRow className="subtotal">
                                  <TableCell />
                                  <TableCell>Total</TableCell>
                                  <TableCell className="number">
                                    {money(r.trial.reduce((a, x) => a + x.debit, 0))}
                                  </TableCell>
                                  <TableCell className="number">
                                    {money(r.trial.reduce((a, x) => a + x.credit, 0))}
                                  </TableCell>
                                </TableRow>
                              </TableBody>
                            </Table>
                          </section>
                        </TabsContent>
                        <TabsContent value="gst">
                          <GSTWorkpaper
                            state={s}
                            from={from}
                            to={to}
                            onReview={() => go('Australian tax review')}
                          />
                        </TabsContent>
                      </Tabs>
                    )}
                  </>
                )}
                {view === 'Audit history' && (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Activity log</h2>
                        <p>Records are retained when a document is discarded or reversed.</p>
                      </div>
                      <button
                        className="btn"
                        onClick={() =>
                          download(
                            'tradedesk-books-records.json',
                            JSON.stringify(
                              {
                                format: 'tradedesk-books-v3',
                                exportedAt: new Date().toISOString(),
                                ...s,
                              },
                              null,
                              2,
                            ),
                            'application/json',
                          )
                        }
                      >
                        <Download size={16} />
                        Export all records
                      </button>
                    </div>
                    {s.events.length ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>When</TableHead>
                            <TableHead>Action</TableHead>
                            <TableHead>Reference</TableHead>
                            <TableHead>Recorded by</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {s.events
                            .filter((e) => e.kind !== 'write_guard')
                            .slice()
                            .reverse()
                            .map((e) => (
                              <TableRow key={e.id}>
                                <TableCell>
                                  {new Date(e.createdAt).toLocaleString('en-AU', {
                                    timeZone: 'Australia/Brisbane',
                                  })}
                                </TableCell>
                                <TableCell>
                                  <span className="audit-action">
                                    {(
                                      {
                                        contact: 'Contact saved',
                                        product: 'Product saved',
                                        bank_rule: 'Bank rule saved',
                                        asset: 'Asset saved',
                                        document_edit: 'Draft edited',
                                        workflow_status: 'Document status changed',
                                        convert: 'Document converted',
                                        attachment: 'File attached',
                                        import_preview: 'Import preview saved',
                                        import_commit: 'Import confirmed',
                                        import_balance_reference: 'Trial balance reference saved',
                                        import_extraction: 'Document table suggested',
                                        import_scan_attempt: 'Document reading requested',
                                        payment: 'Payment allocated',
                                        manual_journal: 'Journal posted',
                                        document: 'Draft created',
                                        post: 'Document posted',
                                        discard: 'Draft discarded',
                                        settle: 'Payment matched',
                                        cash: 'Bank line categorised',
                                        opening: 'Opening balances recorded',
                                        reverse: 'Document reversed',
                                        bank: 'Statement line imported',
                                        settings: 'Business settings changed',
                                        xero_reference: 'Screenshot reference added',
                                        transfer: 'Bank transfer recorded',
                                        transfer_link: 'Transfer counterpart linked',
                                      } as Record<string, string>
                                    )[e.kind] || e.kind}
                                  </span>
                                </TableCell>
                                <TableCell>
                                  {e.payload.name ||
                                    e.payload.document?.number ||
                                    e.payload.number ||
                                    e.payload.reference ||
                                    e.payload.company ||
                                    v.docs.find((d) => d.id === e.payload.docId)?.number ||
                                    e.payload.journal?.reference ||
                                    'Business profile'}
                                </TableCell>
                                <TableCell>
                                  {sample ? 'Sample owner' : e.payload._actor?.name || 'System'}
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <Empty title="Your activity will appear here">
                        Saved documents, statement imports and bookkeeping changes are recorded
                        automatically.
                      </Empty>
                    )}
                  </section>
                )}
                {view === 'Settings' && (
                  <SettingsForm
                    key={sample ? 'sample' : 'real'}
                    settings={s.settings}
                    canWrite={canWrite}
                    mutate={mutate}
                    events={s.events}
                  />
                )}
              </>
            )}
            <footer className="workspace-footer">
              <span>
                TradeDesk Books <b>·</b> Business workspace
              </span>
              <span>Made for your working day.</span>
            </footer>
          </main>
        </SidebarInset>
      </SidebarProvider>
      <Toaster position="bottom-right" richColors />
      <Dialog
        open={!!create}
        onOpenChange={(o) => {
          if (!o && !busy) setCreate(null);
        }}
      >
        <DialogContent className="large-dialog">
          <DialogHeader>
            <DialogTitle>
              {(editDoc ? 'Edit draft ' : 'New ') +
                (create ? docLabel(create).toLowerCase() : 'document')}
            </DialogTitle>
            <DialogDescription>
              Save a draft, review the amounts, then post it to your books.
            </DialogDescription>
          </DialogHeader>
          {create && (
            <DocumentForm
              type={create}
              initial={editDoc || undefined}
              contact={seedContact || undefined}
              state={s}
              canWrite={canWrite}
              onState={setReal}
              onSave={async (d, attachmentId) => {
                if (
                  !(await mutate({
                    action: editDoc ? 'editDocument' : 'document',
                    document: d,
                    attachmentId,
                  }))
                )
                  return false;
                setCreate(null);
                setSelected(d.id);
                return true;
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Sheet open={!!selectedDoc} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="document-sheet">
          <SheetHeader>
            <SheetTitle>{selectedDoc?.number}</SheetTitle>
            <SheetDescription>
              {selectedDoc ? docLabel(selectedDoc.type) : 'Document'}
            </SheetDescription>
          </SheetHeader>
          {selectedDoc && (
            <div className="sheet-body">
              <div className="detail-title">
                <h2>{selectedDoc.contact}</h2>
                <Status doc={selectedDoc} />
              </div>
              <div className="detail-facts">
                <div>
                  <small>Invoice date</small>
                  {shortDate(selectedDoc.date)}
                </div>
                <div>
                  <small>Due date</small>
                  {shortDate(selectedDoc.due)}
                </div>
                <div>
                  <small>Job</small>
                  {selectedDoc.job || '—'}
                </div>
                <div>
                  <small>Reference</small>
                  {selectedDoc.reference || '—'}
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead className="number">Unit price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedDoc.lines.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        {l.description}
                        {l.discount && cents(l.discount) > 0 && (
                          <small className="secondary">Discount {money(cents(l.discount))}</small>
                        )}
                        <small className="secondary">
                          {l.tax === 'gst' ? '10% GST' : l.tax === 'free' ? 'GST-free' : 'No GST'}
                        </small>
                      </TableCell>
                      <TableCell>{l.qty}</TableCell>
                      <TableCell className="number">{money(cents(l.price))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="totals">
                <div>
                  <span>Subtotal excluding GST</span>
                  <b>{money(selectedDoc.net)}</b>
                </div>
                <div>
                  <span>GST</span>
                  <b>{money(selectedDoc.taxTotal)}</b>
                </div>
                <div className="total">
                  <span>Total AUD</span>
                  <b>{money(selectedDoc.total)}</b>
                </div>
              </div>
              {isLedger(selectedDoc.type) &&
                selectedDoc.posted &&
                selectedDoc.status !== 'void' && (
                  <div className="payment-detail">
                    <div>
                      <span>Payments recorded</span>
                      <strong>{money(selectedDoc.paid)}</strong>
                    </div>
                    <div>
                      <span>Credits / customer funds applied</span>
                      <strong>{money(selectedDoc.credited)}</strong>
                    </div>
                    <div>
                      <span>Amount remaining</span>
                      <strong>{money(selectedDoc.balance)}</strong>
                    </div>
                  </div>
                )}
              {selectedDoc.receiptReview && (
                <section className="attachment-section">
                  <h3>Receipt review</h3>
                  <p>
                    {selectedDoc.receiptReview.reviewed ? 'Checked by you' : 'Needs review'} ·
                    Expected {money(selectedDoc.receiptReview.expectedTotal)} · GST{' '}
                    {money(selectedDoc.receiptReview.expectedGst)}
                  </p>
                  <ul>
                    {selectedDoc.receiptReview.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                  <p>{selectedDoc.receiptReview.explanation}</p>
                </section>
              )}
              <Attachments
                target={selectedDoc.id}
                state={s}
                canWrite={canWrite}
                onState={setReal}
              />
              {selectedDoc.notes && <p className="notes">{selectedDoc.notes}</p>}
              <div className="detail-buttons">
                {selectedDoc.status === 'draft' && isLedger(selectedDoc.type) && (
                  <>
                    <button
                      className="btn primary"
                      disabled={!canWrite}
                      onClick={() => setAction({type: 'post', id: selectedDoc.id})}
                    >
                      <CheckCircle2 size={17} />
                      Post {selectedDoc.type}
                    </button>
                    <button
                      className="btn"
                      disabled={!canWrite}
                      onClick={() => setAction({type: 'discard', id: selectedDoc.id})}
                    >
                      Discard draft
                    </button>
                  </>
                )}
                {selectedDoc.status === 'draft' && (
                  <button
                    className="btn"
                    disabled={!canWrite}
                    onClick={() => {
                      setEditDoc(selectedDoc);
                      setSeedContact(null);
                      setCreate(selectedDoc.type);
                      setSelected(null);
                    }}
                  >
                    Edit draft
                  </button>
                )}
                {
                  <button
                    className="btn"
                    onClick={() => {
                      const issues = invoiceChecks(selectedDoc);
                      if (issues.length) {
                        toast.error('Check invoice details: ' + issues.join(' '));
                        return;
                      }
                      setPrintCredit(null);
                      setPrintDoc(selectedDoc);
                      setTimeout(() => window.print(), 100);
                    }}
                  >
                    <Printer size={17} />
                    Print / save PDF
                  </button>
                }
                {selectedDoc.posted &&
                  selectedDoc.status !== 'void' &&
                  isLedger(selectedDoc.type) && (
                    <button
                      className="btn"
                      disabled={!canWrite}
                      onClick={() => {
                        setSelected(null);
                        setCreditSource(selectedDoc.id);
                        go('Credits & refunds');
                      }}
                    >
                      Create credit note
                    </button>
                  )}
                {selectedDoc.status === 'open' && isLedger(selectedDoc.type) && (
                  <>
                    <button
                      className="btn primary"
                      onClick={() => {
                        setSelected(null);
                        go('Bank reconciliation');
                      }}
                    >
                      {selectedDoc.type === 'bill'
                        ? 'Already paid? Match bank transaction'
                        : 'Match a payment'}
                    </button>
                    <button
                      className="text-btn danger"
                      disabled={
                        !canWrite ||
                        selectedDoc.paid > 0 ||
                        selectedDoc.credited > 0 ||
                        v.credits.some((c) => c.sourceDocId === selectedDoc.id)
                      }
                      onClick={() => {
                        setReason('');
                        setAction({type: 'reverse', id: selectedDoc.id});
                      }}
                    >
                      Reverse document
                    </button>
                  </>
                )}
              </div>
              {!isLedger(selectedDoc.type) && (
                <WorkflowActions
                  doc={selectedDoc}
                  state={s}
                  canWrite={canWrite}
                  mutate={mutate}
                  onOpen={setSelected}
                />
              )}
              {selectedDoc.type === 'invoice' &&
                selectedDoc.posted &&
                selectedDoc.status !== 'void' && (
                  <EmailCentre
                    key={selectedDoc.id}
                    docId={selectedDoc.id}
                    state={s}
                    onState={setReal}
                    canWrite={canWrite}
                  />
                )}
              <p className="fineprint">
                {selectedDoc.status === 'draft'
                  ? 'Drafts can be edited and do not affect reports.'
                  : 'Posted documents are retained in the audit history. Payments are recorded from imported bank lines.'}
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <Dialog open={!!action} onOpenChange={(o) => !o && !busy && setAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action?.type === 'post'
                ? 'Post this document?'
                : action?.type === 'reverse'
                  ? 'Reverse this document?'
                  : 'Discard this draft?'}
            </DialogTitle>
            <DialogDescription>
              {action?.type === 'post'
                ? 'This records the amounts in your ledger and locks the document. No email or payment will be sent.'
                : action?.type === 'reverse'
                  ? 'This adds an equal opposite ledger entry and keeps the original document. Only unpaid documents can be reversed.'
                  : 'The draft remains in your audit history and has no effect on your ledger.'}
            </DialogDescription>
          </DialogHeader>
          {action?.type === 'reverse' && (
            <>
              <label>
                Reversal date
                <input
                  type="date"
                  value={reversalDate}
                  onChange={(e) => setReversalDate(e.target.value)}
                />
              </label>
              <label>
                Reason
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why is this being reversed?"
                />
              </label>
            </>
          )}
          <button
            className="btn primary"
            disabled={!canWrite || (action?.type === 'reverse' && reason.trim().length < 5)}
            onClick={async () => {
              if (
                action &&
                (await mutate({action: action.type, id: action.id, date: reversalDate, reason}))
              )
                setAction(null);
            }}
          >
            {busy ? 'Saving…' : 'Confirm'}
          </button>
        </DialogContent>
      </Dialog>
      <Dialog open={importing} onOpenChange={(o) => !busy && setImporting(o)}>
        <DialogContent className="large-dialog">
          <DialogHeader>
            <DialogTitle>Import bank statement</DialogTitle>
            <DialogDescription>
              Importing into {bankName(activeBank, s.settings)}. Use Date, Description, Amount and
              Reference columns. Money in is positive; money out is negative.
            </DialogDescription>
          </DialogHeader>
          <BankImport
            canWrite={canWrite}
            onSave={async (rows) => {
              if (await mutate({action: 'importBank', account: activeBank, rows})) {
                setImporting(false);
                return true;
              }
              return false;
            }}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={!!bankSelected} onOpenChange={(o) => !busy && !o && setBankSelected(null)}>
        <DialogContent className="large-dialog">
          <DialogHeader>
            <DialogTitle>Reconcile bank line</DialogTitle>
            <DialogDescription>
              {bankSelected?.description} · {bankSelected && money(bankSelected.amount)} ·{' '}
              {bankSelected && shortDate(bankSelected.date)}
            </DialogDescription>
          </DialogHeader>
          {bankSelected && (
            <Reconcile
              key={bankSelected.id}
              bank={bankSelected}
              banks={unmatched}
              docs={v.docs}
              canWrite={canWrite}
              settings={s.settings}
              state={s}
              onState={setReal}
              onSave={async (body) => {
                if (await mutate(body)) setBankSelected(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      {printDoc && <InvoicePrint doc={printDoc} sample={sample} />}
      {printCredit && <CreditPrint credit={printCredit} sample={sample} />}
    </>
  );
}
function DocumentForm({
  type,
  state,
  canWrite,
  onSave,
  onState,
  initial,
  contact,
}: {
  type: Doc['type'];
  initial?: Doc;
  contact?: Contact;
  state: State;
  canWrite: boolean;
  onState: (s: State) => void;
  onSave: (d: Doc, attachmentId?: string) => Promise<boolean>;
}) {
  const sale = isSale(type),
    ops = operations(state.events);
  const savedContacts = ops.contacts.filter(
    (c) => !c.archived && (sale ? c.role !== 'supplier' : c.role !== 'customer'),
  );
  const [attachmentId, setAttachmentId] = useState(initial?.receiptReview?.attachmentId || ''),
    [receiptFile, setReceiptFile] = useState<File | null>(null),
    [suggestion, setSuggestion] = useState<ScannedReceipt | null>(null),
    [receiptWarnings, setReceiptWarnings] = useState<string[]>([]),
    [scanning, setScanning] = useState(false),
    [saving, setSaving] = useState(false);
  const [item, setItem] = useState('none');
  const [d, setD] = useState<Doc>(
    () =>
      initial || {
        id: crypto.randomUUID(),
        type,
        number: nextNumber(state.events, type),
        contactId: contact?.id,
        contact: contact?.name || '',
        contactAddress: contact?.address || '',
        contactAbn: contact?.abn || '',
        date: today(),
        due: new Date(Date.parse(today() + 'T12:00:00Z') + (contact?.termsDays ?? 14) * 86400000)
          .toISOString()
          .slice(0, 10),
        job: '',
        reference: '',
        notes: '',
        inclusive: false,
        lines: [
          {
            description: '',
            qty: '1',
            price: '',
            tax: state.settings.gst === 'yes' ? 'gst' : 'none',
            account: sale ? '400' : '500',
          },
        ],
      },
  );
  const change = (key: keyof Doc, value: unknown) =>
    setD({
      ...d,
      [key]: value,
      ...(key !== 'receiptReview' && d.receiptReview
        ? {receiptReview: {...d.receiptReview, reviewed: false}}
        : {}),
    });
  const invalidate = d.receiptReview ? {receiptReview: {...d.receiptReview, reviewed: false}} : {};
  function chooseContact(id: string) {
    const c = savedContacts.find((c) => c.id === id);
    if (c)
      setD({
        ...d,
        ...invalidate,
        contactId: c.id,
        contact: c.name,
        contactAddress: c.address,
        contactAbn: c.abn,
        due: d.date
          ? new Date(Date.parse(d.date) + c.termsDays * 86400000).toISOString().slice(0, 10)
          : '',
      });
    else setD({...d, ...invalidate, contactId: undefined});
  }
  function addItem(id: string) {
    setItem(id);
    const p = ops.products.find((p) => p.id === id);
    if (!p) return;
    const price = cents(sale ? p.salePrice : p.costPrice),
      tax = state.settings.gst === 'no' ? 'none' : p.tax;
    const l: Line = {
      description: p.description || p.name,
      qty: '1',
      price: (
        (d.inclusive && tax === 'gst' ? price + Math.round(price / 10) : price) / 100
      ).toFixed(2),
      tax,
      account: sale ? p.saleAccount : p.costAccount,
    };
    setD({
      ...d,
      ...invalidate,
      lines: d.lines.length === 1 && !d.lines[0].description ? [l] : [...d.lines, l],
    });
    setItem('none');
  }
  const changeLine = (i: number, key: keyof Line, value: string) =>
    setD({
      ...d,
      ...(d.receiptReview ? {receiptReview: {...d.receiptReview, reviewed: false}} : {}),
      lines: d.lines.map((l, j) => (i === j ? {...l, [key]: value} : l)),
    });
  let t = {net: 0, taxTotal: 0, total: 0};
  try {
    t = totals(d);
  } catch {}
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (scanning || saving) return;
        setSaving(true);
        try {
          await onSave(d, attachmentId);
        } finally {
          setSaving(false);
        }
      }}
      className={'book-form ' + (type === 'bill' ? 'receipt-workbench' : '')}
    >
      {type === 'bill' && (
        <aside className="receipt-column">
          <ReceiptUpload
            state={state}
            onState={onState}
            attachmentId={attachmentId}
            onAttachment={(id) => {
              setAttachmentId(id);
              if (d.receiptReview && d.receiptReview.attachmentId !== id)
                setD({...d, receiptReview: undefined});
            }}
            file={receiptFile}
            onFile={(f) => {
              setReceiptFile(f);
              setSuggestion(null);
              setReceiptWarnings([]);
            }}
            onRead={setSuggestion}
            disabled={!canWrite || saving}
            onBusy={setScanning}
          />
          {suggestion && (
            <section className="attachment-section">
              <h3>Receipt details ready to review</h3>
              <p>
                {suggestion.supplier || 'Supplier unreadable'} · Total {money(suggestion.total)} ·
                GST {money(suggestion.gst)}
              </p>
              <p className="fineprint">
                Applying replaces the supplier, dates, reference and line items currently in this
                form. Your internal bill number stays the same.
              </p>
              <button
                type="button"
                className="btn primary"
                disabled={saving || scanning}
                onClick={() => {
                  const result = receiptDraft(
                    d,
                    suggestion,
                    state.settings.gst === 'yes',
                    state.events,
                    attachmentId,
                  );
                  setD(result.document);
                  setReceiptWarnings(result.warnings);
                  setSuggestion(null);
                }}
              >
                Apply to bill
              </button>
              <button type="button" className="text-btn" onClick={() => setSuggestion(null)}>
                Dismiss
              </button>
            </section>
          )}
          {(d.receiptReview?.warnings || receiptWarnings).length > 0 && (
            <div role="status" className="attachment-section">
              <h3>Check the scanned details</h3>
              <ul>
                {(d.receiptReview?.warnings || receiptWarnings).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      )}
      <fieldset
        className="document-fields"
        disabled={saving || scanning}
        style={{border: 0, padding: 0, margin: 0, minWidth: 0}}
      >
        <div className="form-grid">
          <label className="full-width">
            Saved {sale ? 'customer' : 'supplier'}
            <Choice
              value={d.contactId || 'none'}
              label="Saved contact"
              options={[
                ['none', 'Enter contact details manually'],
                ...savedContacts.map((c) => [c.id, c.name]),
              ]}
              onChange={chooseContact}
            />
          </label>
          <label>
            {sale ? 'Customer' : 'Supplier'} name
            <input
              required
              value={d.contact}
              onChange={(e) =>
                setD({...d, ...invalidate, contact: e.target.value, contactId: undefined})
              }
              placeholder={sale ? 'Customer or business name' : 'Supplier name'}
              maxLength={160}
            />
          </label>
          <label>
            {docLabel(type)} number
            <input
              required
              readOnly={!!initial}
              value={d.number}
              onChange={(e) => change('number', e.target.value)}
              maxLength={40}
            />
          </label>
          <label>
            Issue date
            <input
              type="date"
              required
              value={d.date}
              onChange={(e) => change('date', e.target.value)}
            />
          </label>
          <label>
            {type === 'quote'
              ? 'Valid until'
              : type === 'purchase_order'
                ? 'Expected by'
                : 'Due date'}
            <input
              type="date"
              required
              min={d.date}
              value={d.due}
              onChange={(e) => change('due', e.target.value)}
            />
          </label>
          <label>
            Job / site
            <input
              value={d.job}
              onChange={(e) => change('job', e.target.value)}
              placeholder="e.g. Ashmore · hot water replacement"
            />
          </label>
          <label>
            Reference / purchase order
            <input value={d.reference} onChange={(e) => change('reference', e.target.value)} />
          </label>
          <label className="full-width">
            {sale ? 'Customer' : 'Supplier'} address
            <input
              value={d.contactAddress}
              onChange={(e) => change('contactAddress', e.target.value)}
            />
          </label>
          <label className="full-width">
            Contact ABN
            <input value={d.contactAbn} onChange={(e) => change('contactAbn', e.target.value)} />
          </label>
        </div>
        <div className="line-heading">
          <h3>Line items</h3>
          <Choice
            value={d.inclusive ? 'inclusive' : 'exclusive'}
            label="Price treatment"
            onChange={(x) => change('inclusive', x === 'inclusive')}
            options={[
              ['exclusive', 'Prices exclude GST'],
              ['inclusive', 'Prices include GST'],
            ]}
          />
        </div>
        <label>
          Insert from products & services
          <Choice
            value={item}
            label="Insert saved item"
            options={[
              ['none', 'Choose an item to add'],
              ...ops.products
                .filter((p) => !p.archived)
                .map((p) => [p.id, p.code + ' · ' + p.name]),
            ]}
            onChange={addItem}
          />
        </label>
        <div className="line-items">
          {d.lines.map((l, i) => (
            <div className="line-item" key={i}>
              <label className="line-description">
                Description
                <input
                  required
                  aria-label={'Description ' + (i + 1)}
                  value={l.description}
                  onChange={(e) => changeLine(i, 'description', e.target.value)}
                  placeholder="Labour, materials or service"
                />
              </label>
              <label>
                Quantity
                <input
                  required
                  inputMode="decimal"
                  pattern="[0-9]+([.][0-9]{1,2})?"
                  value={l.qty}
                  onChange={(e) => changeLine(i, 'qty', e.target.value)}
                />
              </label>
              <label>
                Unit price $
                <input
                  required
                  inputMode="decimal"
                  pattern="[0-9]+([.][0-9]{1,2})?"
                  value={l.price}
                  onChange={(e) => changeLine(i, 'price', e.target.value)}
                />
              </label>
              <label>
                Discount $
                <input
                  inputMode="decimal"
                  value={l.discount || '0'}
                  onChange={(e) => changeLine(i, 'discount', e.target.value)}
                />
              </label>
              <label>
                Tax
                <Choice
                  value={l.tax}
                  label={'Tax ' + (i + 1)}
                  onChange={(x) => changeLine(i, 'tax', x)}
                  options={
                    state.settings.gst === 'no'
                      ? [['none', 'No GST']]
                      : [
                          ['gst', 'GST 10%'],
                          ['free', 'GST-free'],
                          ['none', 'No GST'],
                        ]
                  }
                />
              </label>
              <label className="line-account">
                Account
                <Choice
                  value={l.account}
                  label={'Account ' + (i + 1)}
                  onChange={(x) => changeLine(i, 'account', x)}
                  options={accounts
                    .filter(
                      (a) => a[2] === (sale ? 'income' : 'expense') || (!sale && a[0] === '150'),
                    )
                    .map((a) => [a[0], a[1]])}
                />
              </label>
              <button
                type="button"
                className="icon-btn remove-line"
                aria-label={'Remove line ' + (i + 1)}
                disabled={d.lines.length === 1}
                onClick={() =>
                  change(
                    'lines',
                    d.lines.filter((_, j) => j !== i),
                  )
                }
              >
                <Trash2 size={17} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="text-btn"
          disabled={d.lines.length >= 60}
          onClick={() =>
            change('lines', [
              ...d.lines,
              {
                description: '',
                qty: '1',
                price: '',
                tax: state.settings.gst === 'yes' ? 'gst' : 'none',
                account: sale ? '400' : '500',
              },
            ])
          }
        >
          <Plus size={16} />
          Add line item
        </button>
        <div className="form-bottom">
          <label>
            Notes
            <textarea
              value={d.notes}
              onChange={(e) => change('notes', e.target.value)}
              placeholder="Work completed, payment notes or supplier details"
            />
          </label>
          <div className="totals">
            <div>
              <span>Subtotal</span>
              <b>{money(t.net)}</b>
            </div>
            <div>
              <span>GST</span>
              <b>{money(t.taxTotal)}</b>
            </div>
            <div className="total">
              <span>Total AUD</span>
              <b>{money(t.total)}</b>
            </div>
          </div>
        </div>
        {d.receiptReview && (
          <section className="attachment-section">
            <p>
              Receipt total {money(d.receiptReview.expectedTotal)} · receipt GST{' '}
              {money(d.receiptReview.expectedGst)}
            </p>
            <label className="review-checkbox">
              <input
                type="checkbox"
                checked={d.receiptReview.reviewed}
                onChange={(e) =>
                  change('receiptReview', {...d.receiptReview, reviewed: e.target.checked})
                }
              />
              <span>
                I checked the supplier, dates, line items and GST against the original receipt.
              </span>
            </label>
            <label>
              Explanation for any difference or uncertain field
              <textarea
                value={d.receiptReview.explanation}
                onChange={(e) =>
                  change('receiptReview', {...d.receiptReview, explanation: e.target.value})
                }
              />
            </label>
          </section>
        )}
        <div className="form-footer">
          <span>Draft only · Review before issuing or posting</span>
          <button className="btn primary" disabled={!canWrite || saving || scanning}>
            {saving ? 'Saving…' : 'Save draft'} <ArrowRight size={17} />
          </button>
        </div>
      </fieldset>
    </form>
  );
}
function BankImport({
  canWrite,
  onSave,
}: {
  canWrite: boolean;
  onSave: (rows: Omit<Bank, 'id'>[]) => Promise<boolean>;
}) {
  const [rows, setRows] = useState<Omit<Bank, 'id'>[]>([]),
    [error, setError] = useState(''),
    [filename, setFilename] = useState('');
  async function read(file: File | undefined) {
    setRows([]);
    setError('');
    if (!file) return;
    setFilename(file.name);
    try {
      if (file.size > 500000) throw new Error('Choose a CSV smaller than 500 KB.');
      const data = parseCsv((await file.text()).replace(/^\uFEFF/, '')),
        head = data.shift()?.map((x) => x.toLowerCase()) || [];
      const indexes = ['date', 'description', 'amount', 'reference'].map((x) => head.indexOf(x));
      if (indexes.some((x) => x < 0))
        throw new Error(
          'Required headers: Date, Description, Amount, Reference. Download the template for an example.',
        );
      if (data.length > 300) throw new Error('Import up to 300 lines at a time.');
      const parsed = data.map((r, i) => {
        const [date, description, amount, reference] = indexes.map((x) => r[x] || '');
        if (!/^-?\d+(\.\d{1,2})?$/.test(amount))
          throw new Error(`Row ${i + 2}: use a signed decimal amount without currency symbols.`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
          throw new Error(`Row ${i + 2}: date must be YYYY-MM-DD.`);
        if (!description || !reference)
          throw new Error(`Row ${i + 2}: description and unique reference are required.`);
        return {
          date,
          description,
          amount: cents(amount.replace('-', '')) * (amount.startsWith('-') ? -1 : 1),
          reference,
        };
      });
      if (new Set(parsed.map((x) => x.reference)).size !== parsed.length)
        throw new Error(
          'Duplicate references found. Each statement transaction must have its own reference.',
        );
      setRows(parsed);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="book-form">
      <button
        className="text-btn"
        onClick={() =>
          download(
            'bank-statement-template.csv',
            'Date,Description,Amount,Reference\r\n2026-09-01,Example customer payment,550.00,EXAMPLE-001\r\n2026-09-02,Example supplier purchase,-220.00,EXAMPLE-002\r\n',
          )
        }
      >
        <Download size={16} />
        Download CSV template
      </button>
      <label className="upload-box">
        <Upload size={27} />
        <strong>Choose your statement CSV</strong>
        <span>Dates as YYYY-MM-DD · Amounts in AUD</span>
        <input type="file" accept=".csv,text/csv" onChange={(e) => read(e.target.files?.[0])} />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {rows.length > 0 && (
        <>
          <h3>
            {filename} · {rows.length} lines ready for review
          </h3>
          <div className="import-preview">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="number">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>{r.date}</TableCell>
                    <TableCell>{r.description}</TableCell>
                    <TableCell>{r.reference}</TableCell>
                    <TableCell className="number">{money(r.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="fineprint">
            Check the dates, signs and references. Re-importing an existing reference rejects the
            whole batch. An import does not post anything to the ledger.
          </p>
          <button className="btn primary" disabled={!canWrite} onClick={() => onSave(rows)}>
            Import {rows.length} statement lines
          </button>
        </>
      )}
    </div>
  );
}
function SettingsForm({
  settings,
  canWrite,
  mutate,
  events,
}: {
  settings: Settings;
  canWrite: boolean;
  mutate: (v: unknown) => Promise<boolean>;
  events: State['events'];
}) {
  const [s, setS] = useState(settings),
    [opening, setOpening] = useState(false),
    [date, setDate] = useState(today()),
    [text, setText] = useState('100,0.00,0.00\n300,0.00,0.00'),
    [error, setError] = useState('');
  const field = (key: keyof Settings, value: string) =>
    setS({
      ...s,
      [key]: value,
      ...(['name', 'abn', 'gst', 'gstBasis', 'entityType'].includes(key)
        ? {taxSetupConfirmed: false}
        : {}),
    });
  async function saveOpening(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const rows = parseCsv(text);
      const lines = rows.map((r, i) => {
        if (r.length !== 3) throw new Error(`Row ${i + 1} needs account code, debit and credit.`);
        return {account: r[0], debit: cents(r[1]), credit: cents(r[2])};
      });
      if (await mutate({action: 'opening', date, lines})) setOpening(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="settings-grid">
      <form
        className="panel settings-panel book-form"
        onSubmit={async (e) => {
          e.preventDefault();
          await mutate({action: 'settings', settings: s});
        }}
      >
        <div>
          <h2>Business profile</h2>
          <p className="subheading">
            Used on your invoices. New documents keep a copy of these details.
          </p>
        </div>
        <div className="form-grid">
          <label className="full-width">
            Business / trading name
            <input required value={s.name} onChange={(e) => field('name', e.target.value)} />
          </label>
          <label>
            Australian Business Number
            <input
              value={s.abn}
              placeholder="11-digit ABN"
              onChange={(e) => field('abn', e.target.value)}
            />
          </label>
          <label>
            Phone
            <input value={s.phone} onChange={(e) => field('phone', e.target.value)} />
          </label>
          <label className="full-width">
            Business address
            <textarea value={s.address} onChange={(e) => field('address', e.target.value)} />
          </label>
          <label className="full-width">
            Email
            <input type="email" value={s.email} onChange={(e) => field('email', e.target.value)} />
          </label>
          <label>
            GST registration
            <Choice
              value={s.gst}
              onChange={(x) => field('gst', x)}
              label="GST registration"
              options={[
                ['unconfirmed', 'Select registration'],
                ['yes', 'Registered for GST'],
                ['no', 'Not registered'],
              ]}
            />
          </label>
          <label>
            GST reporting basis
            <Choice
              value={s.gstBasis}
              onChange={(x) => field('gstBasis', x)}
              label="GST basis"
              options={[
                ['unconfirmed', 'Check your Xero settings'],
                ['cash', 'Cash basis'],
                ['accrual', 'Non-cash / accrual'],
              ]}
            />
          </label>
        </div>
        <h3>Australian tax setup</h3>
        <label>
          Business structure
          <Choice
            value={s.entityType || 'unconfirmed'}
            onChange={(x) => field('entityType', x)}
            label="Business structure"
            options={[
              ['unconfirmed', 'Confirm from your records'],
              ['sole_trader', 'Sole trader'],
              ['company', 'Company'],
              ['partnership', 'Partnership'],
              ['trust', 'Trust'],
            ]}
          />
        </label>
        <label className="review-checkbox">
          <input
            type="checkbox"
            checked={!!s.taxSetupConfirmed}
            onChange={(e) => setS({...s, taxSetupConfirmed: e.target.checked})}
          />
          <span>
            I checked the business structure, GST registration and applicable reporting basis
            against my records or with my accountant.
          </span>
        </label>
        <p className="fineprint">
          No registration lookup or accountant approval is performed by this app. A GST basis
          already selected is fixed after posting; a change needs a separate dated transition.
          Editing tax details clears this confirmation.
        </p>
        <h3>Bank and cash account labels</h3>
        <div className="form-grid">
          {bankCodes.map((code) => (
            <label key={code}>
              Account {code}
              <input
                required
                value={bankName(code, s)}
                onChange={(e) =>
                  setS({...s, bankLabels: {...s.bankLabels, [code]: e.target.value}})
                }
              />
            </label>
          ))}
        </div>
        <h3>Invoice payment details</h3>
        <div className="form-grid">
          <label className="full-width">
            Bank account name
            <input value={s.bankName} onChange={(e) => field('bankName', e.target.value)} />
          </label>
          <label>
            BSB
            <input value={s.bsb} onChange={(e) => field('bsb', e.target.value)} />
          </label>
          <label>
            Account number
            <input value={s.bankAccount} onChange={(e) => field('bankAccount', e.target.value)} />
          </label>
          <label className="full-width">
            Payment terms
            <textarea value={s.terms} onChange={(e) => field('terms', e.target.value)} />
          </label>
        </div>
        <h3>Closed periods</h3>
        <label>
          Lock transactions on or before
          <input
            type="date"
            value={s.lockDate}
            onChange={(e) => field('lockDate', e.target.value)}
          />
        </label>
        <p className="fineprint">
          Only lock a period after accountant review. This pilot cannot reopen it. Saved settings
          and changes are logged.
        </p>
        <button className="btn primary" disabled={!canWrite}>
          Save business settings
        </button>
      </form>
      <div className="settings-aside">
        <section className="panel settings-panel">
          <div className="integration-logo">xero</div>
          <h2>Xero migration</h2>
          <span className="status draft">Not connected</span>
          <p>
            Your supplied screenshot is captured as a reference. Transaction-level Xero records have
            not been imported; a connection or reviewed exports are still needed.
          </p>
          <h3>Keep these exports</h3>
          <ul>
            <li>Chart of accounts and trial balance</li>
            <li>Outstanding invoices and bills</li>
            <li>Contacts and bank statements</li>
            <li>General ledger and GST reports</li>
            <li>Original invoices and receipts</li>
          </ul>
          <p className="fineprint">
            Automatic Xero migration is not implemented. Keep Xero active while balances and reports
            are compared.
          </p>
        </section>
        <section className="panel settings-panel">
          <h2>Opening balances</h2>
          <p>Enter a balanced opening journal from an accountant-reviewed trial balance.</p>
          <p className="fineprint">
            Open invoices and bills need a coordinated cutover: do not enter receivables or payables
            here and then post the same opening documents again.
          </p>
          <button
            className="btn"
            disabled={!canWrite || events.some((e) => e.kind === 'opening')}
            onClick={() => setOpening(true)}
          >
            {events.some((e) => e.kind === 'opening')
              ? 'Opening journal recorded'
              : 'Enter opening journal'}
          </button>
        </section>
        <section className="panel settings-panel">
          <h2>Current scope</h2>
          <p>
            One business, four AUD bank/cash accounts, quotes, purchase orders, contacts, products,
            partial and combined document payments.
          </p>
          <p className="fineprint">
            Bank feeds, card payments, tax lodgment, mixed-tax credits, non-cash advances and live
            backup restore still need work. Payroll is excluded.
          </p>
        </section>
      </div>
      <Dialog open={opening} onOpenChange={setOpening}>
        <DialogContent className="large-dialog">
          <DialogHeader>
            <DialogTitle>Opening balances</DialogTitle>
            <DialogDescription>
              Record this once, before your first transaction date. Debits must equal credits. Ask
              your accountant to map the balances.
            </DialogDescription>
          </DialogHeader>
          <form className="book-form" onSubmit={saveOpening}>
            <label>
              Opening balance date
              <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              Account code, debit, credit · one row per account
              <textarea
                className="opening-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                required
              />
            </label>
            <details>
              <summary>Available balance sheet accounts</summary>
              <div className="account-list">
                {accounts
                  .filter((a) => !['income', 'expense'].includes(a[2]))
                  .map((a) => (
                    <p key={a[0]}>
                      <b>{a[0]}</b> {a[1]}
                    </p>
                  ))}
              </div>
            </details>
            {error && <p className="form-error">{error}</p>}
            <button className="btn primary" disabled={!canWrite}>
              Record opening journal
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function CashChart({journal}: {journal: ReturnType<typeof derive>['journal']}) {
  const months = Array.from({length: 6}, (_, i) => {
    const d = new Date(today() + 'T12:00:00Z');
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 5 + i);
    const key = d.toISOString().slice(0, 7),
      lines = journal
        .filter((j) => j.date.startsWith(key) && j.source !== 'opening' && j.source !== 'transfer')
        .flatMap((j) => j.lines)
        .filter((l) => bankCodes.some((c) => c === l.account));
    return {
      name: d.toLocaleDateString('en-AU', {month: 'short'}),
      income: lines.reduce((a, l) => a + l.debit, 0),
      out: lines.reduce((a, l) => a + l.credit, 0),
    };
  });
  const max = Math.max(10000, ...months.flatMap((m) => [m.income, m.out]));
  return (
    <div className="cash-chart">
      <div className="chart-scale">
        <span>{money(max)}</span>
        <span>{money(max / 2)}</span>
        <span>$0</span>
      </div>
      <div className="chart-bars">
        {months.map((m, i) => (
          <div className="month" key={i}>
            <div className="bar-pair">
              <div
                title={m.name + ' money in: ' + money(m.income)}
                className="bar income"
                style={{height: (m.income / max) * 100 + '%'}}
              >
                <span className="sr-only">
                  {m.name} money in {money(m.income)}
                </span>
              </div>
              <div
                title={m.name + ' money out: ' + money(m.out)}
                className="bar expense"
                style={{height: (m.out / max) * 100 + '%'}}
              >
                <span className="sr-only">
                  {m.name} money out {money(m.out)}
                </span>
              </div>
            </div>
            <span>{m.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
function InvoicePrint({doc, sample}: {doc: ViewDoc; sample: boolean}) {
  const s = doc.seller || defaultSettings;
  return (
    <article className="print-invoice">
      <header>
        <div>
          <h1>
            {doc.status === 'draft' ? 'DRAFT · ' : doc.status === 'void' ? 'VOID · ' : ''}
            {doc.type === 'invoice' && s.gst === 'yes'
              ? 'TAX INVOICE'
              : docLabel(doc.type).toUpperCase()}
          </h1>
          {sample && <p>SAMPLE DOCUMENT · NOT FOR USE</p>}
          <h2>{s.name}</h2>
          <p>{s.address}</p>
          <p>{s.abn ? 'ABN ' + s.abn : ''}</p>
          <p>
            {s.email} {s.phone}
          </p>
        </div>
        <div>
          <h2>{doc.number}</h2>
          <p>Issued {shortDate(doc.date)}</p>
          <p>Due {shortDate(doc.due)}</p>
        </div>
      </header>
      <section>
        <h3>{isSale(doc.type) ? 'Customer' : 'Supplier'}</h3>
        <p>{doc.contact}</p>
        <p>{doc.contactAddress}</p>
        <p>{doc.contactAbn}</p>
        <p>{doc.job}</p>
        <p>{doc.reference}</p>
      </section>
      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th>Qty</th>
            <th>Unit price {doc.inclusive ? 'incl. GST' : 'excl. GST'}</th>
            <th>Tax treatment</th>
            <th>GST amount</th>
            <th>Total incl. GST</th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l, i) => (
            <tr key={i}>
              <td>
                {l.description}
                {l.discount && cents(l.discount) > 0 && (
                  <small> · Discount {money(cents(l.discount))}</small>
                )}
              </td>
              <td>{l.qty}</td>
              <td>{money(cents(l.price))}</td>
              <td>{l.tax === 'gst' ? '10%' : l.tax === 'free' ? 'GST-free' : 'No GST'}</td>
              <td>{money(totals({lines: [l], inclusive: doc.inclusive}).taxTotal)}</td>
              <td>{money(totals({lines: [l], inclusive: doc.inclusive}).total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="totals">
        <div>
          <span>Subtotal excluding GST</span>
          <strong>{money(doc.net)}</strong>
        </div>
        <div>
          <span>GST</span>
          <strong>{money(doc.taxTotal)}</strong>
        </div>
        <div className="total">
          <span>Total AUD</span>
          <strong>{money(doc.total)}</strong>
        </div>
      </div>
      <section>
        <p>{doc.notes}</p>
        <h3>{isSale(doc.type) ? 'Payment details' : 'Business bank details'}</h3>
        <p>
          {s.bankName}
          {s.bsb ? ' · BSB ' + s.bsb : ''}
          {s.bankAccount ? ' · Account ' + s.bankAccount : ''}
        </p>
        <p>{s.terms}</p>
      </section>
    </article>
  );
}
