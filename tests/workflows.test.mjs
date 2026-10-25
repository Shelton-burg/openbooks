import test from 'node:test';
import assert from 'node:assert/strict';
import {derive, report, balanced, documentJournal} from '../lib/books.ts';
import {
  paymentPlan,
  allocatedTax,
  agedDocuments,
  cashForecast,
  convertedDocument,
  transition,
  manualJournal,
  operations,
  ruleMatches,
  contractorWorksheet,
} from '../lib/operations.ts';
const id = '10000000-0000-4000-8000-000000000001';
const doc = {
  id,
  type: 'invoice',
  number: 'INV-1001',
  contact: 'Test customer',
  date: '2026-08-01',
  due: '2026-08-15',
  inclusive: false,
  lines: [{description: 'Plumbing work', qty: '1', price: '100.05', tax: 'gst', account: '400'}],
};
const ev = (kind, payload) => ({
  id: crypto.randomUUID(),
  kind,
  payload,
  createdAt: '2026-09-07T00:00:00Z',
});
const base = [ev('document', doc), ev('post', {docId: id})];
const bank = (amount, date = '2026-09-01') => ({
  id: crypto.randomUUID(),
  account: '101',
  date,
  description: 'Payment',
  reference: 'TX',
  amount,
});
test('partial payments reduce outstanding balance and final payment releases every GST cent', () => {
  let events = [...base];
  let tax = 0;
  for (const amount of [1234, 2345, 7427]) {
    const b = bank(amount),
      p = paymentPlan(b, derive(events).docs, [{docId: id, amount}]);
    tax += p.allocations[0].tax;
    events.push(ev('payment', p));
    assert.ok(balanced(p.journal.lines));
  }
  const d = derive(events).docs[0];
  assert.equal(d.status, 'paid');
  assert.equal(d.balance, 0);
  assert.equal(d.paid, d.total);
  assert.equal(tax, d.taxTotal);
  const r = report(events, '2026-09-01', '2026-09-30', 'cash');
  assert.equal(r.gstSales, 1001);
  assert.equal(r.income, 0);
  assert.equal(r.trial.find((a) => a.code === '110').balance, 0);
});
test('payment spanning documents clears only its allocated amounts', () => {
  const second = {...doc, id: 'second', number: 'INV-1002'};
  const e = [...base, ev('document', second), ev('post', {docId: 'second'})];
  const p = paymentPlan(bank(16006), derive(e).docs, [
    {docId: id, amount: 11006},
    {docId: 'second', amount: 5000},
  ]);
  const v = derive([...e, ev('payment', p)]);
  assert.equal(v.docs[0].status, 'paid');
  assert.equal(v.docs[1].balance, 6006);
  assert.equal(v.docs[1].status, 'open');
  assert.equal(v.usedBanks.size, 1);
});
test('reject overpayment, wrong sign, duplicate document, zero, unmatched sum and pre-issue date', () => {
  const docs = derive(base).docs;
  for (const [b, a] of [
    [bank(12000), [{docId: id, amount: 12000}]],
    [bank(-11006), [{docId: id, amount: 11006}]],
    [
      bank(11006),
      [
        {docId: id, amount: 5503},
        {docId: id, amount: 5503},
      ],
    ],
    [bank(10), [{docId: id, amount: 0}]],
    [bank(11000), [{docId: id, amount: 11006}]],
    [bank(11006, '2026-07-01'), [{docId: id, amount: 11006}]],
  ])
    assert.throws(() => paymentPlan(b, docs, a));
});
test('rounding uses safe integer arithmetic for large and many tiny allocations', () => {
  assert.equal(allocatedTax(90909091, 1000000000, 1000000000), 90909091);
  for (let total = 1; total < 120; total++) {
    let sum = 0;
    for (let paid = 1; paid <= total; paid++)
      sum += allocatedTax(11, paid, total) - allocatedTax(11, paid - 1, total);
    assert.equal(sum, 11);
  }
});
test('aged balances ignore payments and reversals effective after the report date', () => {
  const b = bank(5000, '2026-09-02'),
    p = paymentPlan(b, derive(base).docs, [{docId: id, amount: 5000}]),
    events = [...base, ev('payment', p)];
  assert.equal(agedDocuments(events, '2026-08-31', 'invoice')[0].balance, 11006);
  assert.equal(agedDocuments(events, '2026-09-03', 'invoice')[0].balance, 6006);
  const reversed = [...base, ev('reverse', {docId: id, date: '2026-09-03', reason: 'Correction'})];
  assert.equal(agedDocuments(reversed, '2026-08-31', 'invoice').length, 1);
  assert.equal(agedDocuments(reversed, '2026-09-04', 'invoice').length, 0);
});
test('quotes and purchase orders stay outside ledger and convert only from valid states', () => {
  for (const type of ['quote', 'purchase_order']) {
    const q = {
      ...doc,
      type,
      lines: doc.lines.map((l) => ({...l, account: type === 'quote' ? '400' : '500'})),
    };
    let v = derive([ev('document', q)]).docs[0];
    assert.throws(() => documentJournal(q));
    assert.throws(() =>
      convertedDocument(v, crypto.randomUUID(), 'NEW', '2026-09-01', '2026-09-15'),
    );
    assert.equal(transition(v, 'issued'), 'issued');
    v = {...v, status: type === 'quote' ? 'accepted' : 'issued'};
    const converted = convertedDocument(v, crypto.randomUUID(), 'NEW', '2026-09-01', '2026-09-15');
    assert.equal(converted.type, type === 'quote' ? 'invoice' : 'bill');
    assert.equal(converted.reference, q.number);
    assert.equal(
      derive([ev('document', q), ev('workflow_status', {docId: id, status: v.status})]).journal
        .length,
      0,
    );
    assert.throws(() => transition({...v, status: 'converted'}, 'issued'));
  }
});
test('editing a draft is reflected in its eventual posting with no stale original amounts', () => {
  const changed = {...doc, lines: [{...doc.lines[0], price: '200'}]};
  const e = [
    ev('document', doc),
    ev('document_edit', {docId: id, document: changed}),
    ev('post', {docId: id}),
  ];
  assert.equal(derive(e).docs[0].total, 22000);
  assert.equal(report(e, '2026-08-01', '2026-08-31', 'accrual').income, 20000);
});
test('manual adjustments reject controls and never create GST report amounts', () => {
  const j = {
    date: '2026-09-01',
    reference: 'DEP',
    description: 'Monthly accounting depreciation',
    lines: [
      {account: '580', debit: 10000, credit: 0},
      {account: '151', debit: 0, credit: 10000},
    ],
  };
  assert.ok(balanced(manualJournal(j).lines));
  for (const account of ['100', '101', '102', '103', '110', '120', '200', '210'])
    assert.throws(() => manualJournal({...j, lines: [{...j.lines[0], account}, j.lines[1]]}));
  const r = report([ev('manual_journal', {journal: j})], '2026-09-01', '2026-09-30', 'cash');
  assert.equal(r.expenses, 10000);
  assert.equal(r.gstPurchases, 0);
});
test('saved contacts keep their identity after editing and archived rules stop matching', () => {
  const events = [ev('contact', {id: 'a', name: 'Old'}), ev('contact', {id: 'a', name: 'New'})];
  assert.deepEqual(operations(events).contacts, [{id: 'a', name: 'New'}]);
  const r = {archived: false, direction: 'out', contains: 'fuel'};
  assert.ok(ruleMatches(r, {amount: -10, description: 'FUEL STATION'}));
  assert.equal(ruleMatches({...r, archived: true}, {amount: -10, description: 'FUEL'}), false);
});
test('forecast includes overdue amounts once and excludes unposted quotes', () => {
  const events = [...base, ev('document', {...doc, id: 'quote', type: 'quote', number: 'Q'})];
  const weeks = cashForecast(events, '2026-09-01');
  assert.equal(weeks[0].income, 11006);
  assert.equal(
    weeks.slice(1).reduce((n, w) => n + w.income, 0),
    0,
  );
  assert.equal(weeks[7].closing, 11006);
});
test('contractor worksheet counts linked paid amounts, not all bills or unlinked contractors', () => {
  const b = {...doc, type: 'bill', contactId: 'c', lines: [{...doc.lines[0], account: '510'}]},
    events = [
      ev('contact', {id: 'c', contractor: true, name: 'Contractor'}),
      ev('document', b),
      ev('post', {docId: id}),
    ];
  const p = paymentPlan(bank(-5000), derive(events).docs, [{docId: id, amount: 5000}]);
  const w = contractorWorksheet([...events, ev('payment', p)], '2026-07-01', '2027-06-30')[0];
  assert.equal(w.gross, 5000);
  assert.equal(w.gst, p.allocations[0].tax);
  assert.equal(w.rows.length, 1);
});
