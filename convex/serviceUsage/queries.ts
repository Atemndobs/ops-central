/**
 * Service Usage Dashboard — admin-only read queries.
 *
 * Powers the `/settings/usage` overview and `/settings/usage/[serviceKey]`
 * detail pages. All queries require the caller to be a user with
 * `role = "admin"`; non-admins get a thrown error from `requireAdmin`.
 *
 * Data-source choice per Docs/usage-tracking/ADR.md §"Read Path":
 *   - Windows ≤ 7 days → read `serviceUsageEvents` directly (precise, fresh).
 *   - Windows > 7 days → read `serviceUsageRollups` (pre-aggregated hourly).
 *   - > 90 days → not stored (retention cron deletes events).
 *
 * The "this-month" cost aggregation uses a hybrid: rollups for anything >1h
 * old, events for the current hour (since the rollup cron runs hourly and
 * hasn't seen them yet). In practice the dashboard only reads rollups for
 * simplicity — the last-hour gap is negligible for monthly totals.
 */

import { v } from "convex/values";
import { query } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { requireAdmin } from "../lib/auth";
import {
  SERVICE_DEFINITIONS,
  getServiceDefinition,
  quotaBucketStart,
  type ServiceKey,
  type ServiceQuota,
} from "../lib/serviceRegistry";

// ─────────────────────────────────────────────────────────────────────────────
// Validators & constants
// ─────────────────────────────────────────────────────────────────────────────

const serviceKeyValidator = v.union(
  v.literal("gemini"),
  v.literal("clerk"),
  v.literal("hospitable"),
  v.literal("resend"),
  v.literal("convex"),
  v.literal("b2"),
);

const eventStatusValidator = v.union(
  v.literal("success"),
  v.literal("rate_limited"),
  v.literal("quota_exceeded"),
  v.literal("auth_error"),
  v.literal("client_error"),
  v.literal("server_error"),
  v.literal("timeout"),
  v.literal("unknown_error"),
);

const DAY_MS = 24 * 60 * 60 * 1000;

/** Upper bound on how many rows any single `.take()` pulls. Protects query
 *  latency regardless of traffic volume. */
const ROLLUP_SCAN_LIMIT = 5000;
const RECENT_ERRORS_DEFAULT = 25;
const RECENT_ERRORS_MAX = 100;
const DRILLDOWN_PAGE_SIZE = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Start of the current UTC month. */
function startOfMonthUtc(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** Start of the previous UTC month. */
function startOfPrevMonthUtc(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1);
}

/** Start of day (UTC) for a timestamp. */
function startOfDayUtc(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Sum `estimatedCostUsd` across rollups for a given service in a window. */
async function sumCostFromRollups(
  ctx: Parameters<typeof requireAdmin>[0],
  serviceKey: string,
  startMs: number,
  endMs: number,
): Promise<{ costUsd: number; successCount: number; errorCount: number }> {
  const rows = await ctx.db
    .query("serviceUsageRollups")
    .withIndex("by_service_bucket", (q) =>
      q
        .eq("serviceKey", serviceKey)
        .gte("bucketStart", startMs)
        .lt("bucketStart", endMs),
    )
    .take(ROLLUP_SCAN_LIMIT);

  let costUsd = 0;
  let successCount = 0;
  let errorCount = 0;
  for (const r of rows) {
    costUsd += r.totalCostUsd;
    successCount += r.successCount;
    errorCount += r.errorCount;
  }
  return { costUsd, successCount, errorCount };
}

/** The narrower union the schema uses on `serviceUsageEvents.serviceKey`. */
type EventServiceKey = Doc<"serviceUsageEvents">["serviceKey"];

/** Quota consumption % read from `serviceQuotaCounters` — O(1) vs the old
 *  5000-event scan. Returns `{consumed:0, pct:0}` when no counter row
 *  exists yet (first log of the bucket hasn't happened). */
async function computeQuotaConsumption(
  ctx: Parameters<typeof requireAdmin>[0],
  serviceKey: EventServiceKey,
  quota: ServiceQuota,
  now: number,
): Promise<{ consumed: number; pct: number }> {
  const bucketStart = quotaBucketStart(quota.window, now);
  const row = await ctx.db
    .query("serviceQuotaCounters")
    .withIndex("by_service_quota_bucket", (q) =>
      q
        .eq("serviceKey", serviceKey)
        .eq("quotaId", quota.id)
        .eq("bucketStart", bucketStart),
    )
    .unique();

  const consumed = row?.consumed ?? 0;
  const pct = quota.limit > 0 ? (consumed / quota.limit) * 100 : 0;
  return { consumed, pct };
}

/** Most-recent error event for a service (any non-success status). */
async function findLastError(
  ctx: Parameters<typeof requireAdmin>[0],
  serviceKey: EventServiceKey,
): Promise<Doc<"serviceUsageEvents"> | null> {
  // Scan the most recent events for this service via the service/createdAt
  // index and return the first non-success row. 100 is plenty — if all of
  // the last 100 events are successes the service is healthy.
  const recent = await ctx.db
    .query("serviceUsageEvents")
    .withIndex("by_service_created", (q) => q.eq("serviceKey", serviceKey))
    .order("desc")
    .take(100);
  return recent.find((e) => e.status !== "success") ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Overview page data — month-cost summary plus one card per registered
 * service. Admin-only.
 */
export const getOverview = query({
  args: {},
  returns: v.object({
    generatedAt: v.number(),
    thisMonthCostUsd: v.number(),
    prevMonthCostUsd: v.number(),
    services: v.array(
      v.object({
        serviceKey: serviceKeyValidator,
        displayName: v.string(),
        docsUrl: v.string(),
        thisMonthCostUsd: v.number(),
        thisMonthSuccessCount: v.number(),
        thisMonthErrorCount: v.number(),
        quotas: v.array(
          v.object({
            id: v.string(),
            label: v.string(),
            window: v.union(
              v.literal("minute"),
              v.literal("hour"),
              v.literal("day"),
              v.literal("month"),
            ),
            limit: v.number(),
            consumed: v.number(),
            pct: v.number(),
            metric: v.union(
              v.literal("count"),
              v.literal("inputTokens"),
              v.literal("outputTokens"),
              v.literal("costUsd"),
            ),
          }),
        ),
        lastError: v.union(
          v.null(),
          v.object({
            status: eventStatusValidator,
            errorCode: v.optional(v.string()),
            errorMessage: v.optional(v.string()),
            createdAt: v.number(),
            feature: v.string(),
          }),
        ),
      }),
    ),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const now = Date.now();
    const monthStart = startOfMonthUtc(now);
    const prevMonthStart = startOfPrevMonthUtc(now);

    // Aggregate month totals across all services for the summary row.
    let thisMonthCostUsd = 0;
    let prevMonthCostUsd = 0;

    const keys = Object.keys(SERVICE_DEFINITIONS) as ServiceKey[];
    const services: Array<{
      serviceKey: ServiceKey;
      displayName: string;
      docsUrl: string;
      thisMonthCostUsd: number;
      thisMonthSuccessCount: number;
      thisMonthErrorCount: number;
      quotas: Array<{
        id: string;
        label: string;
        window: "minute" | "hour" | "day" | "month";
        limit: number;
        consumed: number;
        pct: number;
        metric: "count" | "inputTokens" | "outputTokens" | "costUsd";
      }>;
      lastError:
        | null
        | {
            status: Doc<"serviceUsageEvents">["status"];
            errorCode?: string;
            errorMessage?: string;
            createdAt: number;
            feature: string;
          };
    }> = [];

    for (const key of keys) {
      const def = SERVICE_DEFINITIONS[key];

      const [thisMonth, prevMonth] = await Promise.all([
        sumCostFromRollups(ctx, key, monthStart, now),
        sumCostFromRollups(ctx, key, prevMonthStart, monthStart),
      ]);

      thisMonthCostUsd += thisMonth.costUsd;
      prevMonthCostUsd += prevMonth.costUsd;

      const quotas: Array<{
        id: string;
        label: string;
        window: "minute" | "hour" | "day" | "month";
        limit: number;
        consumed: number;
        pct: number;
        metric: "count" | "inputTokens" | "outputTokens" | "costUsd";
      }> = [];
      for (const quota of def.quotas ?? []) {
        const { consumed, pct } = await computeQuotaConsumption(
          ctx,
          key,
          quota,
          now,
        );
        quotas.push({
          id: quota.id,
          label: quota.label,
          window: quota.window,
          limit: quota.limit,
          metric: quota.metric,
          consumed,
          pct,
        });
      }

      const lastErrorDoc = await findLastError(ctx, key);
      const lastError = lastErrorDoc
        ? {
            status: lastErrorDoc.status,
            errorCode: lastErrorDoc.errorCode,
            errorMessage: lastErrorDoc.errorMessage,
            createdAt: lastErrorDoc.createdAt,
            feature: lastErrorDoc.feature,
          }
        : null;

      services.push({
        serviceKey: key,
        displayName: def.displayName,
        docsUrl: def.docsUrl,
        thisMonthCostUsd: thisMonth.costUsd,
        thisMonthSuccessCount: thisMonth.successCount,
        thisMonthErrorCount: thisMonth.errorCount,
        quotas,
        lastError,
      });
    }

    return {
      generatedAt: now,
      thisMonthCostUsd,
      prevMonthCostUsd,
      services,
    };
  },
});

/**
 * Service detail — daily request/cost series, per-feature breakdown, and a
 * recent-errors list for a single service. Admin-only.
 *
 * `days` defaults to 30 and is clamped to [1, 90]. Daily buckets are assembled
 * from hourly rollups so we don't blow out the query budget on large windows.
 */
export const getServiceDetail = query({
  args: {
    serviceKey: serviceKeyValidator,
    days: v.optional(v.number()),
  },
  returns: v.object({
    serviceKey: serviceKeyValidator,
    displayName: v.string(),
    docsUrl: v.string(),
    windowDays: v.number(),
    windowStart: v.number(),
    generatedAt: v.number(),
    daily: v.array(
      v.object({
        dayStart: v.number(),
        successCount: v.number(),
        errorCount: v.number(),
        totalCostUsd: v.number(),
      }),
    ),
    byFeature: v.array(
      v.object({
        feature: v.string(),
        successCount: v.number(),
        errorCount: v.number(),
        totalCostUsd: v.number(),
        totalDurationMs: v.number(),
        totalInputTokens: v.number(),
        totalOutputTokens: v.number(),
        totalAudioSeconds: v.number(),
      }),
    ),
    recentErrors: v.array(
      v.object({
        _id: v.id("serviceUsageEvents"),
        feature: v.string(),
        status: eventStatusValidator,
        errorCode: v.optional(v.string()),
        errorMessage: v.optional(v.string()),
        createdAt: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const def = getServiceDefinition(args.serviceKey);
    if (!def) {
      throw new Error(`Unknown serviceKey: ${args.serviceKey}`);
    }

    const now = Date.now();
    const days = Math.max(1, Math.min(90, args.days ?? 30));
    const windowStart = startOfDayUtc(now - days * DAY_MS);

    // Pull rollups for the window — they're hourly, one row per
    // (service, feature, bucketStart). Aggregate into daily buckets.
    const rollups = await ctx.db
      .query("serviceUsageRollups")
      .withIndex("by_service_bucket", (q) =>
        q
          .eq("serviceKey", args.serviceKey)
          .gte("bucketStart", windowStart),
      )
      .take(ROLLUP_SCAN_LIMIT);

    // Daily aggregation (stacked by status).
    type DailyAgg = {
      dayStart: number;
      successCount: number;
      errorCount: number;
      totalCostUsd: number;
    };
    const byDay = new Map<number, DailyAgg>();

    // Per-feature aggregation (full metrics).
    type FeatureAgg = {
      feature: string;
      successCount: number;
      errorCount: number;
      totalCostUsd: number;
      totalDurationMs: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      totalAudioSeconds: number;
    };
    const byFeature = new Map<string, FeatureAgg>();

    for (const r of rollups) {
      const dayStart = startOfDayUtc(r.bucketStart);
      let day = byDay.get(dayStart);
      if (!day) {
        day = {
          dayStart,
          successCount: 0,
          errorCount: 0,
          totalCostUsd: 0,
        };
        byDay.set(dayStart, day);
      }
      day.successCount += r.successCount;
      day.errorCount += r.errorCount;
      day.totalCostUsd += r.totalCostUsd;

      let feat = byFeature.get(r.feature);
      if (!feat) {
        feat = {
          feature: r.feature,
          successCount: 0,
          errorCount: 0,
          totalCostUsd: 0,
          totalDurationMs: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalAudioSeconds: 0,
        };
        byFeature.set(r.feature, feat);
      }
      feat.successCount += r.successCount;
      feat.errorCount += r.errorCount;
      feat.totalCostUsd += r.totalCostUsd;
      feat.totalDurationMs += r.totalDurationMs;
      feat.totalInputTokens += r.totalInputTokens;
      feat.totalOutputTokens += r.totalOutputTokens;
      feat.totalAudioSeconds += r.totalAudioSeconds;
    }

    // Densify the daily array so the chart renders a continuous x-axis even
    // on days with zero traffic.
    const daily: DailyAgg[] = [];
    const todayStart = startOfDayUtc(now);
    for (let d = windowStart; d <= todayStart; d += DAY_MS) {
      const existing = byDay.get(d);
      daily.push(
        existing ?? {
          dayStart: d,
          successCount: 0,
          errorCount: 0,
          totalCostUsd: 0,
        },
      );
    }

    // Recent errors — pulled from the raw events table for accuracy. Scans
    // the last 200 events and keeps the errors.
    const recentEvents = await ctx.db
      .query("serviceUsageEvents")
      .withIndex("by_service_created", (q) =>
        q.eq("serviceKey", args.serviceKey),
      )
      .order("desc")
      .take(200);
    const recentErrors = recentEvents
      .filter((e) => e.status !== "success")
      .slice(0, RECENT_ERRORS_DEFAULT)
      .map((e) => ({
        _id: e._id,
        feature: e.feature,
        status: e.status,
        errorCode: e.errorCode,
        errorMessage: e.errorMessage,
        createdAt: e.createdAt,
      }));

    const byFeatureArr = Array.from(byFeature.values()).sort(
      (a, b) =>
        b.successCount + b.errorCount - (a.successCount + a.errorCount),
    );

    return {
      serviceKey: args.serviceKey,
      displayName: def.displayName,
      docsUrl: def.docsUrl,
      windowDays: days,
      windowStart,
      generatedAt: now,
      daily,
      byFeature: byFeatureArr,
      recentErrors,
    };
  },
});

/**
 * Paginated raw-event drill-down for the detail page. Last 100 events per
 * page, filterable by status. Admin-only.
 */
export const listEvents = query({
  args: {
    serviceKey: serviceKeyValidator,
    /** Optional status filter. If unset, returns all statuses. */
    status: v.optional(eventStatusValidator),
    /** Opaque cursor: createdAt of the last row from the previous page. */
    cursor: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    events: v.array(
      v.object({
        _id: v.id("serviceUsageEvents"),
        feature: v.string(),
        status: eventStatusValidator,
        userId: v.optional(v.id("users")),
        durationMs: v.optional(v.number()),
        inputTokens: v.optional(v.number()),
        outputTokens: v.optional(v.number()),
        audioSeconds: v.optional(v.number()),
        estimatedCostUsd: v.optional(v.number()),
        errorCode: v.optional(v.string()),
        errorMessage: v.optional(v.string()),
        createdAt: v.number(),
      }),
    ),
    nextCursor: v.union(v.null(), v.number()),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const limit = Math.max(
      1,
      Math.min(DRILLDOWN_PAGE_SIZE, args.limit ?? DRILLDOWN_PAGE_SIZE),
    );
    const cursor = args.cursor;

    // Keyed by (serviceKey, createdAt) so we can seek past the previous page
    // by using `.lt("createdAt", cursor)` and taking `limit` results.
    const q = ctx.db
      .query("serviceUsageEvents")
      .withIndex("by_service_created", (ix) => {
        const base = ix.eq("serviceKey", args.serviceKey);
        return cursor !== undefined ? base.lt("createdAt", cursor) : base;
      })
      .order("desc");

    // Over-fetch slightly when filtering so a status filter still fills a
    // page most of the time; cap at 4× limit to stay bounded.
    const scanLimit = args.status ? Math.min(limit * 4, 400) : limit;
    const raw = await q.take(scanLimit);

    const filtered = args.status
      ? raw.filter((e) => e.status === args.status)
      : raw;
    const page = filtered.slice(0, limit);
    const nextCursor =
      page.length === limit ? (page[page.length - 1].createdAt ?? null) : null;

    return {
      events: page.map((e) => ({
        _id: e._id,
        feature: e.feature,
        status: e.status,
        userId: e.userId,
        durationMs: e.durationMs,
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        audioSeconds: e.audioSeconds,
        estimatedCostUsd: e.estimatedCostUsd,
        errorCode: e.errorCode,
        errorMessage: e.errorMessage,
        createdAt: e.createdAt,
      })),
      nextCursor,
    };
  },
});

/**
 * Admin-facing list of recent errors (non-success events) for a filters UI.
 * Capped at `RECENT_ERRORS_MAX` to stay bounded.
 */
export const listRecentErrors = query({
  args: {
    serviceKey: serviceKeyValidator,
    status: v.optional(eventStatusValidator),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("serviceUsageEvents"),
      feature: v.string(),
      status: eventStatusValidator,
      errorCode: v.optional(v.string()),
      errorMessage: v.optional(v.string()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const limit = Math.max(
      1,
      Math.min(RECENT_ERRORS_MAX, args.limit ?? RECENT_ERRORS_DEFAULT),
    );

    const events = await ctx.db
      .query("serviceUsageEvents")
      .withIndex("by_service_created", (q) =>
        q.eq("serviceKey", args.serviceKey),
      )
      .order("desc")
      .take(500);

    const filtered = events.filter((e) =>
      args.status ? e.status === args.status : e.status !== "success",
    );
    return filtered.slice(0, limit).map((e) => ({
      _id: e._id,
      feature: e.feature,
      status: e.status,
      errorCode: e.errorCode,
      errorMessage: e.errorMessage,
      createdAt: e.createdAt,
    }));
  },
});
