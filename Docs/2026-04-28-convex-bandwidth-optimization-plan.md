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

#### #2 — `photos.collect()` cap to current revision

**Problem:** [convex/cleaningJobs/queries.ts:538-541](../convex/cleaningJobs/queries.ts#L538) reads every photo ever attached to a job. With historical revisions, this can be 50+ photos × ~500 B = 25 KB just for photo metadata.

**Fix:**
- Use existing `by_job_room` or add a `by_job_revision` index on `photos` table (check schema first)
- Filter to current revision only in `getJobDetailInternal`
- For "show all revisions" UI, expose a separate paginated query

**Expected saving:** ~5-10% per `getById` call.

---

### Wave 2 — Schema split (this week, requires migration)

#### #3 — Split `jobSubmissions` schema

**Problem:** Every `jobSubmissions` doc carries 4 heavy snapshot fields (photoSnapshot, checklistSnapshot, incidentSnapshot, roomReviewSnapshot). Convex has no field-level projection — any read pulls the full doc. With 10 submissions per job × 20 KB each, a single `getJobDetail` reads 200 KB just for submission history that the UI renders as counts.

**Fix:**
- New table `jobSubmissionMeta`: `_id, submissionId, jobId, revision, status, photoCount, beforeCount, afterCount, incidentCount, submittedAtServer, submittedAtDevice, submittedBy, supersededAt`
- Existing `jobSubmissions` retains snapshots only
- Mutation that creates a submission writes to BOTH (transactional within Convex mutation)
- `getJobDetailInternal`:
  - History list: read `jobSubmissionMeta` (thin)
  - Current submission: read one `jobSubmissions` doc by ID (heavy, but only one)
- New separate query `submissionDetail(submissionId)` for "view full evidence" UI
- Migration: backfill `jobSubmissionMeta` from existing `jobSubmissions` rows

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

### Wave 4 — Mutation hygiene (later)

#### #5 — `mutations.start` audit

**Problem:** 26 KB per `start` call is excessive. Likely culprits: dismissNotificationsForJob and syncConversationStatusForJob doing extra reads.

**Fix:**
- Profile what each side-effect helper reads
- Defer non-critical side effects to a scheduled action (e.g., dismissNotifications can be async)
- Cache cleaningJob read across the mutation (avoid double-reads in helpers)

**Expected saving:** ~50% on this function, ~22 MB/day at current load.

---

## Tracking

Each wave that lands in production gets logged in [project_temp_convex_db_rollback.md](../../../../../.claude/projects/-Users-atem-sites-jnabusiness-solutions-apps-ja-opscentral-admin/memory/project_temp_convex_db_rollback.md) under "Backend changes shipped during testing window" so the forward-migration step deploys them to `usable-anaconda-394` before the data import.

| Wave | Status | Date | Notes |
|---|---|---|---|
| 0 — `.take(10)` on jobSubmissions | ✅ Shipped | 2026-04-27 | Modest impact |
| 1.1 — pingActiveSession `sessionId` | 🚧 In progress | 2026-04-28 | This patch |
| 1.2 — photos cap | 🔜 Planned | 2026-04-28 | Same day |
| 2 — jobSubmissions schema split | 📋 Planned | TBD | Requires migration |
| 3 — Subscription audit | 📋 Planned | TBD | |
| 4 — start mutation audit | 📋 Planned | TBD | |

---

## Decision points

- **Convex Pro upgrade ($25/mo):** still on the table. If Wave 1 + Wave 2 don't get the projected monthly bandwidth under 6 GB at current testing load, upgrade is the pragmatic answer.
- **Forward-migration timing:** TBD, dependent on testing window length and feature shipment status.
