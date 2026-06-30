export interface PortfolioReportLike {
  month: string;
  rows: Array<{
    name: string;
    revenue: number;
    bookingCount: number;
    bucketTotals: Record<string, number>;
    costs: number;
    net: number;
    marginPercent: number | null;
  }>;
  revenueGross: number;
  totalCosts: number;
  netProfit: number;
  marginPercent: number | null;
  excluded: Array<{ id: string; name: string; status: string }>;
}

const HEADERS = [
  "Property", "Revenue", "Bookings", "Cleaning", "Lease", "Utilities",
  "Payouts", "Subscriptions", "Other", "Total Cost", "Net", "Margin %",
];

function cell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function bucket(b: Record<string, number>, k: string): number {
  return b[k] ?? 0;
}

export function portfolioReportToCsv(report: PortfolioReportLike): string {
  const lines: string[] = [HEADERS.join(",")];
  for (const r of report.rows) {
    lines.push([
      r.name, r.revenue, r.bookingCount,
      bucket(r.bucketTotals, "cleaning"), bucket(r.bucketTotals, "lease"),
      bucket(r.bucketTotals, "utilities"), bucket(r.bucketTotals, "payouts"),
      bucket(r.bucketTotals, "subscriptions"), bucket(r.bucketTotals, "other"),
      r.costs, r.net, r.marginPercent ?? "",
    ].map(cell).join(","));
  }
  lines.push([
    "PORTFOLIO TOTAL", report.revenueGross, "", "", "", "", "", "", "",
    report.totalCosts, report.netProfit, report.marginPercent ?? "",
  ].map(cell).join(","));
  return lines.join("\n");
}
