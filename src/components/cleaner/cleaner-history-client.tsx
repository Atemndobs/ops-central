"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

function formatDate(value?: number) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export function CleanerHistoryClient() {
  const jobs = useQuery(api.cleaningJobs.queries.getMyAssigned, { limit: 500 }) as
    | Array<{ _id: string; status: string; scheduledStartAt: number; property?: { name?: string | null } | null }>
    | undefined;

  const history = useMemo(() => {
    const source = jobs ?? [];
    return source
      .filter((job) => job.status === "completed" || job.status === "awaiting_approval" || job.status === "cancelled")
      .sort((a, b) => b.scheduledStartAt - a.scheduledStartAt);
  }, [jobs]);

  if (jobs === undefined) {
    return <p className="text-sm text-[var(--muted-foreground)]">Loading history...</p>;
  }

  if (history.length === 0) {
    return (
      <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--muted-foreground)]">
        No history yet.
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {history.map((job) => (
        <li key={job._id} className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-sm font-semibold">{job.property?.name ?? "Unknown property"}</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">{formatDate(job.scheduledStartAt)}</p>
          <p className="mt-1 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">{job.status}</p>
          <Link
            href={`/cleaner/jobs/${job._id}`}
            className="mt-3 inline-block rounded-md border border-[var(--border)] px-3 py-1.5 text-xs"
          >
            View
          </Link>
        </li>
      ))}
    </ul>
  );
}
