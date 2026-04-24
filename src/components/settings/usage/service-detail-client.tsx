"use client";

/**
 * Service detail page — charts, per-feature breakdown, recent errors, and a
 * raw-event drill-down with status filter and simple pagination. Admin-only.
 *
 * Gated behind the `usage_dashboard` feature flag (same as the overview).
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  Gauge,
  Loader2,
} from "lucide-react";
import { DailyTrafficChart } from "./daily-traffic-chart";
import { DailyCostChart } from "./daily-cost-chart";
import {
  formatCompactNumber,
  formatRelativeTime,
  formatUsd,
} from "./format";

type EventStatus = Doc<"serviceUsageEvents">["status"];

const STATUS_FILTERS: Array<{ id: EventStatus | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "success", label: "Success" },
  { id: "rate_limited", label: "Rate limited" },
  { id: "quota_exceeded", label: "Quota exceeded" },
  { id: "auth_error", label: "Auth error" },
  { id: "client_error", label: "Client error" },
  { id: "server_error", label: "Server error" },
  { id: "timeout", label: "Timeout" },
  { id: "unknown_error", label: "Unknown" },
];

const WINDOW_OPTIONS = [7, 14, 30, 60, 90];

export type ServiceKey =
  | "gemini"
  | "clerk"
  | "hospitable"
  | "resend"
  | "convex";

export function ServiceDetailClient({
  serviceKey,
}: {
  serviceKey: ServiceKey;
}) {
  const flagEnabled = useQuery(api.admin.featureFlags.isFeatureEnabled, {
    key: "usage_dashboard",
  });

  const [windowDays, setWindowDays] = useState<number>(30);
  const [statusFilter, setStatusFilter] = useState<EventStatus | "all">("all");

  const detail = useQuery(
    api.serviceUsage.queries.getServiceDetail,
    flagEnabled ? { serviceKey, days: windowDays } : "skip",
  );

  const events = useQuery(
    api.serviceUsage.queries.listEvents,
    flagEnabled
      ? {
          serviceKey,
          status: statusFilter === "all" ? undefined : statusFilter,
          limit: 100,
        }
      : "skip",
  );

  const totals = useMemo(() => {
    if (!detail)
      return { requests: 0, errors: 0, cost: 0 };
    return detail.daily.reduce(
      (acc, d) => ({
        requests: acc.requests + d.successCount + d.errorCount,
        errors: acc.errors + d.errorCount,
        cost: acc.cost + d.totalCostUsd,
      }),
      { requests: 0, errors: 0, cost: 0 },
    );
  }, [detail]);

  if (flagEnabled === undefined) {
    return <LoadingState />;
  }

  if (!flagEnabled) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--card)] p-8">
        <div className="flex items-start gap-4">
          <div className="rounded-md bg-[var(--primary)]/10 p-3 text-[var(--primary)]">
            <Gauge className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-[var(--foreground)]">
              Usage dashboard is disabled
            </h3>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Turn on the <code>usage_dashboard</code> flag from Settings
              &rarr; Integrations to view per-service usage, or go back to the
              overview.
            </p>
            <Link
              href="/settings/usage"
              className="mt-4 inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium hover:bg-[var(--accent)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Usage
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (detail === undefined) {
    return <LoadingState />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-[var(--border)] pb-4">
        <Link
          href="/settings/usage"
          className="inline-flex w-fit items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to Usage
        </Link>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--foreground)]">
              {detail.displayName}
            </h1>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
              {detail.serviceKey}
            </p>
            <a
              href={detail.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              Provider pricing
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-[var(--muted-foreground)]">Window:</span>
            {WINDOW_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setWindowDays(days)}
                className={`rounded-md border px-3 py-1.5 font-medium transition ${
                  windowDays === days
                    ? "border-[var(--primary)] text-[var(--foreground)]"
                    : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]/50"
                }`}
              >
                {days}D
              </button>
            ))}
          </div>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <StatTile
          label={`Requests (${detail.windowDays}d)`}
          value={formatCompactNumber(totals.requests)}
        />
        <StatTile
          label={`Errors (${detail.windowDays}d)`}
          value={formatCompactNumber(totals.errors)}
          caption={
            totals.requests > 0
              ? `${((totals.errors / totals.requests) * 100).toFixed(1)}% error rate`
              : undefined
          }
          accent={totals.errors > 0 ? "warning" : "default"}
        />
        <StatTile
          label={`Cost (${detail.windowDays}d)`}
          value={formatUsd(totals.cost)}
        />
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">
          Daily traffic
        </h2>
        <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
          Requests per day, stacked by outcome. Source: hourly rollups.
        </p>
        <div className="mt-4">
          <DailyTrafficChart data={detail.daily} />
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">
          Estimated daily cost
        </h2>
        <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
          USD per day using prices captured at write time. Services on free
          tiers report $0.
        </p>
        <div className="mt-4">
          <DailyCostChart data={detail.daily} />
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">
          Per-feature breakdown
        </h2>
        {detail.byFeature.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted-foreground)]">
            No feature activity in this window.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Feature</th>
                  <th className="px-3 py-2 text-right font-medium">Success</th>
                  <th className="px-3 py-2 text-right font-medium">Errors</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Input tokens
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Output tokens
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Audio sec
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {detail.byFeature.map((row) => (
                  <tr
                    key={row.feature}
                    className="border-b border-[var(--border)]/50 last:border-b-0"
                  >
                    <td className="px-3 py-2 font-mono text-xs text-[var(--foreground)]">
                      {row.feature}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {formatCompactNumber(row.successCount)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono text-xs ${
                        row.errorCount > 0 ? "text-amber-400" : ""
                      }`}
                    >
                      {formatCompactNumber(row.errorCount)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {formatCompactNumber(row.totalInputTokens)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {formatCompactNumber(row.totalOutputTokens)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {formatCompactNumber(row.totalAudioSeconds)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {formatUsd(row.totalCostUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">
              Recent errors
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              Last 25 non-success events across all features.
            </p>
          </div>
        </div>
        {detail.recentErrors.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted-foreground)]">
            No recent errors recorded. 🎉
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border)]/70">
            {detail.recentErrors.map((err) => (
              <li
                key={err._id}
                className="flex items-start gap-3 py-2 text-sm"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-[var(--foreground)]">
                    {err.status.replaceAll("_", " ")}
                    <span className="ml-2 font-mono text-xs text-[var(--muted-foreground)]">
                      {err.feature}
                    </span>
                  </p>
                  {err.errorMessage ? (
                    <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">
                      {err.errorCode ? `[${err.errorCode}] ` : ""}
                      {err.errorMessage}
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                  {formatRelativeTime(err.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">
              Raw events
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              Last 100 rows from <code>serviceUsageEvents</code>. Filter by
              status below.
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setStatusFilter(filter.id)}
                className={`rounded-md border px-2 py-1 text-xs transition ${
                  statusFilter === filter.id
                    ? "border-[var(--primary)] text-[var(--foreground)]"
                    : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]/40"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {events === undefined ? (
          <p className="mt-4 text-sm text-[var(--muted-foreground)]">
            Loading events&hellip;
          </p>
        ) : events.events.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--muted-foreground)]">
            No events match the current filter.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="border-b border-[var(--border)] uppercase tracking-wider text-[var(--muted-foreground)]">
                <tr>
                  <th className="px-2 py-2 font-medium">Time</th>
                  <th className="px-2 py-2 font-medium">Feature</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 text-right font-medium">
                    Duration
                  </th>
                  <th className="px-2 py-2 text-right font-medium">Tokens</th>
                  <th className="px-2 py-2 text-right font-medium">Audio</th>
                  <th className="px-2 py-2 text-right font-medium">Cost</th>
                  <th className="px-2 py-2 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {events.events.map((ev) => (
                  <tr
                    key={ev._id}
                    className="border-b border-[var(--border)]/50 last:border-b-0"
                  >
                    <td className="px-2 py-1.5 font-mono">
                      {new Date(ev.createdAt).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}{" "}
                      <span className="text-[var(--muted-foreground)]">
                        · {new Date(ev.createdAt).toLocaleDateString()}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 font-mono">{ev.feature}</td>
                    <td
                      className={`px-2 py-1.5 font-mono ${
                        ev.status === "success"
                          ? "text-emerald-400"
                          : "text-amber-400"
                      }`}
                    >
                      {ev.status}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">
                      {ev.durationMs ? `${ev.durationMs} ms` : "\u2014"}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">
                      {formatCompactNumber(
                        (ev.inputTokens ?? 0) + (ev.outputTokens ?? 0),
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">
                      {ev.audioSeconds
                        ? `${ev.audioSeconds.toFixed(1)}s`
                        : "\u2014"}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">
                      {ev.estimatedCostUsd !== undefined
                        ? formatUsd(ev.estimatedCostUsd, { precise: true })
                        : "\u2014"}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-[var(--muted-foreground)]">
                      {ev.errorMessage ? (
                        <span title={ev.errorMessage}>
                          {ev.errorCode ? `[${ev.errorCode}] ` : ""}
                          {ev.errorMessage.length > 48
                            ? `${ev.errorMessage.slice(0, 48)}\u2026`
                            : ev.errorMessage}
                        </span>
                      ) : (
                        "\u2014"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {events.nextCursor !== null ? (
              <p className="mt-3 text-xs text-[var(--muted-foreground)]">
                Older events exist. Narrow the window or status filter to
                paginate; full pagination ships in a follow-up.
              </p>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-6 text-sm text-[var(--muted-foreground)]">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading&hellip;
    </div>
  );
}

function StatTile({
  label,
  value,
  caption,
  accent,
}: {
  label: string;
  value: string;
  caption?: string;
  accent?: "default" | "warning";
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        {label}
      </p>
      <p
        className={`mt-2 text-2xl font-semibold ${
          accent === "warning" ? "text-amber-400" : "text-[var(--foreground)]"
        }`}
      >
        {value}
      </p>
      {caption ? (
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          {caption}
        </p>
      ) : null}
    </div>
  );
}
