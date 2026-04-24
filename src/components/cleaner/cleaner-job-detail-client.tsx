"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { JobConversationPanel } from "@/components/conversations/job-conversation-panel";
import {
  CleanerAccessSection,
  CleanerSection,
  CleanerStatusPill,
  formatCleanerDate,
  mapJobAppearance,
} from "@/components/cleaner/cleaner-ui";
import { getErrorMessage } from "@/lib/errors";

type Acknowledgement = {
  cleanerId: string;
  state: "pending" | "accepted" | "declined" | "expired";
  expiresAt: number;
  respondedAt?: number;
  reason?: string;
};

export function CleanerJobDetailClient({ id }: { id: string }) {
  const jobId = id as Id<"cleaningJobs">;
  const { isAuthenticated, isLoading } = useConvexAuth();
  const t = useTranslations();

  const detail = useQuery(
    api.cleaningJobs.queries.getMyJobDetail,
    isAuthenticated ? { jobId } : "skip",
  ) as
    | {
        job: {
          _id: string;
          status: string;
          scheduledStartAt: number;
          notesForCleaner?: string;
          assignedCleanerIds: string[];
          acknowledgements?: Acknowledgement[];
        };
        property?: {
          name?: string | null;
          address?: string | null;
          accessNotes?: string | null;
          keyLocation?: string | null;
          parkingNotes?: string | null;
          urgentNotes?: string | null;
        } | null;
        cleaners: Array<{ _id?: string; name?: string | null; email?: string | null }>;
        execution: { unresolvedCleanerIds: string[] };
        evidence: { current: { byType: { before: unknown[]; after: unknown[]; incident: unknown[] } } };
      }
    | null
    | undefined;
  const profile = useQuery(
    api.users.queries.getMyProfile,
    isAuthenticated ? {} : "skip",
  ) as { _id?: string } | undefined | null;

  const startJob = useMutation(api.cleaningJobs.mutations.start);
  const acknowledge = useMutation(
    api.cleaningJobs.acknowledgements.acknowledge,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [declineError, setDeclineError] = useState<string | null>(null);

  const myAck = useMemo(() => {
    const myId = profile?._id;
    if (!myId || !detail?.job.acknowledgements) return null;
    return detail.job.acknowledgements.find((ack) => ack.cleanerId === myId) ?? null;
  }, [detail?.job.acknowledgements, profile?._id]);

  const canStart = useMemo(() => {
    const status = detail?.job.status;
    if (!status) return false;
    if (myAck?.state === "declined") return false;
    return status === "scheduled" || status === "assigned" || status === "rework_required" || status === "in_progress";
  }, [detail?.job.status, myAck?.state]);

  const handleAcknowledge = async (
    decision: "accept" | "decline",
    reason?: string,
  ) => {
    setPending(true);
    setError(null);
    try {
      await acknowledge({ jobId, decision, reason });
      setDeclineOpen(false);
      setDeclineReason("");
      setDeclineError(null);
    } catch (mutationError) {
      setError(getErrorMessage(mutationError, t("cleaner.acknowledgementError")));
    } finally {
      setPending(false);
    }
  };

  const getStatusLabel = (status: string) => {
    try {
      return t(`jobStatus.${status}`);
    } catch {
      return status.replace(/_/g, " ");
    }
  };

  if (isLoading || !isAuthenticated || detail === undefined) {
    return <p className="text-sm text-[var(--muted-foreground)]">{t("cleaner.jobDetailLoading")}</p>;
  }

  if (!detail) {
    return <p className="text-sm text-[var(--muted-foreground)]">{t("cleaner.jobNotFound")}</p>;
  }

  return (
    <div className="space-y-4">
      <CleanerSection eyebrow={t("cleaner.jobDetail")} title={detail.property?.name ?? t("cleaner.unknownProperty")}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-[var(--cleaner-muted)]">{detail.property?.address ?? t("cleaner.noAddress")}</p>
          <CleanerStatusPill
            appearance={mapJobAppearance(detail.job.status)}
            label={getStatusLabel(detail.job.status)}
          />
        </div>

        <div className="mt-4 space-y-2 text-sm">
          <p>
            <span className="text-[var(--muted-foreground)]">{t("cleaner.scheduledLabel")}</span> {formatCleanerDate(detail.job.scheduledStartAt)}
          </p>
          <p>
            <span className="text-[var(--muted-foreground)]">{t("cleaner.statusLabel")}</span> {getStatusLabel(detail.job.status)}
          </p>
          <p>
            <span className="text-[var(--muted-foreground)]">{t("cleaner.assignedCleanersLabel")}</span>{" "}
            {detail.cleaners.length
              ? detail.cleaners.map((cleaner) => cleaner.name ?? cleaner.email ?? cleaner._id).join(", ")
              : t("cleaner.unassigned")}
          </p>
          <p>
            <span className="text-[var(--muted-foreground)]">{t("cleaner.notesLabel")}</span> {detail.job.notesForCleaner ?? "—"}
          </p>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-[16px] border border-[var(--border)] bg-[var(--muted)]/35 p-3">
            {t("cleaner.active.before")}: {detail.evidence.current.byType.before.length}
          </div>
          <div className="rounded-[16px] border border-[var(--border)] bg-[var(--muted)]/35 p-3">
            {t("cleaner.active.after")}: {detail.evidence.current.byType.after.length}
          </div>
          <div className="rounded-[16px] border border-[var(--border)] bg-[var(--muted)]/35 p-3">
            {t("cleaner.active.incidents")}: {detail.evidence.current.byType.incident.length}
          </div>
        </div>

        {myAck?.state === "pending" ? (
          <div className="mt-4 rounded-[16px] border border-[var(--border)] bg-[var(--muted)]/25 p-3">
            <p className="text-sm font-medium text-[var(--cleaner-ink)]">
              {t("cleaner.acknowledgementPending")}
            </p>
            <p className="mt-1 text-xs text-[var(--cleaner-muted)]">
              {t("cleaner.acknowledgementExpiresAt", {
                time: formatCleanerDate(myAck.expiresAt),
              })}
            </p>
            {declineOpen ? (
              <div className="mt-3 space-y-2">
                <label className="block text-xs font-medium text-[var(--cleaner-ink)]">
                  {t("cleaner.declineReasonPrompt")}
                </label>
                <textarea
                  value={declineReason}
                  onChange={(event) => setDeclineReason(event.target.value)}
                  placeholder={t("cleaner.declineReasonPlaceholder")}
                  rows={2}
                  className="w-full rounded-[12px] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                />
                {declineError ? (
                  <p className="text-xs text-[var(--destructive)]">{declineError}</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      const trimmed = declineReason.trim();
                      if (!trimmed) {
                        setDeclineError(t("cleaner.declineReasonRequired"));
                        return;
                      }
                      void handleAcknowledge("decline", trimmed);
                    }}
                    className="cleaner-primary-button text-xs disabled:opacity-50"
                  >
                    {t("cleaner.submitResponse")}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setDeclineOpen(false);
                      setDeclineError(null);
                    }}
                    className="cleaner-outline-button text-xs disabled:opacity-50"
                  >
                    {t("cleaner.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void handleAcknowledge("accept")}
                  className="cleaner-primary-button text-xs disabled:opacity-50"
                >
                  {t("cleaner.acceptAssignment")}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setDeclineOpen(true);
                    setDeclineError(null);
                  }}
                  className="cleaner-outline-button text-xs disabled:opacity-50"
                >
                  {t("cleaner.declineAssignment")}
                </button>
              </div>
            )}
          </div>
        ) : null}

        {myAck?.state === "accepted" ? (
          <p className="mt-3 text-xs font-medium text-[var(--cleaner-ink)]">
            ✓ {t("cleaner.acknowledgementAccepted")}
          </p>
        ) : null}
        {myAck?.state === "declined" ? (
          <p className="mt-3 text-xs font-medium text-[var(--destructive)]">
            {t("cleaner.acknowledgementDeclined")}
            {myAck.reason ? ` — ${myAck.reason}` : null}
          </p>
        ) : null}
        {myAck?.state === "expired" ? (
          <p className="mt-3 text-xs font-medium text-[var(--destructive)]">
            {t("cleaner.acknowledgementExpired")}
          </p>
        ) : null}

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
                setError(getErrorMessage(mutationError, t("cleaner.startJobError")));
              } finally {
                setPending(false);
              }
            }}
            className="cleaner-outline-button text-xs disabled:opacity-50"
          >
            {t("cleaner.start")}
          </button>

          <Link
            href={`/cleaner/jobs/${detail.job._id}/active`}
            className="cleaner-primary-button text-xs"
          >
            {detail.job.status === "in_progress" ? t("cleaner.resume") : t("cleaner.openActiveFlow")}
          </Link>
        </div>

        {detail.execution.unresolvedCleanerIds.length > 0 ? (
          <p className="mt-3 text-xs font-medium text-[var(--cleaner-ink)]">
            {t("cleaner.submissionGatePending", { count: detail.execution.unresolvedCleanerIds.length })}
          </p>
        ) : null}

        {error ? <p className="mt-2 text-xs text-[var(--destructive)]">{error}</p> : null}
      </CleanerSection>

      <CleanerAccessSection
        accessNotes={detail.property?.accessNotes ?? null}
        keyLocation={detail.property?.keyLocation ?? null}
        parkingNotes={detail.property?.parkingNotes ?? null}
        urgentNotes={detail.property?.urgentNotes ?? null}
      />

      <JobConversationPanel
        jobId={jobId}
        fullHrefBase="/cleaner/messages"
        compact
      />
    </div>
  );
}
