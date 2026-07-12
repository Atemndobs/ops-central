import { query } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { DatabaseReader } from "../_generated/server";
import { requireRole } from "../lib/auth";
import {
  bucketize,
  monthlyEquivalent,
  inferBucket,
  type CostLineInput,
  type CostBucket,
} from "./costMath";
import { toEngineBucket } from "./buckets";

// ─────────────────────────────────────────────────────────────────────────────
// Per-Property Report
//
// Normalizes data from three sources for a single (propertyId, month):
//   1. monthlyCalculations    → preferred actuals (revenue, costs, net)
//   2. propertyMonthlySettings → assumption fallback (totalRevenueAssumption…)
//   3. propertyCostItems       → detailed cost line items
//
// Precedence: actuals > assumptions. Source label tells the UI which buckets
// were available so callers can flag confidence.
//
// PORT NOTE (OpsCentral): jna-bs-admin's propertyCostItems carried an
// item-level `bucket`; OpsCentral's does not. Category buckets are mapped from
// OpsCentral's 13-bucket vocabulary to the engine's 7-bucket set via
// `toEngineBucket`. The non-portable per-property report save/list mutations
// (which used a `propertyReports` table) are intentionally omitted.
// ─────────────────────────────────────────────────────────────────────────────

export type ReportSource = "actual" | "assumption" | "mixed";

export type ReportCostLine = {
  itemId: string;          // propertyCostItems._id
  name: string;
  amount: number;
  frequency: string;
  category: string | null;
  categoryBucket: CostBucket | null;   // fallback when itemBucket is undefined
  itemBucket: CostBucket | null;       // always null in OpsCentral
};

export type PropertyReportPayload = {
  property: {
    id: string;
    name: string;
    address: string;
    city: string | null;
    state: string | null;
  };
  period: {
    month: string;     // "YYYY-MM"
    year: number;
    monthIndex: number; // 1-12
  };
  source: ReportSource;
  revenue: {
    gross: number;
    platformFees: number;
    net: number;
    sourceLabel: "actual" | "assumption";
  };
  costs: {
    total: number;
    breakdown: ReportCostLine[];
    bucketTotals: Record<CostBucket, number>;
    sourceLabel: "actual" | "assumption" | "merged";
  };
  net: {
    netProfit: number;
    marginPercent: number | null;
    occupancyRate: number | null;
    bookedNights: number | null;
    bookingCount: number;
  };
  variance: {
    revenueDelta: number | null;        // actual - assumption (null if missing one)
    costsDelta: number | null;
    actualVsAssumptionPct: number | null;
  };
  metadata: {
    hasActuals: boolean;
    hasAssumptions: boolean;
    hasCostItems: boolean;
    notes: string | null;
    generatedAt: number;
  };
};

// Internal helper — pure DB reader logic. Returns a normalized report payload.
async function buildReport(
  db: DatabaseReader,
  propertyId: Id<"properties">,
  month: string,
  notes?: string,
): Promise<PropertyReportPayload> {
  const property = await db.get(propertyId);
  if (!property) throw new Error(`Property ${propertyId} not found`);

  // 1. Actuals from monthlyCalculations
  const calculations = await db
    .query("monthlyCalculations")
    .withIndex("by_property_month", (q) =>
      q.eq("propertyId", propertyId).eq("month", month),
    )
    .collect();
  const actual = calculations.find((c) => c.isActual === true) ?? calculations[0] ?? null;

  // 2. Assumption from propertyMonthlySettings (active only)
  const settingsRows = await db
    .query("propertyMonthlySettings")
    .withIndex("by_property_month", (q) =>
      q.eq("propertyId", propertyId).eq("month", month),
    )
    .collect();
  const settings = settingsRows.find((s) => s.isActive !== false) ?? settingsRows[0] ?? null;

  // 3. Cost line items (active)
  const costItems = await db
    .query("propertyCostItems")
    .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
    .collect();
  const activeCostItems = costItems.filter((i) => i.isActive);

  const categories = await db.query("costCategories").collect();
  const categoryMap = new Map(categories.map((c) => [c._id as string, c.name]));
  const categoryBucketMap = new Map<string, CostBucket | null>(
    categories.map((c) => [c._id as string, toEngineBucket(c.bucket)]),
  );

  // ── Resolve revenue ────────────────────────────────────────────────────────
  const actualGross = actual?.grossRevenue ?? null;
  const assumptionGross = settings?.totalRevenueAssumption ?? null;
  const grossRevenue = actualGross ?? assumptionGross ?? 0;
  const platformFees = actual?.platformFees ?? 0;
  const netRevenue = actual?.netRevenue ?? Math.max(0, grossRevenue - platformFees);
  const revenueSource: "actual" | "assumption" =
    actualGross !== null ? "actual" : "assumption";

  const bookingCount =
    actual?.totalBookings ?? settings?.monthlyBookingsAssumption ?? 0;

  // ── Resolve costs ──────────────────────────────────────────────────────────
  const breakdown: ReportCostLine[] = activeCostItems.map((item) => ({
    itemId: item._id as string,
    name: item.name,
    amount: item.amount,
    frequency: item.frequency,
    category: categoryMap.get(item.categoryId as string) ?? null,
    categoryBucket: categoryBucketMap.get(item.categoryId as string) ?? null,
    itemBucket: null,
  }));

  // Prefer actual totalCosts; otherwise compute via shared costMath engine.
  const costLines: CostLineInput[] = activeCostItems.map((item) => ({
    amount: item.amount,
    frequency: item.frequency,
    percentageRate: item.percentageRate ?? null,
    itemBucket: null,
    categoryBucket: categoryBucketMap.get(item.categoryId as string) ?? null,
    name: item.name,
    categoryName: categoryMap.get(item.categoryId as string) ?? null,
  }));
  const { bucketTotals, total: fallbackCostsTotal } = bucketize(costLines, {
    bookingCount,
    grossRevenue,
  });
  // NOTE: prefers stored actuals; the deterministic portfolioReport (portfolio.ts) recomputes instead — see its header.
  const totalCosts = actual?.totalCosts ?? fallbackCostsTotal;
  const costsSource: "actual" | "assumption" | "merged" =
    actual?.totalCosts !== undefined && breakdown.length > 0
      ? "merged"
      : actual?.totalCosts !== undefined
        ? "actual"
        : "assumption";

  // ── Net + variance ─────────────────────────────────────────────────────────
  const netProfit = actual?.netProfit ?? grossRevenue - totalCosts;
  const marginPercent =
    actual?.marginPercent ??
    (grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : null);

  const revenueDelta =
    actualGross !== null && assumptionGross !== null
      ? actualGross - assumptionGross
      : null;
  const actualVsAssumptionPct =
    actualGross !== null && assumptionGross !== null && assumptionGross !== 0
      ? ((actualGross - assumptionGross) / assumptionGross) * 100
      : null;

  // ── Source label ───────────────────────────────────────────────────────────
  const hasActuals = actual !== null;
  const hasAssumptions = settings !== null;
  const source: ReportSource = hasActuals && hasAssumptions
    ? "mixed"
    : hasActuals
      ? "actual"
      : "assumption";

  // ── Period parsing ─────────────────────────────────────────────────────────
  const [yearStr, monthStr] = month.split("-");
  const year = Number.parseInt(yearStr ?? "0", 10);
  const monthIndex = Number.parseInt(monthStr ?? "0", 10);

  return {
    property: {
      id: property._id,
      name: property.name,
      address: property.address,
      city: property.city ?? null,
      state: property.state ?? null,
    },
    period: { month, year, monthIndex },
    source,
    revenue: {
      gross: grossRevenue,
      platformFees,
      net: netRevenue,
      sourceLabel: revenueSource,
    },
    costs: {
      total: totalCosts,
      breakdown,
      bucketTotals,
      sourceLabel: costsSource,
    },
    net: {
      netProfit,
      marginPercent,
      occupancyRate: actual?.occupancyRate ?? settings?.occupancyRateAssumption ?? null,
      bookedNights: actual?.bookedNights ?? settings?.bookedNights ?? null,
      bookingCount,
    },
    variance: {
      revenueDelta,
      costsDelta: null,
      actualVsAssumptionPct,
    },
    metadata: {
      hasActuals,
      hasAssumptions,
      hasCostItems: breakdown.length > 0,
      notes: notes ?? settings?.notes ?? null,
      generatedAt: Date.now(),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a property+month report payload WITHOUT persisting it.
 * Useful for live preview before the user clicks "Save report".
 */
export const resolvePropertyReportData = query({
  args: {
    propertyId: v.id("properties"),
    month: v.string(), // "YYYY-MM"
  },
  handler: async (ctx, args): Promise<PropertyReportPayload> => {
    await requireRole(ctx, ["admin", "property_ops"]);
    return await buildReport(ctx.db, args.propertyId, args.month);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// portfolioStatementData — per-property cost-item breakdown for owner statements
// ─────────────────────────────────────────────────────────────────────────────

type StatementPropertyRow = {
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
};

/**
 * Mirror of the engine's resolveBucket for DISPLAY labels: item bucket (always
 * null in OpsCentral) → mapped category bucket → keyword inference by item
 * name → keyword inference by category name → "other". Keeps each statement
 * line's printed bucket consistent with how bucketize() actually aggregates it.
 */
function resolveDisplayBucket(
  categoryBucket: CostBucket | null,
  name: string | null | undefined,
  categoryName: string | null | undefined,
): string {
  if (categoryBucket) return categoryBucket;
  const byName = inferBucket(name);
  if (byName !== "other") return byName;
  return inferBucket(categoryName);
}

export const portfolioStatementData = query({
  args: {
    month: v.string(),
    propertyIds: v.optional(v.array(v.id("properties"))),
  },
  handler: async (ctx, args): Promise<{ properties: StatementPropertyRow[] }> => {
    await requireRole(ctx, ["admin", "property_ops"]);
    // Load categories once (shared across all properties)
    const categories = await ctx.db.query("costCategories").collect();
    const categoryNameMap = new Map<string, string>(
      categories.map((c) => [c._id as string, c.name]),
    );
    const categoryBucketMap = new Map<string, CostBucket | null>(
      categories.map((c) => [c._id as string, toEngineBucket(c.bucket)]),
    );

    // Determine the property set
    let propertyList: Array<{ _id: Id<"properties">; name: string; status?: string | null; isActive?: boolean | null }>;
    if (args.propertyIds !== undefined && args.propertyIds.length > 0) {
      const fetched = await Promise.all(args.propertyIds.map((id) => ctx.db.get(id)));
      propertyList = fetched.filter((p): p is NonNullable<typeof p> => p !== null);
    } else {
      const all = await ctx.db.query("properties").collect();
      propertyList = all.filter((p) => {
        const effectiveStatus = p.pnlStatus ?? (p.isActive ? "active" : "dropped");
        return effectiveStatus === "active";
      });
    }

    const properties: StatementPropertyRow[] = await Promise.all(
      propertyList.map(async (p) => {
        const propertyId = p._id as Id<"properties">;

        // Delegate to buildReport for revenue/cost aggregates and hasData flags
        const payload = await buildReport(ctx.db, propertyId, args.month);

        const hasData = payload.metadata.hasActuals || payload.metadata.hasAssumptions;
        const bookingCount = payload.net.bookingCount ?? 0;
        const grossRevenue = payload.revenue.gross;

        // Load active cost items for this property
        const costItems = await ctx.db
          .query("propertyCostItems")
          .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
          .collect();
        const activeCostItems = costItems.filter((i) => i.isActive);

        const lines = activeCostItems.map((item) => {
          const categoryBucket = categoryBucketMap.get(item.categoryId as string) ?? null;
          const categoryName = categoryNameMap.get(item.categoryId as string) ?? null;
          const lineInput: CostLineInput = {
            amount: item.amount,
            frequency: item.frequency,
            percentageRate: item.percentageRate ?? null,
            itemBucket: null,
            categoryBucket,
            name: item.name,
            categoryName,
          };
          const monthlyAmount = monthlyEquivalent(lineInput, { bookingCount, grossRevenue });
          const bucket = resolveDisplayBucket(categoryBucket, item.name, categoryName);
          return {
            name: item.name,
            category: categoryName,
            bucket,
            monthlyAmount,
          };
        });

        return {
          id: propertyId as string,
          name: payload.property.name,
          hasData,
          bookingCount,
          grossRevenue,
          totalCosts: payload.costs.total,
          netProfit: payload.net.netProfit,
          marginPercent: payload.net.marginPercent,
          lines,
        };
      }),
    );

    return { properties };
  },
});
