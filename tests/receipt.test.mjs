import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {receiptSchema, receiptDraft} from '../lib/receipt.ts';
const receipt = {
  supplier: 'Bunnings',
  abn: '',
  address: '',
  reference: 'R123',
  date: '2026-09-08',
  due: null,
  currency: 'AUD',
  total: 1100,
  gst: 100,
  lines: [{description: 'Pipe fittings', gross: 1100, tax: 'gst'}],
  warnings: [],
};
const doc = {
  id: crypto.randomUUID(),
  type: 'bill',
  number: 'BILL-1001',
  contactId: crypto.randomUUID(),
  contact: 'Old',
  date: '2026-01-01',
  due: '2026-01-14',
  lines: [],
  inclusive: false,
};
test('receipt application preserves identity and uses inclusive cents without assuming payment', () => {
  const r = receiptDraft(doc, receipt, true);
  assert.equal(r.document.number, doc.number);
  assert.equal(r.document.id, doc.id);
  assert.equal(r.document.contactId, undefined);
  assert.equal(r.document.reference, 'R123');
  assert.equal(r.document.lines[0].price, '11.00');
  assert.equal(r.document.inclusive, true);
  assert.equal(r.document.paid, undefined);
  assert.ok(r.warnings.some((s) => s.includes('due date')));
});
test('unreadable dates and unknown tax remain explicit, totals discrepancies are flagged', () => {
  const r = receiptDraft(
    doc,
    {...receipt, date: null, total: 1200, lines: [{...receipt.lines[0], tax: 'unknown'}]},
    true,
  );
  assert.equal(r.document.date, '');
  assert.equal(r.document.lines[0].tax, 'none');
  assert.ok(r.warnings.some((s) => s.includes('do not match')));
  assert.ok(r.warnings.some((s) => s.includes('GST differs')));
  assert.equal(receiptDraft(doc, receipt, false).document.lines[0].tax, 'none');
  assert.equal(receiptSchema.safeParse({...receipt, date: '2026-02-30'}).success, false);
  assert.equal(receiptSchema.safeParse({...receipt, currency: 'USD'}).success, false);
});
let source = readFileSync(new URL('../app/api/receipt-scan/route.ts', import.meta.url), 'utf8')
  .replace("import {withWorkspace} from '@/server/auth';", 'const withWorkspace=(fn)=>fn;')
  .replace("from '@/server/auth'", "from 'next/headers'")
  .replace("from '@/server/storage'", "from 'cloudflare:workers'")
  .replace(
    "import {headers} from 'next/headers';",
    'const headers=async()=>new Headers(globalThis.receiptHeaders);',
  )
  .replace(
    "import {env} from 'cloudflare:workers';",
    'const env={get OPENAI_API_KEY(){return globalThis.receiptKey;}};',
  )
  .replace("from '@/lib/receipt'", `from '${new URL('../lib/receipt.ts', import.meta.url).href}'`);
const code = ts.transpileModule(source, {
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext},
}).outputText;
const api = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const request = (content = '%PDF-1.4 test', origin = 'https://books.test') => {
  const f = new FormData();
  f.append('file', new Blob([content]), 'receipt.pdf');
  return new Request('https://books.test/api/receipt-scan', {
    method: 'POST',
    headers: {origin},
    body: f,
  });
};
test('scan endpoint protects access and reports a missing connection without calling AI', async () => {
  globalThis.receiptHeaders = {};
  assert.equal((await api.GET()).status, 401);
  assert.equal((await api.POST(request())).status, 401);
  globalThis.receiptHeaders = {'oai-authenticated-user-id': 'a'};
  globalThis.receiptKey = '';
  assert.equal((await api.POST(request('', 'https://evil.test'))).status, 403);
  assert.equal((await api.POST(request())).status, 503);
  assert.deepEqual(await (await api.GET()).json(), {configured: false});
});
test('scan endpoint checks file signature, sends PDF privately and rejects invalid extraction', async () => {
  globalThis.receiptHeaders = {'oai-authenticated-user-id': 'a'};
  globalThis.receiptKey = 'test-only';
  assert.equal((await api.POST(request('not a PDF'))).status, 400);
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const body = JSON.parse(options.body);
      assert.equal(body.store, false);
      assert.equal(body.input[0].content[1].type, 'input_file');
      return Response.json({
        status: 'completed',
        output: [{content: [{type: 'output_text', text: JSON.stringify(receipt)}]}],
      });
    };
    assert.deepEqual((await (await api.POST(request())).json()).receipt, receipt);
    globalThis.fetch = async () =>
      Response.json({
        status: 'completed',
        output: [{content: [{type: 'output_text', text: '{"currency":"USD"}'}]}],
      });
    assert.equal((await api.POST(request())).status, 422);
  } finally {
    globalThis.fetch = original;
  }
});
