"use client";

import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { ArrowRight, Bell, Building2, FileText } from "lucide-react";
import { api } from "@convex/_generated/api";
import { fmtMoney, fmtMonth } from "./owner-format";

export function OwnerDashboardClient() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const dashboard = useQuery(
    api.owner.queries.getOwnerDashboard,
    isAuthenticated ? {} : "skip",
  );

  if (isLoading || dashboard === undefined) {
    return <SkeletonCard />;
  }

  if (dashboard.mode === "no_properties") {
    return (
      <div className="rounded-2xl border border-[#e8e6e0] bg-white p-12 text-center">
        <Building2 size={32} className="mx-auto mb-3 text-[#999]" />
        <p className="text-lg font-medium">No properties yet</p>
        <p className="mt-2 text-sm text-[#666]">
          You&apos;ll see your properties here once they&apos;re added to the portal.
          Contact J&amp;A Operations to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Welcome back{dashboard.user.name ? `, ${dashboard.user.name.split(" ")[0]}` : ""}
        </h1>
        <p className="mt-1 text-sm text-[#666]">
          {dashboard.mode === "single"
            ? "Your property at a glance."
            : `${dashboard.properties.length} properties — your portfolio at a glance.`}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {dashboard.properties.map((p) => (
          <PropertyCard key={p.propertyId} p={p} />
        ))}
      </div>
    </div>
  );
}

type PropertyCardProps = {
  p: {
    propertyId: string;
    propertyName: string;
    propertyImage: string | null;
    currency: string;
    currentMonth: string;
    pendingApprovalCount: number;
    draft:
      | { error: string }
      | {
          totals: {
            grossRevenue: number;
            ownerPayout: number;
            mgmtFee: number;
            feePct: number;
            feeBase: string;
          };
        };
  };
};

function PropertyCard({ p }: PropertyCardProps) {
  const totals = "totals" in p.draft ? p.draft.totals : null;
  const hasError = totals === null;

  return (
    <Link
      href={`/owner/properties/${p.propertyId}`}
      className="group relative flex flex-col gap-4 rounded-2xl border border-[#e8e6e0] bg-white p-6 transition hover:border-[#1a237e]/40 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{p.propertyName}</h2>
          <p className="mt-0.5 text-xs uppercase tracking-wide text-[#999]">
            {fmtMonth(p.currentMonth)} — in progress
          </p>
        </div>
        {p.pendingApprovalCount > 0 && (
          <Link
            href={`/owner/properties/${p.propertyId}/approvals`}
            className="flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-200"
            onClick={(e) => e.stopPropagation()}
          >
            <Bell size={12} />
            {p.pendingApprovalCount} pending
          </Link>
        )}
      </div>

      {hasError ? (
        <p className="text-sm italic text-[#999]">
          Live preview unavailable — {(p.draft as { error: string }).error}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4 border-t border-[#f0eee8] pt-4">
            <Stat
              label="Gross"
              value={fmtMoney(totals!.grossRevenue, p.currency)}
              muted
            />
            <Stat
              label="Mgmt fee"
              value={fmtMoney(-totals!.mgmtFee, p.currency)}
              muted
            />
            <Stat
              label="Your payout"
              value={fmtMoney(totals!.ownerPayout, p.currency)}
              accent
            />
          </div>
          <p className="text-xs text-[#999]">
            Fee formula: <span className="font-mono">{(totals!.feePct * 100).toFixed(1)}% × {totals!.feeBase}</span>
          </p>
        </>
      )}

      <div className="flex items-center gap-1 text-sm font-medium text-[#1a237e]">
        <FileText size={14} />
        View statements
        <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

function Stat({
  label,
  value,
  accent,
  muted,
}: {
  label: string;
  value: string;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[#999]">{label}</div>
      <div
        className={`mt-1 font-mono text-base tabular-nums ${
          accent ? "font-semibold text-[#1a237e]" : muted ? "text-[#444]" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {[1, 2].map((i) => (
        <div
          key={i}
          className="h-48 animate-pulse rounded-2xl border border-[#e8e6e0] bg-white"
        />
      ))}
    </div>
  );
}
