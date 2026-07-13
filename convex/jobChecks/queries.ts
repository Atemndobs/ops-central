import { ConvexError, v } from "convex/values";
import { query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import { getCurrentUser } from "../lib/auth";
import { canCallerAccessPropertyById } from "../lib/companyScope";
import type { Doc } from "../_generated/dataModel";

function getCurrentRevision(job: Doc<"cleaningJobs">): number {
  return job.currentRevision ?? 1;
}

/**
 * - admin / property_ops: any job.
 * - manager: only jobs whose property their company currently services.
 * - cleaner: only jobs they are assigned to.
 */
async function assertJobAccess(
  ctx: QueryCtx,
  user: Doc<"users">,
  job: Doc<"cleaningJobs">,
) {
  if (user.role === "admin" || user.role === "property_ops") {
    return;
  }
  if (user.role === "manager") {
    if (await canCallerAccessPropertyById(ctx, user, job.propertyId)) {
      return;
    }
    throw new ConvexError(
      "You are not authorized to access job checks for this job.",
    );
  }
  if (user.role === "cleaner" && job.assignedCleanerIds.includes(user._id)) {
    return;
  }
  throw new ConvexError("You are not authorized to access job checks for this job.");
}

export const getForJob = query({
  args: {
    jobId: v.id("cleaningJobs"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      return null;
    }
    await assertJobAccess(ctx, user, job);

    const revision = getCurrentRevision(job);
    const [checkpoints, checkpointChecks, refillChecks, inventoryItems] = await Promise.all([
      ctx.db
        .query("propertyCriticalCheckpoints")
        .withIndex("by_property", (q) => q.eq("propertyId", job.propertyId))
        .collect(),
      ctx.db
        .query("jobCheckpointChecks")
        .withIndex("by_job_and_revision", (q) =>
          q.eq("jobId", args.jobId).eq("revision", revision),
        )
        .collect(),
      ctx.db
        .query("jobRefillChecks")
        .withIndex("by_job_and_revision", (q) =>
          q.eq("jobId", args.jobId).eq("revision", revision),
        )
        .collect(),
      ctx.db
        .query("inventoryItems")
        .withIndex("by_property", (q) => q.eq("propertyId", job.propertyId))
        .collect(),
    ]);

    const checkpointCheckById = new Map(
      checkpointChecks.map((check) => [check.checkpointId, check] as const),
    );

    const checkpointsWithStatus = await Promise.all(
      checkpoints
        .sort((a, b) => {
          const roomOrder = a.roomName.localeCompare(b.roomName);
          if (roomOrder !== 0) {
            return roomOrder;
          }
          if (a.sortOrder !== b.sortOrder) {
            return a.sortOrder - b.sortOrder;
          }
          return a.title.localeCompare(b.title);
        })
        .map(async (checkpoint) => {
          const check = checkpointCheckById.get(checkpoint._id) ?? null;
          const referenceUrl = checkpoint.referenceStorageId
            ? await ctx.storage.getUrl(checkpoint.referenceStorageId)
            : checkpoint.referenceImageUrl ?? null;

          return {
            checkpoint,
            check,
            referenceUrl,
          };
        }),
    );

    const requiredCheckpoints = checkpoints.filter(
      (checkpoint) => checkpoint.isActive && checkpoint.isRequired,
    );
    const checkedRequiredCount = requiredCheckpoints.filter((checkpoint) =>
      checkpointCheckById.has(checkpoint._id),
    ).length;
    const trackedRefillItems = inventoryItems
      .filter((item) => item.isRefillTracked === true)
      .sort((a, b) => {
        const roomOrder = (a.room ?? "").localeCompare(b.room ?? "");
        if (roomOrder !== 0) {
          return roomOrder;
        }
        const orderA = a.refillDisplayOrder ?? Number.MAX_SAFE_INTEGER;
        const orderB = b.refillDisplayOrder ?? Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        return a.name.localeCompare(b.name);
      });
    const refillCheckByItemId = new Map(
      refillChecks.map((check) => [check.itemId, check] as const),
    );
    const refillsWithStatus = trackedRefillItems.map((item) => ({
      item,
      check: refillCheckByItemId.get(item._id) ?? null,
    }));
    const checkedRequiredRefills = refillsWithStatus.filter(
      (row) => row.check !== null,
    ).length;

    return {
      jobId: args.jobId,
      propertyId: job.propertyId,
      revision,
      checkpoints: checkpointsWithStatus,
      checkpointChecks,
      refillChecks,
      refills: refillsWithStatus,
      coverage: {
        requiredCheckpoints: requiredCheckpoints.length,
        checkedRequiredCheckpoints: checkedRequiredCount,
        requiredRefills: trackedRefillItems.length,
        checkedRequiredRefills: checkedRequiredRefills,
      },
    };
  },
});
