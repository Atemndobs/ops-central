"use client";

import { Fragment, useState } from "react";
import type { PortfolioReport } from "@convex/strCosts/costMath";
import { formatCurrency, formatPct } from "./lib/format";
import { Input, Button, Label } from "./ui";
import { ChevronDown, ChevronRight } from "lucide-react";

type ActualVals = { grossRevenue: number; bookingCount: number; bookedNights: number };
type RowActualState = { revenue: string; bookings: string; nights: string };

function formatDelta(d: number): string {
  return (d >= 0 ? "+" : "-") + formatCurrency(Math.abs(d));
}

const TH = "h-10 px-2 text-right align-middle font-semibold text-[#c9a84c]";
const TD = "p-2 align-middle";

export function MonthlyPnlTable({
  report,
  compareReport,
  onSaveActual,
}: {
  report: PortfolioReport;
  compareReport?: PortfolioReport;
  onSaveActual?: (propertyId: string, vals: ActualVals) => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rowActuals, setRowActuals] = useState<Record<string, RowActualState>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const hasCompare = compareReport !== undefined;
  const detailColSpan = hasCompare ? 9 : 8;

  function initRowActual(rowId: string, revenue: number, bookingCount: number) {
    setRowActuals((prev) => {
      if (prev[rowId]) return prev;
      return {
        ...prev,
        [rowId]: { revenue: String(revenue), bookings: String(bookingCount), nights: "0" },
      };
    });
  }

  function handleExpand(rowId: string, revenue: number, bookingCount: number) {
    const next = expanded === rowId ? null : rowId;
    setExpanded(next);
    if (next) initRowActual(rowId, revenue, bookingCount);
  }

  async function handleSave(rowId: string) {
    if (!onSaveActual) return;
    const state = rowActuals[rowId];
    if (!state) return;
    setSaving(rowId);
    try {
      await onSaveActual(rowId, {
        grossRevenue: Number(state.revenue),
        bookingCount: Number(state.bookings),
        bookedNights: Number(state.nights),
      });
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-2">
      {report.excluded.length > 0 && (
        <p className="text-sm text-[var(--muted-foreground)]">
          {report.excluded.length} unit(s) excluded (dropped/managed)
        </p>
      )}

      <div className="overflow-x-auto rounded-md border border-[var(--border)]">
        <table className="w-full caption-bottom text-sm">
          <thead>
            <tr className="bg-[#0a1628] text-[#c9a84c]">
              <th className={`${TH} text-left`}>Property</th>
              <th className={TH}>Revenue</th>
              <th className={TH}>Bookings</th>
              <th className={TH}>Cleaning</th>
              <th className={TH}>Fixed</th>
              <th className={TH}>Total Cost</th>
              <th className={TH}>Net</th>
              <th className={TH}>Margin %</th>
              {hasCompare && <th className={TH}>Δ Net (vs prev)</th>}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => {
              const cleaning = row.bucketTotals.cleaning ?? 0;
              const fixed = row.costs - cleaning;
              const netColor = row.net >= 0 ? "text-emerald-600" : "text-red-600";
              const isExpanded = expanded === row.id;
              const rowMuted = !row.hasData;

              const prevRow = hasCompare ? compareReport.rows.find((r) => r.id === row.id) : undefined;
              const delta = prevRow !== undefined ? row.net - prevRow.net : null;
              const deltaColor =
                delta === null ? "" : delta >= 0 ? "text-emerald-600" : "text-red-600";

              return (
                <Fragment key={row.id}>
                  <tr
                    className={`cursor-pointer border-t border-[var(--border)] hover:bg-[var(--muted)]${
                      rowMuted ? " text-[var(--muted-foreground)] opacity-60" : ""
                    }`}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    onClick={() => handleExpand(row.id, row.revenue, row.bookingCount)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleExpand(row.id, row.revenue, row.bookingCount);
                      }
                    }}
                  >
                    <td className={`${TD} text-left font-medium`}>
                      <span className="inline-flex flex-wrap items-center gap-1">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
                        )}
                        {row.name}
                        {rowMuted && (
                          <span className="ml-1 text-xs font-normal italic text-[var(--muted-foreground)]">
                            No data — import or enter
                          </span>
                        )}
                      </span>
                    </td>
                    <td className={`${TD} text-right`}>{formatCurrency(row.revenue)}</td>
                    <td className={`${TD} text-right`}>{row.bookingCount}</td>
                    <td className={`${TD} text-right`}>{formatCurrency(cleaning)}</td>
                    <td className={`${TD} text-right`}>{formatCurrency(fixed)}</td>
                    <td className={`${TD} text-right`}>{formatCurrency(row.costs)}</td>
                    <td className={`${TD} text-right font-semibold ${netColor}`}>{formatCurrency(row.net)}</td>
                    <td className={`${TD} text-right`}>{formatPct(row.marginPercent)}</td>
                    {hasCompare && (
                      <td className={`${TD} text-right font-semibold ${deltaColor}`}>
                        {delta === null ? "—" : formatDelta(delta)}
                      </td>
                    )}
                  </tr>

                  {isExpanded && (
                    <tr className="bg-[var(--muted)]">
                      <td colSpan={detailColSpan} className="px-6 py-3">
                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-[var(--muted-foreground)]">
                          <span>
                            <span className="font-medium text-[var(--foreground)]">Lease:</span>{" "}
                            {formatCurrency(row.bucketTotals.lease ?? 0)}
                          </span>
                          <span>
                            <span className="font-medium text-[var(--foreground)]">Utilities:</span>{" "}
                            {formatCurrency(row.bucketTotals.utilities ?? 0)}
                          </span>
                          <span>
                            <span className="font-medium text-[var(--foreground)]">Cleaning:</span>{" "}
                            {formatCurrency(row.bucketTotals.cleaning ?? 0)}
                          </span>
                          <span>
                            <span className="font-medium text-[var(--foreground)]">Payouts:</span>{" "}
                            {formatCurrency(row.bucketTotals.payouts ?? 0)}
                          </span>
                          <span>
                            <span className="font-medium text-[var(--foreground)]">Subscriptions:</span>{" "}
                            {formatCurrency(row.bucketTotals.subscriptions ?? 0)}
                          </span>
                          <span>
                            <span className="font-medium text-[var(--foreground)]">Other:</span>{" "}
                            {formatCurrency(row.bucketTotals.other ?? 0)}
                          </span>
                          {(row.bucketTotals.unassigned ?? 0) > 0 && (
                            <span>
                              <span className="font-medium text-[var(--foreground)]">Unassigned:</span>{" "}
                              {formatCurrency(row.bucketTotals.unassigned ?? 0)}
                            </span>
                          )}
                        </div>

                        {onSaveActual && rowActuals[row.id] && (
                          <div className="mt-4 border-t border-[var(--border)] pt-3">
                            <p className="mb-2 text-xs font-semibold text-[var(--foreground)]">
                              Off-platform / manual actuals (overrides Hospitable for this month)
                            </p>
                            <div className="flex flex-wrap items-end gap-3">
                              <div className="flex flex-col gap-1">
                                <Label htmlFor={`rev-${row.id}`} className="text-xs">
                                  Revenue ($)
                                </Label>
                                <Input
                                  id={`rev-${row.id}`}
                                  type="number"
                                  className="h-7 w-28 text-sm"
                                  value={rowActuals[row.id].revenue}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) =>
                                    setRowActuals((prev) => ({
                                      ...prev,
                                      [row.id]: { ...prev[row.id], revenue: e.target.value },
                                    }))
                                  }
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <Label htmlFor={`bk-${row.id}`} className="text-xs">
                                  Bookings
                                </Label>
                                <Input
                                  id={`bk-${row.id}`}
                                  type="number"
                                  className="h-7 w-20 text-sm"
                                  value={rowActuals[row.id].bookings}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) =>
                                    setRowActuals((prev) => ({
                                      ...prev,
                                      [row.id]: { ...prev[row.id], bookings: e.target.value },
                                    }))
                                  }
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <Label htmlFor={`nt-${row.id}`} className="text-xs">
                                  Nights
                                </Label>
                                <Input
                                  id={`nt-${row.id}`}
                                  type="number"
                                  className="h-7 w-20 text-sm"
                                  value={rowActuals[row.id].nights}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) =>
                                    setRowActuals((prev) => ({
                                      ...prev,
                                      [row.id]: { ...prev[row.id], nights: e.target.value },
                                    }))
                                  }
                                />
                              </div>
                              <Button
                                size="sm"
                                className="h-7"
                                disabled={saving === row.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleSave(row.id);
                                }}
                              >
                                {saving === row.id ? "Saving…" : "Save"}
                              </Button>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}

            {/* Portfolio total row */}
            <tr className="border-t-2 border-[var(--border)] bg-[var(--muted)] font-semibold">
              <td className={`${TD} text-left text-xs font-bold uppercase tracking-wider`}>Portfolio Total</td>
              <td className={`${TD} text-right font-bold`}>{formatCurrency(report.revenueGross)}</td>
              <td className={`${TD} text-right text-[var(--muted-foreground)]`}>—</td>
              <td className={`${TD} text-right`}>{formatCurrency(report.bucketTotals.cleaning ?? 0)}</td>
              <td className={`${TD} text-right`}>
                {formatCurrency(report.totalCosts - (report.bucketTotals.cleaning ?? 0))}
              </td>
              <td className={`${TD} text-right font-bold`}>{formatCurrency(report.totalCosts)}</td>
              <td
                className={`${TD} text-right font-bold ${
                  report.netProfit >= 0 ? "text-emerald-600" : "text-red-600"
                }`}
              >
                {formatCurrency(report.netProfit)}
              </td>
              <td className={`${TD} text-right font-bold`}>{formatPct(report.marginPercent)}</td>
              {hasCompare &&
                (() => {
                  const totalDelta = report.netProfit - compareReport.netProfit;
                  const totalDeltaColor = totalDelta >= 0 ? "text-emerald-600" : "text-red-600";
                  return (
                    <td className={`${TD} text-right font-bold ${totalDeltaColor}`}>{formatDelta(totalDelta)}</td>
                  );
                })()}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
