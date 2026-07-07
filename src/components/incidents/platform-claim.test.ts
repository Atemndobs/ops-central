import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPlatformClaimSummary,
  CLAIM_FOLLOW_UP_LABELS,
} from "./platform-claim.ts";

test("buildPlatformClaimSummary formats the Scanny Airbnb suspension workflow", () => {
  const summary = buildPlatformClaimSummary({
    affectedPlatform: "Airbnb",
    suspensionStartedAt: Date.UTC(2026, 5, 1),
    suspensionEndedAt: Date.UTC(2026, 5, 8),
    canceledBookingCount: 3,
    claimFollowUpState: "awaiting_platform",
  });

  assert.equal(summary.platform, "Airbnb");
  assert.equal(summary.suspensionWindow, "Jun 1, 2026 - Jun 8, 2026");
  assert.equal(summary.canceledBookings, "3 canceled bookings");
  assert.equal(summary.followUpState, CLAIM_FOLLOW_UP_LABELS.awaiting_platform);
});

test("buildPlatformClaimSummary keeps open-ended suspension windows explicit", () => {
  const summary = buildPlatformClaimSummary({
    affectedPlatform: "Vrbo",
    suspensionStartedAt: Date.UTC(2026, 5, 1),
    canceledBookingCount: 1,
    claimFollowUpState: "collecting_evidence",
  });

  assert.equal(summary.suspensionWindow, "Since Jun 1, 2026");
  assert.equal(summary.canceledBookings, "1 canceled booking");
});
