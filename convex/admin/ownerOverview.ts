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
import type { Doc, Id } from "../_generated/dataModel";
import {
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

      rows.push({
        userId,
        name: user.name ?? user.email ?? "(unnamed owner)",
        email: user.email,
        propertyCount: ownerships.length,
        lastStatement,
        draftsPending,
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

    return {
      user: {
        _id: user._id,
        name: user.name ?? user.email ?? "(unnamed owner)",
        email: user.email,
      },
      properties: properties.filter((x): x is NonNullable<typeof x> => x !== null),
      statements,
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
