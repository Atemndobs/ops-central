import { ConvexError, v } from "convex/values";
import { mutation, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { getCurrentUser } from "../lib/auth";
import {
  createNotificationsForUsers,
  createOpsNotifications,
} from "../lib/opsNotifications";
import {
  dismissNotificationsForJob,
  listOpsUserIds,
} from "../lib/notificationLifecycle";
import {
  getJobConversationByJobId,
  seedJobConversationParticipants,
  syncConversationStatusForJob,
} from "../conversations/lib";
import {
  markAcknowledgementAccepted,
  reconcileAcknowledgements,
} from "./acknowledgements";

const qaModeValidator = v.union(v.literal("standard"), v.literal("quick"));

function getCurrentRevision(job: Doc<"cleaningJobs">): number {
  return job.currentRevision ?? 1;
}

function normalizeRoom(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function hasTrailingRoomIndex(name: string): boolean {
  return /\s\d+$/.test(name);
}

function dropTrailingRoomIndex(name: string): string {
  return name.replace(/\s\d+$/, "");
}

function roomRequirementMatchesObserved(
  requiredRoomName: string,
  observedRoomName: string,
): boolean {
  const required = normalizeRoom(requiredRoomName);
  const observed = normalizeRoom(observedRoomName);

  if (!required || !observed) {
    return false;
  }

  if (required === observed) {
    return true;
  }

  // Backward compatibility: treat "Bedroom" as matching "Bedroom 1".
  if (!hasTrailingRoomIndex(required) && hasTrailingRoomIndex(observed)) {
    return required === dropTrailingRoomIndex(observed);
  }

  return false;
}

function dedupeRoomNames(roomNames: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  roomNames.forEach((roomName) => {
    const normalized = normalizeRoom(roomName);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    unique.push(normalized);
  });

  return unique;
}

function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}

function requirePrivilegedRole(user: Doc<"users">) {
  if (
    user.role !== "admin" &&
    user.role !== "manager" &&
    user.role !== "property_ops"
  ) {
    throw new ConvexError("Only privileged users can perform this action.");
  }
}

function isActiveCompanyPropertyAssignment(
  assignment: Doc<"companyProperties">,
): boolean {
  return assignment.isActive !== false && assignment.unassignedAt === undefined;
}

function isActiveMembership(membership: Doc<"companyMembers">): boolean {
  return membership.isActive && membership.leftAt === undefined;
}

async function getActivePropertyCompanyAssignment(
  ctx: MutationCtx,
  propertyId: Id<"properties">,
) {
  const assignments = await ctx.db
    .query("companyProperties")
    .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
    .collect();

  const active = assignments
    .filter(isActiveCompanyPropertyAssignment)
    .sort((a, b) => b.assignedAt - a.assignedAt)[0];

  return active ?? null;
}

async function getLatestActiveCompanyMembership(
  ctx: MutationCtx,
  userId: Id<"users">,
) {
  const memberships = await ctx.db
    .query("companyMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  const active = memberships
    .filter(isActiveMembership)
    .sort((a, b) => b.joinedAt - a.joinedAt)[0];

  return active ?? null;
}

type SubmissionValidation = {
  mode: "standard" | "quick";
  pass: boolean;
  warnings: string[];
  errors: string[];
  summary: {
    beforeCount: number;
    afterCount: number;
    incidentCount: number;
    missingBeforeRooms: string[];
    missingAfterRooms: string[];
  };
};

type SubmitForApprovalInput = {
  jobId: Id<"cleaningJobs">;
  notes?: string;
  guestReady?: boolean;
  submittedAtDevice?: number;
  qaMode?: "standard" | "quick";
  quickMinimumBefore?: number;
  quickMinimumAfter?: number;
  requiredRooms?: string[];
  skippedRooms?: Array<{ roomName: string; reason: string }>;
  force?: boolean;
};

type SubmitForApprovalResult = {
  ok: boolean;
  gatePassed: boolean;
  jobId: Id<"cleaningJobs">;
  revision: number;
  unresolvedCleanerIds: Id<"users">[];
  submissionId?: Id<"jobSubmissions">;
  validationResult?: SubmissionValidation;
};

function buildValidationResult(args: {
  qaMode?: "standard" | "quick";
  quickMinimumBefore?: number;
  quickMinimumAfter?: number;
  requiredRooms?: string[];
  skippedRooms?: Array<{ roomName: string; reason: string }>;
  photos: Array<{
    roomName: string;
    type: "before" | "after" | "incident";
  }>;
}): SubmissionValidation {
  const mode = args.qaMode ?? "standard";
  const warnings: string[] = [];
  const errors: string[] = [];

  const beforeCount = args.photos.filter((photo) => photo.type === "before").length;
  const afterCount = args.photos.filter((photo) => photo.type === "after").length;
  const incidentCount = args.photos.filter((photo) => photo.type === "incident").length;

  const skippedRooms = dedupeRoomNames(
    (args.skippedRooms ?? []).map((room) => room.roomName),
  );

  const observedRooms = dedupeRoomNames(
    args.photos
      .map((photo) => photo.roomName)
      .filter((name) => {
        const normalized = normalizeRoom(name);
        return (
          normalized.length > 0 &&
          normalized !== "batch" &&
          normalized !== "quick flow batch"
        );
      }),
  );
  const requiredRooms = args.requiredRooms?.length
    ? dedupeRoomNames(args.requiredRooms)
    : observedRooms;

  const beforeRooms = dedupeRoomNames(
    args.photos
      .filter((photo) => photo.type === "before")
      .map((photo) => photo.roomName),
  );
  const afterRooms = dedupeRoomNames(
    args.photos
      .filter((photo) => photo.type === "after")
      .map((photo) => photo.roomName),
  );

  const missingBeforeRooms: string[] = [];
  const missingAfterRooms: string[] = [];

  if (mode === "quick") {
    const minBefore = Math.max(1, Math.floor(args.quickMinimumBefore ?? 1));
    const minAfter = Math.max(1, Math.floor(args.quickMinimumAfter ?? 1));

    if (beforeCount < minBefore) {
      errors.push(`Quick mode requires at least ${minBefore} before photo(s).`);
    }
    if (afterCount < minAfter) {
      errors.push(`Quick mode requires at least ${minAfter} after photo(s).`);
    }

    if (beforeCount < 3 || afterCount < 3) {
      warnings.push("Photo counts are below recommended QA thresholds.");
    }
  } else {
    requiredRooms.forEach((roomName) => {
      const isSkipped = skippedRooms.some(
        (skippedRoom) =>
          roomRequirementMatchesObserved(roomName, skippedRoom) ||
          roomRequirementMatchesObserved(skippedRoom, roomName),
      );
      if (isSkipped) {
        return;
      }

      const hasBefore = beforeRooms.some((beforeRoom) =>
        roomRequirementMatchesObserved(roomName, beforeRoom),
      );
      if (!hasBefore) {
        missingBeforeRooms.push(roomName);
      }

      const hasAfter = afterRooms.some((afterRoom) =>
        roomRequirementMatchesObserved(roomName, afterRoom),
      );
      if (!hasAfter) {
        missingAfterRooms.push(roomName);
      }
    });

    if (missingBeforeRooms.length > 0) {
      errors.push(
        `Missing before photos for: ${missingBeforeRooms.slice(0, 5).join(", ")}${missingBeforeRooms.length > 5 ? ` (+${missingBeforeRooms.length - 5} more)` : ""}.`,
      );
    }
    if (missingAfterRooms.length > 0) {
      errors.push(
        `Missing after photos for: ${missingAfterRooms.slice(0, 5).join(", ")}${missingAfterRooms.length > 5 ? ` (+${missingAfterRooms.length - 5} more)` : ""}.`,
      );
    }
  }

  return {
    mode,
    pass: errors.length === 0,
    warnings,
    errors,
    summary: {
      beforeCount,
      afterCount,
      incidentCount,
      missingBeforeRooms,
      missingAfterRooms,
    },
  };
}

async function findSession(
  ctx: MutationCtx,
  args: {
    jobId: Id<"cleaningJobs">;
    cleanerId: Id<"users">;
    revision: number;
  },
) {
  return await ctx.db
    .query("jobExecutionSessions")
    .withIndex("by_job_and_cleaner_and_revision", (q) =>
      q.eq("jobId", args.jobId).eq("cleanerId", args.cleanerId).eq("revision", args.revision),
    )
    .unique();
}

async function getCriticalAndRefillCoverage(
  ctx: MutationCtx,
  args: {
    job: Doc<"cleaningJobs">;
    revision: number;
  },
) {
  const [requiredCheckpoints, checkpointChecks, trackedRefillItems, refillChecks] =
    await Promise.all([
      ctx.db
        .query("propertyCriticalCheckpoints")
        .withIndex("by_property_and_active", (q) =>
          q.eq("propertyId", args.job.propertyId).eq("isActive", true),
        )
        .collect(),
      ctx.db
        .query("jobCheckpointChecks")
        .withIndex("by_job_and_revision", (q) =>
          q.eq("jobId", args.job._id).eq("revision", args.revision),
        )
        .collect(),
      ctx.db
        .query("inventoryItems")
        .withIndex("by_property", (q) => q.eq("propertyId", args.job.propertyId))
        .collect(),
      ctx.db
        .query("jobRefillChecks")
        .withIndex("by_job_and_revision", (q) =>
          q.eq("jobId", args.job._id).eq("revision", args.revision),
        )
        .collect(),
    ]);

  const required = requiredCheckpoints.filter((checkpoint) => checkpoint.isRequired);
  const trackedItems = trackedRefillItems.filter((item) => item.isRefillTracked === true);

  const checkpointIds = new Set(checkpointChecks.map((check) => check.checkpointId));
  const refillItemIds = new Set(refillChecks.map((check) => check.itemId));

  const missingCheckpoints = required.filter(
    (checkpoint) => !checkpointIds.has(checkpoint._id),
  );
  const missingRefills = trackedItems.filter((item) => !refillItemIds.has(item._id));

  return {
    requiredCheckpointCount: required.length,
    completedCheckpointCount: required.length - missingCheckpoints.length,
    requiredRefillCount: trackedItems.length,
    completedRefillCount: trackedItems.length - missingRefills.length,
    missingCheckpointLabels: missingCheckpoints.map(
      (checkpoint) => `${checkpoint.roomName}: ${checkpoint.title}`,
    ),
    missingRefillLabels: missingRefills.map((item) =>
      item.room ? `${item.room}: ${item.name}` : item.name,
    ),
  };
}

async function sealSubmission(
  ctx: MutationCtx,
  args: {
    job: Doc<"cleaningJobs">;
    revision: number;
    submittedBy: Id<"users">;
    submittedAtServer: number;
    submittedAtDevice?: number;
    validationResult: SubmissionValidation;
  },
) {
  const existing = await ctx.db
    .query("jobSubmissions")
    .withIndex("by_job_and_revision", (q) =>
      q.eq("jobId", args.job._id).eq("revision", args.revision),
    )
    .first();
  if (existing) {
    return existing._id;
  }

  const photos = await ctx.db
    .query("photos")
    .withIndex("by_job", (q) => q.eq("cleaningJobId", args.job._id))
    .collect();

  const incidents = await ctx.db
    .query("incidents")
    .withIndex("by_job", (q) => q.eq("cleaningJobId", args.job._id))
    .collect();

  const photoSnapshot = photos.map((photo) => ({
    photoId: photo._id,
    storageId: photo.storageId,
    provider: photo.provider,
    bucket: photo.bucket,
    objectKey: photo.objectKey,
    objectVersion: photo.objectVersion,
    roomName: photo.roomName,
    type: photo.type,
    uploadedAt: photo.uploadedAt,
    uploadedBy: photo.uploadedBy,
  }));

  const incidentSnapshot = incidents.map((incident) => ({
    incidentId: incident._id,
    title: incident.title,
    description: incident.description,
    roomName: incident.roomName,
    severity: incident.severity,
    status: incident.status,
    createdAt: incident.createdAt,
  }));

  const sealedPayload = JSON.stringify({
    jobId: args.job._id,
    revision: args.revision,
    submittedAtServer: args.submittedAtServer,
    photoSnapshot,
    checklistSnapshot: args.job.checklistItems ?? [],
    incidentSnapshot,
    validationResult: args.validationResult,
  });

  const submissionId = await ctx.db.insert("jobSubmissions", {
    jobId: args.job._id,
    revision: args.revision,
    submittedBy: args.submittedBy,
    submittedAtServer: args.submittedAtServer,
    submittedAtDevice: args.submittedAtDevice,
    status: "sealed",
    photoSnapshot,
    checklistSnapshot: args.job.checklistItems,
    incidentSnapshot,
    validationResult: args.validationResult,
    sealedHash: fnv1aHash(sealedPayload),
    createdAt: args.submittedAtServer,
  });

  return submissionId;
}

export const create = mutation({
  args: {
    propertyId: v.id("properties"),
    scheduledStartAt: v.number(),
    scheduledEndAt: v.number(),
    notesForCleaner: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const property = await ctx.db.get(args.propertyId);
    if (!property) {
      throw new ConvexError("Property not found.");
    }
    if (!property.isActive) {
      throw new ConvexError("Property is not active.");
    }

    if (
      !Number.isFinite(args.scheduledStartAt) ||
      !Number.isFinite(args.scheduledEndAt)
    ) {
      throw new ConvexError("Scheduled dates are invalid.");
    }

    const now = Date.now();

    return await ctx.db.insert("cleaningJobs", {
      propertyId: args.propertyId,
      assignedCleanerIds: [],
      status: "scheduled",
      scheduledStartAt: args.scheduledStartAt,
      scheduledEndAt: args.scheduledEndAt,
      notesForCleaner: args.notesForCleaner?.trim(),
      partyRiskFlag: false,
      opsRiskFlag: false,
      isUrgent: false,
      currentRevision: 1,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const start = mutation({
  args: {
    jobId: v.id("cleaningJobs"),
    startedAtDevice: v.optional(v.number()),
    offlineStartToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new ConvexError("Job not found.");
    }

    const revision = getCurrentRevision(job);

    if (
      user.role === "cleaner" &&
      !job.assignedCleanerIds.includes(user._id)
    ) {
      throw new ConvexError("Cleaner is not assigned to this job.");
    }

    if (
      job.status !== "assigned" &&
      job.status !== "rework_required" &&
      job.status !== "in_progress" &&
      job.status !== "scheduled"
    ) {
      throw new ConvexError(
        `Job cannot be started from status "${job.status}".`,
      );
    }

    const now = Date.now();
    const session = await findSession(ctx, {
      jobId: args.jobId,
      cleanerId: user._id,
      revision,
    });

    if (!session) {
      await ctx.db.insert("jobExecutionSessions", {
        jobId: args.jobId,
        revision,
        cleanerId: user._id,
        status: "started",
        startedAtServer: now,
        startedAtDevice: args.startedAtDevice,
        lastHeartbeatAt: now,
        offlineStartToken: args.offlineStartToken?.trim() || undefined,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(session._id, {
        lastHeartbeatAt: now,
        updatedAt: now,
      });
    }

    const nextAcks =
      user.role === "cleaner"
        ? markAcknowledgementAccepted(job.acknowledgements, {
            cleanerId: user._id,
            now,
          })
        : job.acknowledgements;

    if (job.status !== "in_progress" || job.actualStartAt === undefined) {
      await ctx.db.patch(args.jobId, {
        status: "in_progress",
        actualStartAt: job.actualStartAt ?? now,
        currentRevision: revision,
        acknowledgements: nextAcks,
        updatedAt: now,
      });
      await syncConversationStatusForJob(ctx, {
        jobId: args.jobId,
        nextStatus: "in_progress",
      });
    } else if (nextAcks !== job.acknowledgements) {
      await ctx.db.patch(args.jobId, {
        acknowledgements: nextAcks,
        updatedAt: now,
      });
    }

    await dismissNotificationsForJob(ctx, {
      jobId: String(job._id),
      userIds: [user._id],
      types: ["job_assigned", "rework_required"],
    });

    return {
      jobId: args.jobId,
      revision,
      startedAtServer: job.actualStartAt ?? now,
      alreadyStarted: Boolean(session),
    };
  },
});

export const pingActiveSession = mutation({
  args: {
    jobId: v.id("cleaningJobs"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new ConvexError("Job not found.");
    }
    const revision = getCurrentRevision(job);
    const now = Date.now();
    const session = await findSession(ctx, {
      jobId: args.jobId,
      cleanerId: user._id,
      revision,
    });

    if (!session) {
      await ctx.db.insert("jobExecutionSessions", {
        jobId: args.jobId,
        revision,
        cleanerId: user._id,
        status: "started",
        startedAtServer: job.actualStartAt ?? now,
        lastHeartbeatAt: now,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(session._id, {
        lastHeartbeatAt: now,
        updatedAt: now,
      });
    }

    return {
      jobId: args.jobId,
      revision,
      lastHeartbeatAt: now,
      status: session?.status ?? "started",
    };
  },
});

async function submitForApprovalInternal(
  ctx: MutationCtx,
  user: Doc<"users">,
  args: SubmitForApprovalInput,
): Promise<SubmitForApprovalResult> {
  const job = await ctx.db.get(args.jobId);
  if (!job) {
    throw new ConvexError("Job not found.");
  }

  const revision = getCurrentRevision(job);
  const now = Date.now();
  const force = args.force ?? false;

  if (job.status !== "in_progress" && job.status !== "awaiting_approval") {
    throw new ConvexError(
      `Job cannot be submitted from status "${job.status}". Job must be in "in_progress" status.`,
    );
  }

  if (force && user.role !== "cleaner") {
    requirePrivilegedRole(user);
  }

  if (user.role === "cleaner") {
    if (!job.assignedCleanerIds.includes(user._id)) {
      throw new ConvexError("Cleaner is not assigned to this job.");
    }

    const session = await findSession(ctx, {
      jobId: args.jobId,
      cleanerId: user._id,
      revision,
    });

    if (!session) {
      await ctx.db.insert("jobExecutionSessions", {
        jobId: args.jobId,
        revision,
        cleanerId: user._id,
        status: "submitted",
        startedAtServer: job.actualStartAt ?? now,
        submittedAtServer: now,
        submittedAtDevice: args.submittedAtDevice,
        lastHeartbeatAt: now,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(session._id, {
        status: "submitted",
        submittedAtServer: now,
        submittedAtDevice: args.submittedAtDevice,
        lastHeartbeatAt: now,
        updatedAt: now,
      });
    }
  } else {
    requirePrivilegedRole(user);
  }

  const allSessions = await ctx.db
    .query("jobExecutionSessions")
    .withIndex("by_job_and_revision", (q) =>
      q.eq("jobId", args.jobId).eq("revision", revision),
    )
    .collect();

  const sessionsByCleaner = new Map(
    allSessions.map((session) => [session.cleanerId, session]),
  );
  const unresolvedCleanerIds = job.assignedCleanerIds.filter((cleanerId) => {
    const session = sessionsByCleaner.get(cleanerId);
    if (!session) {
      return true;
    }
    return session.status !== "submitted" && session.status !== "excused";
  });

  // Cleaner self-force applies to evidence validation only; unresolved multi-cleaner
  // session gates still require privileged force submit.
  const canBypassSessionGate = force && user.role !== "cleaner";
  if (unresolvedCleanerIds.length > 0 && !canBypassSessionGate) {
    if (force) {
      throw new ConvexError(
        `Submission gate not passed. ${unresolvedCleanerIds.length} cleaner(s) still pending.`,
      );
    }

    return {
      ok: false,
      gatePassed: false,
      jobId: args.jobId,
      revision,
      unresolvedCleanerIds,
    };
  }

  const photos = await ctx.db
    .query("photos")
    .withIndex("by_job", (q) => q.eq("cleaningJobId", args.jobId))
    .collect();
  const validationResult = buildValidationResult({
    qaMode: args.qaMode,
    quickMinimumBefore: args.quickMinimumBefore,
    quickMinimumAfter: args.quickMinimumAfter,
    requiredRooms: args.requiredRooms,
    skippedRooms: args.skippedRooms,
    photos: photos.map((photo) => ({
      roomName: photo.roomName,
      type: photo.type,
    })),
  });

  const coverage = await getCriticalAndRefillCoverage(ctx, {
    job,
    revision,
  });
  if (coverage.missingCheckpointLabels.length > 0) {
    validationResult.errors.push(
      `Missing critical checks for ${coverage.missingCheckpointLabels.length} checkpoint(s).`,
    );
    validationResult.warnings.push(
      `Incomplete critical checks: ${coverage.missingCheckpointLabels.slice(0, 5).join(", ")}`,
    );
  }
  if (coverage.missingRefillLabels.length > 0) {
    validationResult.errors.push(
      `Missing refill checks for ${coverage.missingRefillLabels.length} item(s).`,
    );
    validationResult.warnings.push(
      `Incomplete refill checks: ${coverage.missingRefillLabels.slice(0, 5).join(", ")}`,
    );
  }
  validationResult.pass = validationResult.errors.length === 0;

  if (!validationResult.pass && !force) {
    throw new ConvexError(
      `Evidence validation failed: ${validationResult.errors.join(" ")}`,
    );
  }

  const submissionId = await sealSubmission(ctx, {
    job,
    revision,
    submittedBy: user._id,
    submittedAtServer: now,
    submittedAtDevice: args.submittedAtDevice,
    validationResult,
  });

  const priorSubmissions = await ctx.db
    .query("jobSubmissions")
    .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
    .collect();
  await Promise.all(
    priorSubmissions
      .filter(
        (submission) =>
          submission.revision < revision &&
          submission.status === "sealed" &&
          submission.supersededAt === undefined,
      )
      .map((submission) =>
        ctx.db.patch(submission._id, {
          status: "superseded",
          supersededAt: now,
        }),
      ),
  );

  await ctx.db.patch(args.jobId, {
    status: "awaiting_approval",
    actualEndAt: job.actualEndAt ?? now,
    completionNotes: args.notes?.trim() ?? job.completionNotes,
    latestSubmissionId: submissionId,
    updatedAt: now,
    metadata: {
      ...(job.metadata && typeof job.metadata === "object" ? job.metadata : {}),
      qaMode: validationResult.mode,
      guestReady: args.guestReady,
      requiredCheckpointCount: coverage.requiredCheckpointCount,
      completedCheckpointCount: coverage.completedCheckpointCount,
      requiredRefillCount: coverage.requiredRefillCount,
      completedRefillCount: coverage.completedRefillCount,
    },
  });
  await syncConversationStatusForJob(ctx, {
    jobId: args.jobId,
    nextStatus: "awaiting_approval",
  });

  await dismissNotificationsForJob(ctx, {
    jobId: String(job._id),
    userIds: job.assignedCleanerIds,
    types: ["job_assigned", "rework_required"],
  });

  const property = await ctx.db.get(job.propertyId);
  await createOpsNotifications(ctx, {
    type: "awaiting_approval",
    title: "Job Awaiting Approval",
    message: `${property?.name ?? "Property"} is ready for review.`,
    data: {
      jobId: job._id,
      propertyId: job.propertyId,
      submissionId,
    },
  });

  return {
    ok: true,
    gatePassed: true,
    jobId: args.jobId,
    revision,
    unresolvedCleanerIds: [],
    submissionId,
    validationResult,
  };
}

export const submitForApproval = mutation({
  args: {
    jobId: v.id("cleaningJobs"),
    notes: v.optional(v.string()),
    guestReady: v.optional(v.boolean()),
    submittedAtDevice: v.optional(v.number()),
    qaMode: v.optional(qaModeValidator),
    quickMinimumBefore: v.optional(v.number()),
    quickMinimumAfter: v.optional(v.number()),
    requiredRooms: v.optional(v.array(v.string())),
    skippedRooms: v.optional(
      v.array(
        v.object({
          roomName: v.string(),
          reason: v.string(),
        }),
      ),
    ),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    return await submitForApprovalInternal(ctx, user, args);
  },
});

export const complete = mutation({
  args: {
    jobId: v.id("cleaningJobs"),
    notes: v.optional(v.string()),
    guestReady: v.optional(v.boolean()),
    submittedAtDevice: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    // Compatibility alias during migration window.
    const result = await submitForApprovalInternal(ctx, user, {
      jobId: args.jobId,
      notes: args.notes,
      guestReady: args.guestReady,
      submittedAtDevice: args.submittedAtDevice,
    });

    if (!result.ok) {
      throw new ConvexError(
        `Submission gate not passed. ${result.unresolvedCleanerIds.length} cleaner(s) still pending.`,
      );
    }

    return args.jobId;
  },
});

export const excuseCleanerSession = mutation({
  args: {
    jobId: v.id("cleaningJobs"),
    cleanerId: v.id("users"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    requirePrivilegedRole(user);

    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new ConvexError("Job not found.");
    }

    const revision = getCurrentRevision(job);
    const now = Date.now();
    const session = await findSession(ctx, {
      jobId: args.jobId,
      cleanerId: args.cleanerId,
      revision,
    });

    if (!session) {
      await ctx.db.insert("jobExecutionSessions", {
        jobId: args.jobId,
        revision,
        cleanerId: args.cleanerId,
        status: "excused",
        startedAtServer: job.actualStartAt ?? now,
        submittedAtServer: now,
        lastHeartbeatAt: now,
        metadata: { reason: args.reason?.trim() },
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(session._id, {
        status: "excused",
        submittedAtServer: session.submittedAtServer ?? now,
        lastHeartbeatAt: now,
        metadata: {
          ...(session.metadata && typeof session.metadata === "object" ? session.metadata : {}),
          reason: args.reason?.trim(),
        },
        updatedAt: now,
      });
    }

    return {
      ok: true,
      jobId: args.jobId,
      cleanerId: args.cleanerId,
      revision,
    };
  },
});

export const reopenForRework = mutation({
  args: {
    jobId: v.id("cleaningJobs"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    requirePrivilegedRole(user);

    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new ConvexError("Job not found.");
    }

    if (job.status !== "completed" && job.status !== "awaiting_approval") {
      throw new ConvexError(
        `Job cannot be reopened from status "${job.status}".`,
      );
    }

    const now = Date.now();
    const nextRevision = getCurrentRevision(job) + 1;

    if (job.latestSubmissionId) {
      await ctx.db.patch(job.latestSubmissionId, {
        status: "superseded",
        supersededAt: now,
      });
    }

    await ctx.db.patch(args.jobId, {
      status: "rework_required",
      currentRevision: nextRevision,
      actualStartAt: undefined,
      actualEndAt: undefined,
      latestSubmissionId: undefined,
      rejectedAt: now,
      rejectedBy: user._id,
      rejectionReason: args.reason?.trim(),
      updatedAt: now,
    });
    await syncConversationStatusForJob(ctx, {
      jobId: args.jobId,
      nextStatus: "rework_required",
    });

    await dismissNotificationsForJob(ctx, {
      jobId: String(job._id),
      userIds: await listOpsUserIds(ctx),
      types: ["awaiting_approval"],
    });

    await dismissNotificationsForJob(ctx, {
      jobId: String(job._id),
      userIds: job.assignedCleanerIds,
      types: ["job_assigned", "job_completed", "rework_required"],
    });

    return {
      ok: true,
      jobId: args.jobId,
      revision: nextRevision,
    };
  },
});

export const assign = mutation({
  args: {
    jobId: v.id("cleaningJobs"),
    cleanerIds: v.array(v.id("users")),
    notifyCleaners: v.optional(v.boolean()),
    source: v.optional(v.string()),
    overrideReason: v.optional(v.string()),
    returnWarnings: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await getCurrentUser(ctx);
    requirePrivilegedRole(actor);

    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new ConvexError("Job not found.");
    }

    const warnings: string[] = [];
    const propertyCompanyAssignment = await getActivePropertyCompanyAssignment(
      ctx,
      job.propertyId,
    );
    const propertyCompanyId = propertyCompanyAssignment?.companyId ?? null;

    let actorCompanyMembership: Doc<"companyMembers"> | null = null;
    if (actor.role === "manager") {
      actorCompanyMembership = await getLatestActiveCompanyMembership(ctx, actor._id);
      if (
        !actorCompanyMembership ||
        (actorCompanyMembership.role !== "manager" &&
          actorCompanyMembership.role !== "owner")
      ) {
        throw new ConvexError(
          "As a manager, you need an active cleaning company manager membership before you can assign cleaners.",
        );
      }

      if (!propertyCompanyId) {
        throw new ConvexError(
          "Property has no assigned cleaning company. Assign one in Companies Hub.",
        );
      }

      if (actorCompanyMembership.companyId !== propertyCompanyId) {
        throw new ConvexError(
          "Managers can only dispatch for properties assigned to their company.",
        );
      }
    }

    if (!propertyCompanyId) {
      warnings.push(
        "Property has no assigned cleaning company. Manage assignment in Companies Hub.",
      );
    }

    // Validate each cleaner exists and belongs to an active company.
    for (const cleanerId of args.cleanerIds) {
      const cleaner = await ctx.db.get(cleanerId);
      if (!cleaner) {
        throw new ConvexError(`Cleaner not found: ${cleanerId}`);
      }
      if (cleaner.role !== "cleaner") {
        throw new ConvexError(
          `Only users with cleaner role can be assigned (invalid: ${cleaner.email}).`,
        );
      }

      const cleanerMembership = await getLatestActiveCompanyMembership(ctx, cleanerId);
      if (!cleanerMembership) {
        throw new ConvexError(
          `Cleaner ${cleaner.name ?? cleaner.email} has no active cleaning-company assignment. Assign company membership in Team before dispatch.`,
        );
      }

      if (
        actor.role === "manager" &&
        actorCompanyMembership &&
        cleanerMembership.companyId !== actorCompanyMembership.companyId
      ) {
        throw new ConvexError(
          `Manager dispatch cannot assign cleaner ${cleaner.name ?? cleaner.email} from another company.`,
        );
      }

      if (
        propertyCompanyId &&
        cleanerMembership.companyId !== propertyCompanyId
      ) {
        warnings.push(
          `Cleaner ${cleaner.name ?? cleaner.email} belongs to a different company than this property.`,
        );
      }
    }

    const updatedStatus =
      job.status === "scheduled" ? "assigned" : job.status;
    const previousCleanerIds = job.assignedCleanerIds;
    const removedCleanerIds = previousCleanerIds.filter(
      (cleanerId) => !args.cleanerIds.includes(cleanerId),
    );

    const now = Date.now();
    const nextAcks = reconcileAcknowledgements({
      assignedCleanerIds: args.cleanerIds,
      existing: job.acknowledgements,
      assignedAt: now,
      scheduledStartAt: job.scheduledStartAt,
    });
    await ctx.db.patch(args.jobId, {
      assignedCleanerIds: args.cleanerIds,
      acknowledgements: nextAcks,
      status: updatedStatus,
      updatedAt: now,
    });
    await syncConversationStatusForJob(ctx, {
      jobId: args.jobId,
      nextStatus: updatedStatus,
    });

    const conversation = await getJobConversationByJobId(ctx, args.jobId);
    if (conversation) {
      const refreshedJob = await ctx.db.get(args.jobId);
      if (refreshedJob) {
        await seedJobConversationParticipants(ctx, {
          conversationId: conversation._id,
          job: refreshedJob,
        });
      }
    }

    await ctx.db.insert("jobAssignmentAuditEvents", {
      jobId: job._id,
      propertyId: job.propertyId,
      assignedBy: actor._id,
      assignedCleanerIds: args.cleanerIds,
      propertyCompanyId: propertyCompanyId ?? undefined,
      warnings,
      source: args.source?.trim(),
      overrideReason: args.overrideReason?.trim(),
      createdAt: now,
    });

    await dismissNotificationsForJob(ctx, {
      jobId: String(job._id),
      userIds: removedCleanerIds,
      types: ["job_assigned", "rework_required"],
    });

    if (args.notifyCleaners !== false && args.cleanerIds.length > 0) {
      const property = await ctx.db.get(job.propertyId);
      await dismissNotificationsForJob(ctx, {
        jobId: String(job._id),
        userIds: args.cleanerIds,
        types: ["job_assigned"],
      });

      await createNotificationsForUsers(ctx, {
        userIds: args.cleanerIds,
        type: "job_assigned",
        title: "New Job Assigned",
        message: `${property?.name ?? "Property"} has been assigned to you.`,
        data: {
          jobId: job._id,
          propertyId: job.propertyId,
        },
      });
    }

    if (args.returnWarnings) {
      return {
        jobId: args.jobId,
        warnings,
      };
    }

    return args.jobId;
  },
});
