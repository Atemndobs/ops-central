"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import {
  STATUS_CLASSNAMES,
  STATUS_LABELS,
  WORKFLOW_STEPS,
  getNextStatus,
  type JobStatus,
} from "@/components/jobs/job-status";

type Job = {
  _id: string;
  title: string;
  notes?: string;
  status: JobStatus;
  scheduledFor: number;
  propertyId: string;
  cleanerId?: string;
  photos?: Array<{ url: string; caption?: string }>;
  property?: { _id: string; name?: string | null; address?: string | null } | null;
  cleaner?: { _id: string; name?: string | null; email?: string | null } | null;
};

export function JobDetailClient({ id }: { id: string }) {
  const job = useQuery(api.jobs.queries.getById as any, { id }) as Job | null | undefined;
  const updateStatus = useMutation(api.jobs.mutations.updateStatus as any);
  const assignCleaner = useMutation(api.jobs.mutations.assignCleaner as any);

  const [cleanerId, setCleanerId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanerJobs = useQuery(
    api.jobs.queries.getByCleaner as any,
    job?.cleanerId ? { cleanerId: job.cleanerId } : "skip",
  ) as Job[] | undefined;

  const propertyJobs = useQuery(
    api.jobs.queries.getByProperty as any,
    job?.propertyId ? { propertyId: job.propertyId } : "skip",
  ) as Job[] | undefined;

  const nextStatus = useMemo(() => {
    if (!job) {
      return null;
    }
    return getNextStatus(job.status);
  }, [job]);

  if (job === undefined) {
    return <div className="text-sm text-[var(--muted-foreground)]">Loading job...</div>;
  }

  if (!job) {
    return <div className="text-sm text-[var(--muted-foreground)]">Job not found.</div>;
  }

  async function onAdvanceStatus() {
    if (!nextStatus) {
      return;
    }

    setError(null);
    setPending(true);

    try {
      await updateStatus({ id, status: nextStatus });
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Unable to update status.");
    } finally {
      setPending(false);
    }
  }

  async function onAssignCleaner() {
    if (!cleanerId) {
      setError("Enter a cleaner ID before assigning.");
      return;
    }

    setError(null);
    setPending(true);

    try {
      await assignCleaner({ id, cleanerId });
      setCleanerId("");
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : "Unable to assign cleaner.");
    } finally {
      setPending(false);
    }
  }

  const currentStepIndex = WORKFLOW_STEPS.indexOf(job.status);

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex min-w-[720px] items-center gap-2">
          {WORKFLOW_STEPS.map((step, index) => {
            const complete = currentStepIndex >= index;
            return (
              <div key={step} className="flex items-center gap-2">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs ${
                    complete
                      ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                      : "border-[var(--border)] text-[var(--muted-foreground)]"
                  }`}
                >
                  {index + 1}
                </div>
                <span className="text-sm">{STATUS_LABELS[step]}</span>
                {index < WORKFLOW_STEPS.length - 1 ? (
                  <div className="h-px w-8 bg-[var(--border)]" />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold">{job.title}</h2>
                <p className="text-xs text-[var(--muted-foreground)]">{job._id}</p>
              </div>
              <span
                className={`rounded-full border px-2 py-1 text-xs ${STATUS_CLASSNAMES[job.status]}`}
              >
                {STATUS_LABELS[job.status]}
              </span>
            </div>

            <div className="mt-4 grid gap-2 text-sm">
              <p>
                <span className="text-[var(--muted-foreground)]">Property:</span>{" "}
                {job.property?.name ?? "Unknown property"}
              </p>
              <p>
                <span className="text-[var(--muted-foreground)]">Address:</span>{" "}
                {job.property?.address ?? "—"}
              </p>
              <p>
                <span className="text-[var(--muted-foreground)]">Cleaner:</span>{" "}
                {job.cleaner?.name ?? "Unassigned"}
              </p>
              <p>
                <span className="text-[var(--muted-foreground)]">Scheduled:</span>{" "}
                {new Date(job.scheduledFor).toLocaleString()}
              </p>
              <p>
                <span className="text-[var(--muted-foreground)]">Notes:</span> {job.notes || "—"}
              </p>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                onClick={onAdvanceStatus}
                disabled={!nextStatus || pending}
                className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {nextStatus ? `Move to ${STATUS_LABELS[nextStatus]}` : "No further transition"}
              </button>

              <input
                value={cleanerId}
                onChange={(event) => setCleanerId(event.target.value)}
                placeholder="Cleaner ID"
                className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm"
              />
              <button
                onClick={onAssignCleaner}
                disabled={pending}
                className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
              >
                Assign Cleaner
              </button>
            </div>

            {error ? <p className="mt-3 text-sm text-[var(--destructive)]">{error}</p> : null}
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
            <h3 className="mb-3 text-sm font-semibold">Related Activity</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-[var(--border)] p-3">
                <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                  Jobs at this property
                </p>
                <p className="mt-2 text-2xl font-semibold">{propertyJobs?.length ?? 0}</p>
              </div>
              <div className="rounded-md border border-[var(--border)] p-3">
                <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                  Jobs for this cleaner
                </p>
                <p className="mt-2 text-2xl font-semibold">{cleanerJobs?.length ?? 0}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h3 className="mb-4 text-sm font-semibold">Photo Gallery</h3>
          <div className="grid grid-cols-2 gap-2">
            {job.photos?.map((photo, index) => (
              <a
                key={`${photo.url}-${index}`}
                href={photo.url}
                target="_blank"
                rel="noreferrer"
                className="group overflow-hidden rounded-md border border-[var(--border)]"
              >
                <img
                  src={photo.url}
                  alt={photo.caption || `Job photo ${index + 1}`}
                  className="h-28 w-full object-cover transition-transform group-hover:scale-105"
                />
              </a>
            ))}
          </div>
          {!job.photos?.length ? (
            <p className="text-sm text-[var(--muted-foreground)]">No photos attached to this job.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
