"use node";

/**
 * Nightly Clerk MAU snapshot.
 *
 * Calls Clerk's admin API (`GET /v1/users?last_active_at_since=<30d_ago>`)
 * once per day, counts the returned users, and logs one event so the Clerk
 * card on `/settings/usage` surfaces a current MAU gauge. Clerk's own
 * billing dashboard remains the source of truth for invoices; this mirror
 * exists so operators can see MAU next to request volume on the same page.
 *
 * Pagination: Clerk caps `limit` at 500. We page through up to
 * MAX_PAGES × 500 = 5000 users. If more users exist (unlikely for J&A at
 * this scale), the log records `pagesExhausted=true` in metadata so the
 * limitation is visible.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

const CLERK_API_BASE = "https://api.clerk.com/v1";
const PAGE_SIZE = 500;
const MAX_PAGES = 10;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export const snapshot = internalAction({
  args: {},
  returns: v.object({
    mau: v.number(),
    pagesScanned: v.number(),
    pagesExhausted: v.boolean(),
  }),
  handler: async (ctx) => {
    const startedAt = Date.now();
    const cutoff = startedAt - THIRTY_DAYS_MS;

    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      try {
        await ctx.runMutation(internal.serviceUsage.logger.log, {
          serviceKey: "clerk",
          feature: "clerk_mau_snapshot",
          status: "auth_error",
          durationMs: Date.now() - startedAt,
          errorMessage: "CLERK_SECRET_KEY not set on deployment",
        });
      } catch {
        // best-effort
      }
      return { mau: 0, pagesScanned: 0, pagesExhausted: false };
    }

    let mau = 0;
    let pagesScanned = 0;
    let pagesExhausted = false;

    try {
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const url =
          `${CLERK_API_BASE}/users` +
          `?last_active_at_since=${cutoff}` +
          `&limit=${PAGE_SIZE}` +
          `&offset=${page * PAGE_SIZE}`;

        const response = await fetch(url, {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${secretKey}`,
          },
        });

        if (!response.ok) {
          const body = await response.text();
          let status:
            | "auth_error"
            | "rate_limited"
            | "client_error"
            | "server_error"
            | "unknown_error" = "unknown_error";
          if (response.status === 401 || response.status === 403) status = "auth_error";
          else if (response.status === 429) status = "rate_limited";
          else if (response.status >= 400 && response.status < 500)
            status = "client_error";
          else if (response.status >= 500) status = "server_error";

          try {
            await ctx.runMutation(internal.serviceUsage.logger.log, {
              serviceKey: "clerk",
              feature: "clerk_mau_snapshot",
              status,
              durationMs: Date.now() - startedAt,
              errorCode: String(response.status),
              errorMessage: body.slice(0, 500),
              metadata: { pagesScanned },
            });
          } catch {
            // best-effort
          }
          return { mau, pagesScanned, pagesExhausted };
        }

        const payload = (await response.json()) as unknown;
        const rows = Array.isArray(payload) ? payload : [];
        mau += rows.length;
        pagesScanned = page + 1;

        if (rows.length < PAGE_SIZE) {
          // Last page — nothing more to fetch.
          break;
        }
        if (page === MAX_PAGES - 1) {
          pagesExhausted = true;
        }
      }
    } catch (error) {
      try {
        await ctx.runMutation(internal.serviceUsage.logger.log, {
          serviceKey: "clerk",
          feature: "clerk_mau_snapshot",
          status: "timeout",
          durationMs: Date.now() - startedAt,
          errorMessage:
            (error instanceof Error ? error.message : String(error ?? "")).slice(
              0,
              500,
            ),
          metadata: { pagesScanned },
        });
      } catch {
        // best-effort
      }
      return { mau, pagesScanned, pagesExhausted };
    }

    // Success — log one snapshot event.
    try {
      await ctx.runMutation(internal.serviceUsage.logger.log, {
        serviceKey: "clerk",
        feature: "clerk_mau_snapshot",
        status: "success",
        durationMs: Date.now() - startedAt,
        // `requestBytes` is repurposed here as a gauge carrier so the
        // rollup cron surfaces "current MAU" on the Clerk card without
        // the dashboard having to parse metadata. Value is an integer
        // (user count), not actual bytes.
        requestBytes: mau,
        metadata: {
          mau,
          pagesScanned,
          pagesExhausted,
          windowDays: 30,
        },
      });
    } catch {
      // best-effort
    }

    return { mau, pagesScanned, pagesExhausted };
  },
});
