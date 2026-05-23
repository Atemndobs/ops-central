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

  if (isLoading || dashboard === undefined) return <SkeletonCards />;

  if (dashboard.mode === "no_properties") {
    return (
      <Card className="p-12 text-center">
        <Building2 size={32} className="mx-auto mb-3" style={{ color: "var(--cleaner-muted)" }} />
        <p className="text-lg" style={{ fontFamily: "var(--font-cleaner-display)", fontWeight: 700 }}>
          No properties yet
        </p>
        <p className="mt-2 text-sm" style={{ color: "var(--cleaner-muted)" }}>
          You&apos;ll see your properties here once they&apos;re added. Contact ChezSoiStays Operations.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1
          className="text-3xl tracking-tight"
          style={{ fontFamily: "var(--font-cleaner-display)", fontWeight: 700, letterSpacing: "-0.02em" }}
        >
          Welcome back{dashboard.user.name ? `, ${dashboard.user.name.split(" ")[0]}` : ""}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--cleaner-muted)" }}>
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
      className="group flex flex-col gap-4 rounded-3xl p-6 transition"
      style={{
        background: "var(--cleaner-surface)",
        boxShadow: "var(--cleaner-shadow)",
        border: "1px solid rgba(0,0,0,0.06)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2
            className="text-xl tracking-tight"
            style={{ fontFamily: "var(--font-cleaner-display)", fontWeight: 700, letterSpacing: "-0.02em" }}
          >
            {p.propertyName}
          </h2>
          <p
            className="mt-0.5 text-[10px]"
            style={{
              fontFamily: "var(--font-cleaner-mono)",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--cleaner-muted)",
            }}
          >
            {fmtMonth(p.currentMonth)} — in progress
          </p>
        </div>
        {p.pendingApprovalCount > 0 && (
          <Link
            href={`/owner/properties/${p.propertyId}/approvals`}
            className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
            style={{
              background: "rgba(255,189,89,0.18)",
              color: "var(--color-amber-900,#8a4a00)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <Bell size={12} />
            {p.pendingApprovalCount} pending
          </Link>
        )}
      </div>

      {hasError ? (
        <p className="text-sm italic" style={{ color: "var(--cleaner-muted)" }}>
          Live preview unavailable — {(p.draft as { error: string }).error}
        </p>
      ) : (
        <>
          <div
            className="grid grid-cols-3 gap-4 pt-4"
            style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}
          >
            <Stat label="Gross" value={fmtMoney(totals!.grossRevenue, p.currency)} />
            <Stat label="Mgmt fee" value={fmtMoney(-totals!.mgmtFee, p.currency)} />
            <Stat
              label="Your payout"
              value={fmtMoney(totals!.ownerPayout, p.currency)}
              accent
            />
          </div>
          <p className="text-xs" style={{ color: "var(--cleaner-muted)" }}>
            Fee formula:{" "}
            <span style={{ fontFamily: "var(--font-cleaner-mono)" }}>
              {(totals!.feePct * 100).toFixed(1)}% × {totals!.feeBase}
            </span>
          </p>
        </>
      )}

      <div
        className="flex items-center gap-1 text-sm font-medium"
        style={{ color: "var(--cleaner-primary)" }}
      >
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
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div
        className="text-[10px]"
        style={{
          fontFamily: "var(--font-cleaner-mono)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--cleaner-muted)",
        }}
      >
        {label}
      </div>
      <div
        className="mt-1 text-base tabular-nums"
        style={{
          fontFamily: "var(--font-cleaner-mono)",
          fontWeight: accent ? 700 : 400,
          color: accent ? "var(--cleaner-primary)" : "var(--cleaner-ink)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-3xl ${className}`}
      style={{
        background: "var(--cleaner-surface)",
        boxShadow: "var(--cleaner-shadow)",
        border: "1px solid rgba(0,0,0,0.06)",
      }}
    >
      {children}
    </div>
  );
}

function SkeletonCards() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {[1, 2].map((i) => (
        <div
          key={i}
          className="h-48 animate-pulse rounded-3xl"
          style={{ background: "var(--cleaner-surface)" }}
        />
      ))}
    </div>
  );
}
