# Piece 2 — Rework urgency: deadline · countdown · acknowledge · escalation

**Date:** 2026-07-11 · Builds on Piece 1 ([2026-07-10-rework-notification-delivery-fix.md](2026-07-10-rework-notification-delivery-fix.md)).

When a job's photos are rejected the cleaner must treat it as drop-everything: a visible
countdown to a fix deadline, escalating re-pings until they acknowledge, and manager escalation +
dashboard visibility if it goes overdue.

Shipped as **three independent increments** (one PR each) over **one shared schema**.

## Shared schema (additive, optional — lands in 2a)

- `cleaningJobs`: `reworkDueAt?: number`, `reworkAckAt?: number`, `reworkAckBy?: Id<"users">`
- `appSettings.reworkDeadlineMinutes?: number` (org default; absent ⇒ 30)
- `properties.reworkDeadlineMinutes?: number` (per-property override)

Deadline resolution (pure helper `resolveReworkDeadlineMinutes`):
`property.reworkDeadlineMinutes ?? appSettings.reworkDeadlineMinutes ?? 30`.
`reworkDueAt = rejectedAt + minutes*60_000`, set on BOTH rework paths
(`rejectCompletion`, `reopenForRework`); carried in the notification `data`.

## Decisions (locked)

1. **Acknowledge ≠ done.** "On my way" stops cleaner re-pings but the deadline stands; overdue
   without a resubmit still triggers manager escalation + at-risk.
2. **Deadline anchors at the rejection moment**, fixed configurable window (default 30 min).
3. **Cadence from the deadline:** re-pings at `dueAt−15m`, `dueAt−5m`, `dueAt` (overdue). If the
   window is < 15 min the earlier pings collapse (skip any offset ≤ now).
4. **Resubmit cancels everything implicitly** — scheduled handlers bail once the job leaves
   `rework_required` (state-guarded + idempotent, mirroring `acknowledgements.escalateOne`).
5. Escalation recipients = the property's active cleaning-company managers
   (`getActivePropertyCompanyAssignment` → `companyMembers` role=manager) + ops
   (`listOpsUserIds`).

## 2a — Deadline + visible countdown

- Schema above (schema-first within the 2a PR; all additive optional).
- `resolveReworkDeadlineMinutes` pure helper (`convex/lib/reworkDeadline.ts`) + set `reworkDueAt`
  in `rejectCompletion` and `reopenForRework`.
- `appSettings.getReworkDeadlineMinutes` / `setReworkDeadlineMinutes` (mirror storage-provider).
- Settings card "Rework deadline (minutes)" (number input; mirror `storage-provider-card.tsx`).
- Per-property override input on the property page.
- Feed `reworkDueAt` into `CountdownBadge`/`CleanerCountdownBadge` on cleaner job detail + card +
  home, web AND mobile — only when `status === "rework_required"`, labelled "Fix by", urgent tier;
  render "OVERDUE" past the deadline. (`getMyJobDetail` already spreads the job doc, so the new
  fields surface without a query change.)
- Tests: `resolveReworkDeadlineMinutes` (override ?? org ?? 30) pure test.

## 2b — Acknowledge + escalating re-pings

- `cleaningJobs.acknowledgeRework` mutation (cleaner-guarded, in `assignedCleanerIds`) → stamp
  `reworkAckAt/By`; modeled on `acknowledgements.acknowledge`.
- Cleaner "On my way" button on the rework job detail (web + mobile); acknowledged state after.
- On reject/reopen, schedule re-pings via `scheduler.runAt` at the cadence offsets. Each target is
  a state-guarded internalMutation: bail unless `status==="rework_required" && reworkAckAt==null`;
  send an escalating `rework_required` push ("~15 min left" / "~5 min left" / "OVERDUE").
- 15-min cron backstop sweeping overdue-unacked jobs (mirror `escalate-pending-acknowledgements`).
- Tests: cadence-offset computation (which offsets fire for a given window) pure test.

## 2c — Manager escalation + at-risk dashboard

- Overdue (past `reworkDueAt`, still `rework_required`) → `job_at_risk` notification to company
  managers + ops (once; idempotent via a stamp or dedupe).
- Admin dashboard: add an "At-risk rework" alert (overdue `rework_required`, `reworkAckAt==null`)
  to the existing alerts array in `dashboard-client.tsx` (higher severity than plain `rework`);
  extend the dashboard query to expose `reworkDueAt`/`reworkAckAt` if not already spread.

## Non-goals

Reassign-to-another-cleaner automation, GPS/location, per-cleaner SLA analytics, and iOS
critical-alert entitlement (a distinct urgent channel/sound is a later polish).

## Rollback

All schema fields are additive optional; each increment is `git revert` + redeploy. Scheduled
re-pings self-cancel via state guards, so a revert leaves no stuck escalations.
