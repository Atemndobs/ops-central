## Team Metrics + Avatar Sync (No Mocks) Plan

### Summary
- Current behavior is mock-driven for several Team card fields:
  - `WORKING/AVAILABLE/OFF` is computed from `index % ...`, not real-time.
  - `quality`, `avgDuration`, and part of `onTime` are synthetic (`Math.max(82, ...)`, fixed durations).
- Julie/Randalls avatar issue in the active deployment (`dev:usable-anaconda-394`) is data-sync related:
  - Their `users.avatarUrl` is still Clerk default.
  - No metadata image fields exist for them in current records.
  - Existing sync path only guarantees current signed-in user freshness; non-active users can lag.
- Decisions locked:
  - Status source: **job-derived**
  - Avatar source of truth: **Clerk wins**
  - Avatar edit path: **Clerk only**
  - Cross-user sync mechanism: **Clerk webhook**
  - Quality formula: **approval-based**
  - Canonical deployment: **usable-anaconda-394**

### Implementation Changes
- Add a Convex team-metrics query (single source for Team UI business logic), e.g. `admin/queries:getTeamMetrics`.
- Return per-user computed fields (real data only): `availability`, `onTimePct`, `qualityScore`, `avgDurationMinutes`, `activeAssignmentsCount`, `completedJobsCount`, plus identity/profile/company fields.
- Replace UI-side mock calculations in Team page with query output only (remove index-based availability, fake quality, fake avg duration, hard floor for on-time).
- Define v1 status mapping (job-derived):
  - `WORKING`: user has any assigned job in `in_progress` or `awaiting_approval`
  - `AVAILABLE`: user has assigned `scheduled`/`assigned` work in upcoming operational window (default: next 24h)
  - `OFF`: otherwise
- Define v1 quality mapping (approval-based, 30-day window):
  - Rated jobs = assigned jobs in `completed`, `awaiting_approval`, `rework_required`, `cancelled`
  - Positive outcomes = `completed` + `awaiting_approval`
  - Quality score = `5 * (positive / rated)` with clamp `[0,5]`
  - If no rated jobs: return `null` and render `—`
- Add Clerk webhook ingestion for user profile sync (user.created/user.updated):
  - Verify Clerk webhook signature in server entrypoint.
  - Forward normalized user payload to Convex mutation that updates `users.avatarUrl`, `name`, `email`, and role mapping.
  - Keep existing client-side self-sync as fallback, not primary cross-user sync.
- Add one-time backfill step using existing reconciliation path to update current stale users (including Julie/Randalls) from Clerk directory after webhook deployment.

### Public Interfaces / Contracts
- New Convex query contract: `admin/queries:getTeamMetrics(args: { lookbackDays?: number; horizonHours?: number })`.
- New Convex mutation contract for webhook-driven upsert, e.g. `admin/mutations:upsertUserFromClerkWebhook(args: { clerkId; email; name?; avatarUrl?; role?; webhookToken })`.
- New webhook endpoint contract (Clerk → app) for `user.created` and `user.updated` events.
- Team page contract change: render from `getTeamMetrics` output; no local metric synthesis.

### Test Plan
- Convex unit tests for metrics computation:
  - status transitions across job states/times
  - on-time calculations with/without actual timestamps
  - quality score across approved/rework/cancelled mixes
  - null/empty-data behavior (`—` rendering inputs)
- Webhook tests:
  - valid signature updates user avatar/name/email/role
  - invalid signature rejected
  - idempotent repeated event handling
- Integration/manual checks:
  - Update Julie/Randalls photo in Clerk, confirm Team avatar updates without those users logging in.
  - Confirm Team cards/list/leaderboard show only real-derived metrics and no synthetic values.
  - Confirm no regression for admin role/company assignment menu actions.

### Assumptions
- `cleaningJobs` remains the authoritative source for operational status/metrics in v1.
- No new mobile heartbeat protocol is introduced in this iteration.
- Since “Clerk wins,” manual Convex avatar edits are not supported as authoritative and may be overwritten by sync.
