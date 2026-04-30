/**
 * Wave 4 (bandwidth optimization): defer non-critical side effects from
 * job-state-transition mutations into a scheduled internal mutation.
 *
 * The two helpers `syncConversationStatusForJob` and
 * `dismissNotificationsForJob` were previously called inline from 6
 * different transition mutations (`start`, `submitForApproval`,
 * `approve`/`reject`, assignment changes). Each call adds extra reads
 * + writes to the user-perceived critical path even though neither
 * effect is observable to the actor in the same tick:
 *
 *   - Conversation status is used to filter inactive conversations from
 *     the inbox; the actor doesn't see the change immediately.
 *   - Notification dismissal clears server-side rows; the in-app inbox
 *     refreshes reactively a moment later.
 *
 * By scheduling these via `ctx.scheduler.runAfter(0, …)` they run in a
 * separate transaction once the parent commits — same eventual state,
 * but the synchronous mutation returns sooner and uses less bandwidth.
 *
 * Failure semantics: if the parent mutation rolls back, the scheduled
 * side effect never fires (Convex scheduler honours transaction commit).
 * If the side effect itself fails, the parent transition still
 * succeeded — acceptable for both helpers (they're idempotent).
 *
 * One mutation that previously called these helpers is NOT migrated:
 * `complete`/assignment paths whose follow-up code re-reads the
 * conversation immediately depend on the sync having committed first.
 * Those stay inline. See call-site comments in `mutations.ts`.
 */

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import {
  syncConversationStatusForJob,
} from "../conversations/lib";
import { dismissNotificationsForJob } from "../lib/notificationLifecycle";

const JOB_STATUS = v.union(
  v.literal("scheduled"),
  v.literal("assigned"),
  v.literal("in_progress"),
  v.literal("awaiting_approval"),
  v.literal("rework_required"),
  v.literal("completed"),
  v.literal("cancelled"),
);

const NOTIFICATION_TYPE = v.union(
  v.literal("job_assigned"),
  v.literal("job_at_risk"),
  v.literal("job_completed"),
  v.literal("awaiting_approval"),
  v.literal("rework_required"),
  v.literal("incident_created"),
  v.literal("low_stock"),
  v.literal("message_received"),
  v.literal("system"),
);

/**
 * Apply the optional conversation-status sync + zero or more notification
 * dismissal batches for a job. Designed to be scheduled via
 * `ctx.scheduler.runAfter(0, internal.cleaningJobs.sideEffects.applyTransitionSideEffects, …)`
 * from any state-transition mutation whose post-transition cleanup
 * doesn't read these effects back.
 */
export const applyTransitionSideEffects = internalMutation({
  args: {
    jobId: v.id("cleaningJobs"),
    /** When set, sync linked conversations to open/closed based on this status. */
    syncToStatus: v.optional(JOB_STATUS),
    /** Zero or more independent dismissal batches. Each batch dismisses
     *  any notification of the listed types attached to this job for
     *  the listed users. */
    dismissals: v.array(
      v.object({
        userIds: v.array(v.id("users")),
        types: v.array(NOTIFICATION_TYPE),
      }),
    ),
  },
  returns: v.object({
    syncedConversations: v.number(),
    dismissedNotifications: v.number(),
  }),
  handler: async (ctx, args) => {
    let syncedConversations = 0;
    if (args.syncToStatus) {
      const ids = await syncConversationStatusForJob(ctx, {
        jobId: args.jobId,
        nextStatus: args.syncToStatus as Doc<"cleaningJobs">["status"],
      });
      syncedConversations = ids.length;
    }

    let dismissedNotifications = 0;
    for (const batch of args.dismissals) {
      const result = await dismissNotificationsForJob(ctx, {
        jobId: String(args.jobId),
        userIds: batch.userIds,
        types: batch.types,
      });
      dismissedNotifications += result.count;
    }

    return { syncedConversations, dismissedNotifications };
  },
});
