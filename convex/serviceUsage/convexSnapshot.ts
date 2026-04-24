/**
 * Nightly Convex self-report snapshot.
 *
 * Convex doesn't expose a "my own billing usage" API from inside a Convex
 * function. The 400k+ function-call / GB-bandwidth numbers you see on the
 * Convex dashboard are internal metrics and aren't readable via `ctx.*`.
 *
 * This snapshot provides the next-best-thing: proxies we CAN see from
 * inside our own database, so the Convex card on `/settings/usage`
 * surfaces *something* rather than "0 calls" forever.
 *
 * What it records (one event per table, plus one event for event volume):
 *   - `convex_rows_<table>` for each tracked table — `requestBytes` holds
 *     the row count (integer-as-gauge, same pattern as Clerk MAU).
 *   - `convex_events_24h` — count of `serviceUsageEvents` written in the
 *     trailing 24 hours, as a proxy for function-call volume.
 *
 * Limitations (be explicit so no one is misled):
 *   - These are *our own* metrics, not Convex billing.
 *   - Cannot detect reads (queries) — Convex bills those separately and we
 *     have no hook to count them.
 *   - Link out to the Convex dashboard for authoritative numbers.
 */

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { logServiceUsage } from "../lib/serviceUsage";
import type { TableNamesInDataModel } from "convex/server";
import type { DataModel } from "../_generated/dataModel";

type TrackedTable = TableNamesInDataModel<DataModel>;

/** Tables we care about for a "how big is our data" snapshot. Keep the
 *  list small — each entry = one full-table scan at snapshot time. */
const TRACKED_TABLES: TrackedTable[] = [
  "users",
  "photos",
  "cleaningJobs",
  "properties",
  "conversations",
  "conversationMessages",
  "notifications",
  "serviceUsageEvents",
  "serviceUsageRollups",
  "serviceQuotaCounters",
];

/** Upper bound on rows pulled per table. 50k is plenty for this app's
 *  scale and caps worst-case cost at ~500k reads per snapshot/day. */
const PER_TABLE_SCAN_CAP = 50_000;

const DAY_MS = 24 * 60 * 60 * 1000;

export const snapshot = internalMutation({
  args: {},
  returns: v.object({
    tablesScanned: v.number(),
    totalRows: v.number(),
    eventsLast24h: v.number(),
    capHits: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    let totalRows = 0;
    const capHits: string[] = [];

    for (const table of TRACKED_TABLES) {
      const rows = await ctx.db
        .query(table as TrackedTable)
        .take(PER_TABLE_SCAN_CAP);
      const count = rows.length;
      totalRows += count;

      if (count === PER_TABLE_SCAN_CAP) {
        capHits.push(table);
      }

      try {
        await logServiceUsage(ctx, {
          serviceKey: "convex",
          feature: `convex_rows_${table}`,
          status: "success",
          requestBytes: count,
          metadata: {
            table,
            capHit: count === PER_TABLE_SCAN_CAP,
          },
        });
      } catch {
        // best-effort
      }
    }

    // Event volume over the last 24h — proxy for "how much activity hit
    // our instrumented paths." This is the nearest we can get to
    // function-call rate without an external API.
    const eventsLast24h = (
      await ctx.db
        .query("serviceUsageEvents")
        .withIndex("by_status_created", (q) =>
          q.eq("status", "success").gte("createdAt", now - DAY_MS),
        )
        .take(PER_TABLE_SCAN_CAP)
    ).length;

    try {
      await logServiceUsage(ctx, {
        serviceKey: "convex",
        feature: "convex_events_24h",
        status: "success",
        requestBytes: eventsLast24h,
        metadata: { windowMs: DAY_MS },
      });
    } catch {
      // best-effort
    }

    return {
      tablesScanned: TRACKED_TABLES.length,
      totalRows,
      eventsLast24h,
      capHits,
    };
  },
});
