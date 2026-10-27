import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';

const INSTALL = process.env.OPENBOOKS_INSTALL_DIR;
if (!INSTALL) throw new Error('Set OPENBOOKS_INSTALL_DIR to the installed OpenBooks folder.');
const home = await mkdtemp(join(tmpdir(), 'ob-exe-smoke-'));
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
const launcher = spawn(join(INSTALL, 'OpenBooks.exe'), [], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
launcher.stdout.on('data', (b) => (out += b));
launcher.stderr.on('data', (b) => (out += b));

let session;
for (let n = 0; n < 120 && !session; n++) {
  try {
    session = JSON.parse(await readFile(join(home, 'desktop-session.json'), 'utf8'));
  } catch {
    await wait(250);
  }
}
assert.ok(session, 'launcher created a session file\n' + out);
const origin = 'http://127.0.0.1:' + session.port;
async function desktop(path, body) {
  const r = await fetch(origin + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      'x-desktop-token': session.token,
      ...(body ? {origin, 'Content-Type': 'application/json'} : {}),
    },
    ...(body ? {body: JSON.stringify(body)} : {}),
  });
  return {r, d: await r.json()};
}

const st = await desktop('/status');
assert.equal(st.r.status, 200, JSON.stringify(st.d));
assert.equal(st.d.configured, false, 'fresh install must not be configured');
assert.equal(st.d.version, '0.1.0-beta.4');
console.log('PASS installed EXE: control page up, version 0.1.0-beta.4, unconfigured');

const body = {
  name: 'Exe Pilot',
  email: 'exe@example.test',
  business: 'Exe Plumbing',
  password: 'Exe pilot password 2026',
  confirm: 'Exe pilot password 2026',
};
const setup = await desktop('/setup', body);
assert.equal(setup.r.status, 200, JSON.stringify(setup.d));
console.log('PASS real EXE first-run setup wizard');

const app = 'http://127.0.0.1:' + port;
const login = await fetch(app + '/api/account', {
  method: 'POST',
  headers: {origin: app, 'Content-Type': 'application/json'},
  body: JSON.stringify({action: 'login', email: body.email, password: body.password}),
});
assert.equal(login.status, 200, await login.clone().text());
const cookie = login.headers.get('set-cookie').split(';')[0];
assert.equal((await fetch(app + '/api/books', {headers: {cookie}})).status, 200);
assert.equal((await fetch(app + '/')).status, 200);
console.log('PASS real EXE: production login and authenticated books');

const backup = await desktop('/backup', {});
assert.equal(backup.r.status, 200, JSON.stringify(backup.d));
console.log('PASS real EXE: verified desktop backup');

const quit = await desktop('/quit', {});
assert.equal(quit.r.status, 200, JSON.stringify(quit.d));
let gone = false;
for (let n = 0; n < 60; n++) {
  try {
    await readFile(join(home, 'desktop-session.json'), 'utf8');
    await wait(250);
  } catch {
    gone = true;
    break;
  }
}
assert.ok(gone, 'desktop service did not shut down');
console.log('PASS real EXE: clean quit');

await rm(home, {recursive: true, force: true});
console.log('ALL REAL-EXE TESTS PASS');
