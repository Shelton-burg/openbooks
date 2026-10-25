import {db} from '@/db';
import {defaultSettings, type Event, type Settings} from '@/lib/books';
export async function state(uid: string) {
  const [records, profile] = await Promise.all([
    db()
      .prepare('SELECT id,kind,payload,created_at FROM book_events WHERE owner=? ORDER BY seq ASC')
      .bind(uid)
      .all(),
    db()
      .prepare('SELECT payload FROM book_settings WHERE owner=?')
      .bind(uid)
      .first<{payload: string}>(),
  ]);
  const events: Event[] = records.results.map((r: any) => ({
    id: r.id,
    kind: r.kind,
    payload: JSON.parse(r.payload),
    createdAt: r.created_at,
  }));
  const saved = profile ? (JSON.parse(profile.payload) as Settings) : defaultSettings;
  const reference = events.find((e) => e.kind === 'xero_reference')?.payload;
  const settings = {
    ...saved,
    bankLabels: {
      ...(reference
        ? Object.fromEntries(
            reference.banks.map((b: {account: string; name: string}) => [b.account, b.name]),
          )
        : {}),
      ...saved.bankLabels,
    },
  };
  if (reference && settings.name === defaultSettings.name) settings.name = reference.company;
  return {events, settings};
}
