/**
 * Provider quota adapter types.
 *
 * Adapters are pure functions: they read env vars for credentials, call
 * the provider's HTTPS API, and return one or more QuotaSnapshots. They
 * never touch Convex `ctx` so the SAME module can be imported from:
 *
 *   - the Convex Node action `serviceUsage.providerSync.fetchAll` (cron)
 *   - the Next.js route `/api/ai/tools/get-service-usage` (chatbot)
 *
 * Keep dependencies to: globalThis.fetch, Buffer, process.env. Nothing
 * Convex-runtime-specific.
 */

export type QuotaUnit =
  | "calls"
  | "bytes"
  | "users"
  | "events"
  | "usd"
  | "seconds";

export type QuotaSnapshot = {
  serviceKey: string;
  /** Stable identifier for this quota (e.g. "function_calls_monthly"). */
  quotaKey: string;
  used: number;
  limit: number;
  unit: QuotaUnit;
  /** Inclusive ms epoch. */
  windowStart: number;
  /** Exclusive ms epoch. */
  windowEnd: number;
  /** ms epoch when the provider was actually called. */
  fetchedAt: number;
};

export type AdapterResult =
  | { ok: true; snapshots: QuotaSnapshot[] }
  | { ok: false; serviceKey: string; error: string };

export type Adapter = () => Promise<QuotaSnapshot[]>;
