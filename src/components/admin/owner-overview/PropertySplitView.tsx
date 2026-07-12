"use client";

// Admin Owner Overview — property split view (Phase 3, read-only).
//
// LEFT  = what the owner sees (engine output, post-overrides)
// RIGHT = raw editor data (every stay/cost incl. excluded, current overrides,
//         draft status, audit trail) — NO edit controls in Phase 3.
//
// Phase 4 adds the edit controls (BookingsEditor, CostsEditor, VisibilityOverridePanel).

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ChevronLeft, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import {
  currentMonthKey,
  shiftMonth,
} from "@/components/owner/month-switcher";
import { StatementEditor } from "./StatementEditor";
import { formatDate } from "@/lib/tz";

type PreviewResult = NonNullable<
  ReturnType<typeof useQuery<typeof api.admin.ownerOverview.getPropertyPreview>>
>;

function formatPeriodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return formatDate(new Date(Date.UTC(y, m - 1, 1)), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatCurrency(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function PropertySplitView({
  ownerId,
  propertyId,
  period,
  onPeriodChange,
}: {
  ownerId: Id<"users">;
  propertyId: Id<"properties">;
  period: string;
  onPeriodChange: (next: string) => void;
}) {
  const data = useQuery(api.admin.ownerOverview.getPropertyPreview, {
    ownerUserId: ownerId,
    propertyId,
    period,
  });

  if (data === undefined) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const current = currentMonthKey();
  const isCurrentPeriod = period === current;
  const status = data.draft?.status ?? "no-draft";
  const currency = data.property.currency ?? "USD";

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Link
        href={`/admin/owner-overview/${ownerId}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to owner
      </Link>

      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{data.property.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What the owner sees this period — and what&apos;s hidden.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodStepper
            period={period}
            onPeriodChange={onPeriodChange}
            isCurrent={isCurrentPeriod}
          />
          <StatusPill status={status} />
          <Link
            href={`/owner/properties/${propertyId}?month=${period}&preview=admin`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          >
            Open as owner
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </header>

      {isCurrentPeriod && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Period in progress — preview only. Issue at month end.
        </div>
      )}

      {/* Split view */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* LEFT — Owner preview */}
        <section className="space-y-4">
          <SectionTitle>Owner preview</SectionTitle>
          <PreviewCard data={data} currency={currency} />
        </section>

        {/* RIGHT — Admin editor data (read-only in Phase 3) */}
        <section className="space-y-4">
          <SectionTitle>Statement editor</SectionTitle>
          <StatementEditor
            key={`${propertyId}:${period}:${data.draft?._id ?? "none"}`}
            propertyId={propertyId}
            period={period}
            currency={currency}
            draftId={data.draft?._id ?? null}
            initialBookings={data.editor.stays}
            initialCostItems={data.editor.costItems}
            initialOverrides={data.editor.overrides}
            initialNotes={data.editor.notes}
            status={data.draft?.status ?? null}
          />
        </section>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h2>
  );
}

function PeriodStepper({
  period,
  onPeriodChange,
  isCurrent,
}: {
  period: string;
  onPeriodChange: (next: string) => void;
  isCurrent: boolean;
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-card text-sm">
      <button
        type="button"
        onClick={() => onPeriodChange(shiftMonth(period, -1))}
        className="px-2 py-1.5 text-muted-foreground hover:text-foreground"
        aria-label="Previous month"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="border-x border-border px-3 py-1.5 font-medium">
        {formatPeriodLabel(period)}
      </span>
      <button
        type="button"
        onClick={() => onPeriodChange(shiftMonth(period, 1))}
        disabled={isCurrent}
        className="px-2 py-1.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
        aria-label="Next month"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    {
      "no-draft": "bg-muted text-muted-foreground",
      draft: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
      ready: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
      issued: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      sent: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
      recalled: "bg-red-500/10 text-red-600 dark:text-red-400",
    }[status] ?? "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium uppercase tracking-wide ${cls}`}
    >
      {status === "no-draft" ? "No draft" : status}
    </span>
  );
}

function PreviewCard({
  data,
  currency,
}: {
  data: PreviewResult;
  currency: string;
}) {
  if (!data.preview) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
        Engine could not compute this period. Likely missing fee config or owner
        assignment.
      </div>
    );
  }

  const t = data.preview.totals;
  const rows: Array<{ label: string; amount: number; emph?: boolean }> = [
    { label: "Gross revenue", amount: t.grossRevenue },
    { label: "Platform fees", amount: -t.platformFees },
    { label: "Net revenue", amount: t.netRevenue },
    { label: "Operating costs", amount: -t.operatingCosts },
    { label: "Net operating profit", amount: t.noi },
    { label: "Management fee", amount: -t.mgmtFee },
    { label: "Owner payout", amount: t.ownerPayout, emph: true },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Owner payout
          </span>
          <span className="text-xl font-semibold tabular-nums">
            {formatCurrency(t.ownerPayout, currency)}
          </span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {formatCurrency(t.grossRevenue, currency)} gross ·{" "}
          {formatCurrency(t.noi, currency)} NOI
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.label}
                className={`border-b border-border last:border-b-0 ${r.emph ? "bg-muted/30 font-semibold" : ""}`}
              >
                <td className="px-4 py-2">{r.label}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatCurrency(r.amount, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {t.costsByBucket.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Costs by bucket
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {t.costsByBucket.map((b) => (
              <li
                key={b.bucket}
                className="flex items-center justify-between"
              >
                <span className="text-muted-foreground">{b.bucket}</span>
                <span className="tabular-nums">
                  {formatCurrency(b.amount, currency)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

