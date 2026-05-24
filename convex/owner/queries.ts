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
 * Owner inbox — recent notifications for the authenticated owner, filtered
 * to owner-portal event types. Returns the existing `notifications` table
 * rows (the same ones the cleaners-app inbox renders), but only the
 * owner_* types so the mobile owner surface stays uncluttered.
 *
 * Sorted newest-first. Default cap of 50; pass `limit` to override.
 */
export const listOwnerNotifications = query({
  args: {
    limit: v.optional(v.number()),
    unreadOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireOwnerUser(ctx);
    const limit = Math.min(args.limit ?? 50, 200);

    // Use by_user index for cheap scan; filter type + dismissed in memory
    // (notification volume per owner is small — <100s/year).
    const all = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();

    const ownerTypes = new Set([
      "owner_statement_issued",
      "owner_approval_request",
      "owner_incident_reported",
    ]);

    const filtered = all
      .filter((n) => ownerTypes.has(n.type))
      .filter((n) => n.dismissedAt === undefined)
      .filter((n) => !args.unreadOnly || n.readAt === undefined)
      .slice(0, limit);

    return filtered.map((n) => ({
      _id: n._id,
      type: n.type,
      title: n.title,
      message: n.message,
      data: n.data ?? null,
      readAt: n.readAt ?? null,
      createdAt: n.createdAt,
    }));
  },
});

/**
 * Returns a signed URL for the statement PDF, after verifying the caller
 * owns the property. Mobile uses this to `Linking.openURL(url)`; web uses
 * it for the Download button. Returns null while the PDF is still
 * generating (status="issued" but pdfStorageId not yet set).
 */
export const getOwnerStatementPdfUrl = query({
  args: { statementId: v.id("ownerStatements") },
  handler: async (ctx, args) => {
    const statement = await ctx.db.get(args.statementId);
    if (!statement) throw new ConvexError("Statement not found");
    await assertOwnerOfProperty(ctx, statement.propertyId);
    if (!statement.pdfStorageId) {
      return {
        url: null,
        status: "generating" as const,
        templateVersion: null,
      };
    }
    const url = await ctx.storage.getUrl(statement.pdfStorageId);
    return {
      url,
      status: "ready" as const,
      templateVersion: statement.pdfTemplateVersion ?? null,
    };
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
 * Stays for a property, scoped to a specific calendar month by default
 * (the same month the dashboard draft is computed for). Owners can pass
 * `lookbackDays` to override and get a rolling window instead — that's
 * useful for "show me everything recent" admin/debug views, not the
 * primary owner UX.
 *
 * Filter semantics MATCH the fee engine: a stay is "in" the month if its
 * checkInAt falls in [periodStart, periodEnd). This is what flows into
 * grossRevenue, so the booking list always reconciles to the headline
 * revenue number on the dashboard.
 *
 * Cancelled stays are included (with cancelledAt flag) so owners can see
 * the booking that fell through.
 */
export const listOwnerStays = query({
  args: {
    propertyId: v.id("properties"),
    /** "YYYY-MM" — when set, returns only stays with checkInAt in that month. */
    month: v.optional(v.string()),
    /** Alternative window: stays with checkInAt in the last N days. Ignored if `month` is set. */
    lookbackDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await assertOwnerOfProperty(ctx, args.propertyId);
    let windowStart: number;
    let windowEnd: number;
    if (args.month) {
      const { start, end } = monthRange(args.month);
      windowStart = start;
      windowEnd = end;
    } else {
      const lookback = (args.lookbackDays ?? 90) * 24 * 60 * 60 * 1000;
      windowStart = Date.now() - lookback;
      windowEnd = Number.POSITIVE_INFINITY;
    }
    const stays = await ctx.db
      .query("stays")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    return stays
      .filter((s) => s.checkInAt >= windowStart && s.checkInAt < windowEnd)
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

/**
 * Mortgage / lease coverage for the property in a given month. The pitch
 * surface: "by day X you'd already have made the lease/mortgage."
 *
 * Reuses the existing `bucket="lease"` cost items as the monthly
 * obligation — no new schema. For owners on a rental-arbitrage property
 * (J&A's current model), that bucket holds the rent J&A pays the
 * landlord; for owners on an owned property, the same bucket holds the
 * mortgage payment to the bank. Same math either way.
 *
 * Per-owner share = obligation × stakePct vs payout × stakePct.
 * Cover threshold = ownerPayout (after mgmt fee) — most defensible.
 *
 * Status:
 *   - "no_obligation"  → no lease cost items configured; meter hidden
 *   - "covered"        → payoutToDate ≥ obligation (yes-celebration state)
 *   - "on_track"       → projectedPayout ≥ obligation (with projected date)
 *   - "shortfall"      → projectedPayout < obligation
 */
export const getOwnerMortgageCoverage = query({
  args: {
    propertyId: v.id("properties"),
    month: v.optional(v.string()), // "YYYY-MM"; defaults to current
  },
  handler: async (ctx, args) => {
    const { ownership } = await assertOwnerOfProperty(ctx, args.propertyId);
    const month = args.month ?? currentMonthKey();
    const { start, end } = monthRange(month);

    let engineOutput;
    try {
      const inputs = await loadEngineInputs(ctx, args.propertyId, start, end);
      engineOutput = computeStatementForPeriod(inputs);
    } catch (e) {
      return {
        status: "engine_error" as const,
        month,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    // Full-period obligation (lease bucket sum)
    const obligationFull =
      engineOutput.totals.costsByBucket.find((c) => c.bucket === "lease")
        ?.amount ?? 0;
    if (obligationFull === 0) {
      return {
        status: "no_obligation" as const,
        month,
        obligation: 0,
      };
    }

    // Re-load stays to compute payoutToDate (sum of stays where checkInAt ≤ now)
    const stays = await ctx.db
      .query("stays")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    const now = Date.now();
    const isCurrentMonth = now >= start && now < end;
    const isPastMonth = now >= end;

    const payoutToDate = isPastMonth
      ? engineOutput.totals.ownerPayout
      : computePayoutToDate(stays, args.propertyId, start, end, now, engineOutput);

    const stakePct = ownership.stakePct;
    const myObligation = obligationFull * stakePct;
    const myPayoutToDate = payoutToDate * stakePct;
    const myProjectedPayout = isPastMonth
      ? myPayoutToDate
      : projectPayout(myPayoutToDate, start, end, now);

    // Status
    if (myPayoutToDate >= myObligation) {
      return {
        status: "covered" as const,
        month,
        obligation: myObligation,
        payoutToDate: myPayoutToDate,
        projectedPayout: myProjectedPayout,
        amountAhead: myPayoutToDate - myObligation,
        coveredOn: estimateCoveredDate(
          stays,
          args.propertyId,
          start,
          end,
          stakePct,
          myObligation,
          engineOutput,
        ),
        stakePct,
        isCurrentMonth,
      };
    }

    if (myProjectedPayout >= myObligation && isCurrentMonth) {
      return {
        status: "on_track" as const,
        month,
        obligation: myObligation,
        payoutToDate: myPayoutToDate,
        projectedPayout: myProjectedPayout,
        amountShortToDate: myObligation - myPayoutToDate,
        projectedCoverDay: estimateProjectedCoverDay(
          myPayoutToDate,
          myObligation,
          start,
          now,
        ),
        stakePct,
        isCurrentMonth,
      };
    }

    return {
      status: "shortfall" as const,
      month,
      obligation: myObligation,
      payoutToDate: myPayoutToDate,
      projectedPayout: myProjectedPayout,
      projectedShortfall: myObligation - myProjectedPayout,
      stakePct,
      isCurrentMonth,
    };
  },
});

/**
 * Trailing N months of mortgage/lease coverage for the property. Powers
 * the 12-month strip + avg + streak below the cover meter. Months without
 * any obligation configured are returned as `status: "no_obligation"`.
 */
export const getOwnerCoverageHistory = query({
  args: {
    propertyId: v.id("properties"),
    monthsBack: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { ownership } = await assertOwnerOfProperty(ctx, args.propertyId);
    const n = Math.min(args.monthsBack ?? 12, 24);
    const months = lastNMonthKeys(n + 1).slice(0, n); // skip current month
    const stakePct = ownership.stakePct;

    const results: Array<{
      month: string;
      status: "covered" | "shortfall" | "no_obligation" | "engine_error";
      obligation: number;
      payout: number;
    }> = [];

    for (const m of months) {
      const { start, end } = monthRange(m);
      try {
        const inputs = await loadEngineInputs(ctx, args.propertyId, start, end);
        const out = computeStatementForPeriod(inputs);
        const obligationFull =
          out.totals.costsByBucket.find((c) => c.bucket === "lease")?.amount ??
          0;
        const obligation = obligationFull * stakePct;
        const payout = out.totals.ownerPayout * stakePct;
        if (obligation === 0) {
          results.push({ month: m, status: "no_obligation", obligation: 0, payout });
        } else {
          results.push({
            month: m,
            status: payout >= obligation ? "covered" : "shortfall",
            obligation,
            payout,
          });
        }
      } catch {
        results.push({ month: m, status: "engine_error", obligation: 0, payout: 0 });
      }
    }

    // Trailing avg over months with a real obligation
    const withObligation = results.filter((r) => r.status !== "no_obligation" && r.status !== "engine_error");
    const avgPayout =
      withObligation.length > 0
        ? withObligation.reduce((s, r) => s + r.payout, 0) / withObligation.length
        : 0;
    const avgObligation =
      withObligation.length > 0
        ? withObligation.reduce((s, r) => s + r.obligation, 0) / withObligation.length
        : 0;

    // Streak: from most recent backwards, count consecutive "covered"
    let streak = 0;
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i].status === "covered") streak += 1;
      else if (results[i].status === "no_obligation") continue;
      else break;
    }

    const coveredCount = withObligation.filter((r) => r.status === "covered").length;

    return {
      months: results,
      summary: {
        sampledMonths: withObligation.length,
        coveredCount,
        avgPayout,
        avgObligation,
        avgBuffer: avgPayout - avgObligation,
        streak,
      },
      stakePct,
    };
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

/**
 * Compute the ownerPayout "as of now" for the current month — sum of
 * stay revenue with checkInAt ≤ now, minus prorated period costs.
 *
 * Approximation: scales the full-period operatingCosts + platformFees +
 * mgmtFee by (gross-to-date / gross-full). This is honest because:
 *   - platformFees on revenue-percentage scale exactly with gross
 *   - operating costs amortize linearly over the period (close enough)
 *   - mgmtFee scales with the feeBase (which is gross/net/NOI)
 */
function computePayoutToDate(
  stays: Doc<"stays">[],
  propertyId: Id<"properties">,
  periodStart: number,
  periodEnd: number,
  now: number,
  full: FeeEngineOutput,
): number {
  const grossToDate = stays
    .filter(
      (s) =>
        s.propertyId === propertyId &&
        s.checkInAt >= periodStart &&
        s.checkInAt < periodEnd &&
        s.checkInAt <= now &&
        s.cancelledAt === undefined,
    )
    .reduce((sum, s) => sum + (s.totalAmount ?? 0), 0);

  if (full.totals.grossRevenue === 0) return 0;
  const proportion = grossToDate / full.totals.grossRevenue;
  // PayoutToDate = ownerPayoutFull × (gross-to-date / gross-full)
  // This rolls up all the cost interactions proportionally.
  return full.totals.ownerPayout * proportion;
}

/**
 * Linear projection: at today's daily rate, what would ownerPayout be by
 * end of month?
 */
function projectPayout(
  payoutToDate: number,
  periodStart: number,
  periodEnd: number,
  now: number,
): number {
  const daysElapsed = Math.max(1, (now - periodStart) / 86400000);
  const totalDays = (periodEnd - periodStart) / 86400000;
  const dailyRate = payoutToDate / daysElapsed;
  return dailyRate * totalDays;
}

/**
 * Walk stays in checkInAt order, compute running payout, find first day
 * cumulative payout crosses obligation. Returns unix ms.
 */
function estimateCoveredDate(
  stays: Doc<"stays">[],
  propertyId: Id<"properties">,
  periodStart: number,
  periodEnd: number,
  stakePct: number,
  myObligation: number,
  full: FeeEngineOutput,
): number {
  const periodStays = stays
    .filter(
      (s) =>
        s.propertyId === propertyId &&
        s.checkInAt >= periodStart &&
        s.checkInAt < periodEnd &&
        s.cancelledAt === undefined,
    )
    .sort((a, b) => a.checkInAt - b.checkInAt);

  if (periodStays.length === 0 || full.totals.grossRevenue === 0) {
    return periodEnd - 1;
  }
  let cumulativeGross = 0;
  for (const s of periodStays) {
    cumulativeGross += s.totalAmount ?? 0;
    const proportion = cumulativeGross / full.totals.grossRevenue;
    const cumPayout = full.totals.ownerPayout * proportion * stakePct;
    if (cumPayout >= myObligation) {
      // The day this stay's checkInAt fell on
      return s.checkInAt;
    }
  }
  return periodEnd - 1;
}

function estimateProjectedCoverDay(
  payoutToDate: number,
  myObligation: number,
  periodStart: number,
  now: number,
): number {
  if (payoutToDate <= 0) return periodStart; // unknown
  const daysElapsed = Math.max(1, (now - periodStart) / 86400000);
  const dailyRate = payoutToDate / daysElapsed;
  const daysToCover = myObligation / dailyRate;
  return periodStart + daysToCover * 86400000;
}

function lastNMonthKeys(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = 0; i < n; i++) {
    out.unshift(
      `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1).toString().padStart(2, "0")}`,
    );
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}
