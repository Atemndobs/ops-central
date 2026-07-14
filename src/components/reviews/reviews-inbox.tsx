"use client";

import { useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Loader2, Star } from "lucide-react";
import { ReviewCard } from "./review-card";

type StatusFilter = "all" | "needs_action" | "sent" | "dismissed";
type RatingFilter = 0 | 1 | 2 | 3 | 4 | 5; // 0 = all ratings

const NEEDS_ACTION = new Set(["needs_draft", "drafted", "send_failed"]);

const RATING_COLORS: Record<number, string> = {
  5: "text-emerald-600 border-emerald-300 bg-emerald-50",
  4: "text-blue-600 border-blue-300 bg-blue-50",
  3: "text-amber-600 border-amber-300 bg-amber-50",
  2: "text-orange-600 border-orange-300 bg-orange-50",
  1: "text-rose-600 border-rose-300 bg-rose-50",
};

export function ReviewsInbox() {
  const { isAuthenticated } = useConvexAuth();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("needs_action");
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>(0);

  const enabled = useQuery(
    api.admin.featureFlags.isFeatureEnabled,
    isAuthenticated ? { key: "reviewsAiReply" } : "skip",
  );
  const reviews = useQuery(
    api.guestReviews.queries.listInbox,
    isAuthenticated ? {} : "skip",
  );

  if (enabled === undefined || reviews === undefined) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="rounded-2xl border bg-[var(--card)] p-8 text-center text-sm text-[var(--muted-foreground)]">
        Reviews is not enabled yet. An admin can turn it on from Settings → Integrations → Feature Flags.
      </div>
    );
  }

  const filtered = reviews.filter((r) => {
    const statusOk =
      statusFilter === "all" ||
      (statusFilter === "needs_action" && NEEDS_ACTION.has(r.status)) ||
      (statusFilter === "sent" && r.status === "sent") ||
      (statusFilter === "dismissed" && r.status === "dismissed");
    const ratingOk = ratingFilter === 0 || r.rating === ratingFilter;
    return statusOk && ratingOk;
  });

  // Count per star for filter badges
  const countByStar = reviews.reduce<Record<number, number>>((acc, r) => {
    acc[r.rating] = (acc[r.rating] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Status filter row */}
      <div className="flex flex-wrap gap-2">
        {(["needs_action", "all", "sent", "dismissed"] as StatusFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              statusFilter === f
                ? "bg-[var(--foreground)] text-[var(--background)] border-transparent"
                : "hover:bg-[var(--muted)]"
            }`}
          >
            {f === "needs_action" ? "Needs action" : f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Rating filter row */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-[var(--muted-foreground)]">Filter by rating:</span>
        <button
          onClick={() => setRatingFilter(0)}
          className={`rounded-full border px-3 py-1 text-xs transition-colors ${
            ratingFilter === 0
              ? "bg-[var(--foreground)] text-[var(--background)] border-transparent"
              : "hover:bg-[var(--muted)]"
          }`}
        >
          All ratings
        </button>
        {([5, 4, 3, 2, 1] as const).map((star) => (
          <button
            key={star}
            onClick={() => setRatingFilter(ratingFilter === star ? 0 : star)}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
              ratingFilter === star
                ? RATING_COLORS[star] + " font-semibold"
                : "hover:bg-[var(--muted)]"
            }`}
          >
            <Star className="h-3 w-3 fill-current" />
            {star}
            {countByStar[star] ? (
              <span className="ml-0.5 opacity-60">({countByStar[star]})</span>
            ) : null}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border bg-[var(--card)] p-8 text-center text-sm text-[var(--muted-foreground)]">
          No reviews match this filter.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((review) => (
            <ReviewCard key={review._id} review={review} showProperty />
          ))}
        </div>
      )}
    </div>
  );
}
