# Hospitable Webhook — Implementation Plan (P0.1)

**Date:** 2026-05-18
**Worktree:** `~/sites/opscentral-admin-hospitable-webhook` on `task/hospitable-webhook`
**Parent roadmap:** [2026-05-18-agentic-os-roadmap.md](2026-05-18-agentic-os-roadmap.md) — Phase 0, item P0.1
**Design source:** [2026-04-24-phase-3-hospitable-webhooks-design.md](2026-04-24-phase-3-hospitable-webhooks-design.md)

> This plan operationalizes the 2026-04-24 design. The design is still current — nothing has been built since then. Re-confirmed by reading the stub at [src/app/api/webhooks/hospitable/route.ts](../src/app/api/webhooks/hospitable/route.ts) (still 30 lines of TODOs).

---

## Goal

Convert Hospitable reservation sync from **hourly polling** to **event-driven webhook ingestion**, with the cron retained at lower frequency as a reconciliation safety net.

## Success criteria

1. New reservations from Hospitable produce a `cleaningJobs` row within seconds, not up to an hour.
2. Reservation date changes propagate within seconds.
3. Cancellations flip jobs to `"cancelled"` and reconcile conversation status within seconds.
4. Webhook is idempotent — retry deliveries don't double-write.
5. HMAC signature verification rejects unsigned/forged requests.
6. Reconciliation cron drops from 24/day to 4/day. Annual run count: ~7,300 fewer.
7. Zero behavior regression in the existing per-reservation upsert logic (verified by PR A diff).

## Non-goals (this phase)

- `property.created` / `property.changed` / `property.merged` / `property.deleted` events.
- `message.created`, `review.created` events.
- Removing the property-details daily cron.
- Multi-deployment fan-out (we have one prod, `lovable-oriole-182`).

---

## Three-PR staging (carried forward from design)

### PR A — Refactor (no behavior change)

Extract per-reservation body from `convex/hospitable/mutations.ts` (`upsertReservations`, lines ~71–241) into:

```ts
export async function upsertSingleReservation(
  ctx: MutationCtx,
  normalized: NormalizedReservation,
): Promise<{ jobId: Id<"cleaningJobs"> | null; staysId: Id<"stays"> | null }>
```

- Existing `upsertReservations` mutation becomes a thin loop that calls `upsertSingleReservation` once per item.
- Cron path unchanged.
- **Verification:** before/after, hourly cron produces byte-identical DB writes for one full cycle. We capture writes via `convex logs` and diff.

### PR B — Webhook endpoint, log-only signature mode

1. **New table** `hospitableWebhookEvents` with index `by_event_id` on `hospitableEventId` for idempotency + replay debugging.
2. **Convex internal action** `internal.hospitable.webhooks.processEvent` — takes raw payload, normalizes via existing `normalizeReservation()`, calls `upsertSingleReservation()`.
3. **Next.js route** `src/app/api/webhooks/hospitable/route.ts`:
   - Read raw body (don't `.json()` directly — we need bytes for HMAC).
   - Compute HMAC-SHA256, **log pass/fail, do NOT reject** (header name still unknown — see §Blockers).
   - Log full request headers (one-time discovery).
   - Insert into `hospitableWebhookEvents`; on conflict by `hospitableEventId`, short-circuit with 200.
   - Dispatch to Convex action; on success patch `processedAt`; on error patch `processingError`.
   - Always return 200 unless the payload is unparseable (so Hospitable doesn't burn retries on our bugs).
4. **Cron** `sync-hospitable-reservations-hourly` → run every 6h.
5. **Runtime:** Node.js runtime on Vercel (we need `crypto.timingSafeEqual`, and the Convex client is friendlier on Node than Edge). Explicit `export const runtime = "nodejs"`.
6. **Region:** Vercel default (no edge — webhook is low-volume).
7. Deploy, let it run ~24h with real Hospitable traffic, inspect the headers + signature pass/fail log.

### PR C — Enforce signature + cleanup

- Replace log-only verification with reject-on-fail (401).
- Remove the one-time header-dump logging.
- Document the secret rotation procedure in `Docs/runbooks/`.
- (Optional) drop `processedAt`-old `hospitableWebhookEvents` rows after 30 days via a prune cron.

---

## File-level changes (precise)

| Path | Change | PR |
|---|---|---|
| `convex/hospitable/mutations.ts` | Extract `upsertSingleReservation`; rewrite `upsertReservations` as loop | A |
| `convex/hospitable/actions.ts` | No change in PR A; export `normalizeReservation` if not exported | A |
| `convex/schema.ts` | Add `hospitableWebhookEvents` table + index | B |
| `convex/hospitable/webhooks.ts` (new) | `processEvent` internal action | B |
| `src/app/api/webhooks/hospitable/route.ts` | Replace stub with full handler | B |
| `convex/crons.ts` | Reservation cron hourly → every 6h | B |
| `src/app/api/webhooks/hospitable/route.ts` | Flip signature to enforcing, remove header-dump | C |
| `Docs/runbooks/hospitable-webhook-secret-rotation.md` (new) | Operational runbook | C |

## Schema diff (PR B)

```ts
hospitableWebhookEvents: defineTable({
  hospitableEventId: v.string(),
  action: v.string(),
  receivedAt: v.number(),
  processedAt: v.optional(v.number()),
  processingError: v.optional(v.string()),
  rawPayload: v.any(),
  signatureValid: v.optional(v.boolean()), // log-only in PR B
  signatureHeaders: v.optional(v.any()),   // log-only in PR B, removed in PR C
}).index("by_event_id", ["hospitableEventId"]),
```

## Env vars (Vercel + Convex)

- `HOSPITABLE_WEBHOOK_SECRET` — Hospitable dashboard → Vercel (Production + Preview) → also exposed to Convex for HMAC if we move verification server-side later. **PR B starts in Next.js route only.**

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Wrong signature header name guessed → security hole | PR B logs-only; we observe real traffic before enforcing in PR C |
| Cancellation not delivered as webhook | Reconciliation cron retained at 6h frequency catches missed cancellations |
| Duplicate delivery | `hospitableEventId` unique-by-index idempotency check |
| Next.js silently parsing body twice | Use `await request.text()` for HMAC, parse JSON once afterward |
| Convex action timeout on slow upsert | Webhook returns 200 immediately after enqueuing; Convex action handles retries internally |
| Edge runtime breaks `crypto.timingSafeEqual` | Pin `runtime = "nodejs"` in route |

## Verification plan

**PR A:**
- Run hourly cron once on dev. Capture mutation log. Apply refactor. Run again. Diff DB state — must be identical.
- Unit test `upsertSingleReservation` with three fixtures: create, update (date change), cancel.

**PR B:**
- Deploy to prod with secret set.
- Wait 24h. Inspect `hospitableWebhookEvents` rows:
  - Are events arriving?
  - What header name carries the signature? (look at `signatureHeaders` column)
  - Do cancellations arrive as `reservation.changed` with cancelled status?
  - What's the pass rate of HMAC verification across the candidate header names?
- Reconciliation cron runs at 00:00, 06:00, 12:00, 18:00 — confirm it still works and detects no diffs after a clean webhook day.

**PR C:**
- Force a known-bad signature → expect 401.
- Force a duplicate `hospitableEventId` → expect 200 fast-path (no double-write).
- Run for 7 days, monitor "last webhook received" admin counter.

## Rollback

- PR A: revert commit. Behavior identical anyway.
- PR B: revert route.ts + crons.ts changes (back to hourly polling). Leave `hospitableWebhookEvents` table — no harm in keeping it.
- PR C: revert to PR B state (log-only). Webhook keeps working.

---

## Blockers before PR A starts (from design §3 + §6)

1. **`HOSPITABLE_WEBHOOK_SECRET`** — does one exist in the Hospitable dashboard? If not, Bertrand creates it and sets in Vercel env.
2. **Header-discovery deploy approval** — OK to deploy PR B in log-only signature mode for 24h to learn Hospitable's exact header name? Alternative: guess `X-Hospitable-Signature` and risk a false-reject security hole. (Recommended: yes, log-only first.)
3. **Cancellation semantics** — informational, not blocking. We'll observe it in the PR B log window.

---

## Execution order

1. Answer blockers #1 and #2 above.
2. PR A (refactor) — 1 day. Ship to prod.
3. PR B (webhook + log-only) — 2 days build + 1 day observation. Ship to prod, wait 24h.
4. PR C (enforce + cleanup) — 0.5 day. Ship to prod, monitor 7 days.
5. Mark P0.1 complete in [agentic-os-roadmap.md](2026-05-18-agentic-os-roadmap.md) changelog. Move to P0.2 (icons) or P1.1 (Anthropic SDK).

Total elapsed: ~5 working days including observation windows.
