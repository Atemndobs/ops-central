/**
 * Default `effectiveFrom` for the FIRST-EVER propertyFeeConfig /
 * propertyOwners row on a property: the UTC month-start of the earliest
 * non-cancelled stay, so live drafts + statements work for the months the
 * property already has history in (fee engine requires a config active at
 * periodStart — see pickFeeConfigForPeriod). Subsequent (append-only,
 * time-versioned) upserts must keep `effectiveFrom = now`; callers only
 * invoke this when no prior row exists.
 *
 * `earliestCheckInMs === null` means "property has no stays yet" → `now`.
 */
export function firstEffectiveFromMs(
  earliestCheckInMs: number | null,
  now: number,
): number {
  if (earliestCheckInMs === null) return now;
  const d = new Date(earliestCheckInMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}
