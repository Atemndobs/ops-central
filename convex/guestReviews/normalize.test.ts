import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeGuestReview } from "./normalize.ts";

const VALID_RAW = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  platform: "airbnb",
  public: { rating: 5, review: "Great place we will be back!" },
  private: { feedback: "downstairs was a bit cold." },
  reviewed_at: "2024-03-19T10:00:00Z",
  can_respond: true,
  guest: { first_name: "Jane", last_name: "Doe" },
  reservation: { id: "reservation-123" },
  property: { id: "497f6eca-6276-4993-bfeb-53cbbbba6f08", name: "The Paris" },
};

test("normalizeGuestReview: maps a valid Airbnb review", () => {
  const { review, error } = normalizeGuestReview(VALID_RAW);
  assert.equal(error, undefined);
  assert.ok(review);
  assert.equal(review.hospitableReviewId, VALID_RAW.id);
  assert.equal(review.hospitableReservationId, "reservation-123");
  assert.equal(review.hospitablePropertyId, VALID_RAW.property.id);
  assert.equal(review.platform, "airbnb");
  assert.equal(review.rating, 5);
  assert.equal(review.publicReview, "Great place we will be back!");
  assert.equal(review.privateFeedback, "downstairs was a bit cold.");
  assert.equal(review.guestFirstName, "Jane");
  assert.equal(review.guestLastName, "Doe");
  assert.equal(review.reviewedAt, Date.parse("2024-03-19T10:00:00Z"));
  assert.equal(review.canRespond, true);
});

test("normalizeGuestReview: accepts top-level reservation identifiers", () => {
  const { review } = normalizeGuestReview({
    ...VALID_RAW,
    reservation: undefined,
    reservation_uuid: "reservation-456",
  });
  assert.equal(review?.hospitableReservationId, "reservation-456");
});

test("normalizeGuestReview: defaults missing guest name and private feedback", () => {
  const raw = {
    ...VALID_RAW,
    private: {},
    guest: {},
  };
  const { review, error } = normalizeGuestReview(raw);
  assert.equal(error, undefined);
  assert.ok(review);
  assert.equal(review.guestFirstName, "");
  assert.equal(review.guestLastName, "");
  assert.equal(review.privateFeedback, undefined);
});

test("normalizeGuestReview: rejects a non-object payload", () => {
  const { review, error } = normalizeGuestReview("not an object");
  assert.equal(review, null);
  assert.match(error ?? "", /not an object/i);
});

test("normalizeGuestReview: rejects missing required fields", () => {
  const { review, error } = normalizeGuestReview({ id: "abc" });
  assert.equal(review, null);
  assert.match(error ?? "", /missing/i);
});

test("normalizeGuestReview: rejects an unrecognized platform", () => {
  const raw = { ...VALID_RAW, platform: "booking_com" };
  const { review, error } = normalizeGuestReview(raw);
  assert.equal(review, null);
  assert.match(error ?? "", /platform/i);
});
