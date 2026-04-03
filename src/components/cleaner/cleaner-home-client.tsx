"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

function formatDate(value?: number) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  assigned: "Assigned",
  in_progress: "In Progress",
  awaiting_approval: "Awaiting Approval",
  rework_required: "Rework Required",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_COLOR: Record<string, string> = {
  scheduled: "border-slate-500/60 text-slate-300",
  assigned: "border-blue-500/60 text-blue-300",
  in_progress: "border-amber-500/60 text-amber-300",
  awaiting_approval: "border-cyan-400/70 bg-cyan-500/5 text-cyan-400",
  rework_required: "border-red-500/60 text-red-300",
  completed: "border-emerald-500/60 text-emerald-300",
  cancelled: "border-zinc-500/60 text-zinc-400",
};

const ACTIVE_JOB_STATUSES = new Set(["scheduled", "assigned", "in_progress", "rework_required", "awaiting_approval"]);
const CLOSED_JOB_STATUSES = new Set(["completed"]);

export function CleanerHomeClient() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const jobs = useQuery(api.cleaningJobs.queries.getMyAssigned, isAuthenticated ? { limit: 200 } : "skip") as
    | Array<{
        _id: string;
        status: string;
        scheduledStartAt: number;
        property?: { name?: string | null; address?: string | null } | null;
        notesForCleaner?: string;
      }>
    | undefined;

  const activeJobs = useMemo(() => {
    const source = jobs ?? [];
    return source.filter((job) => ACTIVE_JOB_STATUSES.has(job.status));
  }, [jobs]);

  const closedJobs = useMemo(() => {
    const source = jobs ?? [];
    return source.filter((job) => CLOSED_JOB_STATUSES.has(job.status));
  }, [jobs]);

  if (isLoading || !isAuthenticated) {
    return <p className="text-sm text-[var(--muted-foreground)]">Loading assigned jobs...</p>;
  }

  if (jobs === undefined) {
    return <p className="text-sm text-[var(--muted-foreground)]">Loading assigned jobs...</p>;
  }

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
        <p className="text-sm uppercase tracking-wide text-[var(--muted-foreground)]">Today</p>
        <h2 className="mt-1 text-2xl font-semibold">{activeJobs.length} active job(s)</h2>
        <p className="mt-1 text-base text-[var(--muted-foreground)]">
          {closedJobs.length} submitted or completed job(s) in your current feed.
        </p>
      </section>

      {activeJobs.length === 0 ? (
        <section className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--muted-foreground)]">
          No active jobs right now.
        </section>
      ) : (
        <ul className="space-y-3">
          {activeJobs.map((job) => (
            <li key={job._id} className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold">{job.property?.name ?? "Unknown property"}</p>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    {job.property?.address ?? "No address"}
                  </p>
                </div>
                <span
                  className={`rounded-md border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${
                    STATUS_COLOR[job.status] ?? "border-[var(--border)]"
                  }`}
                >
                  {STATUS_LABELS[job.status] ?? job.status}
                </span>
              </div>

              <p className="mt-3 text-sm text-[var(--muted-foreground)]">
                Scheduled: <span className="text-[var(--foreground)]">{formatDate(job.scheduledStartAt)}</span>
              </p>

              {job.notesForCleaner ? (
                <p className="mt-2 rounded-md bg-[var(--background)] p-2 text-sm text-[var(--muted-foreground)]">
                  {job.notesForCleaner}
                </p>
              ) : null}

              <div className="mt-3 flex gap-2">
                <Link
                  href={`/cleaner/jobs/${job._id}`}
                  className="rounded-md border border-[var(--border)] px-3 py-2 text-sm"
                >
                  Open Details
                </Link>
                {job.status === "awaiting_approval" ? null : (
                  <Link
                    href={`/cleaner/jobs/${job._id}/active`}
                    className="rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)]"
                  >
                    {job.status === "in_progress" ? "Resume" : "Start"}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
