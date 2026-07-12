export function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(n);
}

export function formatPct(n: number | null): string {
  return n === null ? "—" : `${n.toFixed(1)}%`;
}

/** Given "YYYY-MM", returns the prior month as "YYYY-MM". Handles Jan → prev-year Dec. */
export function previousMonthOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(y, m - 1, 1); // month is 0-indexed in Date
  date.setMonth(date.getMonth() - 1);
  const py = date.getFullYear();
  const pm = String(date.getMonth() + 1).padStart(2, "0");
  return `${py}-${pm}`;
}
