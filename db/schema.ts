import {sqliteTable, text, integer, uniqueIndex, index} from 'drizzle-orm/sqlite-core';
export const events = sqliteTable(
  'book_events',
  {
    seq: integer('seq').primaryKey({autoIncrement: true}),
    id: text('id').notNull(),
    owner: text('owner').notNull(),
    key: text('event_key').notNull(),
    bankUse: text('bank_use'),
    documentNumber: text('document_number'),
    kind: text('kind').notNull(),
    payload: text('payload').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('events_owner_key').on(t.owner, t.key),
    uniqueIndex('events_owner_bank').on(t.owner, t.bankUse),
    uniqueIndex('events_owner_number').on(t.owner, t.documentNumber),
    index('events_owner_seq').on(t.owner, t.seq),
  ],
);
export const settings = sqliteTable('book_settings', {
  owner: text('owner').primaryKey(),
  payload: text('payload').notNull(),
});
