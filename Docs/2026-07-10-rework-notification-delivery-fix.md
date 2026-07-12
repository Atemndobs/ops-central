# Piece 1 — Make photo-rejection reach the cleaner

**Task:** `task/rework-notify-fix` · **Date:** 2026-07-10 · **Schema impact:** none · **Convex:** deploy-required

This is Piece 1 of a two-part effort. Piece 2 (deadline/countdown, acknowledge, re-pings,
manager escalation, at-risk dashboard, urgent sound/channel) is a separate spec.

## Problem

When a reviewer rejects a job's photos, the assigned cleaner is supposed to get a
`rework_required` notification (in-app + push) so they can turn back and fix it. In practice
the cleaner gets **nothing** — the alert "disappears."

## Root cause (verified against prod data, job `kx736…` / Austin-The Berlin)

The `rework_required` notification **is** created and a push **is** sent (`pushSent: true`,
cleaner has a valid `ExponentPushToken`) — but the notification row is `dismissedAt` **~622 ms
after creation**, by a *separate* transaction. It vanishes from the cleaner's list before it
can be seen.

The mechanism: a transition **into** `rework_required` runs a cleaner-facing notification
dismissal batch that **includes the `rework_required` type**:

- `convex/cleaningJobs/approve.ts:228` (`rejectCompletion`, inline, pre-create): dismisses
  `["job_assigned", "rework_required"]` for the cleaner.
- `convex/cleaningJobs/mutations.ts:1123` (`reopenCompleted`, **deferred** via
  `applyTransitionSideEffects` / `runAfter(0)`): dismisses
  `["job_assigned", "job_completed", "rework_required"]` for the cleaner — this runs *after* the
  new alert exists, so it deletes it.

The deferred batch is meant to clear *stale* alerts, but by listing the type the transition is
actively creating, it destroys the fresh one. General rule being violated: **never dismiss the
notification type you are creating on the same transition.**

Second, related bug: `reopenCompleted` (`mutations.ts:1060`) transitions a completed/
awaiting-approval job to `rework_required` and schedules the dismissal, but **creates no
notification at all** — so reopening a job to rework silently alerts nobody.

## Fix (backend only, no schema change)

1. **Stop dismissing `rework_required` on rework transitions (cleaner batches only):**
   - `approve.ts:228` → cleaner dismissal `["job_assigned"]`.
   - `mutations.ts:1123` → cleaner dismissal `["job_assigned", "job_completed"]`.
   - Ops batches (which dismiss `awaiting_approval`) are unchanged and correct.
2. **Make `reopenCompleted` notify the cleaner** — create the same `rework_required`
   notification `rejectCompletion` produces (title "Rework Required", `messageKey
   notifications.messages.rework_needed`, `data { jobId, propertyId }`, targeting
   `job.assignedCleanerIds`), so every path into rework alerts the cleaner.
3. **Actionable push body** — include the rejection reason (truncated) in the notification
   `message` so the push is actionable, not generic. (Push is already `priority: "high"`; token
   registration is confirmed working — no registration work needed.)

## Non-goals (Piece 2)

Deadline (`reworkDueAt`) + countdown, "On my way" acknowledge, escalating re-pings, manager/ops
escalation, at-risk dashboard flag, urgent custom sound/channel, and posting the rejection
reason as a chat message.

## Verification (mandatory)

1. **Reproduce** on a disposable/test job: reject → observe the cleaner's `rework_required`
   notification receives `dismissedAt` (the bug) within ~1s.
2. **Apply fix** → repeat → confirm the notification now has `dismissedAt === undefined` and
   survives, and a push is dispatched.
3. **Convex test** asserting that after the reject transition + the deferred side-effect runs,
   the cleaner's `rework_required` notification is not dismissed. Also assert `reopenCompleted`
   creates a `rework_required` notification for each assigned cleaner.
4. Deploy to prod (`lovable-oriole-182`) and confirm on a controlled real reject; mirror backend
   to cleaners.

## Files touched

- `convex/cleaningJobs/approve.ts` (dismissal list)
- `convex/cleaningJobs/mutations.ts` (`reopenCompleted`: dismissal list + add notification)
- a Convex test (notification survival + reopen-notifies)

## Rollback

`git revert` + redeploy. No data migration; the change only affects which notification types are
dismissed on future transitions.
