// Owner-portal mutations. Every mutation MUST go through the auth helpers in
// ./auth.ts. Centralized in this single file so the "ownerStatements writers
// are only here" lint rule is easy to enforce (per spec §5.2).

import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "../_generated/server";
import { requireRole } from "../lib/auth";
import { firstEffectiveFromMs } from "../lib/effectiveFrom";
import { assertOwnerOfProperty, requireOwnerUser } from "./auth";
import { BUCKETS, isBucket } from "./constants";
import { loadEngineInputs } from "./engineInputs";
import { computeStatementForPeriod, monthRange } from "./feeEngine";
import {
  notifyApprovalDecided,
  notifyApprovalRequest,
  notifyStatementIssued,
} from "./notify";

/** Throws if statement is already issued. Use before EVERY write to ownerStatements. */
async function assertStatementMutable(
  ctx: MutationCtx,
  statementId: Id<"ownerStatements">,
): Promise<Doc<"ownerStatements">> {
  const s = await ctx.db.get(statementId);
  if (!s) throw new ConvexError("Statement not found");
  if (s.status === "issued") {
    throw new ConvexError(
      `Statement ${statementId} is issued — immutable. Create a manualAdjustment on the next open period instead.`,
    );
  }
  return s;
}

// ─── Admin/ops mutations (setup) ────────────────────────────────────────────

/** Earliest non-cancelled check-in on the property, or null if no stays. */
async function earliestCheckInMs(
  ctx: MutationCtx,
  propertyId: Id<"properties">,
): Promise<number | null> {
  const stays = await ctx.db
    .query("stays")
    .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
    .collect();
  const earliest = stays
    .filter((s) => s.cancelledAt === undefined)
    .reduce((min, s) => Math.min(min, s.checkInAt), Infinity);
  return Number.isFinite(earliest) ? earliest : null;
}

/**
 * Append-only fee-config upsert: close current row (set effectiveTo=now),
 * insert new row with effectiveFrom=now. Time-versioned per spec §5.2.
 * Caller must be admin or property_ops (ops sets the contract).
 */
export const upsertPropertyFeeConfig = mutation({
  args: {
    propertyId: v.id("properties"),
    feePct: v.number(),
    feeBase: v.union(
      v.literal("grossRevenue"),
      v.literal("netRevenue"),
      v.literal("netOperatingProfit"),
    ),
    approvalThreshold: v.number(),
    autoApproveAfterDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const caller = await requireRole(ctx, ["admin", "property_ops"]);
    if (args.feePct < 0 || args.feePct > 1) {
      throw new ConvexError(`feePct must be 0..1; got ${args.feePct}`);
    }
    if (args.approvalThreshold < 0) {
      throw new ConvexError("approvalThreshold must be >= 0");
    }
    const now = Date.now();
    const open = await ctx.db
      .query("propertyFeeConfig")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    for (const row of open) {
      if (row.effectiveTo === undefined) {
        await ctx.db.patch(row._id, { effectiveTo: now });
      }
    }
    // First-ever config on this property → backdate to first activity so
    // pre-onboarding months compute (see Docs/2026-07-04-fix-owner-statement-draft-crash.md).
    // Any later config change keeps append-only effectiveFrom=now.
    const effectiveFrom =
      open.length === 0
        ? firstEffectiveFromMs(await earliestCheckInMs(ctx, args.propertyId), now)
        : now;
    const newId = await ctx.db.insert("propertyFeeConfig", {
      propertyId: args.propertyId,
      feePct: args.feePct,
      feeBase: args.feeBase,
      approvalThreshold: args.approvalThreshold,
      autoApproveAfterDays: args.autoApproveAfterDays,
      effectiveFrom,
      createdBy: caller._id,
      createdAt: now,
    });
    return { feeConfigId: newId };
  },
});

/**
 * Upsert ownership for a property. Enforces stakePct sum = 1.0 atomically:
 * the caller passes the FULL active set; previous active rows get closed
 * (effectiveTo=now), new ones inserted. Exactly one row may have
 * isPrimaryApprover: true.
 */
export const upsertPropertyOwners = mutation({
  args: {
    propertyId: v.id("properties"),
    owners: v.array(
      v.object({
        userId: v.id("users"),
        stakePct: v.number(),
        role: v.union(v.literal("landlord"), v.literal("investor")),
        isPrimaryApprover: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "property_ops"]);
    if (args.owners.length === 0) {
      throw new ConvexError("Cannot set empty owner list");
    }
    const sum = args.owners.reduce((s, o) => s + o.stakePct, 0);
    if (Math.abs(sum - 1.0) > 0.0001) {
      throw new ConvexError(`stakePct must sum to 1.0; got ${sum}`);
    }
    const primaries = args.owners.filter((o) => o.isPrimaryApprover).length;
    if (primaries !== 1) {
      throw new ConvexError(`Exactly one isPrimaryApprover required; got ${primaries}`);
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("propertyOwners")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    for (const row of existing) {
      if (row.effectiveTo === undefined) {
        await ctx.db.patch(row._id, { effectiveTo: now, updatedAt: now });
      }
    }
    // Mirror upsertPropertyFeeConfig: first-ever ownership rows backdate to
    // first activity so pickOwnersForPeriod finds them in historical months.
    const effectiveFrom =
      existing.length === 0
        ? firstEffectiveFromMs(await earliestCheckInMs(ctx, args.propertyId), now)
        : now;
    const insertedIds: Id<"propertyOwners">[] = [];
    for (const o of args.owners) {
      const id = await ctx.db.insert("propertyOwners", {
        propertyId: args.propertyId,
        userId: o.userId,
        stakePct: o.stakePct,
        role: o.role,
        isPrimaryApprover: o.isPrimaryApprover,
        effectiveFrom,
        createdAt: now,
      });
      insertedIds.push(id);
    }
    return { ownerIds: insertedIds };
  },
});

// ─── Statement issuance ─────────────────────────────────────────────────────

/**
 * Issue a statement for (propertyId, month). Re-runs the fee engine INSIDE
 * the mutation transaction so the snapshot reflects state at click-time
 * (TOCTOU safety). Schedules `renderOwnerStatementPdf` action separately —
 * pdfStorageId stays undefined until that lands (frontend shows "generating").
 *
 * Spec §5.3.
 */
export const issueOwnerStatement = mutation({
  args: {
    propertyId: v.id("properties"),
    month: v.string(), // "YYYY-MM"
  },
  handler: async (ctx, args) => {
    const caller = await requireRole(ctx, ["admin", "property_ops"]);
    const { start, end } = monthRange(args.month);

    // Prevent duplicate issuance: one issued row per (property, period)
    const existing = await ctx.db
      .query("ownerStatements")
      .withIndex("by_property_and_period", (q) =>
        q.eq("propertyId", args.propertyId).eq("periodStart", start),
      )
      .collect();
    const issuedDuplicate = existing.find((s) => s.status === "issued");
    if (issuedDuplicate) {
      throw new ConvexError(
        `Statement for ${args.month} already issued (id=${issuedDuplicate._id})`,
      );
    }

    const inputs = await loadEngineInputs(ctx, args.propertyId, start, end);
    const output = computeStatementForPeriod(inputs);

    const now = Date.now();
    const id = await ctx.db.insert("ownerStatements", {
      propertyId: args.propertyId,
      periodStart: start,
      periodEnd: end,
      status: "issued",
      snapshotTotals: output.totals,
      feeConfigSnapshot: output.feeConfigSnapshot,
      sourceRefs: output.sourceRefs,
      issuedAt: now,
      issuedBy: caller._id,
      // pdfStorageId + pdfTemplateVersion populated by the action below.
      // Frontend shows "generating PDF…" until pdfStorageId lands.
      createdAt: now,
    });

    // Fire-and-forget PDF render. Action runs in Node runtime (pdfkit isn't
    // isomorphic); on completion it patches pdfStorageId via
    // internal.owner.pdf.attachPdfToStatement.
    await ctx.scheduler.runAfter(0, internal.owner.pdf.renderOwnerStatementPdf, {
      statementId: id,
    });

    // Notify all active owners (Wave 3c)
    const property = await ctx.db.get(args.propertyId);
    await notifyStatementIssued(ctx, {
      statementId: id,
      propertyId: args.propertyId,
      month: args.month,
      propertyName: property?.name ?? "your property",
      ownerPayout: output.totals.ownerPayout,
      currency: property?.currency ?? "USD",
    });

    return { statementId: id };
  },
});

// ─── Auto-approve sweep (called by cron) ────────────────────────────────────

/**
 * Internal mutation called hourly by `convex/crons.ts`. Finds pending
 * maintenance-approval requests whose property's fee-config sets
 * `autoApproveAfterDays` AND whose age exceeds that threshold. Auto-approves
 * each by booking a cost item + flipping status to "auto_approved".
 */
export const sweepAutoApprovals = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const pending = await ctx.db
      .query("maintenanceApprovalRequests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    if (pending.length === 0) return { approved: 0, scanned: 0 };

    const byProperty = new Map<Id<"properties">, typeof pending>();
    for (const r of pending) {
      const list = byProperty.get(r.propertyId) ?? [];
      list.push(r);
      byProperty.set(r.propertyId, list);
    }

    const allCats = await ctx.db.query("costCategories").collect();
    const maintCat = allCats.find((c) => c.bucket === "maintenance");
    if (!maintCat) {
      return { approved: 0, scanned: pending.length, reason: "no_maintenance_category" };
    }

    let approved = 0;
    for (const [propertyId, requests] of byProperty.entries()) {
      const configs = await ctx.db
        .query("propertyFeeConfig")
        .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
        .collect();
      const active = configs.find((c) => c.effectiveTo === undefined);
      if (!active || active.autoApproveAfterDays === undefined) continue;
      const thresholdMs = active.autoApproveAfterDays * 24 * 60 * 60 * 1000;

      for (const req of requests) {
        if (now - req.createdAt < thresholdMs) continue;
        const ownership = await ctx.db.get(req.ownerId);
        const costItemId = await ctx.db.insert("propertyCostItems", {
          propertyId: req.propertyId,
          categoryId: maintCat._id,
          name: req.description.slice(0, 100),
          amount: req.proposedCost,
          frequency: "one_time",
          startDate: now,
          isActive: true,
          createdAt: now,
        });
        await ctx.db.patch(req._id, {
          status: "auto_approved",
          decidedAt: now,
          decidedBy: ownership?.userId,
          decidedNote: `Auto-approved after ${active.autoApproveAfterDays} days`,
          resultingCostItemId: costItemId,
          updatedAt: now,
        });
        approved += 1;
      }
    }
    return { approved, scanned: pending.length };
  },
});

// ─── Maintenance approval ───────────────────────────────────────────────────

/**
 * Ops creates a request when proposedCost ≥ approvalThreshold. Snapshot the
 * primary-approver ownerId at creation time so a later primary-approver
 * change doesn't strip authority from the request.
 */
export const createMaintenanceApprovalRequest = mutation({
  args: {
    propertyId: v.id("properties"),
    proposedCost: v.number(),
    description: v.string(),
    photoIds: v.optional(v.array(v.id("photos"))),
  },
  handler: async (ctx, args) => {
    const caller = await requireRole(ctx, ["admin", "property_ops"]);
    // Find the primary approver
    const ownerRows = await ctx.db
      .query("propertyOwners")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    const primary = ownerRows.find(
      (r) => r.effectiveTo === undefined && r.isPrimaryApprover,
    );
    if (!primary) {
      throw new ConvexError(
        `No active primary approver for property ${args.propertyId}.`,
      );
    }
    const now = Date.now();
    const id = await ctx.db.insert("maintenanceApprovalRequests", {
      propertyId: args.propertyId,
      ownerId: primary._id,
      proposedCost: args.proposedCost,
      description: args.description,
      photoIds: args.photoIds ?? [],
      requestedBy: caller._id,
      status: "pending",
      createdAt: now,
    });

    // Notify primary approver (Wave 3c)
    const property = await ctx.db.get(args.propertyId);
    await notifyApprovalRequest(ctx, {
      requestId: id,
      propertyId: args.propertyId,
      propertyName: property?.name ?? "your property",
      proposedCost: args.proposedCost,
      currency: property?.currency ?? "USD",
      description: args.description,
    });

    return { requestId: id };
  },
});

/**
 * Owner decides on a pending request. Books the cost as a propertyCostItem
 * iff approved. Snapshot-ownerId authority check.
 */
export const decideMaintenanceApprovalRequest = mutation({
  args: {
    requestId: v.id("maintenanceApprovalRequests"),
    decision: v.union(v.literal("approved"), v.literal("declined")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const req = await ctx.db.get(args.requestId);
    if (!req) throw new ConvexError("Request not found");
    if (req.status !== "pending") {
      throw new ConvexError(`Request already decided (status=${req.status})`);
    }
    const user = await requireOwnerUser(ctx);
    const ownership = await ctx.db.get(req.ownerId);
    if (!ownership) throw new ConvexError("Snapshot ownership row missing");
    if (ownership.userId !== user._id || !ownership.isPrimaryApprover) {
      throw new ConvexError(
        "Only the primary approver snapshotted on the request may decide it.",
      );
    }
    const now = Date.now();
    if (args.decision === "approved") {
      // Find or create a Maintenance category (bucket=maintenance) to host the cost.
      const allCats = await ctx.db.query("costCategories").collect();
      const maintCat = allCats.find((c) => c.bucket === "maintenance");
      if (!maintCat) {
        throw new ConvexError(
          'No costCategory with bucket="maintenance" exists. Backfill incomplete.',
        );
      }
      if (!isBucket("maintenance")) {
        // Defensive: BUCKETS list out of sync with code.
        throw new ConvexError(`"maintenance" not in BUCKETS: ${BUCKETS.join(",")}`);
      }
      const costItemId = await ctx.db.insert("propertyCostItems", {
        propertyId: req.propertyId,
        categoryId: maintCat._id,
        name: req.description.slice(0, 100),
        amount: req.proposedCost,
        frequency: "one_time",
        startDate: now,
        isActive: true,
        receiptStorageIds: undefined,
        createdAt: now,
      });
      await ctx.db.patch(args.requestId, {
        status: "approved",
        decidedAt: now,
        decidedBy: user._id,
        decidedNote: args.note,
        resultingCostItemId: costItemId,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(args.requestId, {
        status: "declined",
        decidedAt: now,
        decidedBy: user._id,
        decidedNote: args.note,
        updatedAt: now,
      });
    }

    // Notify co-owners (Wave 3c, spec §11) — audit-trail only, no push for them
    const property = await ctx.db.get(req.propertyId);
    await notifyApprovalDecided(ctx, {
      requestId: args.requestId,
      propertyId: req.propertyId,
      propertyName: property?.name ?? "your property",
      deciderUserId: user._id,
      decision: args.decision,
      proposedCost: req.proposedCost,
      currency: property?.currency ?? "USD",
    });

    return { decided: args.decision };
  },
});

// ─── Date blocks ────────────────────────────────────────────────────────────

/**
 * Owner blocks dates for personal use. TOCTOU-guarded — re-query stays for
 * overlap INSIDE the mutation transaction. Strict reject if any stay overlaps.
 */
export const createOwnerDateBlock = mutation({
  args: {
    propertyId: v.id("properties"),
    startDate: v.number(), // unix ms, inclusive
    endDate: v.number(),   // unix ms, exclusive
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { ownership } = await assertOwnerOfProperty(ctx, args.propertyId);
    if (args.endDate <= args.startDate) {
      throw new ConvexError("endDate must be > startDate");
    }

    // TOCTOU overlap check inside the transaction
    const stays = await ctx.db
      .query("stays")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    const overlapping = stays.filter((s) => {
      if (s.cancelledAt) return false;
      return s.checkInAt < args.endDate && s.checkOutAt > args.startDate;
    });
    if (overlapping.length > 0) {
      throw new ConvexError(
        `${overlapping.length} existing stay(s) overlap the requested block: ` +
          overlapping
            .map(
              (s) =>
                `${s.guestName} ${new Date(s.checkInAt).toISOString().slice(0, 10)}→${new Date(s.checkOutAt).toISOString().slice(0, 10)}`,
            )
            .join("; "),
      );
    }

    const id = await ctx.db.insert("ownerDateBlocks", {
      propertyId: args.propertyId,
      ownerId: ownership._id,
      startDate: args.startDate,
      endDate: args.endDate,
      note: args.note,
      createdAt: Date.now(),
    });
    return { blockId: id };
  },
});

// ─── Notification prefs ─────────────────────────────────────────────────────

export const upsertOwnerNotificationPref = mutation({
  args: {
    channel: v.union(v.literal("email"), v.literal("sms"), v.literal("push")),
    statementIssued: v.boolean(),
    approvalRequest: v.boolean(),
    incidentReport: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireOwnerUser(ctx);
    const existing = await ctx.db
      .query("ownerNotificationPrefs")
      .withIndex("by_user_and_channel", (q) =>
        q.eq("userId", user._id).eq("channel", args.channel),
      )
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        statementIssued: args.statementIssued,
        approvalRequest: args.approvalRequest,
        incidentReport: args.incidentReport,
        updatedAt: now,
      });
      return { prefId: existing._id };
    }
    const id = await ctx.db.insert("ownerNotificationPrefs", {
      userId: user._id,
      channel: args.channel,
      statementIssued: args.statementIssued,
      approvalRequest: args.approvalRequest,
      incidentReport: args.incidentReport,
      updatedAt: now,
    });
    return { prefId: id };
  },
});

// ─── Internal: re-export assertStatementMutable for future PDF / cron flows ─

export { assertStatementMutable };

// ─── Seed (internal — for dev/QA only) ──────────────────────────────────────

/**
 * Seed a fee-config + owner ownership for a property. Used to bootstrap
 * the first owner-portal demo (e.g. Randalls on a Dallas property). NOT
 * exposed publicly — invoke via `npx convex run` with admin key.
 */
/**
 * One-shot internal mutation to backdate the effectiveFrom on existing
 * propertyOwners + propertyFeeConfig rows for a property. Used when seed
 * data was inserted mid-period and you want the engine to see the rows
 * as active from the start of the period (so the live-draft works).
 */
export const backdateOwnerSeed = internalMutation({
  args: {
    propertyId: v.id("properties"),
    effectiveFrom: v.number(),
  },
  handler: async (ctx, args) => {
    const ownerRows = await ctx.db
      .query("propertyOwners")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    const configRows = await ctx.db
      .query("propertyFeeConfig")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    let touchedOwners = 0;
    let touchedConfigs = 0;
    for (const row of ownerRows) {
      if (row.effectiveTo === undefined) {
        await ctx.db.patch(row._id, { effectiveFrom: args.effectiveFrom });
        touchedOwners += 1;
      }
    }
    for (const row of configRows) {
      if (row.effectiveTo === undefined) {
        await ctx.db.patch(row._id, { effectiveFrom: args.effectiveFrom });
        touchedConfigs += 1;
      }
    }
    return { touchedOwners, touchedConfigs, newEffectiveFrom: args.effectiveFrom };
  },
});

export const seedOwnerDemo = internalMutation({
  args: {
    propertyId: v.id("properties"),
    ownerUserId: v.id("users"),
    stakePct: v.number(),
    feePct: v.number(),
    feeBase: v.union(
      v.literal("grossRevenue"),
      v.literal("netRevenue"),
      v.literal("netOperatingProfit"),
    ),
    approvalThreshold: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // 1. Confirm property exists
    const property = await ctx.db.get(args.propertyId);
    if (!property) throw new ConvexError(`Property ${args.propertyId} not found`);

    // 2. Confirm user exists + has role="owner"
    const user = await ctx.db.get(args.ownerUserId);
    if (!user) throw new ConvexError(`User ${args.ownerUserId} not found`);
    if (user.role !== "owner") {
      throw new ConvexError(
        `User ${args.ownerUserId} has role="${user.role}"; seedOwnerDemo requires role="owner"`,
      );
    }

    // 3. Close any existing active ownership for this property
    const existingOwners = await ctx.db
      .query("propertyOwners")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    for (const row of existingOwners) {
      if (row.effectiveTo === undefined) {
        await ctx.db.patch(row._id, { effectiveTo: now, updatedAt: now });
      }
    }

    // 4. Insert ownership
    const ownerId = await ctx.db.insert("propertyOwners", {
      propertyId: args.propertyId,
      userId: args.ownerUserId,
      stakePct: args.stakePct,
      role: "landlord",
      isPrimaryApprover: true,
      effectiveFrom: now,
      createdAt: now,
    });

    // 5. Close any existing active fee config + insert new
    const existingConfigs = await ctx.db
      .query("propertyFeeConfig")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    for (const row of existingConfigs) {
      if (row.effectiveTo === undefined) {
        await ctx.db.patch(row._id, { effectiveTo: now });
      }
    }
    const feeConfigId = await ctx.db.insert("propertyFeeConfig", {
      propertyId: args.propertyId,
      feePct: args.feePct,
      feeBase: args.feeBase,
      approvalThreshold: args.approvalThreshold,
      effectiveFrom: now,
      createdBy: args.ownerUserId,
      createdAt: now,
    });

    return { ownerId, feeConfigId, property: property.name, user: user.name };
  },
});

/**
 * Diagnostic + repair: lists active owner rows per property and lets us
 * close the duplicates we end up with when seedOwnerAcrossProperties is
 * run on top of an earlier seed (the seedOwnerDemo run for Dallas-The
 * Paris left an active row, and the bulk-seed inserted a SECOND active
 * row, giving stakePct sum = 2.0 which the fee engine rejects).
 *
 * `dryRun=true` reports duplicates without writing. `dryRun=false` keeps
 * the row inserted most recently (highest _creationTime) and closes the
 * others with effectiveTo=now.
 */
export const repairDuplicateActiveOwners = internalMutation({
  args: { dryRun: v.boolean() },
  handler: async (ctx, args) => {
    // Pick a probe date — any periodStart in 2025 or 2026 hits the seed window.
    const probe = Date.UTC(2026, 4, 1); // May 1, 2026
    const allOwners = await ctx.db.query("propertyOwners").collect();
    const byProperty = new Map<Id<"properties">, typeof allOwners>();
    for (const o of allOwners) {
      // "active at probe" — same semantics as fee engine's pickOwnersForPeriod.
      const activeAtProbe =
        o.effectiveFrom <= probe &&
        (o.effectiveTo === undefined || o.effectiveTo > probe);
      if (!activeAtProbe) continue;
      const list = byProperty.get(o.propertyId) ?? [];
      list.push(o);
      byProperty.set(o.propertyId, list);
    }

    const report: Array<{
      propertyId: string;
      keptId: string;
      keptEffectiveFrom: number;
      closedIds: string[];
    }> = [];

    for (const [propertyId, rows] of byProperty.entries()) {
      const sum = rows.reduce((s, r) => s + r.stakePct, 0);
      if (Math.abs(sum - 1.0) < 0.0001 && rows.length === 1) continue;
      // Keep most recently created row; "close" the others such that they're
      // no longer active at the probe period. Setting effectiveTo equal to
      // their own effectiveFrom yields a zero-width interval that never
      // covers any period — the cleanest "shadow-close" we can do without
      // erasing audit history.
      rows.sort((a, b) => b._creationTime - a._creationTime);
      const keep = rows[0];
      const close = rows.slice(1);
      if (!args.dryRun) {
        for (const r of close) {
          await ctx.db.patch(r._id, {
            effectiveTo: r.effectiveFrom, // zero-width interval
            updatedAt: Date.now(),
          });
        }
      }
      report.push({
        propertyId,
        keptId: keep._id,
        keptEffectiveFrom: keep.effectiveFrom,
        closedIds: close.map((r) => r._id),
      });
    }
    return { dryRun: args.dryRun, repaired: report };
  },
});

/**
 * Bulk-seed a single owner across all (or a subset of) properties — used to
 * onboard a J&A partner who legally owns every J&A-managed property. Closes
 * any prior active ownership/fee-config rows per property and inserts new
 * ones. Backdates effectiveFrom so live drafts compute correctly for the
 * current period (and any historical period).
 *
 * Idempotent enough for re-runs: rows are closed via effectiveTo, never
 * deleted, so the audit trail is preserved.
 */
export const seedOwnerAcrossProperties = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    propertyIds: v.array(v.id("properties")),
    feePct: v.number(),
    feeBase: v.union(
      v.literal("grossRevenue"),
      v.literal("netRevenue"),
      v.literal("netOperatingProfit"),
    ),
    approvalThreshold: v.number(),
    effectiveFrom: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.ownerUserId);
    if (!user) throw new ConvexError(`User ${args.ownerUserId} not found`);
    if (user.role !== "owner") {
      throw new ConvexError(
        `User ${args.ownerUserId} has role="${user.role}"; expected "owner"`,
      );
    }

    const now = Date.now();
    const results: Array<{ propertyName: string; ownerId: string; feeConfigId: string }> = [];

    for (const propertyId of args.propertyIds) {
      const property = await ctx.db.get(propertyId);
      if (!property) {
        results.push({ propertyName: `MISSING:${propertyId}`, ownerId: "", feeConfigId: "" });
        continue;
      }

      // Close existing active ownership for this property
      const existingOwners = await ctx.db
        .query("propertyOwners")
        .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
        .collect();
      for (const row of existingOwners) {
        if (row.effectiveTo === undefined) {
          await ctx.db.patch(row._id, { effectiveTo: now, updatedAt: now });
        }
      }

      const ownerId = await ctx.db.insert("propertyOwners", {
        propertyId,
        userId: args.ownerUserId,
        stakePct: 1.0,
        role: "landlord",
        isPrimaryApprover: true,
        effectiveFrom: args.effectiveFrom,
        createdAt: now,
      });

      // Close existing active fee config
      const existingConfigs = await ctx.db
        .query("propertyFeeConfig")
        .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
        .collect();
      for (const row of existingConfigs) {
        if (row.effectiveTo === undefined) {
          await ctx.db.patch(row._id, { effectiveTo: now });
        }
      }

      const feeConfigId = await ctx.db.insert("propertyFeeConfig", {
        propertyId,
        feePct: args.feePct,
        feeBase: args.feeBase,
        approvalThreshold: args.approvalThreshold,
        effectiveFrom: args.effectiveFrom,
        createdBy: args.ownerUserId,
        createdAt: now,
      });

      results.push({
        propertyName: property.name,
        ownerId,
        feeConfigId,
      });
    }

    return { user: user.name, seeded: results };
  },
});

// ─── Owner-inbox state mutations ───────────────────────────────────────────

/**
 * Mark a notification as read. Owner-scoped: verifies the notification
 * belongs to the calling user before patching. Idempotent — re-marking a
 * read notification leaves readAt unchanged.
 */
export const markOwnerNotificationRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const user = await requireOwnerUser(ctx);
    const n = await ctx.db.get(args.notificationId);
    if (!n) throw new ConvexError("Notification not found");
    if (n.userId !== user._id) {
      throw new ConvexError("Notification does not belong to caller");
    }
    if (n.readAt !== undefined) return { alreadyRead: true };
    await ctx.db.patch(args.notificationId, { readAt: Date.now() });
    return { alreadyRead: false };
  },
});

/**
 * Dismiss a notification (removes from inbox). Same auth semantics as
 * markOwnerNotificationRead.
 */
export const dismissOwnerNotification = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const user = await requireOwnerUser(ctx);
    const n = await ctx.db.get(args.notificationId);
    if (!n) throw new ConvexError("Notification not found");
    if (n.userId !== user._id) {
      throw new ConvexError("Notification does not belong to caller");
    }
    if (n.dismissedAt !== undefined) return { alreadyDismissed: true };
    await ctx.db.patch(args.notificationId, { dismissedAt: Date.now() });
    return { alreadyDismissed: false };
  },
});

/**
 * Mark all undismissed owner-portal notifications as read. Convenience for
 * the mobile "Mark all read" gesture.
 */
export const markAllOwnerNotificationsRead = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireOwnerUser(ctx);
    const ownerTypes = new Set([
      "owner_statement_issued",
      "owner_approval_request",
      "owner_incident_reported",
    ]);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const now = Date.now();
    let updated = 0;
    for (const n of rows) {
      if (!ownerTypes.has(n.type)) continue;
      if (n.readAt !== undefined || n.dismissedAt !== undefined) continue;
      await ctx.db.patch(n._id, { readAt: now });
      updated += 1;
    }
    return { updated };
  },
});

/**
 * One-off internal mutation: find any `revenue_percentage` cost item with
 * an insane percentageRate (>= 0.5 = 50%) and zero it out. These are
 * almost certainly data-entry bugs — real platform fees are 3–20%,
 * pricing-tool SaaS like PriceLabs is a flat monthly fee.
 *
 * Found 2026-05-24: PriceLabs configured at 100% on Dallas-The Scandi
 * (and likely other J&A properties), causing platformFees to consume
 * 100% of grossRevenue and ownerPayout to collapse to $0.
 *
 * dryRun=true reports without writing.
 */
export const repairInsaneRevenuePercentageRates = internalMutation({
  args: { dryRun: v.boolean(), threshold: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const threshold = args.threshold ?? 0.5;
    const items = await ctx.db.query("propertyCostItems").collect();
    const broken = items.filter(
      (i) =>
        i.isActive &&
        i.frequency === "revenue_percentage" &&
        (i.percentageRate ?? 0) >= threshold,
    );
    const report = broken.map((i) => ({
      _id: i._id,
      propertyId: i.propertyId,
      name: i.name,
      percentageRate: i.percentageRate,
    }));
    if (!args.dryRun) {
      const now = Date.now();
      for (const i of broken) {
        await ctx.db.patch(i._id, {
          percentageRate: 0,
          updatedAt: now,
        });
      }
    }
    return { dryRun: args.dryRun, found: broken.length, report };
  },
});
