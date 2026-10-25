import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {verifyBackup, zipEntries, financialSummary} from '../lib/backup.ts';
import {spawnSync} from 'node:child_process';
import {defaultSettings, derive, report, today} from '../lib/books.ts';
const root = new URL('../', import.meta.url);
const moduleOverrides = {};
function transpile(path, replacements = {}) {
  let source = readFileSync(new URL(path, root), 'utf8')
    .replace("import {withWorkspace} from '@/server/auth';", 'const withWorkspace=(fn)=>fn;')
    .replace("from '@/server/auth'", "from 'next/headers'")
    .replace("from '@/server/storage'", "from 'cloudflare:workers'")
    .replace(
      "import { headers } from 'next/headers';",
      'const headers=async()=>new Headers(globalThis.__booksTest.headers);',
    )
    .replace(
      "import {headers} from 'next/headers';",
      'const headers=async()=>new Headers(globalThis.__booksTest.headers);',
    )
    .replace("import { db } from '@/db';", 'const db=()=>globalThis.__booksTest.database;')
    .replace("import {db} from '@/db';", 'const db=()=>globalThis.__booksTest.database;')
    .replace(
      "import {env} from 'cloudflare:workers';",
      "const env=new Proxy({},{get:(_,key)=>key==='BUCKET'?globalThis.__booksTest.bucket:globalThis.__booksTest.config?.[key]});",
    );
  for (const [a, b] of Object.entries({...moduleOverrides, ...replacements}))
    source = source.replace(a, b);
  source = source.replace(
    /from '(?:@\/)([^']+)'/g,
    (_, p) => `from '${new URL(p + '.ts', root).href}'`,
  );
  source = source.replace("from 'zod'", `from '${import.meta.resolve('zod')}'`);
  const code = ts.transpileModule(source, {
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext},
  }).outputText;
  return 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
}
moduleOverrides["from '@/server/books-state'"] =
  "from '" + transpile('server/books-state.ts') + "'";
const apiURL = transpile('app/api/books/route.ts'),
  api = await import(apiURL),
  attachments = await import(
    transpile('app/api/attachments/route.ts', {"from '../books/route'": `from '${apiURL}'`})
  );
const backup = await import(
  transpile('app/api/backup/route.ts', {"from '../books/route'": `from '${apiURL}'`})
);
const recoveryURL = transpile('server/recovery.ts', {
  "from '@/app/api/books/route'": `from '${apiURL}'`,
});
const recovery = await import(
  transpile('app/api/recovery/route.ts', {
    "from '@/server/recovery'": `from '${recoveryURL}'`,
    "from '../books/route'": `from '${apiURL}'`,
  })
);

const email = await import(
  transpile('app/api/email/route.ts', {"from '../books/route'": `from '${apiURL}'`})
);

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('drizzle/0000_woozy_winter_soldier.sql', root), 'utf8'));
  const wrap = (query, args = []) => ({
    bind(...values) {
      return wrap(query, values);
    },
    async all() {
      return {results: sql.prepare(query).all(...args)};
    },
    async first() {
      return sql.prepare(query).get(...args) || null;
    },
    async run() {
      const r = sql.prepare(query).run(...args);
      return {success: true, meta: {changes: r.changes}};
    },
  });
  let queue = Promise.resolve();
  const database = {
    prepare: (query) => wrap(query),
    batch(queries) {
      const task = queue.then(async () => {
        sql.exec('BEGIN');
        try {
          const result = [];
          for (const q of queries) result.push(await q.run());
          sql.exec('COMMIT');
          return result;
        } catch (e) {
          sql.exec('ROLLBACK');
          throw e;
        }
      });
      queue = task.catch(() => {});
      return task;
    },
  };
  const objects = new Map();
  const bucket = {
    async put(key, bytes) {
      objects.set(key, bytes);
    },
    async get(key) {
      const data = objects.get(key);
      return data ? {body: data, size: data.byteLength, arrayBuffer: async () => data} : null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
  globalThis.__booksTest = {
    database,
    bucket,
    headers: {
      'oai-authenticated-user-id': 'owner-a',
      'oai-authenticated-user-email': 'test@example.test',
    },
  };
  return {sql, objects};
}
const read = async () => {
  const r = await api.GET();
  return r.json();
};
async function send(body, extra = {}) {
  const state = await read();
  return api.POST(
    new Request('https://books.example/api/books', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', origin: 'https://books.example'},
      body: JSON.stringify({revision: state.events?.at(-1)?.id || 'empty', ...body, ...extra}),
    }),
  );
}
async function ok(body) {
  const res = await send(body);
  const data = await res.json();
  assert.equal(res.status, 200, data.error);
  return data;
}
const configure = () =>
  ok({
    action: 'settings',
    settings: {...defaultSettings, name: 'Test Plumbing', gst: 'no', gstBasis: 'cash'},
  });
const document = (type = 'invoice', price = '100', id = crypto.randomUUID()) => ({
  id,
  type,
  number: crypto.randomUUID(),
  contact: 'Test contact',
  contactAddress: '',
  contactAbn: '',
  date: '2026-09-01',
  due: '2026-09-15',
  inclusive: false,
  job: 'Test job',
  lines: [
    {
      description: 'Labour',
      qty: '1',
      price,
      tax: 'none',
      account: ['invoice', 'quote'].includes(type) ? '400' : '500',
    },
  ],
});
async function posted(price = '100') {
  const doc = document('invoice', price);
  await ok({action: 'document', document: doc});
  await ok({action: 'post', id: doc.id});
  return doc;
}
async function imported(amount = 10000, reference = crypto.randomUUID()) {
  const s = await ok({
    action: 'importBank',
    account: '100',
    rows: [{date: '2026-09-02', description: 'Test payment', amount, reference}],
  });
  return derive(s.events).banks.find((b) => b.reference === reference);
}
test('API requires authentication, rejects cross-origin writes and isolates owners', async () => {
  fixture();
  globalThis.__booksTest.headers = {};
  assert.equal((await api.GET()).status, 401);
  globalThis.__booksTest.headers = {'oai-authenticated-user-id': 'owner-a'};
  await configure();
  await posted();
  const cross = await api.POST(
    new Request('https://books.example/api/books', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', origin: 'https://evil.example'},
      body: '{}',
    }),
  );
  assert.equal(cross.status, 403);
  globalThis.__booksTest.headers = {'oai-authenticated-user-id': 'owner-b'};
  assert.equal((await read()).events.length, 0);
});
test('quote lifecycle converts exactly once and does not post before review', async () => {
  fixture();
  await configure();
  const q = document('quote');
  await ok({action: 'document', document: q});
  assert.equal((await send({action: 'post', id: q.id})).status, 400);
  await ok({action: 'workflowStatus', id: q.id, status: 'issued'});
  await ok({action: 'workflowStatus', id: q.id, status: 'accepted'});
  const s = await ok({action: 'convert', id: q.id, date: '2026-09-02', due: '2026-09-16'});
  const v = derive(s.events);
  assert.equal(v.docs.length, 2);
  assert.equal(v.journal.length, 0);
  assert.equal(v.docs[0].status, 'converted');
  assert.equal(v.docs[1].type, 'invoice');
  assert.equal(
    (await send({action: 'convert', id: q.id, date: '2026-09-02', due: '2026-09-16'})).status,
    400,
  );
  await ok({action: 'post', id: v.docs[1].id});
  assert.equal(report((await read()).events, '2026-09-01', '2026-09-30', 'cash').income, 10000);
});
test('purchase order conversion retains its source and creates a bill draft', async () => {
  fixture();
  await configure();
  const q = document('purchase_order');
  await ok({action: 'document', document: q});
  await ok({action: 'workflowStatus', id: q.id, status: 'issued'});
  const s = await ok({action: 'convert', id: q.id, date: '2026-09-02', due: '2026-09-16'});
  const v = derive(s.events);
  assert.equal(v.docs[1].type, 'bill');
  assert.equal(v.docs[1].reference, q.number);
  assert.equal(v.docs[1].status, 'draft');
  assert.equal(v.journal.length, 0);
});
test('draft edits preserve identity and posting prevents subsequent edits', async () => {
  fixture();
  await configure();
  const doc = document();
  await ok({action: 'document', document: doc});
  const edited = {...doc, lines: [{...doc.lines[0], price: '220'}]};
  await ok({action: 'editDocument', document: edited});
  await ok({action: 'post', id: doc.id});
  assert.equal(derive((await read()).events).docs[0].total, 22000);
  assert.equal((await send({action: 'editDocument', document: doc})).status, 400);
});
test('partial payment cannot be allocated twice or reverse a partly paid invoice', async () => {
  fixture();
  await configure();
  const d = await posted(),
    b = await imported(4000);
  await ok({action: 'payment', bankId: b.id, allocations: [{docId: d.id, amount: 4000}]});
  assert.equal(derive((await read()).events).docs[0].balance, 6000);
  assert.equal(
    (await send({action: 'payment', bankId: b.id, allocations: [{docId: d.id, amount: 4000}]}))
      .status,
    400,
  );
  assert.equal(
    (await send({action: 'reverse', id: d.id, date: '2026-09-03', reason: 'Wrong invoice'})).status,
    400,
  );
});
test('concurrent payment writes cannot both consume the same outstanding balance', async () => {
  fixture();
  await configure();
  const d = await posted(),
    a = await imported(7000),
    b = await imported(7000),
    s = await read(),
    revision = s.events.at(-1).id;
  const results = await Promise.all([
    send({action: 'payment', bankId: a.id, allocations: [{docId: d.id, amount: 7000}]}, {revision}),
    send({action: 'payment', bankId: b.id, allocations: [{docId: d.id, amount: 7000}]}, {revision}),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const v = derive((await read()).events);
  assert.equal(v.docs[0].balance, 3000);
  assert.equal(v.usedBanks.size, 1);
});
test('locked periods and opening-date boundaries apply to new ledger postings', async () => {
  fixture();
  await configure();
  await ok({
    action: 'opening',
    date: '2026-08-31',
    lines: [
      {account: '100', debit: 10000, credit: 0},
      {account: '300', debit: 0, credit: 10000},
    ],
  });
  const old = {...document(), date: '2026-08-20', due: '2026-08-30'};
  await ok({action: 'document', document: old});
  assert.equal((await send({action: 'post', id: old.id})).status, 400);
  const s = await read();
  await ok({action: 'settings', settings: {...s.settings, lockDate: '2026-09-05'}});
  assert.equal(
    (
      await send({
        action: 'manualJournal',
        journal: {
          date: '2026-09-02',
          reference: 'ADJ',
          description: 'Test adjustment',
          lines: [
            {account: '500', debit: 100, credit: 0},
            {account: '590', debit: 0, credit: 100},
          ],
        },
      })
    ).status,
    400,
  );
  assert.equal(
    (await send({action: 'settings', settings: {...s.settings, lockDate: ''}})).status,
    400,
  );
});
test('duplicate CSV imports are atomic and leave no partial records', async () => {
  fixture();
  await configure();
  await imported(10000, 'FIRST');
  const before = (await read()).events.length;
  assert.equal(
    (
      await send({
        action: 'importBank',
        account: '100',
        rows: [
          {date: '2026-09-02', description: 'New row', amount: 10, reference: 'NEW'},
          {date: '2026-09-02', description: 'Duplicate', amount: 10000, reference: 'FIRST'},
        ],
      })
    ).status,
    409,
  );
  const after = await read();
  assert.equal(after.events.length, before);
  assert.equal(derive(after.events).banks.length, 1);
});
test('contact import validation rolls back duplicate names and preserves user data', async () => {
  fixture();
  await configure();
  const c = {
    id: crypto.randomUUID(),
    name: 'Supplier',
    role: 'supplier',
    email: '',
    phone: '',
    address: '',
    abn: '',
    notes: '',
    termsDays: 14,
    contractor: true,
    archived: false,
  };
  await ok({action: 'importContacts', rows: [c]});
  assert.equal(
    (
      await send({
        action: 'importContacts',
        rows: [
          {...c, id: crypto.randomUUID(), name: 'New'},
          {...c, id: crypto.randomUUID()},
        ],
      })
    ).status,
    400,
  );
  assert.equal((await read()).events.filter((e) => e.kind === 'contact').length, 1);
});
test('attachments stay private and successful downloads preserve uploaded bytes', async () => {
  const {objects} = fixture();
  await configure();
  const doc = await posted();
  const s = await read(),
    id = crypto.randomUUID(),
    form = new FormData();
  form.append('id', id);
  form.append('target', doc.id);
  form.append('revision', s.events.at(-1).id);
  form.append(
    'file',
    new Blob(['%PDF-1.4\nTest fixture'], {type: 'application/pdf'}),
    'invoice.pdf',
  );
  const upload = await attachments.POST(
    new Request('https://books.example/api/attachments', {
      method: 'POST',
      headers: {origin: 'https://books.example'},
      body: form,
    }),
  );
  const data = await upload.json();
  assert.equal(upload.status, 200, data.error);
  assert.equal(objects.size, 1);
  const download = await attachments.GET(
    new Request('https://books.example/api/attachments?id=' + id),
  );
  assert.equal(download.status, 200);
  assert.equal(await download.text(), '%PDF-1.4\nTest fixture');
  assert.match(download.headers.get('Content-Disposition'), /^attachment/);
  globalThis.__booksTest.headers = {'oai-authenticated-user-id': 'owner-b'};
  assert.equal(
    (await attachments.GET(new Request('https://books.example/api/attachments?id=' + id))).status,
    404,
  );
});
test('attachment validation rejects executable text and missing record targets', async () => {
  const {objects} = fixture();
  await configure();
  const doc = await posted();
  for (const [target, content, expected] of [
    [doc.id, '<script>alert(1)</script>', 400],
    ['missing', '%PDF-1.4', 404],
  ]) {
    const s = await read(),
      f = new FormData();
    f.append('id', crypto.randomUUID());
    f.append('target', target);
    f.append('revision', s.events.at(-1).id);
    f.append('file', new Blob([content], {type: 'application/pdf'}), 'file.pdf');
    assert.equal(
      (
        await attachments.POST(
          new Request('https://books.example/api/attachments', {method: 'POST', body: f}),
        )
      ).status,
      expected,
    );
  }
  assert.equal(objects.size, 0);
});

const gstConfigure = () =>
  ok({
    action: 'settings',
    settings: {
      ...defaultSettings,
      name: 'Test Plumbing',
      abn: '51824753556',
      gst: 'yes',
      gstBasis: 'accrual',
      entityType: 'company',
      taxSetupConfirmed: true,
    },
  });
const purchaseReview = (target) => ({
  target,
  businessBps: 10000,
  creditableBps: 10000,
  evidence: 'tax_invoice',
  evidenceReference: 'Supplier evidence.pdf',
  evidenceDate: '2026-09-01',
  supplierAbn: '51824753556',
  supplierGstConfirmed: true,
  eligibilityConfirmed: true,
  tpar: 'unreviewed',
  reason: 'Reviewed tax invoice and business use.',
});
async function postedBill() {
  const d = {
    ...document('bill'),
    lines: [{description: 'Supplies', qty: '1', price: '100', tax: 'gst', account: '500'}],
  };
  await ok({action: 'document', document: d});
  await ok({action: 'post', id: d.id});
  return d;
}
test('GST basis cannot silently reinterpret posted books and setup cannot be falsely confirmed', async () => {
  fixture();
  assert.equal(
    (await send({action: 'settings', settings: {...defaultSettings, taxSetupConfirmed: true}}))
      .status,
    400,
  );
  await gstConfigure();
  await postedBill();
  const s = await read();
  assert.equal(
    (await send({action: 'settings', settings: {...s.settings, gstBasis: 'cash'}})).status,
    400,
  );
  assert.equal((await read()).settings.gstBasis, 'accrual');
});
test('purchase evidence reviews validate target, eligibility and supplier linkage on the server', async () => {
  fixture();
  await gstConfigure();
  const d = await postedBill();
  for (const r of [
    purchaseReview('missing'),
    {...purchaseReview(d.id), businessBps: 5000},
    {...purchaseReview(d.id), evidence: 'small_purchase'},
    {...purchaseReview(d.id), supplierGstConfirmed: false},
    {...purchaseReview(d.id), tpar: 'include'},
  ])
    assert.equal((await send({action: 'purchaseReview', review: r})).status, 400);
  const s = await ok({
    action: 'purchaseReview',
    review: {...purchaseReview(d.id), creditableBps: 7000},
  });
  assert.equal(s.events.filter((e) => e.kind === 'purchase_review').length, 1);
  assert.equal(report(s.events, '2026-09-01', '2026-09-30', 'accrual').gstPurchases, 1000);
  globalThis.__booksTest.headers = {'oai-authenticated-user-id': 'owner-b'};
  assert.equal((await send({action: 'purchaseReview', review: purchaseReview(d.id)})).status, 400);
});
test('period packs are computed by the server, preserved after edits and private to the owner', async () => {
  fixture();
  await gstConfigure();
  const d = await postedBill();
  await ok({action: 'purchaseReview', review: purchaseReview(d.id)});
  const snapshot = {
    from: '2026-09-01',
    to: '2026-09-30',
    notes: 'Reconcile this period with Xero.',
    comparison: {
      source: 'Xero reports',
      bank: null,
      profit: -10000,
      gstSales: 0,
      gstPurchases: 950,
    },
    gst: {reviewedPurchases: 999999},
  };
  const s = await ok({action: 'taxSnapshot', snapshot}),
    pack = s.events.find((e) => e.kind === 'tax_snapshot');
  assert.equal(pack.payload.gst.reviewedPurchases, 1000);
  assert.equal(pack.payload.comparison.find((x) => x.key === 'gstPurchases').difference, 50);
  await ok({action: 'purchaseReview', review: {...purchaseReview(d.id), creditableBps: 5000}});
  assert.deepEqual(
    (await read()).events.find((e) => e.id === pack.id),
    pack,
  );
  assert.equal(
    (await send({action: 'taxSnapshot', snapshot: {...snapshot, from: '2026-10-01'}})).status,
    400,
  );
  globalThis.__booksTest.headers = {'oai-authenticated-user-id': 'owner-b'};
  assert.equal((await read()).events.filter((e) => e.kind === 'tax_snapshot').length, 0);
});

async function bankOn(amount, date) {
  const reference = crypto.randomUUID();
  const s = await ok({
    action: 'importBank',
    account: '100',
    rows: [{date, description: 'Refund or deposit', amount, reference}],
  });
  return derive(s.events).banks.find((b) => b.reference === reference);
}
const creditInput = (docId, value = 4000) => ({
  id: crypto.randomUUID(),
  docId,
  number: crypto.randomUUID(),
  amount: value,
  date: '2026-09-03',
  reason: 'Agreed price reduction with customer.',
  supplierReference: '',
});
test('credit posting and original allocation commit atomically and prevent reversing the source', async () => {
  fixture();
  await configure();
  const d = await posted(),
    c = creditInput(d.id);
  const s = await ok({action: 'creditNote', credit: c});
  const v = derive(s.events);
  assert.equal(v.docs[0].balance, 6000);
  assert.equal(v.credits[0].balance, 0);
  assert.equal(
    (await send({action: 'reverse', id: d.id, date: '2026-09-04', reason: 'Attempt reversal'}))
      .status,
    400,
  );
  assert.equal((await send({action: 'creditNote', credit: c})).status, 409);
  assert.equal(derive((await read()).events).docs[0].balance, 6000);
});
test('concurrent credits cannot both exceed the original sale', async () => {
  fixture();
  await configure();
  const d = await posted(),
    revision = (await read()).events.at(-1).id;
  const r = await Promise.all([
    send({action: 'creditNote', credit: creditInput(d.id, 7000)}, {revision}),
    send({action: 'creditNote', credit: creditInput(d.id, 7000)}, {revision}),
  ]);
  assert.deepEqual(r.map((x) => x.status).sort(), [200, 409]);
  const v = derive((await read()).events);
  assert.equal(v.docs[0].balance, 3000);
  assert.equal(v.credits.length, 1);
});
test('customer refunds consume available credit and one bank line only', async () => {
  fixture();
  await configure();
  const d = await posted(),
    p = await imported();
  await ok({action: 'payment', bankId: p.id, allocations: [{docId: d.id, amount: 10000}]});
  const c = creditInput(d.id);
  await ok({action: 'creditNote', credit: c});
  const b = await bankOn(-4000, '2026-09-04');
  const s = await ok({action: 'creditRefund', creditId: c.id, bankId: b.id});
  assert.equal(derive(s.events).credits[0].balance, 0);
  assert.equal((await send({action: 'creditRefund', creditId: c.id, bankId: b.id})).status, 400);
  globalThis.__booksTest.headers = {'oai-authenticated-user-id': 'owner-b'};
  assert.equal((await send({action: 'creditRefund', creditId: c.id, bankId: b.id})).status, 400);
});
test('customer funds use saved contacts and cannot be spent twice or bypass locked dates', async () => {
  fixture();
  await configure();
  const c = {
    id: crypto.randomUUID(),
    name: 'Customer',
    role: 'customer',
    email: '',
    phone: '',
    address: '',
    abn: '',
    notes: '',
    termsDays: 14,
    contractor: false,
    archived: false,
  };
  await ok({action: 'contact', record: c});
  const b = await bankOn(15000, '2026-09-02'),
    f = {
      id: crypto.randomUUID(),
      bankId: b.id,
      contactId: c.id,
      kind: 'overpayment',
      tax: 'none',
      reference: 'Customer account',
      reason: 'Refundable excess payment by mistake.',
      confirmed: true,
    };
  await ok({action: 'customerFund', fund: f});
  assert.equal(
    (await send({action: 'customerFund', fund: {...f, id: crypto.randomUUID()}})).status,
    400,
  );
  const d = {...document(), contactId: c.id, contact: c.name};
  await ok({action: 'document', document: d});
  await ok({action: 'post', id: d.id});
  const s = await ok({
    action: 'applyFund',
    fundId: f.id,
    docId: d.id,
    amount: 10000,
    date: '2026-09-03',
  });
  assert.equal(derive(s.events).funds[0].balance, 5000);
  assert.equal(derive(s.events).docs[0].balance, 0);
  await ok({action: 'settings', settings: {...s.settings, lockDate: '2026-09-04'}});
  assert.equal(
    (await send({action: 'applyFund', fundId: f.id, docId: d.id, amount: 1, date: '2026-09-03'}))
      .status,
    400,
  );
});
test('bulk document import is draft-only, atomic on conflicts, and validates every account', async () => {
  fixture();
  await configure();
  const a = document(),
    b = document('bill');
  let s = await ok({action: 'importDocuments', documents: [a, b]});
  assert.equal(derive(s.events).docs.length, 2);
  assert.equal(derive(s.events).journal.length, 0);
  assert.equal((await send({action: 'importDocuments', documents: [document(), a]})).status, 400);
  assert.equal(
    (
      await send({
        action: 'importDocuments',
        documents: [
          {
            ...document(),
            lines: [
              {
                description: 'Wrong control account',
                qty: '1',
                price: '100',
                tax: 'none',
                account: '220',
              },
            ],
          },
        ],
      })
    ).status,
    400,
  );
  assert.equal(derive((await read()).events).docs.length, 2);
});
test('complete backup includes private original bytes and is readable by an independent ZIP implementation', async () => {
  fixture();
  await configure();
  const d = await posted(),
    s = await read(),
    id = crypto.randomUUID(),
    form = new FormData();
  form.append('id', id);
  form.append('target', d.id);
  form.append('revision', s.events.at(-1).id);
  form.append(
    'file',
    new Blob(['%PDF-1.4\nOriginal evidence'], {type: 'application/pdf'}),
    'receipt.pdf',
  );
  assert.equal(
    (
      await attachments.POST(
        new Request('https://books.example/api/attachments', {method: 'POST', body: form}),
      )
    ).status,
    200,
  );
  const r = await backup.GET();
  assert.equal(r.status, 200);
  const bytes = await r.arrayBuffer(),
    result = await verifyBackup(new Blob([bytes]));
  assert.equal(result.summary.attachments, 1);
  assert.equal(result.summary.documents, 1);
  const independent = spawnSync(
    'python',
    [
      '-c',
      "import io,sys,zipfile,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; m=json.loads(z.read('manifest.json')); assert len(m['files'])==2; assert any(z.read(n)==b'%PDF-1.4\\nOriginal evidence' for n in z.namelist() if n.startswith('attachments/')); print('zip verified')",
    ],
    {input: Buffer.from(bytes), encoding: 'utf8'},
  );
  assert.equal(independent.status, 0, independent.stderr);
  globalThis.__booksTest.headers = {'oai-authenticated-user-id': 'owner-b'};
  assert.equal(
    (await verifyBackup(new Blob([await (await backup.GET()).arrayBuffer()]))).summary.documents,
    0,
  );
  globalThis.__booksTest.headers = {};
  assert.equal((await backup.GET()).status, 401);
});
test('backup verification rejects damaged, truncated and missing attachment data', async () => {
  const {objects} = fixture();
  await configure();
  await posted();
  const response = await backup.GET(),
    bytes = new Uint8Array(await response.arrayBuffer()),
    entries = await zipEntries(new Blob([bytes])),
    damaged = bytes.slice();
  damaged[entries[0].offset + 10] ^= 1;
  await assert.rejects(() => verifyBackup(new Blob([damaged])), /checksum/);
  await assert.rejects(() => verifyBackup(new Blob([bytes.slice(0, -4)])), /incomplete/);
  const directoryDamaged = bytes.slice(),
    end = new DataView(bytes.buffer, bytes.length - 22),
    central = end.getUint32(16, true);
  directoryDamaged[central + 16] ^= 1;
  await assert.rejects(() => verifyBackup(new Blob([directoryDamaged])), /directory/);
  assert.equal(objects.size, 0);
});

test('a missing stored receipt prevents a supposedly complete backup from finishing', async () => {
  const {objects} = fixture();
  await configure();
  const d = await posted(),
    s = await read(),
    f = new FormData();
  f.append('id', crypto.randomUUID());
  f.append('target', d.id);
  f.append('revision', s.events.at(-1).id);
  f.append('file', new Blob(['%PDF-1.4 receipt'], {type: 'application/pdf'}), 'receipt.pdf');
  assert.equal(
    (
      await attachments.POST(
        new Request('https://books.example/api/attachments', {method: 'POST', body: f}),
      )
    ).status,
    200,
  );
  objects.clear();
  const r = await backup.GET();
  await assert.rejects(() => r.arrayBuffer(), /Incomplete backup/);
});

test('one invoice overpayment clears the invoice and retains only the verified excess atomically', async () => {
  fixture();
  await configure();
  const c = {
    id: crypto.randomUUID(),
    name: 'Saved customer',
    role: 'customer',
    email: '',
    phone: '',
    address: '',
    abn: '',
    notes: '',
    termsDays: 14,
    contractor: false,
    archived: false,
  };
  await ok({action: 'contact', record: c});
  const d = {...document(), contactId: c.id, contact: c.name};
  await ok({action: 'document', document: d});
  await ok({action: 'post', id: d.id});
  const b = await imported(15000);
  assert.equal(
    (
      await send({
        action: 'payment',
        bankId: b.id,
        allocations: [{docId: d.id, amount: 5000}],
        retainExcess: true,
      })
    ).status,
    400,
  );
  const s = await ok({
    action: 'payment',
    bankId: b.id,
    allocations: [{docId: d.id, amount: 10000}],
    retainExcess: true,
  });
  const v = derive(s.events);
  assert.equal(v.docs[0].balance, 0);
  assert.equal(v.funds[0].balance, 5000);
  assert.equal(
    report(s.events, '2026-09-01', '2026-09-30', 'cash').trial.find((a) => a.code === '100')
      .balance,
    15000,
  );
  assert.equal(v.usedBanks.size, 1);
});
test('capital equipment purchases post to assets and enter purchase GST review without becoming operating expenses', async () => {
  fixture();
  await gstConfigure();
  const d = {
    ...document('bill'),
    lines: [
      {description: 'Equipment purchase', qty: '1', price: '1000', tax: 'gst', account: '150'},
    ],
  };
  await ok({action: 'document', document: d});
  const s = await ok({action: 'post', id: d.id});
  const r = report(s.events, '2026-09-01', '2026-09-30', 'accrual');
  assert.equal(r.expenses, 0);
  assert.equal(r.trial.find((a) => a.code === '150').balance, 100000);
  assert.equal(r.gstPurchases, 10000);
  await ok({action: 'purchaseReview', review: purchaseReview(d.id)});
});

test('unmatching a payment restores balances and permits a corrected match without duplicate tax', async () => {
  fixture();
  await gstConfigure();
  const d = document(),
    b = await imported(11000);
  d.lines[0].tax = 'gst';
  await ok({action: 'document', document: d});
  await ok({action: 'post', id: d.id});
  let s = await ok({
    action: 'payment',
    bankId: b.id,
    allocations: [{docId: d.id, amount: 11000}],
  });
  const payment = s.events.find((e) => e.kind === 'payment');
  s = await ok({
    action: 'unmatch',
    eventId: payment.id,
    reason: 'Matched to the wrong customer invoice.',
  });
  assert.equal(derive(s.events).docs[0].balance, 11000);
  assert.equal(derive(s.events).usedBanks.has(b.id), false);
  assert.equal(report(s.events, '2026-01-01', '2026-12-31', 'cash').gstSales, 0);
  s = await ok({action: 'payment', bankId: b.id, allocations: [{docId: d.id, amount: 11000}]});
  assert.equal(derive(s.events).docs[0].balance, 0);
  assert.equal(report(s.events, '2026-01-01', '2026-12-31', 'cash').gstSales, 1000);
  assert.equal(
    (
      await send({
        action: 'unmatch',
        eventId: payment.id,
        reason: 'Cannot undo an already cancelled match.',
      })
    ).status,
    400,
  );
});
test('corrections protect locked dates and later document activity', async () => {
  fixture();
  await configure();
  const d = await posted('100'),
    a = await imported(5000),
    b = await imported(5000);
  let s = await ok({
    action: 'payment',
    bankId: a.id,
    allocations: [{docId: d.id, amount: 5000}],
  });
  const id = s.events.find((e) => e.kind === 'payment').id;
  await ok({action: 'payment', bankId: b.id, allocations: [{docId: d.id, amount: 5000}]});
  assert.equal(
    (
      await send({
        action: 'unmatch',
        eventId: id,
        reason: 'Attempt to correct an earlier payment.',
      })
    ).status,
    400,
  );
  await ok({action: 'settings', settings: {...(await read()).settings, lockDate: '2026-09-02'}});
  s = await read();
  assert.equal(
    (
      await send({
        action: 'unmatch',
        eventId: s.events.filter((e) => e.kind === 'payment').at(-1).id,
        reason: 'Attempt to correct a locked payment.',
      })
    ).status,
    400,
  );
});
test('receipt inbox survives before bill creation, deduplicates content and links atomically', async () => {
  fixture();
  await configure();
  let s = await read();
  const id = crypto.randomUUID(),
    f = new FormData();
  f.append('id', id);
  f.append('target', 'inbox');
  f.append('revision', s.events.at(-1).id);
  f.append('file', new Blob(['%PDF-1.4 unique receipt'], {type: 'application/pdf'}), 'receipt.pdf');
  let r = await attachments.POST(
    new Request('https://books.example/api/attachments', {method: 'POST', body: f}),
  );
  assert.equal(r.status, 200);
  s = await r.json();
  assert.equal(s.events.find((e) => e.kind === 'attachment').payload.target, 'inbox');
  const d = {...document('bill'), reference: 'SUP-123'};
  s = await ok({action: 'document', document: d, attachmentId: id});
  assert.ok(s.events.some((e) => e.kind === 'attachment_link' && e.payload.target === d.id));
  const dup = {...document('bill'), contact: d.contact, reference: 'SUP-123'};
  assert.equal((await send({action: 'document', document: dup})).status, 400);
});
test('posting scanned bills requires saved evidence and explicit review of total differences', async () => {
  fixture();
  await configure();
  const d = document('bill');
  d.receiptReview = {
    attachmentId: crypto.randomUUID(),
    expectedTotal: 99999,
    expectedGst: 0,
    warnings: ['Unreadable tax'],
    reviewed: false,
    explanation: '',
  };
  assert.equal((await send({action: 'document', document: d})).status, 400);
});
test('recurring invoice occurrences are draft-only and do not duplicate on rerun', async () => {
  fixture();
  await configure();
  const d = await posted();
  await ok({
    action: 'recurringRule',
    record: {
      id: crypto.randomUUID(),
      name: 'Monthly service',
      templateId: d.id,
      start: today(),
      cadence: 'monthly',
      termsDays: 14,
      paused: false,
    },
  });
  let s = await ok({action: 'runRecurring'});
  const count = derive(s.events).docs.length;
  assert.equal(count, 2);
  assert.equal(derive(s.events).docs[1].status, 'draft');
  s = await ok({action: 'runRecurring'});
  assert.equal(derive(s.events).docs.length, count);
});

const req = (path, body, origin = 'https://books.example') =>
  new Request('https://books.example/api/' + path, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', origin},
    body: JSON.stringify(body),
  });
async function receiptFor(target) {
  const s = await read(),
    id = crypto.randomUUID(),
    f = new FormData();
  f.append('id', id);
  f.append('target', target);
  f.append('revision', s.events.at(-1).id);
  f.append('file', new Blob(['%PDF-1.4 original ' + id], {type: 'application/pdf'}), 'receipt.pdf');
  const r = await attachments.POST(
    new Request('https://books.example/api/attachments', {method: 'POST', body: f}),
  );
  assert.equal(r.status, 200);
  return id;
}
test('snapshot restores original files and corrected balances in an owner-private isolated database', async () => {
  const {objects} = fixture();
  await configure();
  const d = await posted(),
    b = await imported();
  let s = await ok({
    action: 'payment',
    bankId: b.id,
    allocations: [{docId: d.id, amount: 10000}],
  });
  await ok({
    action: 'unmatch',
    eventId: s.events.find((e) => e.kind === 'payment').id,
    reason: 'Restore test of an audited correction.',
  });
  const fileId = await receiptFor(d.id),
    before = await read();
  let r = await recovery.POST(req('recovery', {action: 'snapshot'}));
  assert.equal(r.status, 200);
  const backupId = (await r.json()).result.id;
  // Original storage can be lost; the backup carries its own evidence bytes.
  const original = before.events.find((e) => e.kind === 'attachment').payload.key,
    originalBytes = objects.get(original);
  objects.delete(original);
  r = await recovery.POST(req('recovery', {action: 'restore', id: backupId}));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const id = (await r.json()).result.id,
    copy = await (
      await recovery.GET(new Request('https://books.example/api/recovery?id=' + id))
    ).json();
  assert.deepEqual(financialSummary(copy), financialSummary(before));
  assert.equal(derive((await read()).events).docs[0].balance, 10000);
  assert.equal((await read()).events.filter((e) => e.kind === 'document').length, 1);
  const file = await recovery.GET(
    new Request('https://books.example/api/recovery?id=' + id + '&file=' + fileId),
  );
  assert.equal(file.status, 200);
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new Uint8Array(originalBytes));
  assert.match(file.headers.get('Content-Security-Policy'), /sandbox/);
  globalThis.__booksTest.headers = {'oai-authenticated-user-id': 'owner-b'};
  assert.equal(
    (await recovery.GET(new Request('https://books.example/api/recovery?id=' + id))).status,
    400,
  );
  assert.equal(
    (await recovery.POST(req('recovery', {action: 'restore', id: backupId}))).status,
    400,
  );
  globalThis.__booksTest.headers = {};
  assert.equal(
    (await recovery.GET(new Request('https://books.example/api/recovery?id=' + id))).status,
    401,
  );
});
test('corrupt backup evidence cannot create a verified recovery or leave partial restored records', async () => {
  const {objects, sql} = fixture();
  await configure();
  const d = await posted();
  await receiptFor(d.id);
  const snap = await (await recovery.POST(req('recovery', {action: 'snapshot'}))).json(),
    metadata = snap.state.events.find((e) => e.kind === 'backup_snapshot'),
    data = JSON.parse(new TextDecoder().decode(objects.get(metadata.payload.key))),
    key = Object.values(data.files)[0].key;
  const corrupt = new Uint8Array(objects.get(key));
  corrupt[0] ^= 1;
  objects.set(key, corrupt);
  const r = await recovery.POST(req('recovery', {action: 'restore', id: snap.result.id}));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /checksum/);
  assert.equal(
    sql.prepare("SELECT COUNT(*) AS n FROM book_events WHERE owner LIKE '%~recovery~%'").get().n,
    0,
  );
  assert.equal(
    (await read()).events.some((e) => e.kind === 'recovery_verified'),
    false,
  );
});

async function emailable() {
  await configure();
  const c = {
    id: crypto.randomUUID(),
    name: 'Customer',
    role: 'customer',
    email: 'customer@example.test',
    phone: '',
    address: '',
    abn: '',
    notes: '',
    termsDays: 14,
    contractor: false,
    archived: false,
  };
  await ok({action: 'contact', record: c});
  const d = {...document(), contactId: c.id};
  await ok({action: 'document', document: d});
  await ok({action: 'post', id: d.id});
  return {c, d};
}
test('email requires review and provider setup; uncertain delivery retries the same provider key and accepted messages never resend', async () => {
  fixture();
  const {d} = await emailable(),
    id = crypto.randomUUID();
  assert.equal(
    (
      await email.POST(
        req('email', {action: 'prepare', id, kind: 'invoice', docId: d.id, note: ''}),
      )
    ).status,
    200,
  );
  assert.equal((await email.POST(req('email', {action: 'send', id}))).status, 400);
  assert.equal((await email.POST(req('email', {action: 'send', id, confirmed: true}))).status, 503);
  globalThis.__booksTest.config = {RESEND_API_KEY: 'test-only', EMAIL_FROM: 'books@example.test'};
  const originalFetch = globalThis.fetch,
    calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({url, options});
    if (calls.length === 1) throw new Error('timeout after acceptance');
    return Response.json(
      options.method === 'POST' ? {id: 'provider-test-id'} : {last_event: 'delivered'},
    );
  };
  try {
    assert.equal(
      (await email.POST(req('email', {action: 'send', id, confirmed: true}))).status,
      502,
    );
    assert.equal(
      (await email.POST(req('email', {action: 'send', id, confirmed: true}))).status,
      200,
    );
    assert.equal(
      calls[0].options.headers['Idempotency-Key'],
      calls[1].options.headers['Idempotency-Key'],
    );
    assert.equal(calls[0].options.body, calls[1].options.body);
    assert.equal(
      (await email.POST(req('email', {action: 'send', id, confirmed: true}))).status,
      200,
    );
    assert.equal(calls.length, 2);
    assert.equal((await email.POST(req('email', {action: 'status', id}))).status, 200);
    assert.equal(
      (await read()).events.filter((e) => e.kind === 'email_status').at(-1).payload.status,
      'delivered',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('changed statement recipients require a fresh preview, and email actions isolate owners', async () => {
  fixture();
  const {c} = await emailable(),
    id = crypto.randomUUID();
  await email.POST(
    req('email', {action: 'prepare', id, kind: 'statement', contactId: c.id, note: ''}),
  );
  await ok({action: 'contact', record: {...c, email: 'changed@example.test'}});
  globalThis.__booksTest.config = {RESEND_API_KEY: 'test-only', EMAIL_FROM: 'books@example.test'};
  let r = await email.POST(req('email', {action: 'send', id, confirmed: true}));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /changed/);
  globalThis.__booksTest.headers = {'oai-authenticated-user-id': 'owner-b'};
  assert.equal((await email.POST(req('email', {action: 'send', id, confirmed: true}))).status, 400);
  globalThis.__booksTest.headers = {};
  assert.equal((await email.GET()).status, 401);
});
test('server blocks posting unreviewed or unexplained receipt totals, even with a saved draft', async () => {
  fixture();
  await configure();
  const id = await receiptFor('inbox'),
    d = {
      ...document('bill'),
      receiptReview: {
        attachmentId: id,
        expectedTotal: 11000,
        expectedGst: 0,
        warnings: ['Unclear line'],
        reviewed: false,
        explanation: '',
      },
    };
  await ok({action: 'document', document: d});
  assert.equal((await send({action: 'post', id: d.id})).status, 400);
  d.receiptReview.reviewed = true;
  await ok({action: 'editDocument', document: d});
  assert.equal((await send({action: 'post', id: d.id})).status, 400);
  d.receiptReview.explanation = 'Verified corrected total with supplier.';
  await ok({action: 'editDocument', document: d});
  assert.equal((await send({action: 'post', id: d.id})).status, 200);
});

test('retrying an identical draft after a lost response succeeds without duplicate documents', async () => {
  fixture();
  await configure();
  const d = document('bill'),
    revision = (await read()).events.at(-1).id;
  await ok({action: 'document', document: d});
  const r = await send({action: 'document', document: d}, {revision});
  assert.equal(r.status, 200);
  assert.equal(derive((await r.json()).events).docs.length, 1);
  assert.equal(
    (await send({action: 'document', document: {...d, contact: 'Changed'}}, {revision})).status,
    409,
  );
});

// Import centre uses the real route and transaction wrapper, with isolated storage.
const importScan = await import(
  transpile('app/api/import-scan/route.ts', {"from '../books/route'": `from '${apiURL}'`})
);
const importLib = await import('../lib/imports.ts');
async function importSource(
  content = 'Name,Email\nNew Customer,new@example.com',
  name = 'contacts.csv',
  type = 'text/csv',
) {
  const f = new FormData(),
    id = crypto.randomUUID();
  f.append('id', id);
  f.append('target', 'import_inbox');
  f.append('revision', (await read()).events.at(-1)?.id || 'empty');
  f.append('file', new Blob([content], {type}), name);
  const r = await attachments.POST(
    new Request('https://books.example/api/attachments', {
      method: 'POST',
      headers: {origin: 'https://books.example'},
      body: f,
    }),
  );
  const s = await r.json();
  assert.equal(r.status, 200, s.error);
  return (
    s.events.find((e) => e.kind === 'attachment' && e.payload.id === id)?.payload ||
    s.events.filter((e) => e.kind === 'attachment').at(-1).payload
  );
}
async function importPreview(sourceId, kind, text, extra = {}) {
  const id = crypto.randomUUID(),
    spec = importLib.importSpecSchema.parse({
      kind,
      text,
      columns:
        kind === 'reference'
          ? {}
          : importLib.guessColumns(importLib.readImportCsv(text).headers, kind),
      audConfirmed: true,
      ...extra,
    });
  const s = await ok({action: 'previewImport', id, sourceId, spec});
  return s.events.find((e) => e.kind === 'import_preview' && e.payload.id === id).payload;
}
test('import preview changes no ledger, confirmation is mandatory, commit retry is idempotent', async () => {
  fixture();
  await configure();
  const text = 'Name,Email\nNew Customer,new@example.com',
    file = await importSource(text),
    p = await importPreview(file.id, 'contacts', text);
  assert.equal(derive((await read()).events).journal.length, 0);
  assert.equal((await read()).events.filter((e) => e.kind === 'contact').length, 0);
  assert.equal((await send({action: 'commitImport', previewId: p.id})).status, 400);
  const s = await ok({action: 'commitImport', previewId: p.id, confirmed: true});
  assert.equal(s.events.filter((e) => e.kind === 'contact').length, 1);
  const again = await send(
    {action: 'commitImport', previewId: p.id, confirmed: true},
    {revision: 'stale'},
  );
  assert.equal(again.status, 200);
  assert.equal((await again.json()).events.length, s.events.length);
  assert.equal(
    (
      await send({
        action: 'previewImport',
        id: crypto.randomUUID(),
        sourceId: file.id,
        spec: p.spec,
      })
    ).status,
    400,
  );
});
test('invalid batch imports no rows and changed books require a fresh preview', async () => {
  fixture();
  await configure();
  const text = 'Name,Email\nValid,valid@example.com\nBad,not-email',
    file = await importSource(text),
    p = await importPreview(file.id, 'contacts', text);
  assert.equal(p.plan.count, 1);
  assert.equal(p.plan.errors.length, 1);
  assert.equal(
    (await send({action: 'commitImport', previewId: p.id, confirmed: true})).status,
    400,
  );
  assert.equal((await read()).events.filter((e) => e.kind === 'contact').length, 0);
  const valid = await importPreview(file.id, 'contacts', 'Name,Email\nValid,valid@example.com');
  await ok({
    action: 'contact',
    record: {
      id: crypto.randomUUID(),
      name: 'Valid',
      role: 'customer',
      email: 'keep@example.com',
      phone: '',
      address: '',
      abn: '',
      notes: '',
      termsDays: 14,
      contractor: false,
      archived: false,
    },
  });
  const stale = await send({action: 'commitImport', previewId: valid.id, confirmed: true});
  assert.equal(stale.status, 400);
  assert.match((await stale.json()).error, /fresh preview/);
});
test('imported bills stay drafts, retain source links and enter complete backups', async () => {
  fixture();
  await configure();
  const text =
      'Number,Contact,Date,Due,Description,Quantity,UnitPrice,Tax,Account,Total\nBILL-IMPORT,Supplier,2026-09-10,2026-09-24,Materials,2,50,NONE,Materials,100',
    file = await importSource(text, 'bills.csv'),
    p = await importPreview(file.id, 'bill', text, {
      priceBasis: 'exclusive',
      accounts: {Materials: '500'},
      taxes: {NONE: 'none'},
    });
  assert.deepEqual(p.plan.errors, []);
  const s = await ok({action: 'commitImport', previewId: p.id, confirmed: true}),
    v = derive(s.events);
  assert.equal(v.docs[0].status, 'draft');
  assert.equal(v.docs[0].total, 10000);
  assert.equal(v.journal.length, 0);
  assert.equal(
    s.events.find((e) => e.kind === 'import_commit').payload.records[0].id,
    v.docs[0].id,
  );
  const res = await backup.GET(new Request('https://books.example/api/backup'));
  assert.equal(res.status, 200);
  const verified = await verifyBackup(await res.blob());
  assert.equal(verified.summary.attachments, 1);
  assert.equal(verified.summary.documents, 1);
});
test('bank and trial balance imports keep the posted ledger unchanged', async () => {
  fixture();
  await configure();
  const text = 'Date,Description,Amount,Reference\n2026-09-10,Material purchase,-55,B-1',
    file = await importSource(text, 'bank.csv'),
    p = await importPreview(file.id, 'bank', text);
  await ok({action: 'commitImport', previewId: p.id, confirmed: true});
  const trial = 'Account,Debit,Credit\nBank,100,0\nEquity,0,100',
    f = await importSource(trial, 'trial.csv'),
    t = await importPreview(f.id, 'trial_balance', trial, {
      accounts: {Bank: '100', Equity: '300'},
      date: '2026-08-31',
    });
  const s = await ok({action: 'commitImport', previewId: t.id, confirmed: true});
  assert.equal(derive(s.events).banks.length, 1);
  assert.equal(derive(s.events).journal.length, 0);
  assert.equal(s.events.filter((e) => e.kind === 'import_balance_reference').length, 1);
  assert.equal(
    s.events.find((e) => e.kind === 'import_commit' && e.payload.sourceId === f.id).payload
      .referenceOnly,
    true,
  );
});
test('import originals and previews are isolated by owner and cross-origin requests fail', async () => {
  fixture();
  await configure();
  const file = await importSource(),
    p = await importPreview(file.id, 'contacts', 'Name,Email\nNew Customer,new@example.com');
  globalThis.__booksTest.headers = {'oai-authenticated-user-id': 'owner-b'};
  assert.equal(
    (await send({action: 'commitImport', previewId: p.id, confirmed: true})).status,
    400,
  );
  assert.equal(
    (
      await send({
        action: 'previewImport',
        id: crypto.randomUUID(),
        sourceId: file.id,
        spec: p.spec,
      })
    ).status,
    400,
  );
  assert.equal(
    (await attachments.GET(new Request('https://books.example/api/attachments?id=' + file.id)))
      .status,
    404,
  );
  const r = await importScan.POST(
    req('/api/import-scan', {sourceId: file.id, kind: 'bank'}, 'https://evil.example'),
  );
  assert.equal(r.status, 403);
});
test('PDF reference can be saved without AI; absent API key never calls a provider', async () => {
  fixture();
  await configure();
  const file = await importSource('%PDF-1.4\nReference only', 'statement.pdf', 'application/pdf');
  assert.equal((await (await importScan.GET()).json()).configured, false);
  const r = await importScan.POST(req('/api/import-scan', {sourceId: file.id, kind: 'bank'}));
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /not connected/);
  const p = await importPreview(file.id, 'reference', '', {
      notes: 'Dashboard balances for migration review',
    }),
    s = await ok({action: 'commitImport', previewId: p.id, confirmed: true});
  assert.equal(derive(s.events).journal.length, 0);
  assert.equal(s.events.find((e) => e.kind === 'import_commit').payload.referenceOnly, true);
});
test('automatic import reading validates output, caches transcriptions and preserves source bytes', async () => {
  fixture();
  await configure();
  const file = await importSource('%PDF-1.4\nMock readable table', 'table.pdf', 'application/pdf');
  globalThis.__booksTest.config = {OPENAI_API_KEY: 'test-only-mock'};
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(options.body);
    assert.equal(body.store, false);
    assert.equal(body.input[0].content[1].type, 'input_file');
    return Response.json({
      status: 'completed',
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                headers: ['Date', 'Description', 'Amount'],
                rows: [['2026-09-01', 'Materials', '-10.00']],
                warnings: ['Confirm the document is complete.'],
              }),
            },
          ],
        },
      ],
    });
  };
  try {
    const r = await importScan.POST(req('/api/import-scan', {sourceId: file.id, kind: 'bank'}));
    const data = await r.json();
    assert.equal(r.status, 200, data.error);
    assert.equal(data.extraction.reviewed, false);
    assert.equal(data.extraction.warnings.length, 1);
    assert.equal(importLib.readImportCsv(data.extraction.text).rows.length, 1);
    const cached = await importScan.POST(
      req('/api/import-scan', {sourceId: file.id, kind: 'bank'}),
    );
    assert.equal((await cached.json()).cached, true);
    assert.equal(calls, 1);
    assert.equal(derive((await read()).events).banks.length, 0);
    assert.equal(
      await (
        await attachments.GET(new Request('https://books.example/api/attachments?id=' + file.id))
      ).text(),
      '%PDF-1.4\nMock readable table',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('malformed extraction cannot create import rows and scan attempt limit stops provider calls', async () => {
  fixture();
  await configure();
  const file = await importSource('%PDF-1.4\nBad mock table', 'bad.pdf', 'application/pdf');
  globalThis.__booksTest.config = {OPENAI_API_KEY: 'test-only-mock'};
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({
      status: 'completed',
      output: [
        {
          content: [
            {type: 'output_text', text: '{"headers":["A","B"],"rows":[["one"]],"warnings":[]}'},
          ],
        },
      ],
    });
  };
  try {
    for (let i = 0; i < 20; i++) {
      const r = await importScan.POST(req('/api/import-scan', {sourceId: file.id, kind: 'bank'}));
      assert.equal(r.status, 422);
    }
    const r = await importScan.POST(req('/api/import-scan', {sourceId: file.id, kind: 'bank'}));
    assert.equal(r.status, 429);
    assert.equal(calls, 20);
    assert.equal((await read()).events.filter((e) => e.kind === 'import_extraction').length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('CSV uploads are limited to the import inbox and binary CSVs are rejected', async () => {
  fixture();
  await configure();
  const doc = await posted();
  for (const [target, content, name] of [
    [doc.id, 'Name,Email\nA,a@example.com', 'data.csv'],
    ['import_inbox', new Uint8Array([255, 0, 254]), 'binary.csv'],
    ['import_inbox', 'Name\nExample', 'wrong.txt'],
  ]) {
    const form = new FormData();
    form.append('id', crypto.randomUUID());
    form.append('target', target);
    form.append('revision', (await read()).events.at(-1).id);
    form.append('file', new Blob([content]), name);
    const r = await attachments.POST(
      new Request('https://books.example/api/attachments', {
        method: 'POST',
        headers: {origin: 'https://books.example'},
        body: form,
      }),
    );
    assert.equal(r.status, 400);
  }
  assert.equal((await read()).events.filter((e) => e.kind === 'attachment').length, 0);
});
test('two concurrent commits can only import a reviewed batch once', async () => {
  fixture();
  await configure();
  const text = 'Name,Email\nConcurrent,concurrent@example.com',
    file = await importSource(text),
    p = await importPreview(file.id, 'contacts', text),
    revision = (await read()).events.at(-1).id;
  const results = await Promise.all([
    send({action: 'commitImport', previewId: p.id, confirmed: true}, {revision}),
    send({action: 'commitImport', previewId: p.id, confirmed: true}, {revision}),
  ]);
  assert.ok(results.some((r) => r.status === 200));
  assert.ok(results.every((r) => [200, 409].includes(r.status)));
  const s = await read();
  assert.equal(s.events.filter((e) => e.kind === 'contact').length, 1);
  assert.equal(s.events.filter((e) => e.kind === 'import_commit').length, 1);
});
