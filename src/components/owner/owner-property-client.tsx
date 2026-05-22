"use client";

import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { ArrowLeft, Bell, FileText, MapPin } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { fmtDate, fmtMoney, fmtMonth } from "./owner-format";

export function OwnerPropertyClient({ propertyId }: { propertyId: Id<"properties"> }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const prop = useQuery(
    api.owner.queries.getOwnerProperty,
    isAuthenticated ? { propertyId } : "skip",
  );
  const draft = useQuery(
    api.owner.queries.getOwnerStatementDraft,
    isAuthenticated ? { propertyId } : "skip",
  );
  const statements = useQuery(
    api.owner.queries.listOwnerStatements,
    isAuthenticated ? { propertyId } : "skip",
  );
  const pendingApprovals = useQuery(
    api.owner.queries.listMaintenanceApprovalRequests,
    isAuthenticated ? { propertyId, status: "pending" } : "skip",
  );

  if (isLoading || prop === undefined) return <Skeleton />;

  const currency = prop.property.currency ?? "USD";

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/owner"
          className="inline-flex items-center gap-1 text-xs text-[#999] hover:text-[#1a1a1a]"
        >
          <ArrowLeft size={12} /> Dashboard
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {prop.property.name}
        </h1>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-[#666]">
          <MapPin size={14} /> {prop.property.address}
        </p>
        <p className="mt-2 text-xs text-[#999]">
          You own <span className="font-semibold text-[#1a1a1a]">{(prop.ownership.stakePct * 100).toFixed(0)}%</span> as {prop.ownership.role}
          {prop.ownership.isPrimaryApprover && " · primary approver"}
        </p>
      </div>

      {/* Pending approvals callout */}
      {pendingApprovals && pendingApprovals.length > 0 && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5">
          <div className="mb-2 flex items-center gap-2 font-medium text-amber-900">
            <Bell size={16} />
            {pendingApprovals.length} maintenance request{pendingApprovals.length === 1 ? "" : "s"} awaiting your approval
          </div>
          <ul className="space-y-2">
            {pendingApprovals.map((req) => (
              <li key={req._id} className="flex items-center justify-between text-sm">
                <span className="truncate text-amber-900">
                  {req.description.slice(0, 60)}
                  {req.description.length > 60 && "…"}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-mono font-semibold text-amber-950">
                    {fmtMoney(req.proposedCost, currency)}
                  </span>
                  <Link
                    href={`/owner/properties/${propertyId}/approvals/${req._id}`}
                    className="rounded-lg bg-amber-900 px-3 py-1 text-xs font-medium text-white hover:bg-amber-800"
                  >
                    Review
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Current-month draft */}
      {draft && (
        <section className="rounded-2xl border border-[#e8e6e0] bg-white p-6">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">
              {fmtMonth(draft.month)} — live draft
            </h2>
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-700">
              In progress
            </span>
          </div>
          <ThreeStat
            currency={currency}
            grossRevenue={draft.draft.totals.grossRevenue}
            mgmtFee={draft.draft.totals.mgmtFee}
            ownerPayout={draft.draft.totals.ownerPayout}
            feePct={draft.draft.totals.feePct}
            feeBase={draft.draft.totals.feeBase}
          />
          <p className="mt-4 text-xs text-[#999]">
            This number updates live as costs land. It will be finalized and locked when ChezSoiStays Ops issues the statement.
          </p>
        </section>
      )}

      {/* Issued statements */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <FileText size={18} /> Statements
        </h2>
        {statements === undefined ? (
          <Skeleton />
        ) : statements.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#e8e6e0] bg-white p-8 text-center text-sm text-[#999]">
            No issued statements yet. Once ChezSoiStays Ops finalizes your first month, it will appear here.
          </div>
        ) : (
          <div className="space-y-2">
            {statements.map((s) => (
              <Link
                key={s._id}
                href={`/owner/properties/${propertyId}/statements/${s._id}`}
                className="flex items-center justify-between rounded-xl border border-[#e8e6e0] bg-white p-4 transition hover:border-[#1a237e]/40"
              >
                <div>
                  <div className="font-medium">
                    {fmtDate(s.periodStart)} – {fmtDate(s.periodEnd - 1)}
                  </div>
                  <div className="text-xs text-[#999]">
                    Issued {s.issuedAt ? fmtDate(s.issuedAt) : "—"}
                    {!s.pdfStorageId && " · PDF generating"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-lg font-semibold tabular-nums">
                    {fmtMoney(s.ownerPayout, currency)}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-[#999]">
                    your payout
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ThreeStat({
  currency,
  grossRevenue,
  mgmtFee,
  ownerPayout,
  feePct,
  feeBase,
}: {
  currency: string;
  grossRevenue: number;
  mgmtFee: number;
  ownerPayout: number;
  feePct: number;
  feeBase: string;
}) {
  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        <Stat label="Gross revenue" value={fmtMoney(grossRevenue, currency)} />
        <Stat
          label="Management fee"
          value={fmtMoney(-mgmtFee, currency)}
          subtitle={`${(feePct * 100).toFixed(1)}% × ${feeBase}`}
        />
        <Stat
          label="Your payout"
          value={fmtMoney(ownerPayout, currency)}
          accent
        />
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  subtitle,
  accent,
}: {
  label: string;
  value: string;
  subtitle?: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[#999]">{label}</div>
      <div
        className={`mt-1 font-mono text-xl tabular-nums ${
          accent ? "font-bold text-[#1a237e]" : "text-[#1a1a1a]"
        }`}
      >
        {value}
      </div>
      {subtitle && (
        <div className="mt-0.5 font-mono text-[10px] text-[#999]">{subtitle}</div>
      )}
    </div>
  );
}

function Skeleton() {
  return <div className="h-64 animate-pulse rounded-2xl bg-white" />;
}
