// One-off diagnostics for the Hospitable backfill effort. Internal-only;
// invoke via `npx convex run hospitable/diagnostics:<name>` with a deploy
// key. Safe to leave in place — these don't run on any cron and don't
// mutate state.

// Pure Web APIs (fetch, JSON) — V8 isolate is fine, no Node runtime needed.

import { v } from "convex/values";
import { action, internalQuery } from "../_generated/server";

/**
 * Counts `stays` rows per property — useful for seeing whether the
 * Hospitable backfill is actually populating every property in the
 * portfolio or only a subset.
 */
export const countStaysPerProperty = internalQuery({
  args: {},
  handler: async (ctx) => {
    const stays = await ctx.db.query("stays").collect();
    const props = await ctx.db.query("properties").collect();
    const byProp = new Map<string, number>();
    for (const s of stays) {
      const key = s.propertyId as unknown as string;
      byProp.set(key, (byProp.get(key) ?? 0) + 1);
    }
    return props
      .map((p) => ({
        name: p.name,
        hospitableId: p.hospitableId ?? null,
        stayCount: byProp.get(p._id as unknown as string) ?? 0,
      }))
      .sort((a, b) => b.stayCount - a.stayCount);
  },
});

/**
 * Probes Hospitable's `/reservations` endpoint for a single hospitableId
 * over a wide window and returns the raw count + pagination envelope so
 * we can see whether the API is paginating or just doesn't have more data.
 */
export const probeReservationsForProperty = action({
  args: {
    hospitableId: v.string(),
    daysBack: v.optional(v.number()),
    daysForward: v.optional(v.number()),
    perPage: v.optional(v.number()),
  },
  handler: async (
    _ctx,
    args,
  ): Promise<{
    url: string;
    dataLength: number;
    meta: unknown;
    links: unknown;
    firstId: string | null;
    lastId: string | null;
  }> => {
    const apiKey = process.env.HOSPITABLE_API_KEY ?? process.env.HOSPITABLE_API_TOKEN;
    if (!apiKey) throw new Error("Missing HOSPITABLE_API_KEY");
    const baseUrl = process.env.HOSPITABLE_API_URL ?? "https://public.api.hospitable.com/v1";
    const daysBack = args.daysBack ?? 1095;
    const daysForward = args.daysForward ?? 365;
    const windowStart = new Date(Date.now() - daysBack * 86400000);
    const windowEnd = new Date(Date.now() + daysForward * 86400000);
    const params = new URLSearchParams();
    params.set("check_out_from", windowStart.toISOString().split("T")[0]);
    params.set("check_out_to", windowEnd.toISOString().split("T")[0]);
    params.append("properties[]", args.hospitableId);
    params.set("per_page", String(args.perPage ?? 100));
    const url = `${baseUrl}/reservations?${params.toString()}`;
    const resp = await fetch(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Hospitable ${resp.status}: ${body.slice(0, 500)}`);
    }
    const json = (await resp.json()) as Record<string, unknown>;
    const data = Array.isArray(json.data) ? json.data : [];
    return {
      url,
      dataLength: data.length,
      meta: json.meta ?? null,
      links: json.links ?? null,
      firstId:
        data.length > 0 && typeof (data[0] as Record<string, unknown>).id === "string"
          ? ((data[0] as Record<string, unknown>).id as string)
          : null,
      lastId:
        data.length > 0 &&
        typeof (data[data.length - 1] as Record<string, unknown>).id === "string"
          ? ((data[data.length - 1] as Record<string, unknown>).id as string)
          : null,
    };
  },
});
