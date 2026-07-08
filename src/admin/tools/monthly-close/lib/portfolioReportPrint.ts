import type { PortfolioReportLike } from "./portfolioReportCsv";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function currency(n: number): string {
  return fmt.format(n);
}

function margin(n: number | null): string {
  return n === null ? "—" : `${n.toFixed(1)}%`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const STYLE = `
  body { font-family: sans-serif; margin: 2rem; color: #111; }
  h1 { color: #1e40af; font-size: 1.25rem; margin-bottom: 1.25rem; }
  table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
  th { background: #1e40af; color: #fff; padding: 6px 10px; text-align: right; white-space: nowrap; }
  th:first-child { text-align: left; }
  td { padding: 5px 10px; border-bottom: 1px solid #e2e8f0; text-align: right; }
  td:first-child { text-align: left; }
  tr:nth-child(even) td { background: #f8fafc; }
  tr.total td { font-weight: 700; background: #eff6ff; border-top: 2px solid #1e40af; }
  p.note { font-size: 0.78rem; color: #64748b; margin-top: 0.75rem; }
  @media print {
    body { margin: 0.5cm; }
    button { display: none; }
  }
`.trim();

export function portfolioReportToPrintHtml(report: PortfolioReportLike): string {
  const rows = report.rows
    .map((r) => {
      const cleaning = r.bucketTotals["cleaning"] ?? 0;
      const fixed = r.costs - cleaning;
      return `
    <tr>
      <td>${escape(r.name)}</td>
      <td>${currency(r.revenue)}</td>
      <td>${r.bookingCount}</td>
      <td>${currency(cleaning)}</td>
      <td>${currency(fixed)}</td>
      <td>${currency(r.costs)}</td>
      <td>${currency(r.net)}</td>
      <td>${margin(r.marginPercent)}</td>
    </tr>`;
    })
    .join("");

  const excludedNote =
    report.excluded.length > 0
      ? `<p class="note">${report.excluded.length} unit(s) excluded (dropped/managed).</p>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Monthly Close — Portfolio P&amp;L — ${escape(report.month)}</title>
  <style>${STYLE}</style>
</head>
<body>
  <h1>Monthly Close — Portfolio P&amp;L — ${escape(report.month)}</h1>
  <table>
    <thead>
      <tr>
        <th>Property</th>
        <th>Revenue</th>
        <th>Bookings</th>
        <th>Cleaning</th>
        <th>Fixed</th>
        <th>Total Cost</th>
        <th>Net</th>
        <th>Margin %</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <tr class="total">
        <td>PORTFOLIO TOTAL</td>
        <td>${currency(report.revenueGross)}</td>
        <td></td>
        <td></td>
        <td></td>
        <td>${currency(report.totalCosts)}</td>
        <td>${currency(report.netProfit)}</td>
        <td>${margin(report.marginPercent)}</td>
      </tr>
    </tbody>
  </table>
  ${excludedNote}
</body>
</html>`;
}
