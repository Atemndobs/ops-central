/**
 * ChezSoi Owner Statement HTML builder.
 * Pure, self-contained module — no React, no Convex runtime, no Date.now(), no Math.random().
 * Generates a standalone print-ready HTML document for property owners.
 */

import { CHEZSOI, CHEZSOI_LOGO_DATA_URI } from "./chezSoiBrand";
import type { PortfolioReport } from "@convex/strCosts/costMath";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface StatementProperty {
  id: string;
  name: string;
  hasData: boolean;
  bookingCount: number;
  grossRevenue: number;
  totalCosts: number;
  netProfit: number;
  marginPercent: number | null;
  lines: Array<{
    name: string;
    category: string | null;
    bucket: string;
    monthlyAmount: number;
  }>;
}

export interface StatementData {
  report: PortfolioReport;
  properties: StatementProperty[];
}

export interface StatementOpts {
  clientName: string;
  period: string;
  statementDate: string;
}

// ---------------------------------------------------------------------------
// Helpers — pure, no side-effects
// ---------------------------------------------------------------------------

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function fmtCurrency(n: number): string {
  return USD.format(n);
}

function fmtMargin(n: number | null): string {
  return n === null ? "—" : `${n.toFixed(1)}%`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Deterministic statement ID: derived from period + clientName only.
 * Uses a simple djb2-style hash over the combined key.
 */
function statementId(period: string, clientName: string): string {
  const key = `${period}|${clientName}`;
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = ((h * 33) ^ key.charCodeAt(i)) >>> 0;
  }
  const hex = h.toString(16).toUpperCase().padStart(8, "0");
  // Normalize period to slug: "June 2026" → "JUNE-2026"
  const slug = period.replace(/\s+/g, "-").toUpperCase();
  return `CSS-${slug}-${hex}`;
}

// ---------------------------------------------------------------------------
// Margin health colors (using ChezSoi palette)
// ---------------------------------------------------------------------------

function marginHealthColor(m: number | null): string {
  if (m === null) return "#6b7280";
  if (m >= 15) return CHEZSOI.color.primary;
  if (m >= 5) return "#b8860b";
  return "#e11d48";
}

function marginHealthBg(m: number | null): string {
  if (m === null) return "#f3f4f6";
  if (m >= 15) return "#f5edff";
  if (m >= 5) return "#fef9c3";
  return "#fee2e2";
}

// ---------------------------------------------------------------------------
// SVG: Cost distribution pie chart
// ---------------------------------------------------------------------------

const BUCKET_COLORS: Record<string, string> = {
  lease: "#9b51e0",
  utilities: "#bd77ff",
  cleaning: "#7c3aed",
  payouts: "#c4b5fd",
  subscriptions: "#6d28d9",
  other: "#a78bfa",
  unassigned: "#ddd6fe",
};

type BucketKey = "lease" | "utilities" | "cleaning" | "payouts" | "subscriptions" | "other" | "unassigned";

function buildPieChart(bucketTotals: Record<string, number>, totalCosts: number): string {
  const entries = (
    Object.entries(bucketTotals) as [BucketKey, number][]
  )
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);

  if (entries.length === 0 || totalCosts === 0) return "";

  const cx = 100;
  const cy = 100;
  const r = 80;
  let angle = -Math.PI / 2;

  const paths: string[] = [];
  const legendItems: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const [key, amount] = entries[i];
    const pct = amount / totalCosts;
    const sweep = pct * 2 * Math.PI;
    const color = BUCKET_COLORS[key] ?? "#9b51e0";

    if (pct > 0.01) {
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(angle + sweep);
      const y2 = cy + r * Math.sin(angle + sweep);
      const large = sweep > Math.PI ? 1 : 0;
      paths.push(
        `<path d="M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${color}" stroke="#fff" stroke-width="2"/>`
      );
    }

    angle += sweep;

    legendItems.push(
      `<div style="display:flex;align-items:center;gap:8px;margin:5px 0;">
        <div style="width:12px;height:12px;background:${color};border-radius:2px;flex-shrink:0;"></div>
        <span style="font-size:11px;font-family:${CHEZSOI.font.body};">${titleCase(key)}: ${fmtCurrency(amount)} (${(pct * 100).toFixed(1)}%)</span>
      </div>`
    );
  }

  return `
    <div style="display:flex;align-items:flex-start;gap:28px;justify-content:center;margin:20px 0;flex-wrap:wrap;">
      <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        ${paths.join("\n        ")}
      </svg>
      <div style="padding-top:16px;">
        ${legendItems.join("\n        ")}
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// SVG: Property margins horizontal bar chart
// ---------------------------------------------------------------------------

function buildMarginChart(
  rows: PortfolioReport["rows"]
): string {
  if (rows.length === 0) return "";

  const sorted = [...rows].sort(
    (a, b) => (b.marginPercent ?? -999) - (a.marginPercent ?? -999)
  );
  const maxAbs = Math.max(...sorted.map((r) => Math.abs(r.marginPercent ?? 0)), 1);

  const barH = 28;
  const gap = 8;
  const labelW = 150;
  const barMaxW = 200;
  const centerX = labelW + barMaxW;
  const chartW = centerX + barMaxW + 80;

  const bars = sorted.map((row, i) => {
    const y = i * (barH + gap);
    const m = row.marginPercent ?? 0;
    const bw = Math.max((Math.abs(m) / maxAbs) * barMaxW, 4);
    const color =
      m >= 15
        ? CHEZSOI.color.primary
        : m >= 0
        ? "#a78bfa"
        : "#e11d48";
    const isPos = m >= 0;
    const nameShort =
      esc(row.name).length > 20
        ? esc(row.name).slice(0, 19) + "…"
        : esc(row.name);
    const muteAttr = row.hasData ? "" : ' opacity="0.4"';
    return `
      <g${muteAttr}>
        <text x="${labelW - 8}" y="${y + barH / 2 + 4}" text-anchor="end" font-size="11" fill="#374151" font-family="sans-serif">${nameShort}</text>
        ${
          isPos
            ? `<rect x="${centerX}" y="${y}" width="${bw}" height="${barH}" fill="${color}" rx="4"/>`
            : `<rect x="${centerX - bw}" y="${y}" width="${bw}" height="${barH}" fill="${color}" rx="4"/>`
        }
        <text x="${isPos ? centerX + bw + 6 : centerX - bw - 6}" y="${y + barH / 2 + 4}" text-anchor="${isPos ? "start" : "end"}" font-size="11" font-weight="600" fill="${color}" font-family="sans-serif">${fmtMargin(row.marginPercent)}</text>
      </g>`;
  });

  const svgH = sorted.length * (barH + gap) + 10;

  return `
    <div style="margin:20px 0;overflow-x:auto;">
      <svg width="${chartW}" height="${svgH}" viewBox="0 0 ${chartW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
        <line x1="${centerX}" y1="0" x2="${centerX}" y2="${svgH}" stroke="#e5e7eb" stroke-width="2"/>
        ${bars.join("")}
      </svg>
    </div>`;
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

function buildStyle(period: string): string {
  return `
    @import url('${CHEZSOI.font.importUrl}');

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: ${CHEZSOI.font.body};
      line-height: 1.55;
      color: #1f2937;
      background: #fff;
      max-width: 960px;
      margin: 0 auto;
      padding: 0;
    }

    /* Header band */
    .cs-header {
      background: linear-gradient(135deg, ${CHEZSOI.color.primary}, ${CHEZSOI.color.primarySoft});
      color: #fff;
      padding: 28px 36px;
    }
    .cs-header-inner {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
    }
    .cs-brand {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .cs-logo {
      width: 56px;
      height: 56px;
      object-fit: contain;
      border-radius: 8px;
      background: rgba(255,255,255,0.15);
    }
    .cs-wordmark {
      font-family: ${CHEZSOI.font.heading};
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.3px;
    }
    .cs-doc-type {
      font-family: ${CHEZSOI.font.eyebrow};
      font-size: 11px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      opacity: 0.85;
      margin-top: 4px;
    }
    .cs-period-badge {
      text-align: right;
      font-size: 13px;
    }
    .cs-period-badge strong {
      display: block;
      font-family: ${CHEZSOI.font.heading};
      font-size: 18px;
      font-weight: 700;
    }

    /* Content */
    .cs-content {
      padding: 32px 36px 48px;
    }

    /* Client block */
    .cs-client-block {
      border-left: 4px solid ${CHEZSOI.color.primary};
      padding: 16px 20px;
      background: #faf5ff;
      border-radius: 0 8px 8px 0;
      margin-bottom: 32px;
    }
    .cs-eyebrow {
      font-family: ${CHEZSOI.font.eyebrow};
      font-size: 10px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: ${CHEZSOI.color.primary};
      margin-bottom: 6px;
    }
    .cs-client-name {
      font-family: ${CHEZSOI.font.heading};
      font-size: 26px;
      font-weight: 700;
      color: #111827;
      margin-bottom: 6px;
    }
    .cs-meta {
      font-size: 12px;
      color: #6b7280;
    }
    .cs-statement-id {
      font-family: monospace;
      font-size: 10px;
      color: #9ca3af;
      margin-top: 4px;
    }

    /* Section headers */
    .cs-section {
      margin-top: 36px;
    }
    .cs-section-title {
      font-family: ${CHEZSOI.font.eyebrow};
      font-size: 10px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: ${CHEZSOI.color.primary};
      border-bottom: 2px solid ${CHEZSOI.color.primary};
      padding-bottom: 6px;
      margin-bottom: 16px;
    }

    /* Summary cards */
    .cs-cards {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 8px;
    }
    .cs-card {
      border: 1px solid #e9d5ff;
      border-radius: 8px;
      padding: 16px;
      background: #faf5ff;
    }
    .cs-card-label {
      font-family: ${CHEZSOI.font.eyebrow};
      font-size: 10px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #6b7280;
      margin-bottom: 6px;
    }
    .cs-card-value {
      font-family: ${CHEZSOI.font.heading};
      font-size: 22px;
      font-weight: 700;
      color: #111827;
    }

    /* Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    thead th {
      background: ${CHEZSOI.color.primary};
      color: #fff;
      padding: 9px 12px;
      text-align: right;
      font-family: ${CHEZSOI.font.eyebrow};
      font-size: 10px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      white-space: nowrap;
    }
    thead th:first-child { text-align: left; }
    tbody td {
      padding: 9px 12px;
      border-bottom: 1px solid #e9d5ff;
      text-align: right;
      vertical-align: middle;
    }
    tbody td:first-child { text-align: left; }
    tbody tr:nth-child(even) td { background: #faf5ff; }
    tr.cs-total td {
      font-weight: 700;
      background: #f3e8ff;
      border-top: 2px solid ${CHEZSOI.color.primary};
    }

    /* No-data row */
    .cs-no-data td { opacity: 0.45; }
    .cs-no-data-tag {
      font-size: 10px;
      background: #e5e7eb;
      color: #6b7280;
      border-radius: 3px;
      padding: 2px 6px;
      margin-left: 8px;
      font-family: ${CHEZSOI.font.eyebrow};
      letter-spacing: 0.06em;
      vertical-align: middle;
    }

    /* Margin badge */
    .cs-margin-badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
    }

    /* Per-property cost table */
    .cs-prop-section {
      margin-top: 20px;
      page-break-inside: avoid;
    }
    .cs-prop-title {
      font-family: ${CHEZSOI.font.heading};
      font-size: 14px;
      font-weight: 700;
      color: #374151;
      margin-bottom: 8px;
    }

    /* Definitions appendix */
    .cs-definitions dt {
      font-weight: 700;
      font-size: 12px;
      margin-top: 10px;
      color: #374151;
    }
    .cs-definitions dd {
      font-size: 12px;
      color: #6b7280;
      margin-left: 16px;
      margin-top: 2px;
    }

    /* Excluded footnote */
    .cs-excluded {
      font-size: 11px;
      color: #9ca3af;
      margin-top: 20px;
      padding: 10px 14px;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
    }

    /* Footer */
    .cs-footer {
      background: #1f2937;
      color: #9ca3af;
      text-align: center;
      padding: 18px 36px;
      font-size: 11px;
      font-family: ${CHEZSOI.font.eyebrow};
      letter-spacing: 0.08em;
    }
    .cs-footer a { color: #c4b5fd; text-decoration: none; }

    /* Action buttons */
    .cs-actions {
      padding: 16px 36px;
      display: flex;
      gap: 12px;
    }
    .cs-btn {
      padding: 10px 20px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-family: ${CHEZSOI.font.body};
      font-weight: 600;
    }
    .cs-btn-primary {
      background: ${CHEZSOI.color.primary};
      color: #fff;
    }
    .cs-btn-secondary {
      background: #f3f4f6;
      color: #374151;
    }

    @media print {
      .cs-actions { display: none; }
      body { max-width: 100%; }
    }
    @media (max-width: 680px) {
      .cs-cards { grid-template-columns: repeat(2, 1fr); }
      .cs-header-inner { flex-direction: column; }
      .cs-period-badge { text-align: left; }
    }
  `.trim();
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildStatementHtml(
  data: StatementData,
  opts: StatementOpts
): string {
  const { report, properties } = data;
  const { clientName, period, statementDate } = opts;

  const stmtId = statementId(period, clientName);

  // --- Summary cards ---
  const marginColor = marginHealthColor(report.marginPercent);
  const marginBg = marginHealthBg(report.marginPercent);

  const cards = `
    <div class="cs-cards">
      <div class="cs-card">
        <div class="cs-card-label">Total Revenue</div>
        <div class="cs-card-value" style="color:#16a34a;">${fmtCurrency(report.revenueGross)}</div>
      </div>
      <div class="cs-card">
        <div class="cs-card-label">Total Costs</div>
        <div class="cs-card-value" style="color:#dc2626;">${fmtCurrency(report.totalCosts)}</div>
      </div>
      <div class="cs-card">
        <div class="cs-card-label">Net Income</div>
        <div class="cs-card-value" style="color:${report.netProfit >= 0 ? "#16a34a" : "#dc2626"};">${fmtCurrency(report.netProfit)}</div>
      </div>
      <div class="cs-card">
        <div class="cs-card-label">Net Margin</div>
        <div class="cs-card-value" style="color:${marginColor};background:${marginBg};border-radius:6px;padding:4px 10px;display:inline-block;">${fmtMargin(report.marginPercent)}</div>
      </div>
    </div>`;

  // --- Cost distribution pie ---
  const pieChart = buildPieChart(report.bucketTotals as Record<string, number>, report.totalCosts);

  // --- Margin bar chart ---
  const barChart = buildMarginChart(report.rows);

  // --- Property performance table ---
  const perfRows = report.rows
    .map((row) => {
      const cleaning = (row.bucketTotals as Record<string, number>)["cleaning"] ?? 0;
      const fixed = row.costs - cleaning;
      const isNoData = !row.hasData;
      const trClass = isNoData ? ' class="cs-no-data"' : "";
      const nameCell = isNoData
        ? `${esc(row.name)}<span class="cs-no-data-tag">No data</span>`
        : esc(row.name);
      const m = row.marginPercent;
      const mColor = marginHealthColor(m);
      const mBg = marginHealthBg(m);
      return `
      <tr${trClass}>
        <td>${nameCell}</td>
        <td>${fmtCurrency(row.revenue)}</td>
        <td style="text-align:center;">${row.bookingCount}</td>
        <td>${fmtCurrency(cleaning)}</td>
        <td>${fmtCurrency(fixed)}</td>
        <td>${fmtCurrency(row.costs)}</td>
        <td style="color:${row.net >= 0 ? "#16a34a" : "#dc2626"};">${fmtCurrency(row.net)}</td>
        <td><span class="cs-margin-badge" style="color:${mColor};background:${mBg};">${fmtMargin(m)}</span></td>
      </tr>`;
    })
    .join("");

  const perfTable = `
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
        ${perfRows}
        <tr class="cs-total">
          <td>PORTFOLIO TOTAL</td>
          <td>${fmtCurrency(report.revenueGross)}</td>
          <td></td>
          <td></td>
          <td></td>
          <td>${fmtCurrency(report.totalCosts)}</td>
          <td style="color:${report.netProfit >= 0 ? "#16a34a" : "#dc2626"};">${fmtCurrency(report.netProfit)}</td>
          <td><span class="cs-margin-badge" style="color:${marginColor};background:${marginBg};">${fmtMargin(report.marginPercent)}</span></td>
        </tr>
      </tbody>
    </table>`;

  // --- Detailed cost breakdown per property (hasData only) ---
  const detailSections = properties
    .filter((p) => p.hasData)
    .map((prop) => {
      const activeLines = prop.lines.filter((l) => l.monthlyAmount > 0);
      if (activeLines.length === 0) return "";

      const lineRows = activeLines
        .sort((a, b) => b.monthlyAmount - a.monthlyAmount)
        .map(
          (l) => `
          <tr>
            <td>${esc(titleCase(l.name))}</td>
            <td>${l.category ? esc(titleCase(l.category)) : "—"}</td>
            <td>${fmtCurrency(l.monthlyAmount)}</td>
          </tr>`
        )
        .join("");

      return `
      <div class="cs-prop-section">
        <div class="cs-prop-title">${esc(prop.name)}</div>
        <table>
          <thead>
            <tr>
              <th>Cost Item</th>
              <th>Category</th>
              <th>Monthly Amount</th>
            </tr>
          </thead>
          <tbody>
            ${lineRows}
          </tbody>
        </table>
      </div>`;
    })
    .filter(Boolean)
    .join("");

  // --- Excluded footnote ---
  const excludedNote =
    report.excluded.length > 0
      ? `<div class="cs-excluded">
          <strong>Excluded (dropped/managed):</strong>
          ${report.excluded.map((e) => esc(e.name)).join(", ")}
         </div>`
      : "";

  // --- Assemble full document ---
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Owner Statement — ${esc(period)} | Chez Soi Stays</title>
  <style>
    ${buildStyle(period)}
  </style>
</head>
<body>

  <!-- HEADER BAND -->
  <div class="cs-header">
    <div class="cs-header-inner">
      <div class="cs-brand">
        <img src="${CHEZSOI_LOGO_DATA_URI}" alt="Chez Soi Stays logo" class="cs-logo" />
        <div>
          <div class="cs-wordmark">Chez Soi Stays</div>
          <div class="cs-doc-type">Property Owner Statement</div>
        </div>
      </div>
      <div class="cs-period-badge">
        <strong>${esc(period)}</strong>
        ${esc(CHEZSOI.domain)}
      </div>
    </div>
  </div>

  <!-- ACTION BUTTONS -->
  <div class="cs-actions">
    <button class="cs-btn cs-btn-primary" onclick="window.print()">Print / Save as PDF</button>
    <button class="cs-btn cs-btn-secondary" onclick="window.close()">Close</button>
  </div>

  <div class="cs-content">

    <!-- CLIENT BLOCK -->
    <div class="cs-client-block">
      <div class="cs-eyebrow">Statement Prepared For</div>
      <div class="cs-client-name">${esc(clientName)}</div>
      <div class="cs-meta">Statement date: ${esc(statementDate)}</div>
      <div class="cs-statement-id">${esc(stmtId)}</div>
    </div>

    <!-- SUMMARY CARDS -->
    <div class="cs-section">
      <div class="cs-section-title">Financial Summary</div>
      ${cards}
    </div>

    <!-- COST DISTRIBUTION -->
    ${
      pieChart
        ? `<div class="cs-section">
            <div class="cs-section-title">Cost Distribution</div>
            ${pieChart}
           </div>`
        : ""
    }

    <!-- PROPERTY MARGINS -->
    ${
      barChart
        ? `<div class="cs-section">
            <div class="cs-section-title">Property Margins</div>
            ${barChart}
           </div>`
        : ""
    }

    <!-- PROPERTY PERFORMANCE TABLE -->
    <div class="cs-section">
      <div class="cs-section-title">Property Performance</div>
      ${perfTable}
      ${excludedNote}
    </div>

    <!-- DETAILED COST BREAKDOWN -->
    ${
      detailSections
        ? `<div class="cs-section">
            <div class="cs-section-title">Detailed Cost Breakdown</div>
            ${detailSections}
           </div>`
        : ""
    }

    <!-- DEFINITIONS & METHODOLOGY -->
    <div class="cs-section">
      <div class="cs-section-title">Definitions &amp; Methodology</div>
      <dl class="cs-definitions">
        <dt>Revenue</dt>
        <dd>Gross booking revenue collected from guests via all platforms (Airbnb, VRBO, direct).</dd>
        <dt>Cleaning</dt>
        <dd>Per-turnover cleaning fee × number of bookings in the period.</dd>
        <dt>Costs</dt>
        <dd>Monthly-equivalent of all active cost items: annual ÷ 12, quarterly ÷ 3, per-booking × bookings, revenue-percentage × revenue.</dd>
        <dt>Net Income</dt>
        <dd>Revenue − Total Costs.</dd>
        <dt>No-Data Properties</dt>
        <dd>Properties with no revenue or cost data entered for this period are shown muted and excluded from portfolio totals.</dd>
      </dl>
    </div>

  </div>

  <!-- FOOTER -->
  <div class="cs-footer">
    Chez Soi Stays &nbsp;·&nbsp; <a href="https://${CHEZSOI.domain}">${CHEZSOI.domain}</a> &nbsp;·&nbsp; Confidential Owner Statement
  </div>

</body>
</html>`;
}
