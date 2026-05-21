// Canonical list of cost-statement buckets. Source of truth for any code
// that writes `costCategories.bucket`. The schema in convex/schema.ts uses
// v.optional(v.union(...)) of these exact literals during Wave 1 (so
// existing prod rows without a bucket value remain valid). A follow-up PR
// post-Wave 2 backfill narrows that union to required.
//
// Until the narrowing PR lands, every writing path MUST validate against
// isBucket(value) at the mutation boundary. Defense-in-depth against
// ad-hoc Convex-shell writes or future contributors bypassing the
// typed union.
export const BUCKETS = [
  "lease",
  "cleaning",
  "supplies",
  "utilities",
  "maintenance",
  "lawnPoolOutdoor",
  "platformFees",
  "subscriptions",
  "labor",
  "insurance",
  "taxes",
  "managementFee",
  "other",
] as const;

export type Bucket = (typeof BUCKETS)[number];

export function isBucket(value: unknown): value is Bucket {
  return typeof value === "string" && (BUCKETS as readonly string[]).includes(value);
}
