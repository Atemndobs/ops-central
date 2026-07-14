"use client";

import { useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Loader2 } from "lucide-react";
import { ReviewCard } from "./review-card";
import { FilterDropdown } from "./filter-dropdown";

type StatusFilter = "all" | "needs_action" | "sent" | "dismissed";

const NEEDS_ACTION = new Set(["needs_draft", "drafted", "send_failed"]);

function statusMatch(status: string, filter: StatusFilter) {
  if (filter === "all") return true;
  if (filter === "needs_action") return NEEDS_ACTION.has(status);
  if (filter === "sent") return status === "sent";
  return status === "dismissed";
}

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "All statuses",
  needs_action: "Needs action",
  sent: "Sent",
  dismissed: "Dismissed",
};

export function ReviewsInbox() {
  const { isAuthenticated } = useConvexAuth();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("needs_action");
  const [ratingFilter, setRatingFilter] = useState<number>(0); // 0 = all
  const [propertyFilter, setPropertyFilter] = useState<string>(""); // "" = all

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

  // Additive filtering helpers — each dimension filters using the OTHER two active filters
  const afterRatingAndProperty = reviews.filter(
    (r) =>
      (ratingFilter === 0 || r.rating === ratingFilter) &&
      (propertyFilter === "" || r.propertyId === propertyFilter),
  );
  const afterStatusAndProperty = reviews.filter(
    (r) =>
      statusMatch(r.status, statusFilter) &&
      (propertyFilter === "" || r.propertyId === propertyFilter),
  );
  const afterStatusAndRating = reviews.filter(
    (r) =>
      statusMatch(r.status, statusFilter) &&
      (ratingFilter === 0 || r.rating === ratingFilter),
  );

  // Status options: count based on rating + property filter
  const statusCounts = afterRatingAndProperty.reduce<Record<string, number>>(
    (acc, r) => {
      const key = NEEDS_ACTION.has(r.status) ? "needs_action" : r.status;
      acc[key] = (acc[key] ?? 0) + 1;
      acc["all"] = (acc["all"] ?? 0) + 1;
      return acc;
    },
    {},
  );

  // Rating options: count based on status + property filter
  const ratingCounts = afterStatusAndProperty.reduce<Record<number, number>>(
    (acc, r) => {
      acc[r.rating] = (acc[r.rating] ?? 0) + 1;
      acc[0] = (acc[0] ?? 0) + 1;
      return acc;
    },
    {},
  );

  // Property options: count based on status + rating filter
  const propertyMap = new Map<string, { name: string; count: number }>();
  let totalForProperty = 0;
  for (const r of afterStatusAndRating) {
    const id = r.propertyId as string;
    const existing = propertyMap.get(id);
    propertyMap.set(id, {
      name: r.propertyName ?? id,
      count: (existing?.count ?? 0) + 1,
    });
    totalForProperty++;
  }

  // Final filtered list
  const filtered = reviews.filter(
    (r) =>
      statusMatch(r.status, statusFilter) &&
      (ratingFilter === 0 || r.rating === ratingFilter) &&
      (propertyFilter === "" || r.propertyId === propertyFilter),
  );

  const activeFilters = [
    statusFilter !== "all" ? 1 : 0,
    ratingFilter !== 0 ? 1 : 0,
    propertyFilter !== "" ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      {/* Filter row — styled dropdowns */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Status */}
        <FilterDropdown
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as StatusFilter)}
          options={(["needs_action", "all", "sent", "dismissed"] as StatusFilter[]).map((f) => ({
            value: f,
            label: STATUS_LABELS[f],
            count: statusCounts[f],
          }))}
        />

        {/* Rating */}
        <FilterDropdown
          value={String(ratingFilter)}
          onChange={(v) => setRatingFilter(Number(v))}
          options={[
            { value: "0", label: "All ratings", count: ratingCounts[0] },
            ...[5, 4, 3, 2, 1]
              .filter((s) => ratingCounts[s] !== undefined)
              .map((s) => ({
                value: String(s),
                label: `${"★".repeat(s)}${"☆".repeat(5 - s)} ${s} star${s !== 1 ? "s" : ""}`,
                count: ratingCounts[s],
              })),
          ]}
        />

        {/* Property */}
        <FilterDropdown
          value={propertyFilter}
          onChange={setPropertyFilter}
          options={[
            { value: "", label: "All properties", count: totalForProperty },
            ...[...propertyMap.entries()]
              .sort((a, b) => a[1].name.localeCompare(b[1].name))
              .map(([id, { name, count }]) => ({ value: id, label: name, count })),
          ]}
        />

        {/* Clear all */}
        {activeFilters > 0 && (
          <button
            onClick={() => { setStatusFilter("needs_action"); setRatingFilter(0); setPropertyFilter(""); }}
            className="text-xs text-[var(--muted-foreground)] underline underline-offset-2 hover:text-[var(--foreground)]"
          >
            Clear filters
          </button>
        )}

        <span className="ml-auto text-xs text-[var(--muted-foreground)]">
          {filtered.length} review{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border bg-[var(--card)] p-8 text-center text-sm text-[var(--muted-foreground)]">
          No reviews match this filter.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((review) => (
            <ReviewCard key={review._id} review={review} showProperty={propertyFilter === ""} />
          ))}
        </div>
      )}
    </div>
  );
}
