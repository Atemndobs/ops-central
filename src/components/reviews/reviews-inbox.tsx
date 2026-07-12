"use client";

import { useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Loader2 } from "lucide-react";
import { ReviewCard } from "./review-card";

type StatusFilter = "all" | "needs_action" | "sent" | "dismissed";

const NEEDS_ACTION = new Set(["needs_draft", "drafted", "send_failed"]);

export function ReviewsInbox() {
  const { isAuthenticated } = useConvexAuth();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("needs_action");

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
    if (statusFilter === "all") return true;
    if (statusFilter === "needs_action") return NEEDS_ACTION.has(r.status);
    if (statusFilter === "sent") return r.status === "sent";
    return r.status === "dismissed";
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["needs_action", "all", "sent", "dismissed"] as StatusFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`rounded-full border px-3 py-1 text-xs ${
              statusFilter === f ? "bg-[var(--foreground)] text-[var(--background)]" : ""
            }`}
          >
            {f === "needs_action" ? "Needs action" : f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border bg-[var(--card)] p-8 text-center text-sm text-[var(--muted-foreground)]">
          No reviews in this view.
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
