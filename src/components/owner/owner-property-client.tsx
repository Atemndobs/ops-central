"use client";

import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { ArrowLeft, Bell, CalendarDays, FileText, MapPin } from "lucide-react";
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
          className="inline-flex items-center gap-1 text-xs"
          style={{ color: "var(--cleaner-muted)" }}
        >
          <ArrowLeft size={12} /> Dashboard
        </Link>
        <h1
          className="mt-2 text-3xl tracking-tight"
          style={{ fontFamily: "var(--font-cleaner-display)", fontWeight: 700, letterSpacing: "-0.02em" }}
        >
          {prop.property.name}
        </h1>
        <p
          className="mt-1 flex items-center gap-1.5 text-sm"
          style={{ color: "var(--cleaner-muted)" }}
        >
          <MapPin size={14} /> {prop.property.address}
        </p>
        <p className="mt-2 text-xs" style={{ color: "var(--cleaner-muted)" }}>
          You own{" "}
          <span style={{ fontWeight: 700, color: "var(--cleaner-ink)" }}>
            {(prop.ownership.stakePct * 100).toFixed(0)}%
          </span>{" "}
          as {prop.ownership.role}
          {prop.ownership.isPrimaryApprover && " · primary approver"}
        </p>
      </div>

      {/* Tab nav */}
      <nav className="flex gap-1 border-b" style={{ borderColor: "rgba(0,0,0,0.08)" }}>
        <TabLink href={`/owner/properties/${propertyId}`} active>
          Overview
        </TabLink>
        <TabLink href={`/owner/properties/${propertyId}/costs`}>Costs</TabLink>
        <TabLink href={`/owner/properties/${propertyId}/bookings`}>Bookings</TabLink>
        <TabLink href={`/owner/blocks`}>
          <CalendarDays size={12} className="mr-1 inline" />
          Date Blocks
        </TabLink>
      </nav>

      {pendingApprovals && pendingApprovals.length > 0 && (
        <Card
          padding="p-5"
          style={{
            background: "rgba(255,189,89,0.1)",
            border: "1.5px solid rgba(255,189,89,0.5)",
          }}
        >
          <div
            className="mb-2 flex items-center gap-2 font-medium"
            style={{ color: "#7a4100" }}
          >
            <Bell size={16} />
            {pendingApprovals.length} maintenance request
            {pendingApprovals.length === 1 ? "" : "s"} awaiting your approval
          </div>
          <ul className="space-y-2">
            {pendingApprovals.map((req) => (
              <li key={req._id} className="flex items-center justify-between text-sm">
                <span className="truncate" style={{ color: "#5a3000" }}>
                  {req.description.slice(0, 60)}
                  {req.description.length > 60 && "…"}
                </span>
                <span className="flex items-center gap-3">
                  <span
                    className="tabular-nums"
                    style={{
                      fontFamily: "var(--font-cleaner-mono)",
                      fontWeight: 700,
                      color: "#5a3000",
                    }}
                  >
                    {fmtMoney(req.proposedCost, currency)}
                  </span>
                  <Link
                    href={`/owner/properties/${propertyId}/approvals/${req._id}`}
                    className="rounded-lg px-3 py-1 text-xs font-medium text-white"
                    style={{ background: "#7a4100" }}
                  >
                    Review
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {draft && (
        <Card padding="p-6">
          <div className="mb-4 flex items-baseline justify-between">
            <h2
              className="text-lg"
              style={{ fontFamily: "var(--font-cleaner-display)", fontWeight: 700 }}
            >
              {fmtMonth(draft.month)} — live draft
            </h2>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{
                background: "rgba(155,81,224,0.12)",
                color: "var(--cleaner-primary)",
                fontFamily: "var(--font-cleaner-mono)",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
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
          <p className="mt-4 text-xs" style={{ color: "var(--cleaner-muted)" }}>
            This number updates live as costs land. It will be finalized and locked when ChezSoiStays Ops issues the statement.
          </p>
        </Card>
      )}

      <section>
        <h2
          className="mb-3 flex items-center gap-2 text-lg"
          style={{ fontFamily: "var(--font-cleaner-display)", fontWeight: 700 }}
        >
          <FileText size={18} /> Statements
        </h2>
        {statements === undefined ? (
          <Skeleton />
        ) : statements.length === 0 ? (
          <Card padding="p-8">
            <p className="text-center text-sm" style={{ color: "var(--cleaner-muted)" }}>
              No issued statements yet. Once ChezSoiStays Ops finalizes your first month, it will appear here.
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {statements.map((s) => (
              <Link
                key={s._id}
                href={`/owner/properties/${propertyId}/statements/${s._id}`}
                className="flex items-center justify-between rounded-2xl p-4 transition"
                style={{
                  background: "var(--cleaner-surface)",
                  border: "1px solid rgba(0,0,0,0.06)",
                }}
              >
                <div>
                  <div style={{ fontWeight: 500 }}>
                    {fmtDate(s.periodStart)} – {fmtDate(s.periodEnd - 1)}
                  </div>
                  <div className="text-xs" style={{ color: "var(--cleaner-muted)" }}>
                    Issued {s.issuedAt ? fmtDate(s.issuedAt) : "—"}
                    {!s.pdfStorageId && " · PDF generating"}
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className="text-lg tabular-nums"
                    style={{
                      fontFamily: "var(--font-cleaner-mono)",
                      fontWeight: 700,
                    }}
                  >
                    {fmtMoney(s.ownerPayout, currency)}
                  </div>
                  <div
                    className="text-[10px]"
                    style={{
                      fontFamily: "var(--font-cleaner-mono)",
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "var(--cleaner-muted)",
                    }}
                  >
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

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="px-3 py-2 text-sm transition"
      style={{
        color: active ? "var(--cleaner-ink)" : "var(--cleaner-muted)",
        borderBottom: active ? "2px solid var(--cleaner-primary)" : "2px solid transparent",
        fontWeight: active ? 600 : 400,
        marginBottom: "-1px",
      }}
    >
      {children}
    </Link>
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
        className="mt-1 text-xl tabular-nums"
        style={{
          fontFamily: "var(--font-cleaner-mono)",
          fontWeight: accent ? 700 : 400,
          color: accent ? "var(--cleaner-primary)" : "var(--cleaner-ink)",
        }}
      >
        {value}
      </div>
      {subtitle && (
        <div
          className="mt-0.5 text-[10px]"
          style={{
            fontFamily: "var(--font-cleaner-mono)",
            color: "var(--cleaner-muted)",
          }}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
}

function Card({
  children,
  padding = "p-6",
  style,
}: {
  children: React.ReactNode;
  padding?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`rounded-3xl ${padding}`}
      style={{
        background: "var(--cleaner-surface)",
        boxShadow: "var(--cleaner-shadow)",
        border: "1px solid rgba(0,0,0,0.06)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Skeleton() {
  return (
    <div
      className="h-64 animate-pulse rounded-3xl"
      style={{ background: "var(--cleaner-surface)" }}
    />
  );
}
