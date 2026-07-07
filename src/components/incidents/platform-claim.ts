export const CLAIM_FOLLOW_UP_STATES = [
  "not_started",
  "collecting_evidence",
  "submitted",
  "awaiting_platform",
  "approved",
  "denied",
  "closed",
] as const;

export type ClaimFollowUpState = (typeof CLAIM_FOLLOW_UP_STATES)[number];

export type PlatformClaim = {
  affectedPlatform?: string;
  suspensionStartedAt?: number;
  suspensionEndedAt?: number;
  canceledBookingCount?: number;
  claimFollowUpState?: ClaimFollowUpState;
  claimFollowUpDueAt?: number;
  claimNotes?: string;
};

export const CLAIM_FOLLOW_UP_LABELS: Record<ClaimFollowUpState, string> = {
  not_started: "Not started",
  collecting_evidence: "Collecting evidence",
  submitted: "Submitted",
  awaiting_platform: "Awaiting platform",
  approved: "Approved",
  denied: "Denied",
  closed: "Closed",
};

export function formatUtcDate(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(ms));
}

export function formatSuspensionWindow(claim: PlatformClaim): string {
  if (claim.suspensionStartedAt && claim.suspensionEndedAt) {
    return `${formatUtcDate(claim.suspensionStartedAt)} - ${formatUtcDate(claim.suspensionEndedAt)}`;
  }
  if (claim.suspensionStartedAt) {
    return `Since ${formatUtcDate(claim.suspensionStartedAt)}`;
  }
  if (claim.suspensionEndedAt) {
    return `Until ${formatUtcDate(claim.suspensionEndedAt)}`;
  }
  return "No suspension window";
}

export function formatCanceledBookings(count: number | undefined): string {
  const value = Math.max(0, Math.trunc(count ?? 0));
  return `${value} canceled ${value === 1 ? "booking" : "bookings"}`;
}

export function buildPlatformClaimSummary(claim: PlatformClaim) {
  const state = claim.claimFollowUpState ?? "not_started";
  return {
    platform: claim.affectedPlatform?.trim() || "Platform not set",
    suspensionWindow: formatSuspensionWindow(claim),
    canceledBookings: formatCanceledBookings(claim.canceledBookingCount),
    followUpState: CLAIM_FOLLOW_UP_LABELS[state],
    followUpDueAt: claim.claimFollowUpDueAt
      ? formatUtcDate(claim.claimFollowUpDueAt)
      : null,
  };
}

export function dateInputValue(ms: number | undefined): string {
  if (!ms) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

export function dateInputToUtcMs(value: string): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(ms) ? ms : undefined;
}
