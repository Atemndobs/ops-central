"use client";

import { useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@convex/_generated/api";
import { Loader2, Star, AlertTriangle, CheckCircle, ChevronDown, ChevronUp } from "lucide-react";

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "green" | "amber" | "red" | "default";
}) {
  const colors: Record<string, string> = {
    green: "text-emerald-400",
    amber: "text-amber-400",
    red: "text-rose-400",
    default: "text-[var(--foreground)]",
  };
  return (
    <div className="rounded-xl border bg-[var(--card)] p-4 space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">{label}</p>
      <p className={`text-3xl font-bold tabular-nums ${colors[accent ?? "default"]}`}>{value}</p>
      {sub && <p className="text-xs text-[var(--muted-foreground)]">{sub}</p>}
    </div>
  );
}

function StatusChip({ badCount, respondedCount }: { badCount: number; respondedCount: number }) {
  if (badCount === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-xs text-white font-medium">
        <CheckCircle className="h-3 w-3" /> Healthy
      </span>
    );
  }
  if (respondedCount < badCount) {
    const urgent = respondedCount === 0;
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white ${
        urgent ? "bg-rose-600" : "bg-amber-500"
      }`}>
        <AlertTriangle className="h-3 w-3" />
        {urgent ? "Action needed" : "Respond"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-2 py-0.5 text-xs text-white font-medium">
      <CheckCircle className="h-3 w-3" /> Responded
    </span>
  );
}

function Stars({ rating }: { rating: number }) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.25 && rating - full < 0.75;
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="tabular-nums font-semibold text-amber-400 mr-1">{rating.toFixed(1)}</span>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${
            i < full
              ? "fill-amber-400 text-amber-400"
              : half && i === full
              ? "fill-amber-200 text-amber-400"
              : "text-slate-600"
          }`}
        />
      ))}
    </span>
  );
}

export function ReviewsDashboard() {
  const { isAuthenticated } = useConvexAuth();
  const [tableOpen, setTableOpen] = useState(true);
  const router = useRouter();
  const summary = useQuery(
    api.guestReviews.queries.getInboxSummary,
    isAuthenticated ? {} : "skip",
  );

  if (summary === undefined) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  if (summary.totalReviews === 0) return null;

  return (
    <div className="space-y-5">
      {/* Top metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Avg Rating"
          value={summary.avgRating.toFixed(2)}
          sub={`out of 5.00 · ${summary.totalReviews} reviews`}
          accent="green"
        />
        <StatCard
          label="5★ Reviews"
          value={`${summary.fiveStarPct}%`}
          sub={`${Math.round((summary.fiveStarPct / 100) * summary.totalReviews)} of ${summary.totalReviews} reviews`}
          accent="amber"
        />
        <StatCard
          label="Bad Reviews Unanswered"
          value={summary.badReviewsUnanswered}
          sub={`0 of ${summary.badReviewsUnanswered} responded to (0%)`}
          accent={summary.badReviewsUnanswered > 0 ? "red" : "green"}
        />
        <StatCard
          label="Can Still Respond"
          value={summary.canStillRespond}
          sub="window still open"
          accent="amber"
        />
      </div>

      {/* Property health table */}
      <div className="rounded-xl border bg-[var(--card)] overflow-hidden">
        <button
          type="button"
          onClick={() => setTableOpen((o) => !o)}
          className="w-full flex items-center justify-between px-4 py-3 border-b hover:bg-[var(--muted)]/40 transition-colors"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Property Health</p>
          {tableOpen ? <ChevronUp className="h-4 w-4 text-[var(--muted-foreground)]" /> : <ChevronDown className="h-4 w-4 text-[var(--muted-foreground)]" />}
        </button>
        {tableOpen && <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-[var(--muted-foreground)] uppercase tracking-wider">
                <th className="text-left px-4 py-2 font-medium">Property</th>
                <th className="text-right px-4 py-2 font-medium">Reviews</th>
                <th className="text-left px-4 py-2 font-medium">Avg Rating</th>
                <th className="text-center px-4 py-2 font-medium">Low (≤3★)</th>
                <th className="text-center px-4 py-2 font-medium">Responded</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {summary.propertyHealth.map((p) => (
                <tr
                  key={p.propertyId as string}
                  className="border-b last:border-0 hover:bg-[var(--muted)]/40 transition-colors cursor-pointer"
                  onClick={() => router.push(`/reviews?property=${p.propertyId}`)}
                >
                  <td className="px-4 py-3 font-medium text-[var(--primary)] hover:underline">{p.propertyName ?? p.propertyId}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-[var(--muted-foreground)]">{p.reviewCount}</td>
                  <td className="px-4 py-3"><Stars rating={p.avgRating} /></td>
                  <td className="px-4 py-3 text-center">
                    {p.badCount > 0 ? (
                      <span className="inline-block rounded-full bg-rose-600 px-2 py-0.5 text-xs text-white font-medium tabular-nums">
                        {p.badCount} bad
                      </span>
                    ) : (
                      <span className="text-[var(--muted-foreground)]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {p.badCount > 0 ? (
                      <span className={p.respondedCount < p.badCount ? "text-rose-400" : "text-emerald-400"}>
                        {p.respondedCount} / {p.badCount}
                      </span>
                    ) : (
                      <span className="text-[var(--muted-foreground)]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip badCount={p.badCount} respondedCount={p.respondedCount} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
      </div>
    </div>
  );
}
