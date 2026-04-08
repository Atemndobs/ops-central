import { v } from "convex/values";
import { query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { getCurrentUser, requireRole } from "../lib/auth";
import { createExternalReadUrl, getExternalStorageConfigOrNull } from "../lib/externalStorage";
import { resolvePhotoAccessUrl } from "../lib/photoUrls";
import { assertReviewerRole } from "./reviewAccess";

const CLEANER_SESSION_DONE_STATUSES = new Set(["submitted", "excused"]);
const JOB_STATUS_FILTER = v.union(
  v.literal("scheduled"),
  v.literal("assigned"),
  v.literal("in_progress"),
  v.literal("awaiting_approval"),
  v.literal("rework_required"),
  v.literal("completed"),
  v.literal("cancelled"),
);

async function enrichJobs(ctx: QueryCtx, jobs: Doc<"cleaningJobs">[]) {
  const uniquePropertyIds = [...new Set(jobs.map((job) => job.propertyId))];
  const uniqueCleanerIds = [
    ...new Set(jobs.flatMap((job) => job.assignedCleanerIds)),
  ];

  const [fetchedProperties, fetchedCleaners] = await Promise.all([
    Promise.all(uniquePropertyIds.map((id) => ctx.db.get(id))),
    Promise.all(uniqueCleanerIds.map((id) => ctx.db.get(id))),
  ]);

  const propertyById = new Map(
    fetchedProperties
      .filter(Boolean)
      .map(
        (property) =>
          [
            property!._id,
            {
              _id: property!._id,
              name: property!.name,
              address: property!.address,
            },
          ] as const,
      ),
  );

  const cleanerById = new Map(
    fetchedCleaners
      .filter(Boolean)
      .map(
        (cleaner) =>
          [
            cleaner!._id,
            {
              _id: cleaner!._id,
              name: cleaner!.name,
              email: cleaner!.email,
              avatarUrl: cleaner!.avatarUrl,
            },
          ] as const,
      ),
  );

  return jobs.map((job) => ({
    ...job,
    property: propertyById.get(job.propertyId) ?? null,
    cleaners: job.assignedCleanerIds
      .map((id) => cleanerById.get(id) ?? null)
      .filter(Boolean),
  }));
}

async function resolveSnapshotPhotoUrl(
  ctx: QueryCtx,
  snapshotPhoto: {
    photoId: Id<"photos">;
    storageId?: Id<"_storage">;
    provider?: string;
    bucket?: string;
    objectKey?: string;
  },
): Promise<string | null> {
  if (snapshotPhoto.storageId) {
    return ctx.storage.getUrl(snapshotPhoto.storageId);
  }

  if (snapshotPhoto.provider && snapshotPhoto.bucket && snapshotPhoto.objectKey) {
    const config = getExternalStorageConfigOrNull();
    if (!config) {
      return null;
    }
    try {
      return await createExternalReadUrl({
        bucket: snapshotPhoto.bucket,
        objectKey: snapshotPhoto.objectKey,
      });
    } catch {
      return null;
    }
  }

  const livePhoto = await ctx.db.get(snapshotPhoto.photoId);
  if (!livePhoto) {
    return null;
  }
  return resolvePhotoAccessUrl(ctx, livePhoto);
}

function getCurrentRevision(job: Doc<"cleaningJobs">): number {
  return job.currentRevision ?? 1;
}

function isActiveCompanyPropertyAssignment(
  assignment: Doc<"companyProperties">,
): boolean {
  return assignment.isActive !== false && assignment.unassignedAt === undefined;
}

function isActiveMembership(membership: Doc<"companyMembers">): boolean {
  return membership.isActive && membership.leftAt === undefined;
}

async function getLatestActiveCompanyMembership(
  ctx: QueryCtx,
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

export const getAll = query({
  args: {
    status: v.optional(JOB_STATUS_FILTER),
    propertyId: v.optional(v.id("properties")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let jobs;

    if (args.status && args.propertyId) {
      jobs = await ctx.db
        .query("cleaningJobs")
        .withIndex("by_property_status", (q) =>
          q.eq("propertyId", args.propertyId!).eq("status", args.status!),
        )
        .collect();
    } else if (args.status) {
      jobs = await ctx.db
        .query("cleaningJobs")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
    } else if (args.propertyId) {
      jobs = await ctx.db
        .query("cleaningJobs")
        .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId!))
        .collect();
    } else {
      jobs = await ctx.db
        .query("cleaningJobs")
        .withIndex("by_scheduled")
        .collect();
    }

    const sorted = jobs.sort((a, b) => b.scheduledStartAt - a.scheduledStartAt);
    const limited = args.limit != null ? sorted.slice(0, args.limit) : sorted;
    return await enrichJobs(ctx, limited);
  },
});

export const getById = query({
  args: {
    jobId: v.id("cleaningJobs"),
  },
  handler: async (ctx, args) => {
    const detail = await getJobDetailInternal(ctx, args.jobId);
    if (!detail) {
      return null;
    }
    return {
      ...detail.job,
      property: detail.property,
      cleaners: detail.cleaners,
      photos: detail.evidence.current.byType.all,
    };
  },
});

export const getMyAssigned = query({
  args: {
    status: v.optional(JOB_STATUS_FILTER),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    const allJobs = await ctx.db.query("cleaningJobs").collect();
    let jobs = allJobs.filter((job) => job.assignedCleanerIds.includes(user._id));

    if (args.status) {
      jobs = jobs.filter((job) => job.status === args.status);
    }
    if (typeof args.from === "number") {
      jobs = jobs.filter((job) => job.scheduledStartAt >= args.from!);
    }
    if (typeof args.to === "number") {
      jobs = jobs.filter((job) => job.scheduledStartAt <= args.to!);
    }

    const sorted = jobs.sort((a, b) => a.scheduledStartAt - b.scheduledStartAt);
    const safeLimit =
      typeof args.limit === "number" && Number.isFinite(args.limit)
        ? Math.max(1, Math.min(500, Math.floor(args.limit)))
        : 200;
    return await enrichJobs(ctx, sorted.slice(0, safeLimit));
  },
});

export const getMyJobDetail = query({
  args: {
    jobId: v.id("cleaningJobs"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const detail = await getJobDetailInternal(ctx, args.jobId);
    if (!detail) {
      return null;
    }

    const isPrivileged =
      user.role === "admin" || user.role === "manager" || user.role === "property_ops";
    const isAssignedCleaner = detail.job.assignedCleanerIds.includes(user._id);

    if (!isPrivileged && !isAssignedCleaner) {
      throw new Error("You are not authorized to access this job.");
    }

    return detail;
  },
});

export const getReviewQueue = query({
  args: {
    status: v.optional(JOB_STATUS_FILTER),
    propertyId: v.optional(v.id("properties")),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    assertReviewerRole(user.role);

    let jobs;
    if (args.status && args.propertyId) {
      jobs = await ctx.db
        .query("cleaningJobs")
        .withIndex("by_property_status", (q) =>
          q.eq("propertyId", args.propertyId!).eq("status", args.status!),
        )
        .collect();
    } else if (args.status) {
      jobs = await ctx.db
        .query("cleaningJobs")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
    } else if (args.propertyId) {
      jobs = await ctx.db
        .query("cleaningJobs")
        .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId!))
        .collect();
    } else {
      jobs = await ctx.db
        .query("cleaningJobs")
        .withIndex("by_scheduled")
        .collect();
    }

    if (typeof args.from === "number") {
      jobs = jobs.filter((job) => job.scheduledStartAt >= args.from!);
    }
    if (typeof args.to === "number") {
      jobs = jobs.filter((job) => job.scheduledStartAt <= args.to!);
    }

    const statusPriority: Record<Doc<"cleaningJobs">["status"], number> = {
      awaiting_approval: 0,
      rework_required: 1,
      in_progress: 2,
      assigned: 3,
      scheduled: 4,
      completed: 5,
      cancelled: 6,
    };

    const sorted = jobs.sort((a, b) => {
      const priorityDiff = statusPriority[a.status] - statusPriority[b.status];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return b.scheduledStartAt - a.scheduledStartAt;
    });

    const safeLimit =
      typeof args.limit === "number" && Number.isFinite(args.limit)
        ? Math.max(1, Math.min(500, Math.floor(args.limit)))
        : 200;

    return await enrichJobs(ctx, sorted.slice(0, safeLimit));
  },
});

export const getReviewJobDetail = query({
  args: {
    jobId: v.id("cleaningJobs"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    assertReviewerRole(user.role);

    return await getJobDetailInternal(ctx, args.jobId);
  },
});

export const getForCleaner = query({
  args: {
    cleanerId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const allJobs = await ctx.db.query("cleaningJobs").collect();
    const jobs = allJobs.filter((job) =>
      job.assignedCleanerIds.includes(args.cleanerId),
    );
    const enriched = await enrichJobs(ctx, jobs);
    return enriched.sort((a, b) => b.scheduledStartAt - a.scheduledStartAt);
  },
});

export const getAssignableCleanersByProperty = query({
  args: {
    propertyIds: v.array(v.id("properties")),
  },
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, ["admin", "property_ops", "manager"]);

    const propertyIds = [...new Set(args.propertyIds)];
    if (propertyIds.length === 0) {
      return [];
    }

    const actorCompanyMembership =
      actor.role === "manager"
        ? await getLatestActiveCompanyMembership(ctx, actor._id)
        : null;
    const managerMissingMembership =
      actor.role === "manager" &&
      (!actorCompanyMembership ||
        (actorCompanyMembership.role !== "manager" &&
          actorCompanyMembership.role !== "owner"));

    const assignmentsByProperty = await Promise.all(
      propertyIds.map(async (propertyId) => {
        const assignments = await ctx.db
          .query("companyProperties")
          .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
          .collect();

        const sortedAssignments = assignments.sort(
          (a, b) => b.assignedAt - a.assignedAt,
        );
        const latestAssignment =
          sortedAssignments.find(isActiveCompanyPropertyAssignment) ?? null;

        return {
          propertyId,
          assignment: latestAssignment,
        };
      }),
    );

    const companyIds = [
      ...new Set(
        assignmentsByProperty
          .map((item) => item.assignment?.companyId)
          .filter((companyId): companyId is Id<"cleaningCompanies"> =>
            Boolean(companyId),
          ),
      ),
    ];

    const companyDocs = await Promise.all(
      companyIds.map((companyId) => ctx.db.get(companyId)),
    );
    const companyById = new Map(
      companyDocs
        .filter((company): company is Doc<"cleaningCompanies"> => company !== null)
        .map((company) => [company._id, company] as const),
    );

    const cleanersByCompany = new Map<
      Id<"cleaningCompanies">,
      Array<{
        _id: Id<"users">;
        name?: string;
        email: string;
      }>
    >();

    for (const companyId of companyIds) {
      const members = await ctx.db
        .query("companyMembers")
        .withIndex("by_company_role", (q) =>
          q.eq("companyId", companyId).eq("role", "cleaner"),
        )
        .collect();

      const activeMemberIds = members
        .filter((member) => member.isActive && member.leftAt === undefined)
        .map((member) => member.userId);

      const cleanerDocs = await Promise.all(
        activeMemberIds.map((userId) => ctx.db.get(userId)),
      );

      const cleaners = cleanerDocs
        .filter((cleaner): cleaner is Doc<"users"> => cleaner !== null)
        .filter((cleaner) => cleaner.role === "cleaner")
        .map((cleaner) => ({
          _id: cleaner._id,
          name: cleaner.name,
          email: cleaner.email,
        }))
        .sort((a, b) =>
          (a.name ?? a.email).localeCompare(b.name ?? b.email),
        );

      cleanersByCompany.set(companyId, cleaners);
    }

    return assignmentsByProperty.map(({ propertyId, assignment }) => {
      const companyId = assignment?.companyId ?? null;
      let blockedReason: string | null = null;

      if (managerMissingMembership) {
        blockedReason =
          "As a manager, you need an active cleaning company manager membership before you can assign cleaners.";
      } else if (!companyId) {
        blockedReason =
          "This property has no cleaning company assigned yet.";
      } else if (
        actor.role === "manager" &&
        actorCompanyMembership &&
        actorCompanyMembership.companyId !== companyId
      ) {
        blockedReason =
          "Managers can only assign cleaners for properties linked to their own company.";
      }

      return {
        propertyId,
        companyId,
        companyName: companyId ? companyById.get(companyId)?.name ?? null : null,
        blockedReason,
        cleaners:
          !blockedReason && companyId ? cleanersByCompany.get(companyId) ?? [] : [],
      };
    });
  },
});

async function getJobDetailInternal(ctx: QueryCtx, jobId: Id<"cleaningJobs">) {
  const job = await ctx.db.get(jobId);
  if (!job) {
    return null;
  }

  const [enriched] = await enrichJobs(ctx, [job]);
  const manager = job.assignedManagerId
    ? await ctx.db.get(job.assignedManagerId)
    : null;

  const revision = getCurrentRevision(job);
  const [sessions, photos, submissions] = await Promise.all([
    ctx.db
      .query("jobExecutionSessions")
      .withIndex("by_job_and_revision", (q) =>
        q.eq("jobId", jobId).eq("revision", revision),
      )
      .collect(),
    ctx.db
      .query("photos")
      .withIndex("by_job", (q) => q.eq("cleaningJobId", jobId))
      .collect(),
    ctx.db
      .query("jobSubmissions")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .collect(),
  ]);

  const cleanerIdsInSessions = [...new Set(sessions.map((session) => session.cleanerId))];
  const cleanerDocs = await Promise.all(
    cleanerIdsInSessions.map((cleanerId) => ctx.db.get(cleanerId)),
  );
  const cleanerById = new Map(
    cleanerDocs
      .filter(Boolean)
      .map((cleaner) => [cleaner!._id, cleaner!] as const),
  );

  const currentPhotoUrls = await Promise.all(
    photos.map((photo) => resolvePhotoAccessUrl(ctx, photo)),
  );
  const currentPhotos = photos.map((photo, index) => ({
    photoId: photo._id,
    storageId: photo.storageId,
    provider: photo.provider,
    bucket: photo.bucket,
    objectKey: photo.objectKey,
    objectVersion: photo.objectVersion,
    roomName: photo.roomName,
    type: photo.type,
    source: photo.source,
    notes: photo.notes,
    uploadedAt: photo.uploadedAt,
    uploadedBy: photo.uploadedBy,
    url: currentPhotoUrls[index] ?? null,
  }));

  const currentByRoomMap = new Map<
    string,
    {
      roomName: string;
      before: number;
      after: number;
      incident: number;
    }
  >();
  currentPhotos.forEach((photo) => {
    const roomName = photo.roomName.trim() || "Unspecified";
    const current = currentByRoomMap.get(roomName) ?? {
      roomName,
      before: 0,
      after: 0,
      incident: 0,
    };
    if (photo.type === "before") current.before += 1;
    if (photo.type === "after") current.after += 1;
    if (photo.type === "incident") current.incident += 1;
    currentByRoomMap.set(roomName, current);
  });

  const sortedSubmissions = submissions.sort((a, b) => b.revision - a.revision);
  const latestSubmission =
    sortedSubmissions.find((submission) => submission.status === "sealed") ??
    sortedSubmissions[0] ??
    null;

  let latestSubmissionEvidence: Array<{
    photoId: Id<"photos">;
    storageId?: Id<"_storage">;
    provider?: string;
    bucket?: string;
    objectKey?: string;
    objectVersion?: string;
    roomName: string;
    type: "before" | "after" | "incident";
    uploadedAt: number;
    uploadedBy?: Id<"users">;
    url: string | null;
  }> = [];

  if (latestSubmission) {
    const latestUrls = await Promise.all(
      latestSubmission.photoSnapshot.map((photo) => resolveSnapshotPhotoUrl(ctx, photo)),
    );
    latestSubmissionEvidence = latestSubmission.photoSnapshot.map((photo, index) => ({
      ...photo,
      url: latestUrls[index] ?? null,
    }));
  }

  const sessionsByCleaner = new Map(
    sessions.map((session) => [session.cleanerId, session]),
  );
  const unresolvedCleanerIds = job.assignedCleanerIds.filter((cleanerId) => {
    const session = sessionsByCleaner.get(cleanerId);
    if (!session) {
      return true;
    }
    return !CLEANER_SESSION_DONE_STATUSES.has(session.status);
  });

  const now = Date.now();
  const effectiveStartAt =
    job.actualStartAt ??
    sessions
      .map((session) => session.startedAtServer)
      .sort((a, b) => a - b)[0];
  const effectiveEndAt =
    job.actualEndAt ?? latestSubmission?.submittedAtServer ?? undefined;
  const elapsedMs =
    effectiveStartAt !== undefined
      ? (effectiveEndAt ?? now) - effectiveStartAt
      : null;

  return {
    job: enriched,
    property: enriched.property,
    cleaners: enriched.cleaners,
    manager: manager
      ? {
          _id: manager._id,
          name: manager.name,
          email: manager.email,
        }
      : null,
    currentRevision: revision,
    execution: {
      unresolvedCleanerIds,
      sessions: sessions.map((session) => ({
        ...session,
        cleaner: cleanerById.get(session.cleanerId)
          ? {
              _id: session.cleanerId,
              name: cleanerById.get(session.cleanerId)?.name,
              email: cleanerById.get(session.cleanerId)?.email,
            }
          : null,
      })),
    },
    timing: {
      startedAtServer: effectiveStartAt ?? null,
      endedAtServer: effectiveEndAt ?? null,
      elapsedMs,
    },
    evidence: {
      current: {
        byType: {
          before: currentPhotos.filter((photo) => photo.type === "before"),
          after: currentPhotos.filter((photo) => photo.type === "after"),
          incident: currentPhotos.filter((photo) => photo.type === "incident"),
          all: currentPhotos,
        },
        byRoom: [...currentByRoomMap.values()].sort((a, b) =>
          a.roomName.localeCompare(b.roomName),
        ),
      },
      latestSubmission: latestSubmission
        ? {
            _id: latestSubmission._id,
            revision: latestSubmission.revision,
            status: latestSubmission.status,
            submittedBy: latestSubmission.submittedBy,
            submittedAtServer: latestSubmission.submittedAtServer,
            submittedAtDevice: latestSubmission.submittedAtDevice,
            validationResult: latestSubmission.validationResult,
            sealedHash: latestSubmission.sealedHash,
            roomReviewSnapshot: latestSubmission.roomReviewSnapshot ?? [],
            photos: latestSubmissionEvidence,
            checklistSnapshot: latestSubmission.checklistSnapshot,
            incidentSnapshot: latestSubmission.incidentSnapshot,
          }
        : null,
      submissionHistory: sortedSubmissions.map((submission) => ({
        _id: submission._id,
        revision: submission.revision,
        status: submission.status,
        submittedBy: submission.submittedBy,
        submittedAtServer: submission.submittedAtServer,
        supersededAt: submission.supersededAt,
        photoCount: submission.photoSnapshot.length,
        beforeCount: submission.photoSnapshot.filter((photo) => photo.type === "before")
          .length,
        afterCount: submission.photoSnapshot.filter((photo) => photo.type === "after")
          .length,
        incidentCount: submission.photoSnapshot.filter(
          (photo) => photo.type === "incident",
        ).length,
      })),
    },
  };
}

export const getJobDetail = query({
  args: {
    jobId: v.id("cleaningJobs"),
  },
  handler: async (ctx, args) => {
    return await getJobDetailInternal(ctx, args.jobId);
  },
});

export const getJobLivePresence = query({
  args: {
    jobId: v.id("cleaningJobs"),
    staleAfterMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      return null;
    }

    const revision = getCurrentRevision(job);
    const staleAfterMs = Math.max(30_000, Math.floor(args.staleAfterMs ?? 180_000));
    const now = Date.now();

    const sessions = await ctx.db
      .query("jobExecutionSessions")
      .withIndex("by_job_and_revision", (q) =>
        q.eq("jobId", args.jobId).eq("revision", revision),
      )
      .collect();

    const cleanerIds = [...new Set(sessions.map((session) => session.cleanerId))];
    const cleanerDocs = await Promise.all(
      cleanerIds.map((cleanerId) => ctx.db.get(cleanerId)),
    );
    const cleanerById = new Map(
      cleanerDocs
        .filter(Boolean)
        .map((cleaner) => [cleaner!._id, cleaner!] as const),
    );

    const sessionsByCleaner = new Map(
      sessions.map((session) => [session.cleanerId, session]),
    );
    const pendingCleanerIds = job.assignedCleanerIds.filter((cleanerId) => {
      const session = sessionsByCleaner.get(cleanerId);
      if (!session) {
        return true;
      }
      return !CLEANER_SESSION_DONE_STATUSES.has(session.status);
    });

    const enrichedSessions = sessions
      .map((session) => {
        const heartbeat = session.lastHeartbeatAt ?? session.startedAtServer;
        const ageMs = Math.max(0, now - heartbeat);
        const isStale = ageMs > staleAfterMs;
        const cleaner = cleanerById.get(session.cleanerId);
        return {
          ...session,
          cleaner: cleaner
            ? {
                _id: cleaner._id,
                name: cleaner.name,
                email: cleaner.email,
              }
            : null,
          isStale,
          secondsSinceHeartbeat: Math.floor(ageMs / 1000),
        };
      })
      .sort((a, b) => {
        const aTime = a.lastHeartbeatAt ?? a.startedAtServer;
        const bTime = b.lastHeartbeatAt ?? b.startedAtServer;
        return bTime - aTime;
      });

    return {
      jobId: args.jobId,
      jobStatus: job.status,
      revision,
      now,
      staleAfterMs,
      summary: {
        assignedCount: job.assignedCleanerIds.length,
        startedCount: enrichedSessions.filter((session) => session.status === "started")
          .length,
        submittedCount: enrichedSessions.filter(
          (session) => session.status === "submitted",
        ).length,
        excusedCount: enrichedSessions.filter((session) => session.status === "excused")
          .length,
        pendingCount: pendingCleanerIds.length,
        gatePassed: pendingCleanerIds.length === 0,
      },
      pendingCleanerIds,
      sessions: enrichedSessions,
    };
  },
});
