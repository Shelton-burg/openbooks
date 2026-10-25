import {z} from 'zod';
import {dateSchema, accounts, report, derive, parseCsv, type State} from './books.ts';
import {agedDocuments} from './operations.ts';
const signed = z.number().int().min(-100000000000).max(100000000000);
export const comparisonSchema = z.object({
  date: dateSchema,
  source: z.string().trim().min(3).max(300),
  basis: z.enum(['cash', 'accrual']),
  balances: z
    .array(z.object({account: z.string(), balance: signed}))
    .min(1)
    .max(60),
  documents: z
    .array(
      z.object({
        type: z.enum(['invoice', 'bill']),
        number: z.string().min(1).max(100),
        contact: z.string().min(1).max(160),
        balance: z.number().int().nonnegative().max(100000000000),
      }),
    )
    .max(500),
  gstSales: signed.nullable(),
  gstPurchases: signed.nullable(),
  periodFrom: dateSchema,
});
export function cutoverComparison(state: State, input: unknown) {
  const p = comparisonSchema.parse(input);
  if (p.periodFrom > p.date) throw new Error('Period starts after the comparison date.');
  if (new Set(p.balances.map((x) => x.account)).size !== p.balances.length)
    throw new Error('Use each mapped account once.');
  if (p.balances.some((x) => !accounts.some((a) => a[0] === x.account)))
    throw new Error('Map every account to a valid TradeDesk account.');
  const r = report(state.events, p.periodFrom, p.date, p.basis),
    open = [
      ...agedDocuments(state.events, p.date, 'invoice'),
      ...agedDocuments(state.events, p.date, 'bill'),
    ];
  const norm = (s: string) => s.trim().toLowerCase();
  const seen = new Set<string>();
  const documents = p.documents.map((x) => {
    const key = x.type + '|' + norm(x.number) + '|' + norm(x.contact);
    if (seen.has(key)) throw new Error('Repeated source document ' + x.number);
    seen.add(key);
    const matches = open.filter(
      (d) =>
        d.type === x.type &&
        norm(d.type === 'bill' && d.reference ? d.reference : d.number) === norm(x.number) &&
        norm(d.contact) === norm(x.contact),
    );
    const d = matches.length === 1 ? matches[0] : undefined;
    return {
      ...x,
      local: d?.balance ?? null,
      difference: d ? d.balance - x.balance : null,
      status:
        matches.length > 1
          ? 'Ambiguous'
          : d
            ? d.balance === x.balance
              ? 'Agrees'
              : 'Difference'
            : 'Missing locally',
      docId: d?.id,
    };
  });
  const extras = open.filter((d) => !documents.some((x) => x.docId === d.id));
  const balances = p.balances.map((x) => ({
    ...x,
    local: r.trial.find((a) => a.code === x.account)!.balance,
    difference: r.trial.find((a) => a.code === x.account)!.balance - x.balance,
  }));
  const missingAccounts = r.trial.filter(
    (a) => a.balance && !p.balances.some((x) => x.account === a.code),
  );
  const gst = [
    {
      name: 'GST sales',
      source: p.gstSales,
      local: r.gstSales,
      difference: p.gstSales === null ? null : r.gstSales - p.gstSales,
    },
    {
      name: 'GST purchases (recorded)',
      source: p.gstPurchases,
      local: r.gstPurchases,
      difference: p.gstPurchases === null ? null : r.gstPurchases - p.gstPurchases,
    },
  ];
  const sourceImbalance = p.balances.reduce((n, x) => n + x.balance, 0);
  return {
    ...p,
    sourceImbalance,
    preparedAt: new Date().toISOString(),
    sourceRevision: state.events.at(-1)?.id || 'empty',
    balances,
    documents,
    extras: extras.map((d) => ({
      number: d.number,
      contact: d.contact,
      type: d.type,
      balance: d.balance,
    })),
    missingAccounts,
    gst,
    differences:
      (sourceImbalance ? 1 : 0) +
      balances.filter((x) => x.difference).length +
      documents.filter((x) => x.status !== 'Agrees').length +
      extras.length +
      missingAccounts.length +
      gst.filter((x) => x.difference !== 0).length,
    notice:
      'Source amounts were entered or pasted by the owner. Agreement is not independent verification of completeness or tax eligibility. Bill matching uses supplier reference and supplier name.',
  };
}
export function compareCsv(text: string, kind: 'balances' | 'documents') {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('Include a header and at least one row.');
  const parse = (s: string) => {
    if (!/^-?\d+(\.\d{1,2})?$/.test(s))
      throw new Error('Amounts must be decimal dollars, no currency symbols.');
    return Math.round(Number(s) * 100);
  };
  return kind === 'balances'
    ? rows.slice(1).map((r) => {
        if (r.length !== 2) throw new Error('Use Account,Balance columns.');
        return {account: r[0], balance: parse(r[1])};
      })
    : rows.slice(1).map((r) => {
        if (r.length !== 4) throw new Error('Use Type,Number,Contact,Balance columns.');
        return {type: r[0], number: r[1], contact: r[2], balance: parse(r[3])};
      });
}
