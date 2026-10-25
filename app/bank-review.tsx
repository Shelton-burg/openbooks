'use client';
import {useState} from 'react';
import {CheckCircle2, Search} from 'lucide-react';
import {Tabs, TabsList, TabsTrigger, TabsContent} from '@/components/ui/tabs';
import {Table, TableHeader, TableBody, TableHead, TableRow, TableCell} from '@/components/ui/table';
import {Checkbox} from '@/components/ui/checkbox';
import {FinanceBankActions} from './finance';
import Attachments from './attachments';
import {Choice, Empty} from './book-ui';
import {
  accounts,
  bankName,
  cents,
  money,
  shortDate,
  type Bank,
  type ViewDoc,
  type Settings,
  type State,
} from '@/lib/books';
import {operations, ruleMatches, paymentPlan} from '@/lib/operations';
export default function Reconcile({
  bank,
  banks,
  docs,
  canWrite,
  settings,
  state,
  onSave,
  onState,
}: {
  bank: Bank;
  banks: Bank[];
  docs: ViewDoc[];
  canWrite: boolean;
  settings: Settings;
  state: State;
  onState: (s: State) => void;
  onSave: (body: unknown) => Promise<void>;
}) {
  const matches = docs.filter(
      (d) =>
        d.status === 'open' &&
        d.type === (bank.amount > 0 ? 'invoice' : 'bill') &&
        bank.date >= d.date,
    ),
    ops = operations(state.events),
    rules = ops.rules.filter((r) => ruleMatches(r, bank));
  const exact = matches.filter((d) => d.balance === Math.abs(bank.amount));
  const [account, setAccount] = useState(bank.amount > 0 ? '400' : '500'),
    [tax, setTax] = useState(settings.gst === 'yes' ? 'gst' : 'none'),
    [contactId, setContactId] = useState('none'),
    [query, setQuery] = useState(''),
    [allocations, setAllocations] = useState<Record<string, string>>(() =>
      exact.length === 1 ? {[exact[0].id]: (Math.abs(bank.amount) / 100).toFixed(2)} : {},
    ),
    [error, setError] = useState(''),
    [retainExcess, setRetainExcess] = useState(false);
  const transferMatches = banks.filter(
    (b) =>
      b.id !== bank.id &&
      (b.account || '100') !== (bank.account || '100') &&
      b.amount === -bank.amount &&
      b.date === bank.date,
  );
  let allocated = 0,
    validAmounts = true;
  try {
    allocated = Object.values(allocations).reduce((n, x) => n + (x ? cents(x) : 0), 0);
  } catch {
    validAmounts = false;
  }
  return (
    <>
      <Attachments target={bank.id} state={state} canWrite={canWrite} onState={onState} />
      <Tabs
        defaultValue={matches.length ? 'match' : transferMatches.length ? 'transfer' : 'categorise'}
      >
        <TabsList className="reconcile-tabs">
          <TabsTrigger value="match">Allocate payment</TabsTrigger>
          <TabsTrigger value="categorise">Categorise</TabsTrigger>
          <TabsTrigger value="adjustments">Credits / customer funds</TabsTrigger>
          <TabsTrigger value="transfer">Transfer ({transferMatches.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="match">
          <form
            className="book-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setError('');
              try {
                const rows = Object.entries(allocations)
                  .filter(([, amount]) => amount && cents(amount) > 0)
                  .map(([docId, amount]) => ({docId, amount: cents(amount)}));
                paymentPlan(
                  retainExcess && bank.amount > allocated ? {...bank, amount: allocated} : bank,
                  docs,
                  rows,
                );
                await onSave({
                  action: 'payment',
                  bankId: bank.id,
                  allocations: rows,
                  retainExcess,
                });
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <div className="notice">
              Allocate this bank payment to one or more posted{' '}
              {bank.amount > 0 ? 'invoices' : 'bills'}. Part payments leave the rest outstanding.
              The total must match the statement line, or fully settle invoices for one customer and
              retain a confirmed excess.
            </div>
            <div className="search-field">
              <Search size={17} />
              <input
                aria-label="Find document to pay"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find by document, contact or job…"
              />
            </div>
            {matches.length ? (
              <div className="allocation-table">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Document / contact</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead className="number">Outstanding</TableHead>
                      <TableHead>Allocate $</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {matches
                      .filter((d) =>
                        (d.number + ' ' + d.contact + ' ' + d.job)
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                      )
                      .map((d) => (
                        <TableRow key={d.id}>
                          <TableCell>
                            <strong>{d.number}</strong>
                            <div className="secondary">{d.contact}</div>
                          </TableCell>
                          <TableCell>{shortDate(d.due)}</TableCell>
                          <TableCell className="number">{money(d.balance)}</TableCell>
                          <TableCell>
                            <input
                              className="allocation-input"
                              aria-label={'Allocate to ' + d.number}
                              inputMode="decimal"
                              placeholder="0.00"
                              value={allocations[d.id] || ''}
                              onChange={(e) =>
                                setAllocations({...allocations, [d.id]: e.target.value})
                              }
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <Empty title="No outstanding documents to pay">
                Post the invoice or bill first. Payments before a document’s issue date need a
                deposit workflow.
              </Empty>
            )}
            <div className="payment-detail">
              <div>
                <span>Bank payment</span>
                <strong>{money(Math.abs(bank.amount))}</strong>
              </div>
              <div>
                <span>Allocated across all selected documents</span>
                <strong>{validAmounts ? money(allocated) : 'Check amounts'}</strong>
              </div>
              <div>
                <span>Left to allocate</span>
                <strong>{validAmounts ? money(Math.abs(bank.amount) - allocated) : '—'}</strong>
              </div>
            </div>
            <p className="fineprint">
              Cash-basis GST is allocated proportionally across the document, with any rounding
              remainder included in its final payment. Use Credits / customer funds to record job
              advances, mistaken overpayments or refunds. Credit balances can be applied from
              Credits & refunds.
            </p>
            {bank.amount > 0 && allocated > 0 && allocated < bank.amount && (
              <label className="review-checkbox">
                <Checkbox
                  checked={retainExcess}
                  onCheckedChange={(x) => setRetainExcess(x === true)}
                />
                <span>
                  Fully settle these invoices and hold the remaining{' '}
                  {money(bank.amount - allocated)} as this customer’s refundable overpayment.
                </span>
              </label>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="btn primary"
              disabled={
                !canWrite ||
                !validAmounts ||
                (allocated !== Math.abs(bank.amount) &&
                  !(retainExcess && bank.amount > allocated && allocated > 0)) ||
                !matches.length
              }
            >
              Confirm allocations & reconcile
            </button>
          </form>
        </TabsContent>
        <TabsContent value="categorise">
          <div className="book-form">
            <div className="notice">
              Use this when there is no invoice or bill for the payment in these books. Categorising
              an existing invoice payment as income would double-count it.
            </div>
            {rules.length > 0 && (
              <section className="rule-suggestions">
                <h3>Matching bank rules</h3>
                {rules.map((r) => (
                  <button
                    className="btn"
                    key={r.id}
                    onClick={() => {
                      setAccount(r.account);
                      setTax(settings.gst === 'yes' ? r.tax : 'none');
                    }}
                  >
                    {r.name} · Apply suggestion
                  </button>
                ))}
              </section>
            )}
            <label>
              Account
              <Choice
                value={account}
                label="Payment account"
                onChange={(x) => {
                  setAccount(x);
                  if (['300', '250'].includes(x)) setTax('none');
                }}
                options={accounts.filter(
                  (a) =>
                    a[2] === (bank.amount > 0 ? 'income' : 'expense') ||
                    (bank.amount < 0 && a[0] === '150') ||
                    ['300', '250'].includes(a[0]),
                )}
              />
            </label>
            <label>
              GST treatment
              <Choice
                value={tax}
                label="GST treatment"
                onChange={setTax}
                options={
                  settings.gst === 'yes' && !['300', '250'].includes(account)
                    ? [
                        ['gst', 'GST 10% included'],
                        ['free', 'GST-free'],
                        ['none', 'No GST'],
                      ]
                    : [['none', 'No GST']]
                }
              />
            </label>
            <label>
              Link saved {bank.amount > 0 ? 'customer' : 'supplier'} (optional)
              <Choice
                value={contactId}
                label="Payment contact"
                onChange={setContactId}
                options={[
                  ['none', 'No contact selected'],
                  ...ops.contacts
                    .filter(
                      (c) =>
                        !c.archived &&
                        (bank.amount > 0 ? c.role !== 'supplier' : c.role !== 'customer'),
                    )
                    .map((c) => [c.id, c.name]),
                ]}
              />
            </label>
            <p className="fineprint">
              Select a saved contractor to include this payment in their review worksheet. Attach
              the supplier tax invoice above to keep supporting evidence with this payment.
            </p>
            <button
              className="btn primary"
              disabled={!canWrite}
              onClick={() =>
                onSave({
                  action: 'cash',
                  bankId: bank.id,
                  account,
                  tax,
                  contactId: contactId === 'none' ? undefined : contactId,
                })
              }
            >
              <CheckCircle2 size={17} />
              Categorise & reconcile {money(Math.abs(bank.amount))}
            </button>
          </div>
        </TabsContent>
        <TabsContent value="adjustments">
          <FinanceBankActions bank={bank} state={state} canWrite={canWrite} onSave={onSave} />
        </TabsContent>
        <TabsContent value="transfer">
          <div className="notice">
            Match both sides of a transfer between your accounts. This moves funds without creating
            income, expenses or GST.
          </div>
          {transferMatches.length ? (
            transferMatches.map((other) => (
              <div className="match-row" key={other.id}>
                <div>
                  <strong>{bankName(other.account || '100', settings)}</strong>
                  <p>
                    {other.description} · {money(other.amount)} · {shortDate(other.date)}
                  </p>
                </div>
                <button
                  className="btn primary"
                  disabled={!canWrite}
                  onClick={() =>
                    onSave({action: 'transfer', bankId: bank.id, otherBankId: other.id})
                  }
                >
                  Record transfer
                </button>
              </div>
            ))
          ) : (
            <Empty title="No matching transfer line">
              Import the other account’s statement. This supports equal opposite amounts on the same
              date. Transfers with fees or different posting dates require a clearing-account
              workflow.
            </Empty>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
