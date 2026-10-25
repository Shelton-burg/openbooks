'use client';
import {useMemo, useState} from 'react';
import {Download, FileCheck2, ShieldCheck, ArrowRight, Search} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {Tabs, TabsList, TabsTrigger, TabsContent} from '@/components/ui/tabs';
import {Table, TableHeader, TableBody, TableHead, TableRow, TableCell} from '@/components/ui/table';
import {Choice, Empty, download} from './book-ui';
import Attachments from './attachments';
import {money, today, shortDate, csv, cents, type State} from '@/lib/books';
import {
  guidance,
  purchaseSources,
  latestReviews,
  gstWorkpaper,
  reviewCredit,
  complianceChecklist,
  reviewedContractors,
  sourceRevision,
  type PurchaseReview,
  type TaxSnapshot,
} from '@/lib/compliance';
type Props = {
  state: State;
  canWrite: boolean;
  mutate: (value: unknown) => Promise<boolean>;
  onState: (value: State) => void;
  onGo: (view: string) => void;
};
type Workpaper = ReturnType<typeof gstWorkpaper>;
function GSTTotals({paper}: {paper: Workpaper}) {
  return (
    <>
      <div className="report-row">
        <span>Total recorded sales including GST</span>
        <strong>{money(paper.recordedSales)}</strong>
      </div>
      <div className="report-row">
        <span>GST on recorded sales</span>
        <strong>{money(paper.gstSales)}</strong>
      </div>
      <div className="report-row">
        <span>GST on recorded purchases</span>
        <strong>{money(paper.recordedPurchases)}</strong>
      </div>
      <div className="report-row">
        <span>Purchase GST awaiting review</span>
        <strong>{money(paper.heldPurchases)}</strong>
      </div>
      <div className="report-row">
        <span>Review exclusions / rounding difference</span>
        <strong>{money(paper.excludedPurchases)}</strong>
      </div>
      <div className="report-row subtotal">
        <span>Purchase GST included by review</span>
        <strong>{money(paper.reviewedPurchases)}</strong>
      </div>
      <div className="report-row grand-total">
        <span>Provisional net GST / (credit)</span>
        <strong>{money(paper.provisionalNet)}</strong>
      </div>
    </>
  );
}
function GSTExport(paper: Workpaper) {
  download(
    'gst-review-' + paper.from + '-' + paper.to + '.csv',
    csv([
      ['OWNER-PREPARED DRAFT — not a BAS or lodgment file'],
      ['From', paper.from, 'To', paper.to, 'Basis', paper.basis],
      ['GST on sales', paper.gstSales / 100],
      ['Recorded purchase GST', paper.recordedPurchases / 100],
      ['Reviewed purchase GST', paper.reviewedPurchases / 100],
      ['Provisional net', paper.provisionalNet / 100],
      ...paper.blockers.map((x) => ['Review required', x]),
      ['Date', 'Reference', 'Supplier', 'Recorded GST', 'Reviewed GST', 'Status', 'Review note'],
      ...paper.rows.map((r) => [
        r.date,
        r.reference,
        r.contact,
        r.recorded / 100,
        r.reviewed / 100,
        r.status,
        r.reason,
      ]),
    ]),
  );
}
export function GSTWorkpaper({
  state,
  from,
  to,
  onReview,
}: {
  state: State;
  from: string;
  to: string;
  onReview: () => void;
}) {
  const paper = useMemo(
    () => (from && to && from <= to ? gstWorkpaper(state.events, state.settings, from, to) : null),
    [state, from, to],
  );
  if (!paper) return <Empty title="Choose a valid reporting period" />;
  return (
    <>
      <section className="panel report-paper">
        <div className="panel-heading">
          <div>
            <h2>GST review worksheet</h2>
            <p>
              {shortDate(from)} – {shortDate(to)} · {paper.basis} basis
            </p>
          </div>
          <button className="btn small" onClick={() => GSTExport(paper)}>
            <Download size={16} />
            Export
          </button>
        </div>
        <div className="notice">
          <span>
            Owner-prepared draft. Purchase review percentages affect this worksheet only. They do
            not change posted expenses or determine income-tax deductions. This is not a complete
            BAS.
          </span>
        </div>
        <GSTTotals paper={paper} />
        {paper.blockers.length > 0 && (
          <div className="review-blockers">
            <h3>Still needs review</h3>
            <ul>
              {paper.blockers.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        )}
        <button className="text-btn" onClick={onReview}>
          Review purchases and tax setup <ArrowRight size={16} />
        </button>
        <p className="fineprint">
          Standard recorded transactions only. Late claims and reversed purchases need separate
          treatment. Import GST schemes, fuel tax credits, BAS capital/non-capital labels and other
          special adjustments are not calculated. Evidence held after the selected period is held
          out for timing review.
        </p>
      </section>
      <GSTDetails paper={paper} />
    </>
  );
}
function GSTDetails({paper}: {paper: Workpaper}) {
  return (
    <section className="panel">
      {paper.rows.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Purchase / date</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead className="number">Recorded GST</TableHead>
              <TableHead className="number">Reviewed GST</TableHead>
              <TableHead>Review status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paper.rows.map((r, i) => (
              <TableRow key={r.target + ':' + i}>
                <TableCell>
                  <strong>{r.reference}</strong>
                  <div className="secondary">{shortDate(r.date)}</div>
                </TableCell>
                <TableCell>{r.contact}</TableCell>
                <TableCell className="number">{money(r.recorded)}</TableCell>
                <TableCell className="number">{money(r.reviewed)}</TableCell>
                <TableCell>
                  <span className={'status ' + (r.status === 'reviewed' ? 'paid' : 'draft')}>
                    {r.status}
                  </span>
                  <div className="secondary review-reason">{r.reason}</div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Empty title="No purchase GST in this period">
          Only posted bills and categorised expenses can appear here.
        </Empty>
      )}
    </section>
  );
}
export default function AustralianTaxReview({state, canWrite, mutate, onState, onGo}: Props) {
  const [tab, setTab] = useState('purchases'),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('pending'),
    [edit, setEdit] = useState<PurchaseReview | null>(null);
  const sources = useMemo(() => purchaseSources(state.events), [state.events]),
    reviews = useMemo(() => latestReviews(state.events), [state.events]);
  const source = sources.find((s) => s.id === edit?.target),
    pending = sources.filter(
      (s) => !s.void && (!reviews.has(s.id) || reviews.get(s.id)?.evidence === 'pending'),
    );
  const filtered = sources.filter(
    (s) =>
      (filter === 'all' ||
        (!s.void && (!reviews.has(s.id) || reviews.get(s.id)?.evidence === 'pending'))) &&
      (s.contact + ' ' + s.reference + ' ' + s.description)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  function open(id: string) {
    const s = sources.find((s) => s.id === id)!;
    setEdit(
      reviews.get(id) || {
        target: id,
        businessBps: 10000,
        creditableBps: s.gst ? 10000 : 0,
        evidence: 'pending',
        evidenceReference: '',
        evidenceDate: '',
        supplierAbn: s.abn,
        supplierGstConfirmed: false,
        eligibilityConfirmed: false,
        tpar: 'unreviewed',
        reason: '',
      },
    );
  }
  return (
    <>
      <div className="setup-strip">
        <div className="setup-symbol">
          <ShieldCheck size={24} />
        </div>
        <div>
          <h3>Australian tax review</h3>
          <p>
            Check purchase evidence, document your decisions and save period reports for your
            accountant.
          </p>
        </div>
        <button className="btn" onClick={() => onGo('Settings')}>
          Tax setup <ArrowRight size={16} />
        </button>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="report-tabs">
          <TabsTrigger value="purchases">Purchase review · {pending.length}</TabsTrigger>
          <TabsTrigger value="periods">Period reports</TabsTrigger>
          <TabsTrigger value="checklist">Readiness checks</TabsTrigger>
        </TabsList>
        <TabsContent value="purchases">
          <div className="notice">
            <span>
              Recorded GST is held out of the reviewed total until you confirm the evidence and
              eligible business use.{' '}
              <a className="inline-link" href={guidance.credits} target="_blank" rel="noreferrer">
                ATO GST credit guidance
              </a>
            </span>
          </div>
          <section className="panel">
            <div className="table-toolbar">
              <div className="search-field">
                <Search size={18} />
                <input
                  aria-label="Find purchase"
                  placeholder="Find supplier, reference or job…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <Choice
                label="Purchase review filter"
                value={filter}
                onChange={setFilter}
                options={[
                  ['pending', 'Awaiting review'],
                  ['all', 'All purchases'],
                ]}
              />
            </div>
            {filtered.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Purchase / supplier</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="number">Total</TableHead>
                    <TableHead className="number">Recorded GST</TableHead>
                    <TableHead>Review</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered
                    .slice()
                    .reverse()
                    .map((s) => {
                      const review = reviews.get(s.id);
                      return (
                        <TableRow key={s.id}>
                          <TableCell>
                            <strong>{s.reference}</strong>
                            <div className="secondary">{s.contact}</div>
                          </TableCell>
                          <TableCell>{shortDate(s.date)}</TableCell>
                          <TableCell className="number">{money(s.gross)}</TableCell>
                          <TableCell className="number">{money(s.gst)}</TableCell>
                          <TableCell>
                            {s.void ? (
                              <span className="status void">Reversed · adjustment review</span>
                            ) : (
                              <button className="btn small" onClick={() => open(s.id)}>
                                {!review || review.evidence === 'pending'
                                  ? 'Review purchase'
                                  : 'View / revise review'}
                              </button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            ) : (
              <Empty
                title={sources.length ? 'No purchases in this view' : 'No purchases to review yet'}
              >
                {sources.length
                  ? 'Use All purchases to see previous reviews.'
                  : 'Post a bill or categorise an expense, then review its evidence here.'}
              </Empty>
            )}
          </section>
        </TabsContent>
        <TabsContent value="periods">
          <PeriodReports
            state={state}
            canWrite={canWrite}
            mutate={mutate}
            onReview={() => setTab('purchases')}
          />
        </TabsContent>
        <TabsContent value="checklist">
          <div className="notice">
            These checks describe the current implementation and your recorded decisions. They are
            not an ATO certification or independent accountant approval.
          </div>
          <section className="panel">
            {complianceChecklist(state.events, state.settings).map((c) => (
              <div className="compliance-check" key={c.name}>
                <FileCheck2 size={21} />
                <div>
                  <h3>{c.name}</h3>
                  <p>{c.detail}</p>
                </div>
                <span className="status draft">{c.status}</span>
              </div>
            ))}
          </section>
          <div className="guidance-links">
            <a href={guidance.invoices} target="_blank" rel="noreferrer">
              ATO invoice requirements ↗
            </a>
            <a href={guidance.basis} target="_blank" rel="noreferrer">
              GST reporting basis ↗
            </a>
            <a href={guidance.records} target="_blank" rel="noreferrer">
              Business record keeping ↗
            </a>
          </div>
        </TabsContent>
      </Tabs>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="large-dialog">
          <DialogHeader>
            <DialogTitle>Review purchase GST</DialogTitle>
            <DialogDescription>
              {source?.reference} · {source?.contact} · {money(source?.gross || 0)} including
              recorded GST of {money(source?.gst || 0)}
            </DialogDescription>
          </DialogHeader>
          {edit && source && (
            <>
              <form
                className="book-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await mutate({action: 'purchaseReview', review: edit})) setEdit(null);
                }}
              >
                <div className="notice">
                  This saves a review decision and retains previous reviews. It does not amend the
                  posted ledger or a lodged return. Percentages apply uniformly to all taxable
                  items. Mixed-use items needing different percentages require a separate
                  calculation with your accountant.
                </div>
                <div className="form-grid">
                  <label>
                    Business use %
                    <input
                      required
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={edit.businessBps / 100}
                      onChange={(e) =>
                        setEdit({...edit, businessBps: Math.round(Number(e.target.value) * 100)})
                      }
                    />
                  </label>
                  <label>
                    GST-creditable use % (uniform allocation)
                    <input
                      required
                      type="number"
                      min={0}
                      max={edit.businessBps / 100}
                      step="0.01"
                      value={edit.creditableBps / 100}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          creditableBps: Math.round(Number(e.target.value) * 100),
                        })
                      }
                    />
                  </label>
                  <label className="full-width">
                    Evidence status
                    <Choice
                      label="GST evidence"
                      value={edit.evidence}
                      onChange={(x) =>
                        setEdit({
                          ...edit,
                          evidence: x as PurchaseReview['evidence'],
                          creditableBps: x === 'no_claim' ? 0 : edit.creditableBps,
                        })
                      }
                      options={[
                        ['pending', 'Awaiting evidence / eligibility review'],
                        ['tax_invoice', 'Tax invoice held and reviewed'],
                        ['small_purchase', 'Purchase $82.50 or less — other evidence held'],
                        ['no_claim', 'No GST credit claimed'],
                      ]}
                    />
                  </label>
                  <label>
                    Supplier ABN on evidence
                    <input
                      value={edit.supplierAbn}
                      maxLength={30}
                      onChange={(e) => setEdit({...edit, supplierAbn: e.target.value})}
                    />
                  </label>
                  <label>
                    Date evidence first held
                    <input
                      type="date"
                      max={today()}
                      value={edit.evidenceDate}
                      onChange={(e) => setEdit({...edit, evidenceDate: e.target.value})}
                    />
                  </label>
                  <label className="full-width">
                    Evidence file name or storage location
                    <input
                      maxLength={300}
                      placeholder="e.g. attached supplier-invoice.pdf"
                      value={edit.evidenceReference}
                      onChange={(e) => setEdit({...edit, evidenceReference: e.target.value})}
                    />
                  </label>
                </div>
                <label className="review-checkbox">
                  <input
                    type="checkbox"
                    checked={edit.supplierGstConfirmed}
                    onChange={(e) => setEdit({...edit, supplierGstConfirmed: e.target.checked})}
                  />
                  <span>
                    I checked that the supplier was registered for GST for this purchase. The app
                    does not verify registration.
                  </span>
                </label>
                <label className="review-checkbox">
                  <input
                    type="checkbox"
                    checked={edit.eligibilityConfirmed}
                    onChange={(e) => setEdit({...edit, eligibilityConfirmed: e.target.checked})}
                  />
                  <span>
                    I reviewed the evidence, eligible business use and any excluded/private portion
                    for the percentage entered above.
                  </span>
                </label>
                <label>
                  Contractor payment reporting decision
                  <Choice
                    label="TPAR purchase decision"
                    value={edit.tpar}
                    onChange={(x) => setEdit({...edit, tpar: x as PurchaseReview['tpar']})}
                    options={[
                      ['unreviewed', 'Not reviewed for TPAR'],
                      ['include', 'Include related payments in TPAR review'],
                      ['exclude', 'Exclude related payments from TPAR review'],
                    ]}
                  />
                </label>
                <p className="fineprint">
                  Inclusion requires a linked supplier flagged in Contacts. Review reportability
                  separately from GST credit eligibility. Materials-only, mixed, private,
                  withholding and other exceptions need specific review.
                </p>
                <label>
                  Reason and checks completed
                  <textarea
                    required
                    minLength={10}
                    maxLength={1500}
                    value={edit.reason}
                    onChange={(e) => setEdit({...edit, reason: e.target.value})}
                  />
                </label>
                <div className="review-result">
                  <span>GST included by this review on the whole purchase</span>
                  <strong>{money(reviewCredit(source, edit))}</strong>
                  <small>
                    Subject to server validation. Cash-basis worksheets include the paid portion
                    only.
                  </small>
                </div>
                <button className="btn primary" disabled={!canWrite}>
                  Save purchase review
                </button>
              </form>
              <Attachments target={source.id} state={state} canWrite={canWrite} onState={onState} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function PeriodReports({
  state,
  canWrite,
  mutate,
  onReview,
}: {
  state: State;
  canWrite: boolean;
  mutate: Props['mutate'];
  onReview: () => void;
}) {
  const now = today(),
    quarter = String(Math.floor((Number(now.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0');
  const [from, setFrom] = useState(now.slice(0, 4) + '-' + quarter + '-01'),
    [to, setTo] = useState(now),
    [notes, setNotes] = useState(''),
    [comparisonSource, setComparisonSource] = useState(''),
    [compare, setCompare] = useState({bank: '', profit: '', gstSales: '', gstPurchases: ''}),
    [error, setError] = useState('');
  const saved = state.events
    .filter((e) => e.kind === 'tax_snapshot')
    .slice()
    .reverse();
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const comparison = Object.fromEntries(
        Object.entries(compare).map(([k, v]) => [
          k,
          v.trim() === ''
            ? null
            : v.trim().startsWith('-')
              ? -cents(v.trim().slice(1))
              : cents(v.trim()),
        ]),
      );
      await mutate({
        action: 'taxSnapshot',
        snapshot: {from, to, notes, comparison: {...comparison, source: comparisonSource}},
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <div className="report-controls">
        <label>
          From
          <input
            type="date"
            required
            value={from}
            max={to}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            required
            value={to}
            min={from}
            onChange={(e) => e.target.value && setTo(e.target.value)}
          />
        </label>
      </div>
      <GSTWorkpaper state={state} from={from} to={to} onReview={onReview} />
      <form className="panel settings-panel book-form" onSubmit={save}>
        <h2>Save an accountant review pack</h2>
        <p className="subheading">
          Preserves this period’s figures, GST decisions, trial balance, profit and loss and
          contractor worksheet. Later changes create a new pack. Nothing is sent or lodged.
        </p>
        <details>
          <summary>Optional Xero comparison figures</summary>
          <p className="fineprint">
            Use the same dates, accounts and GST basis. Bank means the combined book balance of the
            four accounts at the end date; profit uses accrual. Values are entered by you and do not
            verify a Xero import.
          </p>
          <label>
            Xero report names / export file references
            <input
              value={comparisonSource}
              maxLength={300}
              onChange={(e) => setComparisonSource(e.target.value)}
            />
          </label>
          <div className="form-grid">
            {(
              [
                ['bank', 'Combined book bank balance'],
                ['profit', 'Net profit / loss'],
                ['gstSales', 'GST on sales'],
                ['gstPurchases', 'Purchase GST claimed'],
              ] as const
            ).map(([k, label]) => (
              <label key={k}>
                {label} · AUD
                <input
                  inputMode="decimal"
                  placeholder="Leave blank if not checked"
                  value={compare[k]}
                  onChange={(e) => setCompare({...compare, [k]: e.target.value})}
                />
              </label>
            ))}
          </div>
        </details>
        <label>
          Period review notes
          <textarea
            required
            minLength={10}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Record which reports you checked, differences and questions for your accountant."
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="btn primary" disabled={!canWrite || from > to}>
          Save draft review pack
        </button>
      </form>
      <section className="panel settings-panel">
        <h2>Saved review packs</h2>
        {saved.length ? (
          saved.map((e) => {
            const p = e.payload as TaxSnapshot,
              changed = sourceRevision(state.events) !== p.sourceRevision;
            return (
              <details className="saved-review" key={e.id}>
                <summary>
                  {shortDate(p.from)} – {shortDate(p.to)}{' '}
                  <span className="secondary">
                    Saved {new Date(p.preparedAt).toLocaleString('en-AU')} · draft
                  </span>
                </summary>
                <p>{p.notes}</p>
                {changed && (
                  <div className="notice">
                    Your records have changed since this pack was saved. These are the preserved
                    figures; save a new pack to capture current records.
                  </div>
                )}
                <GSTTotals paper={p.gst} />
                <p className="fineprint">
                  {p.unmatchedStatementLines} unmatched statement lines · {p.draftDocuments} draft
                  documents dated on or before the period end
                </p>
                {p.comparisonSource && (
                  <>
                    <h3>Xero comparison · {p.comparisonSource}</h3>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Figure</TableHead>
                          <TableHead>TradeDesk</TableHead>
                          <TableHead>Entered Xero value</TableHead>
                          <TableHead>Difference</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {p.comparison.map((c) => (
                          <TableRow key={c.key}>
                            <TableCell>
                              {
                                {
                                  bank: 'Combined bank balance',
                                  profit: 'Profit / loss',
                                  gstSales: 'GST on sales',
                                  gstPurchases: 'Reviewed purchase GST',
                                }[c.key]
                              }
                            </TableCell>
                            <TableCell>{money(c.local)}</TableCell>
                            <TableCell>{c.xero === null ? 'Not entered' : money(c.xero)}</TableCell>
                            <TableCell>
                              {c.difference === null ? '—' : money(c.difference)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </>
                )}
                <div className="review-blockers">
                  <h3>Recorded review points</h3>
                  <ul>
                    {p.gst.blockers.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                    <li>Independent accountant review and Xero reconciliation remain required.</li>
                  </ul>
                </div>
                <div className="section-actions">
                  <button
                    className="btn"
                    onClick={() =>
                      download(
                        'accountant-review-' + p.from + '-' + e.id.slice(0, 8) + '.json',
                        JSON.stringify(p, null, 2),
                        'application/json',
                      )
                    }
                  >
                    <Download size={16} />
                    Full pack (JSON)
                  </button>
                  <button className="btn" onClick={() => GSTExport(p.gst)}>
                    GST detail (CSV)
                  </button>
                  <button
                    className="btn"
                    onClick={() =>
                      download(
                        'trial-balance-' + p.to + '.csv',
                        csv([
                          ['SAVED DRAFT TRIAL BALANCE', p.to],
                          ['Account', 'Name', 'Debit', 'Credit'],
                          ...p.trial.map((a) => [a.code, a.name, a.debit / 100, a.credit / 100]),
                        ]),
                      )
                    }
                  >
                    Trial balance (CSV)
                  </button>
                </div>
              </details>
            );
          })
        ) : (
          <Empty title="No saved packs yet">
            Save your first period review above. The source documents and attachments remain in your
            books.
          </Empty>
        )}
      </section>
    </>
  );
}
export function ContractorReview({state, onGo}: {state: State; onGo: (view: string) => void}) {
  const now = today(),
    fy = Number(now.slice(0, 4)) - (Number(now.slice(5, 7)) < 7 ? 1 : 0),
    [from, setFrom] = useState(fy + '-07-01'),
    [to, setTo] = useState(fy + 1 + '-06-30'),
    rows = reviewedContractors(state.events, from, to);
  const headers = [
    'Contractor',
    'ABN',
    'Address',
    'All linked payments',
    'Included by review',
    'GST in included payments',
    'Awaiting review',
    'Excluded by review',
  ];
  return (
    <>
      <div className="report-controls">
        <label>
          Financial year from
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
          disabled={from > to}
          onClick={() =>
            download(
              'contractor-review.csv',
              csv([
                ['OWNER-PREPARED DRAFT — not a TPAR lodgment file'],
                ['From', from, 'To', to],
                headers,
                ...rows.map((c) => [
                  c.contact.name,
                  c.contact.abn,
                  c.contact.address,
                  c.gross / 100,
                  c.included / 100,
                  c.includedGst / 100,
                  c.pending / 100,
                  c.excluded / 100,
                ]),
              ]),
            )
          }
        >
          <Download size={16} />
          Export
        </button>
        <button className="btn primary" onClick={() => onGo('Australian tax review')}>
          Review purchases
        </button>
      </div>
      <div className="notice">
        <span>
          Includes linked payments to suppliers flagged for contractor review. Each purchase needs
          an include/exclude decision. Review missing contacts, materials-only payments, mixed
          services, private use, refunds and ABN withholding separately.{' '}
          <a className="inline-link" href={guidance.tpar} target="_blank" rel="noreferrer">
            ATO TPAR guidance
          </a>
        </span>
      </div>
      {from > to ? (
        <p className="form-error">Choose a valid period.</p>
      ) : (
        <section className="panel">
          {rows.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contractor</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead className="number">Included / GST</TableHead>
                  <TableHead className="number">Awaiting review</TableHead>
                  <TableHead className="number">Excluded</TableHead>
                  <TableHead>Payments</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.contact.id}>
                    <TableCell>{c.contact.name}</TableCell>
                    <TableCell>
                      {c.contact.abn || 'ABN missing'}
                      <div className="secondary">{c.contact.address || 'Address missing'}</div>
                      {c.missingDetails && <span className="status overdue">Check details</span>}
                    </TableCell>
                    <TableCell className="number">
                      {money(c.included)}
                      <div className="secondary">GST {money(c.includedGst)}</div>
                    </TableCell>
                    <TableCell className="number">{money(c.pending)}</TableCell>
                    <TableCell className="number">{money(c.excluded)}</TableCell>
                    <TableCell>
                      <button
                        className="btn small"
                        onClick={() =>
                          download(
                            'contractor-payments.csv',
                            csv([
                              ['Contractor', c.contact.name],
                              ['Date', 'Reference', 'Gross', 'GST', 'Review status'],
                              ...c.rows.map((r) => [
                                r.date,
                                r.reference,
                                r.gross / 100,
                                r.gst / 100,
                                r.status,
                              ]),
                            ]),
                          )
                        }
                      >
                        Export {c.rows.length}
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Empty title="No suppliers flagged for contractor review">
              Flag relevant suppliers in Contacts and select them on bills and expenses. Text-only
              supplier names are not automatically linked.
            </Empty>
          )}
        </section>
      )}
    </>
  );
}
