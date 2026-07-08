import { query } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
  buildPortfolioReport,
  type PropertyMonthInput,
  type CostLineInput,
  type CostBucket,
  type PortfolioReport,
} from "./costMath";
import { toEngineBucket } from "./buckets";

// DESIGN DECISION (2026-06-29): portfolioReport is a DETERMINISTIC RECOMPUTE.
// It always derives costs from active propertyCostItems via the shared
// costMath engine and uses GROSS revenue as the P&L basis. It intentionally
// IGNORES any stored monthlyCalculations.totalCosts / netProfit "actuals",
// because those stored snapshots are exactly what previously diverged (the
// browser calculator, backend, and AI tool each computed differently).
// By contrast, resolvePropertyReportData (reports.ts) still PREFERS stored
// actuals (actual.totalCosts ?? recompute) for backward-compat. So for a
// property+month that HAS stored actuals, the per-property report and this
// portfolio row can differ. This is intended for now.
//
// PORT NOTE (OpsCentral): jna-bs-admin's propertyCostItems carried an
// item-level `bucket`; OpsCentral's does not, so item lines have no itemBucket
// and bucket resolution flows category-bucket → name inference. Category
// buckets are mapped from OpsCentral's 13-bucket vocabulary to the engine's
// 7-bucket set via `toEngineBucket`.

/**
 * Deterministic portfolio P&L for a month — the SINGLE engine consumed by the
 * Monthly Close page and (future) prepared-query chips. No LLM, no external
 * API. scope "active" = arbitrage P&L (default); "managed" = the
 * managed-property view (mgmt-fee units only).
 */
export const portfolioReport = query({
  args: {
    month: v.string(), // "YYYY-MM"
    scope: v.optional(v.union(v.literal("active"), v.literal("managed"))),
    /** When present, restrict the report to exactly these property IDs (saved-view filter). */
    propertyIds: v.optional(v.array(v.id("properties"))),
  },
  handler: async (ctx, args): Promise<PortfolioReport> => {
    const scope = args.scope ?? "active";
    const allPropsRaw = await ctx.db.query("properties").collect();

    // When propertyIds is provided, restrict to exactly those properties and
    // force each one to "active" so the view shows exactly what was picked,
    // regardless of the property's stored status.
    const isFiltered =
      args.propertyIds !== undefined && args.propertyIds.length > 0;
    const wanted = isFiltered
      ? new Set(args.propertyIds!.map(String))
      : null;
    const allProps = wanted
      ? allPropsRaw.filter((p) => wanted.has(String(p._id)))
      : allPropsRaw;

    // Resolve effective status: explicit status, else derive from isActive.
    // When a property was explicitly selected via propertyIds, always report it
    // as "active" so it appears in the report rows (not in excluded).
    const effectiveStatus = (p: (typeof allProps)[number]): "active" | "dropped" | "managed" =>
      isFiltered ? "active" : (p.pnlStatus ?? (p.isActive ? "active" : "dropped"));

    // Category → engine bucket map and name map (for cost lines without an
    // item-level bucket). OpsCentral category buckets are mapped to the
    // engine's vocabulary via toEngineBucket.
    const categories = await ctx.db.query("costCategories").collect();
    const categoryBucket = new Map<string, CostBucket | null>(
      categories.map((c) => [c._id as string, toEngineBucket(c.bucket)]),
    );
    const categoryNameMap = new Map<string, string>(
      categories.map((c) => [c._id as string, c.name]),
    );

    const inputs: PropertyMonthInput[] = [];
    for (const p of allProps) {
      const status = effectiveStatus(p);
      // For the "active" scope we still pass dropped/managed through so the
      // engine reports them under `excluded`; for "managed" scope we relabel
      // managed→active and everything else→dropped so only managed units appear.
      const reportStatus: "active" | "dropped" | "managed" =
        scope === "managed"
          ? status === "managed" ? "active" : "dropped"
          : status;

      const month = args.month;
      const calcs = await ctx.db
        .query("monthlyCalculations")
        .withIndex("by_property_month", (q) =>
          q.eq("propertyId", p._id as Id<"properties">).eq("month", month),
        )
        .collect();
      const actual = calcs.find((c) => c.isActual === true) ?? calcs[0] ?? null;

      const settingsRows = await ctx.db
        .query("propertyMonthlySettings")
        .withIndex("by_property_month", (q) =>
          q.eq("propertyId", p._id as Id<"properties">).eq("month", month),
        )
        .collect();
      const settings = settingsRows.find((s) => s.isActive !== false) ?? settingsRows[0] ?? null;

      const grossRevenue =
        actual?.grossRevenue ?? settings?.totalRevenueAssumption ?? 0;
      const netRevenue = actual?.netRevenue ?? Math.max(0, grossRevenue - (actual?.platformFees ?? 0));
      const bookingCount =
        actual?.totalBookings ?? settings?.monthlyBookingsAssumption ?? 0;

      const costItems = await ctx.db
        .query("propertyCostItems")
        .withIndex("by_property", (q) => q.eq("propertyId", p._id as Id<"properties">))
        .collect();
      const lines: CostLineInput[] = costItems
        .filter((i) => i.isActive)
        .map((i) => ({
          amount: i.amount,
          frequency: i.frequency,
          percentageRate: i.percentageRate ?? null,
          itemBucket: null, // OpsCentral propertyCostItems has no item-level bucket
          categoryBucket: categoryBucket.get(i.categoryId as string) ?? null,
          name: i.name,
          categoryName: categoryNameMap.get(i.categoryId as string) ?? null,
        }));

      // A property has data for the month when at least one monthlyCalculations
      // OR propertyMonthlySettings row exists. Without either, revenue/bookings
      // resolve to 0 but fixed costs still apply — flagging such rows prevents
      // them from inflating the portfolio loss total.
      const hasData = actual !== null || settings !== null;

      inputs.push({
        id: p._id as string,
        name: p.name,
        status: reportStatus,
        revenueGross: grossRevenue,
        revenueNet: netRevenue,
        bookingCount,
        lines,
        hasData,
      });
    }

    return buildPortfolioReport(args.month, inputs);
  },
});
