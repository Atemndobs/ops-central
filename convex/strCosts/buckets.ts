/**
 * Bridge: OpsCentral's costCategories.bucket vocabulary → the cost engine's
 * CostBucket vocabulary (convex/strCosts/costMath.ts).
 *
 * OpsCentral's owner-portal fee engine tags every category with one of 13
 * buckets (lease, cleaning, supplies, utilities, maintenance, lawnPoolOutdoor,
 * platformFees, subscriptions, labor, insurance, taxes, managementFee, other).
 * The ported portfolio engine only knows 7 buckets
 * (lease, utilities, cleaning, payouts, subscriptions, other, unassigned).
 *
 * This maps the overlapping buckets directly and routes the rest to `null` so
 * the engine's keyword `inferBucket(name)` fallback can still classify a line
 * by its item/category name (e.g. a "Netflix" item in a generic "other"
 * category lands in `subscriptions`). Returning `null` is the signal "no
 * authoritative category bucket — try name inference, else `other`".
 *
 * NOTE: only the per-bucket BREAKDOWN (statement pie / bucket columns) depends
 * on this map. Portfolio totals (revenue, totalCosts, netProfit) are
 * bucket-independent — they sum every line's monthlyEquivalent regardless of
 * bucket — so a coarse mapping never changes the bottom line.
 */
import type { CostBucket } from "./costMath";

export function toEngineBucket(
  opsBucket: string | null | undefined,
): CostBucket | null {
  switch (opsBucket) {
    case "lease":
      return "lease";
    case "utilities":
      return "utilities";
    case "cleaning":
      return "cleaning";
    case "subscriptions":
      return "subscriptions";
    // Labor / management fees are money paid out to people → engine "payouts".
    case "labor":
    case "managementFee":
      return "payouts";
    // No engine equivalent → fall through to name inference, else "other".
    case "supplies":
    case "maintenance":
    case "lawnPoolOutdoor":
    case "platformFees":
    case "insurance":
    case "taxes":
    case "other":
    default:
      return null;
  }
}
