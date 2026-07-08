/**
 * Clerk Backend API adapter — MAU vs plan limit.
 *
 * Auth: `CLERK_SECRET_KEY` (already present for the existing auth flow).
 *
 * Plan limit: hardcoded per tier. Bump when we upgrade. Detection
 * heuristic via `CLERK_PLAN` env var ("free" | "pro"); default = free.
 *
 * Window: Clerk's user count is "users active in the last 30 days" —
 * we model it as a rolling 30d window ending now.
 *
 * Counting strategy: Clerk's Backend API doesn't return `x-total-count`,
 * so we page through `last_active_at_since=<30d_ago>` with limit=500 and
 * sum the page sizes. Capped at MAX_PAGES × 500 = 5000 users — well above
 * the J&A scale today. This mirrors the proven pattern used by
 * `clerkSnapshot.ts`.
 */

import type { QuotaSnapshot } from "./types";

const PLAN_LIMITS: Record<string, number> = {
  free: 10_000,
  pro: 100_000,
};

const CLERK_API_BASE = "https://api.clerk.com/v1";
const PAGE_SIZE = 500;
const MAX_PAGES = 10;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function fetchClerkQuotas(): Promise<QuotaSnapshot[]> {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error("CLERK_SECRET_KEY not set");

  const plan = (process.env.CLERK_PLAN ?? "free").toLowerCase();
  const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;

  const fetchedAt = Date.now();
  const cutoff = fetchedAt - THIRTY_DAYS_MS;

  let used = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url =
      `${CLERK_API_BASE}/users` +
      `?last_active_at_since=${cutoff}` +
      `&limit=${PAGE_SIZE}` +
      `&offset=${page * PAGE_SIZE}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Clerk users API ${res.status}: ${body.slice(0, 200)}`);
    }
    const body = (await res.json().catch(() => [])) as unknown;
    const arr = Array.isArray(body) ? body : [];
    used += arr.length;
    if (arr.length < PAGE_SIZE) break;
  }

  return [
    {
      serviceKey: "clerk",
      quotaKey: "mau_rolling_30d",
      used,
      limit,
      unit: "users",
      windowStart: cutoff,
      windowEnd: fetchedAt,
      fetchedAt,
    },
  ];
}
