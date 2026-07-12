"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  CalendarDays,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Search,
  UserRound,
  Users,
} from "lucide-react";
import {
  JOB_STATUSES,
  STATUS_CLASSNAMES,
  STATUS_LABELS,
  type JobStatus,
} from "@/components/jobs/job-status";
import { JobCountdown } from "@/components/jobs/job-countdown";
import { CreateJobModal } from "@/components/jobs/create-job-modal";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { formatDateTimeInZone, resolveDisplayTimezone } from "@/lib/tz";

// Reproduces the bare `Date.toLocaleString()` output (en-US numeric date +
// time with seconds), rendered in each job's property display zone.
const DATE_TIME_OPTS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
};

const workflowStatuses: JobStatus[] = [
  "scheduled",
  "assigned",
  "in_progress",
  "completed",
];

type JobsPageClientProps = {
  initialStatus?: JobStatus | "all";
};
type MobileJobsFilterPanel = "search" | "property" | "cleaner" | "date" | null;
type SortKey = "urgency" | "job" | "property" | "cleaner" | "scheduled" | "status";
type SortDir = "asc" | "desc";

const STATUS_ORDER: Record<string, number> = {
  in_progress: 0,
  assigned: 1,
  scheduled: 2,
  awaiting_approval: 3,
  rework_required: 4,
  completed: 5,
  cancelled: 6,
};

function urgencyScore(
  job: {
    status: string;
    scheduledStartAt?: number | null;
    actualStartAt?: number | null;
    actualEndAt?: number | null;
  },
  now: number,
): number {
  // Running timer (in-progress, started, not ended) — most urgent
  if (job.status === "in_progress" && job.actualStartAt && !job.actualEndAt) {
    return -Number.MAX_SAFE_INTEGER + (job.actualStartAt ?? 0);
  }
  if (job.status === "completed" || job.status === "cancelled") {
    return Number.MAX_SAFE_INTEGER;
  }
  if (!job.scheduledStartAt) {
    return Number.MAX_SAFE_INTEGER - 1;
  }
  // Smaller (incl. negative = "Now") = more urgent
  return job.scheduledStartAt - now;
}

export function JobsPageClient({ initialStatus = "all" }: JobsPageClientProps) {
  const { isAuthenticated } = useConvexAuth();
  // Gate the "+ New Job" button to roles the backend actually accepts.
  // convex/cleaningJobs/mutations.ts:create requires admin or property_ops
  // (requireRole(["admin", "property_ops"])). Managers and cleaners would
  // get a 401 on submit, so hiding the button avoids surfacing an action
  // the user can't complete. Same pattern dashboard-client.tsx already uses.
  const me = useQuery(
    api.users.queries.getMyProfile,
    isAuthenticated ? {} : "skip",
  ) as { role?: string } | null | undefined;
  const canCreateJob = me?.role === "admin" || me?.role === "property_ops";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<JobStatus | "all">(initialStatus);
  const [propertyId, setPropertyId] = useState("all");
  const [cleanerId, setCleanerId] = useState("all");
  const [selectedDate, setSelectedDate] = useState("");
  const [hidePastJobs, setHidePastJobs] = useState(true);
  const [mobileFilterPanel, setMobileFilterPanel] = useState<MobileJobsFilterPanel>(null);
  const [openJobMenuId, setOpenJobMenuId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [nowTs, setNowTs] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("urgency");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const jobs = useQuery(
    api.cleaningJobs.queries.getAll,
    isAuthenticated
      ? {
          status: status === "all" ? undefined : status,
          propertyId: propertyId === "all" ? undefined : propertyId as Id<"properties">,
          limit: 1000,
          // Wave 3.b — when "Hide past jobs" is on (default), filter
          // ended jobs at the server instead of fetching + enriching
          // them only to discard client-side. Mirrors the arg already
          // used by `getStatusCounts` below.
          notEndedBefore: hidePastJobs && nowTs !== null ? nowTs : undefined,
        }
      : "skip",
  );

  // Wave 3 (bandwidth optimization): we previously made a SECOND
  // `getAll({ limit: 1000 })` here just to derive (a) per-status filter
  // chip counts, (b) property-name option list, and (c) cleaner-name
  // option list. (a) now comes from a thin `getStatusCounts` query;
  // (b)+(c) already had dedicated lightweight sources
  // (`propertiesForCreate`, `cleanerOptionsFromUsers`) and the
  // job-derived merge was a no-op in practice.
  const statusCounts = useQuery(
    api.cleaningJobs.queries.getStatusCounts,
    isAuthenticated
      ? {
          propertyId:
            propertyId === "all"
              ? undefined
              : (propertyId as Id<"properties">),
          notEndedBefore: hidePastJobs && nowTs !== null ? nowTs : undefined,
        }
      : "skip",
  );

  const cleanerOptionsFromUsers = useQuery(
    api.users.queries.getByRole,
    isAuthenticated ? { role: "cleaner" } : "skip",
  );

  const propertiesForCreate = useQuery(
    api.properties.queries.getAll,
    isAuthenticated ? { limit: 500 } : "skip",
  );

  useEffect(() => {
    const syncNow = () => setNowTs(Date.now());
    syncNow();
    const intervalId = window.setInterval(syncNow, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const scopedJobs = useMemo(() => {
    const source = jobs ?? [];
    if (!hidePastJobs || nowTs === null) {
      return source;
    }
    return source.filter((job) => !isPastJob(job, nowTs));
  }, [jobs, hidePastJobs, nowTs]);

  const propertyOptions = useMemo(() => {
    const map = new Map<string, string>();
    (propertiesForCreate ?? []).forEach((property) => {
      map.set(property._id, property.name);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [propertiesForCreate]);

  const cleanerOptions = useMemo(() => {
    const map = new Map<string, string>();
    (cleanerOptionsFromUsers ?? []).forEach((cleaner) => {
      map.set(cleaner._id, cleaner.name?.trim() || `Cleaner ${cleaner._id.slice(-6)}`);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [cleanerOptionsFromUsers]);

  const counts = useMemo(() => {
    const values: Record<string, number> = { all: 0 };
    JOB_STATUSES.forEach((itemStatus) => {
      values[itemStatus] = 0;
    });
    if (statusCounts) {
      values.all = statusCounts.all;
      JOB_STATUSES.forEach((itemStatus) => {
        values[itemStatus] = statusCounts[itemStatus] ?? 0;
      });
    }
    return values;
  }, [statusCounts]);

  const isLoading = jobs === undefined || statusCounts === undefined;

  useEffect(() => {
    if (!openJobMenuId) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-job-row-menu]")) {
        return;
      }
      setOpenJobMenuId(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [openJobMenuId]);

  const jobRows = useMemo(() => {
    let list = scopedJobs;
    const searchValue = search.trim().toLowerCase();

    if (searchValue) {
      list = list.filter((job) => {
        const inId = job._id.toLowerCase().includes(searchValue);
        const inProperty = (job.property?.name ?? "").toLowerCase().includes(searchValue);
        const inCleaner = (job.cleaners?.[0]?.name ?? "").toLowerCase().includes(searchValue);
        const inNotes = (job.notesForCleaner ?? "").toLowerCase().includes(searchValue);
        return inId || inProperty || inCleaner || inNotes;
      });
    }

    if (cleanerId !== "all") {
      list = list.filter((job) => (job.assignedCleanerIds ?? []).includes(cleanerId as Id<"users">));
    }

    if (selectedDate) {
      const start = new Date(selectedDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);

      list = list.filter((job) => {
        const when = job.scheduledStartAt ?? 0;
        return when >= start.getTime() && when < end.getTime();
      });
    }

    const now = nowTs ?? Date.now();
    const dir = sortDir === "asc" ? 1 : -1;
    const sorted = [...list].sort((a, b) => {
      switch (sortKey) {
        case "urgency":
          return (urgencyScore(a, now) - urgencyScore(b, now)) * dir;
        case "job": {
          const aLabel = (a.notesForCleaner?.split("\n")[0] || "Cleaning Job").toLowerCase();
          const bLabel = (b.notesForCleaner?.split("\n")[0] || "Cleaning Job").toLowerCase();
          return aLabel.localeCompare(bLabel) * dir;
        }
        case "property":
          return (a.property?.name ?? "").localeCompare(b.property?.name ?? "") * dir;
        case "cleaner":
          return (a.cleaners?.[0]?.name ?? "").localeCompare(b.cleaners?.[0]?.name ?? "") * dir;
        case "scheduled":
          return ((a.scheduledStartAt ?? 0) - (b.scheduledStartAt ?? 0)) * dir;
        case "status":
          return ((STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99)) * dir;
        default:
          return 0;
      }
    });
    return sorted;
  }, [scopedJobs, selectedDate, search, cleanerId, sortKey, sortDir, nowTs]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const SortHeader = ({ label, k }: { label: string; k: SortKey }) => {
    const active = sortKey === k;
    const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
    return (
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide ${
          active ? "text-[var(--foreground)]" : ""
        }`}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <Icon className="h-3 w-3 opacity-70" />
      </button>
    );
  };

  return (
    <div className="space-y-4 md:space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight text-[var(--foreground)] md:text-display">
            Jobs
          </h1>
          <p className="mt-2 hidden text-[var(--muted-foreground)] md:block">
            Manage active and upcoming cleaning jobs.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between">
        <div className="w-full space-y-2 md:hidden">
          <div className="grid grid-cols-5 gap-2">
            <button
              type="button"
              className={`inline-flex items-center justify-center rounded-none border p-2 ${
                mobileFilterPanel === "search"
                  ? "bg-[var(--accent)] text-[var(--foreground)]"
                  : "bg-[var(--card)] text-[var(--muted-foreground)]"
              }`}
              onClick={() =>
                setMobileFilterPanel((current) =>
                  current === "search" ? null : "search",
                )
              }
              aria-label="Open search"
            >
              <Search className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={`inline-flex items-center justify-center rounded-none border p-2 ${
                mobileFilterPanel === "property"
                  ? "bg-[var(--accent)] text-[var(--foreground)]"
                  : "bg-[var(--card)] text-[var(--muted-foreground)]"
              }`}
              onClick={() =>
                setMobileFilterPanel((current) =>
                  current === "property" ? null : "property",
                )
              }
              aria-label="Open property filter"
            >
              <Building2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={`inline-flex items-center justify-center rounded-none border p-2 ${
                mobileFilterPanel === "cleaner"
                  ? "bg-[var(--accent)] text-[var(--foreground)]"
                  : "bg-[var(--card)] text-[var(--muted-foreground)]"
              }`}
              onClick={() =>
                setMobileFilterPanel((current) =>
                  current === "cleaner" ? null : "cleaner",
                )
              }
              aria-label="Open cleaner filter"
            >
              <Users className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={`inline-flex items-center justify-center rounded-none border p-2 ${
                mobileFilterPanel === "date"
                  ? "bg-[var(--accent)] text-[var(--foreground)]"
                  : "bg-[var(--card)] text-[var(--muted-foreground)]"
              }`}
              onClick={() =>
                setMobileFilterPanel((current) =>
                  current === "date" ? null : "date",
                )
              }
              aria-label="Open date filter"
            >
              <CalendarDays className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={`inline-flex items-center justify-center rounded-none border p-2 ${
                hidePastJobs
                  ? "bg-[var(--accent)] text-[var(--foreground)]"
                  : "bg-[var(--card)] text-[var(--muted-foreground)]"
              }`}
              onClick={() => setHidePastJobs((current) => !current)}
              aria-label={hidePastJobs ? "Show past jobs" : "Hide past jobs"}
              title={hidePastJobs ? "Show past jobs" : "Hide past jobs"}
            >
              {hidePastJobs ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {mobileFilterPanel === "search" ? (
            <div className="flex items-center gap-2 rounded-none border bg-[var(--card)] px-3 py-1.5">
              <Search className="h-4 w-4 text-[var(--muted-foreground)]" />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by job, property, cleaner"
                autoFocus
                className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
              />
            </div>
          ) : null}

          {mobileFilterPanel === "property" ? (
            <SearchableSelect
              value={propertyId === "all" ? null : propertyId}
              onChange={(id) => {
                setPropertyId(id ?? "all");
                setMobileFilterPanel(null);
              }}
              placeholder="All Properties"
              searchPlaceholder="Search properties…"
              aria-label="Filter by property"
              items={propertyOptions.map((p) => ({ id: p.id, label: p.name }))}
            />
          ) : null}

          {mobileFilterPanel === "cleaner" ? (
            <SearchableSelect
              value={cleanerId === "all" ? null : cleanerId}
              onChange={(id) => {
                setCleanerId(id ?? "all");
                setMobileFilterPanel(null);
              }}
              placeholder="All Cleaners"
              searchPlaceholder="Search cleaners…"
              aria-label="Filter by cleaner"
              items={cleanerOptions.map((c) => ({ id: c.id, label: c.name }))}
            />
          ) : null}

          {mobileFilterPanel === "date" ? (
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => {
                setSelectedDate(event.target.value);
                setMobileFilterPanel(null);
              }}
              className="w-full rounded-none border bg-[var(--card)] px-3 py-1.5 text-sm"
              aria-label="Filter by date"
            />
          ) : null}
        </div>

        <div className="hidden flex-wrap items-center gap-2 md:flex">
          <div className="flex items-center gap-2 rounded-none border bg-[var(--card)] px-3 py-1.5">
            <Search className="h-4 w-4 text-[var(--muted-foreground)]" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by job, property, cleaner"
              className="w-56 bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
            />
          </div>

          <div className="w-48">
            <SearchableSelect
              value={propertyId === "all" ? null : propertyId}
              onChange={(id) => setPropertyId(id ?? "all")}
              placeholder="All Properties"
              searchPlaceholder="Search properties…"
              aria-label="Filter by property"
              items={propertyOptions.map((p) => ({ id: p.id, label: p.name }))}
            />
          </div>

          <div className="w-44">
            <SearchableSelect
              value={cleanerId === "all" ? null : cleanerId}
              onChange={(id) => setCleanerId(id ?? "all")}
              placeholder="All Cleaners"
              searchPlaceholder="Search cleaners…"
              aria-label="Filter by cleaner"
              items={cleanerOptions.map((c) => ({ id: c.id, label: c.name }))}
            />
          </div>

          <input
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            className="rounded-none border bg-[var(--card)] px-3 py-1.5 text-sm"
            aria-label="Filter by date"
          />
          <button
            type="button"
            onClick={() => setHidePastJobs((current) => !current)}
            className={`inline-flex items-center gap-2 rounded-none border px-3 py-1.5 text-sm ${
              hidePastJobs
                ? "bg-[var(--accent)] text-[var(--foreground)]"
                : "bg-[var(--card)] text-[var(--muted-foreground)]"
            }`}
            aria-label={hidePastJobs ? "Show past jobs" : "Hide past jobs"}
            title={hidePastJobs ? "Show past jobs" : "Hide past jobs"}
          >
            {hidePastJobs ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {hidePastJobs ? "Hide Past" : "Show Past"}
          </button>
        </div>

        {canCreateJob && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex w-full items-center justify-center gap-2 rounded-none bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 md:w-auto"
          >
            <Plus className="h-4 w-4" />
            New Job
          </button>
        )}
      </div>

      <div className="flex gap-1 overflow-x-auto border-b">
        {["all", ...JOB_STATUSES].map((itemStatus) => {
          const typedStatus = itemStatus as JobStatus | "all";
          const active = status === typedStatus;
          return (
            <button
              key={itemStatus}
              onClick={() => setStatus(typedStatus)}
              className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm ${
                active
                  ? "border-[var(--primary)] text-[var(--foreground)] font-bold"
                  : "border-transparent text-[var(--muted-foreground)]"
              }`}
            >
              {itemStatus === "all" ? "All" : STATUS_LABELS[itemStatus as JobStatus]}{" "}
              <span className="ml-1 text-xs opacity-70">{counts[itemStatus] ?? 0}</span>
            </button>
          );
        })}
      </div>

      <div className="no-line-card border">
        {isLoading ? (
          <div className="flex min-h-40 items-center justify-center p-6 text-sm text-[var(--muted-foreground)]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading jobs...
          </div>
        ) : null}
        {!isLoading ? (
          <div className="divide-y md:hidden">
            {jobRows.map((job) => {
              const hasAssignedCleaner = (job.assignedCleanerIds?.length ?? 0) > 0;
              return (
              <article key={job._id} className="p-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                      {job.notesForCleaner?.split("\n")[0] || "Cleaning Job"}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">
                      {job.property?.name ?? "Unknown property"}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
                      <span>{STATUS_LABELS[job.status]} · {formatDateTimeInZone(job.scheduledStartAt ?? 0, resolveDisplayTimezone(job.property?.timezone), DATE_TIME_OPTS)}</span>
                      <JobCountdown
                        scheduledStartAt={job.scheduledStartAt}
                        actualStartAt={job.actualStartAt}
                        actualEndAt={job.actualEndAt}
                        status={job.status}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Link
                      href={`/jobs/${job._id}`}
                      className="inline-flex items-center justify-center rounded-md border p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
                      aria-label={hasAssignedCleaner ? "View assigned cleaner" : "Assign cleaner"}
                      title={hasAssignedCleaner ? "Cleaner assigned" : "Assign cleaner"}
                    >
                      <span className="relative inline-flex">
                        <UserRound className="h-4 w-4" />
                        {hasAssignedCleaner ? (
                          <span className="absolute -bottom-1 -right-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-600 text-white">
                            <Check className="h-2.5 w-2.5" />
                          </span>
                        ) : null}
                      </span>
                    </Link>
                    <div className="relative" data-job-row-menu>
                    <button
                      type="button"
                      className="rounded-md border px-2 py-1 text-sm leading-none"
                      onClick={() =>
                        setOpenJobMenuId((current) => (current === job._id ? null : job._id))
                      }
                      aria-haspopup="menu"
                      aria-expanded={openJobMenuId === job._id}
                    >
                      ⋮
                    </button>
                    {openJobMenuId === job._id ? (
                      <div className="absolute right-0 top-9 z-20 w-64 rounded-none border bg-[var(--card)] p-2 shadow-lg">
                        <div className="space-y-1 border-b pb-2 text-xs text-[var(--muted-foreground)]">
                          <p className="truncate">ID: {job._id}</p>
                          <p className="truncate">Cleaner: {job.cleaners?.[0]?.name ?? "Unassigned"}</p>
                          <p className="truncate">
                            Scheduled: {formatDateTimeInZone(job.scheduledStartAt ?? 0, resolveDisplayTimezone(job.property?.timezone), DATE_TIME_OPTS)}
                          </p>
                        </div>
                        <div className="mt-2">
                          <Link
                            href={`/jobs/${job._id}`}
                            className="block w-full rounded-md border px-2 py-1.5 text-left text-xs text-[var(--primary)] hover:bg-[var(--accent)]"
                          >
                            View Job
                          </Link>
                        </div>
                      </div>
                    ) : null}
                    </div>
                  </div>
                </div>
              </article>
              );
            })}
            {!jobRows.length ? (
              <div className="px-4 py-12 text-center text-sm text-[var(--muted-foreground)]">
                No jobs found for current filters.
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="hidden overflow-x-auto md:block">
          <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
            <tr>
              <th className="px-4 py-3"><SortHeader label="Job" k="job" /></th>
              <th className="px-4 py-3"><SortHeader label="Property" k="property" /></th>
              <th className="px-4 py-3"><SortHeader label="Cleaner" k="cleaner" /></th>
              <th className="px-4 py-3"><SortHeader label="Scheduled" k="scheduled" /></th>
              <th className="px-4 py-3"><SortHeader label="Countdown" k="urgency" /></th>
              <th className="px-4 py-3">Workflow</th>
              <th className="px-4 py-3"><SortHeader label="Status" k="status" /></th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobRows.map((job) => (
              <tr key={job._id} className="border-b border-[var(--border)] last:border-b-0">
                <td className="px-4 py-3">
                  <p className="font-medium">{job.notesForCleaner?.split("\n")[0] || "Cleaning Job"}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">{job._id}</p>
                </td>
                <td className="px-4 py-3">{job.property?.name ?? "Unknown property"}</td>
                <td className="px-4 py-3">{job.cleaners?.[0]?.name ?? "Unassigned"}</td>
                <td className="px-4 py-3">{formatDateTimeInZone(job.scheduledStartAt ?? 0, resolveDisplayTimezone(job.property?.timezone), DATE_TIME_OPTS)}</td>
                <td className="px-4 py-3">
                  <JobCountdown
                    scheduledStartAt={job.scheduledStartAt}
                    actualStartAt={job.actualStartAt}
                    actualEndAt={job.actualEndAt}
                    status={job.status}
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    {workflowStatuses.map((stepStatus, index) => {
                      const active = workflowIndex(job.status) >= index;
                      return (
                        <span
                          key={stepStatus}
                          className={`h-2 w-2 rounded-full ${
                            active ? "bg-[var(--primary)]" : "bg-[var(--border)]"
                          }`}
                          title={STATUS_LABELS[stepStatus]}
                        />
                      );
                    })}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_CLASSNAMES[job.status]}`}
                  >
                    {STATUS_LABELS[job.status]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/jobs/${job._id}`}
                    className="text-[var(--primary)] hover:underline"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
          </table>

          {!isLoading && !jobRows.length ? (
            <div className="px-4 py-12 text-center text-sm text-[var(--muted-foreground)]">
              No jobs found for current filters.
            </div>
          ) : null}
        </div>
      </div>

      <CreateJobModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        propertyOptions={propertyOptions}
        cleanerOptions={cleanerOptions}
      />
    </div>
  );
}

function workflowIndex(status: JobStatus) {
  const index = workflowStatuses.indexOf(status);
  if (index === -1) {
    return 0;
  }
  return index;
}

function isPastJob(
  job: { scheduledEndAt?: number; scheduledStartAt?: number },
  now: number,
) {
  const end = job.scheduledEndAt ?? job.scheduledStartAt ?? 0;
  return end < now;
}
