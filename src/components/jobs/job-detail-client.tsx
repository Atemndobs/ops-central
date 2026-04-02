"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useAuth, useUser } from "@clerk/nextjs";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  STATUS_CLASSNAMES,
  STATUS_LABELS,
  WORKFLOW_STEPS,
  getNextStatus,
  type JobStatus,
} from "@/components/jobs/job-status";
import { Check, UserPlus } from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";
import { getRoleFromMetadata, getRoleFromSessionClaimsOrNull } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";

function formatDateTime(value?: number | null) {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString();
}

function formatDuration(ms?: number | null) {
  if (ms == null || ms < 0) {
    return "—";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((chunk) => chunk.toString().padStart(2, "0"))
    .join(":");
}

function computeElapsedMs({
  startedAt,
  endedAt,
  now,
}: {
  startedAt?: number | null;
  endedAt?: number | null;
  now: number;
}) {
  if (!startedAt) {
    return null;
  }
  return Math.max(0, (endedAt ?? now) - startedAt);
}

function getWorkflowStepIndex(status: JobStatus) {
  if (status === "rework_required") {
    return WORKFLOW_STEPS.indexOf("in_progress");
  }
  return WORKFLOW_STEPS.indexOf(status);
}

function getAssignWarnings(result: unknown): string[] {
  if (!result || typeof result !== "object") {
    return [];
  }
  const warnings = (result as { warnings?: unknown }).warnings;
  if (!Array.isArray(warnings)) {
    return [];
  }
  return warnings.filter((warning): warning is string => typeof warning === "string");
}

export function JobDetailClient({ id }: { id: string }) {
  const { isAuthenticated } = useConvexAuth();
  const { isLoaded: isClerkLoaded, isSignedIn, sessionClaims, userId } = useAuth();
  const { user } = useUser();
  const jobId = id as Id<"cleaningJobs">;
  const convexUser = useQuery(
    api.users.queries.getByClerkId,
    isAuthenticated && isClerkLoaded && isSignedIn && userId
      ? { clerkId: userId }
      : "skip",
  );
  const roleFromClaims = getRoleFromSessionClaimsOrNull(
    (sessionClaims as Record<string, unknown> | null | undefined) ?? null,
  );
  const roleFromMetadata = getRoleFromMetadata(user?.publicMetadata);
  const currentRole = roleFromClaims ?? roleFromMetadata ?? convexUser?.role ?? "manager";

  const detail = useQuery(api.cleaningJobs.queries.getJobDetail, isAuthenticated ? { jobId } : "skip");
  const livePresence = useQuery(api.cleaningJobs.queries.getJobLivePresence, isAuthenticated ? { jobId } : "skip");

  const startJob = useMutation(api.cleaningJobs.mutations.start);
  const submitForApproval = useMutation(api.cleaningJobs.mutations.submitForApproval);
  const excuseCleanerSession = useMutation(
    api.cleaningJobs.mutations.excuseCleanerSession,
  );
  const approveCompletion = useMutation(api.cleaningJobs.approve.approveCompletion);
  const rejectCompletion = useMutation(api.cleaningJobs.approve.rejectCompletion);
  const reopenCompleted = useMutation(api.cleaningJobs.approve.reopenCompleted);
  const assignCleaner = useMutation(api.cleaningJobs.mutations.assign);

  const [cleanerId, setCleanerId] = useState("");
  const [assignPanelOpen, setAssignPanelOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const { showToast } = useToast();

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setClockNow(Date.now());
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  // Only show cleaners from the company assigned to this property
  const assignableForProperty = useQuery(
    api.cleaningJobs.queries.getAssignableCleanersByProperty,
    isAuthenticated && detail?.job.propertyId
      ? { propertyIds: [detail.job.propertyId] }
      : "skip",
  );
  const scopedCleaners = assignableForProperty?.[0]?.cleaners ?? [];
  const assignedCompanyName = assignableForProperty?.[0]?.companyName ?? null;

  const cleanerJobs = useQuery(
    api.cleaningJobs.queries.getForCleaner,
    detail?.job.assignedCleanerIds?.[0]
      ? { cleanerId: detail.job.assignedCleanerIds[0] }
      : "skip",
  );
  const propertyJobs = useQuery(
    api.cleaningJobs.queries.getAll,
    detail?.job.propertyId ? { propertyId: detail.job.propertyId } : "skip",
  );

  const canonicalJob = detail?.job;
  const nextStatus = useMemo(
    () => (canonicalJob ? getNextStatus(canonicalJob.status) : null),
    [canonicalJob],
  );

  const currentBefore = detail?.evidence.current.byType.before ?? [];
  const currentAfter = detail?.evidence.current.byType.after ?? [];
  const currentIncidents = detail?.evidence.current.byType.incident ?? [];
  const latestSubmissionPhotos = detail?.evidence.latestSubmission?.photos ?? [];

  const beforePhotos = currentBefore.length
    ? currentBefore
    : latestSubmissionPhotos.filter((photo) => photo.type === "before");
  const afterPhotos = currentAfter.length
    ? currentAfter
    : latestSubmissionPhotos.filter((photo) => photo.type === "after");
  const submissionFallbackInUse =
    currentBefore.length === 0 &&
    currentAfter.length === 0 &&
    latestSubmissionPhotos.length > 0;

  if (detail === undefined) {
    return <div className="text-sm text-[var(--muted-foreground)]">Loading job...</div>;
  }

  if (!detail || !canonicalJob) {
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
        await startJob({ jobId });
      } else if (canonicalJob.status === "in_progress") {
        const result = await submitForApproval({ jobId });
        if (!result.ok) {
          const unresolved = result.unresolvedCleanerIds.length;
          const message = `Cannot submit yet. ${unresolved} cleaner session(s) still pending.`;
          setError(message);
          showToast(message, "error");
          return;
        }
      } else if (canonicalJob.status === "awaiting_approval") {
        await approveCompletion({ jobId });
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
      const result = await assignCleaner({
        jobId,
        cleanerIds: [cleanerId as Id<"users">],
        notifyCleaners: false,
        source: "job_detail_assign",
        returnWarnings: true,
      });
      setCleanerId("");
      showToast("Cleaner assigned.");
      const warnings = getAssignWarnings(result);
      if (warnings.length > 0) {
        showToast(`Dispatch warning: ${warnings.join(" ")}`, "error");
      }
    } catch (assignError) {
      const message = getErrorMessage(assignError, "Unable to assign cleaner.");
      setError(message);
      showToast(message, "error");
    } finally {
      setPending(false);
    }
  }

  async function onRejectOrReopen() {
    if (!canonicalJob) {
      return;
    }

    setError(null);
    setPending(true);
    try {
      if (canonicalJob.status === "awaiting_approval") {
        await rejectCompletion({
          jobId,
          rejectionReason: "Rejected from admin dashboard for rework.",
        });
        showToast("Submission rejected and reopened for rework.");
      } else if (canonicalJob.status === "completed") {
        await reopenCompleted({
          jobId,
          reason: "Reopened from admin dashboard.",
        });
        showToast("Completed job reopened for rework.");
      }
    } catch (mutationError) {
      const message = getErrorMessage(mutationError, "Unable to reopen job.");
      setError(message);
      showToast(message, "error");
    } finally {
      setPending(false);
    }
  }

  async function onForceStopAsAdmin() {
    if (!canonicalJob || canonicalJob.status !== "in_progress") {
      return;
    }

    setError(null);
    setPending(true);
    try {
      const pendingSessions = (livePresence?.sessions ?? []).filter(
        (session) => session.status === "started",
      );

      for (const session of pendingSessions) {
        await excuseCleanerSession({
          jobId,
          cleanerId: session.cleanerId,
          reason: "Force-stopped by admin after cleaner session was left running.",
        });
      }

      const result = await submitForApproval({
        jobId,
        force: true,
        notes: "Force-submitted by admin after stopping pending cleaner session(s).",
      });

      if (!result.ok) {
        const message = "Unable to force-submit this job for approval.";
        setError(message);
        showToast(message, "error");
        return;
      }

      showToast("Pending cleaner session(s) stopped. Job moved to Awaiting Approval.");
    } catch (mutationError) {
      const message = getErrorMessage(
        mutationError,
        "Unable to force-stop and submit this job.",
      );
      setError(message);
      showToast(message, "error");
    } finally {
      setPending(false);
    }
  }

  const currentStepIndex = getWorkflowStepIndex(canonicalJob.status);
  const canRejectOrReopen =
    canonicalJob.status === "awaiting_approval" || canonicalJob.status === "completed";
  const canForceStopAsAdmin =
    currentRole === "admin" &&
    canonicalJob.status === "in_progress" &&
    (livePresence?.summary.pendingCount ?? 0) > 0;
  const assignButtonLabel = detail.cleaners.length
    ? detail.cleaners.length === 1
      ? (detail.cleaners[0]?.name?.trim() || "1 Assigned")
      : `${detail.cleaners.length} Assigned`
    : "Assign";
  const liveElapsedMs = computeElapsedMs({
    startedAt: detail.timing.startedAtServer,
    endedAt: detail.timing.endedAtServer,
    now: clockNow,
  });

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
                <p className="font-mono text-xs text-[var(--muted-foreground)]">
                  {canonicalJob._id}
                </p>
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
                {detail.property?.name ?? "Unknown property"}
              </p>
              <p>
                <span className="text-[var(--muted-foreground)]">Address:</span>{" "}
                {detail.property?.address ?? "—"}
              </p>
              <p>
                <span className="text-[var(--muted-foreground)]">Assigned:</span>{" "}
                {detail.cleaners.length
                  ? detail.cleaners
                      .map((cleaner) => cleaner?.name || `Cleaner ${cleaner?._id.slice(-6)}`)
                      .join(", ")
                  : "Unassigned"}
              </p>
              <p>
                <span className="text-[var(--muted-foreground)]">Scheduled:</span>{" "}
                {formatDateTime(canonicalJob.scheduledStartAt)}
              </p>
              <p>
                <span className="text-[var(--muted-foreground)]">Revision:</span>{" "}
                {detail.currentRevision}
              </p>
              <p>
                <span className="text-[var(--muted-foreground)]">Notes:</span>{" "}
                {canonicalJob.notesForCleaner || "—"}
              </p>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {/* Only show advance button when there IS a next status */}
              {nextStatus ? (
                <button
                  onClick={onAdvanceStatus}
                  disabled={pending}
                  className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  Move to {STATUS_LABELS[nextStatus]}
                </button>
              ) : null}

              {canForceStopAsAdmin ? (
                <button
                  onClick={onForceStopAsAdmin}
                  disabled={pending}
                  className="rounded-md border border-amber-500 px-3 py-1.5 text-sm text-amber-600 hover:bg-amber-50 disabled:opacity-50"
                >
                  Force Stop
                </button>
              ) : null}

              {canRejectOrReopen ? (
                <button
                  onClick={onRejectOrReopen}
                  disabled={pending}
                  className="rounded-md border border-[var(--destructive)] px-3 py-1.5 text-sm text-[var(--destructive)] disabled:opacity-50"
                >
                  {canonicalJob.status === "awaiting_approval"
                    ? "Reject"
                    : "Rework"}
                </button>
              ) : null}

              {/* Assign cleaner: icon button → inline panel (consistent with calendar quick-assign) */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setAssignPanelOpen((v) => !v)}
                  className="flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--accent)]"
                  title={assignedCompanyName ? `Assign cleaner from ${assignedCompanyName}` : "Assign cleaner"}
                >
                  <UserPlus className="h-4 w-4" />
                  <span className="max-w-36 truncate">{assignButtonLabel}</span>
                </button>
                {assignPanelOpen ? (
                  <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded-md border bg-[var(--card)] p-2 shadow-xl">
                    {assignedCompanyName ? (
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                        {assignedCompanyName}
                      </p>
                    ) : null}
                    {scopedCleaners.length === 0 ? (
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {assignedCompanyName ? "No cleaners in this company" : "No company assigned to property"}
                      </p>
                    ) : (
                      <div className="space-y-0.5">
                        {scopedCleaners.map((cleaner) => {
                          const alreadyAssigned = canonicalJob.assignedCleanerIds?.includes(cleaner._id as Id<"users">);
                          return (
                            <button
                              key={cleaner._id}
                              type="button"
                              disabled={pending}
                              onClick={async () => {
                                setCleanerId(cleaner._id);
                                setError(null);
                                setPending(true);
                                try {
                                  const result = await assignCleaner({
                                    jobId,
                                    cleanerIds: [cleaner._id as Id<"users">],
                                    notifyCleaners: false,
                                    source: "job_detail_assign",
                                    returnWarnings: true,
                                  });
                                  showToast("Cleaner assigned.");
                                  const warnings = getAssignWarnings(result);
                                  if (warnings.length > 0) showToast(`Warning: ${warnings.join(" ")}`, "error");
                                  setAssignPanelOpen(false);
                                } catch (e) {
                                  const msg = getErrorMessage(e, "Unable to assign cleaner.");
                                  setError(msg);
                                  showToast(msg, "error");
                                } finally {
                                  setPending(false);
                                  setCleanerId("");
                                }
                              }}
                              className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--accent)] disabled:opacity-60"
                            >
                              <span className="truncate">{cleaner.name ?? `Cleaner ${cleaner._id.slice(-6)}`}</span>
                              {alreadyAssigned ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" /> : null}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              {/* Review Photos — only when job has progressed past assignment (photos may exist) */}
              {["in_progress", "awaiting_approval", "completed", "rework_required"].includes(canonicalJob.status) ? (
                <Link
                  href={`/jobs/${canonicalJob._id}/photos-review`}
                  className="rounded-md border border-blue-700 bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
                >
                  Review
                </Link>
              ) : null}
            </div>

            {error ? <p className="mt-3 text-sm text-[var(--destructive)]">{error}</p> : null}
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
            <h3 className="mb-3 text-sm font-semibold">Execution Timing</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-[var(--border)] p-3">
                <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                  Started (Server)
                </p>
                <p className="mt-2 text-sm font-semibold">
                  {formatDateTime(detail.timing.startedAtServer)}
                </p>
              </div>
              <div className="rounded-md border border-[var(--border)] p-3">
                <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                  Ended (Server)
                </p>
                <p className="mt-2 text-sm font-semibold">
                  {formatDateTime(detail.timing.endedAtServer)}
                </p>
              </div>
              <div className="rounded-md border border-[var(--border)] p-3">
                <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                  Elapsed
                </p>
                <p className="mt-2 font-mono text-sm font-semibold">
                  {formatDuration(liveElapsedMs ?? detail.timing.elapsedMs)}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-md border border-[var(--border)] p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                  Live Presence
                </p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Pending sessions: {livePresence?.summary.pendingCount ?? 0}
                </p>
              </div>
              {!livePresence?.sessions.length ? (
                <p className="text-sm text-[var(--muted-foreground)]">
                  No active cleaner sessions yet for revision {detail.currentRevision}.
                </p>
              ) : (
                <div className="space-y-2">
                  {livePresence.sessions.map((session) => {
                      const heartbeatAt = session.lastHeartbeatAt ?? session.startedAtServer;
                      const heartbeatAgeMs = Math.max(0, clockNow - heartbeatAt);
                      const heartbeatSeconds = Math.floor(heartbeatAgeMs / 1000);
                      const isStaleNow =
                        heartbeatAgeMs > (livePresence.staleAfterMs ?? 180_000);
                      const sessionEndAt =
                        session.status === "started"
                          ? clockNow
                          : session.submittedAtServer ?? session.lastHeartbeatAt ?? clockNow;
                      const sessionElapsedMs = computeElapsedMs({
                        startedAt: session.startedAtServer,
                        endedAt: sessionEndAt,
                        now: clockNow,
                      });

                    return (
                      <div
                        key={session._id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--border)] px-2 py-1.5 text-xs"
                      >
                        <div>
                          <span className="font-semibold">
                            {session.cleaner?.name ?? `Cleaner ${session.cleanerId.slice(-6)}`}
                          </span>{" "}
                          <span className="text-[var(--muted-foreground)]">
                            {session.status.replace("_", " ")}
                          </span>{" "}
                          <span className="text-[var(--muted-foreground)]">
                            since {formatDateTime(session.startedAtServer)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[var(--muted-foreground)]">
                            cleaning for {formatDuration(sessionElapsedMs)}
                          </span>
                          <span className="font-mono text-[var(--muted-foreground)]">
                            heartbeat {heartbeatSeconds}s ago
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 ${
                              isStaleNow
                                ? "bg-rose-100 text-rose-700"
                                : "bg-emerald-100 text-emerald-700"
                            }`}
                          >
                            {isStaleNow ? "stale" : "live"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
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

        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
            <h3 className="mb-3 text-sm font-semibold">Photo Gallery</h3>
            {submissionFallbackInUse ? (
              <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                Showing sealed evidence from latest submission revision.
              </p>
            ) : null}
            <div className="grid gap-4">
              <section>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  Before ({beforePhotos.length})
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {beforePhotos.map((photo, index) => (
                    <PhotoTile
                      key={`${photo.photoId}-${index}`}
                      url={photo.url}
                      label={photo.roomName}
                    />
                  ))}
                </div>
              </section>
              <section>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  After ({afterPhotos.length})
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {afterPhotos.map((photo, index) => (
                    <PhotoTile
                      key={`${photo.photoId}-${index}`}
                      url={photo.url}
                      label={photo.roomName}
                    />
                  ))}
                </div>
              </section>
              <section>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  Incident ({currentIncidents.length})
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {currentIncidents.map((photo, index) => (
                    <PhotoTile
                      key={`${photo.photoId}-${index}`}
                      url={photo.url}
                      label={photo.roomName}
                    />
                  ))}
                </div>
              </section>
            </div>
            {!beforePhotos.length && !afterPhotos.length && !currentIncidents.length ? (
              <p className="text-sm text-[var(--muted-foreground)]">
                No photos attached to this job.
              </p>
            ) : null}
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
            <h3 className="mb-3 text-sm font-semibold">Submission Chain</h3>
            {!detail.evidence.submissionHistory.length ? (
              <p className="text-sm text-[var(--muted-foreground)]">
                No submission snapshots yet.
              </p>
            ) : (
              <div className="space-y-2 text-xs">
                {detail.evidence.submissionHistory.map((submission) => (
                  <div key={submission._id} className="rounded border border-[var(--border)] p-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">Revision {submission.revision}</span>
                      <span className="text-[var(--muted-foreground)]">{submission.status}</span>
                    </div>
                    <p className="mt-1 text-[var(--muted-foreground)]">
                      Submitted {formatDateTime(submission.submittedAtServer)}
                    </p>
                    <p className="mt-1 text-[var(--muted-foreground)]">
                      Before {submission.beforeCount} · After {submission.afterCount} · Incident{" "}
                      {submission.incidentCount}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PhotoTile({ url, label }: { url: string | null; label: string }) {
  if (!url) {
    return (
      <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-[var(--border)] text-[10px] text-[var(--muted-foreground)]">
        Missing file URL
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="group overflow-hidden rounded-md border border-[var(--border)]"
    >
      <Image
        src={url}
        alt={label}
        width={320}
        height={160}
        className="h-24 w-full object-cover transition-transform group-hover:scale-105"
      />
      <p className="truncate border-t border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted-foreground)]">
        {label}
      </p>
    </a>
  );
}
