# Cleaning Execution Architecture Review (R/Y/G)

## Decision
Approve with significant architectural amendments before broad rollout.

## Scope
- System: shared Convex backend for `opscentral-admin` and `jna-cleaners-app`.
- Objective: real-time cleaner execution tracking, immutable evidence snapshots, and approval-safe completion workflow.
- Date: 2026-03-27.

## R/Y/G Risk Table
| Area | Rating | Why | Required Mitigation | Exit Criteria |
|---|---|---|---|---|
| State machine completeness | Yellow | Core flow is now encoded, but edge transitions must be validated against both clients. | Lock transition matrix and reject invalid transitions in Convex mutations. | All transition tests pass for scheduled/assigned/in_progress/awaiting_approval/rework_required/completed. |
| Single vs multi-cleaner semantics | Green | Parallel sessions + submit gate implemented in canonical mutations. | Keep gate source-of-truth in backend and expose pending cleaner IDs in query payloads. | Multi-cleaner acceptance tests pass (cannot submit until all submitted/excused). |
| Offline start authority | Yellow | Device-provisional + server-authoritative model implemented, but mobile UX policy enforcement is pending. | Enforce server timestamps in backend, keep device timestamps as audit only. | Offline start conflict tests pass and admin sees deterministic authoritative start times. |
| Evidence immutability | Green | `jobSubmissions` snapshot and `sealedHash` introduced; snapshot records are immutable by contract. | Prohibit update paths on snapshot payloads after insert. | Reopen/reject creates new revision, prior snapshots remain unchanged. |
| Durable vs live data delivery | Green | Query split implemented (`getJobDetail` vs `getJobLivePresence`). | Keep heartbeat and session recency out of durable detail path. | Admin screen consumes both queries with independent refresh behavior. |
| Completion semantics clarity | Green | `submitForApproval` canonicalized, `complete` retained as compatibility alias. | Decommission alias after both apps migrate. | No caller depends on legacy `complete` behavior before alias removal. |
| Shared deployment blast radius | Yellow | Schema and contract changes affect admin + cleaners app simultaneously. | Phased rollout and compatibility window across both apps. | Dual-app smoke tests pass in shared deployment before production cutover. |

## Decision Log (Six Non-Negotiables)
1. Cleaner is start authority: accepted. Cleaner `start` now creates/updates execution session and can move a job to `in_progress`.
2. Completion is submit-for-approval: accepted. Cleaner submission transitions to `awaiting_approval`; manager/admin approval finalizes to `completed`.
3. Multi-cleaner model is parallel sessions: accepted. `jobExecutionSessions` is revision-scoped and completion gated on submitted/excused sessions.
4. Offline start policy is explicit: accepted. `startedAtDevice` is recorded as provisional audit, `startedAtServer` is canonical.
5. Reopen/rejection uses revisioning: accepted. Rework transition increments revision and preserves historical submission snapshots.
6. Hybrid photo enforcement: accepted. Server-side validation supports standard per-room pairing and quick minimum thresholds.

## Go/No-Go Criteria By Phase

### Phase 0: Contract + Schema Readiness
- Go when:
  - `jobExecutionSessions` and `jobSubmissions` deployed.
  - New mutation/query contracts generated and type-safe in admin app.
- No-Go if:
  - Any mutation can transition to forbidden state.
  - Snapshot rows are mutable through public API.

### Phase 1: Admin Integration
- Go when:
  - Job detail consumes durable + live queries separately.
  - Before/after gallery and execution timing render from canonical backend data.
- No-Go if:
  - Live heartbeat regressions affect durable job loading.
  - Admin cannot reject or reopen with revision bump.

### Phase 2: Cleaner App Migration
- Go when:
  - Mobile uses `start`, `submitForApproval`, and heartbeat mutation.
  - Offline start writes device timestamp + token and reconciles with server timestamp.
- No-Go if:
  - Mobile still assumes direct `completed` transition without approval step.

### Phase 3: Compatibility Window Closure
- Go when:
  - Both clients use new contracts and no traffic depends on `complete` alias.
  - Monitoring shows no increase in gating/transition failures.
- No-Go if:
  - Legacy clients remain on pre-migration completion semantics.

## Final Recommendation
Proceed with implementation under staged rollout controls. Treat the current architecture as deployable only with the contract and operational checks above enforced before broad enablement.
