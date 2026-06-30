import { mutation } from "../_generated/server";
import type { DatabaseReader } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
  buildImportedActual,
  type CostLineInput,
  type CostBucket,
} from "./costMath";
import { toEngineBucket } from "./buckets";

// ─────────────────────────────────────────────────────────────────────────────
// Monthly Close — import + manual actuals entry
//
// Ported from jna-bs-admin convex/strCosts/mutations.ts (only the two functions
// the Monthly Close page needs). Both upsert a monthlyCalculations ACTUAL row
// whose costs are computed by the shared costMath engine from the property's
// current active propertyCostItems.
//
// PORT NOTE (OpsCentral): propertyCostItems has no item-level `bucket`, so cost
// lines carry itemBucket=null and rely on the mapped category bucket
// (toEngineBucket) + name inference. The Hospitable live-sync action and the
// API-route import path from jna-bs-admin are intentionally omitted — the
// Monthly Close page calls saveHospitableImportItems directly via useMutation
// after parsing the CSV client-side.
// ─────────────────────────────────────────────────────────────────────────────

/** Build engine cost lines from a property's active cost items + category map. */
async function buildCostLines(
  db: DatabaseReader,
  propertyId: Id<"properties">,
  categoryBucket: Map<string, CostBucket | null>,
): Promise<CostLineInput[]> {
  const costItems = await db
    .query("propertyCostItems")
    .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
    .collect();
  return costItems
    .filter((i) => i.isActive)
    .map((i) => ({
      amount: i.amount,
      frequency: i.frequency,
      percentageRate: i.percentageRate ?? null,
      itemBucket: null,
      categoryBucket: categoryBucket.get(i.categoryId as string) ?? null,
      name: i.name,
      categoryName: null,
    }));
}

export const saveHospitableImportItems = mutation({
  args: {
    items: v.array(v.object({
      externalPropertyId: v.string(),
      internalPropertyId: v.string(),
      month: v.number(),
      year: v.number(),
      totalRevenue: v.number(),
      bookedNights: v.number(),
      reservationCount: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    let savedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    // Load category→engine-bucket map once for actuals cost computation
    const categories = await ctx.db.query("costCategories").collect();
    const categoryBucket = new Map<string, CostBucket | null>(
      categories.map((c) => [c._id as string, toEngineBucket(c.bucket)]),
    );

    for (const item of args.items) {
      if (!item.internalPropertyId) {
        skippedCount += 1;
        continue;
      }

      const monthKey = `${item.year}-${String(item.month).padStart(2, "0")}`;
      const configurationName = `${monthKey} (Hospitable)`;
      const propId = item.internalPropertyId as Id<"properties">;
      const existing = await ctx.db
        .query("propertyMonthlySettings")
        .withIndex("by_property_month", (q) =>
          q.eq("propertyId", propId).eq("month", monthKey),
        )
        .first();

      let settingsSaved = false;
      if (existing) {
        // configurationName intentionally omitted: preserve the user's hand-named
        // configuration on re-import; only brand-new rows get the "(Hospitable)" default.
        await ctx.db.patch(existing._id, {
          totalRevenueAssumption: item.totalRevenue,
          monthlyBookingsAssumption: item.reservationCount,
          bookedNights: item.bookedNights,
          importSource: "hospitable_csv",
          externalPropertyId: item.externalPropertyId,
          isActive: true,
          updatedAt: Date.now(),
        });
        savedCount += 1;
        settingsSaved = true;
      } else {
        try {
          await ctx.db.insert("propertyMonthlySettings", {
            propertyId: propId,
            month: monthKey,
            settings: {},
            configurationName,
            totalRevenueAssumption: item.totalRevenue,
            monthlyBookingsAssumption: item.reservationCount,
            bookedNights: item.bookedNights,
            importSource: "hospitable_csv",
            externalPropertyId: item.externalPropertyId,
            isActive: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          savedCount += 1;
          settingsSaved = true;
        } catch (error) {
          errors.push(
            `Failed to save ${item.externalPropertyId} for ${item.month}/${item.year}: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }
      }

      // Also write a monthlyCalculations ACTUAL so imported Hospitable data is
      // sourced as "actual" (not "assumption"). Costs are computed by the shared
      // engine from the property's current active cost items.
      if (settingsSaved) {
        const costLines = await buildCostLines(ctx.db, propId, categoryBucket);
        const actual = buildImportedActual({
          grossRevenue: item.totalRevenue,
          bookingCount: item.reservationCount,
          bookedNights: item.bookedNights,
          costLines,
        });
        const existingCalc = await ctx.db
          .query("monthlyCalculations")
          .withIndex("by_property_month", (q) => q.eq("propertyId", propId).eq("month", monthKey))
          .collect();
        const calcRow = existingCalc.find((c) => c.isActual === true) ?? existingCalc[0] ?? null;
        const calcPayload = {
          propertyId: propId,
          month: monthKey,
          grossRevenue: actual.grossRevenue,
          platformFees: actual.platformFees,
          netRevenue: actual.netRevenue,
          totalCosts: actual.totalCosts,
          netProfit: actual.netProfit,
          marginPercent: actual.marginPercent ?? undefined,
          totalBookings: actual.totalBookings,
          bookedNights: actual.bookedNights,
          totalNights: actual.bookedNights,
          isActual: true as const,
          scenarioName: "Hospitable import",
          updatedAt: Date.now(),
        };
        if (calcRow) {
          await ctx.db.patch(calcRow._id, calcPayload);
        } else {
          await ctx.db.insert("monthlyCalculations", { ...calcPayload, createdAt: Date.now() });
        }
      }
    }

    return {
      success: errors.length === 0,
      savedCount,
      skippedCount,
      errors: errors.length > 0 ? errors : undefined,
    };
  },
});

/**
 * Upsert a monthlyCalculations ACTUAL row from manually entered revenue/nights
 * figures (off-platform bookings, corrections, etc.).
 *
 * Cost lines are derived from the property's current active propertyCostItems,
 * identical to the Hospitable import path.
 */
export const setMonthlyActual = mutation({
  args: {
    propertyId: v.id("properties"),
    month: v.string(), // "YYYY-MM"
    grossRevenue: v.number(),
    bookingCount: v.number(),
    bookedNights: v.number(),
  },
  handler: async (ctx, args) => {
    const categories = await ctx.db.query("costCategories").collect();
    const categoryBucket = new Map<string, CostBucket | null>(
      categories.map((c) => [c._id as string, toEngineBucket(c.bucket)]),
    );

    const costLines = await buildCostLines(ctx.db, args.propertyId, categoryBucket);

    // Compute actuals via shared cost engine
    const actual = buildImportedActual({
      grossRevenue: args.grossRevenue,
      bookingCount: args.bookingCount,
      bookedNights: args.bookedNights,
      costLines,
    });

    // Upsert monthlyCalculations: prefer existing isActual row, else first, else insert
    const existingCalc = await ctx.db
      .query("monthlyCalculations")
      .withIndex("by_property_month", (q) =>
        q.eq("propertyId", args.propertyId).eq("month", args.month),
      )
      .collect();
    const calcRow = existingCalc.find((c) => c.isActual === true) ?? existingCalc[0] ?? null;

    const calcPayload = {
      propertyId: args.propertyId,
      month: args.month,
      grossRevenue: actual.grossRevenue,
      platformFees: actual.platformFees,
      netRevenue: actual.netRevenue,
      totalCosts: actual.totalCosts,
      netProfit: actual.netProfit,
      marginPercent: actual.marginPercent ?? undefined,
      totalBookings: actual.totalBookings,
      bookedNights: actual.bookedNights,
      totalNights: args.bookedNights,
      isActual: true as const,
      scenarioName: "Manual entry",
      updatedAt: Date.now(),
    };

    if (calcRow) {
      await ctx.db.patch(calcRow._id, calcPayload);
    } else {
      await ctx.db.insert("monthlyCalculations", { ...calcPayload, createdAt: Date.now() });
    }

    return null;
  },
});
