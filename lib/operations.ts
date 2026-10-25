import {z} from 'zod';
import {
  accounts,
  bankCodes,
  dateSchema,
  derive,
  documentSchema,
  lineSchema,
  totals,
  balanced,
  type Event,
  type Doc,
  type Bank,
  type ViewDoc,
  type Journal,
} from './books.ts';
import {activeEvents} from './books.ts';
export const contactSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  role: z.enum(['customer', 'supplier', 'both']),
  email: z.string().email().or(z.literal('')),
  phone: z.string().max(40),
  address: z.string().max(400),
  abn: z.string().max(30),
  notes: z.string().max(2000),
  termsDays: z.number().int().min(0).max(180),
  contractor: z.boolean(),
  archived: z.boolean().default(false),
});
export const productSchema = z.object({
  id: z.string().uuid(),
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(160),
  description: z.string().max(300),
  salePrice: lineSchema.shape.price,
  costPrice: lineSchema.shape.price,
  tax: lineSchema.shape.tax,
  saleAccount: z.string(),
  costAccount: z.string(),
  archived: z.boolean().default(false),
});
export const ruleSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  contains: z.string().trim().min(3).max(120),
  direction: z.enum(['in', 'out']),
  account: z.string(),
  tax: lineSchema.shape.tax,
  archived: z.boolean().default(false),
});
export const assetSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    serial: z.string().max(100),
    purchaseDate: dateSchema,
    cost: z.number().int().min(1).max(1000000000),
    residual: z.number().int().min(0).max(1000000000),
    lifeMonths: z.number().int().min(1).max(600),
    notes: z.string().max(1000),
    archived: z.boolean().default(false),
  })
  .refine((a) => a.residual <= a.cost, 'Residual value must not exceed cost');
export type Contact = z.infer<typeof contactSchema>;
export type Product = z.infer<typeof productSchema>;
export type BankRule = z.infer<typeof ruleSchema>;
export type Asset = z.infer<typeof assetSchema>;
export function records<T extends {id: string}>(events: Event[], kind: string): T[] {
  const map = new Map<string, T>();
  for (const e of events) if (e.kind === kind) map.set(e.payload.id, e.payload);
  return [...map.values()];
}
export function operations(events: Event[]) {
  return {
    contacts: records<Contact>(events, 'contact'),
    products: records<Product>(events, 'product'),
    rules: records<BankRule>(events, 'bank_rule'),
    assets: records<Asset>(events, 'asset'),
  };
}
export const isSale = (type: Doc['type']) => type === 'invoice' || type === 'quote';
export const isLedger = (type: Doc['type']) => type === 'invoice' || type === 'bill';
export const docLabel = (type: Doc['type']) =>
  ({invoice: 'Invoice', bill: 'Bill', quote: 'Quote', purchase_order: 'Purchase order'})[type];
export function nextNumber(events: Event[], type: Doc['type']) {
  const prefix = {invoice: 'INV', bill: 'BILL', quote: 'QUO', purchase_order: 'PO'}[type];
  const docs = derive(events).docs;
  let n = 1001;
  for (const d of docs)
    if (
      d.type === type &&
      d.number.startsWith(prefix + '-') &&
      /^\d+$/.test(d.number.slice(prefix.length + 1))
    ) {
      const value = Number(d.number.slice(prefix.length + 1));
      if (Number.isSafeInteger(value) && value < 999999999) n = Math.max(n, value + 1);
    }
  return prefix + '-' + n;
}
export function validateDocument(doc: Doc, gst: string) {
  for (const l of doc.lines) {
    const a = accounts.find((a) => a[0] === l.account);
    if (
      !a ||
      (a[2] !== (isSale(doc.type) ? 'income' : 'expense') && !(!isSale(doc.type) && a[0] === '150'))
    )
      throw new Error('Choose a valid income or expense account.');
    if (gst === 'no' && l.tax === 'gst')
      throw new Error('GST is unavailable for a business that is not registered.');
  }
  const t = totals(doc);
  if (t.total <= 0 || t.total > 1000000000)
    throw new Error('Document total must be between $0.01 and $10 million.');
}
export function transition(doc: ViewDoc, status: string) {
  const allowed: Record<string, string[]> = {
    draft: ['issued', 'void'],
    issued: doc.type === 'quote' ? ['accepted', 'declined', 'void'] : ['void'],
    accepted: ['void'],
    declined: [],
  };
  if (isLedger(doc.type) || !allowed[doc.status]?.includes(status))
    throw new Error(
      'This document cannot move to that status. Refresh and check its current status.',
    );
  return status;
}
export function convertedDocument(
  source: ViewDoc,
  id: string,
  number: string,
  date: string,
  due: string,
): Doc {
  if (
    source.type === 'quote'
      ? source.status !== 'accepted'
      : source.type !== 'purchase_order' || source.status !== 'issued'
  )
    throw new Error('Accept the quote or issue the purchase order before converting.');
  return documentSchema.parse({
    ...source,
    id,
    number,
    date,
    due,
    type: source.type === 'quote' ? 'invoice' : 'bill',
    reference: source.number + (source.reference ? ' · ' + source.reference : ''),
  });
}
// Cumulative allocation rounds once against the total, so the final payment releases every tax cent.
export function allocatedTax(tax: number, paid: number, total: number) {
  if (
    !Number.isSafeInteger(tax) ||
    !Number.isSafeInteger(paid) ||
    !Number.isSafeInteger(total) ||
    total <= 0 ||
    paid < 0 ||
    paid > total
  )
    throw new Error('Invalid payment allocation');
  return Number((BigInt(tax) * BigInt(paid) * 2n + BigInt(total)) / (2n * BigInt(total)));
}
export function paymentPlan(bank: Bank, docs: ViewDoc[], input: {docId: string; amount: number}[]) {
  if (
    !input.length ||
    input.length > 60 ||
    new Set(input.map((a) => a.docId)).size !== input.length
  )
    throw new Error('Choose each document once, up to 60 documents.');
  if (input.reduce((n, a) => n + a.amount, 0) !== Math.abs(bank.amount))
    throw new Error('Allocated amounts must equal the bank payment exactly.');
  const allocations = input.map((a) => {
    const d = docs.find((d) => d.id === a.docId);
    if (
      !d ||
      !isLedger(d.type) ||
      d.status !== 'open' ||
      bank.amount > 0 !== (d.type === 'invoice')
    )
      throw new Error('Choose outstanding invoices for money in or bills for money out.');
    if (!Number.isSafeInteger(a.amount) || a.amount <= 0 || a.amount > d.balance)
      throw new Error('An allocation must be positive and cannot exceed the amount outstanding.');
    if (bank.date < d.date)
      throw new Error('Payments before the document date require a deposit workflow.');
    return {
      ...a,
      tax:
        allocatedTax(
          d.taxTotal - (d.creditedTax || 0),
          d.paid + a.amount,
          d.total - (d.credited || 0),
        ) - (d.taxPaid ?? allocatedTax(d.taxTotal, d.paid, d.total)),
    };
  });
  const amount = Math.abs(bank.amount),
    sale = bank.amount > 0;
  const journal: Journal = {
    date: bank.date,
    reference: bank.reference,
    description: bank.description,
    lines: [
      {account: bank.account || '100', debit: sale ? amount : 0, credit: sale ? 0 : amount},
      {account: sale ? '110' : '200', debit: sale ? 0 : amount, credit: sale ? amount : 0},
    ],
  };
  if (!balanced(journal.lines)) throw new Error('Invalid payment journal');
  return {bankId: bank.id, allocations, journal};
}
export function agedDocuments(events: Event[], at: string, type: 'invoice' | 'bill') {
  events = activeEvents(events);
  // Filter effective accounting dates before deriving; future settlements/reversals must not alter an earlier report.
  const all = derive(events),
    effective = events.filter((e) => {
      const d = all.docs.find((d) => d.id === e.payload.docId);
      const date =
        e.kind === 'post'
          ? d?.date
          : e.kind === 'payment' || e.payload.gstCash
            ? e.payload.journal.date
            : ['settle', 'reverse'].includes(e.kind)
              ? e.payload.date
              : undefined;
      return !date || date <= at;
    });
  return derive(effective)
    .docs.filter((d) => d.type === type && d.status === 'open' && d.date <= at)
    .map((d) => {
      const days = Math.floor((Date.parse(at) - Date.parse(d.due)) / 86400000);
      return {
        ...d,
        days,
        bucket:
          days <= 0
            ? 'Current'
            : days <= 30
              ? '1–30 days'
              : days <= 60
                ? '31–60 days'
                : days <= 90
                  ? '61–90 days'
                  : '90+ days',
      };
    });
}
export function cashForecast(events: Event[], at: string) {
  const v = derive(events);
  let balance = v.journal
    .filter((j) => j.date <= at)
    .flatMap((j) => j.lines)
    .filter((l) => bankCodes.some((c) => c === l.account))
    .reduce((n, l) => n + l.debit - l.credit, 0);
  const pending = [...agedDocuments(events, at, 'invoice'), ...agedDocuments(events, at, 'bill')];
  return Array.from({length: 8}, (_, i) => {
    const start = new Date(Date.parse(at) + i * 7 * 86400000).toISOString().slice(0, 10),
      end = new Date(Date.parse(at) + (i * 7 + 6) * 86400000).toISOString().slice(0, 10);
    const docs = pending.filter((d) => (i === 0 ? d.due <= end : d.due >= start && d.due <= end));
    const income = docs.filter((d) => d.type === 'invoice').reduce((n, d) => n + d.balance, 0),
      out = docs.filter((d) => d.type === 'bill').reduce((n, d) => n + d.balance, 0);
    const opening = balance;
    balance += income - out;
    return {start, end, opening, income, out, closing: balance};
  });
}
export function ruleMatches(rule: BankRule, bank: Bank) {
  return (
    !rule.archived &&
    bank.amount > 0 === (rule.direction === 'in') &&
    bank.description.toLowerCase().includes(rule.contains.toLowerCase())
  );
}
export function manualJournal(input: unknown): Journal {
  const p = z
    .object({
      date: dateSchema,
      reference: z.string().trim().min(1).max(60),
      description: z.string().trim().min(5).max(500),
      lines: z
        .array(
          z.object({
            account: z.string(),
            debit: z.number().int().nonnegative().max(1000000000),
            credit: z.number().int().nonnegative().max(1000000000),
          }),
        )
        .min(2)
        .max(60),
    })
    .parse(input);
  if (!balanced(p.lines) || !p.lines.some((l) => l.debit))
    throw new Error('Journal debits and credits must balance and contain a positive amount.');
  if (
    !accounts.some(
      (a) =>
        p.lines.filter((l) => l.account === a[0]).reduce((n, l) => n + l.debit - l.credit, 0) !== 0,
    )
  )
    throw new Error('Choose different accounts so the journal produces a non-zero adjustment.');
  if (
    p.lines.some((l) =>
      [...bankCodes, '110', '120', '130', '200', '210', '220', '225'].some((c) => c === l.account),
    )
  )
    throw new Error(
      'Use banking or document workflows for bank, receivable, payable, credit, customer-funds and GST control accounts. Manual journals cannot change them.',
    );
  return {...p, source: 'manual'};
}
export function contractorWorksheet(events: Event[], from: string, to: string) {
  events = activeEvents(events);
  const v = derive(events),
    contacts = operations(events).contacts.filter((c) => c.contractor);
  return contacts.map((c) => {
    let gross = 0,
      gst = 0;
    const rows: {target: string; date: string; reference: string; gross: number; gst: number}[] =
      [];
    for (const e of events) {
      if (e.payload.gstCash && e.payload.journal.date >= from && e.payload.journal.date <= to) {
        for (const a of e.payload.gstCash.purchases) {
          const d = v.docs.find((d) => d.id === a.docId);
          if (d?.contactId === c.id && a.gross) {
            gross += a.gross;
            gst += a.amount;
            rows.push({
              target: d.id,
              date: e.payload.journal.date,
              reference: e.payload.journal.reference,
              gross: a.gross,
              gst: a.amount,
            });
          }
        }
      }
      if (e.kind === 'payment' && e.payload.journal.date >= from && e.payload.journal.date <= to) {
        for (const a of e.payload.allocations) {
          const d = v.docs.find((d) => d.id === a.docId);
          if (d?.type === 'bill' && d.contactId === c.id) {
            gross += a.amount;
            gst += a.tax;
            rows.push({
              target: d.id,
              date: e.payload.journal.date,
              reference: d.number,
              gross: a.amount,
              gst: a.tax,
            });
          }
        }
      }
      if (e.kind === 'settle' && e.payload.date >= from && e.payload.date <= to) {
        const d = v.docs.find((d) => d.id === e.payload.docId);
        if (d?.type === 'bill' && d.contactId === c.id) {
          gross += d.total;
          gst += d.taxTotal;
          rows.push({
            target: d.id,
            date: e.payload.date,
            reference: d.number,
            gross: d.total,
            gst: d.taxTotal,
          });
        }
      }
      if (
        e.kind === 'cash' &&
        e.payload.contactId === c.id &&
        e.payload.journal.date >= from &&
        e.payload.journal.date <= to
      ) {
        const bank = v.banks.find((b) => b.id === e.payload.bankId);
        if (bank && bank.amount < 0) {
          gross -= bank.amount;
          gst += e.payload.gstPurchases;
          rows.push({
            target: bank.id,
            date: bank.date,
            reference: bank.reference,
            gross: -bank.amount,
            gst: e.payload.gstPurchases,
          });
        }
      }
    }
    return {contact: c, gross, gst, rows};
  });
}
