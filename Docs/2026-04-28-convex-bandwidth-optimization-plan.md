# Convex Bandwidth Optimization Plan

**Status:** Active — implementing in waves
**Owner:** Bertrand Atemkeng
**Started:** 2026-04-28
**Context tied to:** [Temp Convex DB cutover memory entry](../../../../../.claude/projects/-Users-atem-sites-jnabusiness-solutions-apps-ja-opscentral-admin/memory/project_temp_convex_db_rollback.md)

---

## Why this exists

On 2026-04-27, the original Convex deployment `usable-anaconda-394` hit its 6 GB monthly bandwidth quota (observed at 7.1 GB / 6 GB). To unblock testing while still on the free tier, the team migrated ja-bs.com + the iOS TestFlight build to a temporary Convex deployment `dev:whimsical-narwhal-849` (under team `chezsoistays`, project `chezsoi`).

After ~1 day on the new deployment, **bandwidth is already at 239 MB and projecting to ~7 GB/month** — same trajectory as the old DB. The temp deployment doesn't fix the underlying problem; it just delays it.

This plan documents the structural causes and the staged remediation.

---

## Strategy update — forward-migrate, do NOT roll back

The original plan (rollback to `usable-anaconda-394` once its quota resets) is being **replaced** with:

1. Continue feature development on `whimsical-narwhal-849` for the testing window
2. When the team is ready to consolidate, **clean** `usable-anaconda-394` (purge data, keep account/team)
3. Export from `whimsical-narwhal-849`, import into `usable-anaconda-394`
4. Flip Vercel + EAS env vars back to `usable-anaconda-394`
5. Decommission `whimsical-narwhal-849`

This avoids split-brain memory: all work happens on whimsical, then ships home as one consolidated import. Any data created during the testing window is preserved.

**Implication for backend changes during the window:** still need to deploy to `usable-anaconda-394` so its function code matches when we forward-migrate. Continue using:
- `CONVEX_DEPLOY_KEY='dev:whimsical-narwhal-849|...' npx convex deploy --yes` (whimsical)
- `npx convex dev --once --typecheck disable` (usable-anaconda-394 via team token)

---

## Diagnostic snapshot (2026-04-28)

### `whimsical-narwhal-849` after ~1 day

| Function | Bandwidth | Calls | Bytes/call |
|---|---|---|---|
| `cleaningJobs/queries.getById` | 102 MB | 3.3K | 31 KB |
| `cleaningJobs/mutations.start` | 44.7 MB | 1.7K | 26 KB |
| `cleaningJobs/mutations.pingActiveSession` | 16.9 MB | 1.7K | 10 KB |
| `hospitable/mutations.upsertReservations` | 10.6 MB | — | — |
| `cleaningJobs/queries.getMyJobDetail` | 8.9 MB | — | — |
| `cleaningJobs/queries.getMyAssigned` | 7.1 MB | — | — |

**Total: 239 MB / 6 GB free-tier limit (4% in 1 day → ~7 GB projected over 30 days)**

### Root causes (in order of magnitude)

1. **`getJobDetailInternal` reads the full `jobSubmissions` doc graph** — every submission carries `photoSnapshot`, `checklistSnapshot`, `incidentSnapshot`, `roomReviewSnapshot`. Even the `.take(10)` cap shipped on 2026-04-27 doesn't help because most jobs have <10 submissions, so `take(10)` ≈ `collect()`.

2. **`pingActiveSession` re-reads the full `cleaningJob` doc on every heartbeat** — only to compute `revision`. The cleaningJob is ~10 KB (denormalized property, cleaners array, acknowledgements, etc.). The actual heartbeat write is < 1 KB.

3. **`mutations.start` reads cleaningJob + dismissNotificationsForJob + syncConversationStatusForJob** — each side-effect helper does additional reads.

4. **Subscription fan-out** — Convex queries are reactive. Every change to a related table re-streams the full result to all subscribed clients. A query that's expensive once becomes catastrophic when subscribed by N clients across M state changes.

5. **`photos.collect()` unbounded** in `getJobDetailInternal` — fetches every photo ever attached to a job, regardless of whether the UI shows historical revisions.

---

## Optimization waves

### Wave 1 — Cheap wins (today, 2026-04-28)

#### #1 — `pingActiveSession`: accept `sessionId`, skip the job read

**Problem:** [convex/cleaningJobs/mutations.ts:608](../convex/cleaningJobs/mutations.ts#L608) does `ctx.db.get(jobId)` on every heartbeat just to compute `revision`. That's ~10 KB read per ping. Heartbeats fire every 30s per active cleaner — 1.7K calls/day at 10 KB = ~17 MB/day.

**Fix:**
- Change API: `pingActiveSession({ sessionId, jobId })` — `sessionId` becomes the primary key
- Mutation: `ctx.db.get(sessionId)` (~200 B) → patch `lastHeartbeatAt` and `updatedAt`
- Backward compat: if `sessionId` not supplied, fall back to current path (read job → findSession) for one release cycle, then remove

**Expected saving:** ~95% on this function, ~16 MB/day immediately on whimsical.

**Affected callers:**
- Web admin — uses pingActiveSession via Convex generated types
- Mobile cleaner app — same
- Both clients have `sessionId` available from `start` mutation's return value

**Migration:** ship with backward-compat path so old client builds keep working. Update client code to pass `sessionId`. Remove fallback after both apps are on the new build.

---

#### #2 — `photos.collect()` defensive cap (Wave 1.2 as actually shipped)

**Problem:** [convex/cleaningJobs/queries.ts:538-541](../convex/cleaningJobs/queries.ts#L538) reads every photo ever attached to a job. With historical revisions, this can be 50+ photos × ~500 B = 25 KB just for photo metadata.

**Investigated, not shipped:** original plan was to filter to "current revision only." On inspection the `photos` schema has no `revision` field — photos are scoped to `cleaningJobId` only. Proper revision-scoping would require a schema change + backfill, deferred to Wave 2.

**Shipped instead:** defensive `.take(200)` cap with `order("desc")`. Bounds the worst case for pathological jobs (many revisions, incident-heavy) without changing UI semantics for normal jobs (which have <10 photos). Does not solve the structural issue but stops a future runaway.

**Expected saving:** ~5-10% per `getById` call only on outlier jobs; near-zero on typical jobs. The bigger structural win is Wave 2.

---

### Wave 2 — Schema split (this week, requires migration)

#### #3 — Split `jobSubmissions` schema

**Problem:** Every `jobSubmissions` doc carries 4 heavy snapshot fields (photoSnapshot, checklistSnapshot, incidentSnapshot, roomReviewSnapshot). Convex has no field-level projection — any read pulls the full doc. With 10 submissions per job × 20 KB each, a single `getJobDetail` reads 200 KB just for submission history that the UI renders as counts.

**Approach:** ship in two waves (2.a additive writes, 2.b switch reads) so production stays correct between deploys.

#### Wave 2.a — Additive: schema + writes + backfill mutation (✅ shipped 2026-04-28)

- New table `jobSubmissionsMeta`: `submissionId, jobId, revision, status, submittedBy, submittedAtServer, submittedAtDevice, supersededAt, photoCount, beforeCount, afterCount, incidentCount, createdAt`
- Existing `jobSubmissions` schema unchanged
- `sealSubmission` (mutation creating new submissions) now inserts into BOTH tables transactionally
- Supersede patches now patch BOTH tables (jobSubmissions + matching meta row)
- `submitForApproval`'s prior-submission filter switched from heavy `.collect()` on jobSubmissions to thin `.collect()` on jobSubmissionsMeta — bonus bandwidth saving on the supersede path
- One-shot backfill mutation `convex/cleaningJobs/backfillMeta.ts:run` — paginated, idempotent (skips submissions that already have meta)
- **Reads in `getJobDetailInternal` still use the old jobSubmissions path** until backfill runs on the target deployment. This keeps production correct for existing data.

#### Wave 2.b — Switch reads in `getJobDetailInternal` (next)

- Use `cleaningJobs.latestSubmissionId` to fetch ONE heavy `jobSubmissions` doc for current-submission rendering
- Read `jobSubmissionsMeta` (cheap) for the history list
- Drop the `.take(10)` `jobSubmissions` read entirely
- New separate query `getSubmissionEvidence({ submissionId })` for any "view full evidence on a historical submission" UI flow (none today, but cheap to add)

**Pre-requisite for 2.b:** backfill must have run on the target deployment so existing submissions have meta rows. On `whimsical-narwhal-849` the backfill is a no-op (no historical submissions imported). On `usable-anaconda-394` the backfill runs at consolidation time when the deployment is unpaused.

**Expected saving:** ~70% on `getJobDetailInternal` (31 KB → ~10 KB per call) — saves ~70 MB/day on whimsical at current load.

**Risk:** medium. Schema migration affects mobile + web. Requires backfill mutation. Ship behind a feature flag.

---

### Wave 3 — Subscription scope (architectural, this week)

#### #4 — Audit subscription mount points

**Problem:** `getJobDetail`-class queries are reactive subscriptions. If they're mounted at a layout level or via a global provider, every change to any subscribed query re-streams to every active client.

**Fix:**
- Audit `useQuery(api.cleaningJobs.queries.getById, ...)` mount points
- Move to feature-component level, not layout level
- For "list" pages that show summary cards, use a dedicated thin query, not getById per row
- Consider `usePaginatedQuery` for any list that grows

**Expected saving:** highly variable; depends on current mount patterns.

---

### Wave 4 — `dismissNotificationsForJob` index scoping (shipped 2026-04-29)

**Problem confirmed:** the 26 KB/call cost on `mutations.start` was traced to `dismissNotificationsForJob`, which does:
```ts
ctx.db.query("notifications").withIndex("by_user", (q) => q.eq("userId", userId)).collect()
```
This reads **every notification** for the user (no filter at the index level) and then filters in memory by `dismissedAt === undefined`, type, and embedded `data.jobId`. A cleaner with months of activity can have hundreds of notifications, most already dismissed — so most of the bandwidth is spent reading rows that get filtered out.

8+ callers in production code (`mutations.start`, `mutations.complete`, all of `approve.ts`).

**Fix shipped:**
- New index `notifications.by_user_and_dismissed` on `[userId, dismissedAt]`.
- `dismissNotificationsForJob` now reads via that index with `dismissedAt === undefined` filter, scoping to undismissed only. The remaining type + jobId filter still happens in memory but only over the small undismissed slice.

**Expected saving:** ~50-80% on every caller of `dismissNotificationsForJob`. At current whimsical load, ~22 MB/day off `start` alone, plus proportional reductions on `complete` + `approve`.

**No data migration needed:** `dismissedAt: undefined` is the existing default for both new and historical rows, so the index materializes correctly without backfill.

---

## Tracking

Each wave that lands in production gets logged in [project_temp_convex_db_rollback.md](../../../../../.claude/projects/-Users-atem-sites-jnabusiness-solutions-apps-ja-opscentral-admin/memory/project_temp_convex_db_rollback.md) under "Backend changes shipped during testing window" so the forward-migration step deploys them to `usable-anaconda-394` before the data import.

| Wave | Status | Date | Notes |
|---|---|---|---|
| 0 — `.take(10)` on jobSubmissions | ✅ Shipped | 2026-04-27 | Modest impact |
| 1.1 — pingActiveSession prefix-index lookup | ✅ Shipped | 2026-04-28 | PR #27 (~95% saving on heartbeat) |
| 1.2 — photos `.take(200)` defensive cap | ✅ Shipped | 2026-04-28 | PR #28 (defensive only) |
| 2.a — jobSubmissionsMeta schema + writes + backfill mutation | ✅ Shipped | 2026-04-28 | PR #30 — additive only |
| 2.b — Switch reads in getJobDetailInternal to use jobSubmissionsMeta | ✅ Shipped | 2026-04-28 | PR #34 (re-PR after #30/#31 got tangled). Reads thin meta for history; uses latestSubmissionId pointer to fetch one heavy doc. |
| 4 — `dismissNotificationsForJob` scoped to undismissed via new index | ✅ Shipped | 2026-04-29 | PR #37 — adds `notifications.by_user_and_dismissed` index, scopes the read at the index level. Affects 8+ callers including `start`, `complete`, all of `approve.ts`. |
| 3.a — Hard cap on `cleaningJobs.queries.getAll` reads | ✅ Shipped | 2026-04-30 | This branch (stacked on Wave 4) — bounds unfiltered case to most-recent 500 via `by_scheduled.order("desc").take(500)`. 10+ subscription mount points were doing unbounded `.collect()` then memory-slicing. |
| 3.b — Audit and narrow individual subscription mount points | 📋 Planned | TBD | Component-level work — replace many `getAll` subscriptions with narrower queries, or convert to one-shot fetches where reactive isn't needed. |
| 5.a — `userJobAssignments` reverse-index: schema + writes + backfill | ✅ Shipped | 2026-04-30 | This branch — additive only. Reads still use old path. Backfill ran on whimsical (52 rows); will run on old DB at consolidation. |
| 5.b — Switch `getMyAssigned` read to `userJobAssignments` | 📋 Planned | After backfill on target DB | Mobile-app subscription, currently the dominant cost on mobile bandwidth. |

---

## Decision points

- **Convex Pro upgrade ($25/mo):** still on the table. If Wave 1 + Wave 2 don't get the projected monthly bandwidth under 6 GB at current testing load, upgrade is the pragmatic answer.
- **Forward-migration timing:** TBD, dependent on testing window length and feature shipment status.
