"use client";

import { useMemo } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { api } from "@convex/_generated/api";
import { CleanerJobCard, CleanerSection, mapJobAppearance } from "@/components/cleaner/cleaner-ui";

export function CleanerHistoryClient() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const t = useTranslations();
  const jobs = useQuery(api.cleaningJobs.queries.getMyAssigned, isAuthenticated ? { limit: 500 } : "skip") as
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
        stay?: {
          numberOfGuests?: number | null;
          partyRiskFlag?: boolean;
          lateCheckout?: boolean;
          earlyCheckin?: boolean;
        } | null;
      }>
    | undefined;

  const history = useMemo(() => {
    const source = jobs ?? [];
    return source
      .filter((job) => job.status === "completed" || job.status === "awaiting_approval" || job.status === "cancelled")
      .sort((a, b) => b.scheduledStartAt - a.scheduledStartAt);
  }, [jobs]);

  const getStatusLabel = (status: string) => {
    try {
      return t(`jobStatus.${status}`);
    } catch {
      return status.replace(/_/g, " ");
    }
  };

  if (isLoading || !isAuthenticated) {
    return <p className="text-sm text-[var(--muted-foreground)]">{t("cleaner.loadingHistory")}</p>;
  }

  if (jobs === undefined) {
    return <p className="text-sm text-[var(--muted-foreground)]">{t("cleaner.loadingHistory")}</p>;
  }

  if (history.length === 0) {
    return (
      <CleanerSection eyebrow={t("cleaner.history")} title={t("cleaner.noHistory")}>
        <p className="text-sm text-[var(--cleaner-muted)]">{t("cleaner.historyEmpty")}</p>
      </CleanerSection>
    );
  }

  return (
    <div className="space-y-3">
      <CleanerSection eyebrow={t("cleaner.history")} title={t("cleaner.recentJobs")}>
        <p className="text-sm text-[var(--cleaner-muted)]">
          {t("cleaner.historyCount", { count: history.length })}
        </p>
      </CleanerSection>
      {history.map((job) => (
        <CleanerJobCard
          key={job._id}
          propertyName={job.property?.name ?? t("cleaner.unknownProperty")}
          address={job.property?.address ?? null}
          city={job.property?.city ?? null}
          guestCount={job.stay?.numberOfGuests ?? null}
          bedrooms={job.property?.bedrooms ?? null}
          bathrooms={job.property?.bathrooms ?? null}
          partyRiskFlag={job.stay?.partyRiskFlag ?? false}
          lateCheckout={job.stay?.lateCheckout ?? false}
          earlyCheckin={job.stay?.earlyCheckin ?? false}
          scheduledAt={job.scheduledStartAt}
          scheduledEndAt={job.scheduledEndAt ?? null}
          appearance={mapJobAppearance(job.status)}
          statusLabel={getStatusLabel(job.status)}
          detailHref={`/cleaner/jobs/${job._id}`}
        />
      ))}
    </div>
  );
}
