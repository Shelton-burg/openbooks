import {z} from 'zod';
import {type Doc, totals, dateSchema, cents} from './books.ts';
import {operations} from './operations.ts';
import type {Event} from './books.ts';
const money = z.number().int().nonnegative().max(100000000);
export const receiptSchema = z.object({
  supplier: z.string().max(160),
  abn: z.string().max(30),
  address: z.string().max(400),
  reference: z.string().max(100),
  date: dateSchema.nullable(),
  due: dateSchema.nullable(),
  currency: z.literal('AUD'),
  total: money,
  gst: money,
  lines: z
    .array(
      z.object({
        description: z.string().min(1).max(300),
        gross: money,
        quantity: z
          .string()
          .regex(/^\d+(\.\d{1,2})?$/)
          .optional(),
        unitPrice: money.optional(),
        discount: money.optional(),
        tax: z.enum(['gst', 'free', 'none', 'unknown']),
      }),
    )
    .min(1)
    .max(60),
  warnings: z.array(z.string().max(300)).max(20),
});
export type Receipt = z.infer<typeof receiptSchema>;
export function receiptDraft(
  d: Doc,
  r: Receipt,
  gstRegistered: boolean,
  events: Event[] = [],
  attachmentId?: string,
) {
  const warnings = [...r.warnings];
  if (!r.date) warnings.push('Issue date was unreadable; enter it manually.');
  if (!r.due) warnings.push('No due date was found; confirm when payment was due.');
  if (r.lines.some((l) => l.tax === 'unknown'))
    warnings.push('GST treatment is unclear on some items. Check each tax selection.');
  const contacts = operations(events).contacts.filter((c) => !c.archived && c.role !== 'customer'),
    norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const matches = contacts.filter((c) =>
    r.abn && c.abn ? norm(c.abn) === norm(r.abn) : norm(c.name) === norm(r.supplier),
  );
  const contact = matches.length === 1 ? matches[0] : undefined;
  const prior = events
    .filter(
      (e) =>
        e.kind === 'document' &&
        e.payload.type === 'bill' &&
        (contact
          ? e.payload.contactId === contact.id
          : norm(e.payload.contact) === norm(r.supplier)),
    )
    .at(-1)?.payload;
  const common = prior?.lines?.every((l: any) => l.account === prior.lines[0].account)
    ? prior.lines[0].account
    : '500';
  const next: Doc = {
    ...d,
    contactId: contact?.id,
    contact: contact?.name || r.supplier,
    contactAddress: r.address || contact?.address || '',
    contactAbn: r.abn || contact?.abn || '',
    reference: r.reference,
    date: r.date || '',
    due: r.due || r.date || '',
    inclusive: true,
    lines: r.lines.map((l) => {
      const qty = l.quantity || '1',
        discount = l.discount || 0;
      const accurate =
        l.unitPrice !== undefined &&
        Math.round((cents(qty) * l.unitPrice) / 100) - discount === l.gross;
      if (!accurate)
        warnings.push(
          'Check quantity and unit price for ' +
            l.description +
            '. The receipt line total was retained.',
        );
      return {
        description: l.description,
        qty: accurate ? qty : '1',
        price: ((accurate ? l.unitPrice! : l.gross) / 100).toFixed(2),
        discount: accurate ? (discount / 100).toFixed(2) : '0',
        account: common,
        tax: gstRegistered && l.tax !== 'unknown' ? l.tax : 'none',
      };
    }),
  };
  const t = totals(next);
  if (t.total !== r.total)
    warnings.push('Items do not match the receipt total. Correct the bill before posting.');
  if (gstRegistered && t.taxTotal !== r.gst)
    warnings.push(
      'Calculated GST differs from the receipt. Check tax and rounding before posting.',
    );
  warnings.push('Confirm supplier, dates, expense accounts and business use against the original.');
  const unique = [...new Set(warnings)].slice(0, 30);
  if (attachmentId)
    next.receiptReview = {
      attachmentId,
      expectedTotal: r.total,
      expectedGst: r.gst,
      warnings: unique,
      reviewed: false,
      explanation: '',
    };
  return {document: next, warnings: unique};
}
