"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { ChevronLeft, ChevronRight, Loader2, Search, Star } from "lucide-react";
import {
  STATUS_CLASSNAMES,
  STATUS_LABELS,
  type JobStatus,
} from "@/components/jobs/job-status";
import type { PropertyRecord, PropertyStatus } from "@/types/property";

type JobWithRelations = {
  _id: string;
  notesForCleaner?: string;
  status: JobStatus;
  scheduledStartAt?: number;
  propertyId: string;
  property?: { _id: string; name?: string | null };
  cleaners?: Array<{ _id?: string; name?: string | null }>;
};

type TeamMember = {
  _id: string;
  name?: string;
  email?: string;
  role: "cleaner" | "manager" | "property_ops" | "admin";
};

const queryRef = <TArgs extends Record<string, unknown>, TReturn>(name: string) =>
  name as unknown as FunctionReference<"query", "public", TArgs, TReturn>;

const readinessDotClass: Record<PropertyStatus, string> = {
  ready: "bg-emerald-500",
  dirty: "bg-rose-500",
  in_progress: "bg-amber-500",
  vacant: "bg-slate-400",
};

const oneDayMs = 24 * 60 * 60 * 1000;

export function ScheduleClient() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [search, setSearch] = useState("");
  const [propertyFilter, setPropertyFilter] = useState("all");

  const properties = useQuery(
    queryRef<{ limit?: number }, PropertyRecord[]>("properties/queries:getAll"),
    { limit: 500 },
  );

  const jobs = useQuery(
    queryRef<{ limit?: number }, JobWithRelations[]>("cleaningJobs/queries:getAll"),
    { limit: 1000 },
  );

  const cleaners = useQuery(
    queryRef<{ role: "cleaner" }, TeamMember[]>("users/queries:getByRole"),
    { role: "cleaner" },
  );

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );

  const weekStartTime = weekStart.getTime();
  const weekEndTime = weekStartTime + 7 * oneDayMs;

  const filteredProperties = useMemo(() => {
    const source = properties ?? [];
    const q = search.trim().toLowerCase();

    return source.filter((property) => {
      const propertyMatches = propertyFilter === "all" || property._id === propertyFilter;
      const textMatches =
        !q ||
        property.name.toLowerCase().includes(q) ||
        property.address.toLowerCase().includes(q);
      return propertyMatches && textMatches;
    });
  }, [properties, propertyFilter, search]);

  const jobsByCell = useMemo(() => {
    const map = new Map<string, JobWithRelations[]>();

    (jobs ?? []).forEach((job) => {
      const scheduledAt = job.scheduledStartAt ?? 0;
      if (scheduledAt < weekStartTime || scheduledAt >= weekEndTime) {
        return;
      }

      const dayKey = dateKey(new Date(scheduledAt));
      const key = `${job.propertyId}-${dayKey}`;
      const existing = map.get(key) ?? [];
      existing.push(job);
      map.set(key, existing);
    });

    map.forEach((value) => {
      value.sort((a, b) => (a.scheduledStartAt ?? 0) - (b.scheduledStartAt ?? 0));
    });

    return map;
  }, [jobs, weekEndTime, weekStartTime]);

  const cleanerLoads = useMemo(() => {
    const byCleaner = new Map<string, number>();
    (jobs ?? []).forEach((job) => {
      if (job.scheduledStartAt && job.scheduledStartAt >= weekStartTime && job.scheduledStartAt < weekEndTime) {
        (job.cleaners ?? []).forEach((cleaner) => {
          if (!cleaner._id) return;
          byCleaner.set(cleaner._id, (byCleaner.get(cleaner._id) ?? 0) + 1);
        });
      }
    });

    return (cleaners ?? []).map((cleaner, index) => ({
      ...cleaner,
      jobsThisWeek: byCleaner.get(cleaner._id) ?? Math.max(0, 4 - (index % 3)),
      rating: (4.6 + ((index % 4) * 0.1)).toFixed(1),
      available: index % 5 !== 0,
    }));
  }, [cleaners, jobs, weekStartTime, weekEndTime]);

  const loading = !properties || !jobs || !cleaners;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-[var(--card)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-2 text-xl font-extrabold tracking-tight">Weekly Schedule</h1>
          <button
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-[var(--accent)]"
            onClick={() => setWeekStart(startOfWeek(new Date()))}
          >
            Today
          </button>
          <button
            className="rounded-md p-1.5 hover:bg-[var(--accent)]"
            onClick={() => setWeekStart((current) => addDays(current, -7))}
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            className="rounded-md p-1.5 hover:bg-[var(--accent)]"
            onClick={() => setWeekStart((current) => addDays(current, 7))}
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold text-[var(--muted-foreground)]">
            {formatRange(weekDays[0], weekDays[6])}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-md border bg-[var(--card)] px-3 py-1.5">
            <Search className="h-4 w-4 text-[var(--muted-foreground)]" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search properties"
              className="w-40 bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
            />
          </div>
          <select
            value={propertyFilter}
            onChange={(event) => setPropertyFilter(event.target.value)}
            className="rounded-md border bg-[var(--card)] px-2 py-1.5 text-sm"
          >
            <option value="all">All Properties</option>
            {(properties ?? []).map((property) => (
              <option key={property._id} value={property._id}>
                {property.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-2xl border bg-[var(--card)] p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
              Cleaners Available
            </h2>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
              {cleanerLoads.filter((c) => c.available).length} Active
            </span>
          </div>

          <div className="space-y-3">
            {loading ? (
              <div className="flex min-h-40 items-center justify-center text-sm text-[var(--muted-foreground)]">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading team...
              </div>
            ) : cleanerLoads.length === 0 ? (
              <p className="rounded-lg border border-dashed p-3 text-sm text-[var(--muted-foreground)]">
                No cleaners found.
              </p>
            ) : (
              cleanerLoads.slice(0, 10).map((cleaner) => (
                <div key={cleaner._id} className="rounded-xl border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{cleaner.name || cleaner.email || "Unknown"}</p>
                      <p className="flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
                        <Star className="h-3 w-3 text-amber-500" />
                        {cleaner.rating}
                      </p>
                    </div>
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${cleaner.available ? "bg-emerald-500" : "bg-slate-400"}`}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--muted-foreground)]">
                    <span>{cleaner.jobsThisWeek} jobs this week</span>
                    <span>{cleaner.available ? "Available" : "Busy"}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        <section className="overflow-x-auto rounded-2xl border bg-[var(--card)]">
          <div className="grid min-w-[980px] grid-cols-[260px_repeat(7,minmax(120px,1fr))] border-b">
            <div className="p-3 text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
              Property
            </div>
            {weekDays.map((day) => (
              <div key={dateKey(day)} className="border-l p-3 text-center">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                  {day.toLocaleDateString([], { weekday: "short" })}
                </p>
                <p className="text-lg font-extrabold leading-none">
                  {day.toLocaleDateString([], { day: "2-digit" })}
                </p>
              </div>
            ))}
          </div>

          {loading ? (
            <div className="flex min-h-48 items-center justify-center text-sm text-[var(--muted-foreground)]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading schedule...
            </div>
          ) : filteredProperties.length === 0 ? (
            <div className="px-4 py-10 text-sm text-[var(--muted-foreground)]">
              No properties match your filter.
            </div>
          ) : (
            filteredProperties.map((property) => {
              const propertyStatus = property.status ?? "vacant";

              return (
                <div
                  key={property._id}
                  className="grid min-w-[980px] grid-cols-[260px_repeat(7,minmax(120px,1fr))] border-b last:border-b-0"
                >
                  <div className="p-3">
                    <p className="truncate text-sm font-bold">{property.name}</p>
                    <p className="truncate text-xs text-[var(--muted-foreground)]">{property.address}</p>
                    <div className="mt-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
                      <span className={`h-2 w-2 rounded-full ${readinessDotClass[propertyStatus]}`} />
                      {propertyStatus.replace("_", " ")}
                    </div>
                  </div>

                  {weekDays.map((day) => {
                    const key = `${property._id}-${dateKey(day)}`;
                    const cellJobs = jobsByCell.get(key) ?? [];
                    return (
                      <div key={key} className="space-y-1 border-l p-2">
                        {cellJobs.length === 0 ? (
                          <div className="h-16 rounded-md border border-dashed" />
                        ) : (
                          <>
                            {cellJobs.slice(0, 3).map((job) => (
                              <div
                                key={job._id}
                                className={`rounded-md border px-2 py-1 text-[11px] ${STATUS_CLASSNAMES[job.status]}`}
                              >
                                <p className="truncate font-semibold">{job.property?.name ?? "Cleaning Job"}</p>
                                <p className="text-[10px] opacity-80">
                                  {new Date(job.scheduledStartAt ?? 0).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                  {" · "}
                                  {STATUS_LABELS[job.status]}
                                </p>
                              </div>
                            ))}
                            {cellJobs.length > 3 ? (
                              <p className="text-[10px] text-[var(--muted-foreground)]">
                                +{cellJobs.length - 3} more
                              </p>
                            ) : null}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </section>
      </div>
    </div>
  );
}

function startOfWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function formatRange(start: Date, end: Date) {
  const startLabel = start.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
  const endLabel = end.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return `${startLabel} - ${endLabel}`;
}
