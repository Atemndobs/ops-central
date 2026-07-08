# Implementation Plan — Real Quota Integration

Phased so each phase ships independently and you get visible value at
the end of each. Total estimate: ~2–3 focused days.

---

## Phase 0 — Pre-flight (½ day)

**Goal:** confirm the assumptions in `provider-apis.md` are real.

1. Generate a Convex team-scoped deploy key. Curl
   `https://api.convex.dev/v1/teams/bertrand-atemkeng/usage` and
   capture the actual JSON shape. Update `provider-apis.md` with
   verified field names.
2. Curl the Clerk users endpoint with `?limit=1`, confirm the
   `x-total-count` header is present.
3. Run B2 `b2_authorize_account` then `b2_get_account_info`. If no
   storage-used field, decide between Reports API and dashboard
   scrape — write the decision into `provider-apis.md`.

**Deliverable:** updated `provider-apis.md` with fields *we have
actually seen on the wire*. No code yet. If any provider doesn't
expose what we need, this is where we find out — not at hour 6.

**Acceptance:** all three providers return parseable JSON to a real
curl from a dev machine.

---

## Phase 1 — Schema + adapter scaffolding (½ day)

**Goal:** types and table ready, no behaviour change yet.

1. Schema patch in `convex/schema.ts`:
   - Add `source: v.optional(v.union(v.literal("self"), v.literal("provider")))`
     to `serviceQuotaCounters`.
   - Add `unit: v.optional(v.string())`.
   - Add `fetchedAt: v.optional(v.number())`.
   - All optional → no migration needed for existing rows.
2. New file `convex/serviceUsage/providers/types.ts` with the
   `QuotaSnapshot` type from `architecture.md`.
3. Stub adapter files: `providers/convex.ts`, `providers/clerk.ts`,
   `providers/b2.ts` — each exports a function that throws "not
   implemented" but has the correct signature.
4. New env vars added to Convex (`npx convex env set ...`):
   `CONVEX_TEAM_TOKEN`, `B2_APPLICATION_KEY_ID`, `B2_APPLICATION_KEY`,
   `B2_MONTHLY_BUDGET_USD`. (Clerk key already exists.)

**Acceptance:** `npx convex dev --once` succeeds, schema check passes,
no runtime impact on the live site.

---

## Phase 2 — Convex adapter + cron (½ day)

**Goal:** the Convex card on `/settings/usage` shows a real quota bar.
Ship value early — Convex is the one we're actively bleeding on.

1. Implement `providers/convex.ts` against the verified shape from
   Phase 0.
2. New file `convex/serviceUsage/providerSync.ts`:
   - `"use node";` at the top.
   - Internal action `fetchAll` that calls all registered adapters
     with `Promise.allSettled`.
   - Helper `upsertSnapshot(ctx, snap)` that does a keyed upsert into
     `serviceQuotaCounters` with `source: "provider"`.
3. Wire into `convex/crons.ts`: hourly call to
   `internal.serviceUsage.providerSync.fetchAll`.
4. UI patch in `service-card.tsx`: render `<QuotaBar>` when a
   `source: "provider"` row exists for that service. Keep the
   "No quotas configured yet" copy as the fallback for services with
   no provider rows.
5. Manually run the action once via Convex dashboard, confirm the
   Convex card on `/settings/usage` now shows a real percentage.

**Acceptance:** the percentage on the card is within ±5% of what
`dashboard.convex.dev` shows. Reload after an hour and confirm
`fetchedAt` advanced.

---

## Phase 3 — Clerk + B2 adapters (½ day)

**Goal:** parity for the other two paid services.

1. Implement `providers/clerk.ts` per `provider-apis.md`. Hardcode
   plan limits as a constant.
2. Implement `providers/b2.ts`. If Reports API is the path: implement
   it. If scrape is the path: build a thin agent-browser wrapper in a
   Next.js API route called from the action via fetch (Node action
   can't run a headless browser cheaply).
3. Add both to the `providerSync` registry.
4. Confirm both cards show real bars.

**Acceptance:** all three cards on `/settings/usage` show real quota
bars. Force a high-usage condition (e.g. spam Clerk signups in a
sandbox) and confirm the bar moves within one cron tick.

---

## Phase 4 — Overview + alerts (½ day)

**Goal:** admin sees pressure at a glance, doesn't have to scroll.

1. `usage-overview-client.tsx`:
   - Compute `quotaPressureCount` = services with any quota ≥80%.
   - Replace the third StatTile ("Services with recent errors") with
     a fourth column: "Quota pressure" — keep both, lay out as 4
     tiles on `xl:`, 2 tiles on `md:`.
   - Add a banner above the grid when any service is ≥90%, listing
     the affected service names and linking to its detail page.
2. Banner copy: "🚨 Convex quota at 94% (47 hours left in window).
   Upgrade plan or reduce usage to avoid service interruption."

**Acceptance:** burn the Convex quota to >90% in a sandbox, banner
appears within one cron cycle, dismissing it stays dismissed for that
session only (refresh shows it again).

---

## Phase 5 — Chatbot tool (½ day)

**Goal:** "how's our Convex quota?" works from any page.

1. New route `src/app/api/ai/tools/get-service-usage/route.ts`:
   - Verify Clerk session + admin/property_ops role.
   - Imports adapter functions directly from
     `convex/serviceUsage/providers/*` (these are pure functions —
     they work fine outside a Convex runtime as long as `fetch` and
     `process.env` are present).
   - Accepts optional `serviceKey`, returns array of snapshots plus a
     short human-readable summary string.
2. Register tool in the assistant's tool catalogue (see
   `docs/ai-ops-assistant/architecture.md` for where).
3. System prompt addition: "When the user asks about quotas, usage,
   limits, or 'are we running out of X', call `getServiceUsage`. Do
   NOT answer from memory — these numbers change constantly."
4. Test conversations:
   - "How close are we to the Convex quota?" → number with %.
   - "Are we running out of anything?" → calls tool with no
     argument, summarises any service ≥80%.
   - "What's our Clerk MAU?" → routes to Clerk only.

**Acceptance:** open Chrome devtools, ask the bot the question, see
the outbound HTTPS call to `api.convex.dev` in the network tab —
proving it's a fresh provider hit, not a Convex DB read.

---

## Phase 6 — Documentation + handoff (¼ day)

1. Update this folder's README with "Status: Live as of YYYY-MM-DD."
2. Add a "Service usage" section to the workspace
   `apps-ja/CLAUDE.md` so future Claude sessions know quotas are
   monitored and where the adapters live.
3. Save a memory note: which providers are wired, where the secrets
   live, what the alert thresholds are.

---

## Risk register

| Risk | Mitigation |
|------|------------|
| Convex Team API isn't actually public / requires unreleased token type | Phase 0 catches this. Fallback: dashboard scrape via agent-browser, documented in `provider-apis.md` |
| Adapter modules can't be imported from both Convex Node action AND Next.js route (path/runtime mismatch) | Keep adapters dependency-free (only `fetch`, `Buffer`, `process.env`). If true cross-runtime sharing fails, duplicate the adapter into `src/lib/providers/` and have the Convex action import from there as a relative path. Ugly but works |
| Provider rate limits at hourly cron + on-demand chatbot calls combined | Throttle the chatbot tool: if `fetchedAt` from the table is <5 min old, return the table row instead of hitting the provider. Best of both worlds |
| Schema migration breaks existing self-instrumented rows | All new fields are optional with defaults — additive only |
| Tokens leak into logs | Code review checkpoint: no `console.log(token)`, no token in error messages. Standard hygiene |

## Open questions for the build

1. Should the chatbot tool *also* write its result back into
   `serviceQuotaCounters`? Pro: free fresh data for the dashboard.
   Con: surprising side-effect from a "read" tool. **Default: yes,
   write it back** — same upsert path as the cron, no new code.
2. Cron cadence — 60 min vs 15 min? Start at 60, lower if the lag
   feels bad in practice. Each tick is 3 outbound HTTPS calls; cost
   is negligible either way.
3. Do we want SMS/email alerts on threshold crossings? Out of scope
   for v1. The banner + chatbot answer the immediate need. Revisit
   once we've actually crossed a threshold and felt how the banner
   performs.
