// One-off diagnostics for the Hospitable backfill effort. Internal-only;
// invoke via `npx convex run hospitable/diagnostics:<name>` with a deploy
// key. Safe to leave in place — these don't run on any cron and don't
// mutate state.

// Pure Web APIs (fetch, JSON) — V8 isolate is fine, no Node runtime needed.

import { v } from "convex/values";
import { action, internalQuery } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

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

/**
 * Lists OUR DB stays for a given property + month-key ("YYYY-MM"),
 * filtered by checkInAt (same convention the fee engine uses). Useful
 * for comparing line-by-line against Hospitable's reporting numbers.
 */
export const listStaysForPropertyMonth = internalQuery({
  args: { hospitableId: v.string(), month: v.string() },
  handler: async (ctx, args) => {
    const [y, m] = args.month.split("-").map(Number);
    const start = Date.UTC(y, m - 1, 1);
    const end = Date.UTC(y, m, 1);
    const property = await ctx.db
      .query("properties")
      .filter((q) => q.eq(q.field("hospitableId"), args.hospitableId))
      .first();
    if (!property) {
      return { error: `No property with hospitableId ${args.hospitableId}` } as const;
    }
    const stays = await ctx.db
      .query("stays")
      .withIndex("by_property", (q) => q.eq("propertyId", property._id as Id<"properties">))
      .collect();
    const inMonth = stays.filter(
      (s) => s.checkInAt >= start && s.checkInAt < end,
    );
    const total = inMonth
      .filter((s) => s.cancelledAt === undefined)
      .reduce((sum, s) => sum + (s.totalAmount ?? 0), 0);
    return {
      month: args.month,
      stayCount: inMonth.length,
      activeStayCount: inMonth.filter((s) => s.cancelledAt === undefined).length,
      totalAmountSum: total,
      stays: inMonth
        .sort((a, b) => a.checkInAt - b.checkInAt)
        .map((s) => ({
          guestName: s.guestName,
          checkInAt: new Date(s.checkInAt).toISOString(),
          checkOutAt: new Date(s.checkOutAt).toISOString(),
          totalAmount: s.totalAmount ?? null,
          currency: s.currency ?? null,
          platform: s.platform ?? null,
          cancelled: s.cancelledAt !== undefined,
          numberOfGuests: s.numberOfGuests ?? null,
        })),
    };
  },
});

/**
 * Pulls the RAW Hospitable reservations for a property+month and dumps
 * the per-reservation financial breakdown — accommodation, host_fees,
 * platform_fees, channel fees, etc. — so we can see which field
 * Hospitable's own reporting screen is summing into "Net Revenue".
 *
 * Use to debug "Hospitable says $5,744 / we say $7,973" type mismatches.
 */
export const probeReservationFinancialsForMonth = action({
  args: { hospitableId: v.string(), month: v.string() },
  handler: async (
    _ctx,
    args,
  ): Promise<{
    month: string;
    url: string;
    rows: Array<{
      id: string | null;
      checkIn: string | null;
      checkOut: string | null;
      currency: string | null;
      sumAccommodation: number | null;
      sumHostGuestFees: number | null;
      hostCommission: number | null;
      guestTotalPaid: number | null;
      ourTotalAmount: number | null;
    }>;
    sums: {
      sumAccommodation: number;
      sumHostGuestFees: number;
      sumHostCommission: number;
      sumGuestPaid: number;
      sumOurTotalAmount: number;
    };
  }> => {
    const apiKey = process.env.HOSPITABLE_API_KEY ?? process.env.HOSPITABLE_API_TOKEN;
    if (!apiKey) throw new Error("Missing HOSPITABLE_API_KEY");
    const baseUrl = process.env.HOSPITABLE_API_URL ?? "https://public.api.hospitable.com/v2";
    const [y, m] = args.month.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1)).toISOString().split("T")[0];
    const end = new Date(Date.UTC(y, m, 0)).toISOString().split("T")[0]; // last day inclusive
    const params = new URLSearchParams();
    params.set("check_in_from", start);
    params.set("check_in_to", end);
    params.append("properties[]", args.hospitableId);
    params.set("per_page", "100");
    params.set("include", "financials");
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

    const sumAmountCents = (xs: unknown): number => {
      if (!Array.isArray(xs)) return 0;
      let n = 0;
      for (const x of xs) {
        if (x && typeof x === "object" && "amount" in (x as Record<string, unknown>)) {
          const v = (x as Record<string, unknown>).amount;
          if (typeof v === "number") n += v;
        }
      }
      return n;
    };
    const numberOr = (x: unknown): number => (typeof x === "number" ? x : 0);

    const rows = data.map((r) => {
      const rec = r as Record<string, unknown>;
      const financials = (rec.financials ?? {}) as Record<string, unknown>;
      const host = (financials.host ?? {}) as Record<string, unknown>;
      const guest = (financials.guest ?? {}) as Record<string, unknown>;
      const accommodationCents = sumAmountCents(host.accommodation_breakdown);
      const hostGuestFeesCents = sumAmountCents(host.guest_fees);
      const hostCommissionCents = numberOr(
        ((host.commission as Record<string, unknown>)?.amount as number) ??
          ((host.host_commission as Record<string, unknown>)?.amount as number),
      );
      const guestTotalPaidCents = numberOr(
        ((guest.total_price as Record<string, unknown>)?.amount as number) ??
          ((guest.total as Record<string, unknown>)?.amount as number),
      );
      return {
        id: typeof rec.id === "string" ? rec.id : null,
        checkIn:
          typeof rec.check_in === "string"
            ? rec.check_in
            : typeof rec.arrival_date === "string"
              ? (rec.arrival_date as string)
              : null,
        checkOut:
          typeof rec.check_out === "string"
            ? rec.check_out
            : typeof rec.departure_date === "string"
              ? (rec.departure_date as string)
              : null,
        currency:
          typeof (
            (host.accommodation_breakdown as Array<Record<string, unknown>> | undefined)?.[0]
              ?.currency
          ) === "string"
            ? ((host.accommodation_breakdown as Array<Record<string, unknown>>)[0]
                ?.currency as string)
            : null,
        sumAccommodation: accommodationCents / 100,
        sumHostGuestFees: hostGuestFeesCents / 100,
        hostCommission: hostCommissionCents / 100,
        guestTotalPaid: guestTotalPaidCents / 100,
        ourTotalAmount: (accommodationCents + hostGuestFeesCents) / 100, // what normalizeReservation stores
      };
    });

    const sums = rows.reduce(
      (acc, r) => ({
        sumAccommodation: acc.sumAccommodation + (r.sumAccommodation ?? 0),
        sumHostGuestFees: acc.sumHostGuestFees + (r.sumHostGuestFees ?? 0),
        sumHostCommission: acc.sumHostCommission + (r.hostCommission ?? 0),
        sumGuestPaid: acc.sumGuestPaid + (r.guestTotalPaid ?? 0),
        sumOurTotalAmount: acc.sumOurTotalAmount + (r.ourTotalAmount ?? 0),
      }),
      {
        sumAccommodation: 0,
        sumHostGuestFees: 0,
        sumHostCommission: 0,
        sumGuestPaid: 0,
        sumOurTotalAmount: 0,
      },
    );

    return { month: args.month, url, rows, sums };
  },
});

/**
 * Dump the RAW `financials` object for the first N reservations Hospitable
 * returns for the property (no date filter). Used to inspect every field
 * the v2 API exposes per reservation — so we can identify which one
 * Hospitable's reporting screen sums as "Net Revenue" and confirm whether
 * our `accommodation + host.guest_fees` formula is actually right.
 */
export const dumpFirstReservationFinancials = action({
  args: { hospitableId: v.string(), limit: v.optional(v.number()) },
  handler: async (_ctx, args): Promise<{ url: string; rows: unknown[] }> => {
    const apiKey = process.env.HOSPITABLE_API_KEY ?? process.env.HOSPITABLE_API_TOKEN;
    if (!apiKey) throw new Error("Missing HOSPITABLE_API_KEY");
    const baseUrl = process.env.HOSPITABLE_API_URL ?? "https://public.api.hospitable.com/v2";
    const params = new URLSearchParams();
    params.append("properties[]", args.hospitableId);
    params.set("per_page", String(args.limit ?? 3));
    params.set("include", "financials");
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
      rows: data.slice(0, args.limit ?? 3).map((r) => {
        const rec = r as Record<string, unknown>;
        return {
          id: rec.id,
          check_in: rec.check_in ?? rec.arrival_date,
          check_out: rec.check_out ?? rec.departure_date,
          status: rec.status,
          financials: rec.financials, // ← raw, unfiltered
        };
      }),
    };
  },
});
