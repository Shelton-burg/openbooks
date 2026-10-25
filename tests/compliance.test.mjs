import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultSettings, derive, report} from '../lib/books.ts';
import {paymentPlan} from '../lib/operations.ts';
import {
  purchaseSources,
  reviewSchema,
  validateReview,
  reviewCredit,
  gstWorkpaper,
  invoiceChecks,
  taxSnapshot,
  reviewedContractors,
} from '../lib/compliance.ts';
const profile = {
  ...defaultSettings,
  name: 'Test Plumbing',
  abn: '51824753556',
  gst: 'yes',
  gstBasis: 'accrual',
  entityType: 'company',
  taxSetupConfirmed: true,
};
const bill = {
  id: '10000000-0000-4000-8000-000000000001',
  type: 'bill',
  number: 'B-1',
  contact: 'Supplier',
  contactId: '20000000-0000-4000-8000-000000000001',
  contactAbn: '51824753556',
  contactAddress: 'Test address',
  reference: 'SUP-1',
  date: '2026-08-01',
  due: '2026-08-15',
  inclusive: false,
  job: 'Test',
  lines: [{description: 'Plumbing supplies', qty: '1', price: '100', tax: 'gst', account: '500'}],
  seller: profile,
};
const ev = (kind, payload) => ({
  id: crypto.randomUUID(),
  kind,
  payload,
  createdAt: '2026-09-07T00:00:00Z',
});
const base = (d = bill) => [ev('document', d), ev('post', {docId: d.id})];
const review = (target = bill.id) => ({
  target,
  businessBps: 10000,
  creditableBps: 10000,
  evidence: 'tax_invoice',
  evidenceReference: 'supplier-tax-invoice.pdf',
  evidenceDate: '2026-08-01',
  supplierAbn: '51824753556',
  supplierGstConfirmed: true,
  eligibilityConfirmed: true,
  tpar: 'unreviewed',
  reason: 'Reviewed original supplier tax invoice and eligible business use.',
});
const period = (events, settings = profile, from = '2026-08-01', to = '2026-08-31') =>
  gstWorkpaper(events, settings, from, to);
test('unreviewed GST is held out and an eligibility review leaves the ledger unchanged', () => {
  const events = base(),
    before = report(events, '2026-08-01', '2026-08-31', 'accrual');
  assert.equal(period(events).heldPurchases, 1000);
  assert.equal(period(events).reviewedPurchases, 0);
  const r = {...review(), businessBps: 8000, creditableBps: 7500};
  validateReview(purchaseSources(events)[0], r, '2026-09-07');
  events.push(ev('purchase_review', r));
  const p = period(events);
  assert.equal(p.reviewedPurchases, 750);
  assert.equal(p.excludedPurchases, 250);
  assert.match(p.blockers.join(' '), /Private-use/);
  assert.deepEqual(report(events, '2026-08-01', '2026-08-31', 'accrual'), before);
});
test('evidence threshold, supplier ABN, confirmation and business-use constraints are enforced', () => {
  const s = purchaseSources(base())[0];
  for (const r of [
    {...review(), evidence: 'small_purchase'},
    {...review(), supplierAbn: '123'},
    {...review(), eligibilityConfirmed: false},
    {...review(), supplierGstConfirmed: false},
    {...review(), evidenceDate: ''},
    {...review(), evidenceReference: ''},
    {...review(), businessBps: 5000, creditableBps: 6000},
    {...review(), evidence: 'no_claim'},
    {...review(), evidenceDate: '2026-09-08'},
  ])
    assert.throws(() => validateReview(s, r, '2026-09-07'));
  const small = {...s, gross: 8250, gst: 750};
  assert.doesNotThrow(() =>
    validateReview(small, {...review(), evidence: 'small_purchase'}, '2026-09-07'),
  );
  assert.throws(() =>
    validateReview(
      {...small, gross: 8251},
      {...review(), evidence: 'small_purchase'},
      '2026-09-07',
    ),
  );
  assert.throws(() => reviewSchema.parse({...review(), creditableBps: 50.5}));
});
test('no-claim and pending reviews contribute zero; a later review replaces only workpaper figures', () => {
  const events = [
    ...base(),
    ev('purchase_review', {...review(), evidence: 'no_claim', creditableBps: 0}),
  ];
  assert.equal(period(events).reviewedPurchases, 0);
  events.push(ev('purchase_review', review()));
  assert.equal(period(events).reviewedPurchases, 1000);
  events.push(ev('purchase_review', {...review(), evidence: 'pending'}));
  assert.equal(period(events).reviewedPurchases, 0);
  assert.equal(period(events).heldPurchases, 1000);
});
test('cash GST apportions the reviewed tax cumulatively across periods and preserves every cent', () => {
  const d = {...bill, lines: [{...bill.lines[0], price: '0.15'}]},
    events = [...base(d), ev('purchase_review', {...review(), creditableBps: 5000})];
  const raw = [],
    eligible = [];
  for (let i = 0; i < 17; i++) {
    const date = i < 8 ? '2026-08-02' : '2026-09-02',
      bank = {
        id: crypto.randomUUID(),
        date,
        reference: String(i),
        amount: -1,
        description: 'Partial payment',
        account: '100',
      };
    events.push(
      ev('bank', bank),
      ev('payment', paymentPlan(bank, derive(events).docs, [{docId: d.id, amount: 1}])),
    );
  }
  for (const [from, to] of [
    ['2026-08-01', '2026-08-31'],
    ['2026-09-01', '2026-09-30'],
  ]) {
    const p = period(events, {...profile, gstBasis: 'cash'}, from, to);
    raw.push(p.recordedPurchases);
    eligible.push(p.reviewedPurchases);
  }
  assert.equal(
    raw.reduce((a, b) => a + b, 0),
    2,
  );
  assert.equal(
    eligible.reduce((a, b) => a + b, 0),
    1,
  );
  assert.equal(
    period(events, {...profile, gstBasis: 'cash'}, '2026-08-01', '2026-09-30').rows.length,
    17,
  );
  assert.equal(derive(events).docs[0].status, 'paid');
});
test('evidence held after a period and unreviewed earlier purchases are flagged without automatic late claims', () => {
  const events = [...base(), ev('purchase_review', {...review(), evidenceDate: '2026-09-02'})];
  assert.equal(period(events).reviewedPurchases, 0);
  assert.match(period(events).rows[0].reason, /after this period/);
  const later = period(base(), profile, '2026-09-01', '2026-09-30');
  assert.equal(later.reviewedPurchases, 0);
  assert.match(later.blockers.join(' '), /Earlier purchases/);
});
test('reversals require adjustment review while future reversals preserve earlier reviewed figures', () => {
  const events = [
    ...base(),
    ev('purchase_review', review()),
    ev('reverse', {docId: bill.id, date: '2026-09-02', reason: 'Supplier correction'}),
  ];
  assert.equal(period(events).reviewedPurchases, 1000);
  const p = period(events, profile, '2026-09-01', '2026-09-30');
  assert.equal(p.recordedPurchases, -1000);
  assert.equal(p.reviewedPurchases, 0);
  assert.match(p.blockers.join(' '), /adjustment/);
  assert.throws(() => validateReview(purchaseSources(events)[0], review(), '2026-09-07'));
});
test('invoice checks distinguish GST registration and keep buyer identity for larger invoices', () => {
  const d = {
    ...bill,
    type: 'invoice',
    lines: [{...bill.lines[0], account: '400', price: '1500'}],
  };
  assert.deepEqual(invoiceChecks(d), []);
  assert.match(invoiceChecks({...d, seller: {...profile, gst: 'no'}}).join(' '), /registered/);
  assert.match(invoiceChecks({...d, seller: {...profile, abn: ''}}).join(' '), /ABN/);
  assert.match(invoiceChecks({...d, contact: '', contactAbn: ''}).join(' '), /buyer identity/i);
});
test('saved review packs preserve period values, negative comparisons and unknown tax setup', () => {
  const events = [...base(), ev('purchase_review', review())],
    input = {
      from: '2026-08-01',
      to: '2026-08-31',
      notes: 'Test accountant review pack',
      comparison: {
        source: 'Xero trial and GST reports',
        bank: 0,
        profit: -10000,
        gstSales: 0,
        gstPurchases: 900,
      },
    },
    p = taxSnapshot(events, profile, input),
    saved = JSON.parse(JSON.stringify(p));
  events.push(ev('purchase_review', {...review(), creditableBps: 5000}));
  assert.equal(p.gst.reviewedPurchases, 1000);
  assert.deepEqual(p, saved);
  assert.equal(p.comparison.find((x) => x.key === 'gstPurchases').difference, 100);
  assert.equal(p.comparison.find((x) => x.key === 'profit').difference, 0);
  assert.equal(period(events, {...profile, taxSetupConfirmed: false}).blockers.length > 0, true);
});
test('contractor decisions use purchase identity when references repeat across bank accounts', () => {
  const contact = {
      id: bill.contactId,
      name: 'Contractor',
      contractor: true,
      abn: '51824753556',
      address: '1 Test Street',
    },
    events = [ev('contact', contact)];
  for (const [id, account, amount] of [
    ['a', '100', 11000],
    ['b', '101', 22000],
  ]) {
    events.push(
      ev('bank', {
        id,
        account,
        amount: -amount,
        date: '2026-08-02',
        reference: 'SAME',
        description: 'Contractor',
      }),
      ev('cash', {
        bankId: id,
        contactId: contact.id,
        gstPurchases: amount / 11,
        journal: {
          date: '2026-08-02',
          reference: 'SAME',
          description: 'Contractor',
          lines: [
            {account: '510', debit: amount - amount / 11, credit: 0},
            {account: '120', debit: amount / 11, credit: 0},
            {account, debit: 0, credit: amount},
          ],
        },
      }),
    );
  }
  events.push(
    ev('purchase_review', {...review('a'), tpar: 'include'}),
    ev('purchase_review', {...review('b'), tpar: 'exclude'}),
  );
  const r = reviewedContractors(events, '2026-07-01', '2027-06-30')[0];
  assert.equal(r.included, 11000);
  assert.equal(r.includedGst, 1000);
  assert.equal(r.excluded, 22000);
  assert.equal(r.pending, 0);
  assert.equal(r.missingDetails, false);
  assert.equal(reviewCredit(purchaseSources(events)[0], undefined), 0);
});
