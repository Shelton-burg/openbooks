import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cents,
  lineTotals,
  totals,
  documentJournal,
  balanced,
  derive,
  report,
  parseCsv,
  csv,
  dateSchema,
  validAbn,
} from '../lib/books.ts';
const invoice = {
  id: 'a',
  type: 'invoice',
  number: 'INV-1',
  contact: 'Customer',
  contactAddress: '',
  contactAbn: '',
  date: '2026-08-25',
  due: '2026-09-08',
  job: 'Drain repair',
  reference: '',
  notes: '',
  inclusive: false,
  lines: [{description: 'Labour', qty: '1', price: '500', tax: 'gst', account: '400'}],
};
const ev = (kind, payload) => ({id: kind, kind, payload, createdAt: '2026-09-01T00:00:00Z'});
const base = [ev('document', invoice), ev('post', {docId: 'a'})];
test('money parsing and invoice rounding have explicit cent values', () => {
  assert.equal(cents('0.01'), 1);
  assert.equal(cents('123.4'), 12340);
  assert.throws(() => cents('1.001'));
  assert.deepEqual(totals(invoice), {net: 50000, taxTotal: 5000, total: 55000});
  assert.deepEqual(lineTotals({...invoice.lines[0], price: '550'}, true), {
    net: 50000,
    tax: 5000,
    total: 55000,
  });
  assert.deepEqual(lineTotals({...invoice.lines[0], price: '12.35', qty: '1.5'}), {
    net: 1853,
    tax: 185,
    total: 2038,
  });
});
test('mixed GST lines and supplier bills always balance', () => {
  for (let i = 1; i <= 250; i++) {
    const d = {
      ...invoice,
      type: i % 2 ? 'invoice' : 'bill',
      inclusive: i % 3 === 0,
      lines: [
        {
          ...invoice.lines[0],
          account: i % 2 ? '400' : '500',
          qty: (i / 10).toFixed(2),
          price: (i * 1.27).toFixed(2),
        },
        {...invoice.lines[0], account: i % 2 ? '410' : '520', tax: 'free', price: '9.99'},
        {
          ...invoice.lines[0],
          account: i % 2 ? '420' : '530',
          tax: 'none',
          qty: '0.5',
          price: '12.15',
        },
      ],
    };
    assert.ok(balanced(documentJournal(d).lines));
    assert.ok(Number.isInteger(totals(d).total));
  }
});
test('drafts never affect income or ledger and posting creates receivables', () => {
  assert.equal(derive([base[0]]).journal.length, 0);
  const r = report(base, '2026-08-01', '2026-08-31', 'accrual');
  assert.equal(r.income, 50000);
  assert.equal(r.gstSales, 5000);
  assert.equal(r.trial.find((a) => a.code === '110').balance, 55000);
  assert.equal(
    r.trial.reduce((n, a) => n + a.balance, 0),
    0,
  );
});
test('payment clears receivable without double counting revenue; cash GST follows payment date', () => {
  const events = [...base, ev('settle', {docId: 'a', bankId: 'b', date: '2026-09-02'})];
  const august = report(events, '2026-08-01', '2026-08-31', 'cash'),
    september = report(events, '2026-09-01', '2026-09-30', 'cash');
  assert.equal(august.income, 50000);
  assert.equal(august.gstSales, 0);
  assert.equal(september.income, 0);
  assert.equal(september.gstSales, 5000);
  assert.equal(september.trial.find((a) => a.code === '110').balance, 0);
  assert.equal(september.trial.find((a) => a.code === '100').balance, 55000);
  assert.equal(derive(events).docs[0].status, 'paid');
});
test('supplier payment clears payable and records cash GST purchase', () => {
  const bill = {...invoice, type: 'bill', lines: [{...invoice.lines[0], account: '500'}]};
  const r = report(
    [
      ev('document', bill),
      ev('post', {docId: 'a'}),
      ev('settle', {docId: 'a', bankId: 'b', date: '2026-09-01'}),
    ],
    '2026-09-01',
    '2026-09-30',
    'cash',
  );
  assert.equal(r.trial.find((a) => a.code === '200').balance, 0);
  assert.equal(r.trial.find((a) => a.code === '100').balance, -55000);
  assert.equal(r.gstPurchases, 5000);
  assert.equal(
    r.trial.reduce((n, a) => n + a.balance, 0),
    0,
  );
});
test('reversal preserves original period and offsets current period', () => {
  const events = [
    ...base,
    ev('reverse', {docId: 'a', date: '2026-09-03', reason: 'Incorrect customer'}),
  ];
  const aug = report(events, '2026-08-01', '2026-08-31', 'accrual'),
    sep = report(events, '2026-09-01', '2026-09-30', 'accrual');
  assert.equal(aug.income, 50000);
  assert.equal(aug.gstSales, 5000);
  assert.equal(sep.income, -50000);
  assert.equal(sep.gstSales, -5000);
  assert.ok(sep.trial.every((a) => a.balance === 0));
  assert.equal(derive(events).docs[0].status, 'void');
});
test('CSV handles commas, quoted newlines and spreadsheet formula injection', () => {
  assert.deepEqual(parseCsv('Date,Description\r\n2026-09-01,"Parts, tools"\r\n'), [
    ['Date', 'Description'],
    ['2026-09-01', 'Parts, tools'],
  ]);
  assert.deepEqual(parseCsv('a,"b\nc"'), [['a', 'b\nc']]);
  assert.throws(() => parseCsv('a,"unfinished'));
  assert.equal(csv([['=HYPERLINK(1)', -1]]), '"\'=HYPERLINK(1)","-1"');
});
test('dates, ABNs, money overflow and unbalanced journals are rejected', () => {
  assert.equal(dateSchema.safeParse('2026-02-30').success, false);
  assert.equal(dateSchema.safeParse('2024-02-29').success, true);
  assert.ok(validAbn('51 824 753 556'));
  assert.equal(validAbn('12345678901'), false);
  assert.equal(
    balanced([
      {account: '100', debit: 1, credit: 0},
      {account: '300', debit: 0, credit: 2},
    ]),
    false,
  );
  assert.throws(() => lineTotals({...invoice.lines[0], qty: '100000', price: '10000000'}));
});
