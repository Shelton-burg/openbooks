import {db} from '@/db';
import {env} from '@/server/storage';
import {state} from '@/server/books-state';
import {financialSummary, sha256} from '@/lib/backup';
import {activeEvents, derive, settingsSchema, type State, type Event} from '@/lib/books';
export const storage = () => (env as unknown as {BUCKET: R2Bucket}).BUCKET;
export const audit = (uid: string, key: string, kind: string, payload: unknown) =>
  db()
    .prepare(
      'INSERT INTO book_events(id,owner,event_key,kind,payload,created_at) VALUES (?,?,?,?,?,?)',
    )
    .bind(crypto.randomUUID(), uid, key, kind, JSON.stringify(payload), new Date().toISOString());
export async function snapshot(uid: string) {
  const s = await state(uid),
    check = await state(uid);
  if (
    s.events.at(-1)?.id !== check.events.at(-1)?.id ||
    JSON.stringify(s.settings) !== JSON.stringify(check.settings)
  )
    throw new Error('Books changed during backup preparation. Retry when saving has finished.');
  const id = crypto.randomUUID(),
    prefix = 'backups/' + encodeURIComponent(uid) + '/',
    files: Record<string, {key: string; size: number; sha256: string}> = {};
  const entries = s.events.filter((e) => e.kind === 'attachment');
  if (entries.length > 4995) throw new Error('Partitioned backup is required for this many files.');
  // Content-addressed copies retain evidence independently without duplicating the same bytes every day.
  for (const e of entries) {
    const file = await storage().get(e.payload.key);
    if (!file || file.size !== e.payload.size)
      throw new Error('Missing original receipt: ' + e.payload.name);
    const bytes = new Uint8Array(await file.arrayBuffer()),
      hash = await sha256(bytes),
      key = prefix + 'files/' + hash;
    if (e.payload.sha256 && e.payload.sha256 !== hash)
      throw new Error('Original receipt checksum mismatch.');
    await storage().put(key, bytes, {httpMetadata: {contentType: e.payload.type}});
    files[e.payload.id] = {key, size: bytes.length, sha256: hash};
  }
  const data = {
    version: 1,
    id,
    createdAt: new Date().toISOString(),
    state: s,
    summary: financialSummary(s),
    files,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  if (bytes.length > 12000000) throw new Error('Partitioned record backup is required.');
  const key = prefix + id + '/snapshot.json';
  await storage().put(key, bytes);
  try {
    await db().batch([
      audit(uid, 'backup:' + id, 'backup_snapshot', {
        id,
        key,
        createdAt: data.createdAt,
        summary: data.summary,
        sha256: await sha256(bytes),
      }),
    ]);
  } catch (e) {
    await storage().delete(key);
    throw e;
  }
  return id;
}
export async function readSnapshot(uid: string, id: string) {
  const row = await db()
    .prepare('SELECT payload FROM book_events WHERE owner=? AND event_key=?')
    .bind(uid, 'backup:' + id)
    .first<{payload: string}>();
  if (!row) throw new Error('Backup not found.');
  const meta = JSON.parse(row.payload),
    object = await storage().get(meta.key);
  if (!object) throw new Error('Backup data is missing.');
  const bytes = new Uint8Array(await object.arrayBuffer());
  if ((await sha256(bytes)) !== meta.sha256) throw new Error('Backup integrity check failed.');
  const data = JSON.parse(new TextDecoder().decode(bytes));
  settingsSchema.parse(data.state.settings);
  if (JSON.stringify(financialSummary(data.state)) !== JSON.stringify(data.summary))
    throw new Error('Backup balances do not match.');
  return data;
}
export async function restoreCopy(uid: string, id: string) {
  const data = await readSnapshot(uid, id),
    restoreId = crypto.randomUUID(),
    scope = uid + '~recovery~' + restoreId,
    s: State = structuredClone(data.state),
    created: string[] = [];
  try {
    for (const e of s.events.filter((e) => e.kind === 'attachment')) {
      const file = data.files[e.payload.id];
      if (!file) throw new Error('Attachment manifest is incomplete.');
      const object = await storage().get(file.key);
      if (!object || object.size !== file.size) throw new Error('Backup receipt missing.');
      const bytes = new Uint8Array(await object.arrayBuffer());
      if ((await sha256(bytes)) !== file.sha256) throw new Error('Backup receipt checksum failed.');
      const key = 'recovery/' + encodeURIComponent(uid) + '/' + restoreId + '/' + e.payload.id;
      await storage().put(key, bytes, {httpMetadata: {contentType: e.payload.type}});
      created.push(key);
      e.payload.key = key;
    }
    // Recovery copies have a separate owner namespace and cannot be written through normal bookkeeping routes.
    const writes = [
      db()
        .prepare('INSERT INTO book_settings(owner,payload) VALUES (?,?)')
        .bind(scope, JSON.stringify(s.settings)),
      ...s.events.map((e) => audit(scope, 'restored:' + e.id, e.kind, {...e.payload})),
    ];
    // Preserve source event IDs because correction and audit references depend on them.
    for (let i = 1; i < writes.length; i++) {
      const e = s.events[i - 1];
      writes[i] = db()
        .prepare(
          'INSERT INTO book_events(id,owner,event_key,kind,payload,created_at) VALUES (?,?,?,?,?,?)',
        )
        .bind(e.id, scope, 'restored:' + e.id, e.kind, JSON.stringify(e.payload), e.createdAt);
    }
    // Batches are bounded; no copy is visible as complete until all rows and verification finish.
    for (let i = 0; i < writes.length; i += 80) await db().batch(writes.slice(i, i + 80));
    const rows = await db()
      .prepare('SELECT id,kind,payload,created_at FROM book_events WHERE owner=? ORDER BY seq')
      .bind(scope)
      .all();
    const restored: State = {
      settings: s.settings,
      events: rows.results.map((r: any) => ({
        id: r.id,
        kind: r.kind,
        payload: JSON.parse(r.payload),
        createdAt: r.created_at,
      })),
    };
    const summary = financialSummary(restored);
    if (JSON.stringify(summary) !== JSON.stringify(data.summary))
      throw new Error('Restored database balances differ.');
    await db().batch([
      audit(uid, 'recovery:' + restoreId, 'recovery_verified', {
        id: restoreId,
        backupId: id,
        scope,
        createdAt: new Date().toISOString(),
        summary,
      }),
    ]);
    return {id: restoreId, summary};
  } catch (e) {
    await db().batch([
      db().prepare('DELETE FROM book_events WHERE owner=?').bind(scope),
      db().prepare('DELETE FROM book_settings WHERE owner=?').bind(scope),
    ]);
    for (const key of created) await storage().delete(key);
    throw e;
  }
}
export async function recoveryState(uid: string, id: string) {
  const record = await db()
    .prepare('SELECT payload FROM book_events WHERE owner=? AND event_key=?')
    .bind(uid, 'recovery:' + id)
    .first<{payload: string}>();
  if (!record) throw new Error('Verified recovery copy not found.');
  const meta = JSON.parse(record.payload),
    rows = await db()
      .prepare('SELECT id,kind,payload,created_at FROM book_events WHERE owner=? ORDER BY seq')
      .bind(meta.scope)
      .all(),
    settings = await db()
      .prepare('SELECT payload FROM book_settings WHERE owner=?')
      .bind(meta.scope)
      .first<{payload: string}>();
  if (!settings) throw new Error('Recovery settings are missing.');
  return {
    settings: JSON.parse(settings.payload),
    events: rows.results.map((r: any) => ({
      id: r.id,
      kind: r.kind,
      payload: JSON.parse(r.payload),
      createdAt: r.created_at,
    })),
  } as State;
}
