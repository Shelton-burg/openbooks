import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultSettings} from '../lib/books.ts';
import {
  readImportCsv,
  guessColumns,
  importMoney,
  importDate,
  makeImportPlan,
  importSpecSchema,
} from '../lib/imports.ts';
const state = () => ({settings: {...defaultSettings, gst: 'yes'}, events: []});
const spec = (kind, text, extra = {}) =>
  importSpecSchema.parse({
    kind,
    text,
    columns: guessColumns(readImportCsv(text).headers, kind),
    audConfirmed: true,
    ...extra,
  });
const bank =
  'Date,Description,Amount,Reference\n01/10/2026,Materials,-55.00,ONE\n02/10/2026,Customer payment,110.00,TWO';
const invoice =
  'InvoiceNumber,ContactName,InvoiceDate,DueDate,Description,Quantity,UnitAmount,TaxType,AccountCode,Total,AmountPaid,Status\nINV-1,Customer,01/10/2026,15/10/2026,Labour,2,100.00,OUTPUT,200,220.00,0,UNPAID';
const invoiceSpec = (text = invoice) =>
  spec('invoice', text, {
    priceBasis: 'exclusive',
    accounts: {200: '400'},
    taxes: {OUTPUT: 'gst'},
  });
test('import parser handles BOM, quoted commas, multiline values, dates and exact cents', () => {
  const t = readImportCsv('\uFEFFName,Notes\r\n"Smith, Jane","Line one\nLine two"');
  assert.equal(t.rows[0][0], 'Smith, Jane');
  assert.equal(t.rows[0][1], 'Line one\nLine two');
  assert.equal(importMoney('AUD 1,234.50'), 123450);
  assert.equal(importMoney('($55.10)'), -5510);
  assert.equal(importDate('8/10/2026'), '2026-10-08');
  for (const x of ['1.001', '1e5', '1,23.00']) assert.throws(() => importMoney(x));
  assert.throws(() => importDate('31/02/2026'));
  assert.throws(() => readImportCsv('Name,NAME\nx,y'));
  assert.throws(() => readImportCsv('A,B\n"missing,b'));
});
test('bank imports preserve signed cents and reject ambiguous mapping and locked dates', () => {
  const s = state(),
    p = makeImportPlan(spec('bank', bank), s, 'file');
  assert.equal(p.total, 5500);
  assert.equal(p.count, 2);
  assert.equal(p.errors.length, 0);
  s.settings.lockDate = '2026-10-01';
  assert.match(makeImportPlan(spec('bank', bank), s, 'file').errors.join(), /locked/);
  const mixed = 'Date,Description,Amount,Debit\n01/10/2026,Materials,-55.00,55.00';
  assert.match(makeImportPlan(spec('bank', mixed), state(), 'file').errors.join(), /OR/);
});
test('contact duplicates are skipped without overwriting existing details', () => {
  const s = state();
  s.events.push({
    id: 'a',
    kind: 'contact',
    createdAt: '',
    payload: {
      id: 'a',
      name: 'Existing',
      email: 'keep@example.com',
      role: 'customer',
      archived: false,
    },
  });
  const p = makeImportPlan(
    spec(
      'contacts',
      'Name,Email\nExisting,change@example.com\nNew,new@example.com\nNEW,other@example.com',
    ),
    s,
    'file',
  );
  assert.equal(p.count, 1);
  assert.equal(p.skipped.length, 2);
  assert.equal(p.contacts[0].email, 'new@example.com');
});
test('invoice preview requires explicit tax/account/GST basis and checks source totals', () => {
  const p = makeImportPlan(invoiceSpec(), state(), 'file');
  assert.deepEqual(p.errors, []);
  assert.equal(p.total, 22000);
  assert.equal(p.gst, 2000);
  assert.match(
    makeImportPlan({...invoiceSpec(), taxes: {}}, state(), 'file').errors.join(),
    /Map source/,
  );
  assert.match(
    makeImportPlan({...invoiceSpec(), priceBasis: 'unconfirmed'}, state(), 'file').errors.join(),
    /GST/,
  );
  assert.match(
    makeImportPlan(invoiceSpec(invoice.replace('220.00', '200.00')), state(), 'file').errors.join(),
    /total/,
  );
});
test('paid history and currency guards still apply when recognised columns are unmapped', () => {
  for (const text of [
    invoice.replace(',0,UNPAID', ',20,UNPAID'),
    invoice.replace(',0,UNPAID', ',0,PAID'),
    invoice.replace(',0,UNPAID', ',0,PARTIALLY PAID'),
  ]) {
    const p = invoiceSpec(text);
    p.columns.paid = -1;
    p.columns.status = -1;
    assert.match(makeImportPlan(p, state(), 'file').errors.join(), /Paid/);
  }
  const text = invoice.replace(',Status', ',Status,Currency').replace(',UNPAID', ',UNPAID,USD'),
    p = invoiceSpec(text);
  p.columns.currency = -1;
  assert.match(makeImportPlan(p, state(), 'file').errors.join(), /AUD/);
});
test('bank exact references skip, conflicting references fail and overlapping exports warn', () => {
  const s = state();
  s.events.push({
    id: 'b',
    kind: 'bank',
    createdAt: '',
    payload: {
      id: 'b',
      date: '2026-10-01',
      description: 'Materials',
      amount: -5500,
      account: '100',
      reference: 'ONE',
    },
  });
  let p = makeImportPlan(spec('bank', bank), s, 'file');
  assert.equal(p.skipped.length, 1);
  assert.equal(p.count, 1);
  p = makeImportPlan(spec('bank', bank.replace('-55.00', '-56.00')), s, 'file');
  assert.match(p.errors.join(), /different details/);
  p = makeImportPlan(spec('bank', bank.replace(',ONE', ',NEW')), s, 'file');
  assert.match(p.warnings.join(), /overlapping/);
});
test('trial balances are explicit account references and expose discrepancies', () => {
  const text = 'Account,Name,Debit,Credit\n090,Bank,100,0\n900,Equity,0,90',
    p = makeImportPlan(
      spec('trial_balance', text, {date: '2026-09-30', accounts: {'090': '100', 900: '300'}}),
      state(),
      'file',
    );
  assert.equal(p.count, 2);
  assert.equal(p.debits, 10000);
  assert.equal(p.credits, 9000);
  assert.match(p.warnings.join(), /out of balance/);
  assert.equal(p.documents.length, 0);
  assert.equal(p.banks.length, 0);
  assert.match(
    makeImportPlan({kind: 'reference', notes: ''}, state(), 'file').errors.join(),
    /Describe/,
  );
});
