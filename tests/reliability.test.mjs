import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultSettings, totals, derive, report} from '../lib/books.ts';
import {receiptDraft} from '../lib/receipt.ts';
import {receiptIssues, duplicateBill, unmatchPlan} from '../lib/reliability.ts';
import {occurrence, emailDraft, emailHtml, recurringDrafts} from '../lib/invoicing.ts';
import {cutoverComparison} from '../lib/cutover.ts';
const event = (kind, payload) => ({
  id: crypto.randomUUID(),
  kind,
  payload,
  createdAt: new Date().toISOString(),
});
const doc = () => ({
  id: crypto.randomUUID(),
  type: 'bill',
  number: 'BILL-1',
  contact: 'Bunnings',
  reference: 'ABC123',
  date: '2026-10-01',
  due: '2026-10-01',
  inclusive: true,
  lines: [
    {description: 'Pipe', qty: '2', price: '11.00', discount: '2.20', account: '500', tax: 'gst'},
  ],
});
test('quantities discounts and GST retain exact receipt totals', () => {
  const d = doc();
  assert.deepEqual(totals(d), {net: 1800, taxTotal: 180, total: 1980});
  const r = receiptDraft(
    d,
    {
      supplier: 'Bunnings',
      abn: '',
      address: '',
      reference: 'ABC123',
      date: '2026-10-01',
      due: null,
      currency: 'AUD',
      total: 1980,
      gst: 180,
      lines: [
        {
          description: 'Pipe',
          gross: 1980,
          quantity: '2',
          unitPrice: 1100,
          discount: 220,
          tax: 'gst',
        },
      ],
      warnings: [],
    },
    true,
    [],
    crypto.randomUUID(),
  );
  assert.equal(r.document.lines[0].qty, '2');
  assert.equal(r.document.lines[0].discount, '2.20');
  assert.equal(totals(r.document).total, 1980);
  assert.equal(r.document.receiptReview.reviewed, false);
});
test('supplier references are scoped to suppliers and ignore void documents', () => {
  const d = doc(),
    candidate = {...d, id: crypto.randomUUID()};
  assert.ok(duplicateBill(candidate, [event('document', d)]));
  assert.equal(duplicateBill({...candidate, contact: 'Reece'}, [event('document', d)]), undefined);
  assert.equal(
    duplicateBill(candidate, [event('document', d), event('discard', {docId: d.id})]),
    undefined,
  );
});
test('receipt discrepancies cannot be posted without review and explanation', () => {
  const d = doc(),
    id = crypto.randomUUID();
  d.seller = {...defaultSettings, gst: 'yes'};
  d.receiptReview = {
    attachmentId: id,
    expectedTotal: 2200,
    expectedGst: 200,
    warnings: [],
    reviewed: false,
    explanation: '',
  };
  const events = [event('attachment', {id, target: d.id})];
  assert.equal(receiptIssues(d, events).length, 2);
  d.receiptReview.reviewed = true;
  assert.equal(receiptIssues(d, events).length, 1);
  d.receiptReview.explanation = 'The supplier issued a corrected amount.';
  assert.equal(receiptIssues(d, events).length, 0);
});
test('monthly recurrence retains month-end anchor through February', () => {
  assert.equal(occurrence('2026-01-31', 'monthly', 1), '2026-02-28');
  assert.equal(occurrence('2026-01-31', 'monthly', 2), '2026-03-31');
  assert.equal(occurrence('2026-10-01', 'weekly', 2), '2026-10-15');
});
test('email drafts require a linked verified-format customer address and escape HTML', () => {
  const d = {
      ...doc(),
      type: 'invoice',
      seller: {...defaultSettings, name: 'Test business', gst: 'no'},
      lines: [{description: 'Labour', qty: '1', price: '100', account: '400', tax: 'none'}],
    },
    s = {settings: d.seller, events: [event('document', d), event('post', {docId: d.id})]};
  assert.throws(
    () => emailDraft(s, {id: crypto.randomUUID(), kind: 'invoice', docId: d.id}),
    /saved customer/,
  );
  assert.equal(
    emailHtml('<script>'),
    '<div style="font-family:Arial,sans-serif;color:#152c49;max-width:720px;margin:auto;white-space:pre-wrap;line-height:1.6">&lt;script&gt;</div>',
  );
});
test('migration comparison exposes missing accounts and source documents instead of a false pass', () => {
  const d = doc(),
    s = {
      settings: defaultSettings,
      events: [event('document', d), event('post', {docId: d.id})],
    };
  const r = cutoverComparison(s, {
    date: '2026-10-17',
    periodFrom: '2026-10-01',
    source: 'Xero exported report',
    basis: 'accrual',
    balances: [{account: '200', balance: -1980}],
    documents: [{type: 'bill', number: 'ABC123', contact: 'Bunnings', balance: 1980}],
    gstSales: 0,
    gstPurchases: 180,
  });
  assert.equal(r.documents[0].status, 'Agrees');
  assert.ok(r.missingAccounts.length);
  assert.ok(r.differences > 0);
});
