// Pure normalizer for Hospitable's Review resource — same shape whether it
// arrives via the `review.created` webhook payload or the
// GET /v2/properties/{uuid}/reviews list endpoint (both return the
// documented `Review` object: id, platform, public{rating,review},
// private{feedback}, reviewed_at, can_respond, guest{first_name,last_name},
// property{id,...}). Zero Convex imports so this is directly unit-testable.

export interface NormalizedGuestReview {
  hospitableReviewId: string;
  hospitablePropertyId: string;
  platform: "airbnb" | "direct";
  rating: number;
  publicReview: string;
  privateFeedback?: string;
  guestFirstName: string;
  guestLastName: string;
  reviewedAt: number;
  canRespond: boolean;
}

type GenericRecord = Record<string, unknown>;

function isRecord(value: unknown): value is GenericRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const VALID_PLATFORMS = new Set(["airbnb", "direct"]);

export function normalizeGuestReview(
  raw: unknown,
): { review: NormalizedGuestReview | null; error?: string } {
  if (!isRecord(raw)) {
    return { review: null, error: "Review payload is not an object." };
  }

  const hospitableReviewId = asString(raw.id);
  const platform = asString(raw.platform);
  const publicBlock = isRecord(raw.public) ? raw.public : undefined;
  const rating = asNumber(publicBlock?.rating);
  const publicReview = asString(publicBlock?.review);
  const reviewedAtRaw = asString(raw.reviewed_at);
  const property = isRecord(raw.property) ? raw.property : undefined;
  const hospitablePropertyId = asString(property?.id);

  if (
    !hospitableReviewId ||
    !platform ||
    rating === undefined ||
    !publicReview ||
    !reviewedAtRaw ||
    !hospitablePropertyId
  ) {
    return {
      review: null,
      error:
        "Review payload missing one of: id, platform, public.rating, " +
        "public.review, reviewed_at, property.id.",
    };
  }

  if (!VALID_PLATFORMS.has(platform)) {
    return {
      review: null,
      error: `Unrecognized review platform "${platform}" — expected airbnb or direct.`,
    };
  }

  const reviewedAt = Date.parse(reviewedAtRaw);
  if (Number.isNaN(reviewedAt)) {
    return { review: null, error: `Unparseable reviewed_at: "${reviewedAtRaw}".` };
  }

  const privateBlock = isRecord(raw.private) ? raw.private : undefined;
  const guest = isRecord(raw.guest) ? raw.guest : undefined;

  return {
    review: {
      hospitableReviewId,
      hospitablePropertyId,
      platform: platform as "airbnb" | "direct",
      rating,
      publicReview,
      privateFeedback: asString(privateBlock?.feedback),
      guestFirstName: asString(guest?.first_name) ?? "",
      guestLastName: asString(guest?.last_name) ?? "",
      reviewedAt,
      canRespond: raw.can_respond === true,
    },
  };
}
