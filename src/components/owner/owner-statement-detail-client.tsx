"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { Download, Info, Loader2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { bucketLabel, fmtDate, fmtMoney } from "./owner-format";

export function OwnerStatementDetailClient({
  propertyId,
  statementId,
}: {
  propertyId: Id<"properties">;
  statementId: Id<"ownerStatements">;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  // Query now returns `{ statement, flags }` so the statement detail page
  // can honour the same owner-portal admin flags as the dashboard +
  // summary card (single source of truth: featureFlags table).
  const result = useQuery(
    api.owner.queries.getOwnerStatement,
    isAuthenticated ? { statementId } : "skip",
  );
  const property = useQuery(
    api.owner.queries.getOwnerProperty,
    isAuthenticated ? { propertyId } : "skip",
  );
  const pdfUrl = useQuery(
    api.files.queries.getFileUrl,
    isAuthenticated && result?.statement.pdfStorageId
      ? { storageId: result.statement.pdfStorageId }
      : "skip",
  );

  if (isLoading || result === undefined || property === undefined) {
    return <div className="h-96 animate-pulse rounded-2xl bg-white" />;
  }

  const { statement, flags } = result;
  const currency = property.property.currency ?? "USD";
  const t = statement.snapshotTotals;

  return (
    <div className="space-y-8">
      <div>
        {/* Inline back link removed — OwnerShell renders the universal
            back button above the page chrome. */}
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Statement · {fmtDate(statement.periodStart)} – {fmtDate(statement.periodEnd - 1)}
            </h1>
            <p className="mt-1 text-sm text-[var(--cleaner-muted)]">
              Issued {statement.issuedAt ? fmtDate(statement.issuedAt) : "—"} ·{" "}
              <span className="font-mono">
                {(t.feePct * 100).toFixed(1)}% × {t.feeBase}
              </span>{" "}
              fee schedule in force on this period
            </p>
          </div>
          <PdfButton pdfUrl={pdfUrl} generating={!statement.pdfStorageId} />
        </div>
      </div>

      {/* The big number — admin-gated via `owner_show_payout`. When the
          flag is off, the hero collapses and the waterfall below still
          tells the story without the headline payout. */}
      {flags.showPayout && (
        <section className="rounded-2xl border-2 border-[var(--cleaner-primary)]/20 bg-gradient-to-br from-white to-[var(--cleaner-bg)] p-8">
          <div className="text-xs uppercase tracking-wide text-[var(--cleaner-muted)]">Your payout</div>
          <div className="mt-2 font-mono text-5xl font-bold tabular-nums text-[var(--cleaner-primary)]">
            {fmtMoney(t.ownerPayout, currency)}
          </div>
          {t.perOwner.length > 1 && (
            <div className="mt-3 text-xs text-[var(--cleaner-muted)]">
              You hold{" "}
              <span className="font-semibold text-[var(--cleaner-ink)]">
                {(property.ownership.stakePct * 100).toFixed(0)}%
              </span>{" "}
              stake. Total NOI after fee = {fmtMoney(t.ownerPayout / property.ownership.stakePct, currency)}.
            </div>
          )}
        </section>
      )}

      {/* The waterfall */}
      <section className="rounded-2xl border border-black/[0.06] bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">How we got there</h2>

        <Waterfall
          rows={[
            { label: "Gross revenue", value: t.grossRevenue, currency },
            { label: "Platform fees (Airbnb, VRBO, etc.)", value: -t.platformFees, currency },
            { label: "Net revenue", value: t.netRevenue, currency, divider: true, bold: true },
            ...t.costsByBucket.map((c) => ({
              label: bucketLabel(c.bucket),
              value: -c.amount,
              currency,
              indent: true,
            })),
            {
              label: "Total operating costs",
              value: -t.operatingCosts,
              currency,
              divider: true,
              bold: true,
            },
            {
              label: "Net Operating Income (NOI)",
              value: t.noi,
              currency,
              bold: true,
            },
            {
              label: `Management fee (${(t.feePct * 100).toFixed(1)}% × ${t.feeBase})`,
              value: -t.mgmtFee,
              currency,
              accent: true,
              tooltip: `Formula: max(0, ${t.feeBase}) × ${t.feePct}. Locked at issuance.`,
            },
            // Final hero row — admin-gated via `owner_show_payout`. NOI
            // and the mgmt-fee line above already give the full picture
            // when the payout itself is hidden.
            ...(flags.showPayout
              ? [
                  {
                    label: "Owner payout",
                    value: t.ownerPayout,
                    currency,
                    divider: true,
                    bold: true,
                    hero: true,
                  },
                ]
              : []),
          ]}
        />

        {t.capExMemo > 0 && (
          <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
            <Info size={12} className="mr-1 inline" />
            Capital expenditures this period: {fmtMoney(t.capExMemo, currency)}. Memo only — not deducted from your payout.
          </div>
        )}
      </section>

      {/* Source receipts */}
      <section className="rounded-2xl border border-black/[0.06] bg-white p-6">
        <h2 className="mb-2 text-lg font-semibold">Source records</h2>
        <p className="mb-4 text-xs text-[var(--cleaner-muted)]">
          Every line above traces back to a specific record. The only number without a backing receipt is the management fee — that one shows the formula.
        </p>
        <div className="max-h-96 overflow-y-auto rounded-lg border border-black/[0.04]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[var(--cleaner-bg)] text-xs uppercase tracking-wide text-[var(--cleaner-muted)]">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Source</th>
                <th className="px-3 py-2 text-left font-medium">Bucket</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {statement.sourceRefs.map((ref, idx) => (
                <tr
                  key={`${ref.table}-${ref.rowId}-${idx}`}
                  className="border-t border-black/[0.04]"
                >
                  <td className="px-3 py-2 font-mono text-xs text-[var(--cleaner-muted)]">
                    {ref.table}
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--cleaner-muted)]">
                    {"bucket" in ref && ref.bucket ? bucketLabel(ref.bucket) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {fmtMoney(ref.amount, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function PdfButton({
  pdfUrl,
  generating,
}: {
  pdfUrl: string | null | undefined;
  generating: boolean;
}) {
  if (generating) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-black/[0.06] bg-white px-4 py-2 text-sm text-[var(--cleaner-muted)]">
        <Loader2 size={14} className="animate-spin" />
        Generating PDF…
      </div>
    );
  }
  if (!pdfUrl) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-black/[0.06] bg-white px-4 py-2 text-sm text-[var(--cleaner-muted)]">
        PDF unavailable
      </div>
    );
  }
  return (
    <a
      href={pdfUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-lg bg-[var(--cleaner-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--cleaner-primary-soft)]"
    >
      <Download size={14} />
      Download PDF
    </a>
  );
}

type WaterfallRow = {
  label: string;
  value: number;
  currency: string;
  bold?: boolean;
  accent?: boolean;
  divider?: boolean;
  hero?: boolean;
  indent?: boolean;
  tooltip?: string;
};

function Waterfall({ rows }: { rows: WaterfallRow[] }) {
  return (
    <div className="space-y-0">
      {rows.map((r, i) => (
        <div
          key={i}
          className={`flex items-baseline justify-between py-2 ${
            r.divider ? "border-t-2 border-[var(--cleaner-ink)] mt-2 pt-3" : ""
          } ${r.indent ? "pl-4" : ""} ${r.hero ? "mt-2 rounded-lg bg-[var(--cleaner-primary)] px-3 text-white" : ""}`}
        >
          <span
            className={`${r.bold ? "font-semibold" : ""} ${r.accent && !r.hero ? "text-[var(--cleaner-primary)]" : ""} text-sm`}
            title={r.tooltip}
          >
            {r.label}
            {r.tooltip && (
              <Info size={12} className="ml-1 inline opacity-50" />
            )}
          </span>
          <span
            className={`font-mono tabular-nums ${
              r.hero
                ? "text-xl font-bold"
                : r.bold
                  ? "text-base font-semibold"
                  : "text-sm"
            } ${r.value < 0 && !r.hero ? "text-[var(--cleaner-muted)]" : ""}`}
          >
            {fmtMoney(r.value, r.currency)}
          </span>
        </div>
      ))}
    </div>
  );
}
