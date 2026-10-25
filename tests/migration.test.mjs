import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultSettings, totals} from '../lib/books.ts';
import {inspectDocumentCSV, documentImport} from '../lib/migration.ts';
const state = {events: [], settings: {...defaultSettings, name: 'Test', gst: 'yes'}},
  header =
    '*ContactName,*InvoiceNumber,*InvoiceDate,*DueDate,Description,Quantity,UnitAmount,TaxType,AccountCode,Reference',
  row = 'Customer,INV-1,01/09/2026,15/09/2026,Labour,1,100.00,OUTPUT,200,Job1',
  mapping = {accounts: {200: '400'}, taxes: {OUTPUT: 'gst'}};
test('import groups line items, accepts reviewed Xero-style headings and keeps account mappings explicit', () => {
  const text = header + '\n' + row + '\n' + row.replace('Labour', 'Materials');
  const i = inspectDocumentCSV(text);
  assert.deepEqual(i.accounts, ['200']);
  assert.throws(
    () => documentImport(text, state, 'invoice', false, {accounts: {}, taxes: {}}),
    /Map every/,
  );
  const docs = documentImport(text, state, 'invoice', false, mapping);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].lines.length, 2);
  assert.equal(docs[0].date, '2026-09-01');
  assert.equal(totals(docs[0]).total, 22000);
  assert.equal(docs[0].lines[0].account, '400');
});
test('import refuses invalid dates, conflicting headers and source account collisions', () => {
  for (const text of [
    header + '\n' + row.replace('01/09/2026', '31/02/2026'),
    header + '\n' + row + '\n' + row.replace('Customer', 'Other customer'),
  ])
    assert.throws(() => documentImport(text, state, 'invoice', false, mapping));
  assert.throws(
    () =>
      documentImport(header + '\n' + row, state, 'invoice', false, {
        accounts: {200: '200'},
        taxes: {OUTPUT: 'gst'},
      }),
    /valid income/,
  );
});
test('imports do not silently discard payment history or duplicate existing documents', () => {
  assert.throws(() => inspectDocumentCSV(header + ',AmountPaid\n' + row + ',50'), /payments/);
  assert.throws(
    () => inspectDocumentCSV(header + ',Total,AmountDue\n' + row + ',110,60'),
    /payments/,
  );
  const d = documentImport(header + '\n' + row, state, 'invoice', false, mapping)[0];
  assert.throws(
    () =>
      documentImport(
        header + '\n' + row,
        {...state, events: [{id: 'e', kind: 'document', payload: d, createdAt: ''}]},
        'invoice',
        false,
        mapping,
      ),
    /already exists/,
  );
});
