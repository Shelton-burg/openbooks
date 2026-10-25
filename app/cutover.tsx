'use client';
import {useState} from 'react';
import {today, money, accounts, type State} from '@/lib/books';
import {compareCsv} from '@/lib/cutover';
import {Choice, download} from './book-ui';
export default function Cutover({
  state,
  canWrite,
  mutate,
}: {
  state: State;
  canWrite: boolean;
  mutate: (b: unknown) => Promise<boolean>;
}) {
  const [date, setDate] = useState(today()),
    [from, setFrom] = useState(today().slice(0, 8) + '01'),
    [source, setSource] = useState(''),
    [basis, setBasis] = useState('cash'),
    [balances, setBalances] = useState('Account,Balance\n'),
    [documents, setDocuments] = useState('Type,Number,Contact,Balance\n'),
    [sales, setSales] = useState(''),
    [purchases, setPurchases] = useState(''),
    [error, setError] = useState('');
  const saved = state.events.filter((e) => e.kind === 'cutover_comparison').reverse();
  return (
    <section className="panel settings-panel book-form">
      <h2>Compare your books with Xero</h2>
      <p>
        Use reports with the same date and GST basis. Map Xero account codes to the TradeDesk codes
        below. Amounts are AUD; debit balances are positive and credit balances negative.
      </p>
      <details>
        <summary>TradeDesk account codes</summary>
        {accounts.map((a) => (
          <p key={a[0]}>
            {a[0]} · {a[1]}
          </p>
        ))}
      </details>
      <form
        className="book-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          try {
            const amount = (s: string) => {
              if (!s.trim()) return null;
              if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error('Check GST amounts.');
              return Math.round(Number(s) * 100);
            };
            await mutate({
              action: 'cutoverComparison',
              comparison: {
                date,
                periodFrom: from,
                source,
                basis,
                balances: compareCsv(balances, 'balances'),
                documents:
                  documents.trim() === 'Type,Number,Contact,Balance'
                    ? []
                    : compareCsv(documents, 'documents'),
                gstSales: amount(sales),
                gstPurchases: amount(purchases),
              },
            });
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <label>
          Source report names / export dates
          <input
            required
            minLength={3}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </label>
        <div className="form-grid">
          <label>
            Comparison date
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            GST period starts
            <input type="date" required value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
        </div>
        <Choice
          label="Source GST basis"
          value={basis}
          onChange={setBasis}
          options={[
            ['cash', 'Cash'],
            ['accrual', 'Non-cash / accrual'],
          ]}
        />
        <label>
          Mapped trial balance CSV
          <textarea rows={7} value={balances} onChange={(e) => setBalances(e.target.value)} />
        </label>
        <label>
          Unpaid invoice and bill CSV
          <textarea rows={7} value={documents} onChange={(e) => setDocuments(e.target.value)} />
        </label>
        <p className="fineprint">
          Type is invoice or bill. Number for bills is the supplier invoice reference. Include every
          outstanding document, including partly paid balances.
        </p>
        <div className="form-grid">
          <label>
            Xero GST sales $<input value={sales} onChange={(e) => setSales(e.target.value)} />
          </label>
          <label>
            Xero GST purchases $
            <input value={purchases} onChange={(e) => setPurchases(e.target.value)} />
          </label>
        </div>
        <button className="btn primary" disabled={!canWrite}>
          Save comparison & show differences
        </button>
      </form>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {saved.map((e) => {
        const p = e.payload;
        return (
          <details key={e.id} open={e === saved[0]}>
            <summary>
              {p.date} · {p.source} · {p.differences} differences / missing comparisons
            </summary>
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Xero</th>
                  <th>Local</th>
                  <th>Difference</th>
                </tr>
              </thead>
              <tbody>
                {p.balances.map((x: any) => (
                  <tr key={x.account}>
                    <td>{x.account}</td>
                    <td>{money(x.balance)}</td>
                    <td>{money(x.local)}</td>
                    <td>{money(x.difference)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {p.documents.map((x: any, i: number) => (
              <p key={i}>
                {x.number} · {x.contact}: {x.status}
                {x.difference !== null ? ' · ' + money(x.difference) : ''}
              </p>
            ))}
            {p.extras.map((x: any) => (
              <p key={x.number}>
                Extra locally: {x.number} · {money(x.balance)}
              </p>
            ))}
            {p.missingAccounts.map((x: any) => (
              <p key={x.code}>
                Account missing from source comparison: {x.code} {x.name}
              </p>
            ))}
            {p.gst.map((x: any) => (
              <p key={x.name}>
                {x.name}:{' '}
                {x.difference === null
                  ? 'Source figure missing'
                  : money(x.difference) + ' difference'}
              </p>
            ))}
            {p.sourceImbalance !== 0 && (
              <p className="form-error">
                Source trial balance is out by {money(p.sourceImbalance)}. Check all account
                mappings and signs.
              </p>
            )}
            <p>{p.notice}</p>
            <button
              className="btn"
              onClick={() =>
                download(
                  'cutover-comparison-' + p.date + '.json',
                  JSON.stringify(p, null, 2),
                  'application/json',
                )
              }
            >
              Download comparison
            </button>
          </details>
        );
      })}
    </section>
  );
}
