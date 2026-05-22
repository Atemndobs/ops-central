"use client";

import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { ArrowLeft, Download, Info, Loader2 } from "lucide-react";
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
  const statement = useQuery(
    api.owner.queries.getOwnerStatement,
    isAuthenticated ? { statementId } : "skip",
  );
  const property = useQuery(
    api.owner.queries.getOwnerProperty,
    isAuthenticated ? { propertyId } : "skip",
  );
  const pdfUrl = useQuery(
    api.files.queries.getFileUrl,
    isAuthenticated && statement?.pdfStorageId
      ? { storageId: statement.pdfStorageId }
      : "skip",
  );

  if (isLoading || statement === undefined || property === undefined) {
    return <div className="h-96 animate-pulse rounded-2xl bg-white" />;
  }

  const currency = property.property.currency ?? "USD";
  const t = statement.snapshotTotals;

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/owner/properties/${propertyId}`}
          className="inline-flex items-center gap-1 text-xs text-[#999] hover:text-[#1a1a1a]"
        >
          <ArrowLeft size={12} /> {property.property.name}
        </Link>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Statement · {fmtDate(statement.periodStart)} – {fmtDate(statement.periodEnd - 1)}
            </h1>
            <p className="mt-1 text-sm text-[#666]">
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

      {/* The big number */}
      <section className="rounded-2xl border-2 border-[#1a237e]/20 bg-gradient-to-br from-white to-[#f5f5fa] p-8">
        <div className="text-xs uppercase tracking-wide text-[#666]">Your payout</div>
        <div className="mt-2 font-mono text-5xl font-bold tabular-nums text-[#1a237e]">
          {fmtMoney(t.ownerPayout, currency)}
        </div>
        {t.perOwner.length > 1 && (
          <div className="mt-3 text-xs text-[#666]">
            You hold{" "}
            <span className="font-semibold text-[#1a1a1a]">
              {(property.ownership.stakePct * 100).toFixed(0)}%
            </span>{" "}
            stake. Total NOI after fee = {fmtMoney(t.ownerPayout / property.ownership.stakePct, currency)}.
          </div>
        )}
      </section>

      {/* The waterfall */}
      <section className="rounded-2xl border border-[#e8e6e0] bg-white p-6">
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
            {
              label: "Owner payout",
              value: t.ownerPayout,
              currency,
              divider: true,
              bold: true,
              hero: true,
            },
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
      <section className="rounded-2xl border border-[#e8e6e0] bg-white p-6">
        <h2 className="mb-2 text-lg font-semibold">Source records</h2>
        <p className="mb-4 text-xs text-[#666]">
          Every line above traces back to a specific record. The only number without a backing receipt is the management fee — that one shows the formula.
        </p>
        <div className="max-h-96 overflow-y-auto rounded-lg border border-[#f0eee8]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[#fafaf7] text-xs uppercase tracking-wide text-[#999]">
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
                  className="border-t border-[#f0eee8]"
                >
                  <td className="px-3 py-2 font-mono text-xs text-[#666]">
                    {ref.table}
                  </td>
                  <td className="px-3 py-2 text-xs text-[#666]">
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
      <div className="flex items-center gap-2 rounded-lg border border-[#e8e6e0] bg-white px-4 py-2 text-sm text-[#666]">
        <Loader2 size={14} className="animate-spin" />
        Generating PDF…
      </div>
    );
  }
  if (!pdfUrl) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[#e8e6e0] bg-white px-4 py-2 text-sm text-[#666]">
        PDF unavailable
      </div>
    );
  }
  return (
    <a
      href={pdfUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-lg bg-[#1a237e] px-4 py-2 text-sm font-medium text-white hover:bg-[#0d1547]"
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
            r.divider ? "border-t-2 border-[#1a1a1a] mt-2 pt-3" : ""
          } ${r.indent ? "pl-4" : ""} ${r.hero ? "mt-2 rounded-lg bg-[#1a237e] px-3 text-white" : ""}`}
        >
          <span
            className={`${r.bold ? "font-semibold" : ""} ${r.accent && !r.hero ? "text-[#1a237e]" : ""} text-sm`}
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
            } ${r.value < 0 && !r.hero ? "text-[#666]" : ""}`}
          >
            {fmtMoney(r.value, r.currency)}
          </span>
        </div>
      ))}
    </div>
  );
}
