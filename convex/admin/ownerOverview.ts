// Admin Owner Overview — Phase 1 (schema + queries + upsertDraft).
//
// Surface plan (see Docs/2026-05-25-admin-owner-overview-plan.md):
//   - listOwners()                            → index page rows
//   - getOwnerDashboard({ ownerUserId })      → cross-property summary
//   - getPropertyPreview({ ownerUserId, propertyId, period })
//       → both the owner-shaped preview (engine output after overrides)
//         AND the raw editor data (all stays/costs incl. excluded, status,
//         audit trail) in a single payload
//   - upsertDraft({ propertyId, period, patch })   → idempotent draft writer
//
// All endpoints are admin-only via `requireRole(["admin", "property_ops"])`.
// Owner-side surfaces are unchanged.

import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { requireRole } from "../lib/auth";
import { loadEngineInputs } from "../owner/engineInputs";
import {
  computeStatementForPeriod,
  monthRange,
  type FeeEngineOutput,
} from "../owner/feeEngine";
import { notifyStatementIssued } from "../owner/notify";

// ─── Helpers ────────────────────────────────────────────────────────────────

async function loadActiveOwnerships(
  ctx: QueryCtx,
): Promise<Doc<"propertyOwners">[]> {
  const all = await ctx.db.query("propertyOwners").collect();
  return all.filter((o) => o.effectiveTo === undefined);
}

/** Find the draft for (property, period), or null. At most one draft per pair. */
async function findDraft(
  ctx: QueryCtx | MutationCtx,
  propertyId: Id<"properties">,
  periodStart: number,
): Promise<Doc<"ownerStatements"> | null> {
  const rows = await ctx.db
    .query("ownerStatements")
    .withIndex("by_property_and_period", (q) =>
      q.eq("propertyId", propertyId).eq("periodStart", periodStart),
    )
    .collect();
  return rows.find((s) => s.status === "draft") ?? null;
}

function isActivePlatformClaim(
  platformClaim: Doc<"incidents">["platformClaim"],
): boolean {
  const state = platformClaim?.claimFollowUpState ?? "not_started";
  return state !== "approved" && state !== "denied" && state !== "closed";
}

async function loadPlatformClaimIncidents(
  ctx: QueryCtx,
  propertyIds: Id<"properties">[],
): Promise<Array<{
  _id: Id<"incidents">;
  title: string;
  status: Doc<"incidents">["status"];
  severity: Doc<"incidents">["severity"];
  createdAt: number;
  propertyId: Id<"properties">;
  propertyName: string;
  platformClaim: NonNullable<Doc<"incidents">["platformClaim"]>;
}>> {
  const rows: Array<{
    _id: Id<"incidents">;
    title: string;
    status: Doc<"incidents">["status"];
    severity: Doc<"incidents">["severity"];
    createdAt: number;
    propertyId: Id<"properties">;
    propertyName: string;
    platformClaim: NonNullable<Doc<"incidents">["platformClaim"]>;
  }> = [];

  for (const propertyId of propertyIds) {
    const [property, incidents] = await Promise.all([
      ctx.db.get(propertyId),
      ctx.db
        .query("incidents")
        .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
        .collect(),
    ]);

    for (const incident of incidents) {
      if (!incident.platformClaim) continue;
      rows.push({
        _id: incident._id,
        title: incident.title,
        status: incident.status,
        severity: incident.severity,
        createdAt: incident.createdAt,
        propertyId,
        propertyName: property?.name ?? "(unknown property)",
        platformClaim: incident.platformClaim,
      });
    }
  }

  rows.sort((a, b) => {
    const aDue = a.platformClaim.claimFollowUpDueAt ?? Number.MAX_SAFE_INTEGER;
    const bDue = b.platformClaim.claimFollowUpDueAt ?? Number.MAX_SAFE_INTEGER;
    if (aDue !== bDue) return aDue - bDue;
    return b.createdAt - a.createdAt;
  });

  return rows;
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Index page: one row per owner-user, with summary counters across all the
 * properties they hold an active stake in.
 */
export const listOwners = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin", "property_ops"]);

    const active = await loadActiveOwnerships(ctx);
    const byUser = new Map<Id<"users">, Doc<"propertyOwners">[]>();
    for (const o of active) {
      const list = byUser.get(o.userId) ?? [];
      list.push(o);
      byUser.set(o.userId, list);
    }

    const rows: Array<{
      userId: Id<"users">;
      name: string;
      email: string | undefined;
      propertyCount: number;
      lastStatement: {
        propertyName: string;
        periodStart: number;
        status: Doc<"ownerStatements">["status"];
      } | null;
      draftsPending: number;
      activePlatformClaims: number;
    }> = [];

    for (const [userId, ownerships] of byUser.entries()) {
      const user = await ctx.db.get(userId);
      if (!user) continue;

      const propertyIds = ownerships.map((o) => o.propertyId);
      let lastStatement: { propertyName: string; periodStart: number; status: Doc<"ownerStatements">["status"] } | null = null;
      let draftsPending = 0;
      for (const pid of propertyIds) {
        const sts = await ctx.db
          .query("ownerStatements")
          .withIndex("by_property", (q) => q.eq("propertyId", pid))
          .collect();
        for (const s of sts) {
          if (s.status === "draft" || s.status === "ready") draftsPending += 1;
          if (s.status === "issued" || s.status === "sent") {
            if (!lastStatement || s.periodStart > lastStatement.periodStart) {
              const prop = await ctx.db.get(pid);
              lastStatement = {
                propertyName: prop?.name ?? "(unknown property)",
                periodStart: s.periodStart,
                status: s.status,
              };
            }
          }
        }
      }
      const platformClaims = await loadPlatformClaimIncidents(ctx, propertyIds);

      rows.push({
        userId,
        name: user.name ?? user.email ?? "(unnamed owner)",
        email: user.email,
        propertyCount: ownerships.length,
        lastStatement,
        draftsPending,
        activePlatformClaims: platformClaims.filter((claim) =>
          isActivePlatformClaim(claim.platformClaim),
        ).length,
      });
    }

    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  },
});

/**
 * Per-owner dashboard: cross-property summary + statements list.
 */
export const getOwnerDashboard = query({
  args: { ownerUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "property_ops"]);

    const user = await ctx.db.get(args.ownerUserId);
    if (!user) throw new ConvexError(`User ${args.ownerUserId} not found`);

    const all = await ctx.db.query("propertyOwners").collect();
    const ownerships = all.filter(
      (o) => o.userId === args.ownerUserId && o.effectiveTo === undefined,
    );

    const properties = await Promise.all(
      ownerships.map(async (o) => {
        const p = await ctx.db.get(o.propertyId);
        return p ? { property: p, ownership: o } : null;
      }),
    );

    const statements: Doc<"ownerStatements">[] = [];
    for (const o of ownerships) {
      const sts = await ctx.db
        .query("ownerStatements")
        .withIndex("by_property", (q) => q.eq("propertyId", o.propertyId))
        .collect();
      statements.push(...sts);
    }
    statements.sort((a, b) => b.periodStart - a.periodStart);
    const platformClaims = await loadPlatformClaimIncidents(
      ctx,
      ownerships.map((o) => o.propertyId),
    );

    return {
      user: {
        _id: user._id,
        name: user.name ?? user.email ?? "(unnamed owner)",
        email: user.email,
      },
      properties: properties.filter((x): x is NonNullable<typeof x> => x !== null),
      statements,
      platformClaims,
    };
  },
});

/**
 * Per-property preview for one (owner, property, period). Returns the
 * engine output (for the LEFT column — what the owner sees) AND the raw
 * editor data (for the RIGHT column — every stay and cost incl. excluded,
 * current overrides, draft status, audit trail).
 *
 * If a draft exists for the period, its excludedStayIds + excludedCostItemIds
 * + costBucketOverrides are applied before the engine runs.
 */
export const getPropertyPreview = query({
  args: {
    ownerUserId: v.id("users"),
    propertyId: v.id("properties"),
    period: v.string(), // "YYYY-MM"
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "property_ops"]);

    const { start, end } = monthRange(args.period);

    // Verify the owner has an active stake on this property (not strictly
    // required for an admin caller, but it catches mis-routed URLs).
    const ownership = await ctx.db
      .query("propertyOwners")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    const activeForOwner = ownership.find(
      (o) => o.userId === args.ownerUserId && o.effectiveTo === undefined,
    );
    if (!activeForOwner) {
      throw new ConvexError(
        `User ${args.ownerUserId} has no active stake on property ${args.propertyId}`,
      );
    }

    const property = await ctx.db.get(args.propertyId);
    if (!property) throw new ConvexError(`Property ${args.propertyId} not found`);

    const draft = await findDraft(ctx, args.propertyId, start);
    const excludedStayIds = new Set<string>(draft?.excludedStayIds ?? []);
    const excludedCostItemIds = new Set<string>(draft?.excludedCostItemIds ?? []);
    const bucketOverrides = new Map<string, string>(
      (draft?.costBucketOverrides ?? []).map((b) => [b.costItemId, b.bucket]),
    );

    const rawInputs = await loadEngineInputs(ctx, args.propertyId, start, end);

    // Apply admin overrides to the engine inputs (drift mitigation).
    const filteredInputs = applyAdminOverrides(rawInputs, {
      excludedStayIds,
      excludedCostItemIds,
      bucketOverrides,
    });

    let preview: FeeEngineOutput | null = null;
    try {
      preview = computeStatementForPeriod(filteredInputs);
    } catch {
      // Engine throws on missing fee config etc. — return null so UI can
      // render an empty-state instead of a 500.
      preview = null;
    }

    // Editor view needs full Doc shape (engine type is narrowed).
    const [fullStays, fullCostItems, costCategoriesFull] = await Promise.all([
      ctx.db
        .query("stays")
        .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
        .collect(),
      ctx.db
        .query("propertyCostItems")
        .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
        .collect(),
      ctx.db.query("costCategories").collect(),
    ]);
    const catById = new Map(costCategoriesFull.map((c) => [c._id, c.bucket]));

    return {
      period: args.period,
      periodStart: start,
      periodEnd: end,
      property: {
        _id: property._id,
        name: property.name,
        currency: property.currency,
      },
      ownerUserId: args.ownerUserId,
      preview,
      draft,
      editor: {
        stays: fullStays
          .filter((s) => s.checkInAt < end && s.checkOutAt > start)
          .map((s) => ({
            _id: s._id,
            guestName: s.guestName,
            checkInAt: s.checkInAt,
            checkOutAt: s.checkOutAt,
            grossAmount: s.totalAmount ?? 0,
            cancelledAt: s.cancelledAt,
            excluded: excludedStayIds.has(s._id),
          })),
        costItems: fullCostItems
          .filter((c) => c.isActive)
          .map((c) => ({
            _id: c._id,
            name: c.name,
            amount: c.amount,
            frequency: c.frequency,
            categoryId: c.categoryId,
            bucket: bucketOverrides.get(c._id) ?? catById.get(c.categoryId),
            excluded: excludedCostItemIds.has(c._id),
            overriddenBucket: bucketOverrides.get(c._id) ?? null,
          })),
        notes: draft?.notes ?? "",
        overrides: draft?.overrides ?? {},
        status: draft?.status ?? null,
        auditTrail: draft?.auditTrail ?? [],
      },
    };
  },
});

/** Apply admin draft overrides (exclusions + bucket re-pointing) to a
 *  FeeEngineInputs payload. Returns a new object — does not mutate. */
function applyAdminOverrides(
  inputs: Awaited<ReturnType<typeof loadEngineInputs>>,
  o: {
    excludedStayIds: Set<string>;
    excludedCostItemIds: Set<string>;
    bucketOverrides: Map<string, string>;
  },
): Awaited<ReturnType<typeof loadEngineInputs>> {
  return {
    ...inputs,
    stays: inputs.stays.filter((s) => !o.excludedStayIds.has(s._id)),
    costItems: inputs.costItems
      .filter((c) => !o.excludedCostItemIds.has(c._id))
      .map((c) => {
        const overrideBucket = o.bucketOverrides.get(c._id);
        if (!overrideBucket) return c;
        const cat = inputs.costCategories.find((cc) => cc.bucket === overrideBucket);
        if (!cat) return c;
        return { ...c, categoryId: cat._id };
      }),
  };
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Upsert a DRAFT statement for (propertyId, period). Idempotent — creates
 * the row on first call, patches on subsequent calls. Re-computes the engine
 * snapshot every call so the draft's snapshotTotals stay consistent with the
 * current inputs + overrides.
 *
 * Throws if the period already has a non-draft statement (issued/sent/recalled).
 */
export const upsertDraft = mutation({
  args: {
    propertyId: v.id("properties"),
    period: v.string(), // "YYYY-MM"
    patch: v.object({
      overrides: v.optional(v.object({
        show_mortgage: v.optional(v.boolean()),
        show_mgmt_fee: v.optional(v.boolean()),
        show_payout: v.optional(v.boolean()),
        show_cost_line_items: v.optional(v.boolean()),
      })),
      excludedStayIds: v.optional(v.array(v.id("stays"))),
      excludedCostItemIds: v.optional(v.array(v.id("propertyCostItems"))),
      costBucketOverrides: v.optional(v.array(v.object({
        costItemId: v.id("propertyCostItems"),
        bucket: v.string(),
      }))),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const caller = await requireRole(ctx, ["admin", "property_ops"]);
    const { start, end } = monthRange(args.period);

    // Block if any non-draft statement already exists for the period.
    const existing = await ctx.db
      .query("ownerStatements")
      .withIndex("by_property_and_period", (q) =>
        q.eq("propertyId", args.propertyId).eq("periodStart", start),
      )
      .collect();
    const locked = existing.find((s) => s.status !== "draft" && s.status !== "recalled");
    if (locked) {
      throw new ConvexError(
        `Cannot edit draft: ${args.period} already ${locked.status} (id=${locked._id})`,
      );
    }
    const draft = existing.find((s) => s.status === "draft");

    const now = Date.now();

    // Re-compute snapshot with the new overrides applied.
    const excludedStayIds = new Set<string>(args.patch.excludedStayIds ?? draft?.excludedStayIds ?? []);
    const excludedCostItemIds = new Set<string>(args.patch.excludedCostItemIds ?? draft?.excludedCostItemIds ?? []);
    const bucketOverrides = new Map<string, string>(
      (args.patch.costBucketOverrides ?? draft?.costBucketOverrides ?? []).map((b) => [b.costItemId, b.bucket]),
    );

    const rawInputs = await loadEngineInputs(ctx, args.propertyId, start, end);
    const filteredInputs = applyAdminOverrides(rawInputs, {
      excludedStayIds,
      excludedCostItemIds,
      bucketOverrides,
    });

    const output = computeStatementForPeriod(filteredInputs);

    const auditEntry = {
      at: now,
      actorUserId: caller._id,
      action: draft ? "draft_updated" : "draft_created",
    };

    const patchPayload = {
      overrides: args.patch.overrides ?? draft?.overrides,
      excludedStayIds: args.patch.excludedStayIds ?? draft?.excludedStayIds,
      excludedCostItemIds: args.patch.excludedCostItemIds ?? draft?.excludedCostItemIds,
      costBucketOverrides: args.patch.costBucketOverrides ?? draft?.costBucketOverrides,
      notes: args.patch.notes ?? draft?.notes,
      snapshotTotals: output.totals,
      feeConfigSnapshot: output.feeConfigSnapshot,
      sourceRefs: output.sourceRefs,
      auditTrail: [...(draft?.auditTrail ?? []), auditEntry],
      updatedAt: now,
    };

    if (draft) {
      await ctx.db.patch(draft._id, patchPayload);
      return { statementId: draft._id, created: false };
    }

    const id = await ctx.db.insert("ownerStatements", {
      propertyId: args.propertyId,
      periodStart: start,
      periodEnd: end,
      status: "draft",
      snapshotTotals: output.totals,
      feeConfigSnapshot: output.feeConfigSnapshot,
      sourceRefs: output.sourceRefs,
      overrides: args.patch.overrides,
      excludedStayIds: args.patch.excludedStayIds ?? [],
      excludedCostItemIds: args.patch.excludedCostItemIds ?? [],
      costBucketOverrides: args.patch.costBucketOverrides ?? [],
      notes: args.patch.notes,
      auditTrail: [auditEntry],
      createdAt: now,
    });
    return { statementId: id, created: true };
  },
});

/**
 * Promote a draft → ready. No data change; just gates the Issue button.
 */
export const markReady = mutation({
  args: { statementId: v.id("ownerStatements") },
  handler: async (ctx, args) => {
    const caller = await requireRole(ctx, ["admin", "property_ops"]);
    const s = await ctx.db.get(args.statementId);
    if (!s) throw new ConvexError("Statement not found");
    if (s.status !== "draft") {
      throw new ConvexError(`Cannot mark ready: status=${s.status}`);
    }
    const now = Date.now();
    await ctx.db.patch(args.statementId, {
      status: "ready",
      auditTrail: [
        ...(s.auditTrail ?? []),
        { at: now, actorUserId: caller._id, action: "marked_ready" },
      ],
      updatedAt: now,
    });
    return { statementId: args.statementId };
  },
});

/**
 * Issue a draft/ready statement. Re-computes the snapshot inside the
 * mutation transaction (TOCTOU safety), flips status → "issued", schedules
 * PDF render + notifies owners. Matches `owner.mutations.issueOwnerStatement`
 * behavior but works on an existing draft row with all admin overrides
 * applied (plan §"Phase 4").
 */
export const issueStatement = mutation({
  args: { statementId: v.id("ownerStatements") },
  handler: async (ctx, args) => {
    const caller = await requireRole(ctx, ["admin", "property_ops"]);
    const s = await ctx.db.get(args.statementId);
    if (!s) throw new ConvexError("Statement not found");
    if (s.status !== "draft" && s.status !== "ready") {
      throw new ConvexError(`Cannot issue: status=${s.status}`);
    }

    // Re-compute snapshot at click-time with current overrides applied.
    const excludedStayIds = new Set<string>(s.excludedStayIds ?? []);
    const excludedCostItemIds = new Set<string>(s.excludedCostItemIds ?? []);
    const bucketOverrides = new Map<string, string>(
      (s.costBucketOverrides ?? []).map((b) => [b.costItemId, b.bucket]),
    );
    const rawInputs = await loadEngineInputs(
      ctx,
      s.propertyId,
      s.periodStart,
      s.periodEnd,
    );
    const filtered = applyAdminOverrides(rawInputs, {
      excludedStayIds,
      excludedCostItemIds,
      bucketOverrides,
    });
    const output = computeStatementForPeriod(filtered);

    const now = Date.now();
    await ctx.db.patch(args.statementId, {
      status: "issued",
      snapshotTotals: output.totals,
      feeConfigSnapshot: output.feeConfigSnapshot,
      sourceRefs: output.sourceRefs,
      issuedAt: now,
      issuedBy: caller._id,
      auditTrail: [
        ...(s.auditTrail ?? []),
        { at: now, actorUserId: caller._id, action: "issued" },
      ],
      updatedAt: now,
    });

    // Fire-and-forget PDF render (Wave 3b pipeline).
    await ctx.scheduler.runAfter(
      0,
      internal.owner.pdf.renderOwnerStatementPdf,
      { statementId: args.statementId },
    );

    // Notify all active owners (Wave 3c).
    const property = await ctx.db.get(s.propertyId);
    const month = formatMonthKey(s.periodStart);
    await notifyStatementIssued(ctx, {
      statementId: args.statementId,
      propertyId: s.propertyId,
      month,
      propertyName: property?.name ?? "your property",
      ownerPayout: output.totals.ownerPayout,
      currency: property?.currency ?? "USD",
    });

    return { statementId: args.statementId };
  },
});

function formatMonthKey(periodStart: number): string {
  const d = new Date(periodStart);
  return `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}`;
}

/**
 * Recall an issued/sent statement. Flips status → "recalled". The PDF
 * artifact is retained (immutable history per plan §"Open questions");
 * a follow-up draft can be created via upsertDraft for the same period.
 */
export const recallStatement = mutation({
  args: {
    statementId: v.id("ownerStatements"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const caller = await requireRole(ctx, ["admin", "property_ops"]);
    const s = await ctx.db.get(args.statementId);
    if (!s) throw new ConvexError("Statement not found");
    if (s.status !== "issued" && s.status !== "sent") {
      throw new ConvexError(`Cannot recall: status=${s.status}`);
    }
    if (!args.reason.trim()) {
      throw new ConvexError("Recall requires a non-empty reason");
    }
    const now = Date.now();
    await ctx.db.patch(args.statementId, {
      status: "recalled",
      auditTrail: [
        ...(s.auditTrail ?? []),
        {
          at: now,
          actorUserId: caller._id,
          action: "recalled",
          note: args.reason.slice(0, 500),
        },
      ],
      updatedAt: now,
    });
    return { statementId: args.statementId };
  },
});

// ─── Auto-create monthly drafts (cron-driven) ──────────────────────────────

/**
 * Internal mutation called on the 1st of each month. For every (active
 * owner, property) pair, upsert a DRAFT statement for the previous month
 * if one does not already exist. Pre-populates with no exclusions / no
 * overrides — admins still have to explicitly issue.
 *
 * Default-OFF behind a feature flag per plan §"Auto-create cron".
 * Toggle via `adminFeatureFlags.owner_overview_auto_drafts = true`.
 */
export const autoCreateMonthlyDrafts = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Feature-flag gate — default OFF so the cron is inert until the user
    // flips the flag in Settings. The featureFlags table already exists.
    const flagRow = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) =>
        q.eq("key", "owner_overview_auto_drafts"),
      )
      .first();
    if (!flagRow || !flagRow.enabled) {
      return { skipped: "flag_off" as const };
    }

    // Previous calendar month, UTC.
    const now = new Date();
    const prevMonthDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );
    const periodStart = prevMonthDate.getTime();
    const periodEnd = Date.UTC(
      prevMonthDate.getUTCFullYear(),
      prevMonthDate.getUTCMonth() + 1,
      1,
    );

    const ownerships = await loadActiveOwnerships(ctx);
    const propertyIds = new Set(ownerships.map((o) => o.propertyId));

    let created = 0;
    let skipped = 0;
    for (const propertyId of propertyIds) {
      const existing = await ctx.db
        .query("ownerStatements")
        .withIndex("by_property_and_period", (q) =>
          q.eq("propertyId", propertyId).eq("periodStart", periodStart),
        )
        .collect();
      if (existing.length > 0) {
        skipped += 1;
        continue;
      }
      try {
        const rawInputs = await loadEngineInputs(
          ctx,
          propertyId,
          periodStart,
          periodEnd,
        );
        const output = computeStatementForPeriod(rawInputs);
        const auditEntry = {
          at: Date.now(),
          // Cron-created drafts have no human actor — attribute to a
          // synthetic ID by reusing the first owner of the property as
          // placeholder so the auditTrail.actorUserId field stays a valid
          // user id. The "action" string makes intent clear.
          actorUserId: ownerships.find((o) => o.propertyId === propertyId)!
            .userId,
          action: "draft_created_by_cron",
        };
        await ctx.db.insert("ownerStatements", {
          propertyId,
          periodStart,
          periodEnd,
          status: "draft",
          snapshotTotals: output.totals,
          feeConfigSnapshot: output.feeConfigSnapshot,
          sourceRefs: output.sourceRefs,
          excludedStayIds: [],
          excludedCostItemIds: [],
          costBucketOverrides: [],
          auditTrail: [auditEntry],
          createdAt: Date.now(),
        });
        created += 1;
      } catch (err) {
        // Engine threw (e.g. missing fee config) — skip and continue
        // sweeping. Admin will see "no draft" + can manually upsertDraft.
        skipped += 1;
        console.warn(
          `autoCreateMonthlyDrafts: skipped ${propertyId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return { created, skipped, period: formatMonthKey(periodStart) };
  },
});
