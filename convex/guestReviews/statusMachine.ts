//
// Pure state machine for guestReviews.status. Zero Convex imports.
//
//   needs_draft --(AI draft)--> drafted --(approve)--> sending --(API ok)--> sent
//        |                         |                       |
//        +---(dismiss)--> dismissed                        +--(API error)--> send_failed --(retry)--> sending
//                              ^                                                  |
//                              +----------------------------(dismiss)-------------+

export type GuestReviewStatus =
  | "needs_draft"
  | "drafted"
  | "sending"
  | "sent"
  | "dismissed"
  | "send_failed";

const ALLOWED_TRANSITIONS: Record<GuestReviewStatus, GuestReviewStatus[]> = {
  needs_draft: ["drafted", "dismissed"],
  drafted: ["sending", "dismissed"],
  sending: ["sent", "send_failed"],
  send_failed: ["sending", "dismissed"],
  sent: [],
  dismissed: [],
};

export class InvalidReviewTransitionError extends Error {
  readonly from: GuestReviewStatus;
  readonly to: GuestReviewStatus;

  constructor(from: GuestReviewStatus, to: GuestReviewStatus) {
    super(`Cannot transition guestReviews.status from "${from}" to "${to}".`);
    this.name = "InvalidReviewTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function canTransition(
  from: GuestReviewStatus,
  to: GuestReviewStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(
  from: GuestReviewStatus,
  to: GuestReviewStatus,
): void {
  if (!canTransition(from, to)) {
    throw new InvalidReviewTransitionError(from, to);
  }
}
