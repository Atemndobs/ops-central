# Cron Jobs — Architecture Review & Cost Reduction Plan

**Date:** 2026-04-24
**Author:** Architecture review
**Status:** Proposed — awaiting approval before implementation
**Context:** Convex DB quota was hit previously due to recurring cron traffic. This doc inventories every cron, identifies the DB-cost offenders, and proposes a **single-system** fix that stays on Convex rather than fragmenting to a second scheduler vendor.

---

## TL;DR

- We have **8 Convex crons**. Two of them cause ~95% of the recurring DB load: `escalate-pending-acknowledgements` (every 15 min) and `service-usage-b2-storage-snapshot-daily`. Both do **full-table scans** on tables that grow forever.
- The fix is **not** moving crons to Vercel / Upstash / GitHub Actions. Adding a second scheduler doesn't reduce the Convex read/write count — the *queries* are what cost money, not the scheduler.
- **Recommended architecture: stay on Convex, replace polling with (a) event-driven scheduling via `ctx.scheduler.runAt(...)` and (b) Hospitable webhooks (route already exists).** One system, fewer reads, no new vendor.
- Expected savings: the hot cron drops from ~96 full-table scans/day to ~0. Estimated ~80–90% reduction in cron-related Convex function calls.

---

## 1. Current Inventory

All crons defined in [`convex/crons.ts`](../convex/crons.ts).

| # | Cron ID | Schedule | Target | Runs/day |
|---|---------|----------|--------|----------|
| 1 | `sync-hospitable-reservations-hourly` | every 1h | `internal.hospitable.actions.syncReservations` | 24 |
| 2 | `sync-hospitable-property-details-daily` | every 24h | `internal.hospitable.actions.syncPropertyDetails` | 1 |
| 3 | `expire-report-exports-hourly` | every 1h | `internal.reports.mutations.expireExports` | 24 |
| 4 | `escalate-pending-acknowledgements` | every 15 min | `internal.cleaningJobs.acknowledgements.escalateExpiredAcknowledgements` | **96** |
| 5 | `service-usage-rollup` | every 1h | `internal.serviceUsage.crons.rollup` | 24 |
| 6 | `service-usage-retention` | every 24h | `internal.serviceUsage.crons.retention` | 1 |
| 7 | `service-usage-b2-storage-snapshot-daily` | `0 1 * * *` | `internal.serviceUsage.b2Snapshot.snapshot` | 1 |
| 8 | `archive-photos-to-minio-every-7-days` | `0 2 */7 * *` | `internal.files.archiveActions.archiveSevenDayPhotos` | ~0.14 |

**Total:** 171 cron invocations/day.

---

## 2. Cost Profile per Cron

Classification: 🔴 offender (refactor required) · 🟡 minor improvement possible · 🟢 healthy (leave alone).

### 🔴 #4 `escalate-pending-acknowledgements` (every 15 min)
- **What it does:** Marks cleaner-acknowledgement windows as expired; notifies ops.
- **Cost:** Runs `.collect()` on `cleaningJobs` filtered by `status ∈ {scheduled, assigned}` — **two near-full-table scans** every 15 minutes. At current volume that's the hottest single cost center in the whole backend.
- **Root cause:** Polling approach. The expiry time of every acknowledgement is **known at creation time**.
- **Fix:** Use Convex's built-in scheduler. When an acknowledgement window is created, call `ctx.scheduler.runAt(expiryTimestamp, internal.cleaningJobs.acknowledgements.escalateOne, { jobId })`. The function then checks that single job and escalates if still pending. No polling, no scans.

### 🔴 #7 `service-usage-b2-storage-snapshot-daily`
- **What it does:** Sums `byteSize` across all photos to report current B2 storage cost on the admin dashboard.
- **Cost:** `.take(10000)` on the `photos` table — unbounded scan that gets worse monotonically as photo volume grows.
- **Fix options (pick one):**
  1. **Maintain a running aggregate** — `photoStorageTotals` table with `{ storageBackend, totalBytes }`, incremented/decremented on every photo insert/delete/archive. Daily cron becomes a 1-row read.
  2. **Query by index only** — add `by_storage_backend` index, paginate by cursor, persist progress between runs.
- **Recommendation:** Option 1. The aggregate stays trivially cheap regardless of photo count.

### 🟡 #1 `sync-hospitable-reservations-hourly`
- **What it does:** Pulls the next 30 days of reservations from Hospitable and upserts stays/jobs.
- **Cost:** Hospitable API calls (N properties × 1 request) + upserts. DB cost is bounded and index-optimized.
- **The opportunity:** A Hospitable webhook route already exists at [`src/app/api/webhooks/hospitable/route.ts`](../src/app/api/webhooks/hospitable/route.ts). Reservations can be pushed as they're created/modified instead of polled hourly.
- **Proposed hybrid:** Webhook as the primary path; keep a **reconciliation cron** at a much lower frequency (e.g. every 6h or daily) to catch dropped webhooks. 24 runs/day → 4 or 1. Also eliminates hourly Hospitable API usage.

### 🟡 #2 `sync-hospitable-property-details-daily`
- Daily, bounded, mostly indexed. Could also move to a webhook (`property.updated`) but low priority — 1 run/day is not the problem.

### 🟢 #3 `expire-report-exports-hourly`
- Indexed query on `status` + `expiresAt`, bounded batch (100 + 200), self-reschedules if full. Small per-run cost; matches natural TTL semantics. **Leave as-is.**

### 🟢 #5 `service-usage-rollup` (hourly)
- Aggregates the prior hour's usage events. Indexed reads, bounded writes, naturally aligns to hour boundaries. **Leave as-is.**

### 🟢 #6 `service-usage-retention` (daily)
- 100-row batch deletes on index; self-reschedules. Tiny per-run cost. **Leave as-is.**

### 🟢 #8 `archive-photos-to-minio-every-7-days`
- Runs ~4×/month. Bulk archival of ~100 candidates per run. Cost dominated by B2↔MinIO I/O, not DB. **Leave as-is.**

---

## 3. Why Moving Crons Off Convex Doesn't Save Money

Reviewed alternatives, all rejected for our case:

| Alternative | Reason rejected |
|---|---|
| Vercel Cron → calls Next.js route → calls Convex | Same reads/writes still hit Convex. Adds a network hop. |
| Upstash QStash | Pay-per-message on top of unchanged Convex cost. New vendor, new secrets, new failure mode. |
| GitHub Actions scheduled workflows | 5-min minimum granularity, rate-limited, not prod-grade. |
| Cloudflare Workers Cron | Cheap scheduler, but again only moves *where* the trigger fires — the DB bill is identical. |

The Convex cost is the **query/mutation volume**, not the cron ticks themselves. A 15-minute full-table scan costs the same whether a Convex cron, a Vercel cron, or a Cloudflare cron triggers it.

**Conclusion:** the right fix is to stop polling, not to change who's polling. This preserves the "one system" principle (stated preference).

---

## 4. Target Architecture: Event-Driven on Convex

Three patterns replace all polling crons:

### Pattern A — Scheduler-at-creation (for time-bounded events)
Use when the future event time is knowable at write time (acknowledgement expiry, reminder, TTL).
```ts
// inside the mutation that creates the acknowledgement window
await ctx.scheduler.runAt(
  expiresAt,
  internal.cleaningJobs.acknowledgements.escalateOne,
  { jobId }
);
```
Applies to: cron **#4**.

### Pattern B — Webhook-first, reconciliation second (for external sync)
Primary path = inbound webhook. Keep a low-frequency reconciliation cron (not every hour) as a safety net for missed webhooks.
Applies to: crons **#1, #2**.

### Pattern C — Running aggregate (for "sum over all rows" metrics)
Maintain the aggregate incrementally on every write instead of recomputing from the full table.
Applies to: cron **#7**.

Remaining "pure time" crons (#3, #5, #6, #8) are already cheap and stay as Convex crons.

---

## 5. Migration Plan (phased, non-breaking)

Each phase ships independently; each is reversible.

**Phase 1 — Kill the biggest offender (#4)**
- Add `escalateOne` internal mutation (operates on a single job).
- Switch acknowledgement-creation path to `ctx.scheduler.runAt(...)`.
- Keep the existing 15-min cron running for one cycle as a backstop, then delete.
- *Expected win:* eliminates 96 full-table scans/day.

**Phase 2 — Storage snapshot aggregate (#7)**
- Create `photoStorageTotals` table.
- Backfill from one-time scan.
- Maintain on photo insert / archive / delete.
- Replace cron body with a single-row read.

**Phase 3 — Hospitable webhook-first (#1, #2)**
- Wire webhook route to call the same upsert helpers currently used by the cron.
- Drop `sync-hospitable-reservations-hourly` to every 6h (reconciliation mode).
- Add webhook delivery monitoring (log missed events).

**Phase 4 — Cleanup & docs**
- Delete dead cron code.
- Update runbooks.
- Add a lint rule / code-review checklist: new crons must pass the "is this a full-table scan?" check.

---

## 6. Decision Log

- **Q:** Should we move crons to Vercel Cron to save Convex compute?
  **A:** No. The cost is the queries, not the scheduler. Moving the trigger keeps the bill the same and adds a second system.
- **Q:** Should we introduce Upstash QStash / Cloudflare Cron?
  **A:** No, same reason. Also violates the "one system" principle.
- **Q:** Keep any crons at all?
  **A:** Yes — the 4 that are already cheap and naturally time-based (#3, #5, #6, #8). Event-driven doesn't help when the event *is* "a fixed point in time."

---

## 7. Open Questions

1. What's the actual expiry window for acknowledgements? (Determines Phase 1 `runAt` semantics.)
2. Does Hospitable's webhook cover all reservation mutation types we depend on? (Determines how low we can drop the reconciliation cron.)
3. Is the photo-count pain point severe enough that Phase 2 needs to ship before Phase 3, or can we sequence by impact on user-facing features?

---

## 8. Related Docs

- [`convex/crons.ts`](../convex/crons.ts) — current cron definitions
- [`convex/_generated/ai/guidelines.md`](../convex/_generated/ai/guidelines.md) — Convex API guidelines including scheduler usage
- [`src/app/api/webhooks/hospitable/route.ts`](../src/app/api/webhooks/hospitable/route.ts) — existing Hospitable webhook endpoint
