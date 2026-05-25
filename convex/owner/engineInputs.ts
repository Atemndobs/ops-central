// Shared loader for `FeeEngineInputs`. Used by:
//   - convex/owner/queries.ts (owner-facing previews)
//   - convex/owner/mutations.ts (issueOwnerStatement)
//   - convex/admin/ownerOverview.ts (admin preview + draft upsert)
//
// Keeps the three call sites in lockstep so the owner page and the admin
// preview can't drift (plan §"Risks and tradeoffs" — drift mitigation).

import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { FeeEngineInputs } from "./feeEngine";

export async function loadEngineInputs(
  ctx: QueryCtx | MutationCtx,
  propertyId: Id<"properties">,
  periodStart: number,
  periodEnd: number,
): Promise<FeeEngineInputs> {
  const [stays, costItems, costCategories, manualAdjustments, capEx, owners, feeConfigs] =
    await Promise.all([
      ctx.db
        .query("stays")
        .withIndex("by_property_dates", (q) => q.eq("propertyId", propertyId))
        .collect(),
      ctx.db
        .query("propertyCostItems")
        .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
        .collect(),
      ctx.db.query("costCategories").collect(),
      ctx.db.query("manualAdjustments").collect(),
      ctx.db
        .query("capitalExpenditures")
        .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
        .collect(),
      ctx.db
        .query("propertyOwners")
        .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
        .collect(),
      ctx.db
        .query("propertyFeeConfig")
        .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
        .collect(),
    ]);
  const monthlySettings = await ctx.db
    .query("propertyMonthlySettings")
    .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
    .collect();

  return {
    propertyId,
    periodStart,
    periodEnd,
    stays,
    costItems,
    costCategories: costCategories
      .filter((c) => c.bucket !== undefined)
      .map((c) => ({
        _id: c._id,
        bucket: c.bucket as FeeEngineInputs["costCategories"][number]["bucket"],
      })),
    manualAdjustments,
    capitalExpenditures: capEx,
    owners,
    feeConfigs,
    monthlySettings,
  };
}
