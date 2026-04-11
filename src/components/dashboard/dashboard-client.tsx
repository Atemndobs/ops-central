"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  AlertTriangle,
  Check,
  Loader2,
  UserPlus,
} from "lucide-react";
import {
  STATUS_CLASSNAMES,
  STATUS_LABELS,
} from "@/components/jobs/job-status";
import { JobCountdown } from "@/components/jobs/job-countdown";
import { useToast } from "@/components/ui/toast-provider";
import { getErrorMessage } from "@/lib/errors";
import { isPropertyStatus, type PropertyStatus } from "@/types/property";

const dayMs = 24 * 60 * 60 * 1000;

const funnelStages = [
  { status: "scheduled", labelKey: "dashboard.scheduled", href: "/jobs?status=scheduled" },
  { status: "assigned", labelKey: "dashboard.assigned", href: "/jobs?status=assigned" },
  { status: "in_progress", labelKey: "dashboard.inProgress", href: "/jobs?status=in_progress" },
  {
    status: "awaiting_approval",
    labelKey: "dashboard.awaitingApproval",
    href: "/jobs?status=awaiting_approval",
  },
  { status: "completed", labelKey: "dashboard.completed", href: "/jobs?status=completed" },
] as const;

const readinessLabelKey: Record<PropertyStatus, string> = {
  ready: "dashboard.ready",
  dirty: "dashboard.dirty",
  in_progress: "dashboard.inProgress",
  vacant: "dashboard.vacant",
};

const readinessColor: Record<PropertyStatus, string> = {
  ready: "bg-emerald-100 text-emerald-700 border-emerald-200",
  dirty: "bg-rose-100 text-rose-700 border-rose-200",
  in_progress: "bg-amber-100 text-amber-700 border-amber-200",
  vacant: "bg-slate-100 text-slate-700 border-slate-200",
};

const readinessBorder: Record<PropertyStatus, string> = {
  ready: "border-emerald-300",
  dirty: "border-rose-300",
  in_progress: "border-amber-300",
  vacant: "border-slate-300",
};

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

function firstNameOnly(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

export function DashboardClient() {
  const t = useTranslations();
  const { showToast } = useToast();
  const { isAuthenticated } = useConvexAuth();
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const [quickAssignAlertId, setQuickAssignAlertId] = useState<Id<"cleaningJobs"> | null>(null);
  const [assigningJobId, setAssigningJobId] = useState<Id<"cleaningJobs"> | null>(null);

  const jobs = useQuery(
    api.cleaningJobs.queries.getAll,
    isAuthenticated ? { limit: 500 } : "skip",
  );
  const properties = useQuery(
    api.properties.queries.getAll,
    isAuthenticated ? { limit: 500 } : "skip",
  );
  const assignJob = useMutation(api.cleaningJobs.mutations.assign);

  useEffect(() => {
    const updateNow = () => setNow(Date.now());
    updateNow();
    const timer = window.setInterval(updateNow, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const dashboardJobs = useMemo(() => {
    return (jobs ?? []).filter((job) => Boolean(job.property?.name?.trim()));
  }, [jobs]);
  const propertyIdsForAssign = useMemo(() => {
    return [...new Set(dashboardJobs.map((job) => job.propertyId))];
  }, [dashboardJobs]);
  const assignableCleanersByProperty = useQuery(
    api.cleaningJobs.queries.getAssignableCleanersByProperty,
    isAuthenticated && propertyIdsForAssign.length > 0
      ? { propertyIds: propertyIdsForAssign }
      : "skip",
  );
  const assignableByPropertyMap = useMemo(
    () => new Map((assignableCleanersByProperty ?? []).map((item) => [item.propertyId, item])),
    [assignableCleanersByProperty],
  );

  const handleQuickAssign = useCallback(
    async (jobId: Id<"cleaningJobs">, cleanerId: Id<"users">) => {
      setAssigningJobId(jobId);
      try {
        const result = await assignJob({
          jobId,
          cleanerIds: [cleanerId],
          notifyCleaners: false,
          source: "dashboard_critical_alert_assign",
          returnWarnings: true,
        });
        setQuickAssignAlertId(null);
        showToast(t("dashboard.cleanerAssigned"));
        const warnings = getAssignWarnings(result);
        if (warnings.length > 0) {
          showToast(`${t("dashboard.dispatchWarning")}: ${warnings.join(" ")}`, "error");
        }
      } catch (error) {
        showToast(
          getErrorMessage(error, t("dashboard.unableToAssign")),
          "error",
        );
      } finally {
        setAssigningJobId(null);
      }
    },
    [assignJob, showToast],
  );

  const opsFunnel = useMemo(() => {
    const currentNow = now ?? Date.now();
    const previousNow = currentNow - dayMs;

    const isOverdueAt = (
      job: (typeof dashboardJobs)[number],
      referenceTime: number,
    ) => {
      if (!job.scheduledStartAt || job.status === "completed") {
        return false;
      }
      return job.scheduledStartAt < referenceTime;
    };

    return funnelStages.map((stage) => {
      const stageJobs = dashboardJobs.filter((job) => job.status === stage.status);
      const overdueNow = stageJobs.filter((job) => isOverdueAt(job, currentNow)).length;
      const overduePrevious = stageJobs.filter((job) =>
        isOverdueAt(job, previousNow),
      ).length;

      return {
        ...stage,
        count: stageJobs.length,
        overdueNow,
        overdueDelta: overdueNow - overduePrevious,
      };
    });
  }, [dashboardJobs, now]);

  const readiness = useMemo(() => {
    const summary: Record<PropertyStatus, number> = {
      ready: 0,
      dirty: 0,
      in_progress: 0,
      vacant: 0,
    };
    let mappedCount = 0;

    (properties ?? []).forEach((property) => {
      const status = (property as { status?: unknown }).status;
      if (isPropertyStatus(status)) {
        summary[status] += 1;
        mappedCount += 1;
      }
    });

    return {
      summary,
      mappedCount,
      totalCount: (properties ?? []).length,
    };
  }, [properties]);

  const alerts = useMemo(() => {
    const currentNow = now ?? 0;
    const allJobs = dashboardJobs;

    return allJobs
      .filter((job) => {
        const hasNoCleaner = !job.cleaners || job.cleaners.length === 0;
        const overdue = Boolean(job.scheduledStartAt && job.scheduledStartAt < currentNow && ["scheduled", "assigned"].includes(job.status));
        const urgent = Boolean(job.isUrgent);
        const rework = job.status === "rework_required";
        return hasNoCleaner || overdue || urgent || rework;
      })
      .map((job) => {
        const hasNoCleaner = !job.cleaners || job.cleaners.length === 0;
        const overdue = Boolean(job.scheduledStartAt && job.scheduledStartAt < currentNow && ["scheduled", "assigned"].includes(job.status));
        const urgent = Boolean(job.isUrgent);
        const rework = job.status === "rework_required";

        let reason = t("dashboard.urgentJob");
        if (rework) reason = t("dashboard.reworkRequired");
        else if (overdue) reason = t("dashboard.overdueStart");
        else if (hasNoCleaner) reason = t("dashboard.noCleanerAssigned");

        const priority =
          rework ? 4 :
          overdue ? 3 :
          urgent ? 2 :
          hasNoCleaner ? 1 : 0;

        return {
          id: job._id,
          propertyId: job.propertyId,
          property: job.property?.name ?? t("dashboard.unknownProperty"),
          reason,
          startAt: job.scheduledStartAt,
          status: job.status,
          priority,
          assignedCleanerIds: (job.cleaners ?? [])
            .map((cleaner) => cleaner?._id)
            .filter((cleanerId): cleanerId is Id<"users"> => Boolean(cleanerId)),
          assignedCleanerNames: (job.cleaners ?? [])
            .map((cleaner) => cleaner?.name)
            .map((name) => (name ? firstNameOnly(name) : ""))
            .filter((name): name is string => Boolean(name)),
        };
      })
      .sort((a, b) => {
        if (b.priority !== a.priority) {
          return b.priority - a.priority;
        }

        const aStart = a.startAt ?? Number.MAX_SAFE_INTEGER;
        const bStart = b.startAt ?? Number.MAX_SAFE_INTEGER;
        return aStart - bStart;
      })
      .slice(0, 20);
  }, [dashboardJobs, now]);

  const blockers = useMemo(() => {
    const currentNow = now ?? 0;
    const unassignedJobs = dashboardJobs.filter((job) => {
      const hasNoCleaner = !job.cleaners || job.cleaners.length === 0;
      const isActionable = [
        "scheduled",
        "assigned",
        "in_progress",
        "awaiting_approval",
        "rework_required",
      ].includes(job.status);
      return hasNoCleaner && isActionable;
    });

    const overdueJobs = dashboardJobs.filter(
      (job) =>
        Boolean(job.scheduledStartAt && job.scheduledStartAt < currentNow) &&
        ["scheduled", "assigned"].includes(job.status),
    );

    const reworkJobs = dashboardJobs.filter(
      (job) => job.status === "rework_required",
    );

    return [
      {
        key: "unassigned",
        label: t("dashboard.missingCleaner"),
        count: unassignedJobs.length,
        helper: t("dashboard.missingCleanerHelper"),
        href: "/jobs?status=scheduled",
      },
      {
        key: "overdue",
        label: t("dashboard.overdueStart"),
        count: overdueJobs.length,
        helper: t("dashboard.overdueStartHelper"),
        href: "/jobs?status=assigned",
      },
      {
        key: "rework",
        label: t("dashboard.reworkRequired"),
        count: reworkJobs.length,
        helper: t("dashboard.reworkRequiredHelper"),
        href: "/jobs?status=rework_required",
      },
    ];
  }, [dashboardJobs, now]);

  const visibleAlerts = showAllAlerts ? alerts : alerts.slice(0, 2);

  const todayTimelineJobs = useMemo(() => {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    return dashboardJobs
      .filter((job) => {
        const when = job.scheduledStartAt ?? job.scheduledEndAt;
        return !!when && when >= dayStart.getTime() && when < dayEnd.getTime();
      })
      .sort((a, b) => (a.scheduledStartAt ?? 0) - (b.scheduledStartAt ?? 0))
      .slice(0, 10);
  }, [dashboardJobs]);

  const timelineAnchors = ["06:00", "09:00", "12:00", "15:00", "18:00"];

  const loading = jobs === undefined || properties === undefined;
  const unmappedReadinessCount = Math.max(0, readiness.totalCount - readiness.mappedCount);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 sm:items-start sm:gap-4">
        <div className="min-w-0">
          <h1 className="hidden text-3xl font-extrabold tracking-tight sm:block">
            {t("dashboard.title")}
          </h1>
          <p className="mt-1 hidden text-sm text-[var(--muted-foreground)] sm:block">
            {t("dashboard.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/reports"
            className="rounded-xl bg-[var(--secondary)] px-3 py-1.5 text-xs font-semibold text-[var(--secondary-foreground)] transition hover:opacity-90 sm:px-4 sm:py-2 sm:text-sm"
          >
            {t("dashboard.generateReport")}
          </Link>
          <Link
            href="/jobs"
            className="rounded-xl bg-[var(--primary)] px-3 py-1.5 text-center text-xs font-semibold text-[var(--primary-foreground)] sm:px-4 sm:py-2 sm:text-sm"
          >
            {t("dashboard.newJob")}
          </Link>
        </div>
      </div>

      <section className="rounded-2xl border bg-[var(--card)] p-3 sm:p-5">
        <div className="mb-3 flex items-center justify-between sm:mb-4">
          <div>
            <h2 className="text-base font-bold sm:text-lg">{t("dashboard.opsFunnel")}</h2>
            <p className="text-xs text-[var(--muted-foreground)]">
              {t("dashboard.opsFunnelSubtitle")}
            </p>
          </div>
        </div>
        {loading ? (
          <div className="flex min-h-28 items-center justify-center text-sm text-[var(--muted-foreground)]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t("dashboard.loadingFunnel")}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
            {opsFunnel.map((stage) => {
              const deltaLabel =
                stage.overdueDelta > 0
                  ? `+${stage.overdueDelta}`
                  : `${stage.overdueDelta}`;
              const deltaClass =
                stage.overdueDelta > 0
                  ? "text-rose-700"
                  : stage.overdueDelta < 0
                    ? "text-emerald-700"
                    : "text-[var(--muted-foreground)]";
              return (
                <Link
                  key={stage.status}
                  href={stage.href}
                  className="rounded-xl border bg-[var(--card)] px-3 py-2.5 transition hover:border-[var(--primary)]/40 hover:bg-[var(--accent)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40"
                >
                  <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                    {t(stage.labelKey)}
                  </p>
                  <p className="mt-1 text-2xl font-extrabold leading-none">
                    {stage.count}
                  </p>
                  <p className={`mt-1 text-[11px] font-semibold ${deltaClass}`}>
                    Overdue {stage.overdueNow} · Δ {deltaLabel}
                  </p>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <section className="rounded-2xl border bg-[var(--card)] p-3 sm:p-5 xl:col-span-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold sm:text-lg">{t("dashboard.blockers")}</h2>
            <Link
              href="/jobs"
              className="text-xs font-semibold text-[var(--primary)] hover:underline"
            >
              {t("dashboard.openJobs")}
            </Link>
          </div>
          {loading ? (
            <div className="flex min-h-36 items-center justify-center text-sm text-[var(--muted-foreground)]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("dashboard.loadingBlockers")}
            </div>
          ) : (
            <div className="space-y-2">
              {blockers.map((blocker) => (
                <div
                  key={blocker.key}
                  className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/20 px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{blocker.label}</p>
                    <span className="rounded-full border px-2 py-0.5 text-xs font-bold">
                      {blocker.count}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    {blocker.helper}
                  </p>
                  <Link
                    href={blocker.href}
                    className="mt-1.5 inline-flex text-xs font-semibold text-[var(--primary)] hover:underline"
                  >
                    {t("dashboard.reviewQueue")}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border bg-[var(--card)] p-3 sm:p-5 xl:col-span-7">
          <div className="mb-3 flex items-center justify-between sm:mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold sm:text-lg">{t("dashboard.criticalAlerts")}</h2>
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-rose-700">
                {t("dashboard.urgent")}
              </span>
            </div>
            {alerts.length > 2 ? (
              <button
                type="button"
                onClick={() => setShowAllAlerts((current) => !current)}
                className="text-xs font-semibold text-[var(--primary)] hover:underline"
              >
                {showAllAlerts ? t("dashboard.showFewer") : `${t("dashboard.showAll")} (${alerts.length})`}
              </button>
            ) : null}
          </div>
          {loading ? (
            <div className="flex min-h-36 items-center justify-center text-sm text-[var(--muted-foreground)]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("dashboard.loadingAlerts")}
            </div>
          ) : alerts.length === 0 ? (
            <p className="rounded-xl border border-dashed p-4 text-sm text-[var(--muted-foreground)]">
              {t("dashboard.noUrgentAlerts")}
            </p>
          ) : (
            <div className="space-y-2.5">
              {visibleAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="group rounded-xl border border-rose-100 bg-rose-50/40 px-3 py-2.5 transition hover:border-rose-300 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 text-rose-600" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{alert.property}</p>
                      <p className="text-xs text-rose-700">{alert.reason}</p>
                      <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                        {alert.startAt
                          ? new Date(alert.startAt).toLocaleString()
                          : t("dashboard.noScheduleSet")}
                        {" · "}
                        {STATUS_LABELS[alert.status]}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <Link
                          href={`/jobs/${alert.id}`}
                          className="text-[11px] font-semibold text-rose-700 hover:underline"
                        >
                          View
                        </Link>
                        <button
                          type="button"
                          onClick={() =>
                            setQuickAssignAlertId((current) =>
                              current === alert.id ? null : alert.id,
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50"
                        >
                          {alert.assignedCleanerIds.length > 0 ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <UserPlus className="h-3 w-3" />
                          )}
                          {alert.assignedCleanerNames.length > 0
                            ? alert.assignedCleanerNames[0]
                            : t("dashboard.assign")}
                        </button>
                      </div>
                      {quickAssignAlertId === alert.id ? (
                        <div className="mt-2 rounded-md border border-rose-200 bg-white p-2">
                          {(() => {
                            const availableAssignment = assignableByPropertyMap.get(alert.propertyId);
                            const companyCleaners = availableAssignment?.cleaners ?? [];
                            return (
                              <>
                                <p className="text-[11px] text-[var(--muted-foreground)]">
                                  {availableAssignment?.companyName
                                    ? `${t("dashboard.company")}: ${availableAssignment.companyName}`
                                    : t("dashboard.noCompanyAssigned")}
                                </p>
                                {companyCleaners.length === 0 ? (
                                  <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                                    {t("dashboard.noEligibleCleaners")}
                                  </p>
                                ) : (
                                  <div className="mt-2 space-y-1">
                                    {companyCleaners.map((cleaner) => {
                                      const alreadyAssigned = alert.assignedCleanerIds.includes(
                                        cleaner._id,
                                      );
                                      return (
                                        <button
                                          key={cleaner._id}
                                          type="button"
                                          disabled={assigningJobId === alert.id}
                                          onClick={() =>
                                            void handleQuickAssign(alert.id, cleaner._id)
                                          }
                                          className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-[11px] hover:bg-rose-50 disabled:opacity-60"
                                        >
                                          <span className="truncate">
                                            {cleaner.name ?? cleaner.email}
                                          </span>
                                          {alreadyAssigned ? (
                                            <Check className="h-3 w-3 shrink-0 text-emerald-500" />
                                          ) : null}
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <section className="rounded-2xl border bg-[var(--card)] p-3 sm:p-5 xl:col-span-7">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold sm:text-lg">{t("dashboard.todayTimeline")}</h2>
            <Link
              href="/jobs"
              className="text-xs font-semibold text-[var(--primary)] hover:underline"
            >
              {t("dashboard.viewAllJobs")}
            </Link>
          </div>
          <div className="mb-2 hidden grid-cols-5 gap-2 text-center text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] sm:grid">
            {timelineAnchors.map((anchor) => (
              <span key={anchor}>{anchor}</span>
            ))}
          </div>
          {loading ? (
            <div className="flex min-h-32 items-center justify-center text-sm text-[var(--muted-foreground)]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("dashboard.loadingTimeline")}
            </div>
          ) : todayTimelineJobs.length === 0 ? (
            <div className="rounded-xl border border-dashed px-4 py-8 text-sm text-[var(--muted-foreground)]">
              {t("dashboard.noJobsToday")}
            </div>
          ) : (
            <div className="space-y-2">
              {todayTimelineJobs.map((job) => (
                <Link
                  key={job._id}
                  href={`/jobs/${job._id}`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--muted)]/15 px-3 py-2 transition hover:border-[var(--primary)]/40 hover:bg-[var(--accent)]/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {job.property?.name ?? t("dashboard.unknownProperty")}
                    </p>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {new Date(job.scheduledStartAt ?? 0).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {" · "}
                      {job.cleaners?.[0]?.name || t("dashboard.unassigned")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <JobCountdown
                      scheduledStartAt={job.scheduledStartAt}
                      actualStartAt={job.actualStartAt}
                      actualEndAt={job.actualEndAt}
                      status={job.status}
                    />
                    <span
                      className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${STATUS_CLASSNAMES[job.status]}`}
                    >
                      {STATUS_LABELS[job.status]}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border bg-[var(--card)] p-3 sm:p-5 xl:col-span-5">
          <div className="mb-3 flex items-center justify-between sm:mb-4">
            <h2 className="text-base font-bold sm:text-lg">{t("dashboard.propertyReadiness")}</h2>
          </div>
          {readiness.mappedCount === 0 ? (
            <p className="rounded-xl border border-dashed p-4 text-sm text-[var(--muted-foreground)]">
              {t("dashboard.noReadinessData")}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(readiness.summary) as PropertyStatus[]).map((status) => (
                <Link
                  key={status}
                  href={`/properties?status=${status}`}
                  className={`group rounded-xl border p-2.5 transition hover:border-[var(--primary)]/40 hover:bg-[var(--accent)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40 ${readinessBorder[status]}`}
                >
                  <p className="truncate text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                    {t(readinessLabelKey[status])}
                  </p>
                  <p className="mt-1 text-2xl font-extrabold leading-none tracking-tight">
                    {readiness.summary[status]}
                  </p>
                  <span
                    className={`mt-1.5 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${readinessColor[status]}`}
                  >
                    {t(readinessLabelKey[status])}
                  </span>
                </Link>
              ))}
            </div>
          )}
          {unmappedReadinessCount > 0 ? (
            <p className="mt-3 text-xs text-[var(--muted-foreground)]">
              {unmappedReadinessCount}{" "}
              {unmappedReadinessCount === 1 ? "property is" : "properties are"}{" "}
              missing readiness mapping and excluded from these totals.
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
