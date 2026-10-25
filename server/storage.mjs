import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, unlinkSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {workspaceContext} from './context.mjs';
let singleton;
export function closeDatabase() {
  if (singleton) {
    singleton.close();
    singleton = undefined;
  }
}
export const dataRoot = () => resolve(process.env.DATA_DIR || '.data');
export function rawDatabase() {
  if (singleton) return singleton;
  const root = dataRoot();
  mkdirSync(root, {recursive: true, mode: 0o700});
  singleton = new DatabaseSync(join(root, 'books.sqlite'));
  singleton.exec(
    'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;',
  );
  singleton.exec('CREATE TABLE IF NOT EXISTS community_migrations (name TEXT PRIMARY KEY)');
  if (!singleton.prepare('SELECT name FROM community_migrations WHERE name=?').get('books-v1')) {
    singleton.exec('BEGIN IMMEDIATE');
    try {
      singleton.exec(readFileSync(resolve('drizzle/0000_woozy_winter_soldier.sql'), 'utf8'));
      singleton.prepare('INSERT INTO community_migrations VALUES (?)').run('books-v1');
      singleton.exec('COMMIT');
    } catch (e) {
      singleton.exec('ROLLBACK');
      throw e;
    }
  }
  singleton.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS memberships(workspace_id TEXT NOT NULL REFERENCES workspaces(id),user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL CHECK(role IN ('owner','bookkeeper','viewer')),PRIMARY KEY(workspace_id,user_id));
 CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),workspace_id TEXT NOT NULL REFERENCES workspaces(id),expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS invitations(hash TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),email TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('bookkeeper','viewer')),expires_at INTEGER NOT NULL,created_by TEXT NOT NULL REFERENCES users(id));
 CREATE TABLE IF NOT EXISTS auth_attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,until_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS access_audit(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);`);
  return singleton;
}
function params(query, values) {
  const ctx = workspaceContext.getStore();
  if (!ctx || !/^INSERT INTO\s+book_events/i.test(query)) return values;
  const match = query.match(/book_events\s*\(([^)]+)\)/i);
  if (!match) return values;
  const cols = match[1].split(',').map((x) => x.trim());
  if (['write_guard', 'maintenance_lock'].includes(values[cols.indexOf('kind')])) return values;
  const index = cols.indexOf('payload');
  if (index < 0 || typeof values[index] !== 'string') return values;
  try {
    const payload = JSON.parse(values[index]);
    if (!payload._actor) {
      const copy = [...values];
      copy[index] = JSON.stringify({...payload, _actor: {id: ctx.userId, name: ctx.name}});
      return copy;
    }
  } catch {}
  return values;
}
export function getDatabase() {
  const sql = rawDatabase();
  const prepare = (query, values = []) => ({
    bind(...args) {
      return prepare(query, args);
    },
    async all() {
      return {results: sql.prepare(query).all(...params(query, values))};
    },
    async first() {
      return sql.prepare(query).get(...params(query, values)) || null;
    },
    runSync() {
      const r = sql.prepare(query).run(...params(query, values));
      return {success: true, meta: {changes: Number(r.changes)}};
    },
    async run() {
      return this.runSync();
    },
  });
  return {
    prepare,
    async batch(queries) {
      sql.exec('BEGIN IMMEDIATE');
      try {
        const result = queries.map((q) => q.runSync());
        sql.exec('COMMIT');
        return result;
      } catch (e) {
        sql.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
const objectPath = (key) => {
  if (typeof key !== 'string' || !key || key.length > 1000) throw new Error('Invalid object key');
  const dir = join(dataRoot(), 'objects');
  mkdirSync(dir, {recursive: true, mode: 0o700});
  return join(dir, createHash('sha256').update(key).digest('hex'));
};
export const bucket = {
  async put(key, value) {
    const bytes = Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value);
    const path = objectPath(key),
      tmp = path + '.' + randomUUID();
    writeFileSync(tmp, bytes, {mode: 0o600});
    renameSync(tmp, path);
  },
  async get(key) {
    const path = objectPath(key);
    if (!existsSync(path)) return null;
    const bytes = new Uint8Array(readFileSync(path));
    return {body: bytes, size: bytes.length, arrayBuffer: async () => bytes.buffer};
  },
  async delete(key) {
    const path = objectPath(key);
    if (existsSync(path)) unlinkSync(path);
  },
};
export const env = new Proxy({}, {get: (_, key) => (key === 'BUCKET' ? bucket : process.env[key])});
