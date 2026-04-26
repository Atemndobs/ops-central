"use node";

/**
 * Provider quota sync — fetches real usage numbers from each provider's
 * billing/admin API and upserts them into `serviceQuotaCounters` with
 * `source: "provider"`. Runs hourly via crons.ts.
 *
 * Adapters (under ./providers/) are pure functions shared with the
 * Next.js chatbot tool route — same code, different transport.
 *
 * DB writes live in `providerSyncWriter.ts` because Convex disallows
 * mutations inside "use node" modules.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { ADAPTERS } from "./providers";
import type { QuotaSnapshot } from "./providers/types";

export const fetchAll = internalAction({
  args: {
    /** Optional: restrict to a single provider (used by chatbot path). */
    serviceKey: v.optional(v.string()),
  },
  returns: v.object({
    succeeded: v.array(v.string()),
    failed: v.array(v.object({ serviceKey: v.string(), error: v.string() })),
    snapshotsWritten: v.number(),
  }),
  handler: async (ctx, args) => {
    const targets = args.serviceKey
      ? Object.entries(ADAPTERS).filter(([k]) => k === args.serviceKey)
      : Object.entries(ADAPTERS);

    const results = await Promise.allSettled(
      targets.map(async ([key, adapter]) => {
        const snapshots = await adapter();
        return { key, snapshots };
      }),
    );

    const succeeded: string[] = [];
    const failed: Array<{ serviceKey: string; error: string }> = [];
    const allSnapshots: QuotaSnapshot[] = [];

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const [key] = targets[i];
      if (r.status === "fulfilled") {
        succeeded.push(key);
        allSnapshots.push(...r.value.snapshots);
      } else {
        const message =
          r.reason instanceof Error ? r.reason.message : String(r.reason);
        failed.push({ serviceKey: key, error: message });
        try {
          if (key === "convex" || key === "clerk" || key === "b2") {
            await ctx.runMutation(
              internal.serviceUsage.providerSyncWriter.logSyncFailure,
              { serviceKey: key, error: message.slice(0, 500) },
            );
          }
        } catch {
          // never let logging failures break the cron
        }
      }
    }

    if (allSnapshots.length > 0) {
      await ctx.runMutation(
        internal.serviceUsage.providerSyncWriter.upsertSnapshots,
        { snapshots: allSnapshots },
      );
    }

    return {
      succeeded,
      failed,
      snapshotsWritten: allSnapshots.length,
    };
  },
});
