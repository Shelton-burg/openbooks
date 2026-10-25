import {parseCsv, documentSchema, dateSchema, derive, type Doc, type State} from './books.ts';
import {validateDocument, operations} from './operations.ts';
function date(value: string) {
  const x = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(x)) return dateSchema.parse(x);
  const m = x.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return dateSchema.parse(m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'));
  throw new Error('Dates must use YYYY-MM-DD or DD/MM/YYYY.');
}
export function inspectDocumentCSV(text: string) {
  const data = parseCsv(text.replace(/^\uFEFF/, '')),
    headers = (data.shift() || []).map((x) => x.replace(/[^a-zA-Z0-9]/g, '').toLowerCase());
  const aliases = {
    contact: ['contact', 'contactname'],
    number: ['number', 'invoicenumber', 'billnumber'],
    date: ['date', 'invoicedate', 'billdate'],
    due: ['due', 'duedate'],
    description: ['description'],
    qty: ['quantity', 'qty'],
    price: ['unitprice', 'unitamount'],
    tax: ['tax', 'taxtype'],
    account: ['account', 'accountcode'],
    reference: ['reference'],
    job: ['job'],
    address: ['contactaddress'],
    abn: ['contactabn'],
    paid: ['amountpaid', 'paid'],
    total: ['total', 'invoicetotal'],
    amountdue: ['amountdue', 'amountremaining'],
  };
  const columns = Object.fromEntries(
    Object.entries(aliases).map(([key, values]) => [
      key,
      headers.findIndex((h) => values.includes(h)),
    ]),
  );
  for (const key of [
    'contact',
    'number',
    'date',
    'due',
    'description',
    'qty',
    'price',
    'tax',
    'account',
  ])
    if (columns[key] < 0) throw new Error('Missing column: ' + key);
  if (!data.length || data.length > 600) throw new Error('Import 1–600 line items per batch.');
  const rows = data.map((r, i) => {
    const get = (key: string) => (columns[key] < 0 ? '' : (r[columns[key]] || '').trim());
    if (
      (get('paid') && Number(get('paid')) !== 0) ||
      (get('total') &&
        get('amountdue') &&
        (!Number.isFinite(Number(get('total'))) ||
          Number(get('amountdue')) !== Number(get('total'))))
    )
      throw new Error(
        'Row ' +
          (i + 2) +
          ' has payments. Paid history and partially paid opening documents require a coordinated migration.',
      );
    return Object.fromEntries(Object.keys(aliases).map((k) => [k, get(k)]));
  });
  return {
    rows,
    accounts: [...new Set(rows.map((r) => r.account))],
    taxes: [...new Set(rows.map((r) => r.tax))],
  };
}
export function documentImport(
  text: string,
  state: State,
  type: 'invoice' | 'bill',
  inclusive: boolean,
  mapping: {accounts: Record<string, string>; taxes: Record<string, string>},
) {
  const parsed = inspectDocumentCSV(text),
    groups = new Map<string, Doc>(),
    contacts = operations(state.events).contacts;
  for (const [i, r] of parsed.rows.entries()) {
    const key = r.number.toLowerCase(),
      account = mapping.accounts[r.account],
      tax = mapping.taxes[r.tax];
    if (!account || !tax)
      throw new Error('Map every source account and tax code before previewing.');
    const issued = date(r.date),
      due = date(r.due),
      line = {description: r.description, qty: r.qty, price: r.price, tax, account};
    let d = groups.get(key);
    if (!d) {
      const contact = contacts.filter(
        (c) => !c.archived && c.name.toLowerCase() === r.contact.toLowerCase(),
      );
      d = {
        id: crypto.randomUUID(),
        type,
        number: r.number,
        contact: r.contact,
        contactId: contact.length === 1 ? contact[0].id : undefined,
        contactAddress: r.address || contact[0]?.address || '',
        contactAbn: r.abn || contact[0]?.abn || '',
        date: issued,
        due,
        job: r.job,
        reference: r.reference,
        notes: 'Imported as a draft for migration review. No payment history imported.',
        inclusive,
        lines: [],
      };
      groups.set(key, d);
    } else if (
      d.contact !== r.contact ||
      d.date !== issued ||
      d.due !== due ||
      d.reference !== r.reference
    )
      throw new Error('Conflicting header details for ' + r.number + ' at row ' + (i + 2));
    d.lines.push(line as Doc['lines'][number]);
  }
  if (groups.size > 200) throw new Error('Import up to 200 documents per batch.');
  const existing = derive(state.events).docs;
  return [...groups.values()].map((d) => {
    const p = documentSchema.parse(d);
    validateDocument(p, state.settings.gst);
    if (existing.some((x) => x.type === type && x.number.toLowerCase() === p.number.toLowerCase()))
      throw new Error('Document already exists: ' + p.number);
    return p;
  });
}
