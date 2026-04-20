"use client";

import { useEffect, useMemo, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { api } from "@convex/_generated/api";
import {
  CleanerJobCard,
  CleanerSection,
  CleanerSummaryCard,
  mapJobAppearance,
} from "@/components/cleaner/cleaner-ui";

const ACTIVE_JOB_STATUSES = new Set([
  "scheduled",
  "assigned",
  "in_progress",
  "rework_required",
  "awaiting_approval",
]);
const CLOSED_JOB_STATUSES = new Set(["completed", "cancelled"]);

export function CleanerHomeClient() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const t = useTranslations();
  const profile = useQuery(api.users.queries.getMyProfile, isAuthenticated ? {} : "skip");
  const jobs = useQuery(api.cleaningJobs.queries.getMyAssigned, isAuthenticated ? { limit: 200 } : "skip") as
    | Array<{
        _id: string;
        status: string;
        scheduledStartAt: number;
        scheduledEndAt?: number | null;
        property?: {
          name?: string | null;
          address?: string | null;
          city?: string | null;
          bedrooms?: number | null;
          bathrooms?: number | null;
        } | null;
        stay?: { numberOfGuests?: number | null; partyRiskFlag?: boolean } | null;
        notesForCleaner?: string;
      }>
    | undefined;
  const unreadMessageCount = useQuery(
    api.conversations.queries.getUnreadConversationCount,
    isAuthenticated ? {} : "skip",
  );
  const notifications = useQuery(
    api.notifications.queries.getMyNotifications,
    isAuthenticated ? { includeRead: false, limit: 20 } : "skip",
  ) as Array<{ dismissedAt?: number; readAt?: number }> | undefined;

  const activeJobs = useMemo(() => {
    const source = jobs ?? [];
    const active = source.filter((job) => ACTIVE_JOB_STATUSES.has(job.status));
    // Urgency order: rework first (must be fixed), then the next countdown job
    // and subsequent actionable jobs by soonest start, then awaiting-approval last.
    const statusPriority = (status: string) => {
      if (status === "rework_required") return 0;
      if (status === "awaiting_approval") return 2;
      return 1;
    };
    return active.sort((a, b) => {
      const priorityDiff = statusPriority(a.status) - statusPriority(b.status);
      if (priorityDiff !== 0) return priorityDiff;
      return a.scheduledStartAt - b.scheduledStartAt;
    });
  }, [jobs]);

  const closedJobs = useMemo(() => {
    const source = jobs ?? [];
    return source.filter((job) => CLOSED_JOB_STATUSES.has(job.status));
  }, [jobs]);

  const inReviewJobs = useMemo(
    () => activeJobs.filter((job) => job.status === "awaiting_approval").length,
    [activeJobs],
  );
  const updateCount = useMemo(
    () => (notifications ?? []).filter((item) => !item.readAt && !item.dismissedAt).length,
    [notifications],
  );
  const nextJobAt = useMemo(() => {
    if (activeJobs.length === 0) return null;
    const now = Date.now();
    const upcoming = activeJobs
      .filter((job) => job.scheduledStartAt > now)
      .sort((a, b) => a.scheduledStartAt - b.scheduledStartAt);
    return upcoming[0]?.scheduledStartAt ?? null;
  }, [activeJobs]);
  const msgCount = typeof unreadMessageCount === "number" ? unreadMessageCount : 0;
  const summaryTotal = activeJobs.length + inReviewJobs + msgCount + updateCount;

  const [isSummaryVisible, setIsSummaryVisible] = useState(true);

  // Emit the true summary total so the shell bell badge stays in sync
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("cleaner:summary-count", { detail: summaryTotal }),
    );
  }, [summaryTotal]);

  useEffect(() => {
    const handleToggle = () => {
      setIsSummaryVisible((current) => !current);
    };

    window.addEventListener("cleaner:toggle-summary", handleToggle);
    return () => {
      window.removeEventListener("cleaner:toggle-summary", handleToggle);
    };
  }, []);

  if (isLoading || !isAuthenticated || jobs === undefined) {
    return <p className="px-1 py-6 text-sm text-[var(--muted-foreground)]">{t("cleaner.loadingJobs")}</p>;
  }

  return (
    <div className="space-y-4">
      {isSummaryVisible ? (
        <CleanerSummaryCard
          nextJobs={activeJobs.length}
          inReview={inReviewJobs}
          unreadMessages={typeof unreadMessageCount === "number" ? unreadMessageCount : 0}
          updates={updateCount}
          onToggle={() => setIsSummaryVisible(false)}
          userName={profile?.name}
          nextJobAt={nextJobAt}
        />
      ) : null}

      <CleanerSection eyebrow={t("cleaner.today")} title={t("cleaner.myJobs")}>
        <p className="text-sm text-[var(--cleaner-muted)]">
          {activeJobs.length > 0
            ? t("cleaner.activeJobsSummary", { active: activeJobs.length, closed: closedJobs.length })
            : t("cleaner.noActiveJobs")}
        </p>
      </CleanerSection>

      {activeJobs.length === 0 ? (
        <CleanerSection title={t("cleaner.noActiveJobs")}>
          <p className="text-sm text-[var(--cleaner-muted)]">
            {t("cleaner.noActiveJobsHint")}
          </p>
        </CleanerSection>
      ) : (
        <div className="space-y-3">
          {activeJobs.map((job) => {
            const appearance = mapJobAppearance(job.status);
            const statusLabel =
              appearance === "open"
                ? t("cleaner.statusNewJob")
                : appearance === "in_review"
                  ? t("cleaner.statusInReview")
                  : appearance === "completed"
                    ? t("cleaner.statusCompleted")
                    : t("cleaner.statusNeedsRework");

            return (
              <CleanerJobCard
                key={job._id}
                propertyName={job.property?.name ?? t("cleaner.unknownProperty")}
                address={job.property?.address ?? t("cleaner.noAddress")}
                city={job.property?.city ?? null}
                guestCount={job.stay?.numberOfGuests ?? null}
                bedrooms={job.property?.bedrooms ?? null}
                bathrooms={job.property?.bathrooms ?? null}
                partyRiskFlag={job.stay?.partyRiskFlag ?? false}
                scheduledAt={job.scheduledStartAt}
                scheduledEndAt={job.scheduledEndAt ?? null}
                notes={job.notesForCleaner ?? null}
                appearance={appearance}
                statusLabel={statusLabel}
                detailHref={`/cleaner/jobs/${job._id}`}
                actionHref={job.status === "awaiting_approval" ? undefined : `/cleaner/jobs/${job._id}/active`}
                actionLabel={job.status === "in_progress" ? t("cleaner.resume") : t("cleaner.start")}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
