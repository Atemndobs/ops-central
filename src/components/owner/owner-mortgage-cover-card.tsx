"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { CheckCircle2, AlertTriangle, TrendingUp, Calendar } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { fmtDate, fmtMonth, fmtMoney } from "./owner-format";

/**
 * The pitch surface: "by day X you'd already have made the
 * lease/mortgage." Lives prominently on the property page above the Live
 * Draft section so owners see the cover status at a glance.
 *
 * Reads `bucket="lease"` from the fee engine as the monthly obligation
 * — no separate mortgage field. Owners see THEIR share (stake × total).
 * Cover threshold = ownerPayout (after mgmt fee) — most defensible.
 */
export function OwnerMortgageCoverCard({
  propertyId,
  currency,
  month,
}: {
  propertyId: Id<"properties">;
  currency: string;
  month: string;
}) {
  const { isAuthenticated } = useConvexAuth();
  const coverage = useQuery(
    api.owner.queries.getOwnerMortgageCoverage,
    isAuthenticated ? { propertyId, month } : "skip",
  );
  const history = useQuery(
    api.owner.queries.getOwnerCoverageHistory,
    // Strip now walks every month since the property's first Hospitable
    // booking through the last fully-completed month (the current month
    // is shown live on the meter above). No monthsBack arg.
    isAuthenticated ? { propertyId } : "skip",
  );

  if (coverage === undefined) {
    return (
      <div
        className="h-32 animate-pulse rounded-3xl"
        style={{ background: "var(--cleaner-surface)" }}
      />
    );
  }
  if (coverage.status === "no_obligation") return null; // hidden when lease=0
  if (coverage.status === "engine_error") return null; // dashboard already shows the error

  return (
    <section
      className="rounded-3xl p-6"
      style={{
        background: "var(--cleaner-surface)",
        boxShadow: "var(--cleaner-shadow)",
        border: "1px solid rgba(0,0,0,0.06)",
      }}
    >
      <CoverHeader coverage={coverage} currency={currency} month={month} />
      <ProgressBar coverage={coverage} />
      <CoverDetails coverage={coverage} currency={currency} />
      {history && history.summary.sampledMonths > 0 && (
        <>
          <Divider />
          <HistoryStrip history={history} currency={currency} />
          <ConfidenceLine history={history} currency={currency} />
        </>
      )}
    </section>
  );
}

// ─── Header (the headline state) ────────────────────────────────────────────

type Coverage = NonNullable<
  ReturnType<typeof useQuery<typeof api.owner.queries.getOwnerMortgageCoverage>>
>;

function CoverHeader({
  coverage,
  currency,
  month,
}: {
  coverage: Coverage;
  currency: string;
  month: string;
}) {
  const monthLabel = fmtMonth(month);

  // Single neutral framing per spec: "Earnings summary". The status
  // still drives the icon + tint so the at-a-glance signal stays, but
  // we drop the alarming "Projected shortfall" / triumphant "Lease
  // covered ✓" headlines in favour of a consistent section title with
  // a short factual subtitle.
  const tint: { bg: string; icon: React.ReactNode } =
    coverage.status === "covered"
      ? {
          bg: "rgba(34,197,94,0.15)",
          icon: <CheckCircle2 size={22} color="rgb(21,128,61)" />,
        }
      : coverage.status === "on_track"
        ? {
            bg: "rgba(155,81,224,0.15)",
            icon: <TrendingUp size={22} color="var(--cleaner-primary)" />,
          }
        : {
            bg: "rgba(245,158,11,0.15)",
            icon: <AlertTriangle size={22} color="rgb(180,83,9)" />,
          };

  let subtitle: React.ReactNode;
  if (coverage.status === "covered") {
    subtitle = coverage.isCurrentMonth ? (
      <>
        {monthLabel} lease covered by{" "}
        <span style={{ color: "var(--cleaner-ink)", fontWeight: 600 }}>
          {fmtDate(coverage.coveredOn)}
        </span>
        {" — "}
        <span style={{ color: "var(--cleaner-ink)", fontWeight: 600 }}>
          {fmtMoney(coverage.amountAhead, currency)} ahead
        </span>
        .
      </>
    ) : (
      <>
        {monthLabel} lease covered — {fmtMoney(coverage.amountAhead, currency)} ahead.
      </>
    );
  } else if (coverage.status === "on_track") {
    subtitle = (
      <>
        On track to cover {monthLabel} lease by{" "}
        <span style={{ color: "var(--cleaner-ink)", fontWeight: 600 }}>
          {fmtDate(coverage.projectedCoverDay)}
        </span>
        .
      </>
    );
  } else {
    // shortfall — describe earnings vs lease, no scary headline number.
    const short = ("projectedShortfall" in coverage ? coverage.projectedShortfall : 0) ?? 0;
    subtitle = coverage.isCurrentMonth
      ? `${monthLabel} earnings on pace to fall ${fmtMoney(short, currency)} short of the lease.`
      : `${monthLabel} earnings fell ${fmtMoney(short, currency)} short of the lease.`;
  }

  return (
    <div className="mb-4 flex items-start gap-3">
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        style={{ background: tint.bg }}
      >
        {tint.icon}
      </div>
      <div>
        <h2
          className="text-xl tracking-tight"
          style={{ fontFamily: "var(--font-cleaner-display)", fontWeight: 700 }}
        >
          Earnings summary
        </h2>
        <p className="mt-0.5 text-sm" style={{ color: "var(--cleaner-muted)" }}>
          {subtitle}
        </p>
      </div>
    </div>
  );
}

// ─── Progress bar with mortgage milestone ──────────────────────────────────

function ProgressBar({ coverage }: { coverage: Coverage }) {
  if (coverage.status !== "covered" && coverage.status !== "on_track" && coverage.status !== "shortfall") {
    return null;
  }
  const obligation = coverage.obligation;
  const paid = coverage.payoutToDate;
  const projected = "projectedPayout" in coverage ? coverage.projectedPayout : 0;
  const max = Math.max(obligation, projected, paid);
  const paidPct = max > 0 ? Math.min(100, (paid / max) * 100) : 0;
  const projectedPct = max > 0 ? Math.min(100, (projected / max) * 100) : 0;
  const obligationPct = max > 0 ? (obligation / max) * 100 : 100;

  return (
    <div className="relative mb-4 mt-2 h-3 w-full overflow-visible rounded-full" style={{ background: "var(--cleaner-bg)" }}>
      {/* Projected band (lighter) */}
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{
          width: `${projectedPct}%`,
          background:
            coverage.status === "covered"
              ? "rgba(34,197,94,0.25)"
              : coverage.status === "on_track"
                ? "rgba(155,81,224,0.25)"
                : "rgba(245,158,11,0.25)",
        }}
      />
      {/* Paid bar (solid) */}
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{
          width: `${paidPct}%`,
          background:
            coverage.status === "covered"
              ? "rgb(34,197,94)"
              : coverage.status === "on_track"
                ? "var(--cleaner-primary)"
                : "rgb(245,158,11)",
        }}
      />
      {/* Mortgage milestone marker */}
      <div
        className="absolute inset-y-[-4px] w-[2px]"
        style={{
          left: `${obligationPct}%`,
          background: "rgba(0,0,0,0.6)",
        }}
        aria-label="Lease milestone"
      />
      <div
        className="absolute top-[-22px] -translate-x-1/2 whitespace-nowrap text-[10px]"
        style={{
          left: `${obligationPct}%`,
          fontFamily: "var(--font-cleaner-mono)",
          color: "var(--cleaner-muted)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        Lease
      </div>
    </div>
  );
}

// ─── Detail row under the bar ───────────────────────────────────────────────

function CoverDetails({ coverage, currency }: { coverage: Coverage; currency: string }) {
  if (
    coverage.status !== "covered" &&
    coverage.status !== "on_track" &&
    coverage.status !== "shortfall"
  ) {
    return null;
  }
  return (
    <div className="grid grid-cols-3 gap-4 text-xs">
      <DetailStat
        label="Lease (your share)"
        value={fmtMoney(coverage.obligation, currency)}
      />
      <DetailStat
        label={coverage.isCurrentMonth ? "Payout to date" : "Payout"}
        value={fmtMoney(coverage.payoutToDate, currency)}
        emphasis={coverage.status === "covered"}
      />
      <DetailStat
        label={coverage.isCurrentMonth ? "Projected total" : "Final"}
        value={fmtMoney(coverage.projectedPayout, currency)}
        emphasis={coverage.status !== "covered"}
      />
    </div>
  );
}

function DetailStat({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <div
        className="text-[10px] uppercase tracking-wider"
        style={{
          color: "var(--cleaner-muted)",
          fontFamily: "var(--font-cleaner-mono)",
        }}
      >
        {label}
      </div>
      <div
        className="mt-1 tabular-nums"
        style={{
          fontFamily: "var(--font-cleaner-mono)",
          fontWeight: emphasis ? 700 : 500,
          color: emphasis ? "var(--cleaner-ink)" : undefined,
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ─── 12-month coverage strip ───────────────────────────────────────────────

function HistoryStrip({
  history,
  currency,
}: {
  history: NonNullable<
    ReturnType<typeof useQuery<typeof api.owner.queries.getOwnerCoverageHistory>>
  >;
  currency: string;
}) {
  return (
    <div className="mb-3">
      <div
        className="mb-2 text-[10px] uppercase tracking-wider"
        style={{
          color: "var(--cleaner-muted)",
          fontFamily: "var(--font-cleaner-mono)",
        }}
      >
        <Calendar size={10} className="mr-1 inline" />
        Past 12 months
      </div>
      <div className="flex flex-wrap gap-1.5">
        {history.months.map((m) => (
          <HistoryTile key={m.month} m={m} currency={currency} />
        ))}
      </div>
    </div>
  );
}

function HistoryTile({
  m,
  currency,
}: {
  m: {
    month: string;
    status: "covered" | "shortfall" | "no_obligation" | "engine_error";
    obligation: number;
    payout: number;
  };
  currency: string;
}) {
  const palette =
    m.status === "covered"
      ? { bg: "rgba(34,197,94,0.25)", fg: "rgb(21,128,61)" }
      : m.status === "shortfall"
        ? { bg: "rgba(245,158,11,0.25)", fg: "rgb(180,83,9)" }
        : { bg: "var(--cleaner-bg)", fg: "var(--cleaner-muted)" };

  const tooltip =
    m.status === "no_obligation"
      ? `${fmtMonth(m.month)} — no lease configured`
      : m.status === "engine_error"
        ? `${fmtMonth(m.month)} — calc error`
        : `${fmtMonth(m.month)} — ${fmtMoney(m.payout, currency)} payout vs ${fmtMoney(
            m.obligation,
            currency,
          )} lease`;

  return (
    <div
      title={tooltip}
      className="flex h-9 w-12 cursor-help flex-col items-center justify-center rounded-md"
      style={{
        background: palette.bg,
        color: palette.fg,
        fontFamily: "var(--font-cleaner-mono)",
        fontSize: 10,
      }}
    >
      <div style={{ fontWeight: 700 }}>{shortMonthLabel(m.month)}</div>
      <div style={{ opacity: 0.7, fontSize: 9 }}>
        {m.status === "covered" ? "✓" : m.status === "shortfall" ? "—" : "·"}
      </div>
    </div>
  );
}

function shortMonthLabel(monthKey: string): string {
  const [y, mo] = monthKey.split("-");
  const d = new Date(Date.UTC(Number(y), Number(mo) - 1, 1));
  return d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
}

// ─── Confidence line: avg + streak + cover ratio ───────────────────────────

function ConfidenceLine({
  history,
  currency,
}: {
  history: NonNullable<
    ReturnType<typeof useQuery<typeof api.owner.queries.getOwnerCoverageHistory>>
  >;
  currency: string;
}) {
  const { summary } = history;
  const buffer = summary.avgBuffer;
  const bufferLabel =
    buffer >= 0
      ? `${fmtMoney(buffer, currency)} buffer`
      : `${fmtMoney(-buffer, currency)} short`;

  return (
    <p
      className="text-xs"
      style={{
        color: "var(--cleaner-muted)",
        fontFamily: "var(--font-cleaner-mono)",
      }}
    >
      {summary.coveredCount} of {summary.sampledMonths} months covered
      {summary.streak > 0 && (
        <span style={{ color: "var(--cleaner-primary)", fontWeight: 700 }}>
          {" · "}
          {summary.streak}-month streak
        </span>
      )}
      {" · avg "}
      <span style={{ color: "var(--cleaner-ink)", fontWeight: 700 }}>
        {fmtMoney(summary.avgPayout, currency)}
      </span>
      {" vs "}
      {fmtMoney(summary.avgObligation, currency)}{" "}
      <span
        style={{
          color: buffer >= 0 ? "rgb(21,128,61)" : "rgb(180,83,9)",
          fontWeight: 700,
        }}
      >
        ({bufferLabel})
      </span>
    </p>
  );
}

function Divider() {
  return (
    <div
      className="my-5 h-px"
      style={{ background: "rgba(0,0,0,0.06)" }}
    />
  );
}
