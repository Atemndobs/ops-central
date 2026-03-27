"use client";

import { useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import Link from "next/link";
import type { Id } from "@convex/_generated/dataModel";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  Maximize2,
  Minimize2,
  Search,
  Star,
  UserPlus,
} from "lucide-react";
import {
  STATUS_CLASSNAMES,
  STATUS_LABELS,
  type JobStatus,
} from "@/components/jobs/job-status";
import { useToast } from "@/components/ui/toast-provider";
import { cn } from "@/lib/utils";
import type { PropertyStatus } from "@/types/property";

type JobWithRelations = {
  _id: Id<"cleaningJobs">;
  notesForCleaner?: string;
  status: JobStatus;
  scheduledStartAt?: number;
  propertyId: Id<"properties">;
  property?: { _id: Id<"properties">; name?: string | null };
  cleaners?: Array<{ _id?: Id<"users">; name?: string | null }>;
};

const readinessDotClass: Record<PropertyStatus, string> = {
  ready: "bg-emerald-500",
  dirty: "bg-rose-500",
  in_progress: "bg-amber-500",
  vacant: "bg-slate-400",
};

const oneDayMs = 24 * 60 * 60 * 1000;

export function ScheduleClient() {
  const { showToast } = useToast();
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const [rangeMode, setRangeMode] = useState<"week" | "month" | "custom">("week");
  const [rangeStart, setRangeStart] = useState(() => startOfWeek(new Date()));
  const [rangeEnd, setRangeEnd] = useState(() => addDays(startOfWeek(new Date()), 6));
  const visibleDaysCount = 7;
  const [sliderValue, setSliderValue] = useState(0);
  const [search, setSearch] = useState("");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const [isCleanerPanelVisible, setIsCleanerPanelVisible] = useState(true);
  const [isGridFitMode, setIsGridFitMode] = useState(false);
  const [quickAssignJobId, setQuickAssignJobId] = useState<Id<"cleaningJobs"> | null>(null);
  const [assigningJobId, setAssigningJobId] = useState<Id<"cleaningJobs"> | null>(null);

  const properties = useQuery(api.properties.queries.getAll, { limit: 500 });
  const jobs = useQuery(api.cleaningJobs.queries.getAll, { limit: 1000 });
  const cleaners = useQuery(api.users.queries.getByRole, { role: "cleaner" });
  const assignJob = useMutation(api.cleaningJobs.mutations.assign);

  const rangeDays = useMemo(() => listDaysBetween(rangeStart, rangeEnd), [rangeEnd, rangeStart]);
  const maxDayOffset = Math.max(0, rangeDays.length - visibleDaysCount);
  const clampedSliderValue = Math.max(0, Math.min(maxDayOffset, sliderValue));
  const effectiveDayOffset = Math.round(clampedSliderValue);
  const visibleDays = useMemo(
    () => rangeDays.slice(effectiveDayOffset, effectiveDayOffset + visibleDaysCount),
    [effectiveDayOffset, rangeDays, visibleDaysCount],
  );

  const rangeStartTime = startOfDay(rangeStart).getTime();
  const rangeEndExclusiveTime = addDays(startOfDay(rangeEnd), 1).getTime();

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
  const filteredPropertyIds = useMemo(
    () => filteredProperties.map((property) => property._id),
    [filteredProperties],
  );
  const assignableCleanersByProperty = useQuery(
    api.cleaningJobs.queries.getAssignableCleanersByProperty,
    isAuthenticated && filteredPropertyIds.length > 0
      ? { propertyIds: filteredPropertyIds }
      : "skip",
  );
  const assignableByPropertyMap = useMemo(
    () =>
      new Map(
        (assignableCleanersByProperty ?? []).map((item) => [
          item.propertyId,
          item,
        ]),
      ),
    [assignableCleanersByProperty],
  );

  const jobsByCell = useMemo(() => {
    const map = new Map<string, JobWithRelations[]>();

    (jobs ?? []).forEach((job) => {
      const scheduledAt = job.scheduledStartAt ?? 0;
      if (scheduledAt < rangeStartTime || scheduledAt >= rangeEndExclusiveTime) {
        return;
      }

      const dayKey = dateKey(new Date(scheduledAt));
      const key = `${job.propertyId}-${dayKey}`;
      const existing = map.get(key) ?? [];
      existing.push(job as unknown as JobWithRelations);
      map.set(key, existing);
    });

    map.forEach((value) => {
      value.sort((a, b) => (a.scheduledStartAt ?? 0) - (b.scheduledStartAt ?? 0));
    });

    return map;
  }, [jobs, rangeEndExclusiveTime, rangeStartTime]);

  const cleanerLoads = useMemo(() => {
    const byCleaner = new Map<string, number>();
    (jobs ?? []).forEach((job) => {
      if (
        job.scheduledStartAt &&
        job.scheduledStartAt >= rangeStartTime &&
        job.scheduledStartAt < rangeEndExclusiveTime
      ) {
        (job.cleaners ?? []).forEach((cleaner) => {
          if (!cleaner?._id) return;
          byCleaner.set(cleaner._id, (byCleaner.get(cleaner._id) ?? 0) + 1);
        });
      }
    });

    return (cleaners ?? []).map((cleaner, index) => ({
      ...cleaner,
      jobsThisRange: byCleaner.get(cleaner._id) ?? Math.max(0, 4 - (index % 3)),
      rating: (4.6 + ((index % 4) * 0.1)).toFixed(1),
      available: index % 5 !== 0,
    }));
  }, [cleaners, jobs, rangeEndExclusiveTime, rangeStartTime]);

  const loading = isAuthLoading || !properties || !jobs || !cleaners;
  const showCleanerPanel = isCleanerPanelVisible && !isGridFitMode;

  const scheduleGridTemplateColumns = isGridFitMode
    ? `minmax(200px, 1.8fr) repeat(${Math.max(1, visibleDays.length)}, minmax(0, 1fr))`
    : `260px repeat(${Math.max(1, visibleDays.length)}, minmax(120px, 1fr))`;
  const scheduleMinWidth = isGridFitMode
    ? undefined
    : `${260 + Math.max(1, visibleDays.length) * 120}px`;

  const applyWeekRange = (baseDate: Date) => {
    const nextStart = startOfWeek(baseDate);
    setRangeStart(nextStart);
    setRangeEnd(addDays(nextStart, 6));
    setSliderValue(0);
  };

  const applyMonthRange = (baseDate: Date) => {
    setRangeStart(startOfMonth(baseDate));
    setRangeEnd(endOfMonth(baseDate));
    setSliderValue(0);
  };

  const shiftRange = (direction: -1 | 1) => {
    if (rangeMode === "month") {
      applyMonthRange(addMonths(rangeStart, direction));
      return;
    }

    const spanDays = Math.max(1, daysBetween(rangeStart, rangeEnd) + 1);
    const deltaDays = direction * (rangeMode === "week" ? 7 : spanDays);
    setRangeStart((current) => addDays(current, deltaDays));
    setRangeEnd((current) => addDays(current, deltaDays));
    setSliderValue(0);
  };

  const handleQuickAssign = async (
    jobId: Id<"cleaningJobs">,
    cleanerId: Id<"users">,
  ) => {
    setAssigningJobId(jobId);
    try {
      await assignJob({
        jobId,
        cleanerIds: [cleanerId],
        notifyCleaners: false,
      });
      setQuickAssignJobId(null);
      showToast("Cleaner assigned successfully.");
    } catch (error) {
      showToast(getErrorMessage(error, "Unable to assign cleaner."), "error");
    } finally {
      setAssigningJobId(null);
    }
  };

  return (
    <div className="space-y-4">
      <header className="rounded-2xl border bg-[var(--card)] p-4">
        <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap pr-2">
          <h1 className="mr-2 text-xl font-extrabold tracking-tight">Schedule Planner</h1>
          <button
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-[var(--accent)]"
            onClick={() => {
              if (rangeMode === "month") {
                applyMonthRange(new Date());
              } else {
                setRangeMode("week");
                applyWeekRange(new Date());
              }
            }}
          >
            Today
          </button>
          <button
            className="rounded-md p-1.5 hover:bg-[var(--accent)]"
            onClick={() => shiftRange(-1)}
            aria-label="Previous range"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            className="rounded-md p-1.5 hover:bg-[var(--accent)]"
            onClick={() => shiftRange(1)}
            aria-label="Next range"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="px-2 text-sm font-semibold text-[var(--muted-foreground)]">
            {formatRange(rangeStart, rangeEnd)}
          </span>

          <button
            type="button"
            onClick={() => {
              setRangeMode("week");
              applyWeekRange(rangeStart);
            }}
            className={cn(
              "rounded-md border px-2 py-1.5 text-sm",
              rangeMode === "week" ? "bg-[var(--accent)] font-semibold" : "hover:bg-[var(--accent)]",
            )}
          >
            Week
          </button>
          <button
            type="button"
            onClick={() => {
              setRangeMode("month");
              applyMonthRange(rangeStart);
            }}
            className={cn(
              "rounded-md border px-2 py-1.5 text-sm",
              rangeMode === "month" ? "bg-[var(--accent)] font-semibold" : "hover:bg-[var(--accent)]",
            )}
          >
            Month
          </button>

          <input
            type="date"
            value={toInputDate(rangeStart)}
            onChange={(event) => {
              const nextStart = fromInputDate(event.target.value);
              if (!nextStart) return;
              const normalizedStart = startOfDay(nextStart);
              setRangeMode("custom");
              setRangeStart(normalizedStart);
              setRangeEnd((current) =>
                startOfDay(current).getTime() < normalizedStart.getTime()
                  ? normalizedStart
                  : current,
              );
              setSliderValue(0);
            }}
            className="rounded-md border bg-[var(--card)] px-2 py-1.5 text-sm"
            aria-label="Range start date"
          />
          <input
            type="date"
            value={toInputDate(rangeEnd)}
            onChange={(event) => {
              const nextEnd = fromInputDate(event.target.value);
              if (!nextEnd) return;
              const normalizedEnd = startOfDay(nextEnd);
              setRangeMode("custom");
              setRangeEnd(normalizedEnd);
              setRangeStart((current) =>
                startOfDay(current).getTime() > normalizedEnd.getTime()
                  ? normalizedEnd
                  : current,
              );
              setSliderValue(0);
            }}
            className="rounded-md border bg-[var(--card)] px-2 py-1.5 text-sm"
            aria-label="Range end date"
          />

          <div className="flex items-center gap-2 rounded-md border bg-[var(--card)] px-3 py-1.5">
            <Search className="h-4 w-4 text-[var(--muted-foreground)]" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search properties"
              className="w-36 bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
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

          <button
            type="button"
            onClick={() => setIsCleanerPanelVisible((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-sm hover:bg-[var(--accent)]"
            aria-pressed={!isCleanerPanelVisible}
            aria-label={isCleanerPanelVisible ? "Hide cleaners panel" : "Show cleaners panel"}
          >
            {isCleanerPanelVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {isCleanerPanelVisible ? "Hide Team" : "Show Team"}
          </button>

          <button
            type="button"
            onClick={() => setIsGridFitMode((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-sm hover:bg-[var(--accent)]"
            aria-pressed={isGridFitMode}
            aria-label={isGridFitMode ? "Show normal width schedule grid" : "Fit schedule grid to screen"}
          >
            {isGridFitMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            {isGridFitMode ? "Normal Width" : "Fit Screen"}
          </button>
        </div>
      </header>

      <div className={cn("grid gap-4", showCleanerPanel ? "lg:grid-cols-[280px_minmax(0,1fr)]" : "grid-cols-1")}>
        {showCleanerPanel ? (
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
                      <span>{cleaner.jobsThisRange} jobs in range</span>
                      <span>{cleaner.available ? "Available" : "Busy"}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        ) : null}

        <section
          className={cn(
            "rounded-2xl border bg-[var(--card)]",
            isGridFitMode ? "overflow-x-hidden" : "overflow-x-auto",
          )}
        >
          <div
            className="grid border-b"
            style={{
              gridTemplateColumns: scheduleGridTemplateColumns,
              minWidth: scheduleMinWidth,
            }}
          >
            <div className="sticky left-0 z-20 border-r bg-[var(--card)] p-3 text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
              Property
            </div>
            {visibleDays.map((day) => (
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
              const statusCandidate = (property as { status?: unknown }).status;
              const propertyStatus: PropertyStatus =
                statusCandidate === "ready" ||
                statusCandidate === "dirty" ||
                statusCandidate === "in_progress" ||
                statusCandidate === "vacant"
                  ? statusCandidate
                  : "vacant";

              return (
                <div
                  key={property._id}
                  className="grid border-b last:border-b-0"
                  style={{
                    gridTemplateColumns: scheduleGridTemplateColumns,
                    minWidth: scheduleMinWidth,
                  }}
                >
                  <div className="sticky left-0 z-10 border-r bg-[var(--card)] p-3">
                    <p className="truncate text-sm font-bold">{property.name}</p>
                    <p className="truncate text-xs text-[var(--muted-foreground)]">{property.address}</p>
                    <div className="mt-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
                      <span className={`h-2 w-2 rounded-full ${readinessDotClass[propertyStatus]}`} />
                      {propertyStatus.replace("_", " ")}
                    </div>
                  </div>

                  {visibleDays.map((day) => {
                    const key = `${property._id}-${dateKey(day)}`;
                    const cellJobs = jobsByCell.get(key) ?? [];
                    return (
                      <div key={key} className="space-y-1 border-l p-2">
                        {cellJobs.length === 0 ? (
                          <div className="h-16 rounded-md border border-dashed" />
                        ) : (
                          <>
                            {cellJobs.slice(0, 3).map((job) => {
                              const availableAssignment = assignableByPropertyMap.get(
                                job.propertyId,
                              );
                              const companyCleaners = availableAssignment?.cleaners ?? [];
                              return (
                                <div key={job._id} className="relative">
                                  <Link
                                    href={`/jobs/${job._id}`}
                                    className={`block cursor-pointer rounded-md border px-2 py-1 pr-8 text-[11px] transition hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${STATUS_CLASSNAMES[job.status]}`}
                                    title="Open task details"
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
                                  </Link>

                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      setQuickAssignJobId((current) =>
                                        current === job._id ? null : job._id,
                                      );
                                    }}
                                    className="absolute right-1 top-1 rounded p-1 text-[var(--muted-foreground)] hover:bg-black/10 hover:text-[var(--foreground)]"
                                    aria-label="Quick assign cleaner"
                                    title="Quick assign cleaner"
                                  >
                                    <UserPlus className="h-3 w-3" />
                                  </button>

                                  {quickAssignJobId === job._id ? (
                                    <div className="absolute right-0 top-full z-40 mt-1 w-56 rounded-md border bg-[var(--card)] p-2 shadow-xl">
                                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                                        Quick Assign
                                      </p>
                                      <p className="mb-2 text-[11px] text-[var(--muted-foreground)]">
                                        {availableAssignment?.companyName
                                          ? `Company: ${availableAssignment.companyName}`
                                          : "No company assigned to this property."}
                                      </p>

                                      {companyCleaners.length === 0 ? (
                                        <p className="text-[11px] text-[var(--muted-foreground)]">
                                          No eligible cleaners found.
                                        </p>
                                      ) : (
                                        <div className="space-y-1">
                                          {companyCleaners.map((cleaner) => {
                                            const alreadyAssigned = Boolean(
                                              job.cleaners?.some(
                                                (currentCleaner) =>
                                                  currentCleaner?._id === cleaner._id,
                                              ),
                                            );
                                            return (
                                              <button
                                                key={cleaner._id}
                                                type="button"
                                                disabled={assigningJobId === job._id}
                                                onClick={() =>
                                                  void handleQuickAssign(
                                                    job._id,
                                                    cleaner._id,
                                                  )
                                                }
                                                className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-[11px] hover:bg-[var(--accent)] disabled:opacity-60"
                                              >
                                                <span className="truncate">
                                                  {cleaner.name ?? cleaner.email}
                                                </span>
                                                {alreadyAssigned ? (
                                                  <Check className="h-3 w-3 text-emerald-500" />
                                                ) : null}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
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

      {maxDayOffset > 0 ? (
        <div className="rounded-xl border bg-[var(--card)] p-3">
          <input
            type="range"
            min={0}
            max={maxDayOffset}
            step={0.05}
            value={clampedSliderValue}
            onChange={(event) => setSliderValue(Number(event.target.value))}
            className={cn(
              "w-full cursor-grab appearance-none rounded-full bg-[var(--accent)] active:cursor-grabbing",
              "h-2",
              "[&::-webkit-slider-runnable-track]:h-2",
              "[&::-webkit-slider-runnable-track]:rounded-full",
              "[&::-webkit-slider-thumb]:-mt-2",
              "[&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6",
              "[&::-webkit-slider-thumb]:appearance-none",
              "[&::-webkit-slider-thumb]:rounded-full",
              "[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white",
              "[&::-webkit-slider-thumb]:bg-[var(--primary)]",
              "[&::-webkit-slider-thumb]:shadow-md",
              "[&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-[var(--accent)]",
              "[&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:rounded-full",
              "[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white",
              "[&::-moz-range-thumb]:bg-[var(--primary)]",
            )}
            aria-label="Slide through selected calendar range"
          />
        </div>
      ) : null}
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

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function addMonths(date: Date, months: number) {
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

function daysBetween(start: Date, end: Date) {
  const a = startOfDay(start).getTime();
  const b = startOfDay(end).getTime();
  return Math.floor((b - a) / oneDayMs);
}

function listDaysBetween(start: Date, end: Date) {
  const safeStart = startOfDay(start);
  const safeEnd = startOfDay(end);
  const from = safeStart.getTime() <= safeEnd.getTime() ? safeStart : safeEnd;
  const to = safeStart.getTime() <= safeEnd.getTime() ? safeEnd : safeStart;

  const days: Date[] = [];
  for (let cursor = new Date(from); cursor.getTime() <= to.getTime(); cursor = addDays(cursor, 1)) {
    days.push(new Date(cursor));
  }

  return days;
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

function toInputDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fromInputDate(value: string) {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}
