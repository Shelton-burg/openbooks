import {DatabaseSync, backup as sqliteBackup} from 'node:sqlite';
import {
  mkdir,
  readdir,
  lstat,
  readFile,
  writeFile,
  copyFile,
  rename,
  rm,
  realpath,
} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {resolve, join, relative, isAbsolute, sep} from 'node:path';
import {createReadStream} from 'node:fs';
export async function hashFile(path) {
  const h = createHash('sha256');
  for await (const b of createReadStream(path)) h.update(b);
  return h.digest('hex');
}
export function inside(parent, child) {
  const r = relative(resolve(parent), resolve(child));
  return r === '' || (!r.startsWith('..' + sep) && r !== '..' && !isAbsolute(r));
}
export async function checkBackupRoot(folder, dataDir, appDir) {
  if (!isAbsolute(folder)) throw new Error('Choose a full folder path.');
  await mkdir(folder, {recursive: true});
  const actual = await realpath(folder),
    data = await realpath(dataDir);
  if (inside(data, actual) || inside(actual, data) || inside(appDir, actual))
    throw new Error('Backups must be outside the data and application folders.');
  return actual;
}
async function regular(path) {
  const s = await lstat(path);
  if (!s.isFile() || s.isSymbolicLink()) throw new Error('Unexpected file in backup.');
  return s;
}
function checkDatabase(path) {
  const db = new DatabaseSync(path, {readOnly: true});
  try {
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok')
      throw new Error('Database integrity check failed.');
    if (db.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('Database relationships failed validation.');
    for (const table of ['users', 'workspaces', 'book_events'])
      db.prepare('SELECT count(*) FROM ' + table).get();
  } finally {
    db.close();
  }
}
export async function makeBackup(
  dataDir,
  backupRoot,
  {reason = 'manual', version = 'unknown'} = {},
) {
  const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
  await mkdir(backupRoot, {recursive: true});
  const stage = join(backupRoot, '.partial-' + id),
    destination = join(backupRoot, id);
  await mkdir(join(stage, 'data', 'objects'), {recursive: true});
  try {
    const source = new DatabaseSync(join(dataDir, 'books.sqlite'), {readOnly: true});
    try {
      await sqliteBackup(source, join(stage, 'data', 'books.sqlite'));
    } finally {
      source.close();
    }
    // Objects are immutable in this application. Copy after the online DB snapshot;
    // any subsequently uploaded object is harmless extra data. Never omit a referenced object.
    for (const name of await readdir(join(dataDir, 'objects')).catch((e) => {
      if (e.code === 'ENOENT') return [];
      throw e;
    })) {
      if (!/^[a-f0-9]{64}$/.test(name)) continue;
      await regular(join(dataDir, 'objects', name));
      await copyFile(join(dataDir, 'objects', name), join(stage, 'data', 'objects', name));
    }
    const files = [];
    for (const name of [
      'books.sqlite',
      ...(await readdir(join(stage, 'data', 'objects'))).map((n) => 'objects/' + n),
    ]) {
      const p = join(stage, 'data', name),
        s = await regular(p);
      files.push({name, size: s.size, sha256: await hashFile(p)});
    }
    const manifest = {
      format: 'tradedesk-desktop-backup',
      version: 1,
      appVersion: version,
      id,
      createdAt: new Date().toISOString(),
      reason,
      files,
    };
    await writeFile(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2));
    await verifyBackup(stage);
    await rename(stage, destination);
    await verifyBackup(destination);
    return manifest;
  } catch (e) {
    await rm(stage, {recursive: true, force: true});
    throw e;
  }
}
export async function verifyBackup(folder) {
  const stat = await lstat(folder);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid backup folder.');
  await regular(join(folder, 'manifest.json'));
  const m = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
  if (
    m.format !== 'tradedesk-desktop-backup' ||
    m.version !== 1 ||
    !Array.isArray(m.files) ||
    !m.files.length ||
    m.files.length > 100000
  )
    throw new Error('Unsupported backup manifest.');
  const names = new Set(),
    entries = new Map();
  for (const f of m.files) {
    if (
      !/^(books\.sqlite|objects\/[a-f0-9]{64})$/.test(f.name) ||
      names.has(f.name) ||
      !Number.isSafeInteger(f.size) ||
      f.size < 0 ||
      !/^[a-f0-9]{64}$/.test(f.sha256)
    )
      throw new Error('Invalid backup file entry.');
    names.add(f.name);
    entries.set(f.name, f);
    const path = join(folder, 'data', f.name);
    for (const d of [
      join(folder, 'data'),
      ...(f.name.startsWith('objects/') ? [join(folder, 'data', 'objects')] : []),
    ])
      if ((await lstat(d)).isSymbolicLink()) throw new Error('Backup contains a linked directory.');
    const s = await regular(path);
    if (s.size !== f.size || (await hashFile(path)) !== f.sha256)
      throw new Error('Backup file verification failed: ' + f.name);
  }
  if (!names.has('books.sqlite')) throw new Error('Database is missing.');
  const dbPath = join(folder, 'data', 'books.sqlite');
  checkDatabase(dbPath);
  const db = new DatabaseSync(dbPath, {readOnly: true});
  try {
    for (const row of db.prepare('SELECT kind,payload FROM book_events').all()) {
      const p = JSON.parse(row.payload);
      if (['attachment', 'backup_snapshot'].includes(row.kind) && typeof p.key === 'string') {
        const check = (ref) => {
          const name = 'objects/' + createHash('sha256').update(ref.key).digest('hex'),
            entry = entries.get(name);
          if (!entry)
            throw new Error('An original receipt or saved snapshot is missing from the backup.');
          if (
            (ref.sha256 && entry.sha256 !== ref.sha256) ||
            (Number.isSafeInteger(ref.size) && entry.size !== ref.size)
          )
            throw new Error('Stored receipt or snapshot checksum does not match its record.');
          return name;
        };
        const name = check(p);
        if (row.kind === 'backup_snapshot') {
          const saved = JSON.parse(await readFile(join(folder, 'data', name), 'utf8'));
          for (const f of Object.values(saved.files || {})) check(f);
        }
      }
    }
  } finally {
    db.close();
  }
  return m;
}
export async function listBackups(root) {
  const result = [];
  for (const entry of await readdir(root, {withFileTypes: true}).catch((e) => {
    if (e.code === 'ENOENT') return [];
    throw e;
  })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    try {
      const m = JSON.parse(await readFile(join(root, entry.name, 'manifest.json'), 'utf8'));
      if (m.format === 'tradedesk-desktop-backup' && m.id === entry.name)
        result.push({id: m.id, createdAt: m.createdAt, reason: m.reason, files: m.files.length});
    } catch {}
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
// Caller MUST stop the application first. No automatic deletion of the old data.
export async function restoreBackup(dataDir, folder) {
  const manifest = await verifyBackup(folder),
    parent = resolve(dataDir, '..'),
    stage = join(parent, 'restore-' + randomUUID()),
    previous = join(parent, 'before-restore-' + randomUUID());
  await mkdir(stage);
  let moved = false;
  try {
    for (const f of manifest.files) {
      const target = join(stage, f.name);
      await mkdir(resolve(target, '..'), {recursive: true});
      await copyFile(join(folder, 'data', f.name), target);
      if ((await hashFile(target)) !== f.sha256)
        throw new Error('Restored copy verification failed.');
    }
    const db = new DatabaseSync(join(stage, 'books.sqlite'));
    try {
      db.exec('DELETE FROM sessions; DELETE FROM invitations; PRAGMA journal_mode=DELETE;');
    } finally {
      db.close();
    }
    checkDatabase(join(stage, 'books.sqlite'));
    await rename(dataDir, previous);
    moved = true;
    try {
      await rename(stage, dataDir);
    } catch (e) {
      await rename(previous, dataDir);
      moved = false;
      throw e;
    }
    return {restoredId: manifest.id, previousData: previous};
  } catch (e) {
    await rm(stage, {recursive: true, force: true});
    throw e;
  }
}
