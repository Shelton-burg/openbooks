'use client';
import {useState} from 'react';
import {Plus, Printer, Download, ArrowRight} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {Table, TableHeader, TableBody, TableHead, TableRow, TableCell} from '@/components/ui/table';
import {Checkbox} from '@/components/ui/checkbox';
import {Choice, Empty, download} from './book-ui';
import Attachments from './attachments';
import {
  derive,
  money,
  cents,
  today,
  shortDate,
  csv,
  accounts,
  type State,
  type Bank,
} from '@/lib/books';
import {operations} from '@/lib/operations';
import {creditPlan, type Credit, type Fund} from '@/lib/finance';
type Props = {
  state: State;
  canWrite: boolean;
  mutate: (p: unknown) => Promise<boolean>;
  onState: (s: State) => void;
  onGo: (view: string) => void;
};
const adjustmentsURL =
  'https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/in-detail/managing-gst-in-your-business/reporting-paying-and-activity-statements/making-adjustments-on-your-activity-statements';
export function Credits({
  state,
  canWrite,
  mutate,
  onState,
  onGo,
  initialDocId,
  onPrint,
}: {initialDocId?: string; onPrint: (c: Credit) => void} & Props) {
  const v = derive(state.events),
    [creating, setCreating] = useState(!!initialDocId),
    [sourceId, setSourceId] = useState(initialDocId || 'none'),
    [type, setType] = useState('all'),
    [value, setValue] = useState(''),
    [date, setDate] = useState(today()),
    [reason, setReason] = useState(''),
    [supplierReference, setSupplierReference] = useState(''),
    [number, setNumber] = useState('CN-' + (1001 + v.credits.length)),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<string | null>(null);
  const docs = v.docs.filter(
      (d) => d.posted && d.status !== 'void' && ['invoice', 'bill'].includes(d.type),
    ),
    source = docs.find((d) => d.id === sourceId),
    active = v.credits.find((c) => c.id === selected),
    filtered = v.credits.filter((c) => type === 'all' || c.type === type);
  let preview: ReturnType<typeof creditPlan> | null = null;
  try {
    preview = creditPlan(state.events, {
      id: '00000000-0000-4000-8000-000000000001',
      docId: sourceId,
      number,
      date,
      amount: cents(value),
      reason,
      supplierReference,
    });
  } catch {}
  return (
    <>
      <div className="section-actions">
        <Choice
          value={type}
          label="Credit type"
          onChange={setType}
          options={[
            ['all', 'All credits'],
            ['invoice', 'Customer credits'],
            ['bill', 'Supplier credits'],
          ]}
        />
        <button
          className="btn"
          onClick={() =>
            download(
              'credit-notes.csv',
              csv([
                [
                  'Type',
                  'Number',
                  'Original document',
                  'Date',
                  'Contact',
                  'Gross credit',
                  'GST',
                  'Applied',
                  'Refunded',
                  'Available',
                ],
                ...filtered.map((c) => [
                  c.type,
                  c.number,
                  c.originalNumber,
                  c.date,
                  c.contact,
                  c.total / 100,
                  c.taxTotal / 100,
                  c.applied / 100,
                  c.refunded / 100,
                  c.balance / 100,
                ]),
              ]),
            )
          }
        >
          <Download size={16} />
          Export
        </button>
        <button
          className="btn primary"
          disabled={!canWrite}
          onClick={() => {
            setSourceId('none');
            setValue('');
            setReason('');
            setNumber('CN-' + (1001 + v.credits.length));
            setSupplierReference('');
            setError('');
            setCreating(true);
          }}
        >
          <Plus size={16} />
          New credit note
        </button>
      </div>
      <div className="notice">
        A credit reduces the original sale or purchase and applies to its outstanding balance first.
        Any remainder can be refunded or used on another document for the same saved contact. Money
        moves only when you make the payment through your bank.
      </div>
      <section className="panel">
        {filtered.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Credit / original</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="number">Credit</TableHead>
                <TableHead className="number">Available</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered
                .slice()
                .reverse()
                .map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <strong>{c.number}</strong>
                      <div className="secondary">{c.originalNumber}</div>
                    </TableCell>
                    <TableCell>
                      {c.contact}
                      <div className="secondary">
                        {c.type === 'invoice' ? 'Customer' : 'Supplier'}
                      </div>
                    </TableCell>
                    <TableCell>{shortDate(c.date)}</TableCell>
                    <TableCell className="number">{money(c.total)}</TableCell>
                    <TableCell className="number">{money(c.balance)}</TableCell>
                    <TableCell>
                      <button className="btn small" onClick={() => setSelected(c.id)}>
                        Open
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        ) : (
          <Empty title="No credit notes yet">
            Create a credit for a price reduction, cancelled work or returned purchase on a posted
            document.
          </Empty>
        )}
      </section>
      <p className="fineprint">
        Standard proportional price reductions using the original GST treatment. Mixed-tax changes,
        bad debts and corrections to an original GST error need separate review.{' '}
        <a href={adjustmentsURL} target="_blank" rel="noreferrer" className="inline-link">
          ATO adjustment guidance
        </a>
      </p>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="large-dialog">
          <DialogHeader>
            <DialogTitle>New credit note</DialogTitle>
            <DialogDescription>
              The original document is retained. Posting creates a dated credit and applies it to
              any amount still outstanding.
            </DialogDescription>
          </DialogHeader>
          <form
            className="book-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setError('');
              try {
                if (
                  await mutate({
                    action: 'creditNote',
                    credit: {
                      id: crypto.randomUUID(),
                      docId: sourceId,
                      number,
                      date,
                      amount: cents(value),
                      reason,
                      supplierReference,
                    },
                  })
                )
                  setCreating(false);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <label>
              Original invoice or bill
              <Choice
                value={sourceId}
                label="Original document"
                options={[
                  ['none', 'Choose a posted document'],
                  ...docs.map((d) => [d.id, d.number + ' · ' + d.contact + ' · ' + money(d.total)]),
                ]}
                onChange={setSourceId}
              />
            </label>
            {source && (
              <p className="fineprint">
                Original {money(source.total)} · still outstanding {money(source.balance)} ·
                previous credits{' '}
                {money(
                  v.credits
                    .filter((c) => c.sourceDocId === source.id)
                    .reduce((n, c) => n + c.total, 0),
                )}
              </p>
            )}
            <div className="form-grid">
              <label>
                Credit number
                <input
                  required
                  maxLength={40}
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                />
              </label>
              <label>
                Credit date
                <input
                  required
                  type="date"
                  min={source?.date}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label>
                Credit amount including GST · AUD
                <input
                  required
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </label>
              {source?.type === 'bill' && (
                <label>
                  Supplier credit note reference
                  <input
                    required
                    maxLength={100}
                    value={supplierReference}
                    onChange={(e) => setSupplierReference(e.target.value)}
                  />
                </label>
              )}
            </div>
            <label>
              Reason for the credit
              <textarea
                required
                minLength={10}
                maxLength={1500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Describe the agreed price reduction, cancelled work or return."
              />
            </label>
            {preview && (
              <div className="review-result">
                <span>GST reduction {money(preview.taxTotal)}</span>
                <strong>{money(preview.total)}</strong>
                <small>
                  Revised price {money(preview.afterPrice)} ·{' '}
                  {money(Math.min(source!.balance, preview.total))} applies to the original balance.
                </small>
              </div>
            )}
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <p className="fineprint">
              This credit is permanent once posted. Check the source, amount, date and reason before
              saving.
            </p>
            <button className="btn primary" disabled={!canWrite || !source}>
              Post credit & apply to original balance
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!active} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="large-dialog">
          <DialogHeader>
            <DialogTitle>{active?.number}</DialogTitle>
            <DialogDescription>Credit note and remaining balance</DialogDescription>
          </DialogHeader>
          {active && (
            <div className="book-form">
              <div className="report-row">
                <span>
                  {active.contact} · original {active.originalNumber}
                </span>
                <strong>{money(active.total)}</strong>
              </div>
              <p>{active.reason}</p>
              <div className="payment-detail">
                <div>
                  <span>Applied to documents</span>
                  <strong>{money(active.applied)}</strong>
                </div>
                <div>
                  <span>Refunded through bank</span>
                  <strong>{money(active.refunded)}</strong>
                </div>
                <div>
                  <span>Available credit</span>
                  <strong>{money(active.balance)}</strong>
                </div>
              </div>
              <button className="btn" onClick={() => onPrint(active)}>
                <Printer size={16} />
                Print / save credit PDF
              </button>
              {active.balance > 0 && (
                <ApplyBalance
                  key={active.id + ':' + active.balance}
                  record={active}
                  kind="credit"
                  state={state}
                  canWrite={canWrite}
                  mutate={mutate}
                />
              )}
              <button
                className="text-btn"
                onClick={() => {
                  setSelected(null);
                  onGo('Bank reconciliation');
                }}
              >
                Record refund from a bank statement <ArrowRight size={16} />
              </button>
              <Attachments target={active.id} state={state} canWrite={canWrite} onState={onState} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function ApplyBalance({
  record,
  kind,
  state,
  canWrite,
  mutate,
}: {
  record: Credit | Fund;
  kind: 'credit' | 'fund';
  state: State;
  canWrite: boolean;
  mutate: Props['mutate'];
}) {
  const [docId, setDocId] = useState('none'),
    [value, setValue] = useState((record.balance / 100).toFixed(2)),
    [date, setDate] = useState(today()),
    [error, setError] = useState('');
  const docs = derive(state.events).docs.filter(
    (d) =>
      d.status === 'open' &&
      d.type === (kind === 'fund' ? 'invoice' : (record as Credit).type) &&
      ((kind === 'credit' && (record as Credit).sourceDocId === d.id) ||
        (record.contactId && record.contactId === d.contactId)),
  );
  return (
    <form
      className="book-form balance-apply"
      onSubmit={async (e) => {
        e.preventDefault();
        setError('');
        try {
          await mutate({
            action: kind === 'credit' ? 'applyCredit' : 'applyFund',
            creditId: kind === 'credit' ? record.id : undefined,
            fundId: kind === 'fund' ? record.id : undefined,
            docId,
            amount: cents(value),
            date,
          });
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <h3>Apply available balance</h3>
      <label>
        Outstanding document
        <Choice
          value={docId}
          label="Apply to document"
          options={[
            ['none', 'Choose an outstanding document'],
            ...docs.map((d) => [d.id, d.number + ' · ' + money(d.balance)]),
          ]}
          onChange={(x) => {
            setDocId(x);
            const d = docs.find((d) => d.id === x);
            if (d) setValue((Math.min(record.balance, d.balance) / 100).toFixed(2));
          }}
        />
      </label>
      <div className="form-grid">
        <label>
          Amount · AUD
          <input
            required
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <label>
          Date
          <input
            required
            type="date"
            min={record.lastDate}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
      <button className="btn primary" disabled={!canWrite || docId === 'none'}>
        Apply to document
      </button>
    </form>
  );
}
export function CustomerFunds({state, canWrite, mutate, onState, onGo}: Props) {
  const v = derive(state.events),
    [id, setId] = useState<string | null>(null),
    active = v.funds.find((f) => f.id === id);
  return (
    <>
      <div className="section-actions">
        <p>Customer money held for later allocation or refund.</p>
        <button className="btn primary" onClick={() => onGo('Bank reconciliation')}>
          Record from bank statement
        </button>
      </div>
      <div className="notice">
        Ordinary advances currently support cash-basis GST, or businesses not registered for GST.
        Non-cash GST advances need whole-contract attribution and remain unavailable. Security bonds
        are a separate workflow.
      </div>
      <section className="panel">
        {v.funds.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer / reference</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="number">Received</TableHead>
                <TableHead className="number">Held</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {v.funds
                .slice()
                .reverse()
                .map((f) => (
                  <TableRow key={f.id}>
                    <TableCell>
                      {f.contact}
                      <div className="secondary">{f.reference}</div>
                    </TableCell>
                    <TableCell>
                      {f.kind === 'advance' ? 'Job advance' : 'Mistaken overpayment'}
                    </TableCell>
                    <TableCell>{shortDate(f.date)}</TableCell>
                    <TableCell className="number">{money(f.total)}</TableCell>
                    <TableCell className="number">{money(f.balance)}</TableCell>
                    <TableCell>
                      <button className="btn small" onClick={() => setId(f.id)}>
                        Open
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        ) : (
          <Empty title="No customer funds held">
            Use Credits / customer funds while reviewing money received in Bank reconciliation.
          </Empty>
        )}
      </section>
      <Dialog open={!!active} onOpenChange={(o) => !o && setId(null)}>
        <DialogContent className="large-dialog">
          <DialogHeader>
            <DialogTitle>{active?.contact} · customer funds</DialogTitle>
            <DialogDescription>
              Apply funds to a posted invoice or record a refund from your bank statement.
            </DialogDescription>
          </DialogHeader>
          {active && (
            <div className="book-form">
              <div className="report-row">
                <span>Still held · {active.reference}</span>
                <strong>{money(active.balance)}</strong>
              </div>
              <p>{active.reason}</p>
              <p className="fineprint">
                GST recorded on receipt {money(active.taxTotal)} · applied {money(active.applied)} ·
                refunded {money(active.refunded)}
              </p>
              {active.balance > 0 && (
                <ApplyBalance
                  key={active.id + ':' + active.balance}
                  record={active}
                  kind="fund"
                  state={state}
                  canWrite={canWrite}
                  mutate={mutate}
                />
              )}
              <Attachments target={active.id} state={state} canWrite={canWrite} onState={onState} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
export function FinanceBankActions({
  bank,
  state,
  canWrite,
  onSave,
}: {
  bank: Bank;
  state: State;
  canWrite: boolean;
  onSave: (p: unknown) => Promise<void>;
}) {
  const v = derive(state.events),
    [mode, setMode] = useState(bank.amount > 0 ? 'capture' : 'creditRefund'),
    [id, setId] = useState('none'),
    [contactId, setContactId] = useState('none'),
    [kind, setKind] = useState('advance'),
    [tax, setTax] = useState(state.settings.gst === 'yes' ? 'gst' : 'none'),
    [reason, setReason] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [reference, setReference] = useState(bank.reference);
  const credits = v.credits.filter(
      (c) => c.balance >= Math.abs(bank.amount) && bank.amount < 0 === (c.type === 'invoice'),
    ),
    funds = v.funds.filter((f) => bank.amount < 0 && f.balance >= -bank.amount);
  return (
    <div className="book-form">
      <Choice
        label="Bank adjustment action"
        value={mode}
        onChange={(x) => {
          setMode(x);
          setId('none');
        }}
        options={[
          ...(bank.amount > 0 ? [['capture', 'Receive customer funds']] : []),
          ['creditRefund', bank.amount < 0 ? 'Customer credit refund' : 'Supplier credit refund'],
          ...(bank.amount < 0 ? [['fundRefund', 'Refund customer funds']] : []),
        ]}
      />
      {mode === 'capture' ? (
        <form
          className="book-form"
          onSubmit={async (e) => {
            e.preventDefault();
            await onSave({
              action: 'customerFund',
              fund: {
                id: crypto.randomUUID(),
                bankId: bank.id,
                contactId,
                kind,
                tax: kind === 'overpayment' ? 'none' : tax,
                reference,
                reason,
                confirmed,
              },
            });
          }}
        >
          <div className="notice">
            Use this for money held before allocation to an invoice. Ordinary invoice payments
            belong in Allocate payment. A mistaken overpayment must be refundable money that is not
            yet payment for a supply.
          </div>
          <label>
            Customer
            <Choice
              value={contactId}
              label="Customer for funds"
              onChange={setContactId}
              options={[
                ['none', 'Choose saved customer'],
                ...operations(state.events)
                  .contacts.filter((c) => !c.archived && c.role !== 'supplier')
                  .map((c) => [c.id, c.name]),
              ]}
            />
          </label>
          <label>
            Payment purpose
            <Choice
              value={kind}
              label="Purpose of customer funds"
              onChange={(x) => {
                setKind(x);
                setConfirmed(false);
              }}
              options={[
                ['advance', 'Advance payment for a job'],
                ['overpayment', 'Refundable mistaken overpayment — no supply'],
              ]}
            />
          </label>
          {kind === 'advance' && (
            <label>
              GST on this advance
              <Choice
                value={tax}
                onChange={setTax}
                label="Advance GST"
                options={
                  state.settings.gst === 'yes'
                    ? [
                        ['gst', '10% GST included'],
                        ['free', 'GST-free'],
                        ['none', 'No GST'],
                      ]
                    : [['none', 'No GST']]
                }
              />
            </label>
          )}
          <label>
            Reference
            <input
              required
              maxLength={100}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </label>
          <label>
            Job, agreement and reason
            <textarea
              required
              minLength={10}
              maxLength={1500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label className="review-checkbox">
            <Checkbox checked={confirmed} onCheckedChange={(x) => setConfirmed(x === true)} />
            <span>
              {kind === 'advance'
                ? 'I checked this is an ordinary job advance with the selected GST treatment, not a security bond.'
                : 'I checked this is refundable money paid by mistake, not consideration for current or future work.'}
            </span>
          </label>
          <button
            className="btn primary"
            disabled={!canWrite || !confirmed || contactId === 'none'}
          >
            Record customer funds & reconcile
          </button>
        </form>
      ) : (
        <>
          <div className="notice">
            This records a refund already shown in your bank statement. It does not send money. The
            statement amount must fit within the available balance.
          </div>
          <Choice
            label="Refund balance"
            value={id}
            onChange={setId}
            options={[
              ['none', 'Choose a credit or customer balance'],
              ...(mode === 'creditRefund' ? credits : funds).map((c) => [
                c.id,
                c.contact +
                  ' · ' +
                  ('number' in c ? c.number : c.reference) +
                  ' · ' +
                  money(c.balance),
              ]),
            ]}
          />
          <button
            className="btn primary"
            disabled={!canWrite || id === 'none'}
            onClick={() =>
              onSave({
                action: mode,
                bankId: bank.id,
                creditId: mode === 'creditRefund' ? id : undefined,
                fundId: mode === 'fundRefund' ? id : undefined,
              })
            }
          >
            Record refund & reconcile {money(Math.abs(bank.amount))}
          </button>
        </>
      )}
    </div>
  );
}
export function CreditPrint({credit: c, sample}: {credit: Credit; sample: boolean}) {
  const seller = c.seller || {};
  return (
    <article className="print-invoice">
      <header>
        <div>
          <h1>
            {c.type === 'invoice'
              ? c.taxTotal
                ? 'ADJUSTMENT NOTE / CREDIT NOTE'
                : 'CREDIT NOTE'
              : 'SUPPLIER CREDIT RECORD'}
          </h1>
          {sample && <p>SAMPLE · NOT FOR USE</p>}
          <h2>{seller.name}</h2>
          <p>{seller.abn ? 'ABN ' + seller.abn : ''}</p>
          <p>{seller.address}</p>
          <p>
            {seller.email} {seller.phone}
          </p>
        </div>
        <div>
          <h2>{c.number}</h2>
          <p>Issued {shortDate(c.date)}</p>
        </div>
      </header>
      <section>
        <h3>{c.type === 'invoice' ? 'Customer' : 'Supplier'}</h3>
        <p>{c.contact}</p>
        <p>{c.contactAddress}</p>
        <p>{c.contactAbn ? 'ABN ' + c.contactAbn : ''}</p>
        <p>
          Original document {c.originalNumber} · {shortDate(c.originalDate)}
        </p>
        {c.supplierReference && <p>Supplier adjustment reference: {c.supplierReference}</p>}
      </section>
      <section>
        <h3>Reason for adjustment</h3>
        <p>{c.reason}</p>
        <p>
          This reduces the price of the original supply by {money(c.total)}, including a GST
          reduction of {money(c.taxTotal)}.
        </p>
      </section>
      <table>
        <thead>
          <tr>
            <th>Original account allocation</th>
            <th>Credit excluding GST</th>
          </tr>
        </thead>
        <tbody>
          {c.lines.map((l: {account: string; net: number}, i: number) => (
            <tr key={i}>
              <td>{accounts.find((a) => a[0] === l.account)?.[1]}</td>
              <td>{money(l.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="totals">
        <div>
          <span>Price before this credit</span>
          <strong>{money(c.beforePrice)}</strong>
        </div>
        <div>
          <span>Credit excluding GST</span>
          <strong>{money(c.net)}</strong>
        </div>
        <div>
          <span>GST reduction</span>
          <strong>{money(c.taxTotal)}</strong>
        </div>
        <div className="total">
          <span>Total credit AUD</span>
          <strong>{money(c.total)}</strong>
        </div>
        <div>
          <span>Price after this credit</span>
          <strong>{money(c.afterPrice)}</strong>
        </div>
      </div>
      {c.type === 'bill' && (
        <section>
          <p>
            Internal record of the supplier’s credit. Retain the original supplier adjustment note
            as supporting evidence.
          </p>
        </section>
      )}
    </article>
  );
}
