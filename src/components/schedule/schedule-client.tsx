"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import Link from "next/link";
import type { Id } from "@convex/_generated/dataModel";
import {
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Filter,
  Loader2,
  Maximize2,
  Minimize2,
  Search,
  Star,
  UserPlus,
  Users,
  X,
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
  cleaners?: Array<{ _id?: Id<"users">; name?: string | null; avatarUrl?: string | null }>;
};

const readinessDotClass: Record<PropertyStatus, string> = {
  ready: "bg-emerald-500",
  dirty: "bg-rose-500",
  in_progress: "bg-amber-500",
  vacant: "bg-slate-400",
};

const statusDotClass: Record<string, string> = {
  scheduled: "bg-blue-500",
  assigned: "bg-blue-400",
  in_progress: "bg-amber-500",
  awaiting_approval: "bg-indigo-500",
  completed: "bg-emerald-500",
  rework_required: "bg-rose-500",
  cancelled: "bg-rose-600",
};

const oneDayMs = 24 * 60 * 60 * 1000;

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

function propertyInitials(name: string): string {
  const words = name.replace(/[-_]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function cleanerInitials(name?: string | null): string {
  if (!name) {
    return "U";
  }
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) {
    return "U";
  }
  if (words.length === 1) {
    return words[0].slice(0, 1).toUpperCase();
  }
  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
}

function AssignedCleanerBadge({
  cleaner,
}: {
  cleaner?: { name?: string | null; avatarUrl?: string | null } | null;
}) {
  const initials = cleanerInitials(cleaner?.name);
  return (
    <span className="relative inline-flex h-5 w-5 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50">
      {cleaner?.avatarUrl ? (
        <img
          src={cleaner.avatarUrl}
          alt={cleaner.name ? `${cleaner.name} avatar` : "Cleaner avatar"}
          className="h-full w-full rounded-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className="text-[9px] font-semibold text-emerald-700">{initials}</span>
      )}
      <span className="absolute -bottom-1 -right-1 rounded-full border border-white bg-emerald-500 p-[1px] text-white">
        <Check className="h-2.5 w-2.5" />
      </span>
    </span>
  );
}

function worstStatus(jobs: JobWithRelations[]): JobStatus {
  const priority: Record<string, number> = {
    cancelled: 6,
    rework_required: 5,
    in_progress: 4,
    awaiting_approval: 3,
    assigned: 2,
    scheduled: 1,
    completed: 0,
  };
  let worst: JobStatus = "completed";
  let worstPriority = -1;
  for (const job of jobs) {
    const p = priority[job.status] ?? 0;
    if (p > worstPriority) {
      worstPriority = p;
      worst = job.status;
    }
  }
  return worst;
}

export function ScheduleClient() {
  const { showToast } = useToast();
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();

  // --- Range & navigation ---
  const [rangeMode, setRangeMode] = useState<"week" | "month" | "custom">("week");
  const [rangeStart, setRangeStart] = useState(() => startOfWeek(new Date()));
  const [rangeEnd, setRangeEnd] = useState(() => addDays(startOfWeek(new Date()), 6));
  const [sliderValue, setSliderValue] = useState(0);

  // --- Day count (3 or 7) ---
  const [dayCount, setDayCount] = useState<3 | 7>(7);
  const visibleDaysCount = dayCount;

  // --- Filters ---
  const [search, setSearch] = useState("");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);

  // --- Desktop toggles ---
  const [isCleanerPanelVisible, setIsCleanerPanelVisible] = useState(false);
  const [isGridFitMode, setIsGridFitMode] = useState(false);

  // --- Mobile-specific ---
  const [mobileTab, setMobileTab] = useState<"schedule" | "team">("schedule");
  const [propertyLabelMode, setPropertyLabelMode] = useState<"full" | "initials" | "hidden">("full");
  const [showIdleProperties, setShowIdleProperties] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{ propertyId: string; dayKey: string } | null>(null);

  // --- Quick assign ---
  const [quickAssignJobId, setQuickAssignJobId] = useState<Id<"cleaningJobs"> | null>(null);
  const [assigningJobId, setAssigningJobId] = useState<Id<"cleaningJobs"> | null>(null);

  // --- Swipe ---
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  // --- Convex queries ---
  const properties = useQuery(api.properties.queries.getAll, isAuthenticated ? { limit: 500 } : "skip");
  const jobs = useQuery(api.cleaningJobs.queries.getAll, isAuthenticated ? { limit: 1000 } : "skip");
  const cleaners = useQuery(api.users.queries.getByRole, isAuthenticated ? { role: "cleaner" } : "skip");
  const assignJob = useMutation(api.cleaningJobs.mutations.assign);

  // --- Computed: days ---
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

  // --- Computed: filtered properties ---
  const filteredProperties = useMemo(() => {
    const source = properties ?? [];
    const q = search.trim().toLowerCase();
    return source.filter((property) => {
      const propertyMatches = propertyFilter === "all" || property._id === propertyFilter;
      const textMatches = !q || property.name.toLowerCase().includes(q) || property.address.toLowerCase().includes(q);
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
    () => new Map((assignableCleanersByProperty ?? []).map((item) => [item.propertyId, item])),
    [assignableCleanersByProperty],
  );

  // --- Computed: jobs by cell ---
  const jobsByCell = useMemo(() => {
    const map = new Map<string, JobWithRelations[]>();
    (jobs ?? []).forEach((job) => {
      const scheduledAt = job.scheduledStartAt ?? 0;
      if (scheduledAt < rangeStartTime || scheduledAt >= rangeEndExclusiveTime) return;
      const dayKey = dateKeyFn(new Date(scheduledAt));
      const key = `${job.propertyId}-${dayKey}`;
      const existing = map.get(key) ?? [];
      existing.push(job as unknown as JobWithRelations);
      map.set(key, existing);
    });
    map.forEach((value) => value.sort((a, b) => (a.scheduledStartAt ?? 0) - (b.scheduledStartAt ?? 0)));
    return map;
  }, [jobs, rangeEndExclusiveTime, rangeStartTime]);

  // --- Computed: active vs idle properties ---
  const { activeProperties, idleProperties } = useMemo(() => {
    const active: typeof filteredProperties = [];
    const idle: typeof filteredProperties = [];
    for (const p of filteredProperties) {
      const hasJobs = visibleDays.some((day) => {
        const key = `${p._id}-${dateKeyFn(day)}`;
        return (jobsByCell.get(key)?.length ?? 0) > 0;
      });
      if (hasJobs) {
        active.push(p);
      } else {
        idle.push(p);
      }
    }
    return { activeProperties: active, idleProperties: idle };
  }, [filteredProperties, visibleDays, jobsByCell]);

  // --- Computed: cleaner loads ---
  const cleanerLoads = useMemo(() => {
    const byCleaner = new Map<string, number>();
    (jobs ?? []).forEach((job) => {
      if (job.scheduledStartAt && job.scheduledStartAt >= rangeStartTime && job.scheduledStartAt < rangeEndExclusiveTime) {
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

  // --- Grid column sizing ---
  const propertyColWidth =
    propertyLabelMode === "hidden"
      ? "0px"
      : propertyLabelMode === "initials"
        ? "40px"
        : dayCount <= 3
          ? "180px"
          : "160px";

  // On desktop, always use comfortable column widths for full job cards
  // On mobile with 7-day, use compact 40px columns for dot view
  const scheduleGridTemplateColumns = isGridFitMode
    ? `${propertyLabelMode === "hidden" ? "" : `${propertyColWidth} `}repeat(${Math.max(1, visibleDays.length)}, minmax(0, 1fr))`
    : `${propertyColWidth} repeat(${Math.max(1, visibleDays.length)}, minmax(120px, 1fr))`;

  // --- Navigation helpers ---
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

  const handleQuickAssign = async (jobId: Id<"cleaningJobs">, cleanerId: Id<"users">) => {
    setAssigningJobId(jobId);
    try {
      const result = await assignJob({
        jobId,
        cleanerIds: [cleanerId],
        notifyCleaners: false,
        source: "schedule_quick_assign",
        returnWarnings: true,
      });
      setQuickAssignJobId(null);
      showToast("Cleaner assigned successfully.");
      const warnings = getAssignWarnings(result);
      if (warnings.length > 0) {
        showToast(`Dispatch warning: ${warnings.join(" ")}`, "error");
      }
    } catch (error) {
      showToast(getErrorMessage(error, "Unable to assign cleaner."), "error");
    } finally {
      setAssigningJobId(null);
    }
  };

  const cycleLabelMode = useCallback(() => {
    setPropertyLabelMode((current) => {
      if (current === "full") return "initials";
      if (current === "initials") return "hidden";
      return "full";
    });
  }, []);

  // --- Swipe handlers ---
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const deltaX = e.changedTouches[0].clientX - touchStartX.current;
      const deltaY = e.changedTouches[0].clientY - touchStartY.current;
      if (Math.abs(deltaX) < 50 || Math.abs(deltaY) > Math.abs(deltaX)) return;
      if (deltaX < 0) {
        setSliderValue((v) => Math.min(maxDayOffset, v + 1));
      } else {
        setSliderValue((v) => Math.max(0, v - 1));
      }
    },
    [maxDayOffset],
  );

  // --- Render helpers ---
  const renderPropertyCell = (property: { _id: string; name: string; address: string; status?: unknown }) => {
    if (propertyLabelMode === "hidden") return null;
    const statusCandidate = property.status;
    const pStatus: PropertyStatus =
      statusCandidate === "ready" || statusCandidate === "dirty" || statusCandidate === "in_progress" || statusCandidate === "vacant"
        ? statusCandidate
        : "vacant";

    if (propertyLabelMode === "initials") {
      return (
        <div className="sticky left-0 z-10 flex items-center justify-center border-r bg-[var(--card)] p-1" title={property.name}>
          <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${readinessDotClass[pStatus]}`} />
          <span className="text-[10px] font-bold">{propertyInitials(property.name)}</span>
        </div>
      );
    }

    return (
      <div className="sticky left-0 z-10 border-r bg-[var(--card)] p-2 sm:p-3">
        <p className="truncate text-xs font-bold sm:text-sm">{property.name}</p>
        <p className="hidden truncate text-xs text-[var(--muted-foreground)] sm:block">{property.address}</p>
        <div className="mt-1 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] sm:mt-2 sm:px-2 sm:text-xs">
          <span className={`h-1.5 w-1.5 rounded-full sm:h-2 sm:w-2 ${readinessDotClass[pStatus]}`} />
          <span className="hidden sm:inline">{pStatus.replace("_", " ")}</span>
        </div>
      </div>
    );
  };

  const renderJobCell = (cellJobs: JobWithRelations[], propertyId: string, day: Date) => {
    const key = `${propertyId}-${dateKeyFn(day)}`;

    if (cellJobs.length === 0) {
      return <div key={key} className="h-10 border-l sm:h-16" />;
    }

    // 7-day compact mode: dots on mobile only, desktop always shows full cards
    if (dayCount === 7) {
      const worst = worstStatus(cellJobs);
      const dotColor = statusDotClass[worst] ?? "bg-slate-400";
      return (
        <div key={key} className="border-l">
          {/* Mobile: mini card view */}
          <button
            type="button"
            className="flex h-full min-h-10 w-full flex-col gap-0.5 p-0.5 md:hidden"
            onClick={() => setSelectedCell((c) => (c?.propertyId === propertyId && c.dayKey === dateKeyFn(day) ? null : { propertyId, dayKey: dateKeyFn(day) }))}
          >
            {cellJobs.slice(0, 2).map((job) => {
              const firstCleaner = job.cleaners?.[0];
              const initials = firstCleaner?.name
                ? firstCleaner.name.split(" ").filter(Boolean).map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()
                : null;
              const time = job.scheduledStartAt
                ? new Date(job.scheduledStartAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                : "--:--";
              return (
                <div
                  key={job._id}
                  className={`flex min-w-0 flex-col rounded-sm border px-1 py-0.5 text-[9px] leading-tight ${STATUS_CLASSNAMES[job.status]}`}
                >
                  <span className="truncate font-semibold">{time}</span>
                  {initials ? <span className="truncate opacity-75">{initials}</span> : null}
                </div>
              );
            })}
            {cellJobs.length > 2 ? (
              <span className="text-center text-[8px] font-bold text-[var(--muted-foreground)]">+{cellJobs.length - 2}</span>
            ) : null}
          </button>
          {/* Desktop: full job cards */}
          <div className="hidden space-y-1 p-2 md:block">
            {cellJobs.slice(0, 3).map((job) => {
              const availableAssignment = assignableByPropertyMap.get(job.propertyId);
              const companyCleaners = availableAssignment?.cleaners ?? [];
              const primaryAssignedCleaner =
                job.cleaners?.find((cleaner) => cleaner?._id) ?? null;
              const hasAssignedCleaner = Boolean(primaryAssignedCleaner);
              return (
                <div key={job._id} className="relative">
                  <Link
                    href={`/jobs/${job._id}`}
                    className={`block cursor-pointer rounded-md border px-2 py-1 pr-8 text-[11px] transition hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${STATUS_CLASSNAMES[job.status]}`}
                    title="Open task details"
                  >
                    <p className="truncate font-semibold">{job.property?.name ?? "Job"}</p>
                    <p className="truncate text-[10px] opacity-80">
                      {new Date(job.scheduledStartAt ?? 0).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </Link>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setQuickAssignJobId((current) => (current === job._id ? null : job._id));
                    }}
                  className="absolute right-1 top-1 rounded p-0.5 text-[var(--muted-foreground)] hover:bg-black/10 hover:text-[var(--foreground)]"
                  aria-label={hasAssignedCleaner ? "Quick reassign cleaner" : "Quick assign cleaner"}
                >
                  {hasAssignedCleaner ? (
                    <AssignedCleanerBadge cleaner={primaryAssignedCleaner} />
                  ) : (
                    <UserPlus className="h-3 w-3" />
                  )}
                  </button>
                  {quickAssignJobId === job._id ? (
                    <div className="absolute right-0 top-full z-40 mt-1 w-56 rounded-md border bg-[var(--card)] p-2 shadow-xl">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Quick Assign</p>
                      <p className="mb-2 text-[11px] text-[var(--muted-foreground)]">
                        {availableAssignment?.companyName ? `Company: ${availableAssignment.companyName}` : "No company assigned."}
                      </p>
                      {companyCleaners.length === 0 ? (
                        <p className="text-[11px] text-[var(--muted-foreground)]">No eligible cleaners.</p>
                      ) : (
                        <div className="space-y-1">
                          {companyCleaners.map((cleaner) => {
                            const alreadyAssigned = Boolean(job.cleaners?.some((c) => c?._id === cleaner._id));
                            return (
                              <button
                                key={cleaner._id}
                                type="button"
                                disabled={assigningJobId === job._id}
                                onClick={() => void handleQuickAssign(job._id, cleaner._id)}
                                className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-[11px] hover:bg-[var(--accent)] disabled:opacity-60"
                              >
                                <span className="truncate">{cleaner.name ?? cleaner.email}</span>
                                {alreadyAssigned ? <Check className="h-3 w-3 text-emerald-500" /> : null}
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
              <p className="text-[10px] text-[var(--muted-foreground)]">+{cellJobs.length - 3} more</p>
            ) : null}
          </div>
        </div>
      );
    }

    // 3-day mode: full job cards
    return (
      <div key={key} className="space-y-1 border-l p-1 sm:p-2">
        {cellJobs.slice(0, 3).map((job) => {
          const availableAssignment = assignableByPropertyMap.get(job.propertyId);
          const companyCleaners = availableAssignment?.cleaners ?? [];
          const primaryAssignedCleaner =
            job.cleaners?.find((cleaner) => cleaner?._id) ?? null;
          const hasAssignedCleaner = Boolean(primaryAssignedCleaner);
          return (
            <div key={job._id} className="relative">
              <Link
                href={`/jobs/${job._id}`}
                className={`block cursor-pointer rounded-md border px-1.5 py-1 pr-7 text-[10px] transition hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] sm:px-2 sm:text-[11px] ${STATUS_CLASSNAMES[job.status]}`}
                title="Open task details"
              >
                <p className="truncate font-semibold">{job.property?.name ?? "Job"}</p>
                <p className="truncate text-[9px] opacity-80 sm:text-[10px]">
                  {new Date(job.scheduledStartAt ?? 0).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              </Link>
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setQuickAssignJobId((current) => (current === job._id ? null : job._id));
                }}
                className="absolute right-1 top-1 rounded p-0.5 text-[var(--muted-foreground)] hover:bg-black/10 hover:text-[var(--foreground)]"
                aria-label={hasAssignedCleaner ? "Quick reassign cleaner" : "Quick assign cleaner"}
                title={hasAssignedCleaner ? "Quick reassign cleaner" : "Quick assign cleaner"}
              >
                {hasAssignedCleaner ? (
                  <AssignedCleanerBadge cleaner={primaryAssignedCleaner} />
                ) : (
                  <UserPlus className="h-3 w-3" />
                )}
              </button>
              {quickAssignJobId === job._id ? (
                <div className="absolute right-0 top-full z-40 mt-1 w-56 rounded-md border bg-[var(--card)] p-2 shadow-xl">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Quick Assign</p>
                  <p className="mb-2 text-[11px] text-[var(--muted-foreground)]">
                    {availableAssignment?.companyName ? `Company: ${availableAssignment.companyName}` : "No company assigned."}
                  </p>
                  {companyCleaners.length === 0 ? (
                    <p className="text-[11px] text-[var(--muted-foreground)]">No eligible cleaners.</p>
                  ) : (
                    <div className="space-y-1">
                      {companyCleaners.map((cleaner) => {
                        const alreadyAssigned = Boolean(job.cleaners?.some((c) => c?._id === cleaner._id));
                        return (
                          <button
                            key={cleaner._id}
                            type="button"
                            disabled={assigningJobId === job._id}
                            onClick={() => void handleQuickAssign(job._id, cleaner._id)}
                            className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-[11px] hover:bg-[var(--accent)] disabled:opacity-60"
                          >
                            <span className="truncate">{cleaner.name ?? cleaner.email}</span>
                            {alreadyAssigned ? <Check className="h-3 w-3 text-emerald-500" /> : null}
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
          <p className="text-[10px] text-[var(--muted-foreground)]">+{cellJobs.length - 3} more</p>
        ) : null}
      </div>
    );
  };

  // --- Bottom sheet data ---
  const bottomSheetData = useMemo(() => {
    if (!selectedCell) return null;
    const cellJobs = jobsByCell.get(`${selectedCell.propertyId}-${selectedCell.dayKey}`) ?? [];
    const prop = (properties ?? []).find((p) => p._id === selectedCell.propertyId);
    return { jobs: cellJobs, property: prop ?? null };
  }, [selectedCell, jobsByCell, properties]);

  // --- Available/busy counts ---
  const availableCount = cleanerLoads.filter((c) => c.available).length;
  const busyCount = cleanerLoads.length - availableCount;

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* === HEADER === */}
      <header className="rounded-2xl border bg-[var(--card)] px-3 py-2 sm:px-4 sm:py-2.5">
        {/* Single row: everything on one line */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Cycling mode button: Today → Week → Month → Today … */}
          <button
            className="shrink-0 rounded-md border px-2 py-1 text-xs font-semibold hover:bg-[var(--accent)] sm:px-3 sm:py-1.5 sm:text-sm"
            onClick={() => {
              if (rangeMode === "week") {
                // Week → jump to today first, then switch to month
                applyMonthRange(new Date());
                setRangeMode("month");
              } else if (rangeMode === "month") {
                // Month → Today (week, current week)
                setRangeMode("week");
                applyWeekRange(new Date());
              } else {
                // custom / anything else → Today
                setRangeMode("week");
                applyWeekRange(new Date());
              }
            }}
            title="Cycle: Today → Month → Today"
          >
            {rangeMode === "month" ? "Month" : "Today"}
          </button>

          <button className="rounded-md p-1 hover:bg-[var(--accent)] sm:p-1.5" onClick={() => shiftRange(-1)} aria-label="Previous">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button className="rounded-md p-1 hover:bg-[var(--accent)] sm:p-1.5" onClick={() => shiftRange(1)} aria-label="Next">
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="truncate px-1 text-xs font-semibold text-[var(--muted-foreground)] sm:px-2 sm:text-sm">
            {formatRange(rangeStart, rangeEnd)}
          </span>

          {/* Date pickers — desktop only, inline in the single row */}
          <div className="hidden items-center gap-1 rounded-md border bg-[var(--card)] px-2 py-1 text-xs md:flex">
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
                  startOfDay(current).getTime() < normalizedStart.getTime() ? normalizedStart : current,
                );
                setSliderValue(0);
              }}
              className="bg-transparent text-xs outline-none"
              aria-label="Range start date"
            />
            <span className="text-[var(--muted-foreground)]">–</span>
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
                  startOfDay(current).getTime() > normalizedEnd.getTime() ? normalizedEnd : current,
                );
                setSliderValue(0);
              }}
              className="bg-transparent text-xs outline-none"
              aria-label="Range end date"
            />
          </div>

          <div className="ml-auto flex items-center gap-1">
            {/* Search (desktop) */}
            <div className="hidden items-center gap-1 rounded-md border bg-[var(--card)] px-2 py-1 md:flex">
              <Search className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search properties"
                className="w-28 bg-transparent text-xs outline-none placeholder:text-[var(--muted-foreground)]"
              />
            </div>

            {/* Property filter (desktop) */}
            <select
              value={propertyFilter}
              onChange={(event) => setPropertyFilter(event.target.value)}
              className="hidden rounded-md border bg-[var(--card)] px-2 py-1 text-xs md:block"
            >
              <option value="all">All Properties</option>
              {(properties ?? []).map((property) => (
                <option key={property._id} value={property._id}>{property.name}</option>
              ))}
            </select>

            {/* Show/hide team (desktop) */}
            <button
              type="button"
              onClick={() => setIsCleanerPanelVisible((prev) => !prev)}
              className="hidden items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-[var(--accent)] md:inline-flex"
              aria-pressed={!isCleanerPanelVisible}
              aria-label={isCleanerPanelVisible ? "Hide team panel" : "Show team panel"}
              title={isCleanerPanelVisible ? "Hide team panel" : "Show team panel"}
            >
              {isCleanerPanelVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              <Users className="h-3.5 w-3.5" />
            </button>

            {/* Day count toggle */}
            <div className="flex overflow-hidden rounded-md border text-[10px] font-semibold sm:text-xs">
              <button
                type="button"
                onClick={() => setDayCount(3)}
                className={cn("px-2 py-1", dayCount === 3 ? "bg-[var(--accent)]" : "hover:bg-[var(--accent)]")}
              >
                3d
              </button>
              <button
                type="button"
                onClick={() => setDayCount(7)}
                className={cn("border-l px-2 py-1", dayCount === 7 ? "bg-[var(--accent)]" : "hover:bg-[var(--accent)]")}
              >
                7d
              </button>
            </div>

            {/* Fit screen (desktop) */}
            <button
              type="button"
              onClick={() => setIsGridFitMode((prev) => !prev)}
              className="hidden items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-[var(--accent)] md:inline-flex"
              aria-pressed={isGridFitMode}
            >
              {isGridFitMode ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              {isGridFitMode ? "Normal" : "Fit"}
            </button>

            {/* Label mode cycle */}
            <button
              type="button"
              onClick={cycleLabelMode}
              className="rounded-md border px-2 py-1 text-[10px] hover:bg-[var(--accent)] sm:text-xs"
              title={`Property labels: ${propertyLabelMode}`}
            >
              {propertyLabelMode === "full" ? "Aa" : propertyLabelMode === "initials" ? "AB" : "··"}
            </button>

            {/* Mobile filter toggle */}
            <button
              type="button"
              onClick={() => setShowMobileFilters((v) => !v)}
              className="rounded-md border p-1 hover:bg-[var(--accent)] md:hidden"
              aria-label="Toggle filters"
            >
              <Filter className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Mobile collapsible filters */}
        {showMobileFilters ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 md:hidden">
            <button
              type="button"
              onClick={() => {
                if (rangeMode === "month") {
                  setRangeMode("week");
                  applyWeekRange(rangeStart);
                } else {
                  setRangeMode("month");
                  applyMonthRange(rangeStart);
                }
              }}
              className="rounded-md border px-2 py-1 text-[10px] font-semibold hover:bg-[var(--accent)]"
            >
              {rangeMode === "month" ? "→ Week" : "→ Month"}
            </button>

            {isMobileSearchOpen ? (
              <div className="flex flex-1 items-center gap-1 rounded-md border px-2 py-1">
                <Search className="h-3 w-3 shrink-0 text-[var(--muted-foreground)]" />
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search"
                  className="w-full min-w-0 bg-transparent text-[11px] outline-none placeholder:text-[var(--muted-foreground)]"
                  autoFocus
                />
                <button type="button" onClick={() => { setSearch(""); setIsMobileSearchOpen(false); }} className="shrink-0">
                  <X className="h-3 w-3 text-[var(--muted-foreground)]" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsMobileSearchOpen(true)}
                className="rounded-md border p-1 hover:bg-[var(--accent)]"
                aria-label="Search properties"
              >
                <Search className="h-3 w-3" />
              </button>
            )}

            <select
              value={propertyFilter}
              onChange={(event) => setPropertyFilter(event.target.value)}
              className="max-w-[120px] truncate rounded-md border bg-[var(--card)] px-1.5 py-1 text-[10px]"
            >
              <option value="all">All</option>
              {(properties ?? []).map((property) => (
                <option key={property._id} value={property._id}>{property.name}</option>
              ))}
            </select>
          </div>
        ) : null}
      </header>

      {/* === MOBILE TAB BAR === */}
      <div className="grid grid-cols-2 gap-1 rounded-xl border bg-[var(--card)] p-1 md:hidden">
        <button
          type="button"
          onClick={() => setMobileTab("schedule")}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition",
            mobileTab === "schedule" ? "bg-[var(--accent)] text-[var(--foreground)]" : "text-[var(--muted-foreground)]",
          )}
        >
          <Calendar className="h-3.5 w-3.5" />
          Schedule
        </button>
        <button
          type="button"
          onClick={() => setMobileTab("team")}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition",
            mobileTab === "team" ? "bg-[var(--accent)] text-[var(--foreground)]" : "text-[var(--muted-foreground)]",
          )}
        >
          <Users className="h-3.5 w-3.5" />
          Team ({availableCount})
        </button>
      </div>

      {/* === MAIN LAYOUT === */}
      <div className={cn("grid gap-4", showCleanerPanel ? "lg:grid-cols-[280px_minmax(0,1fr)]" : "grid-cols-1")}>

        {/* Desktop cleaner panel (hidden on mobile — use Team tab instead) */}
        {showCleanerPanel ? (
          <aside className="hidden rounded-2xl border bg-[var(--card)] p-4 md:block">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--muted-foreground)]">Cleaners Available</h2>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                {availableCount} Active
              </span>
            </div>
            <div className="space-y-3">
              {loading ? (
                <div className="flex min-h-40 items-center justify-center text-sm text-[var(--muted-foreground)]">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading team...
                </div>
              ) : cleanerLoads.length === 0 ? (
                <p className="rounded-lg border border-dashed p-3 text-sm text-[var(--muted-foreground)]">No cleaners found.</p>
              ) : (
                cleanerLoads.slice(0, 10).map((cleaner) => (
                  <div key={cleaner._id} className="rounded-xl border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold">{cleaner.name || cleaner.email || "Unknown"}</p>
                        <p className="flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
                          <Star className="h-3 w-3 text-amber-500" /> {cleaner.rating}
                        </p>
                      </div>
                      <span className={`h-2.5 w-2.5 rounded-full ${cleaner.available ? "bg-emerald-500" : "bg-slate-400"}`} />
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

        {/* Mobile team tab */}
        {mobileTab === "team" ? (
          <div className="rounded-2xl border bg-[var(--card)] p-3 md:hidden">
            <p className="mb-3 text-xs text-[var(--muted-foreground)]">
              <span className="font-semibold text-emerald-500">{availableCount} Available</span>
              {" · "}
              <span>{busyCount} Busy</span>
            </p>
            {loading ? (
              <div className="flex min-h-24 items-center justify-center text-sm text-[var(--muted-foreground)]">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              </div>
            ) : (
              <div className="divide-y">
                {[...cleanerLoads].sort((a, b) => (a.available === b.available ? 0 : a.available ? -1 : 1)).map((cleaner) => (
                  <div key={cleaner._id} className="flex items-center gap-2 py-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${cleaner.available ? "bg-emerald-500" : "bg-slate-400"}`} />
                    <span className="min-w-0 truncate text-sm font-medium">{cleaner.name || cleaner.email || "Unknown"}</span>
                    <span className="ml-auto flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
                      <Star className="h-2.5 w-2.5 text-amber-500" /> {cleaner.rating}
                    </span>
                    <span className="text-[11px] text-[var(--muted-foreground)]">{cleaner.jobsThisRange} jobs</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {/* Schedule grid — visible on desktop always, mobile only in schedule tab */}
        <section
          className={cn(
            "relative rounded-2xl border bg-[var(--card)]",
            isGridFitMode ? "overflow-x-hidden" : "overflow-x-auto",
            mobileTab !== "schedule" && "hidden md:block",
          )}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Grid header row */}
          <div
            className="grid border-b"
            style={{ gridTemplateColumns: scheduleGridTemplateColumns }}
          >
            {propertyLabelMode !== "hidden" ? (
              <div className="sticky left-0 z-20 border-r bg-[var(--card)] p-2 text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] sm:p-3 sm:text-xs">
                {propertyLabelMode === "initials" ? "" : "Property"}
              </div>
            ) : null}
            {visibleDays.map((day) => (
              <div key={dateKeyFn(day)} className="border-l p-1.5 text-center sm:p-3">
                <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] sm:text-[10px]">
                  {day.toLocaleDateString([], { weekday: "short" })}
                </p>
                <p className="text-sm font-extrabold leading-none sm:text-lg">
                  {day.toLocaleDateString([], { day: "2-digit" })}
                </p>
              </div>
            ))}
          </div>

          {/* Grid body */}
          {loading ? (
            <div className="flex min-h-48 items-center justify-center text-sm text-[var(--muted-foreground)]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading schedule...
            </div>
          ) : filteredProperties.length === 0 ? (
            <div className="px-4 py-10 text-sm text-[var(--muted-foreground)]">No properties match your filter.</div>
          ) : (
            <>
              {/* Active properties (with jobs) */}
              {activeProperties.map((property) => (
                <div
                  key={property._id}
                  className="grid border-b last:border-b-0"
                  style={{ gridTemplateColumns: scheduleGridTemplateColumns }}
                >
                  {renderPropertyCell(property as { _id: string; name: string; address: string; status?: unknown })}
                  {visibleDays.map((day) => {
                    const key = `${property._id}-${dateKeyFn(day)}`;
                    const cellJobs = jobsByCell.get(key) ?? [];
                    return renderJobCell(cellJobs, property._id, day);
                  })}
                </div>
              ))}

              {/* Idle properties (no jobs in range) */}
              {idleProperties.length > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={() => setShowIdleProperties((v) => !v)}
                    className="flex w-full items-center justify-center gap-2 border-b py-2 text-xs text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
                  >
                    <ChevronDown className={cn("h-3 w-3 transition", showIdleProperties && "rotate-180")} />
                    {idleProperties.length} {idleProperties.length === 1 ? "property" : "properties"} with no jobs
                    <ChevronDown className={cn("h-3 w-3 transition", showIdleProperties && "rotate-180")} />
                  </button>
                  {showIdleProperties
                    ? idleProperties.map((property) => (
                        <div
                          key={property._id}
                          className="grid border-b last:border-b-0"
                          style={{ gridTemplateColumns: scheduleGridTemplateColumns }}
                        >
                          {renderPropertyCell(property as { _id: string; name: string; address: string; status?: unknown })}
                          {visibleDays.map((day) => (
                            <div key={`${property._id}-${dateKeyFn(day)}`} className="h-8 border-l sm:h-10" />
                          ))}
                        </div>
                      ))
                    : null}
                </>
              ) : null}
            </>
          )}

          {/* Bottom sheet for 7-day cell tap */}
          {selectedCell && bottomSheetData ? (
            <div className="sticky bottom-0 left-0 right-0 z-30 border-t bg-[var(--card)] p-4 shadow-lg">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-bold">{bottomSheetData.property?.name ?? "Unknown"}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">{bottomSheetData.property?.address}</p>
                </div>
                <button type="button" onClick={() => setSelectedCell(null)} className="rounded p-1 hover:bg-[var(--accent)]">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {bottomSheetData.jobs.length === 0 ? (
                <p className="mt-2 text-xs text-[var(--muted-foreground)]">No jobs for this day.</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {bottomSheetData.jobs.map((job) => {
                    const availableAssignment = assignableByPropertyMap.get(job.propertyId);
                    const companyCleaners = availableAssignment?.cleaners ?? [];
                    const isAssigning = quickAssignJobId === job._id;
                    const primaryAssignedCleaner =
                      job.cleaners?.find((cleaner) => cleaner?._id) ?? null;
                    const hasAssignedCleaner = Boolean(primaryAssignedCleaner);
                    return (
                      <div key={job._id} className={`rounded-lg border text-xs ${STATUS_CLASSNAMES[job.status]}`}>
                        <Link href={`/jobs/${job._id}`} className="block px-3 py-2">
                          <p className="font-semibold">
                            {new Date(job.scheduledStartAt ?? 0).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            {" · "}
                            {STATUS_LABELS[job.status]}
                          </p>
                          <p className="mt-0.5 text-[11px] opacity-80">
                            {job.cleaners?.map((c) => c?.name).filter(Boolean).join(", ") || "Unassigned"}
                          </p>
                        </Link>
                        {/* Quick assign row */}
                        <div className="border-t px-3 py-2">
                          <button
                            type="button"
                            onClick={() => setQuickAssignJobId((current) => (current === job._id ? null : job._id))}
                            className="flex items-center gap-1 text-[11px] font-medium opacity-70 hover:opacity-100"
                          >
                            {hasAssignedCleaner ? (
                              <AssignedCleanerBadge cleaner={primaryAssignedCleaner} />
                            ) : (
                              <UserPlus className="h-3 w-3" />
                            )}
                            {isAssigning ? "Close" : hasAssignedCleaner ? "Reassign Cleaner" : "Assign Cleaner"}
                          </button>
                          {isAssigning ? (
                            <div className="mt-2 space-y-1">
                              {companyCleaners.length === 0 ? (
                                <p className="text-[11px] opacity-60">
                                  {availableAssignment?.companyName
                                    ? `No cleaners in ${availableAssignment.companyName}`
                                    : "No company assigned to property"}
                                </p>
                              ) : (
                                companyCleaners.map((cleaner) => {
                                  const alreadyAssigned = Boolean(job.cleaners?.some((c) => c?._id === cleaner._id));
                                  return (
                                    <button
                                      key={cleaner._id}
                                      type="button"
                                      disabled={assigningJobId === job._id}
                                      onClick={() => void handleQuickAssign(job._id, cleaner._id)}
                                      className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[11px] hover:bg-black/10 disabled:opacity-60"
                                    >
                                      <span className="truncate">{cleaner.name ?? cleaner.email}</span>
                                      {alreadyAssigned ? <Check className="h-3 w-3 text-emerald-500 shrink-0" /> : null}
                                    </button>
                                  );
                                })
                              )}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </section>
      </div>

      {/* Day range slider */}
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
              "[&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full",
              "[&::-webkit-slider-thumb]:-mt-2 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6",
              "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
              "[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white",
              "[&::-webkit-slider-thumb]:bg-[var(--primary)] [&::-webkit-slider-thumb]:shadow-md",
              "[&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-[var(--accent)]",
              "[&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:rounded-full",
              "[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-[var(--primary)]",
            )}
            aria-label="Slide through selected calendar range"
          />
        </div>
      ) : null}

      {/* Initials legend */}
      {propertyLabelMode === "initials" && !loading ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-xl border bg-[var(--card)] p-3 text-[10px] text-[var(--muted-foreground)]">
          {filteredProperties.map((p) => (
            <span key={p._id}>
              <span className="font-bold">{propertyInitials(p.name)}</span> = {p.name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// --- Date utilities ---

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

function dateKeyFn(date: Date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function formatRange(start: Date, end: Date) {
  const startLabel = start.toLocaleDateString([], { month: "short", day: "numeric" });
  const endLabel = end.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
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
