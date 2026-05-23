"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import {
  ArrowRight,
  Bell,
  Building2,
  ChevronLeft,
  ChevronRight,
  FileText,
  LayoutGrid,
  Rows3,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import { fmtMoney, fmtMonth } from "./owner-format";

/**
 * Owner dashboard. Two view modes (card / list) — list scales to 30+
 * properties; card is the YC-demo aesthetic. Month picker lets the
 * owner page through history (already-issued statements) or peek
 * ahead at next month's draft.
 */
export function OwnerDashboardClient() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [viewMode, setViewMode] = useState<"card" | "list">("card");
  const [month, setMonth] = useState<string>(currentMonthKey());

  const dashboard = useQuery(
    api.owner.queries.getOwnerDashboard,
    isAuthenticated ? { month } : "skip",
  );

  if (isLoading || dashboard === undefined) return <SkeletonCard />;

  if (dashboard.mode === "no_properties") {
    return (
      <div
        className="rounded-2xl border border-black/[0.06] p-12 text-center"
        style={{ background: "var(--cleaner-surface)" }}
      >
        <Building2 size={32} className="mx-auto mb-3" style={{ color: "var(--cleaner-muted)" }} />
        <p className="text-lg" style={{ fontFamily: "var(--font-cleaner-display)", fontWeight: 700 }}>
          No properties yet
        </p>
        <p className="mt-2 text-sm" style={{ color: "var(--cleaner-muted)" }}>
          You&apos;ll see your properties here once they&apos;re added.
          Contact ChezSoiStays Operations.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1
          className="text-3xl tracking-tight"
          style={{ fontFamily: "var(--font-cleaner-display)", fontWeight: 700 }}
        >
          Welcome back{dashboard.user.name ? `, ${dashboard.user.name.split(" ")[0]}` : ""}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--cleaner-muted)" }}>
          {dashboard.mode === "single"
            ? "Your property at a glance."
            : `${dashboard.properties.length} properties — your portfolio at a glance.`}
        </p>
      </div>

      <Toolbar
        month={month}
        onMonthChange={setMonth}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      {viewMode === "card" ? (
        <CardView properties={dashboard.properties} />
      ) : (
        <ListView properties={dashboard.properties} />
      )}
    </div>
  );
}

type PropertyRow = {
  propertyId: string;
  propertyName: string;
  propertyImage: string | null;
  currency: string;
  currentMonth: string;
  pendingApprovalCount: number;
  issuedStatementId: string | null;
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

// ─── Toolbar (month picker + view toggle) ──────────────────────────────────

function Toolbar({
  month,
  onMonthChange,
  viewMode,
  onViewModeChange,
}: {
  month: string;
  onMonthChange: (m: string) => void;
  viewMode: "card" | "list";
  onViewModeChange: (m: "card" | "list") => void;
}) {
  const cur = currentMonthKey();
  const isCurrent = month === cur;
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => onMonthChange(shiftMonth(month, -1))}
          className="rounded-md p-1.5 hover:bg-black/[0.04]"
          aria-label="Previous month"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="flex items-baseline gap-2">
          <span
            className="text-lg"
            style={{ fontFamily: "var(--font-cleaner-display)", fontWeight: 700 }}
          >
            {fmtMonth(month)}
          </span>
          {isCurrent ? (
            <span
              className="rounded-full px-2 py-0.5 text-[10px]"
              style={{
                background: "rgba(155,81,224,0.12)",
                color: "var(--cleaner-primary)",
                fontFamily: "var(--font-cleaner-mono)",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              Live
            </span>
          ) : month < cur ? (
            <span
              className="rounded-full px-2 py-0.5 text-[10px]"
              style={{
                background: "var(--cleaner-bg)",
                color: "var(--cleaner-muted)",
                fontFamily: "var(--font-cleaner-mono)",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              Past
            </span>
          ) : (
            <span
              className="rounded-full px-2 py-0.5 text-[10px]"
              style={{
                background: "var(--cleaner-bg)",
                color: "var(--cleaner-muted)",
                fontFamily: "var(--font-cleaner-mono)",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              Future
            </span>
          )}
        </div>
        <button
          onClick={() => onMonthChange(shiftMonth(month, 1))}
          className="rounded-md p-1.5 hover:bg-black/[0.04]"
          aria-label="Next month"
        >
          <ChevronRight size={16} />
        </button>
        {!isCurrent && (
          <button
            onClick={() => onMonthChange(cur)}
            className="ml-1 text-xs hover:underline"
            style={{ color: "var(--cleaner-muted)" }}
          >
            today
          </button>
        )}
      </div>

      <div
        className="flex items-center rounded-lg border border-black/[0.06] p-0.5"
        style={{ background: "var(--cleaner-surface)" }}
      >
        <button
          onClick={() => onViewModeChange("card")}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs"
          style={{
            background: viewMode === "card" ? "var(--cleaner-bg)" : "transparent",
            color: viewMode === "card" ? "var(--cleaner-ink)" : "var(--cleaner-muted)",
          }}
        >
          <LayoutGrid size={12} /> Cards
        </button>
        <button
          onClick={() => onViewModeChange("list")}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs"
          style={{
            background: viewMode === "list" ? "var(--cleaner-bg)" : "transparent",
            color: viewMode === "list" ? "var(--cleaner-ink)" : "var(--cleaner-muted)",
          }}
        >
          <Rows3 size={12} /> List
        </button>
      </div>
    </div>
  );
}

// ─── Card view (existing, slightly tightened) ──────────────────────────────

function CardView({ properties }: { properties: PropertyRow[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {properties.map((p) => (
        <PropertyCard key={p.propertyId} p={p} />
      ))}
    </div>
  );
}

function PropertyCard({ p }: { p: PropertyRow }) {
  const totals = "totals" in p.draft ? p.draft.totals : null;
  const hasError = totals === null;
  const isPaid = p.issuedStatementId !== null;

  return (
    <Link
      href={`/owner/properties/${p.propertyId}`}
      className="group relative flex flex-col gap-4 rounded-2xl border border-black/[0.06] p-6 transition hover:border-[var(--cleaner-primary)]/40 hover:shadow-sm"
      style={{ background: "var(--cleaner-surface)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2
            className="text-xl tracking-tight"
            style={{ fontFamily: "var(--font-cleaner-display)", fontWeight: 700 }}
          >
            {p.propertyName}
          </h2>
          <p
            className="mt-0.5 text-[10px] uppercase tracking-wider"
            style={{ color: "var(--cleaner-muted)", fontFamily: "var(--font-cleaner-mono)" }}
          >
            {fmtMonth(p.currentMonth)} — {isPaid ? "paid out" : "in progress"}
          </p>
        </div>
        {p.pendingApprovalCount > 0 && (
          <Link
            href={`/owner/properties/${p.propertyId}/approvals`}
            className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs"
            style={{
              background: "var(--color-amber-100,#fef3c7)",
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
          <div className="grid grid-cols-3 gap-4 border-t border-black/[0.04] pt-4">
            <Stat label="Gross" value={fmtMoney(totals!.grossRevenue, p.currency)} muted />
            <Stat label="Mgmt fee" value={fmtMoney(-totals!.mgmtFee, p.currency)} muted />
            <Stat
              label={isPaid ? "Paid out" : "Your payout"}
              value={fmtMoney(totals!.ownerPayout, p.currency)}
              accent
            />
          </div>
          <p
            className="text-xs"
            style={{ color: "var(--cleaner-muted)", fontFamily: "var(--font-cleaner-mono)" }}
          >
            Fee formula: {(totals!.feePct * 100).toFixed(1)}% × {totals!.feeBase}
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

// ─── List view (scales to 30+) ─────────────────────────────────────────────

function ListView({ properties }: { properties: PropertyRow[] }) {
  // Sort by ownerPayout desc, errors last
  const sorted = useMemo(() => {
    return [...properties].sort((a, b) => {
      const aOk = "totals" in a.draft ? a.draft.totals.ownerPayout : -Infinity;
      const bOk = "totals" in b.draft ? b.draft.totals.ownerPayout : -Infinity;
      return bOk - aOk;
    });
  }, [properties]);

  return (
    <div
      className="overflow-hidden rounded-2xl border border-black/[0.06]"
      style={{ background: "var(--cleaner-surface)" }}
    >
      <table className="w-full text-sm">
        <thead>
          <tr style={{ background: "var(--cleaner-bg)" }}>
            <Th>Property</Th>
            <Th align="right">Gross</Th>
            <Th align="right">Mgmt fee</Th>
            <Th align="right">Your payout</Th>
            <Th align="center">Status</Th>
            <Th align="center">Action</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => {
            const totals = "totals" in p.draft ? p.draft.totals : null;
            return (
              <tr
                key={p.propertyId}
                className={i > 0 ? "border-t border-black/[0.04]" : ""}
              >
                <Td>
                  <Link
                    href={`/owner/properties/${p.propertyId}`}
                    className="hover:underline"
                    style={{ fontWeight: 500 }}
                  >
                    {p.propertyName}
                  </Link>
                  {p.pendingApprovalCount > 0 && (
                    <span
                      className="ml-2 rounded-full px-1.5 py-0.5 text-[10px]"
                      style={{
                        background: "var(--color-amber-100,#fef3c7)",
                        color: "var(--color-amber-900,#8a4a00)",
                      }}
                    >
                      {p.pendingApprovalCount} pending
                    </span>
                  )}
                </Td>
                <Td align="right" mono muted={totals === null}>
                  {totals ? fmtMoney(totals.grossRevenue, p.currency) : "—"}
                </Td>
                <Td align="right" mono muted={totals === null}>
                  {totals ? fmtMoney(-totals.mgmtFee, p.currency) : "—"}
                </Td>
                <Td align="right" mono bold>
                  {totals ? fmtMoney(totals.ownerPayout, p.currency) : "—"}
                </Td>
                <Td align="center">
                  {totals === null ? (
                    <Badge tone="error">error</Badge>
                  ) : p.issuedStatementId ? (
                    <Badge tone="success">paid out</Badge>
                  ) : (
                    <Badge tone="info">in progress</Badge>
                  )}
                </Td>
                <Td align="center">
                  <Link
                    href={`/owner/properties/${p.propertyId}`}
                    className="text-xs hover:underline"
                    style={{ color: "var(--cleaner-primary)" }}
                  >
                    View →
                  </Link>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" | "center" }) {
  return (
    <th
      className="px-4 py-2.5 text-[10px] uppercase tracking-wider"
      style={{
        textAlign: align,
        color: "var(--cleaner-muted)",
        fontFamily: "var(--font-cleaner-mono)",
        fontWeight: 500,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  mono,
  bold,
  muted,
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
  mono?: boolean;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className="px-4 py-3"
      style={{
        textAlign: align,
        fontFamily: mono ? "var(--font-cleaner-mono)" : undefined,
        fontVariantNumeric: mono ? "tabular-nums" : undefined,
        fontWeight: bold ? 700 : undefined,
        color: muted ? "var(--cleaner-muted)" : undefined,
      }}
    >
      {children}
    </td>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "info" | "success" | "error" }) {
  const palette = {
    info: { bg: "rgba(155,81,224,0.12)", fg: "var(--cleaner-primary)" },
    success: { bg: "rgba(34,197,94,0.12)", fg: "rgb(21,128,61)" },
    error: { bg: "rgba(239,68,68,0.12)", fg: "rgb(153,27,27)" },
  }[tone];
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px]"
      style={{
        background: palette.bg,
        color: palette.fg,
        fontFamily: "var(--font-cleaner-mono)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
  );
}

// ─── Shared bits ────────────────────────────────────────────────────────────

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
      <div
        className="text-[10px] uppercase tracking-wider"
        style={{ color: "var(--cleaner-muted)", fontFamily: "var(--font-cleaner-mono)" }}
      >
        {label}
      </div>
      <div
        className="mt-1 text-base tabular-nums"
        style={{
          fontFamily: "var(--font-cleaner-mono)",
          fontWeight: accent ? 700 : muted ? 400 : 500,
          color: accent ? "var(--cleaner-primary)" : muted ? "var(--cleaner-muted)" : undefined,
        }}
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
          className="h-48 animate-pulse rounded-2xl border border-black/[0.06]"
          style={{ background: "var(--cleaner-surface)" }}
        />
      ))}
    </div>
  );
}

// ─── Date helpers ───────────────────────────────────────────────────────────

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1).toString().padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1).toString().padStart(2, "0")}`;
}
