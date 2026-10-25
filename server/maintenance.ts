import {db} from '@/db';
import {state} from '@/server/books-state';
import {audit, snapshot, readSnapshot, storage} from '@/server/recovery';
import {recurringDrafts} from '@/lib/invoicing';
import {today} from '@/lib/books';
import {sha256} from '@/lib/backup';
export async function maintain(workspaceId: string) {
  const uid = workspaceId,
    key = 'maintenance:' + today(),
    now = new Date().toISOString();
  const claim = await db()
    .prepare(
      'INSERT INTO book_events(id,owner,event_key,kind,payload,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(owner,event_key) DO UPDATE SET created_at=excluded.created_at WHERE book_events.created_at < ? AND book_events.payload=?',
    )
    .bind(
      crypto.randomUUID(),
      uid,
      key,
      'maintenance_lock',
      '{}',
      now,
      new Date(Date.now() - 30 * 60000).toISOString(),
      '{}',
    )
    .run();
  if (!claim.meta.changes) {
    const s = await state(uid),
      latest = s.events.filter((e) => e.kind === 'maintenance_result').at(-1)?.payload;
    return {
      workspaceId,
      status: latest?.date === today() && latest?.status === 'succeeded' ? 'succeeded' : 'running',
      alreadyClaimed: true,
      latest,
    };
  }
  try {
    const backupId = await snapshot(uid),
      backup = await readSnapshot(uid, backupId);
    for (const file of Object.values(backup.files) as {
      key: string;
      size: number;
      sha256: string;
    }[]) {
      const obj = await storage().get(file.key);
      if (
        !obj ||
        obj.size !== file.size ||
        (await sha256(new Uint8Array(await obj.arrayBuffer()))) !== file.sha256
      )
        throw new Error('Saved backup receipt verification failed.');
    }
    const s = await state(uid),
      drafts = recurringDrafts(s),
      revision = s.events.at(-1)?.id || 'empty';
    if (drafts.length) {
      const writes = [audit(uid, 'revision:' + revision, 'write_guard', {})];
      for (const p of drafts)
        writes.push(
          db()
            .prepare(
              'INSERT INTO book_events(id,owner,event_key,document_number,kind,payload,created_at) VALUES (?,?,?,?,?,?,?)',
            )
            .bind(
              crypto.randomUUID(),
              uid,
              'doc:' + p.document.id,
              'invoice:' + p.document.number.toLowerCase(),
              'document',
              JSON.stringify({...p.document, seller: s.settings}),
              now,
            ),
          audit(uid, 'recurring:' + p.ruleId + ':' + p.date, 'recurring_generated', {
            ruleId: p.ruleId,
            date: p.date,
            docId: p.document.id,
          }),
        );
      await db().batch(writes);
    }
    const result = {date: today(), status: 'succeeded', backupId, drafts: drafts.length};
    await db().batch([
      audit(uid, 'maintenance-result:' + crypto.randomUUID(), 'maintenance_result', result),
      db()
        .prepare('UPDATE book_events SET payload=? WHERE owner=? AND event_key=?')
        .bind(JSON.stringify({completed: true}), uid, key),
    ]);
    const saved = (await state(uid)).events
      .filter((e) => e.kind === 'maintenance_result')
      .at(-1)?.payload;
    if (saved?.backupId !== backupId || saved.status !== 'succeeded')
      throw new Error('Maintenance read-back failed.');
    return {workspaceId, ...result};
  } catch (e) {
    const result = {date: today(), status: 'failed', message: (e as Error).message};
    await db().batch([
      audit(uid, 'maintenance-result:' + crypto.randomUUID(), 'maintenance_result', result),
      db()
        .prepare('UPDATE book_events SET created_at=? WHERE owner=? AND event_key=?')
        .bind('2000-01-01T00:00:00.000Z', uid, key),
    ]);
    return {workspaceId, ...result};
  }
}
