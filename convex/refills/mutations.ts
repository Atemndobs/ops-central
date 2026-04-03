import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { getCurrentUser } from "../lib/auth";
import type { Doc, Id } from "../_generated/dataModel";
import { createOpsNotifications } from "../lib/opsNotifications";

const DEFAULT_LOW_THRESHOLD = 50;
const DEFAULT_CRITICAL_THRESHOLD = 20;

function getCurrentRevision(job: Doc<"cleaningJobs">): number {
  return job.currentRevision ?? 1;
}

function isPrivilegedRole(user: Doc<"users">): boolean {
  return (
    user.role === "admin" ||
    user.role === "property_ops" ||
    user.role === "manager"
  );
}

function assertJobAccess(user: Doc<"users">, job: Doc<"cleaningJobs">) {
  if (isPrivilegedRole(user)) {
    return;
  }
  if (user.role === "cleaner" && job.assignedCleanerIds.includes(user._id)) {
    return;
  }
  throw new ConvexError("You are not authorized to record refill checks for this job.");
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function validateThresholds(args: { low: number; critical: number }) {
  if (args.low < 0 || args.low > 100 || args.critical < 0 || args.critical > 100) {
    throw new ConvexError("Thresholds must be between 0 and 100.");
  }
  if (args.critical > args.low) {
    throw new ConvexError("Critical threshold cannot be greater than low threshold.");
  }
}

function deriveLevel(args: {
  percentRemaining: number;
  lowThresholdPct?: number;
  criticalThresholdPct?: number;
}): Doc<"jobRefillChecks">["level"] {
  const low = clampPercent(args.lowThresholdPct ?? DEFAULT_LOW_THRESHOLD);
  const critical = clampPercent(args.criticalThresholdPct ?? DEFAULT_CRITICAL_THRESHOLD);
  const pct = clampPercent(args.percentRemaining);

  if (pct <= 0) {
    return "out";
  }
  if (pct <= critical) {
    return "critical";
  }
  if (pct <= low) {
    return "low";
  }
  return "ok";
}

function toInventoryStatus(
  existingStatus: Doc<"inventoryItems">["status"],
  level: Doc<"jobRefillChecks">["level"],
): Doc<"inventoryItems">["status"] {
  if (level === "ok") {
    return "ok";
  }
  if (existingStatus === "reorder_pending") {
    return "reorder_pending";
  }
  if (level === "out") {
    return "out_of_stock";
  }
  return "low_stock";
}

function queueSeverity(level: Doc<"refillQueue">["level"]): number {
  if (level === "out") return 3;
  if (level === "critical") return 2;
  return 1;
}

type ActiveQueueState = Extract<Doc<"refillQueue">["status"], "open" | "acknowledged" | "ordered">;

function isActiveQueueStatus(status: Doc<"refillQueue">["status"]): status is ActiveQueueState {
  return status === "open" || status === "acknowledged" || status === "ordered";
}

export const setTrackingConfig = mutation({
  args: {
    itemId: v.id("inventoryItems"),
    isRefillTracked: v.boolean(),
    refillLowThresholdPct: v.optional(v.number()),
    refillCriticalThresholdPct: v.optional(v.number()),
    refillDisplayOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!isPrivilegedRole(user)) {
      throw new ConvexError("Only privileged users can configure refill tracking.");
    }

    const item = await ctx.db.get(args.itemId);
    if (!item) {
      throw new ConvexError("Inventory item not found.");
    }

    const low = clampPercent(args.refillLowThresholdPct ?? item.refillLowThresholdPct ?? DEFAULT_LOW_THRESHOLD);
    const critical = clampPercent(
      args.refillCriticalThresholdPct ?? item.refillCriticalThresholdPct ?? DEFAULT_CRITICAL_THRESHOLD,
    );
    validateThresholds({ low, critical });

    await ctx.db.patch(args.itemId, {
      isRefillTracked: args.isRefillTracked,
      refillLowThresholdPct: low,
      refillCriticalThresholdPct: critical,
      refillDisplayOrder:
        typeof args.refillDisplayOrder === "number"
          ? Math.max(0, Math.floor(args.refillDisplayOrder))
          : item.refillDisplayOrder,
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});

export const recordJobRefillCheck = mutation({
  args: {
    jobId: v.id("cleaningJobs"),
    itemId: v.id("inventoryItems"),
    percentRemaining: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    const [job, item] = await Promise.all([
      ctx.db.get(args.jobId),
      ctx.db.get(args.itemId),
    ]);
    if (!job) {
      throw new ConvexError("Job not found.");
    }
    if (!item) {
      throw new ConvexError("Inventory item not found.");
    }
    assertJobAccess(user, job);

    if (item.propertyId !== job.propertyId) {
      throw new ConvexError("Inventory item does not belong to this job's property.");
    }
    if (!item.isRefillTracked) {
      throw new ConvexError("This inventory item is not configured for refill tracking.");
    }

    const revision = getCurrentRevision(job);
    const now = Date.now();
    const percentRemaining = clampPercent(args.percentRemaining);
    const level = deriveLevel({
      percentRemaining,
      lowThresholdPct: item.refillLowThresholdPct,
      criticalThresholdPct: item.refillCriticalThresholdPct,
    });

    const existingCheck = await ctx.db
      .query("jobRefillChecks")
      .withIndex("by_job_and_revision_and_item", (q) =>
        q.eq("jobId", args.jobId).eq("revision", revision).eq("itemId", args.itemId),
      )
      .unique();

    if (existingCheck) {
      await ctx.db.patch(existingCheck._id, {
        percentRemaining,
        level,
        note: args.note?.trim(),
        checkedBy: user._id,
        checkedAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("jobRefillChecks", {
        jobId: args.jobId,
        propertyId: job.propertyId,
        revision,
        itemId: args.itemId,
        roomName: item.room,
        percentRemaining,
        level,
        note: args.note?.trim(),
        checkedBy: user._id,
        checkedAt: now,
        createdAt: now,
      });
    }

    const nextInventoryStatus = toInventoryStatus(item.status, level);
    await ctx.db.patch(args.itemId, {
      status: nextInventoryStatus,
      requiresRestock: level !== "ok",
      lastCheckedAt: now,
      lastCheckedBy: user._id,
      updatedAt: now,
    });

    const queueRows = await ctx.db
      .query("refillQueue")
      .withIndex("by_item", (q) => q.eq("itemId", args.itemId))
      .collect();
    const activeQueue = queueRows
      .filter((row) => isActiveQueueStatus(row.status))
      .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))[0];

    let queueId: Id<"refillQueue"> | undefined;
    let notificationNeeded = false;

    if (level === "ok") {
      if (activeQueue) {
        await ctx.db.patch(activeQueue._id, {
          status: "resolved",
          resolvedAt: now,
          lastPercentRemaining: percentRemaining,
          lastCheckedAt: now,
          lastCheckedBy: user._id,
          note: args.note?.trim(),
          updatedAt: now,
        });
        queueId = activeQueue._id;
      }
    } else {
      const queueLevel = level === "low" ? "low" : level === "critical" ? "critical" : "out";
      if (activeQueue) {
        const previousSeverity = queueSeverity(activeQueue.level);
        const nextSeverity = queueSeverity(queueLevel);
        notificationNeeded = nextSeverity > previousSeverity;

        await ctx.db.patch(activeQueue._id, {
          lastJobId: args.jobId,
          level: queueLevel,
          lastPercentRemaining: percentRemaining,
          lastCheckedAt: now,
          lastCheckedBy: user._id,
          note: args.note?.trim(),
          updatedAt: now,
        });
        queueId = activeQueue._id;
      } else {
        queueId = await ctx.db.insert("refillQueue", {
          propertyId: job.propertyId,
          itemId: args.itemId,
          lastJobId: args.jobId,
          status: "open",
          level: queueLevel,
          lastPercentRemaining: percentRemaining,
          note: args.note?.trim(),
          lastCheckedAt: now,
          lastCheckedBy: user._id,
          createdAt: now,
          updatedAt: now,
        });
        notificationNeeded = true;
      }

      if (notificationNeeded) {
        const property = await ctx.db.get(job.propertyId);
        await createOpsNotifications(ctx, {
          type: "low_stock",
          title: `Refill ${queueLevel === "out" ? "Out of Stock" : "Low Stock"}`,
          message: `${property?.name ?? "Property"}: ${item.name} at ${percentRemaining}%`,
          data: {
            jobId: job._id,
            propertyId: job.propertyId,
            itemId: item._id,
            queueId,
            level: queueLevel,
            percentRemaining,
          },
        });
      }
    }

    return {
      ok: true,
      level,
      percentRemaining,
      queueId,
      inventoryStatus: nextInventoryStatus,
    };
  },
});

export const updateQueueStatus = mutation({
  args: {
    queueId: v.id("refillQueue"),
    status: v.union(
      v.literal("open"),
      v.literal("acknowledged"),
      v.literal("ordered"),
      v.literal("resolved"),
    ),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!isPrivilegedRole(user)) {
      throw new ConvexError("Only privileged users can update refill queue status.");
    }

    const row = await ctx.db.get(args.queueId);
    if (!row) {
      throw new ConvexError("Refill queue entry not found.");
    }

    const now = Date.now();
    await ctx.db.patch(args.queueId, {
      status: args.status,
      note: args.note?.trim() ?? row.note,
      acknowledgedAt: args.status === "acknowledged" ? now : row.acknowledgedAt,
      orderedAt: args.status === "ordered" ? now : row.orderedAt,
      resolvedAt: args.status === "resolved" ? now : row.resolvedAt,
      updatedAt: now,
    });

    return { ok: true };
  },
});
