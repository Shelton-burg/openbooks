import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after} from 'node:test';
import ts from 'typescript';
import * as auth from '../server/auth-core.mjs';
import {rawDatabase, getDatabase, bucket, closeDatabase} from '../server/storage.mjs';
import {workspaceContext} from '../server/context.mjs';
const directory = mkdtempSync(join(tmpdir(), 'tradedesk-community-'));
process.env.DATA_DIR = directory;
process.env.APP_ORIGIN = 'https://books.test';
after(() => {
  closeDatabase();
  rmSync(directory, {recursive: true, force: true});
});
const root = new URL('../', import.meta.url),
  modules = new Map();
async function load(path) {
  if (modules.has(path)) return modules.get(path);
  let source = readFileSync(new URL(path, root), 'utf8');
  source = source.replace(
    "import {headers as requestHeaders} from 'next/headers';",
    'const requestHeaders=async()=>new Headers();',
  );
  const specs = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map((m) => m[1]);
  for (const spec of new Set(specs)) {
    let url;
    if (spec.startsWith('@/') || spec.startsWith('.')) {
      const base = spec.startsWith('@/')
        ? new URL(spec.slice(2), root)
        : new URL(spec, new URL(path, root));
      let target = base.href;
      if (!/\.(mjs|ts|tsx)$/.test(target)) {
        if (existsSync(new URL(target + '.ts'))) target += '.ts';
        else if (existsSync(new URL(target + '/index.ts'))) target += '/index.ts';
        else target += '.mjs';
      }
      if (target.endsWith('.ts') && !target.includes('/lib/')) {
        const sub = target.slice(root.href.length);
        url = await load(sub);
      } else url = target;
    } else if (!spec.startsWith('node:')) url = import.meta.resolve(spec);
    else continue;
    source = source
      .replaceAll("from '" + spec + "'", "from '" + url + "'")
      .replaceAll('from "' + spec + '"', 'from "' + url + '"');
  }
  const code = ts.transpileModule(source, {
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext},
  }).outputText;
  const url = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  modules.set(path, url);
  return url;
}
const boundary = await import(await load('server/auth.ts'));
const books = await import(await load('app/api/books/route.ts'));
const maintenance = await import(await load('app/api/maintenance/route.ts'));
const attachments = await import(await load('app/api/attachments/route.ts'));
const pass = 'Test-only password 123456';
let owner, token, ctx, viewerToken, bookkeeperToken, second;
const request = (path, token, body, extra = {}) =>
  new Request('https://books.test/api/' + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      cookie: 'td_session=' + token,
      ...(body ? {origin: 'https://books.test', 'Content-Type': 'application/json'} : {}),
      ...extra,
    },
    ...(body ? {body: JSON.stringify(body)} : {}),
  });
test('bootstrap is one-time and passwords are salted; login never accepts identity headers', async () => {
  owner = auth.bootstrap({
    email: 'owner@example.test',
    name: 'Owner',
    password: pass,
    business: 'First Business',
  });
  assert.throws(
    () =>
      auth.bootstrap({
        email: 'another@example.test',
        name: 'Other',
        password: pass,
        business: 'Other',
      }),
    /already complete/,
  );
  assert.notEqual(auth.hashPassword(pass), auth.hashPassword(pass));
  assert.throws(() => auth.signIn('owner@example.test', 'incorrect'), /incorrect/);
  token = auth.signIn('owner@example.test', pass);
  ctx = auth.session(token);
  assert.equal(ctx.workspaceId, owner.workspaceId);
  const r = await books.GET(
    request('books', '', null, {
      'oai-authenticated-user-id': owner.workspaceId,
      'oai-authenticated-user-email': 'owner@example.test',
    }),
  );
  assert.equal(r.status, 401);
});
test('invitations are email-bound, one-use, scoped and revocable', () => {
  const invitation = auth.invite(ctx, {email: 'viewer@example.test', role: 'viewer'});
  assert.throws(
    () =>
      auth.acceptInvitation({
        token: invitation,
        email: 'wrong@example.test',
        name: 'Viewer',
        password: pass,
      }),
    /invalid/,
  );
  auth.acceptInvitation({
    token: invitation,
    email: 'viewer@example.test',
    name: 'Viewer',
    password: pass,
  });
  assert.throws(
    () =>
      auth.acceptInvitation({
        token: invitation,
        email: 'viewer@example.test',
        name: 'Viewer',
        password: pass,
      }),
    /invalid/,
  );
  viewerToken = auth.signIn('viewer@example.test', pass);
  assert.equal(auth.session(viewerToken).role, 'viewer');
  assert.throws(
    () => auth.invite(auth.session(viewerToken), {email: 'x@example.test', role: 'bookkeeper'}),
    /owner/,
  );
  const revoked = auth.invite(ctx, {email: 'revoked@example.test', role: 'bookkeeper'});
  auth.revokeInvitation(ctx, auth.digest(revoked));
  assert.throws(
    () =>
      auth.acceptInvitation({
        token: revoked,
        email: 'revoked@example.test',
        name: 'Revoked',
        password: pass,
      }),
    /invalid/,
  );
});
test('viewer reads but cannot write, and missing or hostile origins are rejected', async () => {
  assert.equal((await books.GET(request('books', viewerToken))).status, 200);
  assert.equal((await books.POST(request('books', viewerToken, {action: 'settings'}))).status, 403);
  assert.equal(
    (await books.POST(request('books', token, {action: 'settings'}, {origin: 'https://evil.test'})))
      .status,
    403,
  );
  const r = request('books', token, {action: 'settings'});
  r.headers.delete('origin');
  assert.equal((await books.POST(r)).status, 403);
});
test('each business sees only its own records, and membership is required to switch', async () => {
  let s = await (await books.GET(request('books', token))).json();
  let r = await books.POST(
    request('books', token, {
      action: 'settings',
      revision: s.events.at(-1)?.id || 'empty',
      settings: {...s.settings, name: 'First Business', gst: 'no', gstBasis: 'cash'},
    }),
  );
  assert.equal(r.status, 200);
  s = await r.json();
  assert.equal(
    s.events.filter((e) => e.kind === 'settings').at(-1).payload._actor.userId,
    undefined,
  );
  assert.equal(s.events.filter((e) => e.kind === 'settings').at(-1).payload._actor.id, ctx.userId);
  second = auth.createWorkspace(ctx, 'Second Business');
  assert.throws(() => auth.changeWorkspace(viewerToken, second), /denied/);
  auth.changeWorkspace(token, second);
  s = await (await books.GET(request('books', token))).json();
  assert.equal(s.events.length, 0);
  auth.changeWorkspace(token, owner.workspaceId);
  assert.ok((await (await books.GET(request('books', token))).json()).events.length > 0);
});
test('bookkeeper can edit records and cannot manage membership or remove owners', async () => {
  const invitation = auth.invite(ctx, {email: 'bookkeeper@example.test', role: 'bookkeeper'});
  auth.acceptInvitation({
    token: invitation,
    email: 'bookkeeper@example.test',
    name: 'Bookkeeper',
    password: pass,
  });
  bookkeeperToken = auth.signIn('bookkeeper@example.test', pass);
  const s = await (await books.GET(request('books', bookkeeperToken))).json(),
    r = await books.POST(
      request('books', bookkeeperToken, {
        action: 'contact',
        revision: s.events.at(-1).id,
        record: {
          id: crypto.randomUUID(),
          name: 'Test customer',
          email: '',
          phone: '',
          address: '',
          abn: '',
          role: 'customer',
          termsDays: 14,
          notes: '',
          contractor: false,
          archived: false,
        },
      }),
    );
  assert.equal(r.status, 200);
  assert.throws(
    () => auth.changeRole(auth.session(bookkeeperToken), ctx.userId, 'remove'),
    /owner/,
  );
  assert.throws(() => auth.changeRole(ctx, ctx.userId, 'remove'), /owner/);
});
test('private originals persist on disk and cannot be downloaded from another workspace', async () => {
  const s = await (await books.GET(request('books', token))).json(),
    id = crypto.randomUUID(),
    form = new FormData();
  form.append('id', id);
  form.append('target', 'import_inbox');
  form.append('revision', s.events.at(-1).id);
  form.append('file', new Blob(['%PDF-1.4\nPrivate evidence']), 'evidence.pdf');
  const r = await attachments.POST(
    new Request('https://books.test/api/attachments', {
      method: 'POST',
      headers: {origin: 'https://books.test', cookie: 'td_session=' + token},
      body: form,
    }),
  );
  assert.equal(r.status, 200);
  let get = await attachments.GET(request('attachments?id=' + id, token));
  assert.equal(await get.text(), '%PDF-1.4\nPrivate evidence');
  auth.changeWorkspace(token, second);
  get = await attachments.GET(request('attachments?id=' + id, token));
  assert.equal(get.status, 404);
  auth.changeWorkspace(token, owner.workspaceId);
});
test('database batches are atomic and object keys cannot escape storage', async () => {
  const db = getDatabase();
  await assert.rejects(
    db.batch([
      db.prepare('INSERT INTO workspaces VALUES (?,?,?)').bind('atomic-workspace', 'Atomic', 'now'),
      db
        .prepare('INSERT INTO workspaces VALUES (?,?,?)')
        .bind('atomic-workspace', 'Duplicate', 'now'),
    ]),
  );
  assert.equal(
    rawDatabase().prepare('SELECT id FROM workspaces WHERE id=?').get('atomic-workspace'),
    undefined,
  );
  await bucket.put('../../outside', new Uint8Array([1, 2, 3]));
  assert.deepEqual(
    new Uint8Array(await (await bucket.get('../../outside')).arrayBuffer()),
    new Uint8Array([1, 2, 3]),
  );
  assert.equal(existsSync(join(directory, '..', 'outside')), false);
});
test('maintenance requires dedicated credentials, backs up every workspace and reads back success', async () => {
  assert.equal((await maintenance.POST(request('maintenance', '', {}))).status, 401);
  assert.equal((await maintenance.POST(request('maintenance', bookkeeperToken, {}))).status, 403);
  process.env.MAINTENANCE_TOKEN = 'test-only-maintenance-token-with-32-characters';
  let r = await maintenance.POST(
    request('maintenance', '', {}, {authorization: 'Bearer ' + process.env.MAINTENANCE_TOKEN}),
  );
  const data = await r.json();
  assert.equal(r.status, 200, JSON.stringify(data));
  assert.equal(data.results.length, 2);
  assert.ok(data.results.every((x) => x.status === 'succeeded'));
  r = await maintenance.GET(
    request('maintenance', '', null, {authorization: 'Bearer ' + process.env.MAINTENANCE_TOKEN}),
  );
  const saved = await r.json();
  assert.ok(saved.results.every((x) => x.latest.status === 'succeeded' && x.latest.backupId));
  const before = rawDatabase()
    .prepare("SELECT COUNT(*) n FROM book_events WHERE kind='backup_snapshot'")
    .get().n;
  await maintenance.POST(
    request('maintenance', '', {}, {authorization: 'Bearer ' + process.env.MAINTENANCE_TOKEN}),
  );
  assert.equal(
    rawDatabase().prepare("SELECT COUNT(*) n FROM book_events WHERE kind='backup_snapshot'").get()
      .n,
    before,
  );
});
test('removing members and changing passwords invalidate existing sessions', () => {
  const viewer = auth.session(viewerToken);
  auth.changeRole(ctx, viewer.userId, 'remove');
  assert.equal(auth.session(viewerToken), null);
  assert.throws(() => auth.changeRole(ctx, ctx.userId, 'viewer'), /owner/);
  auth.changePassword(ctx, pass, 'Changed password 123456789');
  assert.equal(auth.session(token), null);
  assert.throws(() => auth.signIn('owner@example.test', pass), /incorrect/);
});
