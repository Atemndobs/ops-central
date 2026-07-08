# Provider APIs — Per-Provider Reference

Concrete request/response shapes for each adapter. Verify against the
provider's live docs before implementing — these are documented as of
2026-04-26 and APIs drift.

---

## Convex

**Status as of 2026-04-26 (verified live):** Convex's team-usage API
requires a **member-level access token**. Service-account / team-scoped
tokens hit `UsageAccessDenied` on every team-usage path. Confirmed by
probing:

```
GET /api/dashboard/teams/{teamId}/usage/team_usage_state
  → 400 {"code":"UsageAccessDenied","message":"You don't have access to usage data for the requested team"}
GET /api/dashboard/teams/{teamId}/get_spending_limits
  → 403 {"code":"ServiceAccountCannotManageTeam","message":"Service accounts cannot manage teams"}
GET /v1/teams/{teamSlug}/usage           → 404
GET /v1/teams/{numericId}/usage          → 404
```

The deployment-info path (`/api/deployment/{name}/team_and_project`)
DOES work with a service-account token and returns `teamId`, but no
usage path off it accepts service-account scope.

**Implication:** the live-API path for Convex isn't viable today
without a member-token (which would expose a personal admin scope —
not appropriate for a server-side cron). Two practical options:

### Option A — Manual env-var overrides (current default)

Read the numbers from the Convex dashboard once a week and write them
to env vars:

```bash
npx convex env set CONVEX_PLAN_FUNCTION_CALLS_LIMIT 1000000   # Free plan
npx convex env set CONVEX_OBSERVED_FUNCTION_CALLS    1050000  # current usage
npx convex env set CONVEX_PLAN_BANDWIDTH_GB_LIMIT    1
npx convex env set CONVEX_OBSERVED_BANDWIDTH_GB      1.2
```

The adapter renders these as a real "live"-sourced bar against the
plan ceiling. Updated reading = update the env var = bar moves on the
next hourly cron tick (or on demand via the chatbot).

Stale, yes. But for "are we at 90% or 110%?" alerting it's accurate
enough — the user already gets the warning every time `convex dev`
runs, this just surfaces it on the dashboard too.

### Option B — Dashboard scrape (deferred)

Use agent-browser to load `https://dashboard.convex.dev/team/{team}/billing/usage`
and extract the numbers. Fragile, but fully automated. Build when the
manual cadence becomes annoying.

### Path C — Member-token (NOT recommended for server-side use)

Personal Convex access token from the dashboard would technically
work, but binding the cron to a single member's session creates a
single point of failure and a security smell. Don't do this.

**Sample call shape (kept for when Convex ships service-account access):**

```ts
const res = await fetch(
  `https://api.convex.dev/api/dashboard/teams/${teamId}/usage/team_usage_state`,
  {
    headers: {
      Authorization: `Bearer ${token}`,
      "Convex-Client": "opscentral-usage-adapter-1",
    },
  },
);
// Returns: { usageState: "OK" | "Approaching" | "Exceeded" | "Disabled" | "Paused" }
```

Adapter at `convex/serviceUsage/providers/convex.ts` calls this anyway —
when it eventually returns 200 instead of 400, the qualitative state
will start populating automatically (translated to a representative %
band).

**Window:** `windowStart = first ms of current UTC month`,
`windowEnd = first ms of next UTC month`. Convex bills monthly.

---

## Clerk

**Docs:** https://clerk.com/docs/reference/backend-api

**Auth:** `CLERK_SECRET_KEY` (already set in env for the existing
auth flow).

**Endpoint for MAU count:**

```ts
const res = await fetch(
  "https://api.clerk.com/v1/users?limit=1",
  { headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` } },
);
const totalCount = Number(res.headers.get("x-total-count") ?? 0);
```

**Plan limit:** hardcode in adapter — Clerk Free is 10,000 MAU as of
2026. If/when we upgrade, bump the constant. Not worth fetching
because the plan rarely changes and there's no cheap "what plan am I
on" endpoint.

```ts
const PLAN_LIMITS = { free: 10_000, pro: 100_000 } as const;
const limit = PLAN_LIMITS.free;
```

**Window:** rolling 30 days for MAU. Clerk's count is "users active
in the last 30 days" — use `windowStart = now - 30d`,
`windowEnd = now`.

---

## Backblaze B2

**Docs:** https://www.backblaze.com/apidocs/

**Auth (two-step):**

1. `b2_authorize_account` — exchanges keyId+key for an
   `authorizationToken` and `apiUrl`.
2. Subsequent calls use that token against `apiUrl`.

```ts
const auth = await fetch(
  "https://api.backblazeb2.com/b2api/v3/b2_authorize_account",
  {
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(
          `${process.env.B2_APPLICATION_KEY_ID}:${process.env.B2_APPLICATION_KEY}`,
        ).toString("base64"),
    },
  },
).then((r) => r.json());

const info = await fetch(
  `${auth.apiUrl}/b2api/v3/b2_get_account_info`,
  { headers: { Authorization: auth.authorizationToken } },
).then((r) => r.json());
```

**Fields available:**
- `info.absoluteMinimumPartSize`
- `info.recommendedPartSize`
- *Not* a direct "storage used" number — B2 doesn't expose that on
  account-info. For storage we need `b2_list_buckets` then per-bucket
  `b2_get_bucket_info` which returns `bucketInfo` and a separate
  reporting call.

**Practical path for v1:** use the **B2 Cloud Storage Reports API**
(`/b2api/v3/b2_get_bucket_usage` if available, otherwise daily
billing report endpoint). If neither is cheap to integrate, scrape the
B2 web console with agent-browser as a v1 fallback and revisit when
the volume justifies a clean integration.

**Plan limits:** B2 is pay-as-you-go — no hard quota. Treat as:
- `limit = monthly budget cap` (configured in env, e.g.
  `B2_MONTHLY_BUDGET_USD=50`)
- `used = actual spend this month`
- bar fills against budget rather than a real platform quota.

This is fine — the *purpose* is "alert me before it gets expensive,"
which is the same need as a hard quota.

---

## Future providers (deferred)

For each, document at minimum: auth env var, endpoint, response shape
fields, window definition, plan-limit source.

| Provider | Status | Notes |
|----------|--------|-------|
| Hospitable | Deferred | Reservation API; usage not metered, skip |
| Gemini (Google AI) | Deferred | Per-token billing; daily report API exists |
| PostHog | Deferred | Self-hosted org has no quota; skip |
| Sentry | Deferred | Per-event quota; org-level API |
| Resend | Deferred | Monthly send count; API exists |
| Vercel | Deferred | Bandwidth + function execution; team API |

Adding any of these = one new file under `providers/`, one entry in
the registry, one bump to the chatbot tool's `enum`. No other code
should change.
