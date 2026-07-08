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
import { internalQuery, query, type QueryCtx } from "../_generated/server";
import {
  assertOwnerOfProperty,
  listOwnedPropertyIds,
  requireOwnerUser,
} from "./auth";
import { loadEngineInputs } from "./engineInputs";
import {
  computeStatementForPeriod,
  monthRange,
  type FeeEngineInputs,
  type FeeEngineOutput,
} from "./feeEngine";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Current calendar month in property's TZ (v1 = UTC; spec §13a-3 keeps this simple). */
function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1).toString().padStart(2, "0")}`;
}

/**
 * Owner-portal visibility flags, read from the admin featureFlags table.
 * Single source of truth for every owner query so the dashboard, per-property
 * page, and statement detail honour the same admin toggles.
 * Defaults: showMgmtFee OFF, showPayout ON, showGrossRevenue OFF,
 * showStatements OFF (financial surfaces ship dark; admin opts in).
 */
async function readOwnerPortalFlags(ctx: QueryCtx) {
  const [mgmtFee, payout, grossRevenue, statements] = await Promise.all([
    ctx.db.query("featureFlags").withIndex("by_key", (q) => q.eq("key", "owner_show_mgmt_fee")).unique(),
    ctx.db.query("featureFlags").withIndex("by_key", (q) => q.eq("key", "owner_show_payout")).unique(),
    ctx.db.query("featureFlags").withIndex("by_key", (q) => q.eq("key", "owner_show_gross_revenue")).unique(),
    ctx.db.query("featureFlags").withIndex("by_key", (q) => q.eq("key", "owner_show_statements")).unique(),
  ]);
  return {
    showMgmtFee: mgmtFee?.enabled ?? false,
    showPayout: payout?.enabled ?? true,
    showGrossRevenue: grossRevenue?.enabled ?? false,
    showStatements: statements?.enabled ?? false,
  };
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

        // Raw monthly lease/mortgage obligation (sum of active "lease"-bucket
        // cost items, monthly normalized — matches the Operational Costs
        // ledger total). Used by the dashboard's per-card mortgage mini-bar
        // so the owner sees at a glance which properties cleared their
        // mortgage this month. We pull it from the engine inputs we already
        // loaded if the engine succeeded; otherwise compute from scratch.
        let leaseRawMonthly = 0;
        try {
          const items = await ctx.db
            .query("propertyCostItems")
            .withIndex("by_property", (q) => q.eq("propertyId", p._id))
            .collect();
          const cats = await ctx.db.query("costCategories").collect();
          const leaseCatIds = new Set(
            cats.filter((c) => c.bucket === "lease").map((c) => c._id),
          );
          leaseRawMonthly = items
            .filter((i) => i.isActive && leaseCatIds.has(i.categoryId))
            .reduce((s, i) => s + (i.amount ?? 0), 0);
        } catch {
          /* leave as 0; UI will treat as no obligation */
        }

        return {
          propertyId: p._id,
          propertyName: p.name,
          propertyImage: p.imageUrl ?? null,
          currency: p.currency ?? "USD",
          // Surfaced so the client can render city/state filter chips,
          // grouping, and column display in list view.
          city: p.city ?? null,
          state: p.state ?? null,
          currentMonth: month,
          draft,
          pendingApprovalCount: pendingApprovals.length,
          leaseRawMonthly,
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

    // Default sort: payout DESC (best-performing first). Engine errors
    // sink to the bottom so they don't dominate the top of the list when
    // a config is broken. Client can re-sort if user wants.
    perPropertyWithStatus.sort((a, b) => {
      const aPayout = "totals" in a.draft ? a.draft.totals.ownerPayout : -Infinity;
      const bPayout = "totals" in b.draft ? b.draft.totals.ownerPayout : -Infinity;
      return bPayout - aPayout;
    });

    // Collect distinct city/state values for filter-chip UI.
    const citySet = new Set<string>();
    const stateSet = new Set<string>();
    for (const p of perPropertyWithStatus) {
      if (p.city) citySet.add(p.city);
      if (p.state) stateSet.add(p.state);
    }

    // Owner-portal feature flags shared with the per-property page so the
    // dashboard cards/list honour the same admin toggles.
    //   - showMgmtFee defaults OFF (ships dark)
    //   - showPayout  defaults ON  (payout is the headline number)
    const ownerFlags = await readOwnerPortalFlags(ctx);

    return {
      mode: perPropertyWithStatus.length === 1 ? ("single" as const) : ("portfolio" as const),
      user: pickUser(user),
      properties: perPropertyWithStatus,
      month,
      // Distinct values so the client doesn't need a second roundtrip to
      // populate filter dropdowns / chip groups.
      facets: {
        cities: Array.from(citySet).sort(),
        states: Array.from(stateSet).sort(),
      },
      flags: ownerFlags,
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
    // Owner-portal feature flags consumed by this page.
    //   - showMgmtFee defaults OFF (ships dark, admin opts in)
    //   - showPayout  defaults ON (payout is the headline number;
    //                  admin opts OUT to demo a "gross + fee only" view)
    const ownerFlags = await readOwnerPortalFlags(ctx);
    // First-activity month — earliest non-cancelled stay on this
    // property. Used by the per-property month picker to clamp `←` so
    // users can't page back into months that pre-date the property's
    // presence on the platform. `null` when there are no stays yet.
    const stays = await ctx.db
      .query("stays")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    const earliestCheckIn = stays
      .filter((s) => s.cancelledAt === undefined)
      .reduce((min, s) => Math.min(min, s.checkInAt), Infinity);
    const firstActivityMonth: string | null = Number.isFinite(earliestCheckIn)
      ? `${new Date(earliestCheckIn).getUTCFullYear()}-${(new Date(earliestCheckIn).getUTCMonth() + 1).toString().padStart(2, "0")}`
      : null;

    return {
      property,
      ownership: {
        ownerId: ownership._id,
        stakePct: ownership.stakePct,
        role: ownership.role,
        isPrimaryApprover: ownership.isPrimaryApprover,
      },
      user: pickUser(user),
      firstActivityMonth,
      flags: ownerFlags,
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
    // Engine failures (e.g. no propertyFeeConfig active in this period —
    // a just-onboarded owner viewing a pre-onboarding month) must not
    // crash the whole property page. Return the same `{ error }` envelope
    // getOwnerDashboard uses per property; the mobile hook already
    // branches on it, and the web client guards with `"totals" in`.
    let draft: FeeEngineOutput | { error: string };
    try {
      const inputs = await loadEngineInputs(ctx, args.propertyId, start, end);
      draft = computeStatementForPeriod(inputs);
    } catch (e) {
      draft = { error: e instanceof Error ? e.message : String(e) };
    }
    return { month, periodStart: start, periodEnd: end, draft };
  },
});

/** One specific issued statement by ID. */
export const getOwnerStatement = query({
  args: { statementId: v.id("ownerStatements") },
  handler: async (ctx, args) => {
    const statement = await ctx.db.get(args.statementId);
    if (!statement) throw new ConvexError("Statement not found");
    await assertOwnerOfProperty(ctx, statement.propertyId);
    // Surface the owner-portal flags this page consumes so the statement
    // detail surface stays in sync with the dashboard + summary card
    // (single source of truth: the featureFlags table). Defaults match
    // getOwnerProperty: showMgmtFee OFF, showPayout ON.
    const ownerFlags = await readOwnerPortalFlags(ctx);
    return {
      statement,
      flags: ownerFlags,
    };
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
 * Math contract (MUST match `src/components/owner/mortgage-coverage.tsx`):
 *   - obligation = RAW monthly lease (sum of active `bucket="lease"` cost
 *                  items) × stakePct. Same number the Operational Costs
 *                  ledger shows; NOT the engine's period-prorated value.
 *   - progress   = grossRevenue × stakePct. Owner mental model is "first
 *                  dollar of revenue covers rent." Using post-fee payout
 *                  here was the bug that made the detail page contradict
 *                  the dashboard's `MortgageCoverageBar`.
 *
 * Past-month signal: we still use the engine to detect whether a lease
 * cost item was ACTIVE in that period (start/end-date aware). If the
 * engine produces zero lease bucket for the period → no_obligation.
 *
 * Status:
 *   - "no_obligation"  → no active lease this month; meter hidden
 *   - "covered"        → grossToDate ≥ obligation
 *   - "on_track"       → projectedGross ≥ obligation (current month only)
 *   - "shortfall"      → projectedGross < obligation
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

    // Engine-prorated lease bucket — used ONLY as the "is a lease active
    // this period?" signal (start/end-date aware). The actual obligation
    // shown to the owner is the raw monthly amount, computed separately.
    const engineLeaseThisPeriod =
      engineOutput.totals.costsByBucket.find((c) => c.bucket === "lease")
        ?.amount ?? 0;
    if (engineLeaseThisPeriod === 0) {
      return {
        status: "no_obligation" as const,
        month,
        obligation: 0,
      };
    }

    const rawMonthlyLease = await loadRawMonthlyLease(ctx, args.propertyId);

    const stays = await ctx.db
      .query("stays")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    const now = Date.now();
    const isCurrentMonth = now >= start && now < end;
    const isPastMonth = now >= end;

    const stakePct = ownership.stakePct;
    const myObligation = rawMonthlyLease * stakePct;

    // Gross revenue accumulated so far (or full period if past).
    const grossToDate = isPastMonth
      ? engineOutput.totals.grossRevenue
      : computeGrossToDate(stays, args.propertyId, start, end, now);
    const myGrossToDate = grossToDate * stakePct;

    const myProjectedGross = isPastMonth
      ? myGrossToDate
      : projectLinear(myGrossToDate, start, end, now);

    if (myGrossToDate >= myObligation) {
      return {
        status: "covered" as const,
        month,
        obligation: myObligation,
        // Keep the response-shape keys the client already reads — they
        // now describe gross-vs-lease instead of payout-vs-lease.
        payoutToDate: myGrossToDate,
        projectedPayout: myProjectedGross,
        amountAhead: myGrossToDate - myObligation,
        coveredOn: estimateCoveredDateFromGross(
          stays,
          args.propertyId,
          start,
          end,
          stakePct,
          myObligation,
        ),
        stakePct,
        isCurrentMonth,
      };
    }

    if (myProjectedGross >= myObligation && isCurrentMonth) {
      return {
        status: "on_track" as const,
        month,
        obligation: myObligation,
        payoutToDate: myGrossToDate,
        projectedPayout: myProjectedGross,
        amountShortToDate: myObligation - myGrossToDate,
        projectedCoverDay: estimateProjectedCoverDay(
          myGrossToDate,
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
      payoutToDate: myGrossToDate,
      projectedPayout: myProjectedGross,
      projectedShortfall: myObligation - myProjectedGross,
      stakePct,
      isCurrentMonth,
    };
  },
});

/**
 * "Since you joined ChezSoiStays" mortgage/lease coverage track-record.
 *
 * Months covered run from the FIRST Hospitable stay on this property
 * through the LAST FULLY COMPLETED month (current month skipped — it's
 * still in progress and shown live on the meter above). No fixed
 * trailing-N window: the strip grows naturally with how long the
 * property has been on the platform, which is the story the owner is
 * looking at ("look, we covered rent every month we've worked together").
 *
 * Obligation per month = current raw monthly lease × stake. We do NOT
 * try to historicise the rent — what the owner cares about is the
 * apples-to-apples comparison "could the revenue we made then cover the
 * rent we owe now". Per-month payout = grossRevenue × stake (same
 * math as getOwnerMortgageCoverage + MortgageCoverageBar).
 *
 * If the property has no stays in Hospitable yet → empty months[]; the
 * client hides the strip.
 */
export const getOwnerCoverageHistory = query({
  args: {
    propertyId: v.id("properties"),
  },
  handler: async (ctx, args) => {
    const { ownership } = await assertOwnerOfProperty(ctx, args.propertyId);
    const stakePct = ownership.stakePct;

    const results: Array<{
      month: string;
      status: "covered" | "shortfall" | "no_obligation" | "engine_error";
      obligation: number;
      payout: number;
    }> = [];

    // Find the earliest non-cancelled stay on this property. That's
    // when the property effectively joined the platform.
    const allStays = await ctx.db
      .query("stays")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    const realStays = allStays.filter((s) => s.cancelledAt === undefined);
    if (realStays.length === 0) {
      return {
        months: results,
        firstActivityMonth: null as string | null,
        summary: {
          sampledMonths: 0,
          coveredCount: 0,
          avgPayout: 0,
          avgObligation: 0,
          avgBuffer: 0,
          streak: 0,
        },
        stakePct,
      };
    }
    const earliestCheckIn = realStays.reduce(
      (min, s) => Math.min(min, s.checkInAt),
      Infinity,
    );
    const firstActivityMonth = yyyyMm(earliestCheckIn);

    const rawMonthlyLease = await loadRawMonthlyLease(ctx, args.propertyId);
    const obligationPerMonth = rawMonthlyLease * stakePct;

    // Bucket non-cancelled stays into months. We only render months that
    // actually had ≥1 stay — gaps in the timeline aren't filled with
    // empty placeholders ("if there's no data, don't show the month").
    const monthGrossMap = new Map<string, number>();
    for (const s of realStays) {
      if (s.checkInAt >= startOfCurrentMonthMs()) continue; // skip current/future months
      const key = yyyyMm(s.checkInAt);
      monthGrossMap.set(key, (monthGrossMap.get(key) ?? 0) + (s.totalAmount ?? 0));
    }
    const monthsWithActivity = Array.from(monthGrossMap.keys()).sort(); // oldest → newest

    for (const m of monthsWithActivity) {
      const monthGross = monthGrossMap.get(m) ?? 0;
      const payout = monthGross * stakePct;

      if (obligationPerMonth === 0) {
        results.push({ month: m, status: "no_obligation", obligation: 0, payout });
      } else {
        results.push({
          month: m,
          status: payout >= obligationPerMonth ? "covered" : "shortfall",
          obligation: obligationPerMonth,
          payout,
        });
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
      // First month with any real activity — used by the per-property
      // month picker to clamp `←` so users can't page back into months
      // that pre-date the property's presence on the platform.
      firstActivityMonth,
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
 * Sum of `bucket="lease"` cost items that are currently active for the
 * property — the SAME number the dashboard mortgage mini-bar and the
 * summary-card indicator use (it's also what the Operational Costs
 * ledger shows). Drives the obligation displayed to the owner so the
 * detail page can't drift away from the rest of the surface.
 */
async function loadRawMonthlyLease(
  ctx: QueryCtx,
  propertyId: Id<"properties">,
): Promise<number> {
  const [items, cats] = await Promise.all([
    ctx.db
      .query("propertyCostItems")
      .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
      .collect(),
    ctx.db.query("costCategories").collect(),
  ]);
  const leaseCatIds = new Set(
    cats.filter((c) => c.bucket === "lease").map((c) => c._id),
  );
  return items
    .filter((i) => i.isActive && leaseCatIds.has(i.categoryId))
    .reduce((s, i) => s + (i.amount ?? 0), 0);
}

/**
 * Gross revenue accrued so far in the period — sum of stays with
 * checkInAt in [periodStart, now], excluding cancellations. This is the
 * "first dollar of revenue" the mortgage-cover surface measures against.
 */
function computeGrossToDate(
  stays: Doc<"stays">[],
  propertyId: Id<"properties">,
  periodStart: number,
  periodEnd: number,
  now: number,
): number {
  return stays
    .filter(
      (s) =>
        s.propertyId === propertyId &&
        s.checkInAt >= periodStart &&
        s.checkInAt < periodEnd &&
        s.checkInAt <= now &&
        s.cancelledAt === undefined,
    )
    .reduce((sum, s) => sum + (s.totalAmount ?? 0), 0);
}

/**
 * Linear projection: at today's daily run-rate, what would `valueToDate`
 * be by end of period? Used to estimate end-of-month gross.
 */
function projectLinear(
  valueToDate: number,
  periodStart: number,
  periodEnd: number,
  now: number,
): number {
  const daysElapsed = Math.max(1, (now - periodStart) / 86400000);
  const totalDays = (periodEnd - periodStart) / 86400000;
  const dailyRate = valueToDate / daysElapsed;
  return dailyRate * totalDays;
}

/**
 * Walk stays in checkInAt order, accumulating gross × stake, find the
 * first stay whose cumulative gross crosses the obligation. Returns the
 * checkInAt timestamp of that stay (unix ms). Falls back to periodEnd-1
 * if the threshold is never crossed within the period.
 */
function estimateCoveredDateFromGross(
  stays: Doc<"stays">[],
  propertyId: Id<"properties">,
  periodStart: number,
  periodEnd: number,
  stakePct: number,
  myObligation: number,
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

  if (periodStays.length === 0) return periodEnd - 1;
  let cumGross = 0;
  for (const s of periodStays) {
    cumGross += s.totalAmount ?? 0;
    if (cumGross * stakePct >= myObligation) return s.checkInAt;
  }
  return periodEnd - 1;
}

function estimateProjectedCoverDay(
  valueToDate: number,
  myObligation: number,
  periodStart: number,
  now: number,
): number {
  if (valueToDate <= 0) return periodStart; // unknown
  const daysElapsed = Math.max(1, (now - periodStart) / 86400000);
  const dailyRate = valueToDate / daysElapsed;
  const daysToCover = myObligation / dailyRate;
  return periodStart + daysToCover * 86400000;
}

/**
 * DEBUG (internal): full engine breakdown for a property+month so we can
 * trace why ownerPayout collapses. Returns every cost item resolved
 * amount + bucket attribution + final totals.
 */
export const debugEngineBreakdown = internalQuery({
  args: { propertyId: v.id("properties"), month: v.string() },
  handler: async (ctx, args) => {
    const { start, end } = monthRange(args.month);
    const inputs = await loadEngineInputs(ctx, args.propertyId, start, end);
    let out;
    try {
      out = computeStatementForPeriod(inputs);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e), inputs: summarizeInputs(inputs) };
    }
    return {
      totals: out.totals,
      feeConfigSnapshot: out.feeConfigSnapshot,
      sourceRefs: out.sourceRefs,
      inputsSummary: summarizeInputs(inputs),
    };
  },
});

function summarizeInputs(inputs: FeeEngineInputs) {
  return {
    staysCount: inputs.stays.length,
    staysInPeriod: inputs.stays.filter(
      (s) => s.checkInAt >= inputs.periodStart && s.checkInAt < inputs.periodEnd,
    ).length,
    costItemsCount: inputs.costItems.filter((c) => c.isActive).length,
    feeConfigsCount: inputs.feeConfigs.length,
    ownersCount: inputs.owners.length,
    manualAdjCount: inputs.manualAdjustments.filter(
      (a) => a.propertyId === inputs.propertyId,
    ).length,
    monthlySettings: inputs.monthlySettings.filter(
      (s) => s.month === yyyyMm(inputs.periodStart),
    ),
  };
}

function yyyyMm(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1).toString().padStart(2, "0")}`;
}

/** First-of-current-month at UTC midnight. Acts as the exclusive upper
 *  bound when listing "completed" months (current month is still live). */
function startOfCurrentMonthMs(): number {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

// `monthKeysBetween` was retired alongside the change that made
// getOwnerCoverageHistory bucket stays directly into months it actually
// has data for, rather than walking every month from earliest-stay to
// today and filling gaps with empty placeholders. No callers remain.
