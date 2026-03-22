"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock,
  Loader2,
  TrendingUp,
} from "lucide-react";

type TodayJob = {
  id: string;
  status: string;
  isUrgent: boolean;
  scheduledStartAt: number;
  scheduledEndAt: number;
  propertyName: string;
  cleanerName: string;
};

type UpcomingCheckin = {
  id: string;
  propertyId: string;
  propertyName: string;
  checkInAt: number;
  checkOutAt: number;
  guestName: string;
};

type QuickStats = {
  todayJobs: number;
  inProgress: number;
  completedToday: number;
  needsAttention: number;
  upcomingCheckins: number;
  openJobs: number;
  readiness: {
    ready: number;
    inProgress: number;
    attention: number;
  };
};

type RecentActivityItem = {
  id: string;
  jobId: string;
  status: string;
  action: string;
  propertyName: string;
  cleanerName: string;
  timestamp: number;
};

const queryRef = <T,>(name: string) =>
  name as unknown as FunctionReference<
    "query",
    "public",
    Record<string, never>,
    T
  >;

function StatTile({
  href,
  label,
  value,
  icon: Icon,
  color,
}: {
  href: string;
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 transition hover:border-[var(--primary)]"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm text-[var(--muted-foreground)]">{label}</span>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </Link>
  );
}

function statusPill(status: string) {
  if (status === "completed") {
    return "bg-[var(--success)]/20 text-[var(--success)]";
  }
  if (status === "in_progress") {
    return "bg-[var(--warning)]/20 text-[var(--warning)]";
  }
  if (status === "cancelled") {
    return "bg-[var(--destructive)]/20 text-[var(--destructive)]";
  }
  return "bg-[var(--muted)] text-[var(--muted-foreground)]";
}

export default function DashboardPage() {
  const todayJobs = useQuery(
    queryRef<TodayJob[]>("dashboard/queries:getTodayJobs"),
  );
  const upcomingCheckins = useQuery(
    queryRef<UpcomingCheckin[]>("dashboard/queries:getUpcomingCheckins"),
  );
  const quickStats = useQuery(
    queryRef<QuickStats>("dashboard/queries:getQuickStats"),
  );
  const recentActivity = useQuery(
    queryRef<RecentActivityItem[]>("dashboard/queries:getRecentActivity"),
  );

  const isLoading =
    todayJobs === undefined ||
    upcomingCheckins === undefined ||
    quickStats === undefined ||
    recentActivity === undefined;

  const stats = quickStats ?? {
    todayJobs: 0,
    inProgress: 0,
    completedToday: 0,
    needsAttention: 0,
    upcomingCheckins: 0,
    openJobs: 0,
    readiness: { ready: 0, inProgress: 0, attention: 0 },
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Operations Command Center</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Live view of jobs, readiness, and team activity.
        </p>
      </div>

      {isLoading ? (
        <div className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading live dashboard data...
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          href="/jobs"
          label="Today Jobs"
          value={stats.todayJobs}
          icon={ClipboardList}
          color="text-[var(--primary)]"
        />
        <StatTile
          href="/jobs?status=in_progress"
          label="In Progress"
          value={stats.inProgress}
          icon={Clock}
          color="text-[var(--warning)]"
        />
        <StatTile
          href="/jobs?status=completed"
          label="Completed Today"
          value={stats.completedToday}
          icon={CheckCircle2}
          color="text-[var(--success)]"
        />
        <StatTile
          href="/jobs?status=attention"
          label="Needs Attention"
          value={stats.needsAttention}
          icon={AlertTriangle}
          color="text-[var(--destructive)]"
        />
        <StatTile
          href="/schedule"
          label="Upcoming Check-ins"
          value={stats.upcomingCheckins}
          icon={CalendarClock}
          color="text-[var(--primary)]"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Link
          href="/properties?readiness=ready"
          className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 transition hover:border-[var(--success)]"
        >
          <p className="text-xs uppercase text-[var(--muted-foreground)]">Property Readiness</p>
          <p className="mt-1 text-2xl font-semibold text-[var(--success)]">
            {stats.readiness.ready}
          </p>
          <p className="text-sm text-[var(--muted-foreground)]">Ready</p>
        </Link>
        <Link
          href="/properties?readiness=in-progress"
          className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 transition hover:border-[var(--warning)]"
        >
          <p className="text-xs uppercase text-[var(--muted-foreground)]">Property Readiness</p>
          <p className="mt-1 text-2xl font-semibold text-[var(--warning)]">
            {stats.readiness.inProgress}
          </p>
          <p className="text-sm text-[var(--muted-foreground)]">In Progress</p>
        </Link>
        <Link
          href="/properties?readiness=attention"
          className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 transition hover:border-[var(--destructive)]"
        >
          <p className="text-xs uppercase text-[var(--muted-foreground)]">Property Readiness</p>
          <p className="mt-1 text-2xl font-semibold text-[var(--destructive)]">
            {stats.readiness.attention}
          </p>
          <p className="text-sm text-[var(--muted-foreground)]">Needs Attention</p>
        </Link>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 xl:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Today Jobs</h3>
            <Link href="/jobs" className="text-xs text-[var(--primary)] hover:underline">
              View all
            </Link>
          </div>
          <div className="space-y-2">
            {(todayJobs ?? []).slice(0, 8).map((job) => (
              <Link
                key={job.id}
                href={`/jobs/${job.id}`}
                className="flex items-center justify-between rounded-md border border-[var(--border)] p-3 transition hover:border-[var(--primary)]"
              >
                <div>
                  <p className="text-sm font-medium">{job.propertyName}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {format(job.scheduledStartAt, "p")} - {job.cleanerName}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {job.isUrgent ? (
                    <AlertTriangle className="h-4 w-4 text-[var(--destructive)]" />
                  ) : null}
                  <span className={`rounded-full px-2 py-1 text-xs ${statusPill(job.status)}`}>
                    {job.status.replace("_", " ")}
                  </span>
                </div>
              </Link>
            ))}
            {(todayJobs ?? []).length === 0 ? (
              <p className="rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted-foreground)]">
                No jobs scheduled for today.
              </p>
            ) : null}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Upcoming Check-ins</h3>
            <Link href="/schedule" className="text-xs text-[var(--primary)] hover:underline">
              Schedule
            </Link>
          </div>
          <div className="space-y-2">
            {(upcomingCheckins ?? []).map((stay) => (
              <Link
                key={stay.id}
                href={`/properties/${stay.propertyId}`}
                className="block rounded-md border border-[var(--border)] p-3 transition hover:border-[var(--primary)]"
              >
                <p className="text-sm font-medium">{stay.propertyName}</p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {stay.guestName} • {format(stay.checkInAt, "MMM d, p")}
                </p>
              </Link>
            ))}
            {(upcomingCheckins ?? []).length === 0 ? (
              <p className="rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted-foreground)]">
                No check-ins in the next 72 hours.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Recent Activity</h3>
          <TrendingUp className="h-4 w-4 text-[var(--muted-foreground)]" />
        </div>
        <div className="space-y-1">
          {(recentActivity ?? []).map((activity) => (
            <Link
              key={activity.id}
              href={`/jobs/${activity.jobId}`}
              className="flex items-center justify-between rounded-md px-2 py-2 transition hover:bg-[var(--accent)]"
            >
              <div>
                <p className="text-sm">
                  {activity.action} at {activity.propertyName}
                </p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {activity.cleanerName}
                </p>
              </div>
              <span className="text-xs text-[var(--muted-foreground)]">
                {formatDistanceToNow(activity.timestamp, { addSuffix: true })}
              </span>
            </Link>
          ))}
          {(recentActivity ?? []).length === 0 ? (
            <p className="rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted-foreground)]">
              No recent activity yet.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
