import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { getCurrentUser } from "../lib/auth";
import {
  createNotificationsForUsers,
  createOpsNotifications,
} from "../lib/opsNotifications";

const DEFAULT_ACK_WINDOW_MS = 2 * 60 * 60 * 1000;
const MIN_ACK_WINDOW_MS = 10 * 60 * 1000;
const PRE_START_BUFFER_MS = 30 * 60 * 1000;

type Acknowledgement = NonNullable<
  Doc<"cleaningJobs">["acknowledgements"]
>[number];

function computeAckExpiry(args: {
  assignedAt: number;
  scheduledStartAt: number;
}): number {
  const { assignedAt, scheduledStartAt } = args;
  const preStart = scheduledStartAt - PRE_START_BUFFER_MS;
  const defaultWindow = assignedAt + DEFAULT_ACK_WINDOW_MS;
  const minFloor = assignedAt + MIN_ACK_WINDOW_MS;
  return Math.max(minFloor, Math.min(defaultWindow, preStart));
}

/**
 * Reconcile the acknowledgements array for a job against its current
 * assignedCleanerIds. Drops stale entries, seeds pending entries for new
 * cleaners, and preserves prior state for unchanged cleaners.
 */
export function reconcileAcknowledgements(args: {
  assignedCleanerIds: Id<"users">[];
  existing: Acknowledgement[] | undefined;
  assignedAt: number;
  scheduledStartAt: number;
}): Acknowledgement[] {
  const expiresAt = computeAckExpiry({
    assignedAt: args.assignedAt,
    scheduledStartAt: args.scheduledStartAt,
  });
  const existingByCleaner = new Map(
    (args.existing ?? []).map((ack) => [ack.cleanerId, ack] as const),
  );

  return args.assignedCleanerIds.map((cleanerId) => {
    const prior = existingByCleaner.get(cleanerId);
    if (prior) {
      return prior;
    }
    return {
      cleanerId,
      state: "pending" as const,
      assignedAt: args.assignedAt,
      expiresAt,
    };
  });
}

/**
 * Mark a cleaner's acknowledgement as accepted in place. Returns the updated
 * array if changed, or the original reference otherwise.
 */
export function markAcknowledgementAccepted(
  acks: Acknowledgement[] | undefined,
  args: { cleanerId: Id<"users">; now: number },
): Acknowledgement[] | undefined {
  if (!acks || acks.length === 0) {
    return acks;
  }
  let changed = false;
  const next = acks.map((ack) => {
    if (ack.cleanerId !== args.cleanerId) {
      return ack;
    }
    if (ack.state === "accepted") {
      return ack;
    }
    changed = true;
    return {
      ...ack,
      state: "accepted" as const,
      respondedAt: args.now,
    };
  });
  return changed ? next : acks;
}

async function listOpsUserIds(ctx: MutationCtx): Promise<Id<"users">[]> {
  const users = await ctx.db.query("users").collect();
  return users
    .filter(
      (user) =>
        user.role === "admin" ||
        user.role === "property_ops" ||
        user.role === "manager",
    )
    .map((user) => user._id);
}

export const acknowledge = mutation({
  args: {
    jobId: v.id("cleaningJobs"),
    decision: v.union(v.literal("accept"), v.literal("decline")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new ConvexError("Job not found.");
    }

    if (user.role !== "cleaner") {
      throw new ConvexError("Only cleaners can acknowledge assignments.");
    }
    if (!job.assignedCleanerIds.includes(user._id)) {
      throw new ConvexError("You are not assigned to this job.");
    }

    const now = Date.now();
    const reason = args.reason?.trim();
    if (args.decision === "decline" && !reason) {
      throw new ConvexError("Please provide a short reason for declining.");
    }

    const reconciled = reconcileAcknowledgements({
      assignedCleanerIds: job.assignedCleanerIds,
      existing: job.acknowledgements,
      assignedAt: now,
      scheduledStartAt: job.scheduledStartAt,
    });

    let found = false;
    const nextAcks = reconciled.map((ack) => {
      if (ack.cleanerId !== user._id) {
        return ack;
      }
      found = true;
      return {
        ...ack,
        state:
          args.decision === "accept"
            ? ("accepted" as const)
            : ("declined" as const),
        respondedAt: now,
        reason: reason ?? ack.reason,
      };
    });

    if (!found) {
      throw new ConvexError("Acknowledgement record missing.");
    }

    await ctx.db.patch(args.jobId, {
      acknowledgements: nextAcks,
      updatedAt: now,
    });

    await schedulePendingAcknowledgementEscalation(ctx, {
      jobId: args.jobId,
      acks: nextAcks,
    });

    if (args.decision === "decline") {
      const property = await ctx.db.get(job.propertyId);
      await createOpsNotifications(ctx, {
        type: "job_at_risk",
        title: "Cleaner declined assignment",
        message: `${user.name ?? user.email} declined ${property?.name ?? "a job"}: ${reason}`,
        data: {
          jobId: job._id,
          propertyId: job.propertyId,
          cleanerId: user._id,
          reason,
        },
      });
    }

    return {
      ok: true,
      decision: args.decision,
      state: args.decision === "accept" ? "accepted" : "declined",
    };
  },
});

async function escalateExpiredAcksForJob(
  ctx: MutationCtx,
  job: Doc<"cleaningJobs">,
  now: number,
): Promise<number> {
  const acks = job.acknowledgements;
  if (!acks || acks.length === 0) {
    return 0;
  }
  const jobExpired: Id<"users">[] = [];
  const nextAcks = acks.map((ack) => {
    if (
      ack.state === "pending" &&
      ack.expiresAt <= now &&
      ack.notifiedOpsAt === undefined
    ) {
      jobExpired.push(ack.cleanerId);
      return {
        ...ack,
        state: "expired" as const,
        respondedAt: now,
        notifiedOpsAt: now,
      };
    }
    return ack;
  });

  if (jobExpired.length === 0) {
    return 0;
  }

  await ctx.db.patch(job._id, {
    acknowledgements: nextAcks,
    updatedAt: now,
  });

  const property = await ctx.db.get(job.propertyId);
  const cleanerDocs = await Promise.all(
    jobExpired.map((cleanerId) => ctx.db.get(cleanerId)),
  );
  const cleanerNames = cleanerDocs
    .filter((cleaner): cleaner is Doc<"users"> => cleaner !== null)
    .map((cleaner) => cleaner.name ?? cleaner.email)
    .join(", ");

  const opsUserIds = await listOpsUserIds(ctx);
  await createNotificationsForUsers(ctx, {
    userIds: opsUserIds,
    type: "job_at_risk",
    title: "Assignment not acknowledged",
    message: `${cleanerNames || "Cleaner"} has not accepted ${property?.name ?? "a job"} in time.`,
    data: {
      jobId: job._id,
      propertyId: job.propertyId,
      cleanerIds: jobExpired,
      reason: "acknowledgement_expired",
    },
  });

  return jobExpired.length;
}

/**
 * Event-driven escalation for a single job. Scheduled via ctx.scheduler.runAt
 * at the acknowledgement's expiry time from the mutation that seeded it.
 * Idempotent: only pending + expired + not-yet-notified acks are escalated,
 * so redundant schedules are safe no-ops.
 */
export const escalateOne = internalMutation({
  args: { jobId: v.id("cleaningJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      return { escalatedAcks: 0 };
    }
    if (job.status !== "scheduled" && job.status !== "assigned") {
      return { escalatedAcks: 0 };
    }
    const escalatedAcks = await escalateExpiredAcksForJob(ctx, job, Date.now());
    return { escalatedAcks };
  },
});

/**
 * After a mutation seeds new pending acknowledgements, schedule a single
 * escalation run at the earliest pending expiry. Replaces the polling cron.
 */
export async function schedulePendingAcknowledgementEscalation(
  ctx: MutationCtx,
  args: {
    jobId: Id<"cleaningJobs">;
    acks: Acknowledgement[] | undefined;
  },
): Promise<void> {
  if (!args.acks || args.acks.length === 0) {
    return;
  }
  let earliest: number | null = null;
  for (const ack of args.acks) {
    if (ack.state !== "pending") continue;
    if (ack.notifiedOpsAt !== undefined) continue;
    if (earliest === null || ack.expiresAt < earliest) {
      earliest = ack.expiresAt;
    }
  }
  if (earliest === null) {
    return;
  }
  await ctx.scheduler.runAt(
    earliest,
    internal.cleaningJobs.acknowledgements.escalateOne,
    { jobId: args.jobId },
  );
}

/**
 * Backstop sweep: retained for one deploy cycle as a safety net while
 * already-in-flight acknowledgements (seeded before the event-driven path
 * shipped) drain out. Delete after verifying logs show zero escalations.
 */
export const escalateExpiredAcknowledgements = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const candidateStatuses: Array<Doc<"cleaningJobs">["status"]> = [
      "scheduled",
      "assigned",
    ];

    const candidateJobs: Doc<"cleaningJobs">[] = [];
    for (const status of candidateStatuses) {
      const jobs = await ctx.db
        .query("cleaningJobs")
        .withIndex("by_status", (q) => q.eq("status", status))
        .collect();
      candidateJobs.push(...jobs);
    }

    let escalatedJobs = 0;
    let escalatedAcks = 0;
    for (const job of candidateJobs) {
      const count = await escalateExpiredAcksForJob(ctx, job, now);
      if (count > 0) {
        escalatedJobs += 1;
        escalatedAcks += count;
      }
    }

    return { escalatedJobs, escalatedAcks, checkedAt: now };
  },
});
