"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { getErrorMessage } from "@/lib/errors";

function formatDate(value?: number | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export function CleanerJobDetailClient({ id }: { id: string }) {
  const jobId = id as Id<"cleaningJobs">;

  const detail = useQuery(api.cleaningJobs.queries.getMyJobDetail, { jobId }) as
    | {
        job: {
          _id: string;
          status: string;
          scheduledStartAt: number;
          notesForCleaner?: string;
          assignedCleanerIds: string[];
        };
        property?: { name?: string | null; address?: string | null } | null;
        cleaners: Array<{ _id?: string; name?: string | null; email?: string | null }>;
        execution: { unresolvedCleanerIds: string[] };
        evidence: { current: { byType: { before: unknown[]; after: unknown[]; incident: unknown[] } } };
      }
    | null
    | undefined;

  const startJob = useMutation(api.cleaningJobs.mutations.start);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canStart = useMemo(() => {
    const status = detail?.job.status;
    if (!status) return false;
    return status === "scheduled" || status === "assigned" || status === "rework_required";
  }, [detail?.job.status]);

  if (detail === undefined) {
    return <p className="text-sm text-[var(--muted-foreground)]">Loading job details...</p>;
  }

  if (!detail) {
    return <p className="text-sm text-[var(--muted-foreground)]">Job not found.</p>;
  }

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-lg font-semibold">{detail.property?.name ?? "Unknown property"}</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">{detail.property?.address ?? "No address"}</p>

        <div className="mt-4 space-y-2 text-sm">
          <p>
            <span className="text-[var(--muted-foreground)]">Scheduled:</span> {formatDate(detail.job.scheduledStartAt)}
          </p>
          <p>
            <span className="text-[var(--muted-foreground)]">Status:</span> {detail.job.status}
          </p>
          <p>
            <span className="text-[var(--muted-foreground)]">Assigned Cleaners:</span>{" "}
            {detail.cleaners.length
              ? detail.cleaners.map((cleaner) => cleaner.name ?? cleaner.email ?? cleaner._id).join(", ")
              : "Unassigned"}
          </p>
          <p>
            <span className="text-[var(--muted-foreground)]">Notes:</span> {detail.job.notesForCleaner ?? "—"}
          </p>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-md border border-[var(--border)] p-2">
            Before: {detail.evidence.current.byType.before.length}
          </div>
          <div className="rounded-md border border-[var(--border)] p-2">
            After: {detail.evidence.current.byType.after.length}
          </div>
          <div className="rounded-md border border-[var(--border)] p-2">
            Incident: {detail.evidence.current.byType.incident.length}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canStart || pending}
            onClick={async () => {
              setPending(true);
              setError(null);
              try {
                await startJob({ jobId, startedAtDevice: Date.now(), offlineStartToken: `${jobId}-${Date.now()}` });
              } catch (mutationError) {
                setError(getErrorMessage(mutationError, "Unable to start job."));
              } finally {
                setPending(false);
              }
            }}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50"
          >
            Start Here
          </button>

          <Link
            href={`/cleaner/jobs/${detail.job._id}/active`}
            className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)]"
          >
            {detail.job.status === "in_progress" ? "Resume Active Flow" : "Open Active Flow"}
          </Link>
        </div>

        {detail.execution.unresolvedCleanerIds.length > 0 ? (
          <p className="mt-3 text-xs text-amber-300">
            Submission gate pending: {detail.execution.unresolvedCleanerIds.length} cleaner session(s) unresolved.
          </p>
        ) : null}

        {error ? <p className="mt-2 text-xs text-[var(--destructive)]">{error}</p> : null}
      </section>
    </div>
  );
}
