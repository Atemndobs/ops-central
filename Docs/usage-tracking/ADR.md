# ADR: Service Usage Tracking & Cost Observability

## Status

Proposed

## Date

2026-04-24

## Owner

TBD (J&A leadership to assign implementation lead)

## Context

J&A Business Solutions runs on a growing list of paid third-party services:
Convex (backend), Clerk (auth), Gemini (AI), Hospitable (PMS), Resend (email),
Sentry (errors), PostHog (analytics), plus occasional experimentation with
Groq and OpenAI. Today we have **zero internal visibility** into how much any
of these services are being used or what they are costing us.

That gap causes three concrete problems:

1. **Silent quota exhaustion.** The voice-messages feature (see
   `Docs/voice-messages/PLAN.md`) uses the Gemini free tier. When we hit the
   ~1500 requests/day or 15 RPM ceiling, transcription simply fails for the
   user with no warning to operators. Same pattern applies to any rate-limited
   service we add.
2. **No cost attribution.** Monthly invoices arrive as a single line item per
   vendor. We cannot point at a feature (voice, AI ops assistant, email
   notifications) and say "that cost us $X last month", which blocks rational
   decisions about pricing, pivoting, or cutting features.
3. **No early-warning signal.** We discover we are over-using a service only
   when it breaks, or when the bill arrives. There is no dashboard that tells
   us "you are tracking to spend $Y this month" or "you are at 80% of your
   free-tier quota on service Z".

The immediate trigger for this ADR is the voice-messages feature: the team
asked for a notification when Gemini quota is hit plus a dashboard to track
usage *before* we get there. But the right scope is all paid services — doing
it once generically is cheaper than doing it per-feature.

## Decision

We adopt a **single canonical usage-tracking system** applied uniformly to
every external service we depend on. The system has three components:

1. **A generic `serviceUsageEvents` table** that any Convex function can write
   to, logging every billable interaction with any external service.
2. **An `adminNotifier` helper** that fires debounced notifications to admin
   users when usage approaches or exceeds configured thresholds.
3. **A `/settings/usage` admin dashboard** that visualizes usage, costs, and
   quota consumption across all services.

This decision is deliberately opinionated to avoid a zoo of per-service
tracking tables. Adding a new tracked service should require only: (a) a
literal in the `serviceKey` union, (b) one call to the logging helper from the
relevant action, and (c) optional quota/cost metadata in a central registry.

### Non-decisions (explicit out-of-scope)

- **We will not** replace external observability tools. Sentry, PostHog, and
  Convex's own dashboard remain the source of truth for their own domains.
  This system exists to join their data into an operator-facing view of
  *cost* and *quota*, not debugging.
- **We will not** attempt to automatically throttle or fail-over between
  providers when quota is hit. The feature owner (e.g. voice) may implement
  that independently; this ADR only provides observability.
- **We will not** build real-time streaming metrics (sub-second). Hourly
  rollups are sufficient for cost/quota decisions.

## Canonical Data Model

### Table: `serviceUsageEvents`

One row per external call. High-churn, append-only. Indexed for the dashboard
queries listed below.

```ts
serviceUsageEvents: defineTable({
  // Which external service this call went to.
  serviceKey: v.union(
    v.literal("gemini"),
    v.literal("groq"),
    v.literal("openai"),
    v.literal("clerk"),
    v.literal("hospitable"),
    v.literal("resend"),
    v.literal("sentry"),
    v.literal("posthog"),
    v.literal("convex"),          // self-reporting for DB op counts
  ),

  // Which feature triggered the call. Free-form string, but should match
  // the canonical feature keys documented in the registry (see below).
  feature: v.string(),
  //   examples: "voice_transcription", "ai_ops_assistant",
  //             "hospitable_reservation_sync", "cleaner_invite_email"

  // Call outcome, normalized across providers.
  status: v.union(
    v.literal("success"),
    v.literal("rate_limited"),     // 429
    v.literal("quota_exceeded"),   // 402 / billing cap / plan limit
    v.literal("auth_error"),       // 401 / 403
    v.literal("client_error"),     // 400 / invalid request
    v.literal("server_error"),     // 5xx
    v.literal("timeout"),
    v.literal("unknown_error"),
  ),

  // Who initiated the call (if any). Optional because cron-triggered calls
  // are not tied to a user.
  userId: v.optional(v.id("users")),

  // Metrics. All optional — include whichever the provider surfaces.
  durationMs: v.optional(v.number()),
  requestBytes: v.optional(v.number()),
  responseBytes: v.optional(v.number()),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  audioSeconds: v.optional(v.number()),

  // Cost tracking. `estimatedCostUsd` is computed at write time from the
  // pricing registry — stored denormalized so historical rows survive
  // pricing changes. Nullable for services we cannot price inline.
  estimatedCostUsd: v.optional(v.number()),

  // Raw error shape for debugging. HTTP status if available.
  errorCode: v.optional(v.string()),
  errorMessage: v.optional(v.string()),

  // Provider-specific breadcrumbs we may want to query later (model name,
  // region, request ID). Kept as v.any() to avoid schema churn.
  metadata: v.optional(v.any()),

  createdAt: v.number(),
})
  .index("by_service_created", ["serviceKey", "createdAt"])
  .index("by_feature_created", ["feature", "createdAt"])
  .index("by_status_created", ["status", "createdAt"])
  .index("by_user_created", ["userId", "createdAt"]);
```

### Table: `serviceUsageRollups`

To keep the dashboard fast at scale, pre-aggregated hourly rollups are
computed by a cron job. Queries longer than 7 days read from rollups; shorter
windows read the raw events table.

```ts
serviceUsageRollups: defineTable({
  serviceKey: v.string(),        // same union as above, relaxed to string
                                 // so cron-driven writes stay lightweight
  feature: v.string(),
  bucketStart: v.number(),       // unix ms, aligned to the hour
  bucketSize: v.literal("1h"),   // reserved for later day/week rollups

  successCount: v.number(),
  errorCount: v.number(),
  totalDurationMs: v.number(),
  totalInputTokens: v.number(),
  totalOutputTokens: v.number(),
  totalAudioSeconds: v.number(),
  totalCostUsd: v.number(),
})
  .index("by_service_bucket", ["serviceKey", "bucketStart"])
  .index("by_feature_bucket", ["feature", "bucketStart"]);
```

### Registry: `convex/lib/serviceRegistry.ts`

The pricing + quota metadata lives in code, not a table, so it is type-safe
and PR-reviewed. One entry per service.

```ts
export interface ServiceDefinition {
  key: ServiceKey;
  displayName: string;
  docsUrl: string;

  // How we cost the service inline at write time. Returns USD estimate.
  // Receives the same metrics object the caller logs.
  computeCost?: (m: UsageMetrics) => number;

  // Known quotas with threshold warnings. Dashboard uses these to render
  // progress bars and the notifier uses them for threshold alerts.
  quotas?: Array<{
    id: string;              // "gemini.free.rpd"
    label: string;           // "Gemini free-tier requests per day"
    window: "minute" | "hour" | "day" | "month";
    limit: number;
    metric: "count" | "inputTokens" | "outputTokens" | "costUsd";
    feature?: string;        // filter to one feature, else all
    notifyAtPct: number[];   // e.g. [50, 80, 100] -> three notifications
  }>;
}
```

Initial registered services (minimum viable set):

| Key | Why | First quotas |
|---|---|---|
| `gemini` | Voice + AI ops assistant | free-tier RPM (15), RPD (1500) |
| `clerk` | Auth, paid beyond MAU threshold | monthly MAU vs plan |
| `hospitable` | Reservation sync, per-property pricing | monthly API calls |
| `resend` | Emails, $20/mo for 50k | monthly send count |
| `convex` | Self-reported for visibility only | monthly function calls |

Groq, OpenAI, Sentry, PostHog come online as we actually use them.

## Write Path — how features log usage

A single helper in `convex/lib/serviceUsage.ts` is the only way to write an
event. The helper:

1. Resolves the service definition from the registry.
2. Computes `estimatedCostUsd` from the metrics (if `computeCost` defined).
3. Writes a `serviceUsageEvents` row.
4. Checks quota thresholds and calls `adminNotifier` if crossed.

```ts
// Example call from convex/conversations/voice.ts transcribe action:
await logServiceUsage(ctx, {
  serviceKey: "gemini",
  feature: "voice_transcription",
  status: "success",
  userId: user._id,
  durationMs,
  inputTokens,
  audioSeconds,
  metadata: { model: "gemini-2.5-flash" },
});
```

All external-service actions MUST use this helper before this ADR can be
considered shipped. Direct inserts to `serviceUsageEvents` are forbidden by
convention (enforced via code review, not type system).

## Notifications — when & to whom

A debounced notifier triggers admin notifications on quota thresholds and on
specific error classes.

### Triggers
- Quota crossed a `notifyAtPct` boundary going up (e.g. first 80% hit of the day).
- A sustained `rate_limited` or `quota_exceeded` streak — 5+ failures in 10 min.
- First `auth_error` of any service per 24h (likely expired credential).

### Debounce
One notification per `(serviceKey, feature, thresholdBucket)` per 1 hour.
Bucket = the threshold (80, 100, etc.), so crossing 80% and then 100% yields
two notifications, but crossing 80% twice yields one.

### Recipients
All users with `role = "admin"`. Reuse the existing `notifications` table with
`type = "system"`. `pushSent` handled by the existing `opsNotifications` lib.

### Copy (example)
> **Gemini quota at 80%** — 1,210 / 1,500 requests used today for voice
> transcription. Projected to exceed free tier at current rate around 18:42.
> **Open AI Providers settings →**

## Read Path — dashboard UX

New page: `/settings/usage` (admin-only, route-gated).

### Layout (top to bottom)
1. **Summary row** — this-month cost estimate across all services. Month-over-month delta.
2. **Service grid** — one card per registered service:
   - Icon + name
   - Current-period usage vs quota (progress bar)
   - This-month cost estimate
   - Last error (if any, with timestamp)
   - "View details" link
3. **Service detail page** `/settings/usage/[serviceKey]`:
   - 30-day bar chart, requests/day, stacked by status
   - Cost line chart
   - Per-feature breakdown table
   - Recent errors list with filters
   - Raw event drill-down (paginated, last 100)

### Data sources
- Last 7 days → read `serviceUsageEvents` directly.
- 7–90 days → read `serviceUsageRollups`.
- >90 days → not stored (see retention).

## Retention

- `serviceUsageEvents`: 90 days. Older rows deleted by nightly cron.
- `serviceUsageRollups`: 2 years. Gives year-over-year comparisons without
  raw-event storage cost.
- Pricing-registry changes are versioned in git; the denormalized
  `estimatedCostUsd` on each event is immutable after write.

## Privacy

Usage events may contain `userId` referencing a cleaner or admin. Do not
expose individual user usage outside the admin dashboard. Do not include raw
message content, transcripts, email bodies, etc. in `metadata` — only
structural facts (model name, region, request ID).

## Migration Strategy

Because we have no existing tracking, there is nothing to migrate. The order
of operations is:

1. Add tables + registry + helper (zero existing writes).
2. Instrument the first feature that triggered this ADR (voice transcription).
3. Build the dashboard (reads will return empty lists gracefully).
4. Instrument remaining services in priority order.

Features added after this ADR is accepted MUST instrument usage as part of
the same PR. No new external-service call lands without a `logServiceUsage`
call.

## Implementation Phases

### Phase A — Foundation (first PR after this ADR)
- Tables: `serviceUsageEvents`, `serviceUsageRollups`.
- Registry with the 5 initial services (stubs for services not yet wired).
- `logServiceUsage` helper.
- `adminNotifier` helper with debounce.
- Nightly rollup cron + retention cleanup cron.
- First consumer: voice transcription.

### Phase B — Dashboard (second PR)
- `/settings/usage` overview page.
- `/settings/usage/[serviceKey]` detail page.
- Charts via Recharts (already in the project).
- Admin role gate on routes.

### Phase C — Broader instrumentation (follow-up PRs, one per service)
Wire Clerk, Hospitable, Resend into the logger. Each is a small, independent
PR that can be done in parallel after Phase A ships.

### Phase D — Cost-forecasting polish (later)
- Month-end projected cost per service.
- Email digest to admins (weekly) summarizing usage + cost trends.

## Consequences

### Positive
- Single place to answer "how much are we spending on X?".
- Quota exhaustion becomes operationally visible, not a user-facing surprise.
- Every new service integration inherits tracking for free.
- Denormalized cost on each event makes historical analysis trivial.

### Negative
- One table adds write amplification to every external-service call. At our
  scale this is negligible (< 10k writes/day projected), but it is not free.
- Registry metadata must be maintained as providers change pricing —
  expected maintenance overhead ~1 PR/quarter.
- Rollups + retention crons add operational complexity.

### Neutral / Decisions deferred
- Whether to expose usage to non-admin roles (e.g. property_ops seeing
  "their" costs). Defer until we know if it matters.
- Whether to mirror this data to PostHog for cross-surface analytics.
  Possible later — the event shape is compatible — but adds complexity now.

## Handoff Notes for the Implementation Session

A separate Claude session will pick this ADR up and build Phase A. That
session should:

1. Read this ADR in full before writing code.
2. Read `Docs/voice-messages/PLAN.md` to understand the first consumer.
3. Follow the file layout below:

```
convex/
├── lib/
│   ├── serviceRegistry.ts        NEW — the pricing + quota registry
│   ├── serviceUsage.ts           NEW — logServiceUsage helper
│   └── adminNotifier.ts          NEW — debounced admin notifications
├── serviceUsage/
│   ├── queries.ts                NEW — dashboard reads
│   ├── mutations.ts              NEW — internal write helpers
│   └── crons.ts                  NEW — rollup + retention jobs
├── schema.ts                     MODIFIED — two new tables
└── conversations/voice.ts        MODIFIED — first logServiceUsage call

src/
├── app/(dashboard)/settings/usage/
│   ├── page.tsx                  NEW — overview
│   └── [serviceKey]/page.tsx     NEW — detail
└── components/settings/
    └── usage/                    NEW — charts + cards
```

4. Coordinate with the voice-messages branch — both touch
   `convex/conversations/voice.ts`. Recommend landing voice first, then
   rebasing this work on top and adding the one `logServiceUsage` call.

5. UAT checklist:
   - Hit the Gemini API 5x, see 5 rows in `serviceUsageEvents`.
   - Force a 429 (mock or real), see a single admin notification.
   - Wait an hour, trigger again — no duplicate notification.
   - Cross the 80% threshold on a test quota, see one notification. Cross
     100%, see a second. Cross 80% again same day, see none.
   - Open `/settings/usage` as admin → see the data. As non-admin → 403.

## References

- `Docs/voice-messages/PLAN.md` — first consumer of this system.
- Existing `notifications` table in `convex/schema.ts:875` — notification
  substrate this system builds on.
- Existing `convex/lib/opsNotifications.ts` — push-notification plumbing.
