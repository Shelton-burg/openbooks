import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createServer} from 'node:net';
const home = await mkdtemp(join(tmpdir(), 'td-desktop-smoke-'));
// Run from a COPY outside the repo tree: module resolution must not be able to
// walk up into the repository's dev node_modules and hide a missing runtime
// dependency (this once masked a missing @next/env in the installed app).
const staged = resolve('windows-release/payload');
const isolated = join(await mkdtemp(join(tmpdir(), 'td-desktop-payload-')), 'payload');
await cp(staged, isolated, {recursive: true, dereference: true});
const payload = isolated;
let child;
let session, origin;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const probe = createServer();
await new Promise((r) => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const env = {
  ...process.env,
  OPENBOOKS_DESKTOP_HOME: home,
  OPENBOOKS_DESKTOP_TEST_PORT: String(port),
  OPENBOOKS_DESKTOP_NO_BROWSER: '1',
};
const start = () => {
  child = spawn(process.execPath, [join(payload, 'desktop/run.mjs')], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (b) => (output += b));
  child.stderr.on('data', (b) => (output += b));
  child.on('exit', (code) => {
    if (code) console.error(output);
  });
  return child;
};
async function desktop(path, body, headers = {}) {
  const r = await fetch(origin + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      'x-desktop-token': session.token,
      ...(body ? {origin, 'Content-Type': 'application/json'} : {}),
      ...headers,
    },
    ...(body ? {body: JSON.stringify(body)} : {}),
  });
  return {r, d: await r.json()};
}
async function stop() {
  if (!child) return;
  try {
    await desktop('/quit', {});
  } catch {}
  const p = child;
  await Promise.race([new Promise((r) => p.once('exit', r)), wait(5000)]);
  if (p.exitCode === null) p.kill('SIGKILL');
  child = null;
}
try {
  start();
  for (let n = 0; n < 100; n++) {
    try {
      session = JSON.parse(await readFile(join(home, 'desktop-session.json')));
      origin = 'http://127.0.0.1:' + session.port;
      break;
    } catch {
      await wait(100);
    }
  }
  assert.ok(session, 'Desktop service starts');
  assert.equal((await desktop('/status')).d.configured, false);
  assert.equal((await desktop('/status', undefined, {'x-desktop-token': ''})).r.status, 400);
  const body = {
    name: 'Desktop Pilot',
    email: 'pilot@example.test',
    business: 'Fictional Pilot',
    password: 'Pilot test password 2026',
    confirm: 'Pilot test password 2026',
  };
  assert.equal((await desktop('/setup', body, {origin: 'https://untrusted.test'})).r.status, 400);
  const setup = await desktop('/setup', body);
  assert.equal(setup.r.status, 200, JSON.stringify(setup.d));
  assert.equal((await desktop('/setup', body)).r.status, 400);
  let app = 'http://127.0.0.1:' + port;
  const login = await fetch(app + '/api/account', {
    method: 'POST',
    headers: {origin: app, 'Content-Type': 'application/json'},
    body: JSON.stringify({action: 'login', email: body.email, password: body.password}),
  });
  assert.equal(login.status, 200, await login.clone().text());
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(app + '/api/books', {headers: {cookie}})).status, 200);
  assert.equal((await fetch(app + '/')).status, 200);
  console.log(
    'PASS first-run wizard, one-time setup, real production login and authenticated books',
  );
  const backup = await desktop('/backup', {});
  assert.equal(backup.r.status, 200, JSON.stringify(backup.d));
  assert.equal(backup.d.warning, '', JSON.stringify(backup.d));
  assert.ok(backup.d.backup.id);
  console.log('PASS verified desktop backup and recurring-draft maintenance');
  const second = spawn(process.execPath, [join(payload, 'desktop/run.mjs'), '--controls'], {
    env,
    stdio: 'pipe',
  });
  assert.equal(await new Promise((r) => second.once('exit', r)), 0);
  assert.equal((await desktop('/status')).d.running, true);
  console.log('PASS second launch reuses existing application');
  const restored = await desktop('/restore', {id: backup.d.backup.id, confirm: 'RESTORE'});
  assert.equal(restored.r.status, 200, JSON.stringify(restored.d));
  assert.equal((await fetch(app + '/api/account', {headers: {cookie}})).status, 401);
  console.log('PASS full restore, restart, saved previous data and revoked session');
  await stop();
  const before = spawn(process.execPath, [join(payload, 'desktop/run.mjs'), '--before-update'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errors = '';
  before.stderr.on('data', (b) => (errors += b));
  assert.equal(await new Promise((r) => before.once('exit', r)), 0, errors);
  const settings = JSON.parse(await readFile(join(home, 'desktop-settings.json')));
  assert.ok(settings.lastBackup.id);
  console.log('PASS clean stop and verified pre-update backup');
} catch (e) {
  try {
    console.error(await readFile(join(home, 'desktop.log'), 'utf8'));
  } catch {}
  throw e;
} finally {
  await stop();
  await rm(home, {recursive: true, force: true});
}
