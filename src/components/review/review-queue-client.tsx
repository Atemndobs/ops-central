"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
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
  const [status, setStatus] = useState<JobStatus | "all">("awaiting_approval");
  const [propertyId, setPropertyId] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const properties = useQuery(api.properties.queries.getAll, { limit: 500 });

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

  const jobs = useQuery(api.cleaningJobs.queries.getReviewQueue, queryArgs);

  const counts = useMemo(() => {
    const source = jobs ?? [];
    return {
      awaiting_approval: source.filter((job) => job.status === "awaiting_approval").length,
      rework_required: source.filter((job) => job.status === "rework_required").length,
      completed: source.filter((job) => job.status === "completed").length,
    };
  }, [jobs]);

  if (jobs === undefined || properties === undefined) {
    return <p className="text-sm text-[var(--muted-foreground)]">Loading review queue...</p>;
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-indigo-500/40 bg-indigo-500/10 p-3">
          <p className="text-xs text-indigo-200">Awaiting Approval</p>
          <p className="mt-1 text-2xl font-semibold">{counts.awaiting_approval}</p>
        </div>
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-3">
          <p className="text-xs text-rose-200">Rework Required</p>
          <p className="mt-1 text-2xl font-semibold">{counts.rework_required}</p>
        </div>
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3">
          <p className="text-xs text-emerald-200">Completed</p>
          <p className="mt-1 text-2xl font-semibold">{counts.completed}</p>
        </div>
      </section>

      <section className="rounded-md border border-[var(--border)] bg-[var(--card)] p-3">
        <div className="grid gap-2 md:grid-cols-4">
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as JobStatus | "all")}
            className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
          >
            <option value="all">All statuses</option>
            {JOB_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>

          <select
            value={propertyId}
            onChange={(event) => setPropertyId(event.target.value)}
            className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
          >
            <option value="all">All properties</option>
            {properties.map((property) => (
              <option key={property._id} value={property._id}>
                {property.name}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
            className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
            aria-label="From date"
          />

          <input
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
            className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
            aria-label="To date"
          />
        </div>
      </section>

      <section className="overflow-hidden rounded-md border border-[var(--border)] bg-[var(--card)]">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
            <tr>
              <th className="px-3 py-2">Property</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Scheduled</th>
              <th className="px-3 py-2">Assigned Cleaner(s)</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job._id} className="border-b border-[var(--border)] last:border-b-0">
                <td className="px-3 py-2">
                  <p className="font-medium">{job.property?.name ?? "Unknown property"}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">{job._id}</p>
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_CLASSNAMES[job.status]}`}>
                    {STATUS_LABELS[job.status]}
                  </span>
                </td>
                <td className="px-3 py-2">{new Date(job.scheduledStartAt).toLocaleString()}</td>
                <td className="px-3 py-2">
                  {(() => {
                    const names =
                      job.cleaners
                        ?.map((cleaner) => {
                          if (!cleaner) {
                            return null;
                          }
                          return cleaner.name ?? cleaner.email ?? cleaner._id;
                        })
                        .filter((value): value is string => Boolean(value)) ?? [];
                    return names.length > 0 ? names.join(", ") : "Unassigned";
                  })()}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-3">
                    <Link href={`/review/jobs/${job._id}`} className="text-[var(--primary)] hover:underline">
                      Review
                    </Link>
                    <Link href={`/review/jobs/${job._id}/photos-review`} className="text-[var(--primary)] hover:underline">
                      Photos
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {jobs.length === 0 ? (
          <div className="px-3 py-10 text-center text-sm text-[var(--muted-foreground)]">No jobs match current filters.</div>
        ) : null}
      </section>
    </div>
  );
}
