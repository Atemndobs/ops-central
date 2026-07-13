/**
 * Rework fix-deadline resolution. Precedence: per-property override → org
 * default (appSettings.reworkDeadlineMinutes) → 30 minutes. Non-positive /
 * non-finite config is ignored and falls back to the next level.
 *
 * Pure + import-free so it can be unit-tested under `node --test` type-stripping.
 * See Docs/2026-07-11-rework-urgency-spec.md.
 */
export const DEFAULT_REWORK_DEADLINE_MINUTES = 30;

function sanitize(minutes: number | null | undefined): number | undefined {
  return typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0
    ? minutes
    : undefined;
}

export function resolveReworkDeadlineMinutes(
  propertyMinutes: number | null | undefined,
  orgMinutes: number | null | undefined,
): number {
  return (
    sanitize(propertyMinutes) ??
    sanitize(orgMinutes) ??
    DEFAULT_REWORK_DEADLINE_MINUTES
  );
}

/** Absolute due timestamp (ms) for a rework, given the rejection time. */
export function computeReworkDueAt(
  rejectedAtMs: number,
  propertyMinutes: number | null | undefined,
  orgMinutes: number | null | undefined,
): number {
  return (
    rejectedAtMs +
    resolveReworkDeadlineMinutes(propertyMinutes, orgMinutes) * 60_000
  );
}
