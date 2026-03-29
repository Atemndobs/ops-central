"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Camera, CheckCircle2, Clock3, Loader2, RotateCcw } from "lucide-react";
import { JOB_STATUSES, STATUS_CLASSNAMES, STATUS_LABELS, type JobStatus } from "@/components/jobs/job-status";

function startOfDay(dateString: string): number | undefined {
  if (!dateString) {
    return undefined;
  }
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function endOfDay(dateString: string): number | undefined {
  const start = startOfDay(dateString);
  if (start === undefined) {
    return undefined;
  }
  return start + 24 * 60 * 60 * 1000 - 1;
}

export function ReviewQueueClient() {
  const { isAuthenticated } = useConvexAuth();
  const [status, setStatus] = useState<JobStatus | "all">("awaiting_approval");
  const [propertyId, setPropertyId] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const properties = useQuery(api.properties.queries.getAll, isAuthenticated ? { limit: 500 } : "skip");

  const queryArgs = useMemo(
    () => ({
      status: status === "all" ? undefined : status,
      propertyId: propertyId === "all" ? undefined : (propertyId as Id<"properties">),
      from: startOfDay(fromDate),
      to: endOfDay(toDate),
      limit: 500,
    }),
    [fromDate, propertyId, status, toDate],
  );

  const jobs = useQuery(api.cleaningJobs.queries.getReviewQueue, isAuthenticated ? queryArgs : "skip");

  const counts = useMemo(() => {
    const source = jobs ?? [];
    return {
      awaiting_approval: source.filter((job) => job.status === "awaiting_approval").length,
      rework_required: source.filter((job) => job.status === "rework_required").length,
      completed: source.filter((job) => job.status === "completed").length,
    };
  }, [jobs]);

  const loading = jobs === undefined || properties === undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Review Queue</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Review and approve completed cleaning jobs.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <button
          type="button"
          onClick={() => setStatus("awaiting_approval")}
          className={`group rounded-2xl border p-4 text-left transition hover:shadow-md sm:p-5 ${
            status === "awaiting_approval"
              ? "border-indigo-500/60 bg-indigo-500/10"
              : "border-[var(--border)] bg-[var(--card)] hover:border-indigo-500/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] sm:text-xs">
              Awaiting
            </p>
            <Clock3 className="hidden h-4 w-4 text-indigo-400 sm:block" />
          </div>
          <p className="mt-1 text-2xl font-extrabold leading-none tracking-tight sm:text-4xl">
            {loading ? "—" : counts.awaiting_approval}
          </p>
        </button>

        <button
          type="button"
          onClick={() => setStatus("rework_required")}
          className={`group rounded-2xl border p-4 text-left transition hover:shadow-md sm:p-5 ${
            status === "rework_required"
              ? "border-rose-500/60 bg-rose-500/10"
              : "border-[var(--border)] bg-[var(--card)] hover:border-rose-500/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] sm:text-xs">
              Rework
            </p>
            <RotateCcw className="hidden h-4 w-4 text-rose-400 sm:block" />
          </div>
          <p className="mt-1 text-2xl font-extrabold leading-none tracking-tight sm:text-4xl">
            {loading ? "—" : counts.rework_required}
          </p>
        </button>

        <button
          type="button"
          onClick={() => setStatus("completed")}
          className={`group rounded-2xl border p-4 text-left transition hover:shadow-md sm:p-5 ${
            status === "completed"
              ? "border-emerald-500/60 bg-emerald-500/10"
              : "border-[var(--border)] bg-[var(--card)] hover:border-emerald-500/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] sm:text-xs">
              Completed
            </p>
            <CheckCircle2 className="hidden h-4 w-4 text-emerald-400 sm:block" />
          </div>
          <p className="mt-1 text-2xl font-extrabold leading-none tracking-tight sm:text-4xl">
            {loading ? "—" : counts.completed}
          </p>
        </button>
      </div>

      {/* Filters */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Status</label>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as JobStatus | "all")}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            >
              <option value="all">All statuses</option>
              {JOB_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Property</label>
            <select
              value={propertyId}
              onChange={(event) => setPropertyId(event.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            >
              <option value="all">All properties</option>
              {(properties ?? []).map((property) => (
                <option key={property._id} value={property._id}>
                  {property.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-[var(--muted-foreground)]">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              aria-label="From date"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-[var(--muted-foreground)]">To</label>
            <input
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              aria-label="To date"
            />
          </div>
        </div>
      </section>

      {/* Job list */}
      {loading ? (
        <div className="flex min-h-48 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] text-sm text-[var(--muted-foreground)]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading review queue...
        </div>
      ) : jobs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--card)] px-4 py-12 text-center text-sm text-[var(--muted-foreground)]">
          No jobs match current filters.
        </div>
      ) : (
        <section className="space-y-3">
          {jobs.map((job) => {
            const cleanerNames =
              job.cleaners
                ?.map((c) => (c ? c.name ?? c.email ?? c._id : null))
                .filter((v): v is string => Boolean(v)) ?? [];

            return (
              <div
                key={job._id}
                className="group rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 transition hover:border-[var(--primary)]/40 hover:shadow-md"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold">{job.property?.name ?? "Unknown property"}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-[var(--muted-foreground)]">
                      {job._id.slice(-8)}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSNAMES[job.status]}`}>
                    {STATUS_LABELS[job.status]}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
                  <span>{new Date(job.scheduledStartAt).toLocaleDateString()} · {new Date(job.scheduledStartAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <span>{cleanerNames.length > 0 ? cleanerNames.join(", ") : "Unassigned"}</span>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    href={`/review/jobs/${job._id}`}
                    className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] transition hover:opacity-90"
                  >
                    Review
                  </Link>
                  <Link
                    href={`/review/jobs/${job._id}/photos-review`}
                    className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--muted-foreground)] transition hover:border-[var(--primary)]/40 hover:text-[var(--foreground)]"
                  >
                    <Camera className="h-3 w-3" />
                    Photos
                  </Link>
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
