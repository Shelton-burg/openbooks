import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bankFingerprint,
  derive,
  report,
  transferJournal,
  balanced,
  bankCodes,
} from '../lib/books.ts';
const xeroReference = {
  company: 'Fictional demo',
  banks: [{statementBalance: 100000, bookBalance: 8341}],
  cash: {in: 11000, out: 10000, net: 1000},
};
const ev = (kind, payload) => ({id: kind, kind, payload, createdAt: '2026-09-07T00:00:00Z'});
const payment = {
  id: 'incoming',
  account: '103',
  date: '2026-09-06',
  description: 'Customer payment',
  amount: 11000,
  reference: 'REF-1',
};
const doc = {
  id: 'doc-1',
  type: 'invoice',
  number: 'INV-TEST',
  contact: 'Customer',
  date: '2026-09-01',
  due: '2026-09-14',
  inclusive: false,
  lines: [{description: 'Labour', qty: '1', price: '100', tax: 'gst', account: '400'}],
};
test('screenshot reference never creates transactions, bank lines or ledger balances', () => {
  const events = [ev('xero_reference', xeroReference)],
    v = derive(events),
    r = report(events, '2026-07-01', '2026-09-30', 'cash');
  assert.equal(v.docs.length, 0);
  assert.equal(v.banks.length, 0);
  assert.equal(v.journal.length, 0);
  assert.equal(r.income, 0);
  assert.equal(r.expenses, 0);
  assert.ok(r.trial.every((a) => a.balance === 0));
  assert.equal(xeroReference.banks[0].statementBalance - xeroReference.banks[0].bookBalance, 91659);
  assert.equal(xeroReference.cash.in - xeroReference.cash.out, xeroReference.cash.net);
});
test('bank import references preserve legacy identity and are isolated per account', () => {
  assert.equal(bankFingerprint('100', 'REF-1'), 'bank:REF-1');
  const ids = bankCodes.map((c) => bankFingerprint(c, 'REF-1'));
  assert.equal(new Set(ids).size, 4);
  assert.notEqual(bankFingerprint('100', '101:REF-1'), bankFingerprint('101', 'REF-1'));
  assert.throws(() => bankFingerprint('110', 'REF-1'));
});
test('an invoice payment is credited to the chosen account, not always the primary bank', () => {
  const events = [
    ev('document', doc),
    ev('post', {docId: doc.id}),
    ev('bank', payment),
    ev('settle', {docId: doc.id, bankId: payment.id, date: payment.date, account: '103'}),
  ];
  const r = report(events, '2026-09-01', '2026-09-30', 'cash');
  assert.equal(r.trial.find((a) => a.code === '100').balance, 0);
  assert.equal(r.trial.find((a) => a.code === '103').balance, 11000);
  assert.equal(r.trial.find((a) => a.code === '110').balance, 0);
  assert.equal(r.gstSales, 1000);
  assert.equal(r.income, 10000);
});
test('legacy statement lines and settlements still use account 100', () => {
  const old = {...payment};
  delete old.account;
  const events = [
    ev('document', doc),
    ev('post', {docId: doc.id}),
    ev('bank', old),
    ev('settle', {docId: doc.id, bankId: old.id, date: old.date}),
  ];
  const r = report(events, '2026-09-01', '2026-09-30', 'cash');
  assert.equal(derive(events).banks[0].account, '100');
  assert.equal(r.trial.find((a) => a.code === '100').balance, 11000);
});
test('a transfer moves balances and reconciles both sides without income, expenses or GST', () => {
  const out = {...payment, id: 'out', account: '100', amount: -11000},
    incoming = {...payment, id: 'in', account: '102'};
  const journal = transferJournal(out, incoming);
  assert.ok(balanced(journal.lines));
  const events = [
    ev('bank', out),
    ev('bank', incoming),
    ev('transfer', {bankIds: [out.id, incoming.id], journal}),
    ev('transfer_link', {bankId: incoming.id}),
  ];
  const r = report(events, '2026-09-01', '2026-09-30', 'cash'),
    v = derive(events);
  assert.equal(r.trial.find((a) => a.code === '100').balance, -11000);
  assert.equal(r.trial.find((a) => a.code === '102').balance, 11000);
  assert.equal(r.income, 0);
  assert.equal(r.expenses, 0);
  assert.equal(r.gstSales, 0);
  assert.equal(r.gstPurchases, 0);
  assert.equal(v.usedBanks.size, 2);
  assert.equal(v.journal.length, 1);
  assert.equal(v.journal[0].source, 'transfer');
});
test('same-account, unequal, different-date and non-bank transfers are rejected', () => {
  const out = {...payment, id: 'out', account: '100', amount: -11000};
  assert.throws(() => transferJournal(out, {...payment, account: '100'}));
  assert.throws(() => transferJournal(out, {...payment, amount: 10000}));
  assert.throws(() => transferJournal(out, {...payment, date: '2026-09-07'}));
  assert.throws(() => transferJournal(out, {...payment, account: '110'}));
});
