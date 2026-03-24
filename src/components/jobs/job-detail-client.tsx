"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import {
  STATUS_CLASSNAMES,
  STATUS_LABELS,
  WORKFLOW_STEPS,
  getNextStatus,
  type JobStatus,
} from "@/components/jobs/job-status";
import { useToast } from "@/components/ui/toast-provider";
import { getErrorMessage } from "@/lib/errors";

type Job = {
  _id: string;
  notesForCleaner?: string;
  status: JobStatus;
  scheduledStartAt?: number;
  scheduledEndAt?: number;
  propertyId: string;
  assignedCleanerIds?: string[];
  photos?: Array<{ url: string; caption?: string }>;
  property?: { _id: string; name?: string | null; address?: string | null } | null;
  cleaners?: Array<{ _id: string; name?: string | null; email?: string | null }> | null;
};

const queryRef = <TArgs extends Record<string, unknown>, TReturn>(name: string) =>
  name as unknown as FunctionReference<"query", "public", TArgs, TReturn>;

const mutationRef = <TArgs extends Record<string, unknown>, TReturn>(name: string) =>
  name as unknown as FunctionReference<"mutation", "public", TArgs, TReturn>;

export function JobDetailClient({ id }: { id: string }) {
  const canonicalJob = useQuery(
    queryRef<{ jobId: string }, Job | null>("cleaningJobs/queries:getById"),
    { jobId: id },
  );
  const startJob = useMutation(
    mutationRef<{ jobId: string }, string>("cleaningJobs/mutations:start"),
  );
  const completeJob = useMutation(
    mutationRef<{ jobId: string; notes?: string; guestReady?: boolean }, string>(
      "cleaningJobs/mutations:complete",
    ),
  );
  const submitForApproval = useMutation(
    mutationRef<{ jobId: string }, string>("cleaningJobs/approve:submitForApproval"),
  );
  const approveCompletion = useMutation(
    mutationRef<{ jobId: string; approvalNotes?: string }, string>(
      "cleaningJobs/approve:approveCompletion",
    ),
  );
  const assignCleaner = useMutation(
    mutationRef<{ jobId: string; cleanerIds: string[]; notifyCleaners?: boolean }, string>(
      "cleaningJobs/mutations:assign",
    ),
  );

  const [cleanerId, setCleanerId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  const cleanerOptions = useQuery(
    queryRef<{ role: "cleaner" }, Array<{ _id: string; name?: string | null }>>(
      "users/queries:getByRole",
    ),
    { role: "cleaner" },
  );

  const cleanerJobs = useQuery(
    queryRef<{ cleanerId: string }, Job[]>("cleaningJobs/queries:getForCleaner"),
    canonicalJob?.assignedCleanerIds?.[0]
      ? { cleanerId: canonicalJob.assignedCleanerIds[0] }
      : "skip",
  );

  const propertyJobs = useQuery(
    queryRef<{ propertyId: string }, Job[]>("cleaningJobs/queries:getAll"),
    canonicalJob?.propertyId ? { propertyId: canonicalJob.propertyId } : "skip",
  );

  const nextStatus = useMemo(() => {
    if (!canonicalJob) {
      return null;
    }
    return getNextStatus(canonicalJob.status);
  }, [canonicalJob]);

  if (canonicalJob === undefined) {
    return <div className="text-sm text-[var(--muted-foreground)]">Loading job...</div>;
  }

  if (!canonicalJob) {
    return <div className="text-sm text-[var(--muted-foreground)]">Job not found.</div>;
  }

  async function onAdvanceStatus() {
    if (!nextStatus || !canonicalJob) {
      return;
    }

    setError(null);
    setPending(true);

    try {
      if (
        canonicalJob.status === "scheduled" ||
        canonicalJob.status === "assigned" ||
        canonicalJob.status === "rework_required"
      ) {
        await startJob({ jobId: id });
      } else if (canonicalJob.status === "in_progress") {
        await submitForApproval({ jobId: id });
      } else if (canonicalJob.status === "awaiting_approval") {
        await approveCompletion({ jobId: id });
      } else if (canonicalJob.status === "completed") {
        await completeJob({ jobId: id });
      }
      showToast(`Job moved to ${STATUS_LABELS[nextStatus]}.`);
    } catch (statusError) {
      const message = getErrorMessage(statusError, "Unable to update status.");
      setError(message);
      showToast(message, "error");
    } finally {
      setPending(false);
    }
  }

  async function onAssignCleaner() {
    if (!cleanerId) {
      setError("Select a cleaner before assigning.");
      return;
    }

    setError(null);
    setPending(true);

    try {
      await assignCleaner({ jobId: id, cleanerIds: [cleanerId], notifyCleaners: false });
      setCleanerId("");
      showToast("Cleaner assigned.");
    } catch (assignError) {
      const message = getErrorMessage(assignError, "Unable to assign cleaner.");
      setError(message);
      showToast(message, "error");
    } finally {
      setPending(false);
    }
  }

  const currentStepIndex = WORKFLOW_STEPS.indexOf(canonicalJob.status);

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
                <h2 className="text-base font-semibold">
                  {canonicalJob.notesForCleaner?.split("\n")[0] || "Cleaning Job"}
                </h2>
                <p className="text-xs text-[var(--muted-foreground)]">{canonicalJob._id}</p>
              </div>
              <span
                className={`rounded-full border px-2 py-1 text-xs ${STATUS_CLASSNAMES[canonicalJob.status]}`}
              >
                {STATUS_LABELS[canonicalJob.status]}
              </span>
            </div>

            <div className="mt-4 grid gap-2 text-sm">
              <p>
                <span className="text-[var(--muted-foreground)]">Property:</span>{" "}
                {canonicalJob.property?.name ?? "Unknown property"}
              </p>
              <p>
                <span className="text-[var(--muted-foreground)]">Address:</span>{" "}
                {canonicalJob.property?.address ?? "—"}
              </p>
              <p>
                <span className="text-[var(--muted-foreground)]">Cleaner:</span>{" "}
                {canonicalJob.cleaners?.[0]?.name ?? "Unassigned"}
              </p>
              <p>
                <span className="text-[var(--muted-foreground)]">Scheduled:</span>{" "}
                {new Date(canonicalJob.scheduledStartAt ?? 0).toLocaleString()}
              </p>
              <p>
                <span className="text-[var(--muted-foreground)]">Notes:</span>{" "}
                {canonicalJob.notesForCleaner || "—"}
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

              <select
                value={cleanerId}
                onChange={(event) => setCleanerId(event.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm"
              >
                <option value="">Select Cleaner</option>
                {(cleanerOptions ?? []).map((cleaner) => (
                  <option key={cleaner._id} value={cleaner._id}>
                    {cleaner.name ?? `Cleaner ${cleaner._id.slice(-6)}`}
                  </option>
                ))}
              </select>
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
            {canonicalJob.photos?.map((photo, index) => (
              <a
                key={`${photo.url}-${index}`}
                href={photo.url}
                target="_blank"
                rel="noreferrer"
                className="group overflow-hidden rounded-md border border-[var(--border)]"
              >
                <Image
                  src={photo.url}
                  alt={photo.caption || `Job photo ${index + 1}`}
                  width={320}
                  height={160}
                  className="h-28 w-full object-cover transition-transform group-hover:scale-105"
                />
              </a>
            ))}
          </div>
          {!canonicalJob.photos?.length ? (
            <p className="text-sm text-[var(--muted-foreground)]">No photos attached to this job.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
