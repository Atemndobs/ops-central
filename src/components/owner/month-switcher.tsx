"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { fmtMonth } from "./owner-format";

/**
 * Month switcher used by both the owner dashboard AND the per-property
 * detail page. The owner needs to navigate months everywhere — the
 * primary mental model of "this month vs last month" should follow them
 * across every drill-in.
 *
 * Pure presentation: month-in, callback-out. Parent owns the URL/state
 * wiring (typically via `useMonthFromUrl`). LIVE/PAST/FUTURE badge is
 * derived from comparison to the system's current month.
 */
export function MonthSwitcher({
  month,
  onMonthChange,
  minMonth,
}: {
  month: string;
  onMonthChange: (m: string) => void;
  /** Optional floor — usually the property's first-activity month so
   *  users can't page back into months that pre-date the property's
   *  presence on the platform. Inclusive: month === minMonth → ← disabled. */
  minMonth?: string;
}) {
  const cur = currentMonthKey();
  const isCurrent = month === cur;
  const atMin = minMonth !== undefined && month <= minMonth;
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onMonthChange(shiftMonth(month, -1))}
        disabled={atMin}
        className="rounded-md p-1.5 hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
        aria-label="Previous month"
        title={atMin ? "No earlier data for this property" : "Previous month"}
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
  );
}

// ─── Date helpers ───────────────────────────────────────────────────────────

export function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1).toString().padStart(2, "0")}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1).toString().padStart(2, "0")}`;
}
