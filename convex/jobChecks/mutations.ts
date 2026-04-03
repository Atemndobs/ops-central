import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { getCurrentUser } from "../lib/auth";
import type { Doc, Id } from "../_generated/dataModel";
import { createOpsNotifications } from "../lib/opsNotifications";

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
  throw new ConvexError("You are not authorized to record job checks for this job.");
}

export const recordCheckpointResult = mutation({
  args: {
    jobId: v.id("cleaningJobs"),
    checkpointId: v.id("propertyCriticalCheckpoints"),
    status: v.union(v.literal("pass"), v.literal("fail"), v.literal("skip")),
    note: v.optional(v.string()),
    failPhotoStorageId: v.optional(v.id("_storage")),
    failPhotoUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new ConvexError("Job not found.");
    }
    assertJobAccess(user, job);

    const checkpoint = await ctx.db.get(args.checkpointId);
    if (!checkpoint) {
      throw new ConvexError("Checkpoint not found.");
    }
    if (checkpoint.propertyId !== job.propertyId) {
      throw new ConvexError("Checkpoint does not belong to this job's property.");
    }

    if (args.status === "skip" && !args.note?.trim()) {
      throw new ConvexError("Skipped checkpoints require a reason.");
    }
    if (
      args.status === "fail" &&
      !args.failPhotoStorageId &&
      !args.failPhotoUrl?.trim()
    ) {
      throw new ConvexError("Failed checkpoints require a fail photo.");
    }

    const revision = getCurrentRevision(job);
    const now = Date.now();
    const existing = await ctx.db
      .query("jobCheckpointChecks")
      .withIndex("by_job_and_revision_and_checkpoint", (q) =>
        q.eq("jobId", args.jobId).eq("revision", revision).eq("checkpointId", args.checkpointId),
      )
      .unique();

    const basePatch = {
      status: args.status,
      note: args.note?.trim(),
      failPhotoStorageId: args.status === "fail" ? args.failPhotoStorageId : undefined,
      failPhotoUrl: args.status === "fail" ? args.failPhotoUrl?.trim() : undefined,
      checkedBy: user._id,
      checkedAt: now,
      updatedAt: now,
    } as const;

    let autoIncidentId: Id<"incidents"> | undefined = existing?.autoIncidentId;
    const previousStatus = existing?.status;
    const transitionedToFail = args.status === "fail" && previousStatus !== "fail";

    if (transitionedToFail) {
      const property = await ctx.db.get(job.propertyId);
      autoIncidentId = await ctx.db.insert("incidents", {
        cleaningJobId: job._id,
        propertyId: job.propertyId,
        reportedBy: user._id,
        incidentType: checkpoint.linkedInventoryItemId ? "missing_item" : "other",
        severity: "high",
        title: `Critical checkpoint failed: ${checkpoint.title}`,
        description: args.note?.trim() || checkpoint.instruction,
        roomName: checkpoint.roomName,
        inventoryItemId: checkpoint.linkedInventoryItemId,
        quantityMissing: checkpoint.linkedInventoryItemId ? 1 : undefined,
        photoIds: args.failPhotoStorageId ? [String(args.failPhotoStorageId)] : [],
        incidentContext: "critical_checkpoint_failure",
        status: "open",
        createdAt: now,
        updatedAt: now,
      });

      await createOpsNotifications(ctx, {
        type: "incident_created",
        title: "Critical Checkpoint Failed",
        message: `${property?.name ?? "Property"}: ${checkpoint.title} in ${checkpoint.roomName}`,
        data: {
          jobId: job._id,
          propertyId: job.propertyId,
          incidentId: autoIncidentId,
          checkpointId: checkpoint._id,
          roomName: checkpoint.roomName,
        },
      });
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...basePatch,
        autoIncidentId,
      });
      return { checkId: existing._id, revision, autoIncidentId };
    }

    const checkId = await ctx.db.insert("jobCheckpointChecks", {
      jobId: args.jobId,
      propertyId: job.propertyId,
      revision,
      checkpointId: checkpoint._id,
      roomName: checkpoint.roomName,
      autoIncidentId,
      ...basePatch,
      createdAt: now,
    });

    return { checkId, revision, autoIncidentId };
  },
});
