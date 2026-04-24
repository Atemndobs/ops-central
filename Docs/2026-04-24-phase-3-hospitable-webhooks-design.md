# Phase 3 — Hospitable Webhook-First Sync (Design Note)

**Date:** 2026-04-24
**Status:** Design — awaiting approval before implementation
**Parent doc:** [2026-04-24-cron-jobs-architecture-and-cost-reduction.md](./2026-04-24-cron-jobs-architecture-and-cost-reduction.md)

This note closes the open questions called out in the parent cron-reduction doc for Phase 3. It captures what's already in the codebase, what we learned from Hospitable's docs, what's still unknown, and exactly what a minimal shippable implementation looks like.

---

## 1. What we have today

### Codebase

- **Sync cron** (`convex/crons.ts:7`): `sync-hospitable-reservations-hourly` runs `internal.hospitable.actions.syncReservations` every hour.
- **Property cron** (`convex/crons.ts:14`): `sync-hospitable-property-details-daily`.
- **Sync action** `convex/hospitable/actions.ts:470-566` — fetches all properties, then per-property queries a 30-day reservation window, normalizes, calls an upsert mutation per page.
- **Upsert mutation** `convex/hospitable/mutations.ts:50-272` — per-reservation logic is **inlined inside the loop**: property lookup → `stays` upsert → cleaningJob create/update/cancel. Cancel path flips jobs to `"cancelled"` and calls `syncConversationStatusForJob`.
- **Reusable helpers already extracted:**
  - [`normalizeReservation()`](../convex/hospitable/actions.ts) — pure function, takes raw Hospitable payload → normalized struct.
  - [`normalizePropertyDetails()`](../convex/hospitable/actions.ts), [`extractRoomsFromProperty()`](../convex/hospitable/actions.ts).
  - `isCancelledStatus()`, `buildCleaningNotes()` in `mutations.ts`.
- **Webhook stub** [`src/app/api/webhooks/hospitable/route.ts`](../src/app/api/webhooks/hospitable/route.ts) — 30 lines of TODO comments. No signature verification, no event parsing, no Convex call.

### What Hospitable gives us

Sources: [v2 webhooks help doc](https://help.hospitable.com/en/articles/10008203-webhooks-for-reservations-properties-messages-and-reviews), [developer portal index](https://developer.hospitable.com/docs/public-api-docs/k4ctofvqu0w8g-hospitable-api-v2), [keithah/hospitable-python SDK](https://github.com/keithah/hospitable-python).

**Event names (exact strings per help doc):**

- `reservation.created`
- `reservation.changed` ⚠️ — note: the SDK README uses "updated"; the official help doc uses "changed". We'll **accept both** defensively.
- `property.created`, `property.changed`, `property.deleted`, `property.merged`
- `message.created`, `review.created` — out of scope for Phase 3.

**Payload shape** (from the community SDK; official portal is JS-rendered and WebFetch couldn't read it):

```json
{
  "id": "01GTKD6ZYFVQMR0RWP4HBBHNZC",
  "action": "reservation.created",
  "data": { /* full reservation object, shape matches GET /reservations */ },
  "created": "2023-10-01T09:35:24Z",
  "version": "1.0"
}
```

The `data` payload matches the `GET /reservations` item shape, so **`normalizeReservation()` should work on it directly.**

**Signature (per community SDK):**

- HMAC-SHA256 over the raw request body.
- Secret is the webhook secret configured in Hospitable.
- **Signature header name is not documented.** The Python SDK doesn't commit to one. We'll need to capture the headers of a live webhook call (log-all-headers pass) to learn it.

**Transport:**

- POST, `Content-Type: application/json`, expects `200 OK`.
- Retries 5 times at 1s / 5s / 10s / 1h / 6h.
- Source IPs: `38.80.170.0/24`.
- **Only reservations with "Accepted" last-status are delivered.**

### Known unknowns (must be resolved before go-live)

1. **Signature header name** — unknown. Learn from production traffic.
2. **Cancelled-reservation delivery** — help doc says "only Accepted" is delivered, but existing cron treats `status === "cancelled"` as a real signal. We need to confirm whether cancellations fire `reservation.changed` with a cancelled status, or whether cancellations simply stop being delivered (which would mean the cron is still required to notice cancellations).
3. **Whether `property.changed` carries full property details** — if it only carries the ID, we still need the property-details cron.

---

## 2. Target architecture

### Event flow

```
Hospitable ──POST──▶ /api/webhooks/hospitable
                          │
                          ├── 1. verify HMAC-SHA256 signature → 401 on fail
                          ├── 2. check idempotency (by payload.id)
                          ├── 3. parse action
                          └── 4. call Convex internal action → upsert logic
                                    │
                                    └── reuses normalizeReservation() +
                                        the NEW upsertSingleReservation()
```

### Refactor required in Convex

Extract the per-reservation body (currently `mutations.ts:71-241`) into:

```ts
export async function upsertSingleReservation(
  ctx: MutationCtx,
  normalized: NormalizedReservation,
): Promise<{ jobId: Id<"cleaningJobs"> | null; staysId: Id<"stays"> | null }>
```

Existing `upsertReservations` mutation loops and calls `upsertSingleReservation` once per reservation — **no behavior change.** Webhook handler calls it once per event. This is the single biggest change in the whole phase.

### New: webhook-received event log

Single table for idempotency + debugging:

```ts
hospitableWebhookEvents: {
  hospitableEventId: string,   // payload.id — unique per delivery
  action: string,              // e.g. "reservation.changed"
  receivedAt: number,
  processedAt?: number,
  processingError?: string,
  rawPayload: any,             // kept for troubleshooting; prunable
}.index("by_event_id", ["hospitableEventId"])
```

On receipt: insert (or no-op on conflict), process, patch `processedAt`. Retry-delivered events short-circuit.

### Cron frequency changes

- `sync-hospitable-reservations-hourly` → **every 6h** (reconciliation only; catches missed webhooks).
- `sync-hospitable-property-details-daily` → **unchanged** until we confirm `property.changed` carries full details.

### Monitoring

- Log every webhook receipt with action + hospitableEventId + verify-pass/fail + latency.
- A simple admin page or counter: "last webhook received: Nm ago" so a stopped webhook stream is visible.

---

## 3. Open questions for the maintainer (Bertrand)

Before coding:

1. **Webhook secret.** Is there an existing Hospitable webhook secret configured? If not, we need to create one in the Hospitable dashboard and set it as `HOSPITABLE_WEBHOOK_SECRET` in Vercel env. Both the dev Convex deployment and prod need it.
2. **Signature header discovery.** Are you willing to deploy a first pass that *logs all incoming headers* (no enforcement) for 24h so we can see the exact header name Hospitable uses? Once identified, the second pass enforces verification. Safer than guessing.
3. **Cancellation semantics.** Do you know off-hand whether a cancelled reservation fires `reservation.changed` with a cancelled status, or just stops firing? If you don't, we can keep the hourly cron temporarily until we observe one cancellation in the log.
4. **Scope of Phase 3.** Recommend keeping it to reservations only (the biggest cost). Property/message/review webhooks can follow in separate phases.

---

## 4. Proposed execution plan (3 PRs)

**PR A — Extract `upsertSingleReservation()`.** Pure refactor, no behavior change. Cron still does all the work. Easy to verify: running cron before and after should produce identical DB state.

**PR B — Webhook endpoint + signature discovery mode.** Implements the route, idempotency table, and Convex mutation call. Signature verification is **log-only** (records pass/fail but does not reject). Lower reconciliation cron to every 6h. Deploy, let it run 24h, inspect logs to confirm (a) events arrive, (b) the actual signature header name, (c) cancellation behavior.

**PR C — Enforce signature + cleanup.** Flip signature verification to enforcing, delete the logging-only code, document the secret rotation procedure.

This staging prevents a security hole from shipping (enforcing a guessed header name would be worse than not verifying at all) and lets us learn Hospitable's exact behavior from their own traffic before committing code to it.

---

## 5. Impact on the parent plan

| Cron | Before | After Phase 3 | Annual runs saved |
|---|---|---|---|
| `sync-hospitable-reservations-hourly` | 24/day | 4/day (reconciliation) | ~7,300 |
| `sync-hospitable-property-details-daily` | 1/day | 1/day (unchanged) | 0 |

Not the biggest saving in absolute terms — Phases 1 & 2 are larger — but eliminates the hourly Hospitable API calls and their usage-tracking overhead, and moves us toward an event-driven architecture that's easier to reason about.

---

## 6. Decision gate

**Do not start coding PR A** until #1 and #2 in §3 have answers. #3 is informational — we can write code either way.
