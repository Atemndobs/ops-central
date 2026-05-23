// Owner-portal queries. Every query MUST go through `assertOwnerOfProperty` /
// `requireOwnerUser` from `./auth.ts` — no exceptions.
//
// Wave 3 surface (per spec §6.1):
//   - getOwnerDashboard           — landing page
//   - listOwnedProperties         — for multi-property selector
//   - getOwnerProperty            — per-property overview
//   - getOwnerStatementDraft      — live preview of current period
//   - getOwnerStatement           — drill into one issued statement
//   - listOwnerStatements         — history list per property
//   - listMaintenanceApprovalRequests  — for the Approvals tab
//   - getMaintenanceApprovalRequest    — drill into one request
//   - listOwnerDateBlocks         — for the date-block calendar

import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import {
  assertOwnerOfProperty,
  listOwnedPropertyIds,
  requireOwnerUser,
} from "./auth";
import {
  computeStatementForPeriod,
  monthRange,
  type FeeEngineInputs,
  type FeeEngineOutput,
} from "./feeEngine";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Load all engine inputs for a (property, period). */
async function loadEngineInputs(
  ctx: QueryCtx,
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
    // Cast: schema enum is wider than what reaches the engine. Engine only reads `.bucket`.
    costCategories: costCategories
      .filter((c) => c.bucket !== undefined)
      .map((c) => ({ _id: c._id, bucket: c.bucket as FeeEngineInputs["costCategories"][number]["bucket"] })),
    manualAdjustments,
    capitalExpenditures: capEx,
    owners,
    feeConfigs,
    monthlySettings,
  };
}

/** Current calendar month in property's TZ (v1 = UTC; spec §13a-3 keeps this simple). */
function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1).toString().padStart(2, "0")}`;
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Adapts to single-property OR portfolio. Returns enough for the
 * /owner landing page in one round-trip.
 */
export const getOwnerDashboard = query({
  args: {
    /** "YYYY-MM" — defaults to current month. Pass past months to see
     *  already-issued periods, or future months to scope to upcoming. */
    month: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireOwnerUser(ctx);
    const ownedPropertyIds = await listOwnedPropertyIds(ctx, user._id);

    if (ownedPropertyIds.length === 0) {
      return { mode: "no_properties" as const, user: pickUser(user), properties: [], month: args.month ?? currentMonthKey() };
    }

    const properties = await Promise.all(
      ownedPropertyIds.map((id) => ctx.db.get(id)),
    );
    const month = args.month ?? currentMonthKey();
    const { start, end } = monthRange(month);

    // Compute a live draft for every owned property so the dashboard can show
    // payout-to-date + occupancy at a glance. Small N (typically 1–3 properties).
    const perProperty = await Promise.all(
      properties.filter((p): p is Doc<"properties"> => p !== null).map(async (p) => {
        let draft: FeeEngineOutput | { error: string };
        try {
          const inputs = await loadEngineInputs(ctx, p._id, start, end);
          draft = computeStatementForPeriod(inputs);
        } catch (e) {
          draft = { error: e instanceof Error ? e.message : String(e) };
        }
        const pendingApprovals = await ctx.db
          .query("maintenanceApprovalRequests")
          .withIndex("by_property_and_status", (q) =>
            q.eq("propertyId", p._id).eq("status", "pending"),
          )
          .collect();
        return {
          propertyId: p._id,
          propertyName: p.name,
          propertyImage: p.imageUrl ?? null,
          currency: p.currency ?? "USD",
          currentMonth: month,
          draft,
          pendingApprovalCount: pendingApprovals.length,
        };
      }),
    );

    // Also surface whether a statement has been ISSUED for this property+month
    // (so the dashboard can label the card "paid out" vs "live draft").
    const perPropertyWithStatus = await Promise.all(
      perProperty.map(async (p) => {
        const issued = await ctx.db
          .query("ownerStatements")
          .withIndex("by_property_and_period", (q) =>
            q.eq("propertyId", p.propertyId).eq("periodStart", start),
          )
          .first();
        return {
          ...p,
          issuedStatementId: issued?.status === "issued" ? issued._id : null,
        };
      }),
    );

    return {
      mode: perPropertyWithStatus.length === 1 ? ("single" as const) : ("portfolio" as const),
      user: pickUser(user),
      properties: perPropertyWithStatus,
      month,
    };
  },
});

export const listOwnedProperties = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireOwnerUser(ctx);
    const ids = await listOwnedPropertyIds(ctx, user._id);
    const props = await Promise.all(ids.map((id) => ctx.db.get(id)));
    return props
      .filter((p): p is Doc<"properties"> => p !== null)
      .map((p) => ({
        _id: p._id,
        name: p.name,
        address: p.address,
        city: p.city ?? null,
        imageUrl: p.imageUrl ?? null,
        currency: p.currency ?? "USD",
      }));
  },
});

export const getOwnerProperty = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    const { user, ownership } = await assertOwnerOfProperty(ctx, args.propertyId);
    const property = await ctx.db.get(args.propertyId);
    if (!property) throw new ConvexError("Property not found");
    return {
      property,
      ownership: {
        ownerId: ownership._id,
        stakePct: ownership.stakePct,
        role: ownership.role,
        isPrimaryApprover: ownership.isPrimaryApprover,
      },
      user: pickUser(user),
    };
  },
});

/** Draft (live, unfrozen) statement for the requested month. */
export const getOwnerStatementDraft = query({
  args: {
    propertyId: v.id("properties"),
    month: v.optional(v.string()), // YYYY-MM; defaults to current
  },
  handler: async (ctx, args) => {
    await assertOwnerOfProperty(ctx, args.propertyId);
    const month = args.month ?? currentMonthKey();
    const { start, end } = monthRange(month);
    const inputs = await loadEngineInputs(ctx, args.propertyId, start, end);
    const output = computeStatementForPeriod(inputs);
    return { month, periodStart: start, periodEnd: end, draft: output };
  },
});

/** One specific issued statement by ID. */
export const getOwnerStatement = query({
  args: { statementId: v.id("ownerStatements") },
  handler: async (ctx, args) => {
    const statement = await ctx.db.get(args.statementId);
    if (!statement) throw new ConvexError("Statement not found");
    await assertOwnerOfProperty(ctx, statement.propertyId);
    return statement;
  },
});

export const listOwnerStatements = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    await assertOwnerOfProperty(ctx, args.propertyId);
    const rows = await ctx.db
      .query("ownerStatements")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .order("desc")
      .collect();
    return rows.map((r) => ({
      _id: r._id,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      status: r.status,
      ownerPayout: r.snapshotTotals.ownerPayout,
      noi: r.snapshotTotals.noi,
      mgmtFee: r.snapshotTotals.mgmtFee,
      issuedAt: r.issuedAt ?? null,
      pdfStorageId: r.pdfStorageId ?? null,
    }));
  },
});

export const listMaintenanceApprovalRequests = query({
  args: {
    propertyId: v.id("properties"),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("declined"),
        v.literal("auto_approved"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    await assertOwnerOfProperty(ctx, args.propertyId);
    const rows = args.status
      ? await ctx.db
          .query("maintenanceApprovalRequests")
          .withIndex("by_property_and_status", (q) =>
            q.eq("propertyId", args.propertyId).eq("status", args.status!),
          )
          .collect()
      : await ctx.db
          .query("maintenanceApprovalRequests")
          .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
          .collect();
    rows.sort((a, b) => b._creationTime - a._creationTime);
    return rows;
  },
});

export const getMaintenanceApprovalRequest = query({
  args: { requestId: v.id("maintenanceApprovalRequests") },
  handler: async (ctx, args) => {
    const req = await ctx.db.get(args.requestId);
    if (!req) throw new ConvexError("Request not found");
    await assertOwnerOfProperty(ctx, req.propertyId);
    return req;
  },
});

export const listOwnerDateBlocks = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    await assertOwnerOfProperty(ctx, args.propertyId);
    return await ctx.db
      .query("ownerDateBlocks")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
  },
});

export const getOwnerNotificationPrefs = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireOwnerUser(ctx);
    const prefs = await ctx.db
      .query("ownerNotificationPrefs")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    return prefs;
  },
});

/**
 * All active cost-items for a property, denormalized with their category
 * name + bucket. Powers the Costs section on the property page — owners
 * can audit what J&A is booking against their P&L line-by-line.
 */
export const listOwnerCostItems = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    await assertOwnerOfProperty(ctx, args.propertyId);
    const items = await ctx.db
      .query("propertyCostItems")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    const cats = await ctx.db.query("costCategories").collect();
    const catById = new Map(cats.map((c) => [c._id, c]));
    return items
      .filter((i) => i.isActive)
      .map((i) => {
        const cat = catById.get(i.categoryId);
        return {
          _id: i._id,
          name: i.name,
          amount: i.amount,
          frequency: i.frequency,
          percentageRate: i.percentageRate,
          startDate: i.startDate,
          endDate: i.endDate,
          receiptCount: i.receiptStorageIds?.length ?? 0,
          categoryName: cat?.name ?? "(uncategorized)",
          bucket: cat?.bucket ?? "other",
        };
      })
      .sort((a, b) => a.bucket.localeCompare(b.bucket) || a.name.localeCompare(b.name));
  },
});

/**
 * Recent stays for a property (default: last 90 days + future). Used for
 * the Bookings section. Cancelled stays are returned with a flag so the UI
 * can show them grayed-out — owners often want to know about cancellations.
 */
export const listOwnerStays = query({
  args: {
    propertyId: v.id("properties"),
    lookbackDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await assertOwnerOfProperty(ctx, args.propertyId);
    const lookback = (args.lookbackDays ?? 90) * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - lookback;
    const stays = await ctx.db
      .query("stays")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    return stays
      .filter((s) => s.checkInAt >= cutoff)
      .sort((a, b) => b.checkInAt - a.checkInAt)
      .map((s) => ({
        _id: s._id,
        guestName: s.guestName,
        platform: s.platform ?? null,
        checkInAt: s.checkInAt,
        checkOutAt: s.checkOutAt,
        numberOfGuests: s.numberOfGuests ?? null,
        totalAmount: s.totalAmount ?? null,
        currency: s.currency ?? "USD",
        cancelledAt: s.cancelledAt ?? null,
      }));
  },
});

// ─── helpers ────────────────────────────────────────────────────────────────

function pickUser(user: Doc<"users">) {
  return {
    _id: user._id,
    name: user.name ?? null,
    email: user.email,
    avatarUrl: user.avatarUrl ?? null,
  };
}
