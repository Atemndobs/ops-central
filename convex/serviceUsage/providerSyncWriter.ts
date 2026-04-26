/**
 * Database writers for the provider quota sync action.
 *
 * Lives in a separate file (no "use node") because Convex disallows
 * mutations inside Node-runtime modules. The Node action in
 * `providerSync.ts` calls these via `ctx.runMutation`.
 */

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

const snapshotValidator = v.object({
  serviceKey: v.string(),
  quotaKey: v.string(),
  used: v.number(),
  limit: v.number(),
  unit: v.string(),
  windowStart: v.number(),
  windowEnd: v.number(),
  fetchedAt: v.number(),
});

export const upsertSnapshots = internalMutation({
  args: { snapshots: v.array(snapshotValidator) },
  returns: v.object({ inserted: v.number(), patched: v.number() }),
  handler: async (ctx, { snapshots }) => {
    let inserted = 0;
    let patched = 0;
    for (const s of snapshots) {
      const existing = await ctx.db
        .query("serviceQuotaCounters")
        .withIndex("by_service_quota_bucket", (q) =>
          q
            .eq("serviceKey", s.serviceKey)
            .eq("quotaId", s.quotaKey)
            .eq("bucketStart", s.windowStart),
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          consumed: s.used,
          limit: s.limit,
          unit: s.unit,
          source: "provider",
          fetchedAt: s.fetchedAt,
          updatedAt: s.fetchedAt,
        });
        patched += 1;
      } else {
        await ctx.db.insert("serviceQuotaCounters", {
          serviceKey: s.serviceKey,
          quotaId: s.quotaKey,
          bucketStart: s.windowStart,
          consumed: s.used,
          limit: s.limit,
          unit: s.unit,
          source: "provider",
          fetchedAt: s.fetchedAt,
          lastNotifiedPct: -1,
          updatedAt: s.fetchedAt,
        });
        inserted += 1;
      }
    }
    return { inserted, patched };
  },
});

const serviceKeyValidator = v.union(
  v.literal("convex"),
  v.literal("clerk"),
  v.literal("b2"),
);

export const logSyncFailure = internalMutation({
  args: { serviceKey: serviceKeyValidator, error: v.string() },
  returns: v.null(),
  handler: async (ctx, { serviceKey, error }) => {
    await ctx.db.insert("serviceUsageEvents", {
      serviceKey,
      feature: "provider_quota_sync",
      status: "server_error",
      errorMessage: error,
      createdAt: Date.now(),
    });
    return null;
  },
});
