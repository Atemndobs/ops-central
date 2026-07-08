/**
 * Pure cost math — the SINGLE source of truth for frequency→monthly conversion.
 * No Convex/DB imports so it is unit-testable in isolation. Imported by
 * reports.ts (buildReport), portfolio.ts (portfolioReport), the AI tool, and
 * the prepared-query chips. Replaces three divergent copies (B5/B7/B13/B14).
 */
export type CostFrequency =
  | "one_time" | "monthly" | "quarterly" | "annual" | "yearly"
  | "per_booking" | "revenue_percentage";

export type CostBucket =
  | "lease" | "utilities" | "cleaning" | "payouts" | "subscriptions" | "other" | "unassigned";

export interface CostLineInput {
  amount: number;
  frequency: CostFrequency;
  /** Only used for revenue_percentage lines. */
  percentageRate?: number | null;
  itemBucket?: CostBucket | null;
  categoryBucket?: CostBucket | null;
  /** Display name of the cost item — used by inferBucket fallback. */
  name?: string | null;
  /** Display name of the category — used by inferBucket fallback when name gives 'other'. */
  categoryName?: string | null;
}

/**
 * Keyword-inference fallback: given a free-text name, return the best matching
 * CostBucket. Returns 'other' when no keyword matches.
 * Mirrors the logic in PropertyReport.tsx:505-532 (the old frontend fallback).
 */
export function inferBucket(name?: string | null): CostBucket {
  if (!name) return "other";
  const lc = name.toLowerCase();
  if (/\b(lease|mortgage)\b/.test(lc)) return "lease";
  // "utilit" is a prefix (utility/utilities) — no trailing \b needed for stem; full words use \b
  if (/\butiliti?(?:y|es)?|\belectric\b|\bgas\b|\bwater\b|\binternet\b|\bwifi\b|\btrash\b/.test(lc)) return "utilities";
  if (/clean/.test(lc)) return "cleaning";
  // "salar" is a prefix (salary/salaries) — no trailing \b
  if (/\bsalar|\bpayroll\b|\bpayout\b|\bwages?\b|\bvirtual assistant\b|\bva\b/.test(lc)) return "payouts";
  if (/subscript/.test(lc)) return "subscriptions";
  return "other";
}

export interface CostContext {
  /** Number of bookings/turnovers in the month — NOT nights (schema.ts:764). */
  bookingCount: number;
  grossRevenue: number;
}

export function monthlyEquivalent(line: CostLineInput, ctx: CostContext): number {
  switch (line.frequency) {
    case "monthly": return line.amount;
    case "quarterly": return line.amount / 3;
    case "annual":
    case "yearly": return line.amount / 12;
    case "one_time": return 0;
    case "per_booking": return line.amount * (ctx.bookingCount ?? 0);
    case "revenue_percentage": return ((line.percentageRate ?? 0) / 100) * (ctx.grossRevenue ?? 0);
    default: return 0;
  }
}

export const ZERO_BUCKETS: Record<CostBucket, number> = {
  lease: 0, utilities: 0, cleaning: 0, payouts: 0, subscriptions: 0, other: 0, unassigned: 0,
};

function resolveBucket(line: CostLineInput): CostBucket {
  if (line.itemBucket) return line.itemBucket;
  if (line.categoryBucket) return line.categoryBucket;
  const byName = inferBucket(line.name);
  if (byName !== "other") return byName;
  return inferBucket(line.categoryName); // may be 'other'
}

export function bucketize(
  lines: CostLineInput[],
  ctx: CostContext,
): { bucketTotals: Record<CostBucket, number>; total: number } {
  const bucketTotals: Record<CostBucket, number> = { ...ZERO_BUCKETS };
  let total = 0;
  for (const line of lines) {
    const bucket: CostBucket = resolveBucket(line);
    const amt = monthlyEquivalent(line, ctx);
    bucketTotals[bucket] += amt;
    total += amt;
  }
  return { bucketTotals, total };
}

export interface PropertyMonthInput {
  id: string;
  name: string;
  status: "active" | "dropped" | "managed";
  revenueGross: number;
  revenueNet: number;
  bookingCount: number;
  lines: CostLineInput[];
  /** True when at least one monthlyCalculations OR propertyMonthlySettings row exists for this property+month.
   *  False = no data imported/entered yet; row appears in the report but is excluded from portfolio totals. */
  hasData: boolean;
}

export interface PropertyRow {
  id: string;
  name: string;
  revenue: number;
  bookingCount: number;
  bucketTotals: Record<CostBucket, number>;
  costs: number;
  net: number;
  marginPercent: number | null;
  /** Mirrors PropertyMonthInput.hasData — false rows are shown muted and excluded from portfolio totals. */
  hasData: boolean;
}

export interface PortfolioReport {
  month: string;
  rows: PropertyRow[];
  bucketTotals: Record<CostBucket, number>;
  revenueGross: number;
  revenueNet: number;
  totalCosts: number;
  netProfit: number;
  marginPercent: number | null;
  excluded: Array<{ id: string; name: string; status: string }>;
}

/** Revenue basis = gross (spec D1). Active properties only; dropped/managed excluded. */
export function buildPortfolioReport(month: string, props: PropertyMonthInput[]): PortfolioReport {
  const rows: PropertyRow[] = [];
  const excluded: Array<{ id: string; name: string; status: string }> = [];
  const bucketTotals: Record<CostBucket, number> = { ...ZERO_BUCKETS };
  let revenueGross = 0;
  let revenueNet = 0;
  let totalCosts = 0;

  for (const p of props) {
    if (p.status !== "active") {
      excluded.push({ id: p.id, name: p.name, status: p.status });
      continue;
    }
    const { bucketTotals: pb, total: costs } = bucketize(p.lines, {
      bookingCount: p.bookingCount,
      grossRevenue: p.revenueGross,
    });
    const revenue = p.revenueGross; // D1: gross basis
    const net = revenue - costs;
    rows.push({
      id: p.id,
      name: p.name,
      revenue,
      bookingCount: p.bookingCount,
      bucketTotals: pb,
      costs,
      net,
      marginPercent: revenue > 0 ? (net / revenue) * 100 : null,
      hasData: p.hasData,
    });
    // Only accumulate into portfolio totals when the property has real data for the month.
    // No-data rows appear in `rows` (so the UI can flag them) but must not pollute the totals.
    if (p.hasData) {
      for (const k of Object.keys(pb) as CostBucket[]) bucketTotals[k] += pb[k];
      revenueGross += p.revenueGross;
      revenueNet += p.revenueNet;
      totalCosts += costs;
    }
  }

  const netProfit = revenueGross - totalCosts;
  return {
    month,
    rows,
    bucketTotals,
    revenueGross,
    revenueNet,
    totalCosts,
    netProfit,
    marginPercent: revenueGross > 0 ? (netProfit / revenueGross) * 100 : null,
    excluded,
  };
}

export interface ImportedActualInput {
  grossRevenue: number;
  bookingCount: number;
  bookedNights: number;
  costLines: CostLineInput[];
}

export interface ImportedActualRow {
  grossRevenue: number;
  platformFees: number;
  netRevenue: number;
  totalCosts: number;
  netProfit: number;
  marginPercent: number | null;
  totalBookings: number;
  bookedNights: number;
  isActual: true;
}

/**
 * Build a complete monthlyCalculations ACTUAL row from a Hospitable import.
 * Revenue/bookings/nights are the real imported values; costs are the
 * deterministic engine result (so the stored actual is correct, never $0).
 * Revenue basis = gross (spec D1): platformFees 0, netRevenue = gross.
 */
export function buildImportedActual(input: ImportedActualInput): ImportedActualRow {
  const { total: totalCosts } = bucketize(input.costLines, {
    bookingCount: input.bookingCount,
    grossRevenue: input.grossRevenue,
  });
  const grossRevenue = input.grossRevenue;
  const netProfit = grossRevenue - totalCosts;
  return {
    grossRevenue,
    platformFees: 0,
    netRevenue: grossRevenue,
    totalCosts,
    netProfit,
    marginPercent: grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : null,
    totalBookings: input.bookingCount,
    bookedNights: input.bookedNights,
    isActual: true,
  };
}
