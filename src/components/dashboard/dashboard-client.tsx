"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { AlertTriangle, CheckCircle2, Clock3, Loader2, RotateCcw } from "lucide-react";
import {
  STATUS_CLASSNAMES,
  STATUS_LABELS,
} from "@/components/jobs/job-status";
import { isPropertyStatus, type PropertyStatus } from "@/types/property";

type StatItem = {
  label: string;
  value: number;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
};

const readinessLabel: Record<PropertyStatus, string> = {
  ready: "Ready",
  dirty: "Dirty",
  in_progress: "In Progress",
  vacant: "Vacant",
};

const readinessColor: Record<PropertyStatus, string> = {
  ready: "bg-emerald-100 text-emerald-700 border-emerald-200",
  dirty: "bg-rose-100 text-rose-700 border-rose-200",
  in_progress: "bg-amber-100 text-amber-700 border-amber-200",
  vacant: "bg-slate-100 text-slate-700 border-slate-200",
};

export function DashboardClient() {
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [now, setNow] = useState<number | null>(null);

  const jobs = useQuery(
    api.cleaningJobs.queries.getAll,
    { limit: 500 },
  );
  const properties = useQuery(
    api.properties.queries.getAll,
    { limit: 500 },
  );

  useEffect(() => {
    const updateNow = () => setNow(Date.now());
    updateNow();
    const timer = window.setInterval(updateNow, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const stats = useMemo<StatItem[]>(() => {
    const allJobs = jobs ?? [];
    const scheduled = allJobs.filter((job) => job.status === "scheduled").length;
    const inProgress = allJobs.filter((job) => job.status === "in_progress").length;
    const completed = allJobs.filter((job) => job.status === "completed").length;
    const rework = allJobs.filter((job) => job.status === "rework_required").length;

    return [
      {
        label: "Scheduled",
        value: scheduled,
        hint: "Jobs queued",
        icon: Clock3,
        href: "/jobs?status=scheduled",
      },
      {
        label: "In Progress",
        value: inProgress,
        hint: "Active field teams",
        icon: Loader2,
        href: "/jobs?status=in_progress",
      },
      {
        label: "Completed",
        value: completed,
        hint: `${allJobs.length ? Math.round((completed / allJobs.length) * 100) : 0}% completion rate`,
        icon: CheckCircle2,
        href: "/jobs?status=completed",
      },
      {
        label: "Rework",
        value: rework,
        hint: "Needs attention",
        icon: RotateCcw,
        href: "/jobs?status=rework_required",
      },
    ];
  }, [jobs]);

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
    const allJobs = jobs ?? [];

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

        let reason = "Urgent job";
        if (rework) reason = "Rework required";
        else if (overdue) reason = "Overdue start";
        else if (hasNoCleaner) reason = "No cleaner assigned";

        const priority =
          rework ? 4 :
          overdue ? 3 :
          urgent ? 2 :
          hasNoCleaner ? 1 : 0;

        return {
          id: job._id,
          property: job.property?.name ?? "Unknown property",
          reason,
          startAt: job.scheduledStartAt,
          status: job.status,
          priority,
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
  }, [jobs, now]);

  const visibleAlerts = showAllAlerts ? alerts : alerts.slice(0, 2);

  const todayJobs = useMemo(() => {
    if (!jobs) return [];

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    return jobs
      .filter((job) => {
        const when = job.scheduledStartAt ?? job.scheduledEndAt;
        return !!when && when >= dayStart.getTime() && when < dayEnd.getTime();
      })
      .sort((a, b) => (a.scheduledStartAt ?? 0) - (b.scheduledStartAt ?? 0))
      .slice(0, 8);
  }, [jobs]);

  const loading = jobs === undefined || properties === undefined;
  const unmappedReadinessCount = Math.max(0, readiness.totalCount - readiness.mappedCount);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 sm:items-start sm:gap-4">
        <div className="min-w-0">
          <h1 className="sr-only sm:not-sr-only sm:text-3xl sm:font-extrabold sm:tracking-tight">
            Operations Dashboard
          </h1>
          <p className="mt-1 hidden text-sm text-[var(--muted-foreground)] sm:block">
            Real-time status of property readiness and field jobs.
          </p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <button className="flex-1 rounded-xl bg-[var(--secondary)] px-3 py-2 text-sm font-semibold text-[var(--secondary-foreground)] sm:flex-none sm:px-4">
            Generate Report
          </button>
          <Link
            href="/jobs"
            className="flex-1 rounded-xl bg-[var(--primary)] px-3 py-2 text-center text-sm font-semibold text-[var(--primary-foreground)] sm:flex-none sm:px-4"
          >
            New Job
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 sm:gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="group rounded-xl border bg-[var(--card)] p-2.5 shadow-sm transition hover:border-[var(--primary)]/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40 sm:rounded-2xl sm:p-5"
          >
            <div className="flex items-center justify-between sm:mb-3">
              <p className="truncate text-[9px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] sm:text-xs">
                {item.label}
              </p>
              <item.icon className="hidden h-4 w-4 text-[var(--muted-foreground)] sm:block" />
            </div>
            <p className="mt-1 text-2xl font-extrabold leading-none tracking-tight sm:mt-0 sm:text-4xl">{item.value}</p>
            <p className="mt-2 hidden text-xs text-[var(--muted-foreground)] sm:block">{item.hint}</p>
            <p className="mt-3 hidden text-xs font-semibold text-[var(--primary)] opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100 sm:block">
              View details
            </p>
          </Link>
        ))}
      </div>

      <section className="rounded-2xl border bg-[var(--card)] p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold">Critical Alerts</h2>
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-rose-700">
              Urgent
            </span>
          </div>
          {alerts.length > 2 ? (
            <button
              type="button"
              onClick={() => setShowAllAlerts((current) => !current)}
              className="text-xs font-semibold text-[var(--primary)] hover:underline"
            >
              {showAllAlerts ? "Show fewer" : `Show all (${alerts.length})`}
            </button>
          ) : null}
        </div>
        {loading ? (
          <div className="flex min-h-36 items-center justify-center text-sm text-[var(--muted-foreground)]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading alerts...
          </div>
        ) : alerts.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-[var(--muted-foreground)]">
            No urgent alerts right now.
          </p>
        ) : (
          <div className="space-y-3">
            {visibleAlerts.map((alert) => (
              <Link
                key={alert.id}
                href={`/jobs/${alert.id}`}
                className="group block rounded-xl border border-rose-100 bg-rose-50/40 p-3 transition hover:border-rose-300 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-rose-600" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{alert.property}</p>
                    <p className="text-xs text-rose-700">{alert.reason}</p>
                    <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                      {alert.startAt
                        ? new Date(alert.startAt).toLocaleString()
                        : "No schedule set"}
                      {" · "}
                      {STATUS_LABELS[alert.status]}
                    </p>
                    <p className="mt-1 text-[11px] font-semibold text-rose-700 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
                      View job details
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border bg-[var(--card)]">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Today&apos;s Jobs</h2>
          <Link href="/jobs" className="text-sm font-semibold text-[var(--primary)] hover:underline">
            View all jobs
          </Link>
        </div>

        {loading ? (
          <div className="flex min-h-36 items-center justify-center text-sm text-[var(--muted-foreground)]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading jobs...
          </div>
        ) : todayJobs.length === 0 ? (
          <div className="px-4 py-8 text-sm text-[var(--muted-foreground)]">No jobs scheduled for today.</div>
        ) : (
          <div className="divide-y">
            {todayJobs.map((job) => (
              <div key={job._id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">{job.property?.name ?? "Unknown property"}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {new Date(job.scheduledStartAt ?? 0).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {" · "}
                    {job.cleaners?.[0]?.name || "Unassigned"}
                  </p>
                </div>
                <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${STATUS_CLASSNAMES[job.status]}`}>
                  {STATUS_LABELS[job.status]}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border bg-[var(--card)] p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Property Readiness</h2>
        </div>

        {readiness.mappedCount === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-[var(--muted-foreground)]">
            No mapped readiness statuses found yet. Vacant is no longer inferred by default.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {(Object.keys(readiness.summary) as PropertyStatus[]).map((status) => (
              <Link
                key={status}
                href={`/properties?status=${status}`}
                className="group rounded-xl border p-4 transition hover:border-[var(--primary)]/40 hover:bg-[var(--accent)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40"
              >
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  {readinessLabel[status]}
                </p>
                <p className="mt-2 text-3xl font-extrabold leading-none tracking-tight">{readiness.summary[status]}</p>
                <span className={`mt-3 inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${readinessColor[status]}`}>
                  {readinessLabel[status]}
                </span>
                <p className="mt-3 text-xs font-semibold text-[var(--primary)] opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
                  View properties
                </p>
              </Link>
            ))}
          </div>
        )}

        {unmappedReadinessCount > 0 ? (
          <p className="mt-3 text-xs text-[var(--muted-foreground)]">
            {unmappedReadinessCount} {unmappedReadinessCount === 1 ? "property is" : "properties are"} missing readiness mapping and excluded from these totals.
          </p>
        ) : null}
      </section>
    </div>
  );
}
