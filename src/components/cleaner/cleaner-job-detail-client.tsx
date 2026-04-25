"use client";

import { useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { JobConversationPanel } from "@/components/conversations/job-conversation-panel";
import {
  CleanerSection,
  CleanerStatusPill,
  formatCleanerDate,
  formatCleanerShortDate,
  formatCleanerTimeRange,
  mapJobAppearance,
  useCountdown,
} from "@/components/cleaner/cleaner-ui";
import { getErrorMessage } from "@/lib/errors";
import {
  AlertTriangle,
  Camera,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  Loader2,
  MapPin,
  Play,
} from "lucide-react";

type Acknowledgement = {
  cleanerId: string;
  state: "pending" | "accepted" | "declined" | "expired";
  expiresAt: number;
  respondedAt?: number;
  reason?: string;
};

type JobDetailData = {
  job: {
    _id: string;
    status: string;
    scheduledStartAt: number;
    scheduledEndAt?: number | null;
    notesForCleaner?: string | null;
    assignedCleanerIds: string[];
    acknowledgements?: Acknowledgement[];
    stay?: {
      partyRiskFlag?: boolean;
      checkInAt?: number | null;
      checkOutAt?: number | null;
    } | null;
  };
  property?: {
    name?: string | null;
    address?: string | null;
    city?: string | null;
    timezone?: string | null;
    accessNotes?: string | null;
    keyLocation?: string | null;
    parkingNotes?: string | null;
    urgentNotes?: string | null;
  } | null;
  cleaners: Array<{
    _id?: string;
    name?: string | null;
    email?: string | null;
    avatarUrl?: string | null;
  }>;
  execution: { unresolvedCleanerIds: string[] };
  evidence: { current: { byType: { before: unknown[]; after: unknown[]; incident: unknown[] } } };
};

export function CleanerJobDetailClient({ id }: { id: string }) {
  const jobId = id as Id<"cleaningJobs">;
  const { isAuthenticated, isLoading } = useConvexAuth();
  const t = useTranslations();
  const router = useRouter();

  const detail = useQuery(
    api.cleaningJobs.queries.getMyJobDetail,
    isAuthenticated ? { jobId } : "skip",
  ) as JobDetailData | null | undefined;

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
  const [partyRiskExpanded, setPartyRiskExpanded] = useState(false);

  const myAck = useMemo(() => {
    const myId = profile?._id;
    if (!myId || !detail?.job.acknowledgements) return null;
    return detail.job.acknowledgements.find((ack) => ack.cleanerId === myId) ?? null;
  }, [detail?.job.acknowledgements, profile?._id]);

  const canStart = useMemo(() => {
    const status = detail?.job.status;
    if (!status) return false;
    if (myAck?.state === "declined") return false;
    return status === "scheduled" || status === "assigned" || status === "rework_required";
  }, [detail?.job.status, myAck?.state]);

  const canOpenExistingFlow = useMemo(() => {
    const status = detail?.job.status;
    return status === "in_progress" || status === "awaiting_approval" || status === "completed";
  }, [detail?.job.status]);

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

  const handlePrimaryAction = async () => {
    if (!detail) return;
    setPending(true);
    setError(null);
    try {
      if (canOpenExistingFlow) {
        router.push(`/cleaner/jobs/${detail.job._id}/active`);
        return;
      }
      if (!canStart) {
        return;
      }
      await startJob({
        jobId,
        startedAtDevice: Date.now(),
        offlineStartToken: `${jobId}-${Date.now()}`,
      });
      router.push(`/cleaner/jobs/${detail.job._id}/active`);
    } catch (mutationError) {
      setError(getErrorMessage(mutationError, t("cleaner.startJobError")));
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

  const { formatted: countdownLabel } = useCountdown(
    detail?.job.scheduledStartAt ?? null,
  );

  if (isLoading || !isAuthenticated || detail === undefined) {
    return <p className="text-sm text-[var(--muted-foreground)]">{t("cleaner.jobDetailLoading")}</p>;
  }

  if (!detail) {
    return <p className="text-sm text-[var(--muted-foreground)]">{t("cleaner.jobNotFound")}</p>;
  }

  const timezone = detail.property?.timezone ?? null;
  const scheduledDate = detail.job.scheduledStartAt
    ? formatCleanerShortDate(detail.job.scheduledStartAt, timezone)
    : "";
  const scheduledRange = formatCleanerTimeRange(
    detail.job.scheduledStartAt,
    detail.job.scheduledEndAt ?? null,
    timezone,
  );

  const partyRiskFlag = detail.job.stay?.partyRiskFlag ?? false;
  const showActionFooter =
    detail.job.status !== "completed" && detail.job.status !== "cancelled";

  const primaryActionLabel =
    detail.job.status === "awaiting_approval"
      ? t("cleaner.viewSubmission")
      : detail.job.status === "in_progress"
        ? t("cleaner.resumeJob")
        : t("cleaner.start");

  const canTriggerPrimaryAction = canOpenExistingFlow || canStart;

  const mapAddress = [detail.property?.address, detail.property?.city]
    .filter(Boolean)
    .join(", ");
  const mapsHref = mapAddress
    ? `https://maps.google.com/maps?q=${encodeURIComponent(mapAddress)}`
    : null;

  return (
    <div className="space-y-4">
      <CleanerSection eyebrow={t("cleaner.jobDetail")} title={detail.property?.name ?? t("cleaner.unknownProperty")}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-base text-[var(--cleaner-muted)]">{detail.property?.address ?? t("cleaner.noAddress")}</p>
          <CleanerStatusPill
            appearance={mapJobAppearance(detail.job.status)}
            label={getStatusLabel(detail.job.status)}
          />
        </div>

        <div className="mt-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="cleaner-meta text-[10px] text-[var(--cleaner-muted)]">
              {t("cleaner.scheduleLabel")}
            </p>
            {scheduledDate ? (
              <p className="mt-1 text-[44px] font-bold leading-[0.95] tracking-[-0.04em] text-[var(--cleaner-ink)] cleaner-display">
                {scheduledDate}
              </p>
            ) : null}
            <p className="mt-1 text-[14px] text-[var(--cleaner-muted)]">
              {scheduledRange}
            </p>
          </div>
          <p className="shrink-0 pt-1 text-[28px] font-bold tracking-[-0.03em] text-[var(--cleaner-ink)] cleaner-display">
            {countdownLabel}
          </p>
        </div>

        <div className="mt-4 space-y-2 text-sm">
          <p className="text-[var(--cleaner-ink)]">
            <span className="text-[var(--cleaner-muted)]">{t("cleaner.assignedCleanersLine")} </span>
            {detail.cleaners.length
              ? detail.cleaners.map((cleaner) => cleaner.name ?? cleaner.email ?? cleaner._id).join(", ")
              : t("cleaner.unassigned")}
          </p>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
          <div className="flex items-center gap-2 rounded-[16px] border border-[var(--border)] bg-[var(--muted)]/35 px-3 py-2">
            <Camera className="h-4 w-4 text-[var(--cleaner-muted)]" />
            <span className="text-[14px] text-[var(--cleaner-muted)]">{t("cleaner.before")}</span>
            <span className="ml-auto text-[20px] font-semibold leading-none text-[var(--cleaner-ink)]">
              {detail.evidence.current.byType.before.length}
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-[16px] border border-[var(--border)] bg-[var(--muted)]/35 px-3 py-2">
            <Camera className="h-4 w-4 text-[var(--cleaner-muted)]" />
            <span className="text-[14px] text-[var(--cleaner-muted)]">{t("cleaner.after")}</span>
            <span className="ml-auto text-[20px] font-semibold leading-none text-[var(--cleaner-ink)]">
              {detail.evidence.current.byType.after.length}
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-[16px] border border-[var(--border)] bg-[var(--muted)]/35 px-3 py-2">
            <Camera className="h-4 w-4 text-[var(--cleaner-muted)]" />
            <span className="text-[14px] text-[var(--cleaner-muted)]">{t("cleaner.incidentsLabel")}</span>
            <span className="ml-auto text-[20px] font-semibold leading-none text-[var(--cleaner-ink)]">
              {detail.evidence.current.byType.incident.length}
            </span>
          </div>
        </div>

        {partyRiskFlag ? (
          <button
            type="button"
            onClick={() => setPartyRiskExpanded((value) => !value)}
            className="mt-4 w-full rounded-[16px] border border-[#e11d4850] bg-[#e11d480f] p-4 text-left"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-[#e11d48]" />
              <p className="flex-1 text-[26px] font-semibold tracking-[-0.02em] text-[#e11d48] cleaner-display">
                {t("cleaner.partyRiskFlagShort")}
              </p>
              {partyRiskExpanded ? (
                <ChevronUp className="h-4 w-4 text-[#e11d48]" />
              ) : (
                <ChevronDown className="h-4 w-4 text-[#e11d48]" />
              )}
            </div>
            <p className="mt-1 pl-7 text-sm text-[#9f1239]">
              {partyRiskExpanded ? t("cleaner.partyRiskMessage") : t("cleaner.tapForDetails")}
            </p>
          </button>
        ) : null}

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
            ✓ {t("cleaner.ackAccepted")}
          </p>
        ) : null}
        {myAck?.state === "declined" ? (
          <p className="mt-3 text-xs font-medium text-[var(--destructive)]">
            {t("cleaner.ackDeclined")}
            {myAck.reason ? ` — ${myAck.reason}` : null}
          </p>
        ) : null}
        {myAck?.state === "expired" ? (
          <p className="mt-3 text-xs font-medium text-[var(--destructive)]">
            {t("cleaner.ackExpired")}
          </p>
        ) : null}

        {detail.execution.unresolvedCleanerIds.length > 0 ? (
          <p className="mt-3 text-xs font-medium text-[var(--cleaner-ink)]">
            {t("cleaner.submissionGatePending", { count: detail.execution.unresolvedCleanerIds.length })}
          </p>
        ) : null}

        {error ? <p className="mt-2 text-xs text-[var(--destructive)]">{error}</p> : null}
      </CleanerSection>

      <JobConversationPanel
        jobId={jobId}
        fullHrefBase="/cleaner/messages"
        compact
      />

      {mapsHref ? (
        <CleanerSection eyebrow={t("cleaner.addressLabel")}>
          <a
            href={mapsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3"
          >
            <MapPin className="h-5 w-5 text-[var(--cleaner-muted)]" />
            <span className="flex-1 truncate text-[18px] font-medium text-[var(--cleaner-primary)] underline decoration-[var(--cleaner-primary)]/30 underline-offset-2">
              {mapAddress}
            </span>
            <ExternalLink className="h-4 w-4 text-[var(--cleaner-muted)]" />
          </a>
        </CleanerSection>
      ) : null}

      {showActionFooter ? (
        <button
          type="button"
          disabled={!canTriggerPrimaryAction || pending}
          onClick={() => void handlePrimaryAction()}
          className="flex w-full items-center justify-center gap-2 rounded-[16px] bg-[var(--cleaner-primary)] px-4 py-4 text-[30px] font-semibold tracking-[-0.02em] text-white cleaner-display disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : detail.job.status === "awaiting_approval" ? (
            <Eye className="h-5 w-5" />
          ) : (
            <Play className="h-5 w-5" />
          )}
          <span>{primaryActionLabel}</span>
        </button>
      ) : null}

      {detail.job.notesForCleaner ? (
        <CleanerSection eyebrow={t("cleaner.notesLabel")}>
          <p className="whitespace-pre-line text-sm text-[var(--cleaner-ink)]">
            {detail.job.notesForCleaner}
          </p>
        </CleanerSection>
      ) : null}

    </div>
  );
}
