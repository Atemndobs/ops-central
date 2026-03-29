"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Loader2,
  Users,
  XCircle,
} from "lucide-react";
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
    return (
      <div className="flex min-h-48 items-center justify-center text-sm text-[var(--muted-foreground)]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading review detail...
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--card)] px-4 py-12 text-center text-sm text-[var(--muted-foreground)]">
        Job not found.
      </div>
    );
  }

  const beforeCount = detail.evidence.current.byType.before.length;
  const afterCount = detail.evidence.current.byType.after.length;
  const incidentCount = detail.evidence.current.byType.incident.length;
  const validation = detail.evidence.latestSubmission?.validationResult;
  const propertyName = detail.property?.name ?? "Unknown property";

  async function handleApprove() {
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      await approveCompletion({
        jobId,
        approvalNotes: approvalNotes.trim() || undefined,
      });
      setSuccess("Job approved successfully.");
      setTimeout(() => router.push("/review"), 1200);
    } catch (actionError) {
      setError(getErrorMessage(actionError, "Unable to approve job."));
    } finally {
      setPending(false);
    }
  }

  async function handleReject() {
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      await rejectCompletion({
        jobId,
        rejectionReason: rejectionReason.trim() || "Rejected — needs rework.",
      });
      setSuccess("Job sent back for rework.");
      setTimeout(() => router.push("/review"), 1200);
    } catch (actionError) {
      setError(getErrorMessage(actionError, "Unable to reject job."));
    } finally {
      setPending(false);
    }
  }

  async function handleReopen() {
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      await reopenCompleted({
        jobId,
        reason: reopenReason.trim() || "Reopened for rework.",
      });
      setSuccess("Job reopened.");
      setTimeout(() => router.push("/review"), 1200);
    } catch (actionError) {
      setError(getErrorMessage(actionError, "Unable to reopen job."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        <Link href="/review" className="hover:text-[var(--foreground)]">Review Queue</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-[var(--foreground)]">{propertyName}</span>
      </nav>

      {/* Header card */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">{propertyName}</h1>
            <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">{detail.property?.address ?? "No address"}</p>
            <p className="mt-1 font-mono text-[11px] text-[var(--muted-foreground)]">{detail.job._id.slice(-8)}</p>
          </div>
          <span className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${STATUS_CLASSNAMES[detail.job.status]}`}>
            {STATUS_LABELS[detail.job.status]}
          </span>
        </div>

        <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-[var(--muted-foreground)]" />
            <span className="text-[var(--muted-foreground)]">Scheduled:</span>
            <span>{formatDateTime(detail.job.scheduledStartAt)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[var(--muted-foreground)]">Revision:</span>
            <span>{detail.job.currentRevision ?? 1}</span>
          </div>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-[var(--muted-foreground)]" />
            <span className="text-[var(--muted-foreground)]">Cleaners:</span>
            <span>
              {detail.cleaners.length
                ? detail.cleaners.map((c) => c.name ?? c.email ?? c._id).join(", ")
                : "Unassigned"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[var(--muted-foreground)]">Pending sessions:</span>
            <span>{detail.execution.unresolvedCleanerIds.length}</span>
          </div>
        </div>

        {detail.job.notesForCleaner ? (
          <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-sm text-[var(--muted-foreground)]">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider">Notes for cleaner</p>
            {detail.job.notesForCleaner}
          </div>
        ) : null}
      </section>

      {/* Photo evidence — clickable cards */}
      <section className="grid gap-3 sm:grid-cols-3">
        <Link
          href={`/review/jobs/${detail.job._id}/photos-review`}
          className="group flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 transition hover:border-[var(--primary)]/40 hover:shadow-md"
        >
          <Camera className="h-5 w-5 text-blue-400" />
          <div>
            <p className="text-xs text-[var(--muted-foreground)]">Before</p>
            <p className="text-xl font-bold">{beforeCount}</p>
          </div>
        </Link>
        <Link
          href={`/review/jobs/${detail.job._id}/photos-review`}
          className="group flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 transition hover:border-[var(--primary)]/40 hover:shadow-md"
        >
          <Camera className="h-5 w-5 text-emerald-400" />
          <div>
            <p className="text-xs text-[var(--muted-foreground)]">After</p>
            <p className="text-xl font-bold">{afterCount}</p>
          </div>
        </Link>
        <Link
          href={`/review/jobs/${detail.job._id}/photos-review`}
          className="group flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 transition hover:border-[var(--primary)]/40 hover:shadow-md"
        >
          <AlertTriangle className="h-5 w-5 text-amber-400" />
          <div>
            <p className="text-xs text-[var(--muted-foreground)]">Incidents</p>
            <p className="text-xl font-bold">{incidentCount}</p>
          </div>
        </Link>
      </section>

      {/* Validation */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
          Submission Validation
        </h2>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          Submitted: {formatDateTime(detail.evidence.latestSubmission?.submittedAtServer)}
        </p>

        {validation ? (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              {validation.pass ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              ) : (
                <XCircle className="h-4 w-4 text-rose-400" />
              )}
              <span className="font-semibold">{validation.pass ? "Passed" : "Failed"}</span>
              <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--muted-foreground)]">
                {validation.mode}
              </span>
            </div>

            {validation.errors.length > 0 ? (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
                <p className="mb-1 text-xs font-semibold text-rose-400">Errors</p>
                <ul className="list-inside list-disc space-y-0.5 text-xs text-rose-300">
                  {validation.errors.map((err, idx) => (
                    <li key={idx}>{err}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {validation.warnings.length > 0 ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="mb-1 text-xs font-semibold text-amber-400">Warnings</p>
                <ul className="list-inside list-disc space-y-0.5 text-xs text-amber-300">
                  {validation.warnings.map((warn, idx) => (
                    <li key={idx}>{warn}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-[var(--border)] p-4 text-xs text-[var(--muted-foreground)]">
            No validation snapshot available.
          </p>
        )}
      </section>

      {/* Decision actions */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
          Decision
        </h2>

        {detail.job.status === "awaiting_approval" ? (
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Approval notes (optional)</label>
              <textarea
                value={approvalNotes}
                onChange={(event) => setApprovalNotes(event.target.value)}
                rows={2}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                placeholder="Great job, everything looks clean."
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Rejection reason (required to reject)</label>
              <textarea
                value={rejectionReason}
                onChange={(event) => setRejectionReason(event.target.value)}
                rows={2}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                placeholder="Kitchen counters not wiped, bathroom mirror has spots."
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={pending}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                onClick={handleApprove}
              >
                {pending ? "Working..." : "Approve Job"}
              </button>
              <button
                type="button"
                disabled={pending}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
                onClick={handleReject}
              >
                {pending ? "Working..." : "Reject to Rework"}
              </button>
            </div>
          </div>
        ) : null}

        {detail.job.status === "completed" ? (
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Reason for reopening</label>
              <textarea
                value={reopenReason}
                onChange={(event) => setReopenReason(event.target.value)}
                rows={2}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                placeholder="Guest reported issues after checkout."
              />
            </div>
            <button
              type="button"
              disabled={pending}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:opacity-50"
              onClick={handleReopen}
            >
              {pending ? "Working..." : "Reopen Completed Job"}
            </button>
          </div>
        ) : null}

        {detail.job.status !== "awaiting_approval" && detail.job.status !== "completed" ? (
          <p className="mt-4 rounded-lg border border-dashed border-[var(--border)] p-4 text-xs text-[var(--muted-foreground)]">
            Decision actions are only available for jobs in &quot;Awaiting Approval&quot; or &quot;Completed&quot; status.
          </p>
        ) : null}

        {error ? <p className="mt-3 text-sm text-[var(--destructive)]">{error}</p> : null}
        {success ? (
          <p className="mt-3 text-sm text-emerald-400">
            {success} Redirecting to queue...
          </p>
        ) : null}
      </section>
    </div>
  );
}
