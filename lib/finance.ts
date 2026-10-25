import {z} from 'zod';
import {
  activeEvents,
  derive,
  balanced,
  dateSchema,
  lineTotals,
  type Event,
  type ViewDoc,
  type Bank,
  type Journal,
  type Settings,
} from './books.ts';
import {allocatedTax, operations} from './operations.ts';
const amount = z.number().int().positive().max(1000000000);
export const creditSchema = z.object({
  id: z.string().uuid(),
  docId: z.string().uuid(),
  number: z.string().trim().min(1).max(40),
  date: dateSchema,
  amount,
  reason: z.string().trim().min(10).max(1500),
  supplierReference: z.string().trim().max(100),
});
export const fundSchema = z.object({
  id: z.string().uuid(),
  bankId: z.string().min(1),
  contactId: z.string().uuid(),
  kind: z.enum(['advance', 'overpayment']),
  tax: z.enum(['gst', 'free', 'none']),
  reference: z.string().trim().min(1).max(100),
  reason: z.string().trim().min(10).max(1500),
  confirmed: z.literal(true),
});
export type Credit = ReturnType<typeof derive>['credits'][number];
export type Fund = ReturnType<typeof derive>['funds'][number];
export type TaxDelta = {docId?: string; amount: number; gross: number};
export type FinanceGST = {sales: TaxDelta[]; purchases: TaxDelta[]};
const emptyGST = (): FinanceGST => ({sales: [], purchases: []});
function oneGST(type: string, docId: string | undefined, tax: number, gross = 0): FinanceGST {
  return type === 'invoice'
    ? {sales: [{docId, amount: tax, gross}], purchases: []}
    : {sales: [], purchases: [{docId, amount: tax, gross}]};
}
export function uniformTax(d: ViewDoc) {
  const codes = [...new Set(d.lines.map((l) => l.tax))];
  if (codes.length !== 1)
    throw new Error(
      'This workflow currently needs one GST treatment across the document. Mixed-tax adjustments need a separate accountant-reviewed calculation.',
    );
  return codes[0];
}
function valid(j: Journal) {
  if (!balanced(j.lines)) throw new Error('The accounting entry did not balance.');
  return j;
}
function effectiveDate(events: Event[], id: string) {
  events = activeEvents(events);
  let date = '';
  for (const e of events) {
    const p = e.payload;
    if (
      p.docId === id ||
      p.sourceDocId === id ||
      p.allocations?.some((a: {docId: string}) => a.docId === id) ||
      p.gstCash?.sales?.some((a: {docId: string}) => a.docId === id) ||
      p.gstCash?.purchases?.some((a: {docId: string}) => a.docId === id)
    )
      date = [date, p.date || p.journal?.date || ''].sort().at(-1)!;
  }
  return date;
}
export function checkFinanceDate(events: Event[], date: string, ...ids: string[]) {
  dateSchema.parse(date);
  if (ids.some((id) => effectiveDate(events, id) > date))
    throw new Error('Use a date on or after this document’s latest payment or adjustment.');
}
export function creditPlan(events: Event[], input: unknown) {
  const p = creditSchema.parse(input),
    v = derive(events),
    d = v.docs.find((d) => d.id === p.docId);
  if (!d || !d.posted || !['invoice', 'bill'].includes(d.type) || d.status === 'void')
    throw new Error('Choose a posted invoice or bill that has not been reversed.');
  if (p.date < d.date) throw new Error('A credit cannot predate its original document.');
  checkFinanceDate(events, p.date, d.id);
  if (d.type === 'bill' && !p.supplierReference)
    throw new Error('Record the supplier’s credit note reference.');
  const taxCode = uniformTax(d),
    previous = v.credits.filter((c) => c.sourceDocId === d.id).reduce((n, c) => n + c.total, 0);
  if (p.amount > d.total - previous)
    throw new Error('Total credits cannot exceed the original document amount.');
  const beforeTax = allocatedTax(d.taxTotal, previous, d.total),
    tax = allocatedTax(d.taxTotal, previous + p.amount, d.total) - beforeTax,
    net = p.amount - tax;
  const original = new Map<string, number>();
  for (const l of d.lines)
    original.set(l.account, (original.get(l.account) || 0) + lineTotals(l, d.inclusive).net);
  const beforeNet = previous - beforeTax,
    afterNet = beforeNet + net;
  let cumulative = 0;
  const lines = [...original]
    .map(([account, value]) => {
      const start = cumulative;
      cumulative += value;
      const allocation = (n: number) =>
        d.net ? allocatedTax(n, cumulative, d.net) - allocatedTax(n, start, d.net) : 0;
      return {account, net: allocation(afterNet) - allocation(beforeNet)};
    })
    .filter((l) => l.net);
  const sale = d.type === 'invoice',
    journal = valid({
      date: p.date,
      reference: p.number,
      description: p.reason,
      lines: [
        {account: sale ? '220' : '130', debit: sale ? 0 : p.amount, credit: sale ? p.amount : 0},
        ...lines.map((l) => ({
          account: l.account,
          debit: (sale ? l.net : -l.net) > 0 ? Math.abs(l.net) : 0,
          credit: (sale ? l.net : -l.net) < 0 ? Math.abs(l.net) : 0,
        })),
        ...(tax
          ? [{account: sale ? '210' : '120', debit: sale ? tax : 0, credit: sale ? 0 : tax}]
          : []),
      ],
    });
  return {
    ...p,
    sourceDocId: d.id,
    type: d.type,
    contactId: d.contactId,
    contact: d.contact,
    contactAbn: d.contactAbn,
    contactAddress: d.contactAddress,
    seller: d.seller,
    originalNumber: d.number,
    originalDate: d.date,
    beforePrice: d.total - previous,
    afterPrice: d.total - previous - p.amount,
    total: p.amount,
    taxTotal: tax,
    net,
    taxCode,
    lines,
    journal,
    gstAccrual: oneGST(d.type, d.id, -tax, -p.amount),
    gstCash: emptyGST(),
  };
}
// Apply a credit as a distinct settlement; it never masquerades as a cash receipt.
function targetAllocation(d: ViewDoc, amount: number) {
  if (!d.posted || d.status !== 'open' || amount > d.balance)
    throw new Error('Choose an outstanding document and an amount within its balance.');
  const remainingTax = d.taxTotal - d.creditedTax - d.taxPaid;
  const tax =
    amount === d.balance
      ? remainingTax
      : Math.min(remainingTax, allocatedTax(d.taxTotal, amount, d.total));
  const base = d.total - d.credited - amount,
    baseTax = d.taxTotal - d.creditedTax - tax;
  const newTaxPaid = base ? allocatedTax(baseTax, d.paid, base) : 0;
  return {tax, cashRebalance: newTaxPaid - d.taxPaid};
}
export function applyCreditPlan(
  events: Event[],
  creditId: string,
  docId: string,
  value: number,
  date: string,
) {
  amount.parse(value);
  dateSchema.parse(date);
  const v = derive(events),
    c = v.credits.find((c) => c.id === creditId),
    d = v.docs.find((d) => d.id === docId);
  if (!c || !d || c.type !== d.type || value > c.balance)
    throw new Error('Choose an available credit of the same document type.');
  if (c.sourceDocId !== d.id && (!c.contactId || c.contactId !== d.contactId))
    throw new Error('Credits can only be applied to the same saved contact.');
  if (uniformTax(d) !== c.taxCode)
    throw new Error('The credit and target document need matching GST treatment.');
  if (date < c.date || date < d.date || date < c.lastDate)
    throw new Error('An application cannot predate its credit, invoice or prior use.');
  checkFinanceDate(events, date, d.id);
  const a = targetAllocation(d, value),
    creditTax =
      allocatedTax(c.taxTotal, c.applied + c.refunded + value, c.total) -
      allocatedTax(c.taxTotal, c.applied + c.refunded, c.total),
    sale = c.type === 'invoice';
  const cashTax = (c.sourceDocId === d.id ? 0 : a.tax - creditTax) + a.cashRebalance;
  const journal = valid({
    date,
    reference: c.number,
    description: 'Credit applied to ' + d.number,
    lines: [
      {account: sale ? '220' : '200', debit: value, credit: 0},
      {account: sale ? '110' : '130', debit: 0, credit: value},
    ],
  });
  // Attribution follows both sides when a previously paid credit is reused on another document.
  const gstCash = oneGST(
    d.type,
    d.id,
    (c.sourceDocId === d.id ? 0 : a.tax) + a.cashRebalance,
    c.sourceDocId === d.id ? 0 : value,
  );
  if (c.sourceDocId !== d.id)
    gstCash[sale ? 'sales' : 'purchases'].push({
      docId: c.sourceDocId,
      amount: -creditTax,
      gross: -value,
    });
  return {
    creditId,
    docId,
    date,
    amount: value,
    tax: a.tax,
    cashRebalance: a.cashRebalance,
    creditTax,
    journal,
    gstCash,
    gstAccrual: emptyGST(),
  };
}
export function creditRefundPlan(events: Event[], creditId: string, bank: Bank) {
  const v = derive(events),
    c = v.credits.find((c) => c.id === creditId),
    value = Math.abs(bank.amount);
  if (!c || value > c.balance || value === 0 || bank.amount < 0 !== (c.type === 'invoice'))
    throw new Error(
      'Choose a customer refund paid out or supplier refund received, within the credit balance.',
    );
  if (bank.date < c.date || bank.date < c.lastDate)
    throw new Error('A refund cannot predate the credit or its latest use.');
  const tax =
      allocatedTax(c.taxTotal, c.applied + c.refunded + value, c.total) -
      allocatedTax(c.taxTotal, c.applied + c.refunded, c.total),
    sale = c.type === 'invoice';
  return {
    creditId,
    bankId: bank.id,
    date: bank.date,
    amount: value,
    tax,
    journal: valid({
      date: bank.date,
      reference: bank.reference,
      description: 'Refund · ' + c.number,
      lines: [
        {account: bank.account || '100', debit: sale ? 0 : value, credit: sale ? value : 0},
        {account: sale ? '220' : '130', debit: sale ? value : 0, credit: sale ? 0 : value},
      ],
    }),
    gstCash: oneGST(c.type, c.sourceDocId, -tax, -value),
    gstAccrual: emptyGST(),
  };
}
export function fundPlan(events: Event[], settings: Settings, input: unknown, bank: Bank) {
  const p = fundSchema.parse(input),
    contact = operations(events).contacts.find(
      (c) => c.id === p.contactId && !c.archived && c.role !== 'supplier',
    );
  if (!contact || bank.amount <= 0 || bank.id !== p.bankId)
    throw new Error('Choose money received and an active saved customer.');
  if (p.kind === 'advance' && settings.gst === 'yes' && settings.gstBasis !== 'cash')
    throw new Error(
      'GST-registered advances currently require cash-basis GST. Non-cash advances need whole-contract attribution and are not enabled yet.',
    );
  if (p.kind === 'overpayment' && p.tax !== 'none')
    throw new Error('A refundable mistaken overpayment has no GST until applied to a supply.');
  if (p.tax === 'gst' && settings.gst !== 'yes') throw new Error('Confirm GST registration first.');
  const tax =
    p.tax === 'gst'
      ? lineTotals(
          {
            description: p.reference,
            qty: '1',
            price: (bank.amount / 100).toFixed(2),
            tax: 'gst',
            account: '400',
          },
          true,
        ).tax
      : 0;
  return {
    ...p,
    contact: contact.name,
    date: bank.date,
    total: bank.amount,
    taxTotal: tax,
    net: bank.amount - tax,
    journal: valid({
      date: bank.date,
      reference: p.reference,
      description: p.reason,
      lines: [
        {account: bank.account || '100', debit: bank.amount, credit: 0},
        {account: '225', debit: 0, credit: bank.amount - tax},
        ...(tax ? [{account: '210', debit: 0, credit: tax}] : []),
      ],
    }),
    gstCash: oneGST('invoice', undefined, tax, p.kind === 'advance' ? bank.amount : 0),
    gstAccrual: oneGST('invoice', undefined, tax, p.kind === 'advance' ? bank.amount : 0),
  };
}
export function applyFundPlan(
  events: Event[],
  fundId: string,
  docId: string,
  value: number,
  date: string,
) {
  amount.parse(value);
  dateSchema.parse(date);
  const v = derive(events),
    f = v.funds.find((f) => f.id === fundId),
    d = v.docs.find((d) => d.id === docId);
  if (!f || !d || d.type !== 'invoice' || d.contactId !== f.contactId || value > f.balance)
    throw new Error(
      'Choose an outstanding invoice for this customer and an amount within the available balance.',
    );
  if (date < f.date || date < d.date || date < f.lastDate)
    throw new Error('Use a date on or after the receipt, invoice and previous use.');
  checkFinanceDate(events, date, d.id);
  if (f.kind === 'advance' && uniformTax(d) !== f.tax)
    throw new Error('The advance and invoice must have the same GST treatment.');
  const a = targetAllocation(d, value),
    tax =
      allocatedTax(f.taxTotal, f.applied + f.refunded + value, f.total) -
      allocatedTax(f.taxTotal, f.applied + f.refunded, f.total);
  return {
    fundId,
    docId,
    date,
    amount: value,
    tax: a.tax,
    fundTax: tax,
    cashRebalance: a.cashRebalance,
    journal: valid({
      date,
      reference: f.reference,
      description: 'Customer funds applied to ' + d.number,
      lines: [
        {account: '225', debit: value - tax, credit: 0},
        ...(tax ? [{account: '210', debit: tax, credit: 0}] : []),
        {account: '110', debit: 0, credit: value},
      ],
    }),
    gstCash: oneGST(
      'invoice',
      d.id,
      a.tax - tax + a.cashRebalance,
      f.kind === 'advance' ? 0 : value,
    ),
    gstAccrual: oneGST('invoice', d.id, -tax, f.kind === 'advance' ? -value : 0),
  };
}
export function fundRefundPlan(events: Event[], fundId: string, bank: Bank) {
  const f = derive(events).funds.find((f) => f.id === fundId),
    value = -bank.amount;
  if (!f || value <= 0 || value > f.balance)
    throw new Error('Choose money paid out within this customer balance.');
  if (bank.date < f.date || bank.date < f.lastDate)
    throw new Error('A refund cannot predate the receipt or its previous use.');
  const tax =
    allocatedTax(f.taxTotal, f.applied + f.refunded + value, f.total) -
    allocatedTax(f.taxTotal, f.applied + f.refunded, f.total);
  return {
    fundId,
    bankId: bank.id,
    date: bank.date,
    amount: value,
    tax,
    journal: valid({
      date: bank.date,
      reference: bank.reference,
      description: 'Customer funds refunded · ' + f.contact,
      lines: [
        {account: '225', debit: value - tax, credit: 0},
        ...(tax ? [{account: '210', debit: tax, credit: 0}] : []),
        {account: bank.account || '100', debit: 0, credit: value},
      ],
    }),
    gstCash: oneGST('invoice', undefined, -tax, f.kind === 'advance' ? -value : 0),
    gstAccrual: oneGST('invoice', undefined, -tax, f.kind === 'advance' ? -value : 0),
  };
}

export function contactStatement(
  events: Event[],
  contactId: string,
  type: 'invoice' | 'bill',
  at: string,
) {
  events = activeEvents(events);
  const v = derive(events),
    rows: {
      date: string;
      reference: string;
      description: string;
      debit: number;
      credit: number;
      balance: number;
    }[] = [];
  const add = (
    date: string,
    reference: string,
    description: string,
    debit: number,
    credit: number,
  ) => {
    if (date <= at) rows.push({date, reference, description, debit, credit, balance: 0});
  };
  for (const e of events) {
    const p = e.payload,
      d = v.docs.find((d) => d.id === p.docId);
    if (e.kind === 'post' && d?.type === type && d.contactId === contactId)
      add(d.date, d.number, 'Document posted', d.total, 0);
    if (e.kind === 'reverse' && d?.type === type && d.contactId === contactId)
      add(p.date, d.number, 'Document reversed', 0, d.total);
    if (e.kind === 'settle' && d?.type === type && d.contactId === contactId)
      add(p.date, d.number, 'Payment', 0, d.total);
    if (e.kind === 'payment')
      for (const a of p.allocations) {
        const doc = v.docs.find((d) => d.id === a.docId);
        if (doc?.type === type && doc.contactId === contactId)
          add(p.journal.date, doc.number, 'Payment', 0, a.amount);
      }
    if (e.kind === 'credit_note' && p.type === type && p.contactId === contactId)
      add(p.date, p.number, 'Credit for ' + p.originalNumber, 0, p.total);
    if (e.kind === 'credit_refund') {
      const c = v.credits.find((c) => c.id === p.creditId);
      if (c?.type === type && c.contactId === contactId)
        add(p.date, c.number, 'Credit refunded', p.amount, 0);
    }
    if (e.kind === 'customer_fund' && type === 'invoice' && p.contactId === contactId)
      add(p.date, p.reference, 'Customer funds received', 0, p.total);
    if (e.kind === 'fund_refund' && type === 'invoice') {
      const f = v.funds.find((f) => f.id === p.fundId);
      if (f?.contactId === contactId)
        add(p.date, f.reference, 'Customer funds refunded', p.amount, 0);
    }
  }
  let balance = 0;
  for (const r of rows.sort((a, b) => a.date.localeCompare(b.date))) {
    balance += r.debit - r.credit;
    r.balance = balance;
  }
  return rows;
}
