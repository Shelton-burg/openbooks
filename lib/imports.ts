import {z} from 'zod';
import {
  accounts,
  bankCodes,
  bankFingerprint,
  dateSchema,
  derive,
  documentSchema,
  totals,
  validAbn,
  parseCsv,
  type State,
  type Doc,
  type Bank,
} from './books.ts';
import {contactSchema, operations, validateDocument, type Contact} from './operations.ts';
import {duplicateBill} from './reliability.ts';

export const importKinds = [
  'contacts',
  'bank',
  'invoice',
  'bill',
  'trial_balance',
  'reference',
] as const;
export type ImportKind = (typeof importKinds)[number];
export const kindLabels: Record<ImportKind, string> = {
  contacts: 'Customers & suppliers',
  bank: 'Bank statement lines',
  invoice: 'Customer invoices',
  bill: 'Supplier bills',
  trial_balance: 'Trial balance reference',
  reference: 'Screenshot / document reference',
};
type Field = {key: string; label: string; aliases: string[]; required?: boolean};
const f = (key: string, label: string, aliases: string[], required = false): Field => ({
  key,
  label,
  aliases: [key, ...aliases],
  required,
});
const documentFields = [
  f('number', 'Document number', ['invoicenumber', 'billnumber'], true),
  f('contact', 'Customer / supplier', ['contactname', 'supplier', 'customer'], true),
  f('date', 'Issue date', ['invoicedate', 'billdate'], true),
  f('due', 'Due date', ['duedate'], true),
  f('description', 'Line description', ['itemdescription'], true),
  f('qty', 'Quantity', ['quantity'], true),
  f('price', 'Unit price', ['unitamount', 'unitprice'], true),
  f('tax', 'Source tax code', ['taxtype']),
  f('account', 'Source account code', ['accountcode']),
  f('reference', 'Supplier / purchase reference', ['supplierreference', 'purchaseorder']),
  f('discount', 'Line discount amount', ['discountamount']),
  f('job', 'Job / site', ['site']),
  f('address', 'Contact address', ['contactaddress']),
  f('abn', 'Contact ABN', ['contactabn']),
  f('paid', 'Amount paid', ['amountpaid']),
  f('total', 'Document total', ['invoicetotal']),
  f('amountdue', 'Outstanding amount', ['amountremaining']),
  f('currency', 'Currency', ['currencycode']),
  f('status', 'Source status', []),
];
export const importFields: Record<ImportKind, Field[]> = {
  contacts: [
    f('name', 'Contact name', ['contactname', 'supplier', 'customer'], true),
    f('email', 'Email', ['emailaddress']),
    f('phone', 'Phone', ['phonenumber']),
    f('address', 'Address', ['postaladdress']),
    f('abn', 'ABN', ['taxnumber']),
    f('role', 'Contact type', ['type']),
    f('terms', 'Payment terms (days)', ['termsdays']),
    f('notes', 'Notes', []),
  ],
  bank: [
    f('date', 'Transaction date', ['transactiondate'], true),
    f('description', 'Description', ['details', 'payee', 'narrative'], true),
    f('amount', 'Signed amount', ['transactionamount']),
    f('debit', 'Money out', ['withdrawal', 'withdrawals']),
    f('credit', 'Money in', ['deposit', 'deposits']),
    f('reference', 'Unique transaction reference', ['transactionid', 'bankreference']),
    f('currency', 'Currency', ['currencycode']),
  ],
  invoice: documentFields,
  bill: documentFields,
  trial_balance: [
    f('account', 'Source account', ['accountcode', 'code'], true),
    f('name', 'Account name', ['accountname']),
    f('balance', 'Signed balance', ['netbalance']),
    f('debit', 'Debit', []),
    f('credit', 'Credit', []),
  ],
  reference: [],
};
const normal = (v: string) => v.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
export function readImportCsv(text: string) {
  if (text.length > 450000)
    throw new Error('Use a CSV working copy up to 450 KB. Split larger exports into batches.');
  const rows = parseCsv(text.replace(/^\uFEFF/, ''));
  const headers = rows.shift();
  if (
    !headers?.length ||
    headers.length > 60 ||
    headers.some((h) => !h.trim()) ||
    new Set(headers.map(normal)).size !== headers.length
  )
    throw new Error('Use one header row with distinct, non-empty column names (up to 60 columns).');
  if (!rows.length || rows.length > 600) throw new Error('Use 1–600 rows per file.');
  for (const [i, row] of rows.entries())
    if (row.length !== headers.length)
      throw new Error(
        'Row ' +
          (i + 2) +
          ' has ' +
          row.length +
          ' cells; the header has ' +
          headers.length +
          '. Check commas and quotes.',
      );
  return {headers, rows};
}
export function guessColumns(headers: string[], kind: ImportKind) {
  return Object.fromEntries(
    importFields[kind].map((f) => [f.key, headers.findIndex((h) => f.aliases.includes(normal(h)))]),
  );
}
export function importDate(v: string) {
  let x = v.trim();
  const m = x.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) x = m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  return dateSchema.parse(x);
}
export function importMoney(value: string, blankZero = false) {
  let v = value.trim();
  if (!v && blankZero) return 0;
  let negative = false;
  if (v.startsWith('(') && v.endsWith(')')) {
    negative = true;
    v = v.slice(1, -1);
  }
  v = v.replace(/^AUD\s*/i, '').replace(/^\$/, '');
  if (v.startsWith('-')) {
    if (negative) throw new Error('Invalid negative amount');
    negative = true;
    v = v.slice(1);
  }
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(v))
    throw new Error('Use AUD amounts with at most two decimals.');
  const [whole, fraction = ''] = v.replaceAll(',', '').split('.');
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(n) || n > 1000000000) throw new Error('Amount exceeds $10 million.');
  return negative ? -n : n;
}
export const importSpecSchema = z.object({
  kind: z.enum(importKinds),
  text: z.string().max(450000).default(''),
  columns: z.record(z.number().int().min(-1).max(59)).default({}),
  accounts: z.record(z.string()).default({}),
  taxes: z.record(z.enum(['gst', 'free', 'none'])).default({}),
  priceBasis: z.enum(['unconfirmed', 'inclusive', 'exclusive']).default('unconfirmed'),
  bankAccount: z.enum(bankCodes).default('100'),
  defaultRole: z.enum(['customer', 'supplier', 'both']).default('customer'),
  date: dateSchema.optional(),
  notes: z.string().trim().max(2000).default(''),
  audConfirmed: z.boolean().default(false),
});
export type ImportSpec = z.infer<typeof importSpecSchema>;
export type ImportPlan = {
  kind: ImportKind;
  rows: number;
  documents: Doc[];
  contacts: Contact[];
  banks: Omit<Bank, 'id'>[];
  balances: {
    source: string;
    account: string;
    name: string;
    debit: number;
    credit: number;
    balance: number;
  }[];
  skipped: string[];
  warnings: string[];
  errors: string[];
  count: number;
  total: number;
  gst: number;
  debits: number;
  credits: number;
};
export function makeImportPlan(input: unknown, state: State, sourceId: string): ImportPlan {
  const spec = importSpecSchema.parse(input),
    p: ImportPlan = {
      kind: spec.kind,
      rows: 0,
      documents: [],
      contacts: [],
      banks: [],
      balances: [],
      skipped: [],
      warnings: [],
      errors: [],
      count: 0,
      total: 0,
      gst: 0,
      debits: 0,
      credits: 0,
    };
  if (spec.kind === 'reference') {
    if (spec.notes.length < 5) p.errors.push('Describe what this reference shows.');
    p.count = 1;
    return p;
  }
  if (!spec.audConfirmed && spec.kind !== 'contacts')
    p.errors.push('Confirm that the source amounts are in Australian dollars.');
  const table = readImportCsv(spec.text);
  p.rows = table.rows.length;
  for (const f of importFields[spec.kind])
    if (f.required && (spec.columns[f.key] === undefined || spec.columns[f.key] < 0))
      p.errors.push('Map ' + f.label + '.');
  for (const index of Object.values(spec.columns))
    if (index >= table.headers.length) p.errors.push('A mapped column is outside this file.');
  if (p.errors.length) return p;
  const get = (row: string[], key: string) => {
    const i = spec.columns[key];
    return i === undefined || i < 0 ? '' : row[i]?.trim() || '';
  };
  const sources = guessColumns(table.headers, spec.kind),
    raw = (row: string[], key: string) => (sources[key] >= 0 ? row[sources[key]] : '');
  const current = derive(state.events),
    ops = operations(state.events),
    groups = new Map<string, Doc>(),
    expectedTotals = new Map<string, number>(),
    numbers = new Set<string>(),
    bankRefs = new Set<string>(),
    contactNames = new Set(ops.contacts.map((c) => c.name.toLowerCase()));
  const locked = (date: string) => {
    if (state.settings.lockDate && date <= state.settings.lockDate)
      throw new Error('Date is within the locked period.');
  };
  for (const [i, row] of table.rows.entries()) {
    try {
      const g = (key: string) => get(row, key);
      if (
        spec.kind !== 'contacts' &&
        (g('currency') || raw(row, 'currency')) &&
        !/^(AUD|A\$)$/i.test(g('currency') || raw(row, 'currency'))
      )
        throw new Error('Only AUD imports are supported.');
      if (spec.kind === 'contacts') {
        const name = g('name'),
          key = name.toLowerCase();
        if (contactNames.has(key)) {
          p.skipped.push(
            'Row ' +
              (i + 2) +
              ': ' +
              name +
              ' already exists or is repeated; no contact details are overwritten.',
          );
          continue;
        }
        const role = g('role').toLowerCase() || spec.defaultRole;
        if (!['customer', 'supplier', 'both'].includes(role))
          throw new Error('Contact type must be customer, supplier or both.');
        const contact = contactSchema.parse({
          id: crypto.randomUUID(),
          name,
          email: g('email'),
          phone: g('phone'),
          address: g('address'),
          abn: g('abn').replace(/\s/g, ''),
          role,
          termsDays: g('terms') ? Number(g('terms')) : 14,
          notes: g('notes'),
          contractor: false,
          archived: false,
        });
        if (contact.abn && !validAbn(contact.abn)) throw new Error('ABN checksum is invalid.');
        contactNames.add(key);
        p.contacts.push(contact);
      } else if (spec.kind === 'bank') {
        const date = importDate(g('date'));
        locked(date);
        const hasAmount = (spec.columns.amount ?? -1) >= 0,
          hasSplit = (spec.columns.debit ?? -1) >= 0 || (spec.columns.credit ?? -1) >= 0;
        if (hasAmount && hasSplit)
          throw new Error('Map a signed amount OR debit/credit columns, not both.');
        if (!hasAmount && !hasSplit)
          throw new Error('Map a signed amount or debit/credit columns.');
        const debit = hasSplit ? importMoney(g('debit'), true) : 0,
          credit = hasSplit ? importMoney(g('credit'), true) : 0;
        if (debit < 0 || credit < 0 || (debit && credit))
          throw new Error('Money out/in must be positive, with only one side per row.');
        const amount = hasAmount ? importMoney(g('amount')) : credit - debit;
        if (!amount) throw new Error('Bank amount cannot be zero.');
        const description = z.string().trim().min(1).max(500).parse(g('description')),
          reference = z
            .string()
            .min(1)
            .max(160)
            .parse(g('reference') || 'IMPORT-' + sourceId + '-' + (i + 1));
        const fingerprint = bankFingerprint(spec.bankAccount, reference);
        if (bankRefs.has(fingerprint)) throw new Error('Repeated bank reference within this file.');
        bankRefs.add(fingerprint);
        const existing = current.banks.find(
          (b) => (b.account || '100') === spec.bankAccount && b.reference === reference,
        );
        if (existing) {
          if (
            existing.date !== date ||
            existing.amount !== amount ||
            existing.description !== description
          )
            throw new Error('Reference already exists with different details: ' + reference);
          p.skipped.push(
            'Row ' + (i + 2) + ': identical bank reference ' + reference + ' already imported.',
          );
          continue;
        }
        if (
          [...current.banks, ...p.banks].some(
            (b) =>
              (b.account || '100') === spec.bankAccount &&
              b.date === date &&
              b.amount === amount &&
              b.description.toLowerCase() === description.toLowerCase(),
          )
        )
          p.warnings.push(
            'Row ' +
              (i + 2) +
              ': possible overlapping bank transaction. Check date, description and amount before confirming.',
          );
        p.banks.push({date, description, amount, reference, account: spec.bankAccount});
      } else if (spec.kind === 'trial_balance') {
        const source = g('account'),
          account = spec.accounts[source];
        if (!account || !accounts.some((a) => a[0] === account))
          throw new Error('Map source account ' + source + ' to a TradeDesk account.');
        if (numbers.has(account))
          throw new Error(
            'Several rows map to account ' +
              account +
              '. Combine their balances explicitly before import.',
          );
        numbers.add(account);
        const hasBalance = (spec.columns.balance ?? -1) >= 0,
          hasSplit = (spec.columns.debit ?? -1) >= 0 || (spec.columns.credit ?? -1) >= 0;
        if (hasBalance === hasSplit)
          throw new Error('Map a signed balance OR debit/credit columns.');
        let debit = hasBalance
            ? Math.max(0, importMoney(g('balance')))
            : importMoney(g('debit'), true),
          credit = hasBalance
            ? Math.max(0, -importMoney(g('balance')))
            : importMoney(g('credit'), true);
        if (debit < 0 || credit < 0 || (debit && credit))
          throw new Error('Use one positive debit or credit per account.');
        p.balances.push({
          source,
          account,
          name: g('name') || accounts.find((a) => a[0] === account)![1],
          debit,
          credit,
          balance: debit - credit,
        });
      } else {
        if (spec.priceBasis === 'unconfirmed')
          throw new Error('Confirm whether unit prices include or exclude GST.');
        // Recognised payment/status columns are checked even if the user leaves them unmapped.
        for (const v of [g('paid'), raw(row, 'paid')])
          if (v && importMoney(v) !== 0)
            throw new Error(
              'Paid or partly paid documents need a separate opening-balance migration.',
            );
        for (const [total, remaining] of [
          [g('total'), g('amountdue')],
          [raw(row, 'total'), raw(row, 'amountdue')],
        ])
          if (total && remaining && importMoney(total) !== importMoney(remaining))
            throw new Error(
              'Outstanding amount differs from total; payment history must be migrated separately.',
            );
        for (const status of [g('status'), raw(row, 'status')])
          if (
            /^(paid|part.?paid|partially.?paid|void(?:ed)?|deleted|cancel(?:led|ed)?)$/i.test(
              status.trim(),
            )
          )
            throw new Error('Paid, void or deleted documents cannot be imported as unpaid drafts.');
        const unsupportedDiscount = table.headers.findIndex((h) =>
          ['discount', 'discountrate', 'discountpercent'].includes(normal(h)),
        );
        if (
          unsupportedDiscount >= 0 &&
          row[unsupportedDiscount] &&
          Number(row[unsupportedDiscount]) !== 0
        )
          throw new Error(
            'Convert percentage/unspecified discounts to an explicit DiscountAmount first.',
          );
        const number = g('number'),
          contact = g('contact'),
          date = importDate(g('date')),
          due = importDate(g('due')),
          key = number.toLowerCase();
        locked(date);
        const account = spec.accounts[g('account')],
          tax = spec.taxes[g('tax')];
        if (!account || !tax)
          throw new Error('Map source account and tax treatment, including blank values.');
        const expected = g('total') || raw(row, 'total');
        if (expected) {
          const amount = importMoney(expected);
          if (expectedTotals.has(key) && expectedTotals.get(key) !== amount)
            throw new Error('Conflicting document totals for ' + number);
          expectedTotals.set(key, amount);
        }
        const unit = importMoney(g('price')),
          discount = importMoney(g('discount'), true);
        if (unit < 0 || discount < 0)
          throw new Error('Negative lines and credit notes need the credits workflow.');
        let d = groups.get(key);
        if (!d) {
          const matches = ops.contacts.filter(
            (c) => !c.archived && c.name.toLowerCase() === contact.toLowerCase(),
          );
          d = {
            id: crypto.randomUUID(),
            type: spec.kind,
            number,
            contact,
            contactId: matches.length === 1 ? matches[0].id : undefined,
            contactAddress: g('address'),
            contactAbn: g('abn'),
            date,
            due,
            reference: g('reference') || (spec.kind === 'bill' ? number : ''),
            job: g('job'),
            inclusive: spec.priceBasis === 'inclusive',
            notes:
              'Imported draft. Source file is retained in Import centre. Review before posting.',
            lines: [],
          };
          groups.set(key, d);
        } else if (
          d.contact !== contact ||
          d.date !== date ||
          d.due !== due ||
          d.reference !== (g('reference') || (spec.kind === 'bill' ? number : ''))
        )
          throw new Error(
            'Conflicting details for document ' +
              number +
              '. Use distinct internal numbers for different bills.',
          );
        d.lines.push({
          description: g('description'),
          qty: g('qty'),
          price: (unit / 100).toFixed(2),
          discount: (discount / 100).toFixed(2),
          account,
          tax,
        });
      }
    } catch (e) {
      p.errors.push(
        'Row ' +
          (i + 2) +
          ': ' +
          (e instanceof z.ZodError
            ? e.issues.map((x) => x.path.join('.') + ': ' + x.message).join('; ')
            : (e as Error).message),
      );
    }
  }
  if (spec.kind === 'invoice' || spec.kind === 'bill')
    for (const d of groups.values()) {
      try {
        const parsed = documentSchema.parse(d);
        validateDocument(parsed, state.settings.gst);
        const expected = expectedTotals.get(parsed.number.toLowerCase());
        if (expected !== undefined && totals(parsed).total !== expected)
          throw new Error(
            'Calculated total does not match the source document total. Check all lines, prices and GST.',
          );
        if (
          current.docs.some(
            (x) => x.type === spec.kind && x.number.toLowerCase() === parsed.number.toLowerCase(),
          )
        )
          throw new Error('Document number already exists: ' + parsed.number);
        const other = [
          ...state.events,
          ...p.documents.map((x) => ({id: x.id, kind: 'document', payload: x, createdAt: ''})),
        ];
        if (duplicateBill(parsed, other))
          throw new Error('Supplier reference already exists: ' + parsed.reference);
        p.documents.push(parsed);
      } catch (e) {
        p.errors.push(
          'Document ' +
            d.number +
            ': ' +
            (e instanceof z.ZodError
              ? e.issues.map((x) => x.message).join('; ')
              : (e as Error).message),
        );
      }
    }
  if (
    p.documents.length > 200 ||
    p.contacts.length > 300 ||
    p.banks.length > 300 ||
    p.balances.length > 60
  )
    p.errors.push(
      'Split this file: maximum 200 documents, 300 contacts/bank lines, or 60 balance rows.',
    );
  p.count = p.contacts.length + p.banks.length + p.documents.length + p.balances.length;
  p.total =
    p.documents.reduce((n, d) => n + totals(d).total, 0) +
    p.banks.reduce((n, b) => n + b.amount, 0);
  p.gst = p.documents.reduce((n, d) => n + totals(d).taxTotal, 0);
  p.debits = p.balances.reduce((n, b) => n + b.debit, 0);
  p.credits = p.balances.reduce((n, b) => n + b.credit, 0);
  if (spec.kind === 'trial_balance') {
    if (!spec.date) p.errors.push('Enter the date of the trial balance.');
    if (p.debits !== p.credits)
      p.warnings.push(
        'The trial balance is out of balance. It will be saved as a reference for investigation and will not post to the ledger.',
      );
  }
  if (spec.kind === 'bank' && (spec.columns.reference ?? -1) < 0)
    p.warnings.push(
      'Generated references identify this file only. Overlapping exports may contain the same transactions; inspect the duplicate warnings.',
    );
  if (spec.kind === 'invoice' || spec.kind === 'bill')
    p.warnings.push(
      'Documents are drafts. Paid history, opening balances and ledger postings are not imported.',
    );
  return p;
}
export const templates: Record<ImportKind, string> = {
  contacts: 'Name,Email,Phone,Address,ABN,Role\nExample customer,,,,,customer\n',
  bank: 'Date,Description,Amount,Reference\n2026-10-01,Example customer payment,110.00,EXAMPLE-001\n2026-10-02,Example materials,-55.00,EXAMPLE-002\n',
  invoice:
    'Number,Contact,Date,Due,Description,Quantity,UnitPrice,Tax,Account,Reference\nINV-EXAMPLE,Example customer,2026-10-01,2026-10-15,Plumbing labour,1,100.00,GST,Labour,Example job\n',
  bill: 'Number,Contact,Date,Due,Description,Quantity,UnitPrice,Tax,Account,Reference\nBILL-EXAMPLE,Example supplier,2026-10-01,2026-10-15,Materials,1,50.00,GST,Materials,SUPPLIER-001\n',
  trial_balance:
    'Account,Name,Debit,Credit\nBusiness bank,Main bank,1000.00,0\nOwner funds,Owner funds,0,1000.00\n',
  reference: '',
};
