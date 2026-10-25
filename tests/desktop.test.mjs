import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {
  makeBackup,
  verifyBackup,
  restoreBackup,
  checkBackupRoot,
  listBackups,
} from '../desktop/backup.mjs';
import {authorize} from '../desktop/security.mjs';
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'td-desktop-')),
    data = join(root, 'data'),
    backups = join(root, 'backups');
  await mkdir(join(data, 'objects'), {recursive: true});
  const db = new DatabaseSync(join(data, 'books.sqlite'));
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT); CREATE TABLE workspaces(id TEXT PRIMARY KEY); CREATE TABLE book_events(kind TEXT,payload TEXT); CREATE TABLE sessions(id TEXT); CREATE TABLE invitations(id TEXT); INSERT INTO users VALUES ('1','First owner'); INSERT INTO sessions VALUES ('old session'); INSERT INTO invitations VALUES ('old link');",
  );
  const bytes = Buffer.from('Original receipt fixture'),
    key = 'attachments/receipt-1',
    object = createHash('sha256').update(key).digest('hex');
  await writeFile(join(data, 'objects', object), bytes);
  db.prepare('INSERT INTO book_events VALUES (?,?)').run(
    'attachment',
    JSON.stringify({
      key,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }),
  );
  db.close();
  return {root, data, backups, object};
}
test('desktop backup captures committed WAL records and original receipts; restore revokes access and retains previous data', async () => {
  const f = await fixture();
  try {
    const openDb = new DatabaseSync(join(f.data, 'books.sqlite'));
    openDb.exec("UPDATE users SET name='Saved owner'");
    const m = await makeBackup(f.data, f.backups);
    openDb.exec("UPDATE users SET name='Later owner'");
    openDb.close();
    assert.equal((await listBackups(f.backups))[0].id, m.id);
    await verifyBackup(join(f.backups, m.id));
    const r = await restoreBackup(f.data, join(f.backups, m.id));
    const db = new DatabaseSync(join(f.data, 'books.sqlite'));
    assert.equal(db.prepare('SELECT name FROM users').get().name, 'Saved owner');
    assert.equal(db.prepare('SELECT count(*) n FROM sessions').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM invitations').get().n, 0);
    db.close();
    const old = new DatabaseSync(join(r.previousData, 'books.sqlite'));
    assert.equal(old.prepare('SELECT name FROM users').get().name, 'Later owner');
    old.close();
    assert.equal(
      (await readFile(join(f.data, 'objects', f.object))).toString(),
      'Original receipt fixture',
    );
  } finally {
    await rm(f.root, {recursive: true, force: true});
  }
});
test('corrupted receipt backup is rejected without touching live data', async () => {
  const f = await fixture();
  try {
    const m = await makeBackup(f.data, f.backups),
      folder = join(f.backups, m.id);
    await writeFile(join(folder, 'data', 'objects', f.object), 'corrupted');
    await assert.rejects(() => restoreBackup(f.data, folder), /verification failed/);
    const db = new DatabaseSync(join(f.data, 'books.sqlite'));
    assert.equal(db.prepare('SELECT name FROM users').get().name, 'First owner');
    db.close();
  } finally {
    await rm(f.root, {recursive: true, force: true});
  }
});
test('missing referenced original fails backup and leaves no completed snapshot', async () => {
  const f = await fixture();
  try {
    await rm(join(f.data, 'objects', f.object));
    await assert.rejects(() => makeBackup(f.data, f.backups), /missing from the backup/);
    assert.equal((await listBackups(f.backups)).length, 0);
  } finally {
    await rm(f.root, {recursive: true, force: true});
  }
});
test('restore rejects path traversal and duplicate manifest files', async () => {
  const f = await fixture();
  try {
    const m = await makeBackup(f.data, f.backups),
      folder = join(f.backups, m.id);
    m.files.push({...m.files[0], name: '../escape'});
    await writeFile(join(folder, 'manifest.json'), JSON.stringify(m));
    await assert.rejects(() => restoreBackup(f.data, folder), /Invalid backup file entry/);
  } finally {
    await rm(f.root, {recursive: true, force: true});
  }
});
test('backup destination cannot be inside live data or application files', async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      () => checkBackupRoot(join(f.data, 'bad'), f.data, join(f.root, 'app')),
      /outside/,
    );
    await assert.rejects(() => checkBackupRoot(f.root, f.data, join(f.root, 'app')), /outside/);
    assert.equal(await checkBackupRoot(f.backups, f.data, join(f.root, 'app')), f.backups);
  } finally {
    await rm(f.root, {recursive: true, force: true});
  }
});
test('desktop controls reject missing capability, DNS rebinding and cross-origin writes', () => {
  const config = {host: '127.0.0.1:42000', token: 'test-only-capability'},
    req = (headers) => ({
      headers: {host: config.host, 'x-desktop-token': config.token, ...headers},
    });
  assert.doesNotThrow(() => authorize(req({origin: 'http://' + config.host}), config, true));
  assert.throws(() => authorize(req({'x-desktop-token': ''}), config), /Desktop controls/);
  assert.throws(() => authorize(req({host: 'attacker.test'}), config), /local host/);
  assert.throws(() => authorize(req({origin: 'https://attacker.test'}), config, true), /origin/);
  assert.throws(() => authorize(req({'sec-fetch-site': 'cross-site'}), config), /Cross-site/);
});

test('original corruption before backup is detected against the stored receipt hash', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.data, 'objects', f.object), 'already damaged');
    await assert.rejects(() => makeBackup(f.data, f.backups), /checksum does not match/);
  } finally {
    await rm(f.root, {recursive: true, force: true});
  }
});
