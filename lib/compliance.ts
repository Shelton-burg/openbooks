import {z} from 'zod';
import {
  activeEvents,
  derive,
  report,
  totals,
  validAbn,
  dateSchema,
  today,
  type Doc,
  type Event,
  type Settings,
} from './books.ts';
import {allocatedTax, operations, contractorWorksheet} from './operations.ts';
export const guidance = {
  invoices:
    'https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/tax-invoices',
  credits:
    'https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/claiming-gst-credits/when-you-can-claim-a-gst-credit',
  basis:
    'https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/accounting-for-gst-in-your-business/choosing-an-accounting-method',
  tpar: 'https://www.ato.gov.au/businesses-and-organisations/preparing-lodging-and-paying/reports-and-returns/taxable-payments-annual-report/work-out-if-you-need-to-lodge-a-tpar/payments-businesses-need-to-report-in-their-tpar',
  records:
    'https://www.ato.gov.au/businesses-and-organisations/preparing-lodging-and-paying/record-keeping-for-business/overview-of-record-keeping-rules-for-business',
};
export const reviewSchema = z
  .object({
    target: z.string().min(1).max(100),
    businessBps: z.number().int().min(0).max(10000),
    creditableBps: z.number().int().min(0).max(10000),
    evidence: z.enum(['pending', 'tax_invoice', 'small_purchase', 'no_claim']),
    evidenceReference: z.string().trim().max(300),
    evidenceDate: dateSchema.or(z.literal('')),
    supplierAbn: z.string().trim().max(30),
    supplierGstConfirmed: z.boolean(),
    eligibilityConfirmed: z.boolean(),
    tpar: z.enum(['unreviewed', 'include', 'exclude']),
    reason: z.string().trim().min(10).max(1500),
  })
  .refine(
    (r) => r.creditableBps <= r.businessBps,
    'GST-creditable use cannot exceed business use.',
  );
export type PurchaseReview = z.infer<typeof reviewSchema>;
export function latestReviews(events: Event[]) {
  const map = new Map<string, PurchaseReview>();
  for (const e of events) if (e.kind === 'purchase_review') map.set(e.payload.target, e.payload);
  return map;
}
export function purchaseSources(events: Event[]) {
  events = activeEvents(events);
  const v = derive(events),
    contacts = operations(events).contacts;
  const bills = v.docs
    .filter((d) => d.type === 'bill' && d.posted)
    .map((d) => ({
      id: d.id,
      kind: 'bill' as const,
      date: d.date,
      reference: d.number,
      supplierReference: d.reference,
      contact: d.contact,
      contactId: d.contactId,
      abn: d.contactAbn || contacts.find((c) => c.id === d.contactId)?.abn || '',
      gross: d.total,
      gst: d.taxTotal,
      void: d.status === 'void',
      description: d.job || d.lines.map((l) => l.description).join(', '),
    }));
  const cash = events
    .filter((e) => e.kind === 'cash')
    .flatMap((e) => {
      const b = v.banks.find((b) => b.id === e.payload.bankId);
      if (
        !b ||
        b.amount >= 0 ||
        !e.payload.journal.lines.some(
          (l: {account: string}) => l.account.startsWith('5') || l.account === '150',
        )
      )
        return [];
      const c = contacts.find((c) => c.id === e.payload.contactId);
      return [
        {
          id: b.id,
          kind: 'expense' as const,
          date: b.date,
          reference: b.reference,
          supplierReference: '',
          contact: c?.name || b.description,
          contactId: c?.id,
          abn: c?.abn || '',
          gross: -b.amount,
          gst: e.payload.gstPurchases || 0,
          void: false,
          description: b.description,
        },
      ];
    });
  return [...bills, ...cash];
}
export type PurchaseSource = ReturnType<typeof purchaseSources>[number];
export function reviewCredit(source: PurchaseSource, review: PurchaseReview | undefined) {
  if (
    !review ||
    review.evidence === 'pending' ||
    review.evidence === 'no_claim' ||
    !review.eligibilityConfirmed ||
    !review.supplierGstConfirmed
  )
    return 0;
  return Math.floor((source.gst * review.creditableBps + 5000) / 10000);
}
export function validateReview(source: PurchaseSource, review: PurchaseReview, asOf = today()) {
  reviewSchema.parse(review);
  if (source.void)
    throw new Error(
      'This bill was reversed. Its GST treatment needs a separate adjustment review.',
    );
  if (review.evidenceDate && review.evidenceDate > asOf)
    throw new Error('Evidence cannot be dated in the future.');
  if (review.evidence === 'no_claim' && review.creditableBps !== 0)
    throw new Error('Set GST-creditable use to zero when no GST credit is claimed.');
  if (source.gst === 0 && review.creditableBps !== 0)
    throw new Error('This purchase has no recorded GST; GST-creditable use must be zero.');
  if (['tax_invoice', 'small_purchase'].includes(review.evidence) && review.creditableBps > 0) {
    if (!review.eligibilityConfirmed || !review.supplierGstConfirmed)
      throw new Error(
        'Confirm supplier GST and purchase eligibility before including a GST credit.',
      );
    if (!review.evidenceDate || review.evidenceReference.length < 3)
      throw new Error('Record the evidence held date and where the document is kept.');
    if (review.evidence === 'small_purchase' && source.gross > 8250)
      throw new Error(
        'The small-purchase evidence option is limited to a total purchase of $82.50 or less including GST.',
      );
    if (review.evidence === 'tax_invoice' && !validAbn(review.supplierAbn))
      throw new Error(
        'Enter the supplier ABN shown on the tax invoice. A checksum does not verify registration.',
      );
  }
}
export function invoiceChecks(doc: Doc) {
  const issues: string[] = [];
  if (doc.type !== 'invoice') return issues;
  const seller = doc.seller;
  if (!seller?.name?.trim()) issues.push('Seller identity is missing.');
  if (!doc.contact.trim()) issues.push('Buyer identity is missing.');
  if (!dateSchema.safeParse(doc.date).success) issues.push('Issue date is invalid.');
  if (seller?.gst === 'yes' && !validAbn(seller.abn))
    issues.push('A valid seller ABN is required for a tax invoice.');
  if (seller?.gst !== 'yes' && doc.lines.some((l) => l.tax === 'gst'))
    issues.push('Only a confirmed GST-registered business can issue invoices containing GST.');
  if (seller?.gst === 'unconfirmed') issues.push('GST registration has not been confirmed.');
  if (doc.lines.some((l) => !l.description.trim())) issues.push('Every line needs a description.');
  if (totals(doc).total >= 100000 && !doc.contact.trim() && !(doc.contactAbn || '').trim())
    issues.push('Invoices of $1,000 or more require the buyer identity or ABN.');
  return [...new Set(issues)];
}
export type GstRow = {
  target: string;
  date: string;
  reference: string;
  contact: string;
  recorded: number;
  reviewed: number;
  status: 'reviewed' | 'pending' | 'excluded' | 'adjustment';
  reason: string;
};
export function gstWorkpaper(events: Event[], settings: Settings, from: string, to: string) {
  events = activeEvents(events);
  dateSchema.parse(from);
  dateSchema.parse(to);
  if (from > to) throw new Error('End date must be on or after start date.');
  const v = derive(events),
    sources = purchaseSources(events),
    reviews = latestReviews(events),
    raw = report(events, from, to, settings.gstBasis),
    paid = new Map<string, number>(),
    rows: GstRow[] = [];
  const taxSeen = new Map<string, number>(),
    adjusted = new Set(
      events
        .filter((e) => ['credit_note', 'credit_apply', 'fund_apply'].includes(e.kind))
        .flatMap((e) => [e.payload.sourceDocId, e.payload.docId])
        .filter(Boolean),
    );
  function add(
    target: string,
    date: string,
    recorded: number,
    paidBefore?: number,
    paidAfter?: number,
    finance = false,
  ) {
    const source = sources.find((s) => s.id === target);
    if (!source || !source.gst) return;
    const review = reviews.get(target),
      before = taxSeen.get(target) || 0,
      after = before + recorded;
    taxSeen.set(target, after);
    if (date < from || date > to) return;
    let status: GstRow['status'] =
      !review || review.evidence === 'pending'
        ? 'pending'
        : review.evidence === 'no_claim' || review.creditableBps === 0
          ? 'excluded'
          : 'reviewed';
    const eligible = reviewCredit(source, review);
    let reviewed = eligible;
    if (settings.gstBasis === 'cash' && adjusted.has(target)) {
      const bounded = (n: number) => Math.max(0, Math.min(source.gst, n));
      reviewed =
        allocatedTax(eligible, bounded(after), source.gst) -
        allocatedTax(eligible, bounded(before), source.gst);
    } else if (finance)
      reviewed = Math.round((recorded * (review?.creditableBps || 0)) / 10000) * (eligible ? 1 : 0);
    else if (paidAfter !== undefined)
      reviewed =
        allocatedTax(eligible, paidAfter, source.gross) -
        allocatedTax(eligible, paidBefore || 0, source.gross);
    if (review?.evidenceDate && review.evidenceDate > to) {
      status = 'pending';
      reviewed = 0;
    }
    if (finance) status = 'adjustment';
    if (
      !finance &&
      (recorded < 0 ||
        (source.void &&
          events.some(
            (e) => e.kind === 'reverse' && e.payload.docId === source.id && e.payload.date <= to,
          )))
    ) {
      status = 'adjustment';
      reviewed = 0;
    }
    rows.push({
      target,
      date,
      reference: source.reference,
      contact: source.contact,
      recorded,
      reviewed,
      status,
      reason: finance
        ? 'Credit or refund: compare this adjustment with the original GST claim and evidence.'
        : review?.evidenceDate && review.evidenceDate > to
          ? 'Evidence was obtained after this period. Review the claim timing separately.'
          : review?.reason || 'Purchase eligibility and evidence have not been reviewed.',
    });
  }

  for (const e of events) {
    const p = e.payload,
      d = v.docs.find((d) => d.id === p.docId);
    if (e.kind === 'post' && d?.type === 'bill' && settings.gstBasis === 'accrual')
      add(d.id, d.date, d.taxTotal);
    if (e.kind === 'reverse' && d?.type === 'bill' && settings.gstBasis === 'accrual')
      add(d.id, p.date, -d.taxTotal);
    if (e.kind === 'settle' && d?.type === 'bill') {
      if (settings.gstBasis === 'cash') add(d.id, p.date, d.taxTotal, 0, d.total);
      paid.set(d.id, d.total);
    }
    if (e.kind === 'payment')
      for (const a of p.allocations) {
        const d = v.docs.find((d) => d.id === a.docId);
        if (d?.type === 'bill') {
          const before = paid.get(d.id) || 0;
          if (settings.gstBasis === 'cash')
            add(d.id, p.journal.date, a.tax, before, before + a.amount);
          paid.set(d.id, before + a.amount);
        }
      }
    const fg =
      settings.gstBasis === 'cash'
        ? p.gstCash
        : settings.gstBasis === 'accrual'
          ? p.gstAccrual
          : undefined;
    if (fg)
      for (const a of fg.purchases)
        add(a.docId, p.journal.date, a.amount, undefined, undefined, true);
    if (e.kind === 'cash' && p.gstPurchases) add(p.bankId, p.journal.date, p.gstPurchases);
  }
  const reviewedPurchases = rows.reduce((n, r) => n + r.reviewed, 0),
    heldPurchases = rows.filter((r) => r.status === 'pending').reduce((n, r) => n + r.recorded, 0),
    excludedPurchases = rows
      .filter((r) => r.status === 'reviewed' || r.status === 'excluded')
      .reduce((n, r) => n + r.recorded - r.reviewed, 0);
  const blockers: string[] = [];
  if (settings.gst !== 'yes' || settings.gstBasis === 'unconfirmed' || !settings.taxSetupConfirmed)
    blockers.push('Confirm GST registration and reporting basis in Australian tax setup.');
  if (rows.some((r) => r.status === 'pending'))
    blockers.push('Some purchase GST is awaiting evidence or eligibility review.');
  if (rows.some((r) => r.status === 'adjustment'))
    blockers.push('Credits, refunds or reversed purchases require a GST adjustment review.');
  if (
    sources.some(
      (s) =>
        s.gst > 0 &&
        s.date < from &&
        !s.void &&
        (!reviews.has(s.id) || reviews.get(s.id)?.evidence === 'pending'),
    )
  )
    blockers.push(
      'Earlier purchases remain unreviewed. Late claims are not moved automatically into this period.',
    );
  if (
    events.some(
      (e) => e.payload.gstCash && e.payload.journal.date >= from && e.payload.journal.date <= to,
    )
  )
    blockers.push(
      'Review credit, refund and customer-advance GST attribution for this period. These are draft calculations, not an approved BAS.',
    );
  if (
    rows.some((r) => {
      const review = reviews.get(r.target);
      return review && review.businessBps < 10000;
    })
  )
    blockers.push(
      'Private-use review percentages do not change posted expenses. Your accountant must review the ledger allocation.',
    );
  return {
    from,
    to,
    basis: settings.gstBasis,
    recordedSales: raw.grossSales,
    gstSales: raw.gstSales,
    recordedPurchases: raw.gstPurchases,
    reviewedPurchases,
    heldPurchases,
    excludedPurchases,
    provisionalNet: raw.gstSales - reviewedPurchases,
    rows,
    blockers,
  };
}
export function reviewedContractors(events: Event[], from: string, to: string) {
  const raw = contractorWorksheet(events, from, to),
    sources = purchaseSources(events),
    reviews = latestReviews(events);
  return raw.map((c) => {
    let included = 0,
      includedGst = 0,
      pending = 0,
      excluded = 0;
    const rows = c.rows.map((r) => {
      const source = sources.find((s) => s.id === r.target);
      const review = source ? reviews.get(source.id) : undefined;
      const status = review?.tpar || 'unreviewed';
      if (status === 'include') {
        included += r.gross;
        includedGst += r.gst;
      } else if (status === 'exclude') excluded += r.gross;
      else pending += r.gross;
      return {...r, target: source?.id, status};
    });
    return {
      ...c,
      rows,
      included,
      includedGst,
      pending,
      excluded,
      missingDetails: !validAbn(c.contact.abn) || !c.contact.address.trim(),
    };
  });
}
export function complianceChecklist(events: Event[], settings: Settings) {
  const sources = purchaseSources(events),
    reviews = latestReviews(events),
    v = derive(events);
  return [
    {
      name: 'Business tax setup',
      status: settings.taxSetupConfirmed ? 'recorded' : 'required',
      detail: 'Business structure, GST registration and reporting basis must match your records.',
    },
    {
      name: 'Purchase GST review',
      status: sources.some(
        (s) => s.gst > 0 && (!reviews.has(s.id) || reviews.get(s.id)?.evidence === 'pending'),
      )
        ? 'required'
        : 'reviewed records only',
      detail:
        'Evidence and creditable use are reviewed separately from GST recorded in the ledger.',
    },
    {
      name: 'Invoice details',
      status: v.docs
        .filter((d) => d.type === 'invoice' && d.posted)
        .some((d) => invoiceChecks(d).length)
        ? 'required'
        : 'checks available',
      detail:
        'Printed invoices show GST amounts per line and customer identity. Registration checks are manual.',
    },
    {
      name: 'Xero comparison',
      status: 'required',
      detail:
        'Opening balances, transactions and a complete reporting period have not been independently reconciled with Xero.',
    },
    {
      name: 'Independent accountant review',
      status: 'required',
      detail:
        'Saved workpapers are owner-prepared drafts. They are not accountant sign-off or lodged returns.',
    },
    {
      name: 'Record retention and recovery',
      status: 'required',
      detail:
        'Full ZIP backups include records and attachments, with file and reconstructed-balance checks. Keep independent copies. Live restore and long-term retention have not been validated.',
    },
    {
      name: 'Other tax workflows',
      status: 'incomplete',
      detail:
        'Standard credits, refunds and cash-basis customer advances are available for testing. Mixed-tax credits, non-cash advances, tax depreciation and tax lodgment still require work. Payroll is excluded from your scope.',
    },
  ];
}

export const snapshotSchema = z
  .object({
    from: dateSchema,
    to: dateSchema,
    notes: z.string().trim().min(10).max(2000),
    comparison: z.object({
      source: z.string().trim().max(300),
      bank: z.number().int().min(-1000000000000).max(1000000000000).nullable(),
      profit: z.number().int().min(-1000000000000).max(1000000000000).nullable(),
      gstSales: z.number().int().min(-1000000000000).max(1000000000000).nullable(),
      gstPurchases: z.number().int().min(-1000000000000).max(1000000000000).nullable(),
    }),
  })
  .refine((s) => s.from <= s.to, 'Choose a valid reporting period.')
  .refine(
    (s) =>
      !Object.values(s.comparison).some((v) => typeof v === 'number') ||
      s.comparison.source.length >= 3,
    'Describe the Xero reports used for the comparison.',
  );
export function sourceRevision(events: Event[]) {
  return (
    events.filter((e) => !['write_guard', 'tax_snapshot'].includes(e.kind)).at(-1)?.id || 'empty'
  );
}
export function taxSnapshot(
  events: Event[],
  settings: Settings,
  input: z.infer<typeof snapshotSchema>,
) {
  const p = snapshotSchema.parse(input),
    gst = gstWorkpaper(events, settings, p.from, p.to),
    r = report(events, p.from, p.to, settings.gstBasis),
    v = derive(events);
  const local = {
    bank: r.trial
      .filter((a) => ['100', '101', '102', '103'].includes(a.code))
      .reduce((n, a) => n + a.balance, 0),
    profit: r.profit,
    gstSales: gst.gstSales,
    gstPurchases: gst.reviewedPurchases,
  };
  const comparison = (['bank', 'profit', 'gstSales', 'gstPurchases'] as const).map((key) => ({
    key,
    local: local[key],
    xero: p.comparison[key],
    difference: p.comparison[key] === null ? null : local[key] - p.comparison[key]!,
  }));
  return {
    schemaVersion: 1,
    status: 'owner-prepared draft',
    preparedAt: new Date().toISOString(),
    sourceRevision: sourceRevision(events),
    from: p.from,
    to: p.to,
    notes: p.notes,
    settings: {
      name: settings.name,
      abn: settings.abn,
      entityType: settings.entityType || 'unconfirmed',
      gst: settings.gst,
      gstBasis: settings.gstBasis,
      taxSetupConfirmed: !!settings.taxSetupConfirmed,
    },
    gst,
    profitAndLoss: {
      income: r.income,
      expenses: r.expenses,
      profit: r.profit,
      movements: r.movements,
    },
    trial: r.trial,
    contractors: reviewedContractors(events, p.from, p.to),
    comparisonSource: p.comparison.source,
    comparison,
    checks: complianceChecklist(events, settings),
    unmatchedStatementLines: v.banks.filter((b) => !v.usedBanks.has(b.id) && b.date <= p.to).length,
    draftDocuments: v.docs.filter((d) => d.status === 'draft' && d.date <= p.to).length,
    reviewEventIds: events.filter((e) => e.kind === 'purchase_review').map((e) => e.id),
    limitations:
      'Review percentages affect this GST workpaper only, not the posted ledger. Not a complete BAS, TPAR, accountant sign-off or lodgment. Credits, refunds and supported customer advances require attribution review. No automatic late claims, mixed-tax adjustments, tax depreciation or ABN withholding. Payroll is excluded. Comparison values are owner-entered, not verified Xero imports.',
  };
}
export type TaxSnapshot = ReturnType<typeof taxSnapshot>;
