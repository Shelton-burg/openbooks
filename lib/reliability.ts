import {z} from 'zod';
import {derive, totals, activeEvents, type Event, type Doc, type Settings} from './books.ts';
export function attachments(events: Event[]) {
  return events
    .filter((e) => e.kind === 'attachment')
    .map((e) => {
      const links = events.filter(
        (l) => l.kind === 'attachment_link' && l.payload.attachmentId === e.payload.id,
      );
      return {
        ...e,
        payload: {...e.payload, target: links.at(-1)?.payload.target || e.payload.target},
      };
    });
}
export function duplicateBill(doc: Doc, events: Event[]) {
  if (doc.type !== 'bill' || !doc.reference.trim()) return;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return derive(events).docs.find(
    (d) =>
      d.id !== doc.id &&
      d.type === 'bill' &&
      d.status !== 'void' &&
      norm(d.reference || '') === norm(doc.reference) &&
      ((d.contactId && doc.contactId && d.contactId === doc.contactId) ||
        (d.contactAbn && doc.contactAbn && norm(d.contactAbn) === norm(doc.contactAbn)) ||
        norm(d.contact) === norm(doc.contact)),
  );
}
export function receiptIssues(doc: Doc, events: Event[]) {
  const r = doc.receiptReview;
  if (!r) return [];
  const issues: string[] = [];
  if (
    !attachments(events).some((e) => e.payload.id === r.attachmentId && e.payload.target === doc.id)
  )
    issues.push('Attach the original scanned receipt to this bill.');
  if (!r.reviewed) issues.push('Review and confirm the scanned details before posting.');
  const t = totals(doc);
  if (
    (t.total !== r.expectedTotal || (doc.seller?.gst === 'yes' && t.taxTotal !== r.expectedGst)) &&
    r.explanation.trim().length < 10
  )
    issues.push('Correct the receipt total/GST difference, or record why the bill differs.');
  return issues;
}
export function unmatchPlan(events: Event[], eventId: string, reason: string, settings: Settings) {
  z.string().trim().min(10).max(500).parse(reason);
  const active = activeEvents(events),
    i = active.findIndex((e) => e.id === eventId),
    e = active[i];
  if (!e || !['payment', 'cash', 'transfer', 'settle'].includes(e.kind))
    throw new Error('Choose a current bank match or categorisation.');
  const p = e.payload,
    date = p.journal?.date || p.date;
  if (!date || (settings.lockDate && date <= settings.lockDate))
    throw new Error('This match is in a locked period.');
  const bankIds: string[] = p.bankIds || [p.bankId],
    docIds: string[] = p.allocations?.map((a: any) => a.docId) || (p.docId ? [p.docId] : []);
  if (active.some((x) => x.kind === 'customer_fund' && bankIds.includes(x.payload.bankId)))
    throw new Error(
      'This payment includes customer funds. Resolve those funds before correcting it.',
    );
  const related = (p: any) =>
    docIds.includes(p.docId) ||
    docIds.includes(p.sourceDocId) ||
    p.allocations?.some((a: any) => docIds.includes(a.docId)) ||
    [...(p.gstCash?.sales || []), ...(p.gstCash?.purchases || [])].some((a: any) =>
      docIds.includes(a.docId),
    );
  if (
    active
      .slice(i + 1)
      .some(
        (x) =>
          ['payment', 'settle', 'reverse', 'credit_note', 'credit_apply', 'fund_apply'].includes(
            x.kind,
          ) && related(x.payload),
      )
  )
    throw new Error(
      'Undo later payments first. Documents with later credits or fund applications need a separate adjustment.',
    );
  if (
    e.kind === 'cash' &&
    active.some((x) => x.kind === 'purchase_review' && bankIds.includes(x.payload.target))
  )
    throw new Error(
      'This expense has a tax review. Record a reviewed adjustment instead of removing it.',
    );
  return {
    targetEventIds: [
      e.id,
      ...active
        .filter((x) => x.kind === 'transfer_link' && bankIds.includes(x.payload.bankId))
        .map((x) => x.id),
    ],
    bankIds,
    docIds,
    date,
    reason: reason.trim(),
    originalKind: e.kind,
  };
}
