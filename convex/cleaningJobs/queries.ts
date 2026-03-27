import { v } from "convex/values";
import { query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

const CLEANER_SESSION_DONE_STATUSES = new Set(["submitted", "excused"]);

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

async function getPhotoUrlMap(
  ctx: QueryCtx,
  storageIds: Id<"_storage">[],
): Promise<Map<Id<"_storage">, string | null>> {
  const uniqueStorageIds = [...new Set(storageIds)];
  const urls = await Promise.all(
    uniqueStorageIds.map((storageId) => ctx.storage.getUrl(storageId)),
  );
  return new Map(uniqueStorageIds.map((storageId, index) => [storageId, urls[index] ?? null]));
}

function getCurrentRevision(job: Doc<"cleaningJobs">): number {
  return job.currentRevision ?? 1;
}

export const getAll = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("scheduled"),
        v.literal("assigned"),
        v.literal("in_progress"),
        v.literal("awaiting_approval"),
        v.literal("rework_required"),
        v.literal("completed"),
        v.literal("cancelled"),
      ),
    ),
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

  const photoUrlMap = await getPhotoUrlMap(
    ctx,
    photos.map((photo) => photo.storageId),
  );
  const currentPhotos = photos.map((photo) => ({
    photoId: photo._id,
    storageId: photo.storageId,
    roomName: photo.roomName,
    type: photo.type,
    source: photo.source,
    notes: photo.notes,
    uploadedAt: photo.uploadedAt,
    uploadedBy: photo.uploadedBy,
    url: photoUrlMap.get(photo.storageId) ?? null,
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
    storageId: Id<"_storage">;
    roomName: string;
    type: "before" | "after" | "incident";
    uploadedAt: number;
    uploadedBy?: Id<"users">;
    url: string | null;
  }> = [];

  if (latestSubmission) {
    const latestUrlMap = await getPhotoUrlMap(
      ctx,
      latestSubmission.photoSnapshot.map((photo) => photo.storageId),
    );
    latestSubmissionEvidence = latestSubmission.photoSnapshot.map((photo) => ({
      ...photo,
      url: latestUrlMap.get(photo.storageId) ?? null,
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
