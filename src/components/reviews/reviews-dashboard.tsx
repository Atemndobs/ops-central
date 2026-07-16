"use client";

import { useState, useEffect } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@convex/_generated/api";
import { Loader2, Star, AlertTriangle, CheckCircle, ChevronDown, ChevronUp, EyeOff, Eye, TrendingUp, Mail, Phone } from "lucide-react";

const HIDDEN_KEY = "reviews-dashboard-hidden-properties";

function useHiddenProperties() {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const stored = localStorage.getItem(HIDDEN_KEY);
      if (stored) setHidden(new Set(JSON.parse(stored)));
    } catch {}
  }, []);
  const hide = (id: string) => {
    setHidden((prev) => {
      const next = new Set(prev).add(id);
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
      return next;
    });
  };
  const restore = (id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      next.delete(id);
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
      return next;
    });
  };
  return { hidden, hide, restore };
}

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

function daysSince(ts: number) {
  return Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
}

function ReviewOpportunities({ isAuthenticated }: { isAuthenticated: boolean }) {
  const [open, setOpen] = useState(true);
  const opportunities = useQuery(
    api.stays.queries.getUnreviewedCheckouts,
    isAuthenticated ? {} : "skip",
  );

  if (opportunities === undefined) return null;
  if (opportunities.length === 0) return null;

  return (
    <div className="rounded-xl border bg-[var(--card)] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 border-b hover:bg-[var(--muted)]/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-emerald-500" />
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Review Opportunities
          </p>
          <span className="inline-block rounded-full bg-emerald-600 text-white text-xs px-2 py-0.5 font-semibold tabular-nums">
            {opportunities.length}
          </span>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-[var(--muted-foreground)]" /> : <ChevronDown className="h-4 w-4 text-[var(--muted-foreground)]" />}
      </button>

      {open && (
        <>
          <div className="px-4 py-2 bg-emerald-50 border-b text-xs text-emerald-800">
            These guests checked out recently and left no review. Reach out — happy guests who didn't review are your easiest 5★.
          </div>
          <div className="divide-y divide-[var(--border)]">
            {opportunities.map((s) => {
              const days = daysSince(s.checkOutAt);
              const initials = s.guestName.split(" ").map((w: string) => w[0]).slice(0, 2).join("");
              return (
                <div key={s._id} className="flex items-center gap-3 px-4 py-3">
                  {/* Avatar */}
                  {s.guestPhotoUrl ? (
                    <img src={s.guestPhotoUrl} alt={s.guestName} className="h-9 w-9 rounded-full object-cover shrink-0 ring-1 ring-[var(--border)]" />
                  ) : (
                    <div className="h-9 w-9 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 ring-1 ring-emerald-200">
                      <span className="text-xs font-semibold text-emerald-700 select-none">{initials}</span>
                    </div>
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium truncate">{s.guestName}</span>
                      {s.propertyName && (
                        <span className="text-xs text-[var(--muted-foreground)] truncate">· {s.propertyName}</span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                      Checked out {days === 0 ? "today" : `${days}d ago`}
                      {s.platform ? ` · ${s.platform}` : ""}
                    </p>
                  </div>

                  {/* Contact indicators */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {s.guestEmail && (
                      <span title={s.guestEmail} className="p-1.5 rounded bg-[var(--muted)] text-[var(--muted-foreground)]">
                        <Mail className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </div>

                  {/* Recency urgency */}
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
                    days <= 7
                      ? "bg-emerald-100 text-emerald-700"
                      : days <= 21
                      ? "bg-amber-100 text-amber-700"
                      : "bg-slate-100 text-slate-600"
                  }`}>
                    {days <= 7 ? "Fresh" : days <= 21 ? "Act soon" : "Cooling"}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function ReviewsDashboard() {
  const { isAuthenticated } = useConvexAuth();
  const [tableOpen, setTableOpen] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  const router = useRouter();
  const { hidden, hide, restore } = useHiddenProperties();
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

      {/* Review opportunities — guests who stayed but never reviewed */}
      <ReviewOpportunities isAuthenticated={isAuthenticated} />

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
        {tableOpen && (
          <>
            {/* Mobile card list */}
            <div className="sm:hidden divide-y divide-[var(--border)]">
              {summary.propertyHealth
                .filter((p) => showHidden || !hidden.has(p.propertyId as string))
                .map((p) => {
                  const isHidden = hidden.has(p.propertyId as string);
                  return (
                    <div
                      key={p.propertyId as string}
                      className={`flex items-center gap-3 px-4 py-3 group transition-colors ${isHidden ? "opacity-40" : "cursor-pointer active:bg-[var(--muted)]/60"}`}
                      onClick={() => !isHidden && router.push(`/reviews?property=${p.propertyId}`)}
                    >
                      {/* Status indicator stripe */}
                      <div className="shrink-0">
                        <StatusChip badCount={p.badCount} respondedCount={p.respondedCount} />
                      </div>

                      {/* Property name + meta */}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-[var(--primary)] truncate leading-tight">
                          {p.propertyName ?? p.propertyId}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Stars rating={p.avgRating} />
                          <span className="text-xs text-[var(--muted-foreground)] tabular-nums">{p.reviewCount} reviews</span>
                          {p.badCount > 0 && (
                            <span className="text-xs text-rose-400 tabular-nums">
                              {p.respondedCount}/{p.badCount} bad responded
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Hide button */}
                      <button
                        type="button"
                        title={isHidden ? "Show property" : "Hide from dashboard"}
                        onClick={(e) => { e.stopPropagation(); isHidden ? restore(p.propertyId as string) : hide(p.propertyId as string); }}
                        className="shrink-0 opacity-0 group-active:opacity-100 p-1.5 rounded hover:bg-[var(--muted)] text-[var(--muted-foreground)]"
                      >
                        {isHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                      </button>
                    </div>
                  );
                })}
            </div>

            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-[var(--muted-foreground)] uppercase tracking-wider">
                    <th className="text-left px-4 py-2 font-medium">Status</th>
                    <th className="text-left px-4 py-2 font-medium">Property</th>
                    <th className="text-right px-4 py-2 font-medium">Reviews</th>
                    <th className="text-left px-4 py-2 font-medium">Avg Rating</th>
                    <th className="text-center px-4 py-2 font-medium">Low (≤3★)</th>
                    <th className="text-center px-4 py-2 font-medium">Responded</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {summary.propertyHealth
                    .filter((p) => showHidden || !hidden.has(p.propertyId as string))
                    .map((p) => {
                      const isHidden = hidden.has(p.propertyId as string);
                      return (
                        <tr
                          key={p.propertyId as string}
                          className={`border-b last:border-0 hover:bg-[var(--muted)]/40 transition-colors group ${isHidden ? "opacity-40" : "cursor-pointer"}`}
                          onClick={() => !isHidden && router.push(`/reviews?property=${p.propertyId}`)}
                        >
                          <td className="px-4 py-3">
                            <StatusChip badCount={p.badCount} respondedCount={p.respondedCount} />
                          </td>
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
                          <td className="px-2 py-3">
                            <button
                              type="button"
                              title={isHidden ? "Show property" : "Hide from dashboard"}
                              onClick={(e) => { e.stopPropagation(); isHidden ? restore(p.propertyId as string) : hide(p.propertyId as string); }}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-[var(--muted)] text-[var(--muted-foreground)]"
                            >
                              {isHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            {hidden.size > 0 && (
              <div className="px-4 py-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowHidden((s) => !s)}
                  className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] flex items-center gap-1 transition-colors"
                >
                  {showHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  {showHidden ? "Hide excluded" : `Show ${hidden.size} excluded propert${hidden.size === 1 ? "y" : "ies"}`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
