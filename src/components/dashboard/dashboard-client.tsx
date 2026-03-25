"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { AlertTriangle, CheckCircle2, Clock3, Loader2, RotateCcw } from "lucide-react";
import {
  STATUS_CLASSNAMES,
  STATUS_LABELS,
  type JobStatus,
} from "@/components/jobs/job-status";
import type { PropertyRecord, PropertyStatus } from "@/types/property";

type JobRecord = {
  _id: string;
  status: JobStatus;
  scheduledStartAt?: number;
  scheduledEndAt?: number;
  isUrgent?: boolean;
  property?: { name?: string | null } | null;
  cleaners?: Array<{ name?: string | null }>;
};

type StatItem = {
  label: string;
  value: number;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
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
  const jobs = useQuery(
    api.cleaningJobs.queries.getAll,
    { limit: 500 },
  );
  const properties = useQuery(
    api.properties.queries.getAll,
    { limit: 500 },
  );

  const now = Date.now();

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
      },
      {
        label: "In Progress",
        value: inProgress,
        hint: "Active field teams",
        icon: Loader2,
      },
      {
        label: "Completed",
        value: completed,
        hint: `${allJobs.length ? Math.round((completed / allJobs.length) * 100) : 0}% completion rate`,
        icon: CheckCircle2,
      },
      {
        label: "Rework",
        value: rework,
        hint: "Needs attention",
        icon: RotateCcw,
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
    (properties ?? []).forEach((property) => {
      const status = ((property as any).status ?? "vacant") as PropertyStatus;
      summary[status] += 1;
    });
    return summary;
  }, [properties]);

  const alerts = useMemo(() => {
    const allJobs = jobs ?? [];

    return allJobs
      .filter((job) => {
        const hasNoCleaner = !job.cleaners || job.cleaners.length === 0;
        const overdue = Boolean(job.scheduledStartAt && job.scheduledStartAt < now && ["scheduled", "assigned"].includes(job.status));
        const urgent = Boolean(job.isUrgent);
        const rework = job.status === "rework_required";
        return hasNoCleaner || overdue || urgent || rework;
      })
      .slice(0, 5)
      .map((job) => {
        const hasNoCleaner = !job.cleaners || job.cleaners.length === 0;
        const overdue = Boolean(job.scheduledStartAt && job.scheduledStartAt < now && ["scheduled", "assigned"].includes(job.status));

        let reason = "Urgent job";
        if (job.status === "rework_required") reason = "Rework required";
        else if (overdue) reason = "Overdue start";
        else if (hasNoCleaner) reason = "No cleaner assigned";

        return {
          id: job._id,
          property: job.property?.name ?? "Unknown property",
          reason,
          startAt: job.scheduledStartAt,
          status: job.status,
        };
      });
  }, [jobs, now]);

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Operations Dashboard</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Real-time status of property readiness and field jobs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="rounded-xl bg-[var(--secondary)] px-4 py-2 text-sm font-semibold text-[var(--secondary-foreground)]">
            Generate Report
          </button>
          <Link
            href="/jobs"
            className="rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)]"
          >
            New Job
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((item) => (
          <div key={item.label} className="rounded-2xl border bg-[var(--card)] p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                {item.label}
              </p>
              <item.icon className="h-4 w-4 text-[var(--muted-foreground)]" />
            </div>
            <p className="text-4xl font-extrabold leading-none tracking-tight">{item.value}</p>
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">{item.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="rounded-2xl border bg-[var(--card)] p-5 lg:col-span-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold">Critical Alerts</h2>
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-rose-700">
              Urgent
            </span>
          </div>
          {loading ? (
            <div className="flex min-h-48 items-center justify-center text-sm text-[var(--muted-foreground)]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading alerts...
            </div>
          ) : alerts.length === 0 ? (
            <p className="rounded-xl border border-dashed p-4 text-sm text-[var(--muted-foreground)]">
              No urgent alerts right now.
            </p>
          ) : (
            <div className="space-y-3">
              {alerts.map((alert) => (
                <div key={alert.id} className="rounded-xl border border-rose-100 bg-rose-50/40 p-3">
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
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border bg-[var(--card)] p-5 lg:col-span-8">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold">Property Readiness</h2>
              <p className="text-xs text-[var(--muted-foreground)]">Live readiness distribution across all properties.</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {(Object.keys(readiness) as PropertyStatus[]).map((status) => (
              <div key={status} className="rounded-xl border p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  {readinessLabel[status]}
                </p>
                <p className="mt-2 text-3xl font-extrabold leading-none tracking-tight">{readiness[status]}</p>
                <span className={`mt-3 inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${readinessColor[status]}`}>
                  {readinessLabel[status]}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

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
    </div>
  );
}
