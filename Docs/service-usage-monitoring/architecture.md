# Architecture — Real Quota Integration

## Two read paths, one storage table

```
                  ┌────────────────────────────────────────┐
                  │   /settings/usage  (Next.js client)    │
                  │   "give me a stable, cached view"      │
                  └──────────────────┬─────────────────────┘
                                     │  useQuery(getOverview)
                                     ▼
                  ┌────────────────────────────────────────┐
                  │  Convex: serviceUsage.queries          │
                  │  reads serviceQuotaCounters            │
                  └──────────────────┬─────────────────────┘
                                     │
              ┌──────────────────────┴──────────────────────┐
              │  serviceQuotaCounters  (existing table)     │
              │  populated hourly by providerSync action     │
              └──────────────────────┬──────────────────────┘
                                     │
                                     ▼
                  ┌────────────────────────────────────────┐
                  │  Convex action: providerSync.fetchAll  │
                  │  Node runtime — `"use node";`           │
                  │  fetches each provider in parallel      │
                  └─────┬─────────────┬────────────┬───────┘
                        │             │            │
                        ▼             ▼            ▼
                  Convex Team   Clerk Backend  B2 b2_get_account_info
                     API            API             API
```

```
                  ┌────────────────────────────────────────┐
                  │  Chatbot panel  ("how's our quota?")   │
                  │   "give me LIVE data, right now"       │
                  └──────────────────┬─────────────────────┘
                                     │  tool call
                                     ▼
                  ┌────────────────────────────────────────┐
                  │  Next.js API route                      │
                  │  /api/ai/tools/get-service-usage        │
                  │  ──> calls the SAME provider adapters   │
                  │      directly, returns shape matching   │
                  │      serviceQuotaCounters row.          │
                  └────────────────────────────────────────┘
```

The dashboard reads from the table (cheap, reactive, slightly stale).
The chatbot bypasses the table and asks the provider directly (fresh,
single-shot, no Convex calls). Adapters are shared so we never write
"how to call Convex's API" twice.

## Components

### 1. Provider adapter modules

Location: `convex/serviceUsage/providers/`. One file per provider:

```
providers/
├── convex.ts        # Convex Team API
├── clerk.ts         # Clerk Backend API
├── b2.ts            # Backblaze B2 native API
└── types.ts         # shared QuotaSnapshot type
```

Each adapter exports a single function:

```ts
// providers/types.ts
export type QuotaSnapshot = {
  serviceKey: string;
  quotaKey: string;        // e.g. "function_calls_monthly"
  used: number;
  limit: number;
  unit: "calls" | "bytes" | "users" | "events";
  windowStart: number;     // ms epoch
  windowEnd: number;       // ms epoch
  fetchedAt: number;       // ms epoch
};

// providers/convex.ts
export async function fetchConvexQuotas(): Promise<QuotaSnapshot[]>;
```

Adapters are pure functions: read env vars for credentials, call HTTPS,
return a snapshot array. No Convex `ctx`, no I/O to the database.
This is what makes them reusable from both the cron action AND the
Next.js API route.

### 2. Convex action — `providerSync.fetchAll`

Location: `convex/serviceUsage/providerSync.ts` (new file).
Runtime: Node (`"use node";`) — required for the providers' SDKs and
for stable outbound HTTPS.

Responsibilities:
- Call every adapter in parallel with `Promise.allSettled`.
- For each returned `QuotaSnapshot`, upsert one row into
  `serviceQuotaCounters` keyed by `(serviceKey, quotaKey, windowStart)`.
- On per-provider failure, log to `serviceUsageEvents` with
  `status: "server_error"` so the existing UI surfaces "last error"
  but doesn't blow up the whole sync.

Schedule: hourly via `convex/crons.ts` (existing file). 60 min keeps us
well under any provider rate limit and gives the UI fresh data without
spamming.

### 3. `serviceQuotaCounters` schema additions

The table already exists. Required additions (all optional today):

| Field | Type | Why |
|-------|------|-----|
| `source` | `"self" \| "provider"` | Distinguish ground-truth from estimates. UI prefers `"provider"` rows when both present. |
| `unit` | `string` | Render correctly: "calls" vs "GB" vs "MAU". |
| `fetchedAt` | `number` | Show "synced 12 min ago" caption. |

Schema migration: additive, no breaking change. Existing rows default to
`source: "self"`.

### 4. UI changes

`src/components/settings/usage/service-card.tsx`:
- New `<QuotaBar used={n} limit={m} />` component. Green <80, yellow
  80–94, red ≥95.
- "synced 12 min ago" caption pulled from `fetchedAt`.

`src/components/settings/usage/usage-overview-client.tsx`:
- New StatTile: "Quota pressure — N / M services > 80%".
- Yellow/red banner above the grid when any service ≥90%.

### 5. Chatbot tool

`src/app/api/ai/tools/get-service-usage/route.ts` (or wherever the
existing tool routes live — check ai-ops-assistant docs):

```ts
export async function POST(req: Request) {
  const { serviceKey } = await req.json();
  const adapters = serviceKey
    ? [pickAdapter(serviceKey)]
    : [fetchConvexQuotas, fetchClerkQuotas, fetchB2Quotas];
  const results = await Promise.allSettled(adapters.map((a) => a()));
  return Response.json(flattenAndSummarize(results));
}
```

Imports the **same adapter module** the Convex action uses — that's
the whole point. No code is duplicated; only the transport differs.

Tool descriptor added to the assistant's tool catalogue:

```ts
{
  name: "getServiceUsage",
  description:
    "Check current quota usage for paid platforms (Convex, Clerk, " +
    "Backblaze). Returns live numbers fetched directly from each " +
    "provider's API. Use when the admin asks how close they are to " +
    "limits, or which services are running out.",
  parameters: {
    serviceKey: { type: "string", optional: true,
      enum: ["convex", "clerk", "b2"] },
  },
}
```

Role-gated to `admin` and `property_ops` only (already enforced on the
chatbot route — re-check on this tool to be safe).

## Provider matrix (v1)

| Provider | Auth | Endpoint | Quota fields we pull |
|----------|------|----------|----------------------|
| Convex | `CONVEX_TEAM_TOKEN` (deploy key, scope = team) | `https://api.convex.dev/v1/teams/{team}/usage` | function calls, action seconds, DB bandwidth, storage GB |
| Clerk | `CLERK_SECRET_KEY` | `https://api.clerk.com/v1/users?limit=0` (returns `total_count` header) | MAU vs plan limit (10k Free) |
| Backblaze B2 | `B2_APPLICATION_KEY_ID` + `B2_APPLICATION_KEY` | `b2_authorize_account` → `b2_get_account_info` | storage bytes, daily download bytes |

See [provider-apis.md](provider-apis.md) for exact request/response
shapes and the env vars each adapter needs.

## What this does NOT change

- The hourly self-instrumentation rollup (`serviceUsage.crons.rollup`)
  keeps running. It populates `serviceUsageRollups` for per-feature
  attribution. Two layers, two purposes:
  - `serviceUsageRollups` — "which page is causing the spend?"
  - `serviceQuotaCounters` (this work) — "how much is left?"
- The existing nightly `convexSnapshot.ts` row-count job keeps running.
  It's still useful for "how much data are we storing internally" even
  though it's not a billing signal.

## Failure modes & handling

| Failure | Behaviour |
|---------|-----------|
| Provider API down | Adapter throws → `Promise.allSettled` isolates it → other providers still sync → UI shows stale-but-flagged data ("last sync failed 2h ago") |
| Bad credentials | Same as above + log to `serviceUsageEvents` with `status: "auth_error"` so the existing "last error" caption surfaces it |
| Rate-limited by provider | Adapter returns `null`, we keep the previous row, log `status: "rate_limited"`. Hourly cadence should never trip this |
| Schema change at provider | Adapter parsing fails → caught, logged, UI shows stale + error. Never crashes the cron |

## Security

- All provider tokens stored as Convex environment variables, never in
  code. Same pattern as `RESEND_API_KEY` etc.
- Chatbot tool route guards on Clerk session + admin role before
  invoking adapters. Without this, a non-admin could trick the bot
  into leaking quota numbers.
- Adapters never log tokens; redact on error paths.
