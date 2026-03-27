# Cleaning Execution Implementation and Rollout Plan

## Implementation Status (as of 2026-03-27)
- Implemented in admin codebase:
  - Revision-aware execution/session/snapshot schema and contracts.
  - Canonical submit-for-approval workflow with compatibility alias.
  - Rejection/reopen revisioning path.
  - Durable detail + live presence split queries.
  - Admin job detail UI integration for timing, before/after gallery, and live presence.
- Pending in cleaners app:
  - Full contract adoption for start/heartbeat/submit with offline tokens.

## Phased Rollout

### Phase 1: Backend Contract Deployment
1. Deploy schema changes for `jobExecutionSessions` and `jobSubmissions`.
2. Deploy mutation/query contracts.
3. Run Convex codegen in all clients.
4. Keep compatibility alias (`complete`) enabled.

Exit criteria:
- No schema migration errors.
- Admin app compiles against generated API.

### Phase 2: Admin App Cutover
1. Switch job detail screen to `getJobDetail` + `getJobLivePresence`.
2. Expose reject/reopen controls with role-gated backend enforcement.
3. Validate before/after rendering from current evidence and sealed snapshot fallback.

Exit criteria:
- Admin can monitor active cleaner sessions in real time.
- Admin can approve/reject/reopen without manual DB intervention.

### Phase 3: Cleaners App Contract Migration
1. Start flow:
  - call `start` immediately when cleaner taps Start.
  - include `startedAtDevice` and optional `offlineStartToken`.
2. Active flow:
  - send `pingActiveSession` heartbeat while job is in progress.
3. Submit flow:
  - call `submitForApproval` instead of direct completion.
  - provide QA mode context and skip reasons where applicable.

Exit criteria:
- Mobile no longer depends on direct complete semantics.
- Offline start replay tested and deterministic.

### Phase 4: Compatibility Window Closure
1. Confirm no traffic to legacy `complete` mutation alias.
2. Remove alias after dual-app migration confirmation.
3. Keep audit history tables as permanent records.

Exit criteria:
- Legacy completion path retired without regressions.

## Cross-App Integration Steps

### Convex (Shared Backend)
- Maintain single source of truth for all transitions.
- Reject invalid transitions with explicit Convex errors.
- Keep approvals role-gated in backend.

### Admin App (`opscentral-admin`)
- Consume durable detail and live presence independently.
- Display server-authoritative timing and session recency.
- Surface unresolved cleaner gate failures before submit.

### Cleaners App (`jna-cleaners-app`)
- Treat start as authoritative action.
- Keep local timer running immediately for UX, reconcile with server timestamps on sync.
- Push evidence and submission metadata through canonical submit contract.

## Acceptance Test Matrix
| ID | Scenario | Expected Result |
|---|---|---|
| T1 | Cleaner starts online | Job enters `in_progress`; server start appears in admin timing and live presence. |
| T2 | Cleaner starts offline and syncs later | Session preserves device + server time; server time is canonical in admin view. |
| T3 | Multi-cleaner submit with one pending cleaner | Submit is blocked and returns unresolved cleaner IDs. |
| T4 | Multi-cleaner submit after all resolved | Submit succeeds and transitions to `awaiting_approval`. |
| T5 | Reject from awaiting approval | New revision opens in `rework_required`; prior snapshot remains immutable. |
| T6 | Reopen from completed | New revision opens with preserved historical submission chain. |
| T7 | Standard QA mode missing room pairs | Server blocks submit with validation errors. |
| T8 | Quick QA mode below thresholds | Server blocks submit or returns warnings based on policy config/force flag. |
| T9 | Live presence stale heartbeat | Session marked stale after configured threshold while durable detail remains stable. |

## Production Monitoring Checklist
- Transition failure rate by mutation and status pair.
- Submit gate failure rate (pending cleaner count > 0).
- Evidence validation failure rate (standard vs quick mode).
- Reopen/reject counts by property and cleaner.
- Heartbeat freshness distribution (`secondsSinceHeartbeat`).
- Snapshot creation latency and storage URL resolution failures.

## Operational Runbook Notes
- If stale heartbeat spikes:
  - verify mobile heartbeat interval and background execution policy.
  - inspect session mutation error logs.
- If submit gating blocks unexpectedly:
  - verify assigned cleaner IDs versus current revision sessions.
  - resolve by excusing unavailable cleaner session when operationally justified.
- If evidence validation fails repeatedly:
  - inspect room normalization and skip reason quality.
  - validate mobile capture flow for before/after pairing.
