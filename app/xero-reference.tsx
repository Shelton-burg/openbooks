'use client';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  Landmark,
  FileText,
  CalendarDays,
  ShieldCheck,
  BookOpen,
  Download,
  TriangleAlert,
} from 'lucide-react';
import {Table, TableHeader, TableHead, TableRow, TableBody, TableCell} from '@/components/ui/table';
import {money, shortDate} from '@/lib/books';
import type {XeroReference} from '@/lib/xero-reference';
export default function XeroReferencePanel({
  reference: r,
  onBank,
  onBooks,
}: {
  reference: XeroReference;
  onBank: (account: string) => void;
  onBooks: () => void;
}) {
  const main = r.banks[0],
    difference = main.statementBalance - (main.bookBalance || 0);
  function exportReference() {
    const content = JSON.stringify({recordType: 'screenshot_reference_only', ...r}, null, 2);
    const url = URL.createObjectURL(new Blob([content], {type: 'application/json'}));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'xero-screenshot-reference.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="xero-reference">
      <div className="notice reference-notice">
        <BookOpen size={20} />
        <div>
          <strong>From your Xero screenshot</strong>
          <p>
            Provided {shortDate(r.receivedOn)}. These figures are a reference for setup; they do not
            update from Xero or post to your books.
          </p>
        </div>
        <button onClick={exportReference}>
          <Download size={16} />
          Export reference
        </button>
      </div>
      <div className="metrics reference-metrics">
        <article className="metric balance">
          <span>
            <Landmark size={18} /> Business Everyday
          </span>
          <strong>{money(main.statementBalance)}</strong>
          <small>Statement balance shown · {main.statementDateLabel}</small>
        </article>
        <article className="metric">
          <span>
            <ArrowDownLeft size={18} /> Customers owe you
          </span>
          <strong>{money(r.invoices.total)}</strong>
          <small>
            {r.invoices.count} invoices · {r.invoices.overdueCount} overdue
          </small>
        </article>
        <article className="metric">
          <span>
            <ArrowUpRight size={18} /> Bills to pay
          </span>
          <strong>{money(r.bills.total)}</strong>
          <small>
            {r.bills.count} bills · {r.bills.overdueCount} overdue
          </small>
        </article>
        <article className="metric">
          <span>
            <FileText size={18} /> Net profit · YTD
          </span>
          <strong>{money(r.profit.amount)}</strong>
          <small>
            {shortDate(r.profit.from)} – {shortDate(r.profit.to)}
          </small>
        </article>
      </div>
      <div className="reference-grid">
        <section className="panel reference-priorities">
          <div className="panel-heading">
            <div>
              <h2>Where to focus first</h2>
              <p>Priorities visible in the screenshot</p>
            </div>
            <span className="reference-tag">Xero reference</span>
          </div>
          <div className="priority-feature">
            <div className="priority-number">{main.unreconciled}</div>
            <div>
              <h3>bank items awaiting reconciliation</h3>
              <p>
                The statement and Xero book balances differ by <strong>{money(difference)}</strong>.
              </p>
              <button className="text-btn" onClick={() => onBank(main.account)}>
                Prepare statement imports <ArrowRight size={16} />
              </button>
            </div>
          </div>
          <div className="reference-priority-row">
            <span className="priority-index">02</span>
            <div>
              <h3>
                Follow up {r.invoices.overdueCount} overdue{' '}
                {r.invoices.overdueCount === 1 ? 'invoice' : 'invoices'}
              </h3>
              <p>
                {money(r.invoices.overdue)} overdue · {r.invoices.count} invoices outstanding
                overall
              </p>
            </div>
          </div>
          <div className="reference-priority-row">
            <span className="priority-index">03</span>
            <div>
              <h3>Review {r.bills.overdueCount} overdue supplier bills</h3>
              <p>{money(r.bills.overdue)} overdue · Check dates and payment arrangements in Xero</p>
            </div>
          </div>
          <div className="reference-priority-row">
            <span className="priority-index">04</span>
            <div>
              <h3>Review your drafts</h3>
              <p>
                {r.invoices.draftCount} draft {r.invoices.draftCount === 1 ? 'invoice' : 'invoices'}{' '}
                and {r.bills.draftCount} draft {r.bills.draftCount === 1 ? 'bill' : 'bills'}. Drafts
                stay outside posted totals.
              </p>
            </div>
          </div>
          <div className="attention-foot">
            <ShieldCheck size={17} /> Invoice and statement lines are needed before these items can
            be actioned here.
          </div>
        </section>
        <div className="reference-side">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Cash movement</h2>
                <p>{r.cash.periodLabel}</p>
              </div>
            </div>
            <div className="cash-reference">
              <div>
                <span>Money in</span>
                <strong>{money(r.cash.in)}</strong>
              </div>
              <div>
                <span>Money out</span>
                <strong>{money(r.cash.out)}</strong>
              </div>
              <div className="cash-reference-net">
                <span>Net cash movement</span>
                <strong>{money(r.cash.net)}</strong>
              </div>
            </div>
            <p className="reference-caption">
              This is a period’s movement, not the bank balance. Individual month values aren’t
              available from the screenshot.
            </p>
          </section>
          <section className="panel reference-deadline">
            <div className="deadline-icon">
              <CalendarDays size={24} />
            </div>
            <div>
              <h2>Activity statement</h2>
              <strong>{r.activityStatement.dueLabel}</strong>
              <p>{r.activityStatement.periodLabel}</p>
              <small>
                Shown in Xero. Confirm the due date there before lodging; lodgement is not connected
                here.
              </small>
            </div>
          </section>
        </div>
      </div>
      <section className="panel reference-accounts">
        <div className="panel-heading">
          <div>
            <h2>Your bank and cash accounts</h2>
            <p>
              Source balances retain their own dates. New ledger balances begin with imported and
              posted records.
            </p>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Source statement date</TableHead>
              <TableHead className="number">Statement balance</TableHead>
              <TableHead className="number">Xero book balance</TableHead>
              <TableHead>Next step</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.banks.map((b) => (
              <TableRow key={b.account}>
                <TableCell>
                  <strong>{b.name}</strong>
                </TableCell>
                <TableCell>{b.statementDateLabel}</TableCell>
                <TableCell className="number">{money(b.statementBalance)}</TableCell>
                <TableCell className="number">
                  {b.bookBalance === null ? 'Not displayed' : money(b.bookBalance)}
                </TableCell>
                <TableCell>
                  <button className="text-btn" onClick={() => onBank(b.account)}>
                    Open account <ArrowRight size={15} />
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="reference-reconciliation">
          <TriangleAlert size={18} />
          <span>
            <strong>{money(difference)} needs reconciliation</strong> in Business Everyday:{' '}
            {money(main.statementBalance)} statement less {money(main.bookBalance || 0)} in Xero. No
            balancing entry has been created.
          </span>
        </div>
      </section>
      <section className="panel reference-mapping">
        <div className="panel-heading">
          <div>
            <h2>Account mapping for migration</h2>
            <p>
              Proposed mappings only. Xero codes have not replaced the pilot’s existing account
              codes.
            </p>
          </div>
          <span className="status draft">Review needed</span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Xero account</TableHead>
              <TableHead>Proposed destination</TableHead>
              <TableHead>Review note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.mappings.map((m) => (
              <TableRow key={m.sourceCode}>
                <TableCell>
                  <strong>{m.sourceCode}</strong>
                  <span className="secondary">{m.sourceName}</span>
                </TableCell>
                <TableCell>
                  {m.targetCode && <strong>{m.targetCode} · </strong>}
                  {m.targetName}
                </TableCell>
                <TableCell className="mapping-note">{m.note}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      <section className="reference-next">
        <div>
          <h2>Ready to build from your records</h2>
          <p>
            Your dashboard totals are captured. Bank statements, invoice and bill exports, and a
            trial balance will let us verify the individual entries.
          </p>
          <small>
            ABN, GST registration, GST basis and payment account details remain unconfirmed.
          </small>
        </div>
        <button className="btn primary" onClick={onBooks}>
          Open working books <ArrowRight size={17} />
        </button>
      </section>
    </div>
  );
}
