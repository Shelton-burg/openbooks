import test from 'node:test';
import assert from 'node:assert/strict';
import {derive, report, balanced, defaultSettings} from '../lib/books.ts';
import {paymentPlan, agedDocuments} from '../lib/operations.ts';
import {
  creditPlan,
  applyCreditPlan,
  creditRefundPlan,
  fundPlan,
  applyFundPlan,
  fundRefundPlan,
  checkFinanceDate,
  contactStatement,
} from '../lib/finance.ts';
import {gstWorkpaper} from '../lib/compliance.ts';
const settings = {
  ...defaultSettings,
  name: 'Test Plumbing',
  gst: 'yes',
  gstBasis: 'cash',
  abn: '51824753556',
  entityType: 'company',
  taxSetupConfirmed: true,
};
const contact = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Customer',
  role: 'both',
  archived: false,
};
const event = (kind, payload) => ({
  id: crypto.randomUUID(),
  kind,
  payload,
  createdAt: '2026-09-07T00:00:00Z',
});
function doc(type = 'invoice', price = '100', id = crypto.randomUUID()) {
  return {
    id,
    type,
    number: id,
    contactId: contact.id,
    contact: contact.name,
    contactAddress: 'Test address',
    contactAbn: '51824753556',
    date: '2026-08-01',
    due: '2026-08-15',
    inclusive: false,
    lines: [
      {
        description: 'Labour',
        qty: '1',
        price,
        tax: 'gst',
        account: type === 'invoice' ? '400' : '500',
      },
    ],
    seller: settings,
  };
}
function initial(d = doc()) {
  return [event('contact', contact), event('document', d), event('post', {docId: d.id})];
}
function bank(amount, date = '2026-08-02') {
  return {
    id: crypto.randomUUID(),
    amount,
    date,
    reference: crypto.randomUUID(),
    description: 'Payment',
    account: '101',
  };
}
function pay(e, d, value, date = '2026-08-02') {
  const b = bank(d.type === 'invoice' ? value : -value, date),
    p = paymentPlan(b, derive(e).docs, [{docId: d.id, amount: value}]);
  e.push(event('bank', b), event('payment', p));
  return p;
}
function credit(e, d, value, date = '2026-08-03') {
  const p = creditPlan(e, {
    id: crypto.randomUUID(),
    docId: d.id,
    number: crypto.randomUUID(),
    date,
    amount: value,
    reason: 'Agreed reduction in the contract price.',
    supplierReference: 'Supplier credit reference',
  });
  e.push(event('credit_note', p));
  const apply = Math.min(value, derive(e).docs.find((x) => x.id === d.id).balance);
  if (apply) e.push(event('credit_apply', applyCreditPlan(e, p.id, d.id, apply, date)));
  return p;
}
const total = (e, basis = 'cash') => report(e, '2026-01-01', '2026-12-31', basis);
function assertControls(e) {
  const v = derive(e),
    r = total(e);
  assert.ok(v.journal.every((j) => balanced(j.lines)));
  assert.equal(
    r.trial.reduce((n, a) => n + a.balance, 0),
    0,
  );
  assert.equal(
    r.trial.find((a) => a.code === '110').balance,
    v.docs
      .filter((d) => d.type === 'invoice' && d.status === 'open')
      .reduce((n, d) => n + d.balance, 0),
  );
  assert.equal(
    -r.trial.find((a) => a.code === '200').balance || 0,
    v.docs
      .filter((d) => d.type === 'bill' && d.status === 'open')
      .reduce((n, d) => n + d.balance, 0),
  );
  assert.equal(
    -r.trial.find((a) => a.code === '220').balance || 0,
    v.credits.filter((c) => c.type === 'invoice').reduce((n, c) => n + c.balance, 0),
  );
  assert.equal(
    r.trial.find((a) => a.code === '130').balance,
    v.credits.filter((c) => c.type === 'bill').reduce((n, c) => n + c.balance, 0),
  );
}
test('unpaid customer and supplier credits reduce balances without creating cash GST', () => {
  for (const type of ['invoice', 'bill']) {
    const d = doc(type),
      e = initial(d);
    credit(e, d, 2200);
    const v = derive(e);
    assert.equal(v.docs[0].balance, 8800);
    assert.equal(v.docs[0].paid, 0);
    assert.equal(v.docs[0].credited, 2200);
    assert.equal(v.credits[0].balance, 0);
    assert.equal(total(e)[type === 'invoice' ? 'gstSales' : 'gstPurchases'], 0);
    pay(e, d, 8800, '2026-08-04');
    assert.equal(total(e)[type === 'invoice' ? 'gstSales' : 'gstPurchases'], 800);
    assert.equal(total(e, 'accrual')[type === 'invoice' ? 'income' : 'expenses'], 8000);
    assertControls(e);
  }
});
test('credit after part payment leaves only the paid portion refundable', () => {
  const d = doc(),
    e = initial(d);
  pay(e, d, 5000);
  const c = credit(e, d, 11000);
  assert.equal(derive(e).docs[0].balance, 0);
  assert.equal(derive(e).credits[0].balance, 5000);
  const b = bank(-5000, '2026-09-01');
  e.push(event('bank', b), event('credit_refund', creditRefundPlan(e, c.id, b)));
  assert.equal(total(e).gstSales, 0);
  assert.equal(total(e, 'accrual').income, 0);
  assert.equal(derive(e).credits[0].balance, 0);
  assertControls(e);
});
test('fully paid credits can be refunded in pieces without exceeding their GST or balance', () => {
  for (const type of ['invoice', 'bill']) {
    const d = doc(type, '100.05'),
      e = initial(d);
    pay(e, d, 11006);
    const c = credit(e, d, 11006);
    for (const value of [1234, 2345, 7427]) {
      const b = bank(type === 'invoice' ? -value : value, '2026-09-01');
      e.push(event('bank', b), event('credit_refund', creditRefundPlan(e, c.id, b)));
    }
    assert.equal(total(e)[type === 'invoice' ? 'gstSales' : 'gstPurchases'], 0);
    assert.throws(() => creditRefundPlan(e, c.id, bank(type === 'invoice' ? -1 : 1, '2026-09-02')));
    assertControls(e);
  }
});
test('paid customer credit applied to a later invoice is a settlement, not new cash', () => {
  const d = doc(),
    e = initial(d);
  pay(e, d, 11000);
  const c = credit(e, d, 2200);
  const later = {...doc(), date: '2026-09-01', due: '2026-09-15'};
  e.push(event('document', later), event('post', {docId: later.id}));
  e.push(event('credit_apply', applyCreditPlan(e, c.id, later.id, 2200, '2026-09-01')));
  pay(e, later, 8800, '2026-09-02');
  assert.equal(total(e).gstSales, 1800);
  assert.equal(total(e, 'accrual').income, 18000);
  assert.equal(derive(e).banks.length, 2);
  assertControls(e);
});
test('credit overuse, unrelated contacts, mixed-tax changes and invalid chronology are rejected', () => {
  const d = doc(),
    e = initial(d);
  pay(e, d, 11000);
  const c = credit(e, d, 2200);
  assert.throws(() => credit(e, d, 9000));
  assert.throws(() => creditRefundPlan(e, c.id, bank(2200, '2026-09-01')));
  assert.throws(() => creditRefundPlan(e, c.id, bank(-2200, '2026-08-01')));
  const other = {...doc(), contactId: crypto.randomUUID()};
  e.push(event('document', other), event('post', {docId: other.id}));
  assert.throws(() => applyCreditPlan(e, c.id, other.id, 2200, '2026-09-01'));
  assert.throws(() => checkFinanceDate(e, '2026-08-01', d.id));
  const mixed = {
    ...doc(),
    lines: [
      ...d.lines,
      {description: 'No GST item', qty: '1', price: '10', tax: 'none', account: '400'},
    ],
  };
  assert.throws(() => credit(initial(mixed), mixed, 100));
});
test('cash-basis job advance is recognised for GST once and does not create premature income', () => {
  const d = {...doc(), date: '2026-09-01', due: '2026-09-15'},
    e = [event('contact', contact)],
    b = bank(5500, '2026-08-01');
  const f = fundPlan(
    e,
    settings,
    {
      id: crypto.randomUUID(),
      bankId: b.id,
      contactId: contact.id,
      kind: 'advance',
      tax: 'gst',
      reference: 'Job advance',
      reason: 'Part payment for contracted plumbing work.',
      confirmed: true,
    },
    b,
  );
  e.push(event('bank', b), event('customer_fund', f));
  assert.equal(total(e).gstSales, 500);
  assert.equal(total(e).income, 0);
  e.push(event('document', d), event('post', {docId: d.id}));
  e.push(event('fund_apply', applyFundPlan(e, f.id, d.id, 5500, '2026-09-01')));
  pay(e, d, 5500, '2026-09-02');
  assert.equal(total(e).gstSales, 1000);
  assert.equal(total(e, 'accrual').gstSales, 1000);
  assert.equal(total(e).income, 10000);
  assert.equal(total(e).trial.find((a) => a.code === '225').balance, 0);
  assertControls(e);
});
test('mistaken overpayment remains refundable without GST and later allocation recognises the supply', () => {
  const d = doc(),
    e = initial(d),
    b = bank(15000),
    f = fundPlan(
      e,
      settings,
      {
        id: crypto.randomUUID(),
        bankId: b.id,
        contactId: contact.id,
        kind: 'overpayment',
        tax: 'none',
        reference: 'Mistaken payment',
        reason: 'Customer paid by mistake; no supply yet.',
        confirmed: true,
      },
      b,
    );
  e.push(event('bank', b), event('customer_fund', f));
  assert.equal(total(e).gstSales, 0);
  e.push(event('fund_apply', applyFundPlan(e, f.id, d.id, 11000, '2026-08-03')));
  assert.equal(total(e).gstSales, 1000);
  const refund = bank(-4000, '2026-08-04');
  e.push(event('bank', refund), event('fund_refund', fundRefundPlan(e, f.id, refund)));
  assert.equal(total(e).gstSales, 1000);
  assert.equal(derive(e).funds[0].balance, 0);
  assertControls(e);
});
test('advance refunds reverse only their recorded GST and non-cash advances require a separate workflow', () => {
  const e = [event('contact', contact)],
    b = bank(11000),
    input = {
      id: crypto.randomUUID(),
      bankId: b.id,
      contactId: contact.id,
      kind: 'advance',
      tax: 'gst',
      reference: 'Advance',
      reason: 'Advance on agreed plumbing work.',
      confirmed: true,
    };
  assert.throws(() => fundPlan(e, {...settings, gstBasis: 'accrual'}, input, b));
  const f = fundPlan(e, settings, input, b);
  e.push(event('bank', b), event('customer_fund', f));
  for (const value of [5000, 6000]) {
    const r = bank(-value, '2026-09-01');
    e.push(event('bank', r), event('fund_refund', fundRefundPlan(e, f.id, r)));
  }
  assert.equal(total(e).gstSales, 0);
  assert.equal(total(e).trial.find((a) => a.code === '225').balance, 0);
  assertControls(e);
});
test('historical ageing excludes later credit applications and adjusted purchase workpapers flag their review', () => {
  const d = doc('bill'),
    e = initial(d);
  e.push(
    event('purchase_review', {
      target: d.id,
      businessBps: 10000,
      creditableBps: 10000,
      evidence: 'tax_invoice',
      evidenceDate: '2026-08-01',
      evidenceReference: 'invoice.pdf',
      supplierGstConfirmed: true,
      eligibilityConfirmed: true,
      supplierAbn: '51824753556',
      tpar: 'exclude',
      reason: 'Business purchase reviewed.',
    }),
  );
  credit(e, d, 2200, '2026-09-01');
  assert.equal(agedDocuments(e, '2026-08-31', 'bill')[0].balance, 11000);
  assert.equal(agedDocuments(e, '2026-09-02', 'bill')[0].balance, 8800);
  const paper = gstWorkpaper(e, {...settings, gstBasis: 'accrual'}, '2026-08-01', '2026-09-30');
  assert.equal(paper.reviewedPurchases, 800);
  assert.match(paper.blockers.join(' '), /adjustment/);
});
test('small-value full credits and prior part payments preserve every cent', () => {
  for (let net = 1; net <= 250; net += 3) {
    const d = doc('invoice', (net / 100).toFixed(2)),
      e = initial(d),
      full = derive(e).docs[0].total,
      paid = Math.max(1, Math.floor(full / 3));
    pay(e, d, paid);
    const c = credit(e, d, full);
    const refund = bank(-paid, '2026-09-01');
    e.push(event('bank', refund), event('credit_refund', creditRefundPlan(e, c.id, refund)));
    assert.equal(total(e).gstSales, 0, 'net ' + net);
    assertControls(e);
  }
});

test('contact statements agree with invoices less unused credits and customer funds', () => {
  const d = doc(),
    e = initial(d);
  pay(e, d, 11000);
  const c = credit(e, d, 2200);
  const refunded = bank(-1000, '2026-08-04');
  e.push(event('bank', refunded), event('credit_refund', creditRefundPlan(e, c.id, refunded)));
  const v = derive(e),
    rows = contactStatement(e, contact.id, 'invoice', '2026-09-01');
  assert.equal(rows.at(-1).balance, -1200);
  assert.equal(rows.at(-1).balance, v.docs[0].balance - v.credits[0].balance);
  assert.equal(contactStatement(e, contact.id, 'invoice', '2026-08-01').at(-1).balance, 11000);
});
