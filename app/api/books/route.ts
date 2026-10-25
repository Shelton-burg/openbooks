import {state} from '@/server/books-state';
import {withWorkspace} from '@/server/auth';
import {headers} from '@/server/auth';
import {z} from 'zod';
import {db} from '@/db';
import {
  defaultSettings,
  settingsSchema,
  documentSchema,
  dateSchema,
  derive,
  totals,
  accounts,
  balanced,
  lineTotals,
  validAbn,
  bankCodes,
  bankFingerprint,
  transferJournal,
  type Event,
  type Settings,
} from '@/lib/books';
import {
  contactSchema,
  productSchema,
  ruleSchema,
  assetSchema,
  operations,
  validateDocument,
  isLedger,
  transition,
  convertedDocument,
  paymentPlan,
  manualJournal,
  nextNumber,
} from '@/lib/operations';
import {
  reviewSchema,
  purchaseSources,
  validateReview,
  invoiceChecks,
  snapshotSchema,
  taxSnapshot,
} from '@/lib/compliance';
import {
  creditPlan,
  applyCreditPlan,
  creditRefundPlan,
  fundPlan,
  applyFundPlan,
  fundRefundPlan,
  checkFinanceDate,
} from '@/lib/finance';
import {attachments, duplicateBill, receiptIssues, unmatchPlan} from '@/lib/reliability';
import {recurrenceSchema, recurringDrafts} from '@/lib/invoicing';
import {importSpecSchema, makeImportPlan} from '@/lib/imports';
import {cutoverComparison} from '@/lib/cutover';
export const dynamic = 'force-dynamic';
const json = (v: unknown, status = 200) =>
  Response.json(v, {status, headers: {'Cache-Control': 'private, no-store'}});
async function owner() {
  const h = await headers();
  const id = h.get('oai-authenticated-user-id');
  if (!id) throw new Error('SIGN_IN');
  return id;
}

function insert(
  uid: string,
  key: string,
  kind: string,
  payload: unknown,
  bank: string | null = null,
  number: string | null = null,
) {
  return db()
    .prepare(
      'INSERT INTO book_events (id,owner,event_key,bank_use,document_number,kind,payload,created_at) VALUES (?,?,?,?,?,?,?,?)',
    )
    .bind(
      crypto.randomUUID(),
      uid,
      key,
      bank,
      number,
      kind,
      JSON.stringify(payload),
      new Date().toISOString(),
    );
}
function checkDate(date: string, settings: Settings) {
  dateSchema.parse(date);
  if (settings.lockDate && date <= settings.lockDate)
    throw new Error('This date is in a locked period. Choose a later date.');
}
function requireSetup(s: Settings) {
  if (s.name === 'My plumbing business' || s.gst === 'unconfirmed')
    throw new Error('Complete your business name and GST registration in Settings first.');
  if (s.gst === 'yes' && !validAbn(s.abn))
    throw new Error('Enter a valid Australian Business Number in Settings.');
}
function err(e: unknown) {
  const m = e instanceof Error ? e.message : 'Unexpected error';
  if (m === 'SIGN_IN') return json({error: 'Please sign in to continue.'}, 401);
  if (e instanceof z.ZodError) return json({error: e.issues.map((x) => x.message).join('. ')}, 400);
  if (m.includes('UNIQUE constraint'))
    return json(
      {error: 'This record was already saved, matched or posted. Refresh before trying again.'},
      409,
    );
  console.error('Bookkeeping operation failed:', m);
  return json(
    {
      error: m.includes('D1_')
        ? 'Storage is temporarily unavailable. Your input has been preserved.'
        : m,
    },
    400,
  );
}
async function GETImpl() {
  try {
    return json(await state(await owner()));
  } catch (e) {
    return err(e);
  }
}
async function POSTImpl(request: Request) {
  try {
    const uid = await owner();
    const origin = request.headers.get('origin');
    if (
      request.headers.get('sec-fetch-site') === 'cross-site' ||
      (origin && origin !== new URL(process.env.APP_ORIGIN || request.url).origin)
    )
      return json({error: 'Invalid request origin.'}, 403);
    if (!request.headers.get('content-type')?.includes('application/json'))
      return json({error: 'JSON required'}, 415);
    const bodyText = await request.text();
    if (bodyText.length > 750000)
      return json({error: 'Import is too large. Use at most 300 rows.'}, 413);
    const b = JSON.parse(bodyText),
      s = await state(uid),
      v = derive(s.events),
      ops = operations(s.events);
    // Repeating a draft save after a lost response returns the already-saved result.
    if (b.action === 'document') {
      const incoming = documentSchema.parse(b.document),
        existing = v.docs.find((d) => d.id === incoming.id);
      if (
        existing &&
        existing.status === 'draft' &&
        JSON.stringify(documentSchema.parse(existing)) === JSON.stringify(incoming) &&
        (!b.attachmentId ||
          attachments(s.events).some(
            (e) => e.payload.id === b.attachmentId && e.payload.target === incoming.id,
          ))
      )
        return json(s);
    }
    if (
      b.action === 'commitImport' &&
      s.events.some((e) => e.kind === 'import_commit' && e.payload.previewId === b.previewId)
    )
      return json(s);
    if (
      b.action === 'previewImport' &&
      s.events.some((e) => e.kind === 'import_preview' && e.payload.id === b.id)
    )
      return json(s);
    const revision = s.events.at(-1)?.id || 'empty';
    if (b.revision !== revision)
      return json(
        {
          error:
            'Your books changed in another tab. The latest records have been loaded; review your input and save again.',
          state: s,
        },
        409,
      );
    const writes: ReturnType<typeof insert>[] = [];
    // A unique owner/revision key serializes all writes against the snapshot they validated.
    // D1 batch rollback keeps this guard, period locks and every posting atomic.
    const checkOpening = (date: string) => {
      const opening = s.events.find((e) => e.kind === 'opening');
      if (opening && date <= opening.payload.journal.date)
        throw new Error('Transaction date must be after the opening balance date.');
    };
    const commit = () =>
      db().batch([insert(uid, 'revision:' + revision, 'write_guard', {}), ...writes]);
    const prepareReceipt = (d: any) => {
      const duplicate = duplicateBill(d, s.events);
      if (duplicate)
        throw new Error(
          'Supplier reference already exists on ' +
            duplicate.number +
            '. Open the existing bill instead.',
        );
      const id = d.receiptReview?.attachmentId || b.attachmentId;
      if (!id) return;
      const file = attachments(s.events).find((e) => e.payload.id === id);
      if (!file || !['inbox', d.id].includes(file.payload.target))
        throw new Error('Choose an uploaded receipt that is not linked to another record.');
      if (file.payload.target === 'inbox')
        writes.push(
          insert(uid, 'attachment-link:' + id, 'attachment_link', {
            attachmentId: id,
            target: d.id,
          }),
        );
    };

    if (b.action === 'settings') {
      const p = settingsSchema.parse(b.settings);
      if (p.gst === 'yes' && !validAbn(p.abn))
        throw new Error('Please enter a valid 11-digit ABN.');
      const old = s.settings;
      if (
        s.events.some((e) => ['post', 'cash', 'customer_fund'].includes(e.kind)) &&
        p.gst !== old.gst
      )
        throw new Error(
          'GST registration cannot be changed after posting. A dated registration change needs accountant review.',
        );
      if (
        s.events.some((e) =>
          ['post', 'cash', 'payment', 'settle', 'customer_fund'].includes(e.kind),
        ) &&
        old.gstBasis !== 'unconfirmed' &&
        p.gstBasis !== old.gstBasis
      )
        throw new Error(
          'GST reporting basis cannot be changed after posting. A basis change needs a dated transition and accountant review.',
        );
      if (
        p.taxSetupConfirmed &&
        (p.name === defaultSettings.name ||
          !p.entityType ||
          p.entityType === 'unconfirmed' ||
          p.gst === 'unconfirmed' ||
          (p.gst === 'yes' && p.gstBasis === 'unconfirmed'))
      )
        throw new Error(
          'Confirm business structure, GST registration and applicable GST reporting basis first.',
        );
      if (old.lockDate && (!p.lockDate || p.lockDate < old.lockDate))
        throw new Error('A locked period cannot be reopened in this version.');
      writes.push(
        db()
          .prepare(
            'INSERT INTO book_settings(owner,payload) VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET payload=excluded.payload',
          )
          .bind(uid, JSON.stringify(p)),
        insert(uid, 'settings:' + crypto.randomUUID(), 'settings', {before: old, after: p}),
      );
    } else if (b.action === 'document') {
      const d = documentSchema.parse(b.document);
      checkDate(d.date, s.settings);
      validateDocument(d, s.settings.gst);
      prepareReceipt(d);
      if (d.contactId && !ops.contacts.some((c) => c.id === d.contactId && !c.archived))
        throw new Error('Choose an active saved contact.');
      writes.push(
        insert(
          uid,
          'doc:' + d.id,
          'document',
          {...d, seller: s.settings},
          null,
          d.type + ':' + d.number.toLowerCase(),
        ),
      );
    } else if (b.action === 'post' || b.action === 'discard') {
      const d = v.docs.find((d) => d.id === b.id);
      if (!d || !isLedger(d.type) || d.status !== 'draft')
        throw new Error('Only a draft can be posted or discarded.');
      if (b.action === 'post') {
        const issues = [...invoiceChecks(d), ...receiptIssues(d, s.events)];
        if (issues.length) throw new Error(issues.join(' '));
        requireSetup(s.settings);
        checkDate(d.date, s.settings);
        checkOpening(d.date);
        if (
          !d.seller ||
          d.seller.name !== s.settings.name ||
          d.seller.abn !== s.settings.abn ||
          d.seller.gst !== s.settings.gst
        )
          throw new Error(
            'Business details changed since this draft. Edit and save this draft to refresh its business details.',
          );
      }
      writes.push(insert(uid, 'state:' + d.id, b.action, {docId: d.id}));
    } else if (b.action === 'importBank') {
      const rows = z
        .array(
          z.object({
            date: dateSchema,
            description: z.string().trim().min(1).max(500),
            amount: z
              .number()
              .int()
              .min(-1000000000)
              .max(1000000000)
              .refine((x) => x !== 0),
            reference: z.string().trim().min(1).max(160),
          }),
        )
        .min(1)
        .max(300)
        .parse(b.rows);
      const account = z.enum(bankCodes).parse(b.account || '100');
      const keys = new Set<string>();
      const tasks = [];
      for (const row of rows) {
        checkDate(row.date, s.settings);
        const fingerprint = bankFingerprint(account, row.reference);
        if (keys.has(fingerprint)) throw new Error('Every statement row needs a unique reference.');
        keys.add(fingerprint);
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
        const id = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(
          '',
        );
        tasks.push(insert(uid, 'bank:' + id, 'bank', {...row, id, account}));
      }
      writes.push(...tasks);
    } else if (b.action === 'match' || b.action === 'payment') {
      const bank = v.banks.find((r) => r.id === b.bankId);
      if (!bank || v.usedBanks.has(bank.id)) throw new Error('Choose an unmatched bank line.');
      checkDate(bank.date, s.settings);
      checkOpening(bank.date);
      const allocations =
        b.action === 'match'
          ? [{docId: b.docId, amount: Math.abs(bank.amount)}]
          : z
              .array(
                z.object({
                  docId: z.string(),
                  amount: z.number().int().positive().max(1000000000),
                }),
              )
              .min(1)
              .max(60)
              .parse(b.allocations);
      checkFinanceDate(s.events, bank.date, ...allocations.map((a) => a.docId));
      const sum = allocations.reduce((n, a) => n + a.amount, 0),
        excess = b.retainExcess === true && bank.amount > 0 ? bank.amount - sum : 0;
      if (excess > 0) {
        const selected = allocations.map((a) => v.docs.find((d) => d.id === a.docId)),
          contactId = selected[0]?.contactId;
        if (
          !contactId ||
          selected.some(
            (d, i) =>
              !d ||
              d.contactId !== contactId ||
              d.type !== 'invoice' ||
              d.balance !== allocations[i].amount,
          )
        )
          throw new Error(
            'To retain excess money, fully settle selected invoices for one saved customer.',
          );
        const plan = paymentPlan({...bank, amount: sum}, v.docs, allocations),
          fund = fundPlan(
            s.events,
            s.settings,
            {
              id: crypto.randomUUID(),
              bankId: bank.id,
              contactId,
              kind: 'overpayment',
              tax: 'none',
              reference: bank.reference,
              reason:
                'Excess above the selected invoices, retained as a refundable customer overpayment.',
              confirmed: true,
            },
            {...bank, amount: excess},
          );
        writes.push(
          insert(uid, 'payment:' + bank.id + ':' + crypto.randomUUID(), 'payment', plan, bank.id),
          insert(uid, 'customer_fund:' + bank.id, 'customer_fund', fund),
        );
      } else {
        const plan = paymentPlan(bank, v.docs, allocations);
        writes.push(
          insert(uid, 'payment:' + bank.id + ':' + crypto.randomUUID(), 'payment', plan, bank.id),
        );
      }
    } else if (b.action === 'cash') {
      requireSetup(s.settings);
      const bank = v.banks.find((r) => r.id === b.bankId);
      if (!bank || v.usedBanks.has(bank.id)) throw new Error('Choose an unmatched statement line.');
      checkDate(bank.date, s.settings);
      checkOpening(bank.date);
      const a = accounts.find((a) => a[0] === b.account);
      if (!a) throw new Error('Choose an account');
      const sale = bank.amount > 0;
      if (
        (!['income', 'expense', 'equity', 'liability'].includes(a[2]) && a[0] !== '150') ||
        (a[0] === '150' && sale) ||
        (a[2] === 'income' && !sale) ||
        (a[2] === 'expense' && sale) ||
        ['200', '210', '220', '225'].includes(a[0])
      )
        throw new Error('Choose a suitable account for this payment.');
      const tax = z.enum(['gst', 'free', 'none']).parse(b.tax);
      if (
        tax === 'gst' &&
        (s.settings.gst !== 'yes' || (!['income', 'expense'].includes(a[2]) && a[0] !== '150'))
      )
        throw new Error('GST is not available for this account or business.');
      const t = lineTotals(
        {
          description: bank.description,
          qty: '1',
          price: (Math.abs(bank.amount) / 100).toFixed(2),
          tax,
          account: a[0],
        },
        true,
      );
      const lines = [
        {account: bank.account || '100', debit: sale ? t.total : 0, credit: sale ? 0 : t.total},
        {account: a[0], debit: sale ? 0 : t.net, credit: sale ? t.net : 0},
      ];
      if (t.tax)
        lines.push({
          account: sale ? '210' : '120',
          debit: sale ? 0 : t.tax,
          credit: sale ? t.tax : 0,
        });
      if (!balanced(lines)) throw new Error('Unbalanced transaction');
      if (b.contactId && !ops.contacts.some((c) => c.id === b.contactId && !c.archived))
        throw new Error('Choose an active contact.');
      writes.push(
        insert(
          uid,
          'cash:' + bank.id + ':' + crypto.randomUUID(),
          'cash',
          {
            bankId: bank.id,
            contactId: b.contactId || undefined,
            journal: {
              date: bank.date,
              reference: bank.reference,
              description: bank.description,
              lines,
            },
            gstSales: sale ? t.tax : 0,
            gstPurchases: sale ? 0 : t.tax,
            grossSales: a[2] === 'income' ? t.total : 0,
          },
          bank.id,
        ),
      );
    } else if (b.action === 'transfer') {
      const first = v.banks.find((r) => r.id === b.bankId),
        second = v.banks.find((r) => r.id === b.otherBankId);
      if (!first || !second || v.usedBanks.has(first.id) || v.usedBanks.has(second.id))
        throw new Error('Choose two unmatched statement lines.');
      checkDate(first.date, s.settings);
      checkDate(second.date, s.settings);
      checkOpening(first.date);
      const journal = transferJournal(first, second),
        ids = [first.id, second.id].sort(),
        key = 'transfer:' + ids.join(':') + ':' + crypto.randomUUID();
      writes.push(
        insert(uid, key, 'transfer', {bankIds: ids, journal}, first.id),
        insert(
          uid,
          key + ':linked',
          'transfer_link',
          {bankId: second.id, reference: 'Bank transfer', transferKey: key},
          second.id,
        ),
      );
    } else if (b.action === 'unmatch') {
      const p = unmatchPlan(s.events, b.eventId, b.reason, s.settings);
      writes.push(insert(uid, 'unmatch:' + b.eventId, 'bank_unmatch', p));
      for (const id of p.targetEventIds)
        writes.push(
          db().prepare('UPDATE book_events SET bank_use=NULL WHERE owner=? AND id=?').bind(uid, id),
        );
    } else if (b.action === 'reverse') {
      const d = v.docs.find((d) => d.id === b.id);
      if (
        !d ||
        !isLedger(d.type) ||
        d.status !== 'open' ||
        d.paid !== 0 ||
        d.credited !== 0 ||
        v.credits.some((c) => c.sourceDocId === d.id)
      )
        throw new Error('Only an entirely unpaid posted document can be reversed.');
      const date = dateSchema.parse(b.date),
        reason = z.string().trim().min(5).max(300).parse(b.reason);
      checkDate(date, s.settings);
      if (date < d.date) throw new Error('A reversal cannot predate its document.');
      writes.push(insert(uid, 'reverse:' + d.id, 'reverse', {docId: d.id, date, reason}));
    } else if (b.action === 'opening') {
      const date = dateSchema.parse(b.date);
      checkDate(date, s.settings);
      const lines = z
        .array(
          z.object({
            account: z.string(),
            debit: z.number().int().nonnegative().max(1000000000),
            credit: z.number().int().nonnegative().max(1000000000),
          }),
        )
        .min(2)
        .max(30)
        .parse(b.lines);
      if (
        !balanced(lines) ||
        !lines.some((l) => l.debit) ||
        lines.some((l) =>
          ['income', 'expense'].includes(accounts.find((a) => a[0] === l.account)![2]),
        )
      )
        throw new Error('Opening balances must balance and use balance sheet accounts only.');
      if (
        s.events.some(
          (e) =>
            [
              'post',
              'cash',
              'settle',
              'payment',
              'transfer',
              'manual_journal',
              'credit_note',
              'credit_apply',
              'credit_refund',
              'customer_fund',
              'fund_apply',
              'fund_refund',
            ].includes(e.kind) &&
            (e.payload.date ||
              v.docs.find((d) => d.id === e.payload.docId)?.date ||
              e.payload.journal?.date ||
              '9999') <= date,
        )
      )
        throw new Error('Opening date must be before existing posted transactions.');
      writes.push(
        insert(uid, 'opening', 'opening', {
          journal: {
            date,
            reference: 'OPENING',
            description: 'Opening balances entered by owner',
            lines,
          },
        }),
      );
    } else if (b.action === 'importDocuments') {
      const docs = z.array(documentSchema).min(1).max(200).parse(b.documents),
        numbers = new Set<string>();
      for (const d of docs) {
        if (!['invoice', 'bill'].includes(d.type))
          throw new Error('Only invoices and bills can be imported here.');
        checkDate(d.date, s.settings);
        validateDocument(d, s.settings.gst);
        if (
          duplicateBill(d, [
            ...s.events,
            ...b.documents
              .filter((x: any) => x.id !== d.id)
              .map((x: any) => ({id: x.id, kind: 'document', payload: x, createdAt: ''})),
          ])
        )
          throw new Error('Repeated supplier reference in the import.');
        const key = d.type + ':' + d.number.toLowerCase();
        if (
          numbers.has(key) ||
          v.docs.some((x) => x.type === d.type && x.number.toLowerCase() === d.number.toLowerCase())
        )
          throw new Error('Duplicate document: ' + d.number);
        numbers.add(key);
        if (d.contactId && !ops.contacts.some((c) => c.id === d.contactId && !c.archived))
          throw new Error('Choose an active saved contact.');
        writes.push(insert(uid, 'doc:' + d.id, 'document', {...d, seller: s.settings}, null, key));
      }
    } else if (b.action === 'recurringRule') {
      const p = recurrenceSchema.parse(b.record),
        template = v.docs.find((d) => d.id === p.templateId);
      if (!template || template.type !== 'invoice' || template.status === 'void')
        throw new Error('Choose an invoice as the recurring template.');
      writes.push(
        insert(uid, 'recurrence:' + crypto.randomUUID(), 'recurring_rule', {
          ...p,
          template: documentSchema.parse(template),
        }),
      );
    } else if (b.action === 'runRecurring') {
      for (const p of recurringDrafts(s)) {
        checkDate(p.document.date, s.settings);
        writes.push(
          insert(
            uid,
            'doc:' + p.document.id,
            'document',
            {...p.document, seller: s.settings},
            null,
            'invoice:' + p.document.number.toLowerCase(),
          ),
          insert(uid, 'recurring:' + p.ruleId + ':' + p.date, 'recurring_generated', {
            ruleId: p.ruleId,
            date: p.date,
            docId: p.document.id,
          }),
        );
      }
    } else if (b.action === 'cutoverComparison') {
      writes.push(
        insert(
          uid,
          'comparison:' + crypto.randomUUID(),
          'cutover_comparison',
          cutoverComparison(s, b.comparison),
        ),
      );
    } else if (b.action === 'migrationNote') {
      const p = z
        .object({
          area: z.enum([
            'exports',
            'opening',
            'bank',
            'receivables',
            'payables',
            'gst',
            'backup',
            'accountant',
          ]),
          status: z.enum(['todo', 'in_progress', 'owner_checked']),
          notes: z.string().trim().min(10).max(2000),
          date: dateSchema,
        })
        .parse(b.record);
      writes.push(insert(uid, 'migration:' + crypto.randomUUID(), 'migration_note', p));
    } else if (b.action === 'previewImport') {
      const id = z.string().uuid().parse(b.id),
        sourceId = z.string().uuid().parse(b.sourceId),
        source = attachments(s.events).find(
          (e) => e.payload.id === sourceId && e.payload.target === 'import_inbox',
        );
      if (!source) throw new Error('Upload an original file to the Import centre first.');
      if (s.events.some((e) => e.kind === 'import_commit' && e.payload.sourceId === sourceId))
        throw new Error('This file was already imported. Open its import history.');
      const spec = importSpecSchema.parse(b.spec),
        plan = makeImportPlan(spec, s, sourceId);
      writes.push(
        insert(uid, 'import-preview:' + id, 'import_preview', {
          id,
          sourceId,
          spec,
          plan,
          sourceHash: source.payload.sha256,
          sourceRevision: revision,
        }),
      );
    } else if (b.action === 'commitImport') {
      if (b.confirmed !== true)
        throw new Error('Review the preview and confirm it before importing.');
      const preview = s.events.find(
        (e) => e.kind === 'import_preview' && e.payload.id === b.previewId,
      )?.payload;
      if (!preview) throw new Error('Prepare an import preview first.');
      if (
        s.events.some((e) => e.kind === 'import_commit' && e.payload.sourceId === preview.sourceId)
      )
        throw new Error('This file was already imported.');
      const source = attachments(s.events).find(
        (e) => e.payload.id === preview.sourceId && e.payload.target === 'import_inbox',
      );
      if (!source || source.payload.sha256 !== preview.sourceHash)
        throw new Error('The original import file has changed.');
      const plan = makeImportPlan(preview.spec, s, preview.sourceId);
      const comparable = (p: any) =>
        JSON.stringify({
          ...p,
          documents: p.documents.map(({id, ...d}: any) => d),
          contacts: p.contacts.map(({id, ...c}: any) => c),
        });
      if (comparable(plan) !== comparable(preview.plan))
        throw new Error(
          'Your books or settings changed since this preview. Prepare a fresh preview.',
        );
      if (plan.errors.length) throw new Error('Fix all import errors and prepare a fresh preview.');
      if (!plan.count && !plan.skipped.length) throw new Error('There is nothing to import.');
      const records: {kind: string; id: string}[] = [];
      for (const c of plan.contacts) {
        writes.push(insert(uid, 'contact:' + c.id, 'contact', c));
        records.push({kind: 'contact', id: c.id});
      }
      for (const d of plan.documents) {
        checkDate(d.date, s.settings);
        writes.push(
          insert(
            uid,
            'doc:' + d.id,
            'document',
            {...d, seller: s.settings},
            null,
            d.type + ':' + d.number.toLowerCase(),
          ),
        );
        records.push({kind: d.type, id: d.id});
      }
      for (const row of plan.banks) {
        checkDate(row.date, s.settings);
        const digest = await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(bankFingerprint(row.account || '100', row.reference)),
          ),
          id = [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
        writes.push(insert(uid, 'bank:' + id, 'bank', {...row, id}));
        records.push({kind: 'bank', id});
      }
      if (plan.kind === 'trial_balance')
        writes.push(
          insert(uid, 'import-balance:' + preview.sourceId, 'import_balance_reference', {
            sourceId: preview.sourceId,
            date: preview.spec.date,
            balances: plan.balances,
            debits: plan.debits,
            credits: plan.credits,
            notes: preview.spec.notes,
          }),
        );
      writes.push(
        insert(uid, 'import:' + preview.sourceId, 'import_commit', {
          sourceId: preview.sourceId,
          sourceHash: preview.sourceHash,
          previewId: preview.id,
          kind: plan.kind,
          count: plan.count,
          records,
          skipped: plan.skipped,
          warnings: plan.warnings,
          notes: preview.spec.notes,
          referenceOnly: ['reference', 'trial_balance'].includes(plan.kind),
        }),
      );
    } else if (b.action === 'importContacts') {
      const rows = z.array(contactSchema).min(1).max(300).parse(b.rows),
        names = new Set(ops.contacts.map((c) => c.name.toLowerCase()));
      for (const row of rows) {
        if (names.has(row.name.toLowerCase()))
          throw new Error('Contact already exists or is repeated in this file: ' + row.name);
        if (row.abn && !validAbn(row.abn)) throw new Error('Invalid ABN for ' + row.name);
        names.add(row.name.toLowerCase());
        writes.push(insert(uid, 'contact:' + row.id, 'contact', row));
      }
    } else if (['contact', 'product', 'bank_rule', 'asset'].includes(b.action)) {
      const schemas = {
        contact: contactSchema,
        product: productSchema,
        bank_rule: ruleSchema,
        asset: assetSchema,
      };
      const p = schemas[b.action as keyof typeof schemas].parse(b.record) as any;
      if (b.action === 'contact' && p.abn && !validAbn(p.abn))
        throw new Error('Enter a valid ABN or leave it blank until confirmed.');
      if (b.action === 'product') {
        if (s.settings.gst === 'no' && p.tax === 'gst')
          throw new Error('Choose No GST for a business that is not registered.');
        if (
          !accounts.some((a) => a[0] === p.saleAccount && a[2] === 'income') ||
          !accounts.some((a) => a[0] === p.costAccount && a[2] === 'expense')
        )
          throw new Error('Choose income and expense accounts for the item.');
        if (
          ops.products.some((x) => x.id !== p.id && x.code.toLowerCase() === p.code.toLowerCase())
        )
          throw new Error('That product code already exists.');
      }
      if (b.action === 'bank_rule') {
        if (
          !accounts.some(
            (a) =>
              a[0] === p.account &&
              (a[2] === (p.direction === 'in' ? 'income' : 'expense') ||
                ['300', '250'].includes(a[0])),
          )
        )
          throw new Error('Choose a suitable account for this rule.');
        if (
          p.tax === 'gst' &&
          (!['income', 'expense'].includes(accounts.find((a) => a[0] === p.account)![2]) ||
            s.settings.gst !== 'yes')
        )
          throw new Error('GST is unavailable for this account or business.');
      }
      writes.push(insert(uid, b.action + ':' + p.id + ':' + crypto.randomUUID(), b.action, p));
    } else if (b.action === 'editDocument') {
      const d = v.docs.find((d) => d.id === b.document?.id);
      if (!d || d.status !== 'draft') throw new Error('Only drafts can be edited.');
      const p = documentSchema.parse(b.document);
      if (p.type !== d.type || p.number !== d.number)
        throw new Error('Keep the original type and number when editing.');
      checkDate(p.date, s.settings);
      validateDocument(p, s.settings.gst);
      prepareReceipt(p);
      if (p.contactId && !ops.contacts.some((c) => c.id === p.contactId && !c.archived))
        throw new Error('Choose an active contact.');
      writes.push(
        insert(uid, 'edit:' + p.id + ':' + crypto.randomUUID(), 'document_edit', {
          docId: p.id,
          document: {...p, seller: s.settings},
        }),
      );
    } else if (b.action === 'workflowStatus') {
      const d = v.docs.find((d) => d.id === b.id);
      if (!d) throw new Error('Document not found.');
      const status = transition(d, b.status);
      if (status === 'issued') {
        requireSetup(s.settings);
        checkDate(d.date, s.settings);
        if (
          d.seller?.name !== s.settings.name ||
          d.seller?.abn !== s.settings.abn ||
          d.seller?.gst !== s.settings.gst
        )
          throw new Error(
            'Business details changed. Edit and save this draft to refresh them first.',
          );
      }
      writes.push(
        insert(uid, 'workflow:' + d.id + ':' + crypto.randomUUID(), 'workflow_status', {
          docId: d.id,
          status,
        }),
      );
    } else if (b.action === 'convert') {
      const d = v.docs.find((d) => d.id === b.id);
      if (!d) throw new Error('Document not found.');
      const targetType = d.type === 'quote' ? 'invoice' : 'bill';
      const p = convertedDocument(
        d,
        crypto.randomUUID(),
        nextNumber(s.events, targetType),
        dateSchema.parse(b.date),
        dateSchema.parse(b.due),
      );
      checkDate(p.date, s.settings);
      validateDocument(p, s.settings.gst);
      writes.push(
        insert(
          uid,
          'doc:' + p.id,
          'document',
          {...p, seller: s.settings},
          null,
          p.type + ':' + p.number.toLowerCase(),
        ),
        insert(uid, 'convert:' + d.id, 'convert', {docId: d.id, targetId: p.id}),
      );
    } else if (b.action === 'manualJournal') {
      requireSetup(s.settings);
      const journal = manualJournal(b.journal);
      checkDate(journal.date, s.settings);
      checkOpening(journal.date);
      writes.push(insert(uid, 'journal:' + crypto.randomUUID(), 'manual_journal', {journal}));
    } else if (b.action === 'reverseJournal') {
      const original = s.events.find((e) => e.id === b.id && e.kind === 'manual_journal');
      if (!original || s.events.some((e) => e.payload.reverses === b.id))
        throw new Error('Choose a manual journal that has not been reversed.');
      const date = dateSchema.parse(b.date),
        reason = z.string().trim().min(5).max(300).parse(b.reason);
      checkDate(date, s.settings);
      if (date < original.payload.journal.date)
        throw new Error('A reversal cannot predate the journal.');
      const j = original.payload.journal;
      writes.push(
        insert(uid, 'journal-reversal:' + b.id, 'manual_journal', {
          reverses: b.id,
          journal: {
            ...j,
            date,
            reference: 'REV ' + j.reference,
            description: reason,
            lines: j.lines.map((l: any) => ({...l, debit: l.credit, credit: l.debit})),
          },
        }),
      );
    } else if (b.action === 'creditNote') {
      requireSetup(s.settings);
      if (v.credits.some((c) => c.id === b.credit?.id))
        return json({error: 'This credit note was already saved.', state: s}, 409);
      const p = creditPlan(s.events, b.credit);
      checkDate(p.date, s.settings);
      checkOpening(p.date);
      writes.push(
        insert(uid, 'credit:' + p.id, 'credit_note', p, null, 'credit:' + p.number.toLowerCase()),
      );
      const d = v.docs.find((d) => d.id === p.sourceDocId)!;
      const apply = Math.min(d.balance, p.total);
      if (apply > 0) {
        const provisional = [
          ...s.events,
          {id: p.id, kind: 'credit_note', payload: p, createdAt: new Date().toISOString()},
        ];
        const a = applyCreditPlan(provisional, p.id, d.id, apply, p.date);
        writes.push(insert(uid, 'credit-apply:' + crypto.randomUUID(), 'credit_apply', a));
      }
    } else if (b.action === 'applyCredit' || b.action === 'applyFund') {
      const date = dateSchema.parse(b.date);
      checkDate(date, s.settings);
      checkOpening(date);
      const p =
        b.action === 'applyCredit'
          ? applyCreditPlan(s.events, b.creditId, b.docId, b.amount, date)
          : applyFundPlan(s.events, b.fundId, b.docId, b.amount, date);
      const kind = b.action === 'applyCredit' ? 'credit_apply' : 'fund_apply';
      writes.push(insert(uid, kind + ':' + crypto.randomUUID(), kind, p));
    } else if (['creditRefund', 'customerFund', 'fundRefund'].includes(b.action)) {
      requireSetup(s.settings);
      const bank = v.banks.find((x) => x.id === (b.bankId || b.fund?.bankId));
      if (!bank || v.usedBanks.has(bank.id)) throw new Error('Choose an unmatched statement line.');
      checkDate(bank.date, s.settings);
      checkOpening(bank.date);
      const p =
        b.action === 'creditRefund'
          ? creditRefundPlan(s.events, b.creditId, bank)
          : b.action === 'fundRefund'
            ? fundRefundPlan(s.events, b.fundId, bank)
            : fundPlan(s.events, s.settings, b.fund, bank);
      const kind =
        b.action === 'creditRefund'
          ? 'credit_refund'
          : b.action === 'fundRefund'
            ? 'fund_refund'
            : 'customer_fund';
      writes.push(insert(uid, kind + ':' + bank.id, kind, p, bank.id));
    } else if (b.action === 'purchaseReview') {
      const p = reviewSchema.parse(b.review),
        source = purchaseSources(s.events).find((x) => x.id === p.target);
      if (!source) throw new Error('Choose a posted bill or categorised expense in your books.');
      validateReview(source, p);
      if (
        p.tpar === 'include' &&
        !ops.contacts.some((c) => c.id === source.contactId && c.contractor)
      )
        throw new Error(
          'Link this purchase to a saved supplier flagged for the contractor worksheet before including it.',
        );
      writes.push(insert(uid, 'purchase-review:' + crypto.randomUUID(), 'purchase_review', p));
    } else if (b.action === 'taxSnapshot') {
      const p = snapshotSchema.parse(b.snapshot);
      writes.push(
        insert(
          uid,
          'tax-snapshot:' + crypto.randomUUID(),
          'tax_snapshot',
          taxSnapshot(s.events, s.settings, p),
        ),
      );
    } else throw new Error('Unknown action');
    await commit();
    return json(await state(uid));
  } catch (e) {
    if (e instanceof Error && e.message.includes('UNIQUE constraint')) {
      try {
        return json(
          {
            error:
              'Your books changed or this action was already saved. Review the latest records before trying again.',
            state: await state(await owner()),
          },
          409,
        );
      } catch {}
    }
    return err(e);
  }
}

export const GET = withWorkspace(GETImpl, false);

export const POST = withWorkspace(POSTImpl, true);
