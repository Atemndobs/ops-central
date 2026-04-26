"use client";

import Link from "next/link";
import { AlertTriangle, ChevronRight, ExternalLink } from "lucide-react";
import {
  formatCompactNumber,
  formatPercent,
  formatQuotaValue,
  formatQuotaWindow,
  formatRelativeTime,
  formatUsd,
  quotaColor,
} from "./format";

export type ServiceCardQuota = {
  id: string;
  label: string;
  window: "minute" | "hour" | "day" | "month";
  limit: number;
  consumed: number;
  pct: number;
  metric: "count" | "inputTokens" | "outputTokens" | "costUsd";
  source?: "self" | "provider";
  unit?: string;
  fetchedAt?: number;
};

export type ServiceCardProps = {
  serviceKey: string;
  displayName: string;
  docsUrl: string;
  thisMonthCostUsd: number;
  thisMonthSuccessCount: number;
  thisMonthErrorCount: number;
  quotas: ServiceCardQuota[];
  lastError:
    | null
    | {
        status: string;
        errorCode?: string;
        errorMessage?: string;
        createdAt: number;
        feature: string;
      };
};

function QuotaBar({ quota }: { quota: ServiceCardQuota }) {
  const clamped = Math.min(100, Math.max(0, quota.pct));
  const isProvider = quota.source === "provider";
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate text-[var(--muted-foreground)]">
          {quota.label}{" "}
          <span className="text-[var(--muted-foreground)]/70">
            ({formatQuotaWindow(quota.window)})
          </span>
          {isProvider ? (
            <span
              className="ml-1 rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-300"
              title="Fetched directly from the provider's billing API"
            >
              live
            </span>
          ) : null}
        </span>
        <span className="font-medium text-[var(--foreground)]">
          {isProvider
            ? formatQuotaValue(quota.consumed, quota.unit)
            : formatCompactNumber(quota.consumed)}
          <span className="text-[var(--muted-foreground)]">
            {" "}
            /{" "}
            {isProvider
              ? formatQuotaValue(quota.limit, quota.unit)
              : formatCompactNumber(quota.limit)}
          </span>
          <span className="ml-2 font-mono text-[10px] text-[var(--muted-foreground)]">
            {formatPercent(quota.pct)}
          </span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--muted)]">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${clamped}%`,
            backgroundColor: quotaColor(quota.pct),
          }}
        />
      </div>
      {isProvider && quota.fetchedAt ? (
        <p className="text-[10px] text-[var(--muted-foreground)]/70">
          synced {formatRelativeTime(quota.fetchedAt)}
        </p>
      ) : null}
    </div>
  );
}

export function ServiceCard(props: ServiceCardProps) {
  const hasQuotas = props.quotas.length > 0;
  const totalRequests =
    props.thisMonthSuccessCount + props.thisMonthErrorCount;

  return (
    <Link
      href={`/settings/usage/${props.serviceKey}`}
      className="group flex flex-col gap-4 rounded-lg border border-[var(--border)] bg-[var(--card)] p-5 transition hover:border-[var(--primary)]/60 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--foreground)]">
            {props.displayName}
          </p>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
            {props.serviceKey}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition group-hover:translate-x-0.5 group-hover:text-[var(--foreground)]" />
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            This month
          </p>
          <p className="mt-0.5 text-base font-semibold text-[var(--foreground)]">
            {formatUsd(props.thisMonthCostUsd)}
          </p>
          <p className="text-xs text-[var(--muted-foreground)]">
            {formatCompactNumber(totalRequests)} call
            {totalRequests === 1 ? "" : "s"}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Errors
          </p>
          <p
            className={`mt-0.5 text-base font-semibold ${
              props.thisMonthErrorCount > 0
                ? "text-amber-400"
                : "text-[var(--foreground)]"
            }`}
          >
            {formatCompactNumber(props.thisMonthErrorCount)}
          </p>
          <p className="text-xs text-[var(--muted-foreground)]">
            {totalRequests > 0
              ? `${((props.thisMonthErrorCount / totalRequests) * 100).toFixed(1)}% rate`
              : "No traffic"}
          </p>
        </div>
      </div>

      {hasQuotas ? (
        <div className="space-y-3 border-t border-[var(--border)] pt-4">
          {props.quotas.map((quota) => (
            <QuotaBar key={quota.id} quota={quota} />
          ))}
        </div>
      ) : (
        <p className="rounded-md bg-[var(--muted)]/40 px-3 py-2 text-xs text-[var(--muted-foreground)]">
          No quotas configured yet.
        </p>
      )}

      {props.lastError ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
          <div className="min-w-0">
            <p className="font-semibold text-amber-300">
              {props.lastError.status.replaceAll("_", " ")}
              <span className="ml-1 font-normal text-[var(--muted-foreground)]">
                · {props.lastError.feature}
              </span>
            </p>
            {props.lastError.errorMessage ? (
              <p className="mt-0.5 truncate text-[var(--muted-foreground)]">
                {props.lastError.errorMessage}
              </p>
            ) : null}
            <p className="mt-0.5 text-[var(--muted-foreground)]/70">
              {formatRelativeTime(props.lastError.createdAt)}
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between pt-1 text-xs text-[var(--muted-foreground)]">
        <span
          className="inline-flex items-center gap-1 hover:text-[var(--foreground)]"
          onClick={(event) => event.stopPropagation()}
        >
          <a
            href={props.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1"
            onClick={(event) => event.stopPropagation()}
          >
            Provider pricing
            <ExternalLink className="h-3 w-3" />
          </a>
        </span>
        <span className="text-[var(--foreground)] opacity-0 transition group-hover:opacity-100">
          View details &rarr;
        </span>
      </div>
    </Link>
  );
}
