"use client";

import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Download, FileDown, Loader2 } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useToast } from "@/components/ui/toast-provider";

type ReportPreset = "7d" | "30d" | "90d" | "custom";
type ExportFormat = "csv" | "xlsx" | "pdf";

const presetOptions: Array<{ value: ReportPreset; label: string }> = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "custom", label: "Custom" },
];

export function ReportsPageClient() {
  const { showToast } = useToast();
  const { isAuthenticated } = useConvexAuth();

  const [preset, setPreset] = useState<ReportPreset>("30d");
  const [customFromDate, setCustomFromDate] = useState("");
  const [customToDate, setCustomToDate] = useState("");
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<Id<"properties">[]>([]);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("csv");
  const [isSubmittingExport, setIsSubmittingExport] = useState(false);

  const dashboardArgs = useMemo(() => {
    const propertyIds = selectedPropertyIds.length > 0 ? selectedPropertyIds : undefined;
    if (preset !== "custom") {
      return {
        preset,
        propertyIds,
      };
    }

    const fromTs = customFromDate
      ? new Date(`${customFromDate}T00:00:00.000`).getTime()
      : undefined;
    const toTs = customToDate
      ? new Date(`${customToDate}T23:59:59.999`).getTime()
      : undefined;

    return {
      preset,
      fromTs,
      toTs,
      propertyIds,
    };
  }, [customFromDate, customToDate, preset, selectedPropertyIds]);

  const dashboard = useQuery(
    api.reports.queries.getDashboard,
    isAuthenticated ? dashboardArgs : "skip",
  );
  const exportHistory = useQuery(
    api.reports.queries.listExports,
    isAuthenticated ? { limit: 20 } : "skip",
  );
  const requestExport = useMutation(api.reports.mutations.requestExport);

  const availableProperties = useMemo(
    () => dashboard?.scope.availableProperties ?? [],
    [dashboard?.scope.availableProperties],
  );
  useEffect(() => {
    if (availableProperties.length === 0 || selectedPropertyIds.length === 0) {
      return;
    }
    const allowed = new Set(availableProperties.map((property) => property._id));
    const next = selectedPropertyIds.filter((propertyId) => allowed.has(propertyId));
    if (next.length !== selectedPropertyIds.length) {
      setSelectedPropertyIds(next);
    }
  }, [availableProperties, selectedPropertyIds]);

  const summary = dashboard?.summary;
  const daily = dashboard?.trends.daily ?? [];
  const rankings = dashboard?.teamRankings ?? [];
  const readinessRows = dashboard?.tables.readiness ?? [];
  const incidentRows = dashboard?.tables.incidents ?? [];

  const totalActiveExports = useMemo(
    () =>
      (exportHistory?.entries ?? []).filter(
        (entry) => entry.status === "queued" || entry.status === "running",
      ).length,
    [exportHistory],
  );

  const handlePropertySelection = (event: ChangeEvent<HTMLSelectElement>) => {
    const values = Array.from(event.target.selectedOptions).map(
      (option) => option.value as Id<"properties">,
    );
    setSelectedPropertyIds(values);
  };

  const onExport = async () => {
    try {
      setIsSubmittingExport(true);
      await requestExport({
        format: exportFormat,
        preset,
        fromTs: dashboardArgs.fromTs,
        toTs: dashboardArgs.toTs,
        propertyIds: selectedPropertyIds.length > 0 ? selectedPropertyIds : undefined,
      });
      showToast("Export queued. It will appear in Download Center shortly.", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Export failed: ${message}`, "error");
    } finally {
      setIsSubmittingExport(false);
    }
  };

  if (!dashboard || !summary) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-[var(--muted-foreground)]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading reports...
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-display">Reports</h1>
          <p className="mt-2 text-[var(--muted-foreground)]">
            Operational performance across efficiency, quality, and team delivery.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            className="h-11 border bg-[var(--card)] px-3 text-sm"
            value={exportFormat}
            onChange={(event) => setExportFormat(event.target.value as ExportFormat)}
          >
            <option value="csv">CSV Bundle (.zip)</option>
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="pdf">PDF (.pdf)</option>
          </select>
          <button
            type="button"
            disabled={isSubmittingExport}
            onClick={onExport}
            className="flex h-11 items-center gap-2 rounded-none bg-[var(--primary)] px-6 text-sm font-black uppercase tracking-widest text-[var(--primary-foreground)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmittingExport ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Export Data
          </button>
        </div>
      </div>

      <section className="grid gap-4 border p-4 md:grid-cols-4">
        <div className="md:col-span-2">
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
            Time Range
          </p>
          <div className="flex flex-wrap gap-2">
            {presetOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPreset(option.value)}
                className={`border px-3 py-2 text-xs font-bold uppercase tracking-wide ${
                  preset === option.value
                    ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                    : "bg-[var(--card)] text-[var(--foreground)]"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {preset === "custom" ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="date"
                className="h-10 border bg-[var(--card)] px-3 text-sm"
                value={customFromDate}
                onChange={(event) => setCustomFromDate(event.target.value)}
              />
              <input
                type="date"
                className="h-10 border bg-[var(--card)] px-3 text-sm"
                value={customToDate}
                onChange={(event) => setCustomToDate(event.target.value)}
              />
            </div>
          ) : null}
        </div>

        <div className="md:col-span-2">
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
            Property Filter
          </p>
          <select
            multiple
            value={selectedPropertyIds}
            onChange={handlePropertySelection}
            className="h-28 w-full border bg-[var(--card)] px-3 py-2 text-sm"
          >
            {availableProperties.map((property) => (
              <option key={property._id} value={property._id}>
                {property.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Leave empty to include all authorized properties.
          </p>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <article className="border bg-[var(--card)] p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
            Efficiency
          </p>
          <p className="mt-2 text-3xl font-black">{summary.efficiency.onTimeRate}%</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            On-time rate · {summary.efficiency.completionRate}% completion
          </p>
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">
            Avg delay {summary.efficiency.avgStartDelayMinutes}m · Avg duration {summary.efficiency.avgDurationMinutes}m
          </p>
        </article>

        <article className="border bg-[var(--card)] p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
            Quality
          </p>
          <p className="mt-2 text-3xl font-black">{summary.quality.qualityScorePct}%</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Validation pass {summary.quality.validationPassRate}%
          </p>
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">
            Incident rate {summary.quality.incidentRatePer100Jobs} per 100 jobs
          </p>
        </article>

        <article className="border bg-[var(--card)] p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
            Property Readiness
          </p>
          <p className="mt-2 text-3xl font-black">{summary.readiness.readyCount}</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Ready out of {summary.readiness.nextCheckins} upcoming check-ins
          </p>
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">
            At risk: {summary.readiness.atRiskCount}
          </p>
        </article>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <article className="border bg-[var(--card)] p-5">
          <h2 className="text-lg font-black uppercase">Daily Trend</h2>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Jobs completed and on-time trend across the selected period.
          </p>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" hide={daily.length > 14} />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} />
                <Tooltip />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="completedJobs"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  dot={false}
                  name="Completed Jobs"
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="onTimeRate"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={false}
                  name="On-time %"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="border bg-[var(--card)] p-5">
          <h2 className="text-lg font-black uppercase">Team Rankings</h2>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Composite score = 40% on-time + 40% quality + 20% normalized volume.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
                  <th className="py-2">Cleaner</th>
                  <th className="py-2 text-right">Composite</th>
                  <th className="py-2 text-right">On-Time</th>
                  <th className="py-2 text-right">Quality</th>
                  <th className="py-2 text-right">Completed</th>
                </tr>
              </thead>
              <tbody>
                {rankings.slice(0, 10).map((row) => (
                  <tr key={row.userId} className="border-b">
                    <td className="py-2 font-semibold">{row.name}</td>
                    <td className="py-2 text-right font-bold">{row.compositeScore}%</td>
                    <td className="py-2 text-right">{row.onTimePct}%</td>
                    <td className="py-2 text-right">{row.qualityPct}%</td>
                    <td className="py-2 text-right">{row.completedJobs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <article className="border bg-[var(--card)] p-5">
          <h2 className="text-lg font-black uppercase">Property Readiness Details</h2>
          <div className="mt-4 max-h-72 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
                  <th className="py-2">Property</th>
                  <th className="py-2">Check-in</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {readinessRows.map((row, idx) => (
                  <tr key={`${row.propertyId}-${row.checkInAt}-${idx}`} className="border-b">
                    <td className="py-2">{row.propertyName}</td>
                    <td className="py-2">{new Date(row.checkInAt).toLocaleString()}</td>
                    <td className="py-2">
                      <span
                        className={`inline-flex border px-2 py-0.5 text-xs font-bold uppercase ${
                          row.status === "ready"
                            ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                            : "border-rose-300 bg-rose-100 text-rose-800"
                        }`}
                      >
                        {row.status === "ready" ? "Ready" : "At Risk"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="border bg-[var(--card)] p-5">
          <h2 className="text-lg font-black uppercase">Download Center</h2>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Active exports: {totalActiveExports}
          </p>
          <div className="mt-4 space-y-2">
            {(exportHistory?.entries ?? []).map((entry) => (
              <div key={entry._id} className="flex items-center justify-between border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {entry.fileName ?? `Pending ${entry.format.toUpperCase()} export`}
                  </p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {new Date(entry.createdAt).toLocaleString()} · {entry.status}
                    {entry.expiresAt ? ` · Expires ${new Date(entry.expiresAt).toLocaleString()}` : ""}
                  </p>
                  {entry.error ? (
                    <p className="text-xs text-rose-600">{entry.error}</p>
                  ) : null}
                </div>
                {entry.downloadUrl ? (
                  <a
                    href={entry.downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 border px-3 py-2 text-xs font-bold uppercase tracking-wider"
                  >
                    <FileDown className="h-3.5 w-3.5" />
                    Download
                  </a>
                ) : (
                  <span className="text-xs text-[var(--muted-foreground)]">Not ready</span>
                )}
              </div>
            ))}
            {(exportHistory?.entries ?? []).length === 0 ? (
              <p className="border border-dashed p-4 text-sm text-[var(--muted-foreground)]">
                No exports yet.
              </p>
            ) : null}
          </div>
        </article>
      </section>

      <section className="border bg-[var(--card)] p-5">
        <h2 className="text-lg font-black uppercase">Incident Feed (Window)</h2>
        <div className="mt-4 max-h-72 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
                <th className="py-2">Title</th>
                <th className="py-2">Type</th>
                <th className="py-2">Severity</th>
                <th className="py-2">Status</th>
                <th className="py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {incidentRows.map((row, idx) => (
                <tr key={`${row.incidentId}-${idx}`} className="border-b">
                  <td className="py-2">{row.title}</td>
                  <td className="py-2">{row.incidentType}</td>
                  <td className="py-2">{row.severity ?? "n/a"}</td>
                  <td className="py-2">{row.status}</td>
                  <td className="py-2">{new Date(row.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {incidentRows.length === 0 ? (
            <p className="pt-4 text-sm text-[var(--muted-foreground)]">
              No incidents in the selected window.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
