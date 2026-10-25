import {z} from 'zod';
export const accounts = [
  ['100', 'Business bank', 'asset'],
  ['101', 'Secondary bank', 'asset'],
  ['102', 'Petty cash', 'asset'],
  ['103', 'Business wallet', 'asset'],
  ['110', 'Accounts receivable', 'asset'],
  ['120', 'GST on purchases', 'asset'],
  ['130', 'Supplier credits', 'asset'],
  ['150', 'Equipment', 'asset'],
  ['151', 'Accumulated depreciation', 'asset'],
  ['200', 'Accounts payable', 'liability'],
  ['210', 'GST on sales', 'liability'],
  ['220', 'Customer credits', 'liability'],
  ['225', 'Customer funds held', 'liability'],
  ['250', 'Business loan', 'liability'],
  ['300', 'Owner funds', 'equity'],
  ['310', 'Retained earnings', 'equity'],
  ['400', 'Plumbing labour', 'income'],
  ['410', 'Materials charged', 'income'],
  ['420', 'Gas fitting', 'income'],
  ['430', 'Other service income', 'income'],
  ['500', 'Materials & supplies', 'expense'],
  ['510', 'Subcontractors', 'expense'],
  ['511', 'Subcontractors · no GST registration', 'expense'],
  ['520', 'Vehicle & fuel', 'expense'],
  ['530', 'Tools & equipment expense', 'expense'],
  ['540', 'Insurance', 'expense'],
  ['550', 'Software & office', 'expense'],
  ['560', 'Bank fees', 'expense'],
  ['570', 'Wages & salaries', 'expense'],
  ['580', 'Depreciation', 'expense'],
  ['590', 'Other business expenses', 'expense'],
] as const;
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine(
    (x) => !isNaN(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x,
    'Invalid calendar date',
  );
const amountSchema = z
  .string()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter a positive amount with up to two decimal places');
export const lineSchema = z.object({
  description: z.string().trim().min(1).max(300),
  qty: amountSchema,
  price: amountSchema,
  tax: z.enum(['gst', 'free', 'none']),
  account: z.string(),
  discount: amountSchema.optional(),
});
export const receiptReviewSchema = z.object({
  attachmentId: z.string().uuid(),
  expectedTotal: z.number().int().nonnegative(),
  expectedGst: z.number().int().nonnegative(),
  warnings: z.array(z.string().max(500)).max(30),
  reviewed: z.boolean(),
  explanation: z.string().max(1000),
});
export const documentSchema = z
  .object({
    id: z.string().uuid(),
    type: z.enum(['invoice', 'bill', 'quote', 'purchase_order']),
    number: z.string().trim().min(1).max(40),
    contactId: z.string().uuid().optional(),
    contact: z.string().trim().min(1).max(160),
    contactAddress: z.string().max(400).default(''),
    contactAbn: z.string().max(30).default(''),
    date: dateSchema,
    due: dateSchema,
    job: z.string().max(120).default(''),
    reference: z.string().max(100).default(''),
    notes: z.string().max(2000).default(''),
    inclusive: z.boolean(),
    receiptReview: receiptReviewSchema.optional(),
    lines: z.array(lineSchema).min(1).max(60),
  })
  .refine((x) => x.due >= x.date, {
    message: 'Due date must be on or after the invoice date',
    path: ['due'],
  });
export const settingsSchema = z.object({
  name: z.string().trim().min(1).max(160),
  abn: z.string().max(30),
  address: z.string().max(400),
  email: z.string().email().or(z.literal('')),
  phone: z.string().max(40),
  gst: z.enum(['yes', 'no', 'unconfirmed']),
  gstBasis: z.enum(['cash', 'accrual', 'unconfirmed']),
  bankName: z.string().max(120),
  bsb: z.string().max(20),
  bankAccount: z.string().max(30),
  terms: z.string().max(1000),
  lockDate: dateSchema.or(z.literal('')),
  entityType: z.enum(['unconfirmed', 'sole_trader', 'company', 'partnership', 'trust']).optional(),
  taxSetupConfirmed: z.boolean().optional(),
  bankLabels: z
    .record(z.enum(['100', '101', '102', '103']), z.string().trim().min(1).max(120))
    .optional(),
});
export type Settings = z.infer<typeof settingsSchema>;
export const bankCodes = ['100', '101', '102', '103'] as const;
export function bankName(code: string, settings: Settings) {
  return (
    settings.bankLabels?.[code as (typeof bankCodes)[number]] ||
    accounts.find((a) => a[0] === code)?.[1] ||
    'Unknown bank'
  );
}
export function bankFingerprint(account: string, reference: string) {
  if (!bankCodes.some((c) => c === account)) throw new Error('Choose a valid bank account');
  return account === '100' ? 'bank:' + reference : 'bank-account:' + account + ':' + reference;
}
export const defaultSettings: Settings = {
  name: 'My plumbing business',
  abn: '',
  address: '',
  email: '',
  phone: '',
  gst: 'unconfirmed',
  gstBasis: 'unconfirmed',
  bankName: 'Business bank',
  bsb: '',
  bankAccount: '',
  terms: 'Payment due within 14 days. Please use the invoice number as your reference.',
  lockDate: '',
  entityType: 'unconfirmed',
  taxSetupConfirmed: false,
};
export type Line = z.infer<typeof lineSchema>;
export type Doc = z.infer<typeof documentSchema> & {seller?: Settings};
export type Entry = {account: string; debit: number; credit: number};
export type Journal = {
  date: string;
  reference: string;
  description: string;
  lines: Entry[];
  source?: 'opening' | 'transfer' | 'manual';
};
export type Bank = {
  id: string;
  date: string;
  description: string;
  amount: number;
  reference: string;
  account?: string;
};
export type Event = {id: string; kind: string; payload: any; createdAt: string};
export type State = {events: Event[]; settings: Settings};
export type ViewDoc = Doc & {
  status: 'draft' | 'open' | 'paid' | 'void' | 'issued' | 'accepted' | 'declined' | 'converted';
  total: number;
  net: number;
  taxTotal: number;
  paid: number;
  credited: number;
  creditedTax: number;
  taxPaid: number;
  balance: number;
  posted: boolean;
  convertedId?: string;
};
export function cents(v: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(v)) throw new Error('Invalid money amount');
  const [a, b = ''] = v.split('.');
  const n = Number(a) * 100 + Number(b.padEnd(2, '0'));
  if (!Number.isSafeInteger(n)) throw new Error('Amount too large');
  return n;
}
export function lineTotals(line: Line, inclusive = false) {
  const quantity = cents(line.qty);
  const unit = cents(line.price);
  if (quantity <= 0 || quantity > 10000000 || unit > 1000000000)
    throw new Error('Check quantity or price');
  if (!Number.isSafeInteger(quantity * unit + 50)) throw new Error('Line amount is too large');
  const extended = Math.floor((quantity * unit + 50) / 100) - cents(line.discount || '0');
  if (extended < 0) throw new Error('Discount cannot exceed the line amount');
  const tax =
    line.tax === 'gst'
      ? inclusive
        ? Math.floor((extended + 5) / 11)
        : Math.floor((extended + 5) / 10)
      : 0;
  return {
    net: inclusive ? extended - tax : extended,
    tax,
    total: inclusive ? extended : extended + tax,
  };
}
export function totals(doc: Pick<Doc, 'lines' | 'inclusive'>) {
  return doc.lines.reduce(
    (a, l) => {
      const t = lineTotals(l, doc.inclusive);
      return {net: a.net + t.net, taxTotal: a.taxTotal + t.tax, total: a.total + t.total};
    },
    {net: 0, taxTotal: 0, total: 0},
  );
}
export function balanced(lines: Entry[]) {
  return (
    lines.length > 1 &&
    lines.every(
      (l) =>
        Number.isSafeInteger(l.debit) &&
        Number.isSafeInteger(l.credit) &&
        l.debit >= 0 &&
        l.credit >= 0 &&
        !(l.debit && l.credit) &&
        accounts.some((a) => a[0] === l.account),
    ) &&
    lines.reduce((a, l) => a + l.debit - l.credit, 0) === 0
  );
}
export function documentJournal(doc: Doc): Journal {
  if (!['invoice', 'bill'].includes(doc.type))
    throw new Error('Quotes and purchase orders do not post to the ledger');
  const t = totals(doc),
    sale = doc.type === 'invoice';
  const lines: Entry[] = [
    {account: sale ? '110' : '200', debit: sale ? t.total : 0, credit: sale ? 0 : t.total},
  ];
  for (const l of doc.lines) {
    const x = lineTotals(l, doc.inclusive);
    lines.push({account: l.account, debit: sale ? 0 : x.net, credit: sale ? x.net : 0});
  }
  if (t.taxTotal)
    lines.push({
      account: sale ? '210' : '120',
      debit: sale ? 0 : t.taxTotal,
      credit: sale ? t.taxTotal : 0,
    });
  if (!balanced(lines)) throw new Error('Journal is not balanced');
  return {date: doc.date, reference: doc.number, description: doc.contact, lines};
}
export function activeEvents(events: Event[]) {
  const removed = new Set(
    events.filter((e) => e.kind === 'bank_unmatch').flatMap((e) => e.payload.targetEventIds),
  );
  return events.filter((e) => !removed.has(e.id));
}
export function derive(events: Event[]) {
  events = activeEvents(events);
  const docs: ViewDoc[] = events
    .filter((e) => e.kind === 'document')
    .map((e) => ({
      ...e.payload,
      ...totals(e.payload),
      status: 'draft',
      posted: false,
      paid: 0,
      credited: 0,
      creditedTax: 0,
      taxPaid: 0,
      balance: totals(e.payload).total,
    }));
  const banks: Bank[] = events
    .filter((e) => e.kind === 'bank')
    .map((e) => ({...e.payload, account: e.payload.account || '100'}));
  const journal: Journal[] = [];
  const usedBanks = new Set<string>();
  const credits: ({
    id: string;
    sourceDocId: string;
    type: 'invoice' | 'bill';
    date: string;
    number: string;
    contactId?: string;
    contact: string;
    total: number;
    taxTotal: number;
    taxCode: string;
    applied: number;
    refunded: number;
    balance: number;
    lastDate: string;
  } & Record<string, any>)[] = [];
  const funds: ({
    id: string;
    kind: 'advance' | 'overpayment';
    date: string;
    reference: string;
    contactId: string;
    contact: string;
    total: number;
    taxTotal: number;
    tax: string;
    applied: number;
    refunded: number;
    balance: number;
    lastDate: string;
  } & Record<string, any>)[] = [];
  for (const e of events) {
    const p = e.payload;
    const d = docs.find((d) => d.id === p.docId);
    if (e.kind === 'document_edit' && d) {
      Object.assign(d, p.document, totals(p.document));
      d.balance = d.total;
    }
    if (e.kind === 'workflow_status' && d) d.status = p.status;
    if (e.kind === 'convert' && d) {
      d.status = 'converted';
      d.convertedId = p.targetId;
    }
    if (e.kind === 'post' && d) {
      d.posted = true;
      d.status = 'open';
      journal.push(documentJournal(d));
    }
    if (e.kind === 'discard' && d) d.status = 'void';
    if (e.kind === 'settle' && d) {
      d.status = 'paid';
      d.paid = d.total;
      d.taxPaid = d.taxTotal;
      d.balance = 0;
      usedBanks.add(p.bankId);
      const sale = d.type === 'invoice';
      journal.push({
        date: p.date,
        reference: d.number,
        description: `Payment · ${d.contact}`,
        lines: [
          {
            account: p.account || banks.find((b) => b.id === p.bankId)?.account || '100',
            debit: sale ? d.total : 0,
            credit: sale ? 0 : d.total,
          },
          {account: sale ? '110' : '200', debit: sale ? 0 : d.total, credit: sale ? d.total : 0},
        ],
      });
    }
    if (e.kind === 'payment') {
      usedBanks.add(p.bankId);
      journal.push(p.journal);
      for (const a of p.allocations) {
        const doc = docs.find((x) => x.id === a.docId);
        if (doc) {
          doc.paid += a.amount;
          doc.taxPaid += a.tax;
          doc.balance = doc.total - doc.paid - doc.credited;
          doc.status = doc.balance === 0 ? 'paid' : 'open';
        }
      }
    }
    if (e.kind === 'credit_note') {
      credits.push({...p, applied: 0, refunded: 0, balance: p.total, lastDate: p.date});
      journal.push(p.journal);
    }
    if (e.kind === 'customer_fund') {
      funds.push({...p, applied: 0, refunded: 0, balance: p.total, lastDate: p.date});
      usedBanks.add(p.bankId);
      journal.push(p.journal);
    }
    if (['credit_apply', 'credit_refund', 'fund_apply', 'fund_refund'].includes(e.kind)) {
      const c = e.kind.startsWith('credit')
        ? credits.find((c) => c.id === p.creditId)
        : funds.find((f) => f.id === p.fundId);
      if (c) {
        if (e.kind.endsWith('apply')) c.applied += p.amount;
        else c.refunded += p.amount;
        c.balance = c.total - c.applied - c.refunded;
        c.lastDate = p.date;
      }
      if (e.kind.endsWith('apply') && d) {
        d.credited += p.amount;
        d.creditedTax += p.tax;
        d.taxPaid += p.cashRebalance || 0;
        d.balance = d.total - d.paid - d.credited;
        d.status = d.balance === 0 ? 'paid' : 'open';
      }
      if (p.bankId) usedBanks.add(p.bankId);
      journal.push(p.journal);
    }
    if (e.kind === 'manual_journal') journal.push({...p.journal, source: 'manual'});
    if (e.kind === 'cash') {
      usedBanks.add(p.bankId);
      journal.push(p.journal);
    }
    if (e.kind === 'opening') journal.push({...p.journal, source: 'opening'});
    if (e.kind === 'transfer') {
      p.bankIds.forEach((id: string) => usedBanks.add(id));
      journal.push(p.journal);
    }
    if (e.kind === 'reverse' && d) {
      d.status = 'void';
      d.balance = 0;
      journal.push({
        ...documentJournal(d),
        date: p.date,
        description: `Reversal · ${p.reason}`,
        lines: documentJournal(d).lines.map((l) => ({...l, debit: l.credit, credit: l.debit})),
      });
    }
  }
  return {docs, banks, journal, usedBanks, credits, funds};
}
export function transferJournal(a: Bank, b: Bank): Journal {
  if (
    a.id === b.id ||
    (a.account || '100') === (b.account || '100') ||
    a.amount === 0 ||
    a.amount + b.amount !== 0 ||
    a.date !== b.date
  )
    throw new Error(
      'Transfers need equal opposite amounts in different accounts on the same date.',
    );
  const incoming = a.amount > 0 ? a : b,
    outgoing = a.amount < 0 ? a : b;
  const lines = [
    {account: incoming.account || '100', debit: incoming.amount, credit: 0},
    {account: outgoing.account || '100', debit: 0, credit: -outgoing.amount},
  ];
  if (!balanced(lines) || lines.some((l) => !bankCodes.some((c) => c === l.account)))
    throw new Error('Invalid transfer accounts');
  return {
    source: 'transfer',
    date: a.date,
    reference: 'TRANSFER',
    description: `Bank transfer · ${outgoing.reference} / ${incoming.reference}`,
    lines,
  };
}
export function report(
  events: Event[],
  from: string,
  to: string,
  basis: 'cash' | 'accrual' | 'unconfirmed',
) {
  events = activeEvents(events);
  const s = derive(events),
    period = s.journal.filter((j) => j.date >= from && j.date <= to),
    all = s.journal.filter((j) => j.date <= to);
  const trial = accounts.map((a) => {
    const ls = all.flatMap((j) => j.lines).filter((l) => l.account === a[0]);
    const balance = ls.reduce((n, l) => n + l.debit - l.credit, 0);
    return {
      code: a[0],
      name: a[1],
      type: a[2],
      balance,
      debit: Math.max(0, balance),
      credit: Math.max(0, -balance),
    };
  });
  const movements = accounts.map((a) => ({
    code: a[0],
    name: a[1],
    type: a[2],
    value: period
      .flatMap((j) => j.lines)
      .filter((l) => l.account === a[0])
      .reduce((n, l) => n + l.debit - l.credit, 0),
  }));
  let gstSales = 0,
    gstPurchases = 0,
    grossSales = 0;
  for (const e of events) {
    const p = e.payload;
    const fg = basis === 'cash' ? p.gstCash : basis === 'accrual' ? p.gstAccrual : undefined;
    if (fg && p.journal?.date >= from && p.journal.date <= to) {
      gstSales += fg.sales.reduce((n: number, a: any) => n + a.amount, 0);
      gstPurchases += fg.purchases.reduce((n: number, a: any) => n + a.amount, 0);
      grossSales += fg.sales.reduce((n: number, a: any) => n + a.gross, 0);
    }
    if ((basis === 'accrual' && e.kind === 'post') || (basis === 'cash' && e.kind === 'settle')) {
      const d = s.docs.find((d) => d.id === p.docId);
      if (!d) continue;
      const date = basis === 'cash' ? p.date : d.date;
      if (date < from || date > to) continue;
      if (d.type === 'invoice') {
        gstSales += d.taxTotal;
        grossSales += d.total;
      } else gstPurchases += d.taxTotal;
    }
    if (basis === 'accrual' && e.kind === 'reverse' && p.date >= from && p.date <= to) {
      const d = s.docs.find((d) => d.id === p.docId);
      if (d) {
        if (d.type === 'invoice') {
          gstSales -= d.taxTotal;
          grossSales -= d.total;
        } else gstPurchases -= d.taxTotal;
      }
    }
    if (
      basis === 'cash' &&
      e.kind === 'payment' &&
      p.journal.date >= from &&
      p.journal.date <= to
    ) {
      for (const a of p.allocations) {
        const d = s.docs.find((d) => d.id === a.docId);
        if (d?.type === 'invoice') {
          gstSales += a.tax;
          grossSales += a.amount;
        } else gstPurchases += a.tax;
      }
    }
    if (e.kind === 'cash' && p.journal.date >= from && p.journal.date <= to) {
      gstSales += p.gstSales || 0;
      gstPurchases += p.gstPurchases || 0;
      grossSales += p.grossSales || 0;
    }
  }
  const income =
      -movements.filter((x) => x.type === 'income').reduce((a, x) => a + x.value, 0) || 0,
    expenses = movements.filter((x) => x.type === 'expense').reduce((a, x) => a + x.value, 0);
  return {
    trial,
    movements,
    income,
    expenses,
    profit: income - expenses,
    gstSales,
    gstPurchases,
    grossSales,
    journal: period,
  };
}
export function money(n: number) {
  return new Intl.NumberFormat('en-AU', {style: 'currency', currency: 'AUD'}).format(
    (n || 0) / 100,
  );
}
export function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Brisbane',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
export function shortDate(v: string) {
  return new Date(v + 'T12:00:00').toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
export function validAbn(v: string) {
  const n = v.replace(/\s/g, '');
  if (!/^\d{11}$/.test(n)) return false;
  const a = n.split('').map(Number);
  a[0] -= 1;
  return a.reduce((s, x, i) => s + x * [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19][i], 0) % 89 === 0;
}
export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(field.trim());
      field = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (quoted) throw new Error('Unclosed quote in CSV');
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
export function csv(rows: (string | number)[][]) {
  return rows
    .map((row) =>
      row
        .map((v) => {
          let s = String(v);
          if (/^[=+@\-\t\r]/.test(s) && typeof v !== 'number') s = "'" + s;
          return '"' + s.replaceAll('"', '""') + '"';
        })
        .join(','),
    )
    .join('\r\n');
}
