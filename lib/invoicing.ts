import {z} from 'zod';
import {
  derive,
  documentSchema,
  dateSchema,
  money,
  today,
  lineTotals,
  type State,
  type Event,
  type Doc,
} from './books.ts';
import {operations, nextNumber} from './operations.ts';
import {contactStatement} from './finance.ts';
import {invoiceChecks} from './compliance.ts';
export const recurrenceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  templateId: z.string().uuid(),
  start: dateSchema,
  cadence: z.enum(['weekly', 'monthly']),
  termsDays: z.number().int().min(0).max(180),
  paused: z.boolean(),
});
export function recurringRules(events: Event[]) {
  return [
    ...new Map(
      events.filter((e) => e.kind === 'recurring_rule').map((e) => [e.payload.id, e.payload]),
    ).values(),
  ];
}
export function occurrence(start: string, cadence: string, index: number) {
  const d = new Date(start + 'T12:00:00Z');
  if (cadence === 'weekly') {
    d.setUTCDate(d.getUTCDate() + 7 * index);
    return d.toISOString().slice(0, 10);
  }
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + index);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
export function recurringDrafts(state: State, at = today()) {
  const docs: {document: Doc; ruleId: string; date: string}[] = [];
  const provisional = [...state.events];
  for (const r of recurringRules(state.events).filter((r) => !r.paused)) {
    for (let i = 0; i < 2400; i++) {
      const date = occurrence(r.start, r.cadence, i);
      if (date > at) break;
      if (
        state.events.some(
          (e) =>
            e.kind === 'recurring_generated' &&
            e.payload.ruleId === r.id &&
            e.payload.date === date,
        )
      )
        continue;
      if (docs.length >= 12) return docs;
      if (state.settings.lockDate && date <= state.settings.lockDate) continue;
      const d = documentSchema.parse({
        ...r.template,
        id: crypto.randomUUID(),
        type: 'invoice',
        number: nextNumber(provisional, 'invoice'),
        date,
        due: new Date(Date.parse(date) + r.termsDays * 86400000).toISOString().slice(0, 10),
        receiptReview: undefined,
      });
      docs.push({document: d, ruleId: r.id, date});
      provisional.push({id: d.id, kind: 'document', payload: d, createdAt: ''});
    }
  }
  return docs;
}
export const emailRequestSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['invoice', 'reminder', 'statement']),
  docId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  note: z.string().max(1500).default(''),
});
export function emailDraft(state: State, input: unknown) {
  const p = emailRequestSchema.parse(input),
    v = derive(state.events),
    d = v.docs.find((d) => d.id === p.docId);
  const contact = operations(state.events).contacts.find(
    (c) => c.id === (p.kind === 'statement' ? p.contactId : d?.contactId) && !c.archived,
  );
  if (!contact?.email || !z.string().email().safeParse(contact.email).success)
    throw new Error('Link a saved customer with a valid email address first.');
  let content = '',
    subject = '',
    signature = '';
  if (p.kind === 'statement') {
    const rows = contactStatement(state.events, contact.id, 'invoice', today());
    subject = 'Account statement · ' + state.settings.name;
    content = [
      'Account statement as at ' + today(),
      contact.name,
      ...rows.map((r) =>
        [
          r.date,
          r.reference,
          r.description,
          'Debit ' + money(r.debit),
          'Credit ' + money(r.credit),
          'Balance ' + money(r.balance),
        ].join(' | '),
      ),
      'Balance ' + money(rows.at(-1)?.balance || 0),
      'Includes documents linked to this customer. Unassigned opening balances are excluded.',
    ].join('\n');
    signature = JSON.stringify({
      rows,
      recipient: contact.email,
      customer: contact.name,
      business: state.settings.name,
      date: today(),
    });
  } else {
    if (!d || d.type !== 'invoice' || !d.posted || d.status === 'void')
      throw new Error('Choose a posted customer invoice.');
    const issues = invoiceChecks(d);
    if (issues.length) throw new Error(issues.join(' '));
    if (p.kind === 'reminder' && (d.balance <= 0 || d.due >= today()))
      throw new Error('Reminders are available for overdue unpaid invoices.');
    subject =
      (p.kind === 'reminder' ? 'Payment reminder · ' : 'Invoice ') +
      d.number +
      ' · ' +
      state.settings.name;
    const seller = d.seller || state.settings;
    content = [
      seller.gst === 'yes' ? 'TAX INVOICE' : 'INVOICE',
      seller.name,
      'ABN ' + seller.abn,
      seller.address,
      'Invoice ' + d.number,
      'Issued ' + d.date + ' | Due ' + d.due,
      'Bill to ' + d.contact,
      d.contactAddress,
      d.contactAbn ? 'Customer ABN ' + d.contactAbn : '',
      d.job ? 'Job: ' + d.job : '',
      ...d.lines.map((l) => {
        const t = lineTotals(l, d.inclusive);
        return (
          l.description +
          ' | Qty ' +
          l.qty +
          ' | Unit ' +
          money(Math.round(Number(l.price) * 100)) +
          (l.discount ? ' | Discount ' + money(Math.round(Number(l.discount) * 100)) : '') +
          ' | GST ' +
          money(t.tax) +
          ' | Total ' +
          money(t.total)
        );
      }),
      'Subtotal ' + money(d.net),
      'GST ' + money(d.taxTotal),
      'Total AUD ' + money(d.total),
      'Paid / credited ' + money(d.paid + d.credited),
      'Outstanding ' + money(d.balance),
      'Payment: ' + seller.bankName,
      'BSB ' + seller.bsb + ' | Account ' + seller.bankAccount,
      'Use reference ' + d.number,
      seller.terms,
      d.notes,
    ]
      .filter(Boolean)
      .join('\n');
    signature = JSON.stringify({doc: d, recipient: contact.email});
  }
  return {
    ...p,
    to: contact.email,
    contactId: contact.id,
    subject,
    text: [p.note, content].filter(Boolean).join('\n\n'),
    signature,
    preparedAt: new Date().toISOString(),
  };
}
export function emailHtml(text: string) {
  return (
    '<div style="font-family:Arial,sans-serif;color:#152c49;max-width:720px;margin:auto;white-space:pre-wrap;line-height:1.6">' +
    text.replace(
      /[&<>"']/g,
      (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]!,
    ) +
    '</div>'
  );
}
