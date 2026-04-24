"use client";

/**
 * Usage dashboard overview — admin-only.
 *
 * Guards:
 *   - `usage_dashboard` feature flag must be ON (falls back to a friendly
 *     empty-state with a link to Integrations when OFF).
 *   - The Convex query itself enforces `requireAdmin` — non-admins get a
 *     thrown error surfaced here as an access-denied state.
 */

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  AlertTriangle,
  ExternalLink,
  Gauge,
  Loader2,
} from "lucide-react";
import { ServiceCard, type ServiceCardProps } from "./service-card";
import { formatDelta, formatUsd } from "./format";

function StatTile({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
        {value}
      </p>
      {caption ? (
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">{caption}</p>
      ) : null}
    </div>
  );
}

export function UsageOverviewClient() {
  const flagEnabled = useQuery(api.admin.featureFlags.isFeatureEnabled, {
    key: "usage_dashboard",
  });
  const overview = useQuery(
    api.serviceUsage.queries.getOverview,
    flagEnabled ? {} : "skip",
  );

  const delta = useMemo(() => {
    if (!overview) return null;
    return formatDelta(overview.thisMonthCostUsd, overview.prevMonthCostUsd);
  }, [overview]);

  if (flagEnabled === undefined) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-6 text-sm text-[var(--muted-foreground)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading feature flag&hellip;
      </div>
    );
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
              Enable the <code>usage_dashboard</code> feature flag from
              Settings &rarr; Integrations to surface request volume, quota
              consumption, and estimated spend across every tracked external
              service. Usage data is still being recorded in the background;
              only this admin UI is gated.
            </p>
            <Link
              href="/settings?tab=integrations"
              className="mt-4 inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium hover:bg-[var(--accent)]"
            >
              Open Feature Flags
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (overview === undefined) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-6 text-sm text-[var(--muted-foreground)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading usage data&hellip;
      </div>
    );
  }

  const totalRequests = overview.services.reduce(
    (sum, s) => sum + s.thisMonthSuccessCount + s.thisMonthErrorCount,
    0,
  );
  const totalErrors = overview.services.reduce(
    (sum, s) => sum + s.thisMonthErrorCount,
    0,
  );
  const servicesWithErrors = overview.services.filter(
    (s) => s.lastError !== null,
  ).length;

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">
              This month
            </h2>
            <p className="text-sm text-[var(--muted-foreground)]">
              Aggregated across {overview.services.length} tracked service
              {overview.services.length === 1 ? "" : "s"}. Updated{" "}
              {new Date(overview.generatedAt).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
              })}
              .
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <StatTile
            label="Estimated spend"
            value={formatUsd(overview.thisMonthCostUsd)}
            caption={
              delta
                ? `${delta.label} vs last month (${formatUsd(overview.prevMonthCostUsd)})`
                : undefined
            }
          />
          <StatTile
            label="Requests"
            value={totalRequests.toLocaleString()}
            caption={`${totalErrors.toLocaleString()} error${
              totalErrors === 1 ? "" : "s"
            }`}
          />
          <StatTile
            label="Services with recent errors"
            value={`${servicesWithErrors} / ${overview.services.length}`}
            caption={
              servicesWithErrors > 0
                ? "Drill in for details"
                : "All clear within the last 100 events"
            }
          />
        </div>
      </section>

      {totalRequests === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--card)] p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-[var(--muted-foreground)]" />
            <div>
              <p className="text-sm font-semibold text-[var(--foreground)]">
                No usage recorded yet this month
              </p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                As instrumented features are used, rows land in
                <code className="mx-1 rounded bg-[var(--muted)] px-1 py-0.5">
                  serviceUsageEvents
                </code>
                and the hourly rollup cron aggregates them. Phase A wires
                voice transcription; additional services come online with
                Phase C.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <section>
        <h2 className="text-lg font-semibold text-[var(--foreground)]">
          Services
        </h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {overview.services.map((service) => {
            const props: ServiceCardProps = {
              serviceKey: service.serviceKey,
              displayName: service.displayName,
              docsUrl: service.docsUrl,
              thisMonthCostUsd: service.thisMonthCostUsd,
              thisMonthSuccessCount: service.thisMonthSuccessCount,
              thisMonthErrorCount: service.thisMonthErrorCount,
              quotas: service.quotas,
              lastError: service.lastError,
            };
            return <ServiceCard key={service.serviceKey} {...props} />;
          })}
        </div>
      </section>
    </div>
  );
}
