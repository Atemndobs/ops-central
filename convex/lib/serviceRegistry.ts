/**
 * Service Registry — pricing + quota metadata for every external service we
 * track. Lives in code (not a table) so it is type-safe and PR-reviewed.
 *
 * See Docs/usage-tracking/ADR.md §"Registry" for the canonical spec.
 *
 * Adding a new service:
 *   1. Add a literal to `ServiceKey`.
 *   2. Add an entry to `SERVICE_DEFINITIONS`.
 *   3. (Optional) Implement `computeCost` and `quotas` once we know the
 *      pricing + plan limits for that service.
 */

export type ServiceKey =
  | "gemini"
  | "clerk"
  | "hospitable"
  | "resend"
  | "convex"
  | "b2";

/**
 * Metrics the logger surfaces to `computeCost`. Matches the optional fields
 * on `serviceUsageEvents` rows. All fields optional — not every provider
 * returns every metric.
 */
export interface UsageMetrics {
  durationMs?: number;
  requestBytes?: number;
  responseBytes?: number;
  inputTokens?: number;
  outputTokens?: number;
  audioSeconds?: number;
}

export type QuotaWindow = "minute" | "hour" | "day" | "month";
export type QuotaMetric = "count" | "inputTokens" | "outputTokens" | "costUsd";

export interface ServiceQuota {
  /** Stable ID used as the dedupe-key prefix for notifications. */
  id: string;
  label: string;
  window: QuotaWindow;
  limit: number;
  metric: QuotaMetric;
  /** If set, the quota applies only to events with this `feature` string. */
  feature?: string;
  /** Percentages at which to fire an admin notification (e.g. [50, 80, 100]). */
  notifyAtPct: number[];
}

export interface ServiceDefinition {
  key: ServiceKey;
  displayName: string;
  docsUrl: string;
  /** Returns a USD cost estimate for a single call. Stubbed → 0 for unpriced services. */
  computeCost?: (m: UsageMetrics) => number;
  quotas?: ServiceQuota[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Registry
// ──────────────────────────────────────────────────────────────────────────────

export const SERVICE_DEFINITIONS: Record<ServiceKey, ServiceDefinition> = {
  gemini: {
    key: "gemini",
    displayName: "Google Gemini",
    docsUrl: "https://ai.google.dev/pricing",
    // Free tier: no charge. Stub returns 0; wire real pricing when we move off
    // the free tier.
    computeCost: () => 0,
    quotas: [
      {
        id: "gemini.free.rpd",
        label: "Gemini free-tier requests per day",
        window: "day",
        limit: 1500,
        metric: "count",
        notifyAtPct: [50, 80, 100],
      },
      {
        id: "gemini.free.rpm",
        label: "Gemini free-tier requests per minute",
        window: "minute",
        limit: 15,
        metric: "count",
        notifyAtPct: [80, 100],
      },
    ],
  },

  clerk: {
    key: "clerk",
    displayName: "Clerk",
    docsUrl: "https://clerk.com/pricing",
    computeCost: () => 0,
    // MAU-based quota — needs a distinct-user count, deferred until Phase C.
    quotas: [],
  },

  hospitable: {
    key: "hospitable",
    displayName: "Hospitable",
    docsUrl: "https://developer.hospitable.com/",
    computeCost: () => 0,
    quotas: [],
  },

  resend: {
    key: "resend",
    displayName: "Resend",
    docsUrl: "https://resend.com/pricing",
    computeCost: () => 0,
    quotas: [],
  },

  convex: {
    key: "convex",
    displayName: "Convex",
    docsUrl: "https://www.convex.dev/pricing",
    computeCost: () => 0,
    quotas: [],
  },

  b2: {
    key: "b2",
    displayName: "Backblaze B2",
    docsUrl: "https://www.backblaze.com/cloud-storage/pricing",
    // B2 pricing (as of Apr 2026): $0.006/GB-month storage, $0.01/GB download,
    // Class B (read) $0.004 / 10,000, Class C (list/delete) $0.004 / 1,000.
    // Inline we only price bandwidth when the caller reports bytes; storage
    // cost is surfaced by the nightly snapshot event which carries
    // `requestBytes` = total stored bytes + computed cost in metadata.
    computeCost: (m) => {
      if (!m.responseBytes) return 0;
      const gb = m.responseBytes / 1_000_000_000;
      return gb * 0.01; // download price (worst case)
    },
    quotas: [],
  },
};

/** Safe lookup — returns undefined for unknown keys so callers can soft-fail. */
export function getServiceDefinition(
  key: string,
): ServiceDefinition | undefined {
  return (SERVICE_DEFINITIONS as Record<string, ServiceDefinition>)[key];
}

/** Quota window → lookback duration in ms. */
export function quotaWindowMs(window: QuotaWindow): number {
  switch (window) {
    case "minute":
      return 60 * 1000;
    case "hour":
      return 60 * 60 * 1000;
    case "day":
      return 24 * 60 * 60 * 1000;
    case "month":
      // Approximation — 30 days. Good enough for threshold alerts.
      return 30 * 24 * 60 * 60 * 1000;
  }
}
