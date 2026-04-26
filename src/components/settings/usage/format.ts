/**
 * Shared formatting helpers for the usage dashboard. Kept dependency-free so
 * server and client components can both import them.
 */

export function formatUsd(amount: number, opts?: { precise?: boolean }): string {
  const precision = opts?.precise ? 4 : amount >= 1 ? 2 : 3;
  return `$${amount.toFixed(precision)}`;
}

export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return "\u2014";
  if (value < 1000) return value.toLocaleString();
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatPercent(pct: number): string {
  if (!Number.isFinite(pct)) return "\u2014";
  return `${pct.toFixed(pct < 10 ? 1 : 0)}%`;
}

export function formatQuotaWindow(
  window: "minute" | "hour" | "day" | "month",
): string {
  switch (window) {
    case "minute":
      return "per minute";
    case "hour":
      return "per hour";
    case "day":
      return "per day";
    case "month":
      return "per month";
  }
}

export function formatRelativeTime(ts: number): string {
  const deltaMs = Date.now() - ts;
  const abs = Math.abs(deltaMs);
  const seconds = Math.round(abs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function formatDayLabel(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export function quotaColor(pct: number): string {
  if (pct >= 100) return "var(--destructive, #ef4444)";
  if (pct >= 80) return "#f59e0b";
  if (pct >= 50) return "#eab308";
  return "#10b981";
}

/**
 * Render a quota's "consumed / limit" pair with the right unit. Bytes
 * collapse to KB/MB/GB/TB, USD shows two decimals, everything else uses
 * the compact-number formatter.
 */
export function formatQuotaValue(value: number, unit?: string): string {
  if (!Number.isFinite(value)) return "—";
  switch (unit) {
    case "bytes": {
      if (value < 1024) return `${value} B`;
      const units = ["KB", "MB", "GB", "TB", "PB"];
      let v = value / 1024;
      let i = 0;
      while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i += 1;
      }
      return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
    }
    case "usd":
      return `$${value.toFixed(value >= 100 ? 0 : 2)}`;
    case "seconds":
      if (value < 60) return `${Math.round(value)}s`;
      if (value < 3600) return `${(value / 60).toFixed(1)}m`;
      return `${(value / 3600).toFixed(1)}h`;
    default:
      return formatCompactNumber(value);
  }
}

/** Percentage delta formatted as "+12%", "-3%", or "\u2014" when undefined. */
export function formatDelta(
  current: number,
  previous: number,
): { label: string; tone: "up" | "down" | "flat" } {
  if (previous <= 0 && current <= 0) return { label: "\u2014", tone: "flat" };
  if (previous <= 0) return { label: "new", tone: "up" };
  const deltaPct = ((current - previous) / previous) * 100;
  if (Math.abs(deltaPct) < 0.5) return { label: "flat", tone: "flat" };
  const sign = deltaPct > 0 ? "+" : "";
  return {
    label: `${sign}${deltaPct.toFixed(deltaPct < 10 ? 1 : 0)}%`,
    tone: deltaPct > 0 ? "up" : "down",
  };
}
