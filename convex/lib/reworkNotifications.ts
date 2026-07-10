/**
 * Notification types that get dismissed for the ASSIGNED CLEANER when a job
 * transitions into `rework_required` (via `rejectCompletion` or
 * `reopenForRework`).
 *
 * INVARIANT: this list MUST NOT contain `"rework_required"`. That is the alert
 * the very same transition creates for the cleaner, and the deferred dismissal
 * side-effect (`applyTransitionSideEffects`, `runAfter(0)`) runs ~600ms AFTER
 * the alert is created — so including it here silently deletes the cleaner's
 * fresh rework alert. That was the root cause of "the rejection never reaches
 * the cleaner". See Docs/2026-07-10-rework-notification-delivery-fix.md.
 *
 * Kept import-free so it can be unit-tested under `node --test` type-stripping.
 */
export type CleanerReworkDismissalType = "job_assigned" | "job_completed";

export const CLEANER_REWORK_DISMISSAL_TYPES: CleanerReworkDismissalType[] = [
  "job_assigned",
  "job_completed",
];
