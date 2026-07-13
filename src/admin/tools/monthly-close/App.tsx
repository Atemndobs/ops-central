"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useConvex } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";
import {
  Button,
  Input,
  Label,
  Select,
  Switch,
  Modal,
  ModalTitle,
  ModalFooter,
} from "./ui";
import { HospitableCsvImport } from "./HospitableCsvImport";
import { MonthlyPnlTable } from "./MonthlyPnlTable";
import { ViewManager } from "./ViewManager";
import { portfolioReportToCsv } from "./lib/portfolioReportCsv";
import { buildStatementHtml } from "./statement/buildStatementHtml";
import { previousMonthOf } from "./lib/format";
import { formatDate } from "@/lib/tz";

const ALL_VIEWS_SENTINEL = "__all__";

// Current calendar month as "YYYY-MM" — the month being closed in real time.
function currentMonth(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

// Last 12 months as [{ value: "YYYY-MM", label: "Month YYYY" }]
function last12Months(): Array<{ value: string; label: string }> {
  const months: Array<{ value: string; label: string }> = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < 12; i++) {
    const y = d.getFullYear();
    const m = d.getMonth();
    months.push({
      value: `${y}-${String(m + 1).padStart(2, "0")}`,
      // Month label from calendar components — pin to UTC so the month never
      // shifts by the viewer's/app zone offset.
      label: formatDate(Date.UTC(y, m, 1), { month: "long", year: "numeric", timeZone: "UTC" }),
    });
    d.setMonth(d.getMonth() - 1);
  }
  return months;
}

/** "2026-06" → "June 2026" */
function formatPeriod(monthStr: string): string {
  const [y, m] = monthStr.split("-");
  if (!y || !m) return monthStr;
  return formatDate(Date.UTC(Number(y), Number(m) - 1, 1), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function MonthlyCloseApp() {
  const { showToast } = useToast();
  const convex = useConvex();
  const [month, setMonth] = useState<string>(currentMonth);
  const [importOpen, setImportOpen] = useState(false);
  const [compare, setCompare] = useState(false);

  // ── Export statement dialog state ──────────────────────────────────────────
  const [statementOpen, setStatementOpen] = useState(false);
  const [stmtClientName, setStmtClientName] = useState("");
  const [stmtDate, setStmtDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [stmtGenerating, setStmtGenerating] = useState(false);

  const setActual = useMutation(api.strCosts.mutations.setMonthlyActual);

  async function handleSaveActual(
    propertyId: string,
    vals: { grossRevenue: number; bookingCount: number; bookedNights: number },
  ) {
    await setActual({ propertyId: propertyId as Id<"properties">, month, ...vals });
    showToast(`Actuals updated for ${month}`, "success");
  }

  // ── View state ─────────────────────────────────────────────────────────────
  const views = useQuery(api.strCosts.views.listViews, {});
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [viewManagerOpen, setViewManagerOpen] = useState(false);

  const activeView = views?.find((v) => v._id === activeViewId) ?? null;
  const selectedPropertyIds = activeView?.propertyIds as Id<"properties">[] | undefined;

  // ── Report queries ──────────────────────────────────────────────────────────
  const report = useQuery(api.strCosts.portfolio.portfolioReport, {
    month,
    scope: "active",
    ...(selectedPropertyIds ? { propertyIds: selectedPropertyIds } : {}),
  });

  const prevReport = useQuery(
    api.strCosts.portfolio.portfolioReport,
    compare
      ? {
          month: previousMonthOf(month),
          scope: "active",
          ...(selectedPropertyIds ? { propertyIds: selectedPropertyIds } : {}),
        }
      : "skip",
  );

  const monthOptions = useMemo(() => last12Months(), []);

  // ── Handlers ────────────────────────────────────────────────────────────────
  function handleViewSelectChange(value: string) {
    setActiveViewId(value === ALL_VIEWS_SENTINEL ? null : value);
  }

  function handleExportCsv() {
    if (!report || report.rows.length === 0) return;
    const csv = portfolioReportToCsv(report);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `portfolio_${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`portfolio_${month}.csv downloaded.`, "success");
  }

  function handleOpenStatementDialog() {
    const viewClientName = views?.find((v) => v._id === activeViewId)?.clientName ?? "";
    setStmtClientName(viewClientName);
    setStmtDate(new Date().toISOString().slice(0, 10));
    setStatementOpen(true);
  }

  async function handleGenerateStatement() {
    if (!report) return;
    setStmtGenerating(true);
    try {
      const { properties } = await convex.query(api.strCosts.reports.portfolioStatementData, {
        month,
        ...(selectedPropertyIds ? { propertyIds: selectedPropertyIds } : {}),
      });
      const period = formatPeriod(month);
      const html = buildStatementHtml(
        { report, properties },
        {
          clientName: stmtClientName,
          period,
          // stmtDate is a YYYY-MM-DD date-input value (parsed as UTC midnight);
          // format in UTC so it shows the picked calendar day, not the prior one.
          statementDate: formatDate(new Date(stmtDate), {
            year: "numeric",
            month: "long",
            day: "numeric",
            timeZone: "UTC",
          }),
        },
      );
      const w = window.open("", "_blank");
      if (w) {
        w.document.write(html);
        w.document.close();
        w.focus();
      }
      showToast("Statement ready — review and click Print / Save as PDF.", "success");
      setStatementOpen(false);
    } catch (err) {
      showToast(`Generation failed: ${String(err)}`, "error");
    } finally {
      setStmtGenerating(false);
    }
  }

  const hasRows = report !== undefined && report.rows.length > 0;

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Month picker */}
        <Select value={month} onChange={(e) => setMonth(e.target.value)} className="w-44">
          {monthOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>

        {/* View selector */}
        <Select
          value={activeViewId ?? ALL_VIEWS_SENTINEL}
          onChange={(e) => handleViewSelectChange(e.target.value)}
          className="w-48"
        >
          <option value={ALL_VIEWS_SENTINEL}>All properties</option>
          {(views ?? []).map((v) => (
            <option key={v._id} value={v._id}>
              {v.name}
            </option>
          ))}
        </Select>

        <Button variant="outline" onClick={() => setViewManagerOpen(true)}>
          {activeView ? "Edit view…" : "New view…"}
        </Button>

        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-[var(--muted-foreground)]">
          <Switch checked={compare} onCheckedChange={setCompare} />
          Compare to previous month
        </label>

        <Button variant="outline" onClick={() => setImportOpen(true)}>
          Import Hospitable CSV
        </Button>

        <Button variant="default" disabled={!hasRows} onClick={handleExportCsv}>
          Export CSV
        </Button>

        <Button variant="outline" disabled={!hasRows} onClick={handleOpenStatementDialog}>
          Export PDF
        </Button>
      </div>

      {/* Import dialog */}
      <Modal open={importOpen} onClose={() => setImportOpen(false)} className="max-w-3xl">
        <HospitableCsvImport
          onImportComplete={() => {
            setImportOpen(false);
            showToast("Import complete — data updated.", "success");
          }}
          onClose={() => setImportOpen(false)}
        />
      </Modal>

      {/* View manager dialog */}
      <ViewManager
        open={viewManagerOpen}
        onOpenChange={setViewManagerOpen}
        activeViewId={activeViewId}
        onViewSaved={(id) => setActiveViewId(id)}
        onViewDeleted={() => setActiveViewId(null)}
      />

      {/* Export Owner Statement dialog */}
      <Modal open={statementOpen} onClose={() => setStatementOpen(false)} labelledBy="stmt-title" className="max-w-sm">
        <ModalTitle id="stmt-title">Export Owner Statement</ModalTitle>
        <div className="flex flex-col gap-4 py-3">
          <div className="space-y-1">
            <Label htmlFor="stmt-client-name">Client / company</Label>
            <Input
              id="stmt-client-name"
              value={stmtClientName}
              onChange={(e) => setStmtClientName(e.target.value)}
              placeholder="e.g. Acme Realty LLC"
              autoFocus
            />
            {activeView?.ownerUserId ? (
              <p className="text-xs text-[var(--muted-foreground)]">
                Prefilled from the linked owner&apos;s profile (company, else
                name) — kept in sync with their ownership records.
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="stmt-date">Statement date</Label>
            <Input id="stmt-date" type="date" value={stmtDate} onChange={(e) => setStmtDate(e.target.value)} />
          </div>
        </div>
        <ModalFooter>
          <Button variant="outline" size="sm" onClick={() => setStatementOpen(false)} disabled={stmtGenerating}>
            Cancel
          </Button>
          <Button size="sm" disabled={stmtGenerating} onClick={() => void handleGenerateStatement()}>
            {stmtGenerating ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            Generate statement
          </Button>
        </ModalFooter>
      </Modal>

      {/* Body */}
      {report === undefined ? (
        <div className="flex items-center gap-2 p-6 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : report.rows.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          No data for {month} — import a Hospitable CSV to begin.
        </p>
      ) : (
        <MonthlyPnlTable
          report={report}
          compareReport={compare ? prevReport ?? undefined : undefined}
          onSaveActual={handleSaveActual}
        />
      )}
    </div>
  );
}
