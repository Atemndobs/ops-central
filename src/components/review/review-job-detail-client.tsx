"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { STATUS_CLASSNAMES, STATUS_LABELS, type JobStatus } from "@/components/jobs/job-status";
import { getErrorMessage } from "@/lib/errors";

function formatDateTime(value?: number | null): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString();
}

type ReviewDetail = {
  job: {
    _id: Id<"cleaningJobs">;
    status: JobStatus;
    scheduledStartAt: number;
    scheduledEndAt?: number;
    notesForCleaner?: string;
    currentRevision?: number;
  };
  property: { name?: string | null; address?: string | null } | null;
  cleaners: Array<{ _id: string; name?: string | null; email?: string | null }>;
  execution: {
    unresolvedCleanerIds: string[];
    sessions: Array<{ status: string; cleanerId: string; lastHeartbeatAt?: number; startedAtServer: number }>;
  };
  evidence: {
    current: {
      byType: {
        before: unknown[];
        after: unknown[];
        incident: unknown[];
      };
    };
    latestSubmission: {
      submittedAtServer?: number;
      validationResult?: {
        pass: boolean;
        errors: string[];
        warnings: string[];
        mode: "standard" | "quick";
      };
    } | null;
  };
};

export function ReviewJobDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const jobId = id as Id<"cleaningJobs">;

  const detail = useQuery(api.cleaningJobs.queries.getReviewJobDetail, { jobId }) as ReviewDetail | null | undefined;
  const approveCompletion = useMutation(api.cleaningJobs.approve.approveCompletion);
  const rejectCompletion = useMutation(api.cleaningJobs.approve.rejectCompletion);
  const reopenCompleted = useMutation(api.cleaningJobs.approve.reopenCompleted);

  const [approvalNotes, setApprovalNotes] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (detail === undefined) {
    return <p className="text-sm text-[var(--muted-foreground)]">Loading review detail...</p>;
  }

  if (!detail) {
    return <p className="text-sm text-[var(--muted-foreground)]">Job not found.</p>;
  }

  const beforeCount = detail.evidence.current.byType.before.length;
  const afterCount = detail.evidence.current.byType.after.length;
  const incidentCount = detail.evidence.current.byType.incident.length;
  const validation = detail.evidence.latestSubmission?.validationResult;

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{detail.property?.name ?? "Unknown property"}</h2>
            <p className="text-sm text-[var(--muted-foreground)]">{detail.property?.address ?? "No address"}</p>
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">Job ID: {detail.job._id}</p>
          </div>
          <span className={`rounded-full border px-2 py-1 text-xs ${STATUS_CLASSNAMES[detail.job.status]}`}>
            {STATUS_LABELS[detail.job.status]}
          </span>
        </div>

        <div className="mt-4 grid gap-2 text-sm md:grid-cols-2">
          <p>
            <span className="text-[var(--muted-foreground)]">Scheduled:</span> {formatDateTime(detail.job.scheduledStartAt)}
          </p>
          <p>
            <span className="text-[var(--muted-foreground)]">Revision:</span> {detail.job.currentRevision ?? 1}
          </p>
          <p>
            <span className="text-[var(--muted-foreground)]">Assigned cleaners:</span>{" "}
            {detail.cleaners.length
              ? detail.cleaners.map((cleaner) => cleaner.name ?? cleaner.email ?? cleaner._id).join(", ")
              : "Unassigned"}
          </p>
          <p>
            <span className="text-[var(--muted-foreground)]">Pending cleaner sessions:</span>{" "}
            {detail.execution.unresolvedCleanerIds.length}
          </p>
        </div>

        {detail.job.notesForCleaner ? (
          <p className="mt-3 rounded-md border border-[var(--border)] bg-[var(--background)] p-2 text-sm text-[var(--muted-foreground)]">
            {detail.job.notesForCleaner}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/review/jobs/${detail.job._id}/photos-review`}
            className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)]"
          >
            Open Photo Review
          </Link>
          <Link href="/review" className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs">
            Back to Queue
          </Link>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-3 text-sm">Before photos: {beforeCount}</div>
        <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-3 text-sm">After photos: {afterCount}</div>
        <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-3 text-sm">Incident photos: {incidentCount}</div>
      </section>

      <section className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
        <h3 className="text-sm font-semibold">Latest Submission Validation</h3>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          Submitted: {formatDateTime(detail.evidence.latestSubmission?.submittedAtServer)}
        </p>
        {validation ? (
          <div className="mt-2 space-y-1 text-xs">
            <p>Mode: {validation.mode}</p>
            <p>Pass: {validation.pass ? "Yes" : "No"}</p>
            {validation.errors.length > 0 ? <p>Errors: {validation.errors.join(" ")}</p> : null}
            {validation.warnings.length > 0 ? <p>Warnings: {validation.warnings.join(" ")}</p> : null}
          </div>
        ) : (
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">No validation snapshot available.</p>
        )}
      </section>

      <section className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
        <h3 className="text-sm font-semibold">Decision Actions</h3>

        {detail.job.status === "awaiting_approval" ? (
          <div className="mt-3 space-y-3">
            <textarea
              value={approvalNotes}
              onChange={(event) => setApprovalNotes(event.target.value)}
              rows={2}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
              placeholder="Approval notes (optional)"
            />
            <textarea
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              rows={2}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
              placeholder="Rejection reason"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                onClick={async () => {
                  setPending(true);
                  setError(null);
                  setSuccess(null);
                  try {
                    await approveCompletion({
                      jobId,
                      approvalNotes: approvalNotes.trim() || undefined,
                    });
                    setSuccess("Job approved.");
                    router.refresh();
                  } catch (actionError) {
                    setError(getErrorMessage(actionError, "Unable to approve job."));
                  } finally {
                    setPending(false);
                  }
                }}
              >
                {pending ? "Working..." : "Approve Job"}
              </button>

              <button
                type="button"
                disabled={pending}
                className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                onClick={async () => {
                  setPending(true);
                  setError(null);
                  setSuccess(null);
                  try {
                    await rejectCompletion({
                      jobId,
                      rejectionReason: rejectionReason.trim() || "Rejected from scoped reviewer app.",
                    });
                    setSuccess("Job rejected to rework.");
                    router.refresh();
                  } catch (actionError) {
                    setError(getErrorMessage(actionError, "Unable to reject job."));
                  } finally {
                    setPending(false);
                  }
                }}
              >
                {pending ? "Working..." : "Reject to Rework"}
              </button>
            </div>
          </div>
        ) : null}

        {detail.job.status === "completed" ? (
          <div className="mt-3 space-y-3">
            <textarea
              value={reopenReason}
              onChange={(event) => setReopenReason(event.target.value)}
              rows={2}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
              placeholder="Reason for reopening"
            />
            <button
              type="button"
              disabled={pending}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              onClick={async () => {
                setPending(true);
                setError(null);
                setSuccess(null);
                try {
                  await reopenCompleted({
                    jobId,
                    reason: reopenReason.trim() || "Reopened from scoped reviewer app.",
                  });
                  setSuccess("Job reopened to rework.");
                  router.refresh();
                } catch (actionError) {
                  setError(getErrorMessage(actionError, "Unable to reopen job."));
                } finally {
                  setPending(false);
                }
              }}
            >
              {pending ? "Working..." : "Reopen Completed Job"}
            </button>
          </div>
        ) : null}

        {detail.job.status !== "awaiting_approval" && detail.job.status !== "completed" ? (
          <p className="mt-3 text-xs text-[var(--muted-foreground)]">
            Decision actions are only available for Awaiting Approval and Completed jobs.
          </p>
        ) : null}

        {error ? <p className="mt-3 text-xs text-[var(--destructive)]">{error}</p> : null}
        {success ? <p className="mt-3 text-xs text-emerald-300">{success}</p> : null}
      </section>
    </div>
  );
}
