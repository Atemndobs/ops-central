/**
 * Shared mortgage-coverage primitives — ONE source of truth for the math
 * AND for the visual. Anywhere the owner portal renders \"did we cover the
 * mortgage this period?\" must use these primitives, never re-implement.
 *
 * Owner mental model: \"the first dollar of revenue goes to the mortgage.\"
 * So progress is measured against GROSS REVENUE, not post-fee payout.
 * Once `grossRevenue >= obligation`, the property has covered its rent /
 * mortgage for the period; the surplus then funds operating costs + the
 * owner's profit.
 *
 * The math is intentionally trivial — the value of this module is the
 * shared contract (input shape, output shape, visual rendering) so the
 * dashboard mini-bar and the per-property indicator NEVER diverge.
 */

"use client";

import { fmtMoney } from "./owner-format";

export type CoverageResult = {
  /** progress / obligation, clamped to [0, +∞). NaN-safe (returns 0). */
  ratio: number;
  /** 0–100, clamped for visual progress bars. */
  pct: number;
  /** True when ratio ≥ 1 — \"mortgage covered\" celebration state. */
  covered: boolean;
  /** Three discrete UI states — sometimes the caller wants more nuance than just \"covered/not\". */
  status: "no_obligation" | "covered" | "partial" | "empty";
  /** Suggested foreground color (CSS) for the bar fill. */
  color: string;
};

/**
 * Pure math. No React, no formatting — just the numbers a UI needs.
 */
export function computeMortgageCoverage(
  grossRevenue: number,
  obligation: number,
): CoverageResult {
  if (obligation <= 0) {
    return {
      ratio: 0,
      pct: 0,
      covered: false,
      status: "no_obligation",
      color: "rgba(0,0,0,0.06)",
    };
  }
  const safeGross = Number.isFinite(grossRevenue) ? Math.max(0, grossRevenue) : 0;
  const ratio = safeGross / obligation;
  const pct = Math.min(100, Math.max(0, ratio * 100));
  const covered = ratio >= 1.0;
  const status: CoverageResult["status"] = covered
    ? "covered"
    : safeGross > 0
      ? "partial"
      : "empty";
  const color = covered
    ? "rgb(34,197,94)" // green-500
    : safeGross > 0
      ? "rgb(245,158,11)" // amber-500
      : "rgba(0,0,0,0.15)";
  return { ratio, pct, covered, status, color };
}

/**
 * Shared visual primitive — one bar, one header, one footer caption.
 * Variants:
 *   - `dense`  (default) → dashboard card mini-bar (h-1.5, compact pad)
 *   - `roomy`            → per-property indicator block (h-2.5, larger text)
 *
 * `obligation === 0` renders nothing — caller decides whether to hide the
 * whole tile or substitute a placeholder.
 */
export function MortgageCoverageBar({
  currency,
  grossRevenue,
  obligation,
  variant = "dense",
}: {
  currency: string;
  /** Gross revenue accrued so far in the period. */
  grossRevenue: number;
  /** Mortgage / lease obligation for the period. */
  obligation: number;
  variant?: "dense" | "roomy";
}) {
  const c = computeMortgageCoverage(grossRevenue, obligation);
  if (c.status === "no_obligation") return null;

  const roomy = variant === "roomy";
  const barHeight = roomy ? "h-2.5" : "h-1.5";
  const padding = roomy ? "p-0" : "rounded-lg border border-black/[0.04] p-3";
  const background = roomy ? undefined : "var(--cleaner-bg)";

  return (
    <div
      className={padding}
      style={background ? { background } : undefined}
    >
      <div
        className="flex items-baseline justify-between text-[10px]"
        style={{
          fontFamily: "var(--font-cleaner-mono)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--cleaner-muted)",
        }}
      >
        <span>Mortgage</span>
        {c.covered ? (
          <span
            style={{
              color: "rgb(21,128,61)", // green-700
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "none",
            }}
          >
            Covered ✓
          </span>
        ) : (
          <span
            style={{
              color: "var(--cleaner-ink)",
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "none",
            }}
          >
            {Math.round(c.pct)}%
          </span>
        )}
      </div>
      <div
        className={`mt-${roomy ? "2" : "1.5"} ${barHeight} w-full overflow-hidden rounded-full`}
        style={{ background: "rgba(0,0,0,0.06)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${c.pct}%`, background: c.color }}
        />
      </div>
      <div
        className="mt-1 text-[10px] tabular-nums"
        style={{
          fontFamily: "var(--font-cleaner-mono)",
          color: "var(--cleaner-muted)",
        }}
      >
        {fmtMoney(Math.min(grossRevenue, obligation), currency)} /{" "}
        {fmtMoney(obligation, currency)}
      </div>
    </div>
  );
}
