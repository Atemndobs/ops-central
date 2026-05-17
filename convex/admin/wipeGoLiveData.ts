/**
 * DESTRUCTIVE — pre-go-live wipe of accumulated test/old data.
 *
 * Targets (per 2026-05-17 user request):
 *   - Tasks            → opsTasks, opsTaskComments
 *   - Incidents        → incidents
 *   - Messages         → conversations, conversationParticipants,
 *                        conversationMessages, conversationMessageAttachments,
 *                        messageTransportEvents
 *
 * Explicitly NOT touched:
 *   - opsTaskTemplates, opsTaskRecurrences (config — keep templates so
 *     recurrence still generates new tasks post-go-live)
 *   - cleaningJobs (already cleaned up via markPastDone — those are
 *     real work items)
 *   - photos, jobSubmissions, jobExecutionSessions (related to cleaning
 *     jobs, not part of this wipe)
 *   - users, companies, properties (entities, not transactional data)
 *
 * Usage:
 *   # ALWAYS run dry-run first
 *   npx convex run admin/wipeGoLiveData:wipeGoLiveData '{"dryRun": true}'
 *
 *   # Apply
 *   npx convex run admin/wipeGoLiveData:wipeGoLiveData '{}'
 *
 *   # Apply only a subset (e.g. just messages)
 *   npx convex run admin/wipeGoLiveData:wipeGoLiveData '{"only": ["messages"]}'
 *
 * Mutation page-limit safety: Convex mutations cap ~8k doc writes per call.
 * For each table we cap the per-call delete count at MAX_DELETES_PER_CALL
 * (default 4000) and return `truncated: true` if we hit the cap, so the
 * caller knows to run the mutation again to drain the remainder.
 */
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

const MAX_DELETES_PER_CALL = 4000;

const GROUPS = ["tasks", "incidents", "messages"] as const;
type Group = (typeof GROUPS)[number];

export const wipeGoLiveData = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    only: v.optional(v.array(v.union(v.literal("tasks"), v.literal("incidents"), v.literal("messages")))),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;
    const groups: Set<Group> = new Set(args.only ?? GROUPS);

    let budget = MAX_DELETES_PER_CALL;
    const counts: Record<string, number> = {};
    let truncated = false;

    async function eat<T extends { _id: any }>(label: string, rows: T[]) {
      counts[label] = (counts[label] ?? 0) + rows.length;
      if (dryRun) return;
      for (const r of rows) {
        if (budget <= 0) {
          truncated = true;
          return;
        }
        await ctx.db.delete(r._id as any);
        budget--;
      }
    }

    // ------- Tasks -------
    if (groups.has("tasks")) {
      const tasks = await ctx.db.query("opsTasks").collect();
      const comments = await ctx.db.query("opsTaskComments").collect();
      await eat("opsTaskComments", comments);
      await eat("opsTasks", tasks);
    }

    // ------- Incidents -------
    if (groups.has("incidents")) {
      const incs = await ctx.db.query("incidents").collect();
      await eat("incidents", incs);
    }

    // ------- Messages (conversation graph) -------
    if (groups.has("messages")) {
      // Order: attachments → messages → transport events → participants → conversations.
      const attachments = await ctx.db.query("conversationMessageAttachments").collect();
      await eat("conversationMessageAttachments", attachments);

      const messages = await ctx.db.query("conversationMessages").collect();
      await eat("conversationMessages", messages);

      const transport = await ctx.db.query("messageTransportEvents").collect();
      await eat("messageTransportEvents", transport);

      const participants = await ctx.db.query("conversationParticipants").collect();
      await eat("conversationParticipants", participants);

      const conversations = await ctx.db.query("conversations").collect();
      await eat("conversations", conversations);
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    return {
      dryRun,
      groups: [...groups],
      total,
      counts,
      truncated,
      message:
        (dryRun ? "[DRY RUN] would delete " : "deleted ") +
        total +
        " rows" +
        (truncated ? ` (TRUNCATED — re-run to drain remainder)` : ""),
    };
  },
});
