"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import Link from "next/link";
import Image from "next/image";
import type { Id } from "@convex/_generated/dataModel";
import {
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Filter,
  Loader2,
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
import { SearchableSelect } from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";
import type { PropertyStatus } from "@/types/property";
import { ScheduleCellTaskOverlay } from "@/components/schedule/schedule-cell-task-overlay";
import { ScheduleDateHeaderTaskOverlay } from "@/components/schedule/schedule-date-header-task-overlay";
import { formatTimeInZone, resolveDisplayTimezone } from "@/lib/tz";

type JobWithRelations = {
  _id: Id<"cleaningJobs">;
  notesForCleaner?: string;
  status: JobStatus;
  scheduledStartAt?: number;
  propertyId: Id<"properties">;
  property?: { _id: Id<"properties">; name?: string | null; timezone?: string | null };
  cleaners?: Array<{ _id?: Id<"users">; name?: string | null; avatarUrl?: string | null }>;
};

type Reservation = {
  _id: Id<"stays">;
  propertyId: Id<"properties">;
  guestName: string;
  guestPhotoUrl?: string;
  numberOfGuests?: number;
  platform?: string;
  checkInAt: number;
  checkOutAt: number;
};

const readinessDotClass: Record<PropertyStatus, string> = {
  ready: "bg-emerald-500",
  dirty: "bg-rose-500",
  in_progress: "bg-amber-500",
  vacant: "bg-slate-400",
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
        <Image
          src={cleaner.avatarUrl}
          alt={cleaner.name ? `${cleaner.name} avatar` : "Cleaner avatar"}
          fill
          unoptimized
          className="rounded-full object-cover"
          sizes="20px"
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

function guestInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return "G";
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
}

// Map a reservation platform string to a compact single-letter channel badge.
function channelBadge(platform?: string): { letter: string; label: string } | null {
  if (!platform) {
    return null;
  }
  const p = platform.toLowerCase();
  if (p.includes("airbnb")) return { letter: "A", label: "Airbnb" };
  if (p.includes("vrbo") || p.includes("homeaway")) return { letter: "V", label: "Vrbo" };
  if (p.includes("booking")) return { letter: "B", label: "Booking.com" };
  if (p.includes("direct")) return { letter: "D", label: "Direct" };
  return { letter: platform.slice(0, 1).toUpperCase(), label: platform };
}

/** Stable key for a property's city filter value ("City|ST", or "City" when
 *  the state is blank). Single source of truth for the city dropdown, the
 *  city→property scoping, and the board's own filtering. */
function cityFilterValue(property: { city?: string | null; state?: string | null }): string {
  const city = (property.city ?? "").trim();
  const state = (property.state ?? "").trim();
  return state ? `${city}|${state}` : city;
}

function clampIndex(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

// Small round guest avatar for occupancy bars — an external photo that falls
// back to initials when it's missing or fails to load (mirrors the
// AssignedCleanerBadge initials pattern).
function GuestAvatar({ name, photoUrl }: { name: string; photoUrl?: string }) {
  const [errored, setErrored] = useState(false);
  const showImage = Boolean(photoUrl) && !errored;
  return (
    <span className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/60 bg-white/25 text-white sm:h-12 sm:w-12">
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl}
          alt={`${name} avatar`}
          className="h-full w-full rounded-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        <span className="text-xs font-bold leading-none sm:text-sm">{guestInitials(name)}</span>
      )}
    </span>
  );
}

// Property thumbnail for the calendar's left axis — reuses the property photo
// (primary gallery image / legacy imageUrl / Hospitable picture) with an
// initials fallback, mirroring GuestAvatar and the Properties page cards.
function PropertyPhoto({
  name,
  imageUrl,
  className,
}: {
  name: string;
  imageUrl?: string;
  className?: string;
}) {
  const [errored, setErrored] = useState(false);
  const show = Boolean(imageUrl) && !errored;
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-[var(--accent)] text-[var(--muted-foreground)]",
        className,
      )}
    >
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={name}
          className="h-full w-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        <span className="px-0.5 text-center text-[9px] font-bold leading-none">
          {propertyInitials(name)}
        </span>
      )}
    </span>
  );
}

export function ScheduleClient() {
  const { showToast } = useToast();
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();

  // --- Range & navigation ---
  // Rolling calendar (Hospitable-style): the week is anchored on TODAY rather
  // than snapping to Monday, so the current day is always the left-most column
  // and the board rolls forward day by day.
  // Default to the MONTH view (today is centered in the viewport by the
  // centerTodayInView effect that runs whenever rangeMode === "month").
  const [rangeMode, setRangeMode] = useState<"week" | "month" | "custom">("month");
  // Board mode: "tasks" is the existing cleaning-jobs grid; "occupancy" swaps
  // the per-day job cells for Hospitable-style reservation bars.
  const [boardMode, setBoardMode] = useState<"tasks" | "occupancy">("tasks");
  const [rangeStart, setRangeStart] = useState(() => startOfMonth(new Date()));
  const [rangeEnd, setRangeEnd] = useState(() => endOfMonth(new Date()));

  // `todayStart` drives the "today" column highlight and moves at midnight so
  // the marker (and, when still anchored, the whole rolling window) advances
  // with the day without a manual refresh.
  const [todayStart, setTodayStart] = useState(() => startOfDay(new Date()));
  const todayKey = dateKeyFn(todayStart);

  // --- Grid scroll (smooth slider) ---
  // The grid renders the WHOLE range as fixed-width columns inside a
  // horizontally-scrollable section; ~a week is visible at once and the rest
  // scrolls smoothly (native scroll — no per-day snapping). `gridWidth` drives
  // responsive column widths; `scrollLeft`/`maxScroll` back the slider control.
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const [gridWidth, setGridWidth] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [maxScroll, setMaxScroll] = useState(0);

  // --- Filters ---
  const [search, setSearch] = useState("");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);

  // --- Tasks "Mine only" filter (architecture.md §3b) ---
  // Per-user persisted via localStorage. Off by default for ops.
  const MINE_ONLY_KEY = "schedule.tasks.mineOnly";
  const [mineOnly, setMineOnlyState] = useState<boolean>(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(MINE_ONLY_KEY);
      if (raw === "1") setMineOnlyState(true);
    } catch {
      /* ignore quota / private mode */
    }
  }, []);
  const setMineOnly = (v: boolean) => {
    setMineOnlyState(v);
    try {
      window.localStorage.setItem(MINE_ONLY_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  // --- Desktop toggles ---
  const [isCleanerPanelVisible, setIsCleanerPanelVisible] = useState(false);

  // --- Mobile-specific ---
  const [mobileTab, setMobileTab] = useState<"schedule" | "team">("schedule");
  const [propertyLabelMode, setPropertyLabelMode] = useState<"full" | "initials" | "hidden">("full");
  const [selectedCell, setSelectedCell] = useState<{ propertyId: string; dayKey: string } | null>(null);

  // --- Mobile-default applier (2026-05-19) ---
  // On a narrow viewport, the 7-day grid crams six tiny columns + a 180px
  // property column into ~360px and most managers can't read anything.
  // On mount only (not on every resize — that would override an explicit
  // user toggle mid-session), if we look mobile, swap to 3-day view +
  // initials labels. Frees ~140px for the day columns and surfaces the
  // 3-day window the manager actually cares about. User can still hit
  // "7" or "Aa" in the toolbar to override.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.innerWidth < 768) {
      // Narrow viewport: use initials labels to free width. The number of
      // visible day columns is now derived from the measured grid width
      // (see `visibleSpan`), so no day-count/fit toggles are needed here.
      setPropertyLabelMode("initials");
    }
    // Intentional: empty dep array → mount-only. Don't react to resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Midnight roll-over (2026-07-10) ---
  // "Move with the day" like Hospitable: at local midnight, advance the today
  // marker and — if the board is still a rolling week anchored on the previous
  // day — roll the visible window forward one day. If the user has navigated
  // away (browsing a future week or a month), we only move the marker, never
  // yank their view. Refs keep the timer callback free of stale closures.
  const rangeModeRef = useRef(rangeMode);
  const rangeStartRef = useRef(rangeStart);
  const todayStartRef = useRef(todayStart);
  useEffect(() => {
    rangeModeRef.current = rangeMode;
  }, [rangeMode]);
  useEffect(() => {
    rangeStartRef.current = rangeStart;
  }, [rangeStart]);
  useEffect(() => {
    todayStartRef.current = todayStart;
  }, [todayStart]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const scheduleMidnight = () => {
      const now = new Date();
      const nextMidnight = new Date(now);
      nextMidnight.setHours(24, 0, 0, 0);
      // +500ms cushion so we're safely past midnight when the timer fires.
      const ms = nextMidnight.getTime() - now.getTime() + 500;
      timer = setTimeout(() => {
        const prevToday = todayStartRef.current;
        const newToday = startOfDay(new Date());
        setTodayStart(newToday);
        // Only re-anchor if we're a rolling week that was still sitting on the
        // old "today" — i.e. the user hasn't navigated away.
        if (
          rangeModeRef.current === "week" &&
          dateKeyFn(rangeStartRef.current) === dateKeyFn(prevToday)
        ) {
          setRangeStart(newToday);
          setRangeEnd(addDays(newToday, 6));
        }
        scheduleMidnight();
      }, ms);
    };
    scheduleMidnight();
    return () => clearTimeout(timer);
    // Mount-only: the callback reads live values via refs.
  }, []);

  // --- Quick assign ---
  const [quickAssignJobId, setQuickAssignJobId] = useState<Id<"cleaningJobs"> | null>(null);
  const [assigningJobId, setAssigningJobId] = useState<Id<"cleaningJobs"> | null>(null);

  // --- Swipe ---
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  // --- Convex queries ---
  const properties = useQuery(api.properties.queries.getAll, isAuthenticated ? { limit: 500 } : "skip");
  // Wave 3.b — only fetch jobs in the currently-visible date window via the
  // `by_scheduled` index instead of subscribing to `getAll({ limit: 1000 })`
  // and slicing in memory. The schedule grid never renders jobs outside the
  // visible range.
  const rangeStartTime = startOfDay(rangeStart).getTime();
  const rangeEndExclusiveTime = addDays(startOfDay(rangeEnd), 1).getTime();
  const jobs = useQuery(
    api.cleaningJobs.queries.getInDateRange,
    isAuthenticated ? { from: rangeStartTime, to: rangeEndExclusiveTime } : "skip",
  );
  // Occupancy mode — reservations in the visible window. Same local-midnight
  // date bounds as the jobs query; only fetched while the occupancy board is
  // active (skipped in Tasks mode to avoid an idle subscription).
  const reservations = useQuery(
    api.stays.queries.getInDateRange,
    isAuthenticated && boardMode === "occupancy"
      ? { from: rangeStartTime, to: rangeEndExclusiveTime }
      : "skip",
  );
  const cleaners = useQuery(api.users.queries.getCleaners, isAuthenticated ? {} : "skip");
  const assignJob = useMutation(api.cleaningJobs.mutations.assign);

  // Current user — drives the "Mine only" filter on task overlays.
  const me = useQuery(api.users.queries.getMyProfile, isAuthenticated ? {} : "skip") as
    | { _id: Id<"users">; role: string }
    | null
    | undefined;
  const myUserId: Id<"users"> | null = me?._id ?? null;

  // Batched per-cell avatar/count projection for the visible window
  // (architecture.md §4a, R6a). Replaces N×M `listForCell` round-trips.
  //
  // `anchorDate` is stored as UTC start-of-day (see startOfUtcDay in
  // convex/opsTasks/mutations.ts). We MUST pass UTC-midnight bounds here —
  // the existing rangeStartTime / rangeEndExclusiveTime are local-midnight
  // (used by jobs with wall-clock scheduledStartAt) and would skip tasks
  // in tz != UTC.
  const utcStartOfDay = (d: Date) =>
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const taskRangeStartUtc = utcStartOfDay(rangeStart);
  const taskRangeEndUtcExclusive = utcStartOfDay(rangeEnd) + oneDayMs;
  const taskAvatarRange = useQuery(
    api.opsTasks.queries.listAssigneeAvatarsForRange,
    isAuthenticated
      ? { rangeStart: taskRangeStartUtc, rangeEnd: taskRangeEndUtcExclusive }
      : "skip",
  );
  const taskCellSummaries = useMemo(() => {
    const map = new Map<
      string,
      {
        assignees: Array<{
          _id: Id<"users">;
          name?: string;
          email?: string;
          avatarUrl?: string | null;
        }>;
        unassignedCount: number;
        openCount: number;
      }
    >();
    if (!taskAvatarRange?.cells) return map;
    for (const cell of taskAvatarRange.cells) {
      map.set(`${cell.cellKey}@${cell.anchorDate}`, {
        assignees: cell.assignees.map((a) => ({
          _id: a._id,
          name: a.name,
          email: a.email,
          avatarUrl: a.avatarUrl,
        })),
        unassignedCount: cell.unassignedCount,
        openCount: cell.openCount,
      });
    }
    return map;
  }, [taskAvatarRange]);
  const taskCellAnchor = (day: Date) =>
    Date.UTC(day.getFullYear(), day.getMonth(), day.getDate());
  // Shared empty summary for in-range days that have no tasks. Handing this to
  // the overlay (instead of `undefined`) makes it skip its per-cell eager
  // query — critical for month view, which renders ~30 columns × N properties.
  const emptyCellSummary = useMemo(
    () => ({
      assignees: [] as Array<{
        _id: Id<"users">;
        name?: string;
        email?: string;
        avatarUrl?: string | null;
      }>,
      unassignedCount: 0,
      openCount: 0,
    }),
    [],
  );
  const summaryFor = (cellKey: string, day: Date) => {
    const hit = taskCellSummaries.get(`${cellKey}@${taskCellAnchor(day)}`);
    if (hit) return hit;
    // A missing cell is empty. NEVER return `undefined` here.
    //
    // Read-cost: `undefined` sets ScheduleCellTaskOverlay's `useEagerCellQuery`,
    // so EVERY cell in the grid subscribes to `listForCell` at once. That fired
    // on every schedule mount and every range change — for the whole window
    // between first render and `taskAvatarRange` resolving — and fired
    // *permanently* for non-ops callers, since listAssigneeAvatarsForRange is
    // ops-only and throws for them, so `taskAvatarRange` never resolves. Result:
    // 351K listForCell calls/month (36% of ALL function calls), each superseded
    // by the batched summary one round-trip later.
    //
    // Rendering empty while the batch is in flight matches what the grid showed
    // before anyway (the eager per-cell query hadn't resolved either), and badges
    // appear when the batch lands. Per-cell queries now fire only when a cell's
    // popover is actually opened (`showList`).
    return emptyCellSummary;
  };

  // --- Computed: days ---
  // Render the WHOLE range as columns; horizontal scroll (not a windowed
  // slice) reveals the rest, so sliding is smooth instead of day-by-day.
  const rangeDays = useMemo(() => listDaysBetween(rangeStart, rangeEnd), [rangeEnd, rangeStart]);

  // --- Computed: city options (from properties) ---
  const cityOptions = useMemo(() => {
    const seen = new Map<string, { value: string; label: string }>();
    for (const p of properties ?? []) {
      const city = (p.city ?? "").trim();
      if (!city) continue;
      const state = (p.state ?? "").trim();
      const value = cityFilterValue(p);
      if (!seen.has(value)) {
        seen.set(value, { value, label: state ? `${city}, ${state}` : city });
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [properties]);

  // --- Computed: property picker options, scoped to the selected city ---
  // Progressive filtering: once a city is chosen the property dropdown must
  // only offer that city's properties. Offering the rest is misleading, and
  // picking one produces a city+property combo that matches nothing.
  const propertyPickerOptions = useMemo(() => {
    const source = properties ?? [];
    const scoped =
      cityFilter === "all"
        ? source
        : source.filter((property) => cityFilterValue(property) === cityFilter);
    return scoped.map((property) => ({ id: property._id, label: property.name }));
  }, [properties, cityFilter]);

  // Switching city can orphan an already-picked property. Clear it instead of
  // leaving two filters that contradict each other and render an empty board.
  useEffect(() => {
    if (propertyFilter === "all") return;
    if (!propertyPickerOptions.some((option) => option.id === propertyFilter)) {
      setPropertyFilter("all");
    }
  }, [propertyPickerOptions, propertyFilter]);

  // --- Computed: filtered properties ---
  const filteredProperties = useMemo(() => {
    const source = properties ?? [];
    const q = search.trim().toLowerCase();
    return source.filter((property) => {
      const propertyMatches = propertyFilter === "all" || property._id === propertyFilter;
      const textMatches = !q || property.name.toLowerCase().includes(q) || property.address.toLowerCase().includes(q);
      const cityMatches = cityFilter === "all" || cityFilterValue(property) === cityFilter;
      return propertyMatches && textMatches && cityMatches;
    });
  }, [properties, propertyFilter, search, cityFilter]);

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

  // --- Computed: reservations by property (occupancy mode) ---
  const reservationsByProperty = useMemo(() => {
    const map = new Map<string, Reservation[]>();
    for (const reservation of (reservations ?? []) as Reservation[]) {
      const existing = map.get(reservation.propertyId) ?? [];
      existing.push(reservation);
      map.set(reservation.propertyId, existing);
    }
    map.forEach((value) => value.sort((a, b) => a.checkInAt - b.checkInAt));
    return map;
  }, [reservations]);

  // --- Computed: active vs idle properties ---
  const { activeProperties, idleProperties } = useMemo(() => {
    const active: typeof filteredProperties = [];
    const idle: typeof filteredProperties = [];
    for (const p of filteredProperties) {
      const hasJobs = rangeDays.some((day) => {
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
  }, [filteredProperties, rangeDays, jobsByCell]);

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
  const showCleanerPanel = isCleanerPanelVisible;

  // --- Grid column sizing ---
  // Fixed-width day columns sized so that ~a week (`visibleSpan`) fills the
  // measured grid width. Week view has exactly `visibleSpan` columns → fills,
  // no scroll. Month view has ~30 columns → overflows → smooth native scroll.
  const propColPxNum =
    propertyLabelMode === "hidden" ? 0 : propertyLabelMode === "initials" ? 40 : 160;
  const isNarrow = gridWidth > 0 && gridWidth < 700;
  const visibleSpan = isNarrow ? 3 : 7;
  const dayColPx =
    gridWidth > 0
      ? Math.max(isNarrow ? 68 : 116, Math.floor((gridWidth - propColPxNum) / visibleSpan))
      : 140;
  // Narrow columns can't fit full job cards → fall back to the compact dot view.
  const compactCells = dayColPx < 104;
  const scheduleGridTemplateColumns = `${
    propertyLabelMode === "hidden" ? "" : `${propColPxNum}px `
  }repeat(${Math.max(1, rangeDays.length)}, ${dayColPx}px)`;

  // Measure the grid width (drives column sizing) and keep scroll bounds fresh.
  useEffect(() => {
    const el = gridScrollRef.current;
    if (!el) return;
    const measure = () => {
      setGridWidth(el.clientWidth);
      setMaxScroll(Math.max(0, el.scrollWidth - el.clientWidth));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Recompute scroll bounds whenever the rendered columns change.
  useEffect(() => {
    const el = gridScrollRef.current;
    if (!el) return;
    setMaxScroll(Math.max(0, el.scrollWidth - el.clientWidth));
  }, [rangeDays.length, dayColPx, propColPxNum]);

  const handleGridScroll = (event: React.UIEvent<HTMLDivElement>) => {
    setScrollLeft(event.currentTarget.scrollLeft);
  };

  // --- Drag-to-pan on the date header (mouse only) ---
  // Click-and-hold anywhere on the date-title row and drag left/right to slide
  // through the month — same effect as the slider. Touch is left to native
  // scrolling (pointer drag would double-move it), and this lives on the header
  // row only, so job cells in the property rows stay clickable.
  const headerDrag = useRef<{ startX: number; startScroll: number; active: boolean }>({
    startX: 0,
    startScroll: 0,
    active: false,
  });
  const handleHeaderPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = gridScrollRef.current;
    if (!el || maxScroll <= 1 || event.pointerType !== "mouse") return;
    headerDrag.current = { startX: event.clientX, startScroll: el.scrollLeft, active: true };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };
  const handleHeaderPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = headerDrag.current;
    const el = gridScrollRef.current;
    if (!drag.active || !el) return;
    el.scrollLeft = drag.startScroll - (event.clientX - drag.startX);
  };
  const handleHeaderPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!headerDrag.current.active) return;
    headerDrag.current.active = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  // Nudge scroll by ~a week when the edge arrows are clicked.
  const scrollByPage = (direction: -1 | 1) => {
    const el = gridScrollRef.current;
    if (!el) return;
    const page = Math.max(dayColPx, el.clientWidth - propColPxNum) * 0.9;
    el.scrollBy({ left: direction * page, behavior: "smooth" });
  };
  const canScrollLeft = scrollLeft > 2;
  const canScrollRight = scrollLeft < maxScroll - 2;

  // Center today's column in the day viewport (used on month entry so the
  // "today" week is visible instead of the 1st of the month).
  const centerTodayInView = useCallback(() => {
    const el = gridScrollRef.current;
    if (!el || dayColPx <= 0) return;
    const idx = daysBetween(rangeStart, todayStart);
    if (idx < 0 || idx >= rangeDays.length) return; // today not in this range
    const propW = propertyLabelMode === "hidden" ? 0 : propColPxNum;
    const dayViewport = el.clientWidth - propW;
    const target = idx * dayColPx - Math.max(0, (dayViewport - dayColPx) / 2);
    const clamped = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, target));
    el.scrollTo({ left: clamped, behavior: "auto" });
    setScrollLeft(clamped);
  }, [dayColPx, propColPxNum, propertyLabelMode, rangeDays.length, rangeStart, todayStart]);

  // On entering month view (or when its layout settles), snap to today's week.
  useEffect(() => {
    if (rangeMode !== "month") return;
    const id = requestAnimationFrame(() => centerTodayInView());
    return () => cancelAnimationFrame(id);
  }, [rangeMode, rangeStart, dayColPx, gridWidth, centerTodayInView]);

  // --- Navigation helpers ---
  const applyWeekRange = (baseDate: Date) => {
    // Rolling week: anchor on the given day (today, when called from "Today")
    // instead of snapping back to Monday.
    const nextStart = startOfDay(baseDate);
    setRangeStart(nextStart);
    setRangeEnd(addDays(nextStart, 6));
  };

  const applyMonthRange = (baseDate: Date) => {
    setRangeStart(startOfMonth(baseDate));
    setRangeEnd(endOfMonth(baseDate));
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
  };

  // Explicit view switch (Week | Month segmented control). Both land on the
  // period containing today; month view then centers on today via effect.
  const selectView = (mode: "week" | "month") => {
    setRangeMode(mode);
    if (mode === "month") {
      applyMonthRange(new Date());
    } else {
      applyWeekRange(new Date());
    }
  };

  const goToToday = () => {
    if (rangeMode === "month") {
      applyMonthRange(new Date());
      requestAnimationFrame(() => centerTodayInView());
    } else {
      setRangeMode("week");
      applyWeekRange(new Date());
    }
  };

  const handleQuickAssign = async (
    jobId: Id<"cleaningJobs">,
    cleanerId: Id<"users"> | null,
  ) => {
    setAssigningJobId(jobId);
    try {
      const result = await assignJob({
        jobId,
        cleanerIds: cleanerId ? [cleanerId] : [],
        notifyCleaners: false,
        source: cleanerId ? "schedule_quick_assign" : "schedule_quick_unassign",
        returnWarnings: true,
      });
      setQuickAssignJobId(null);
      showToast(cleanerId ? "Cleaner assigned successfully." : "Cleaner unassigned.");
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

  // Drawer toggle for the property axis: collapsed shows only the property image
  // ("initials"), expanded shows image + name ("full"). Applies to both the
  // Occupancy and Tasks boards (the axis is shared).
  const togglePropertyDrawer = useCallback(() => {
    setPropertyLabelMode((current) => (current === "full" ? "initials" : "full"));
  }, []);

  // --- Swipe handlers ---
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = (e: React.TouchEvent) => {
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    const deltaY = e.changedTouches[0].clientY - touchStartY.current;
    if (Math.abs(deltaX) < 50 || Math.abs(deltaY) > Math.abs(deltaX)) return;
    // Month view scrolls horizontally on its own; only week view pages here.
    if (rangeMode !== "week") return;
    shiftRange(deltaX < 0 ? 1 : -1);
  };

  // --- Render helpers ---
  const renderPropertyCell = (property: {
    _id: string;
    name: string;
    address: string;
    status?: unknown;
    primaryPhotoUrl?: string;
    imageUrl?: string;
    picture?: string;
  }) => {
    if (propertyLabelMode === "hidden") return null;
    const statusCandidate = property.status;
    const pStatus: PropertyStatus =
      statusCandidate === "ready" || statusCandidate === "dirty" || statusCandidate === "in_progress" || statusCandidate === "vacant"
        ? statusCandidate
        : "vacant";
    // Same resolution as the Properties page cards.
    const photo = property.primaryPhotoUrl ?? property.imageUrl ?? property.picture;

    if (propertyLabelMode === "initials") {
      // Reduced mode: just the property photo (with a status-dot badge).
      return (
        <Link
          href={`/properties/${property._id}`}
          className="sticky left-0 z-10 flex items-center justify-center border-r bg-[var(--card)] p-1 hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
          title={property.name}
        >
          <span className="relative">
            <PropertyPhoto name={property.name} imageUrl={photo} className="h-8 w-8" />
            <span
              className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-[var(--card)] ${readinessDotClass[pStatus]}`}
            />
          </span>
        </Link>
      );
    }

    // Full mode: property photo + name + address + status.
    return (
      <Link
        href={`/properties/${property._id}`}
        className="sticky left-0 z-10 block border-r bg-[var(--card)] p-2 hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] sm:p-3"
        title={`Open ${property.name}`}
      >
        <div className="flex items-start gap-2">
          <PropertyPhoto
            name={property.name}
            imageUrl={photo}
            className="h-9 w-9 sm:h-10 sm:w-10"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold underline-offset-2 hover:underline sm:text-sm">{property.name}</p>
            <p className="hidden truncate text-xs text-[var(--muted-foreground)] sm:block">{property.address}</p>
            <div className="mt-1 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] sm:px-2 sm:text-xs">
              <span className={`h-1.5 w-1.5 rounded-full sm:h-2 sm:w-2 ${readinessDotClass[pStatus]}`} />
              <span className="hidden sm:inline">{pStatus.replace("_", " ")}</span>
            </div>
          </div>
        </div>
      </Link>
    );
  };

  const renderJobCell = (cellJobs: JobWithRelations[], propertyId: string, day: Date) => {
    const key = `${propertyId}-${dateKeyFn(day)}`;
    // Continue the "today" column down every row: a violet left-edge line + a
    // faint tint so the current day reads as one highlighted column.
    const isToday = dateKeyFn(day) === todayKey;
    const cellEdgeClass = isToday
      ? "border-l-2 border-l-violet-500 bg-violet-500/[0.06]"
      : "border-l";

    if (cellJobs.length === 0) {
      return (
        <div key={key} className={`relative h-10 sm:h-16 ${cellEdgeClass}`}>
          <ScheduleCellTaskOverlay mineOnly={mineOnly} myUserId={myUserId} summary={summaryFor(propertyId, day)}
            propertyId={propertyId as Id<"properties">}
            day={day}
            variant="compact"
          />
        </div>
      );
    }

    // 7-day compact mode: dots on mobile only, desktop always shows full cards
    if (compactCells) {
      return (
        <div key={key} className={`relative ${cellEdgeClass}`}>
          <div className="md:hidden">
            <ScheduleCellTaskOverlay mineOnly={mineOnly} myUserId={myUserId} summary={summaryFor(propertyId, day)}
              propertyId={propertyId as Id<"properties">}
              day={day}
              variant="compact"
            />
          </div>
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
                ? formatTimeInZone(job.scheduledStartAt, resolveDisplayTimezone(job.property?.timezone), { hour: "2-digit", minute: "2-digit" })
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
                      {formatTimeInZone(job.scheduledStartAt ?? 0, resolveDisplayTimezone(job.property?.timezone), { hour: "2-digit", minute: "2-digit" })}
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
                      {availableAssignment?.blockedReason ? (
                        <p className="mb-2 text-[11px] text-[var(--destructive)]">
                          {availableAssignment.blockedReason}
                        </p>
                      ) : null}
                      {hasAssignedCleaner ? (
                        <button
                          type="button"
                          disabled={assigningJobId === job._id}
                          onClick={() => void handleQuickAssign(job._id, null)}
                          className="mb-1 flex w-full items-center justify-between rounded px-2 py-1 text-left text-[11px] text-[var(--destructive)] hover:bg-[var(--accent)] disabled:opacity-60"
                        >
                          <span className="truncate">Unassign cleaner</span>
                        </button>
                      ) : null}
                      {companyCleaners.length === 0 ? (
                        <p className="text-[11px] text-[var(--muted-foreground)]">
                          {availableAssignment?.blockedReason ?? "No eligible cleaners."}
                        </p>
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
            <ScheduleCellTaskOverlay mineOnly={mineOnly} myUserId={myUserId} summary={summaryFor(propertyId, day)}
              propertyId={propertyId as Id<"properties">}
              day={day}
              variant="full"
            />
          </div>
        </div>
      );
    }

    // 3-day mode: full job cards
    return (
      <div key={key} className={`space-y-1 p-1 sm:p-2 ${cellEdgeClass}`}>
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
                  {formatTimeInZone(job.scheduledStartAt ?? 0, resolveDisplayTimezone(job.property?.timezone), { hour: "2-digit", minute: "2-digit" })}
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
                  {availableAssignment?.blockedReason ? (
                    <p className="mb-2 text-[11px] text-[var(--destructive)]">
                      {availableAssignment.blockedReason}
                    </p>
                  ) : null}
                  {hasAssignedCleaner ? (
                    <button
                      type="button"
                      disabled={assigningJobId === job._id}
                      onClick={() => void handleQuickAssign(job._id, null)}
                      className="mb-1 flex w-full items-center justify-between rounded px-2 py-1 text-left text-[11px] text-[var(--destructive)] hover:bg-[var(--accent)] disabled:opacity-60"
                    >
                      <span className="truncate">Unassign cleaner</span>
                    </button>
                  ) : null}
                  {companyCleaners.length === 0 ? (
                    <p className="text-[11px] text-[var(--muted-foreground)]">
                      {availableAssignment?.blockedReason ?? "No eligible cleaners."}
                    </p>
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
        <ScheduleCellTaskOverlay mineOnly={mineOnly} myUserId={myUserId} summary={summaryFor(propertyId, day)}
          propertyId={propertyId as Id<"properties">}
          day={day}
          variant="full"
        />
      </div>
    );
  };

  // --- Render helper: occupancy lane ---
  // Replaces the per-day job cells with absolutely-positioned reservation bars
  // for one property row. The lane spans every day column of the grid so bar
  // offsets map directly onto `dayColPx`.
  const renderOccupancyLane = (propertyId: string) => {
    const stays = reservationsByProperty.get(propertyId) ?? [];
    const todayIdx = daysBetween(rangeStart, todayStart);
    const showToday = todayIdx >= 0 && todayIdx < rangeDays.length;
    return (
      <div
        className="relative h-14 sm:h-16"
        style={{
          gridColumn: `span ${Math.max(1, rangeDays.length)}`,
          backgroundImage: `repeating-linear-gradient(to right, var(--border) 0, var(--border) 1px, transparent 1px, transparent ${dayColPx}px)`,
        }}
      >
        {/* Today column highlight, drawn under the bars. */}
        {showToday ? (
          <div
            className="pointer-events-none absolute bottom-0 top-0 border-l-2 border-l-violet-500 bg-violet-500/[0.06]"
            style={{ left: todayIdx * dayColPx, width: dayColPx }}
          />
        ) : null}
        {stays.map((stay) => {
          // Clip to the visible range; skip stays entirely outside it.
          if (stay.checkOutAt <= rangeStartTime || stay.checkInAt >= rangeEndExclusiveTime) {
            return null;
          }
          const startIdx = clampIndex(daysBetween(rangeStart, new Date(stay.checkInAt)), rangeDays.length);
          const endIdx = clampIndex(daysBetween(rangeStart, new Date(stay.checkOutAt)), rangeDays.length);
          const left = startIdx * dayColPx;
          const width = Math.max(dayColPx, (endIdx - startIdx) * dayColPx);
          const channel = channelBadge(stay.platform);
          const checkInLabel = new Date(stay.checkInAt).toLocaleDateString([], { month: "short", day: "numeric" });
          const checkOutLabel = new Date(stay.checkOutAt).toLocaleDateString([], { month: "short", day: "numeric" });
          return (
            <div
              key={stay._id}
              className="absolute bottom-1 top-1 flex items-center gap-1 overflow-hidden rounded-md border border-teal-600/40 bg-teal-500/90 px-1.5 text-[10px] font-medium text-white shadow-sm"
              style={{ left, width }}
              title={`${stay.guestName} · ${checkInLabel} – ${checkOutLabel}${channel ? ` · ${channel.label}` : ""}`}
            >
              <GuestAvatar name={stay.guestName} photoUrl={stay.guestPhotoUrl} />
              <span className="min-w-0 flex-1 truncate">{stay.guestName}</span>
              {channel ? (
                <span
                  className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-white/25 text-[8px] font-bold leading-none"
                  aria-label={channel.label}
                >
                  {channel.letter}
                </span>
              ) : null}
              {typeof stay.numberOfGuests === "number" ? (
                <span className="flex shrink-0 items-center gap-0.5 text-[9px]">
                  <Users className="h-2.5 w-2.5" />
                  {stay.numberOfGuests}
                </span>
              ) : null}
            </div>
          );
        })}
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
        {/* Single row on desktop. On mobile it may wrap rather than overflow —
            an overflowing row pushed the filter outside the viewport and made
            the whole page horizontally scrollable. Wrapping is the guard; with
            "Today" hidden below sm the controls normally still fit one line. */}
        <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap sm:gap-2">
          {/* Today — desktop only. The mobile row must fit the viewport: an
              overflowing toolbar pushed the filter off-screen and made the whole
              page horizontally scrollable. On mobile you swipe the grid instead. */}
          <button
            className="hidden shrink-0 rounded-md border px-2 py-1 text-xs font-semibold hover:bg-[var(--accent)] sm:inline-block sm:px-3 sm:py-1.5 sm:text-sm"
            onClick={goToToday}
            title="Jump to today"
          >
            Today
          </button>

          {/* Week | Month view switcher */}
          <div className="flex shrink-0 overflow-hidden rounded-md border text-xs font-semibold">
            <button
              type="button"
              onClick={() => selectView("week")}
              className={cn("px-2 py-1 sm:px-3 sm:py-1.5", rangeMode === "week" ? "bg-[var(--accent)]" : "hover:bg-[var(--accent)]")}
              aria-pressed={rangeMode === "week"}
            >
              Week
            </button>
            <button
              type="button"
              onClick={() => selectView("month")}
              className={cn("border-l px-2 py-1 sm:px-3 sm:py-1.5", rangeMode === "month" ? "bg-[var(--accent)]" : "hover:bg-[var(--accent)]")}
              aria-pressed={rangeMode === "month"}
            >
              Month
            </button>
          </div>

          {/* Occupancy | Tasks board switcher */}
          <div className="flex shrink-0 overflow-hidden rounded-md border text-xs font-semibold">
            <button
              type="button"
              onClick={() => setBoardMode("occupancy")}
              className={cn("px-2 py-1 sm:px-3 sm:py-1.5", boardMode === "occupancy" ? "bg-[var(--accent)]" : "hover:bg-[var(--accent)]")}
              aria-pressed={boardMode === "occupancy"}
            >
              Occupancy
            </button>
            <button
              type="button"
              onClick={() => setBoardMode("tasks")}
              className={cn("border-l px-2 py-1 sm:px-3 sm:py-1.5", boardMode === "tasks" ? "bg-[var(--accent)]" : "hover:bg-[var(--accent)]")}
              aria-pressed={boardMode === "tasks"}
            >
              Tasks
            </button>
          </div>

          {/* Range arrows stay on mobile: they are the ONLY way to page to the
              next/previous month. The swipe handler only calls shiftRange in
              week view (month view scrolls internally), so hiding these would
              strand month-view users in the current month. */}
          <button className="shrink-0 rounded-md p-1 hover:bg-[var(--accent)] sm:p-1.5" onClick={() => shiftRange(-1)} aria-label="Previous">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button className="shrink-0 rounded-md p-1 hover:bg-[var(--accent)] sm:p-1.5" onClick={() => shiftRange(1)} aria-label="Next">
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="min-w-0 truncate px-1 text-xs font-semibold text-[var(--muted-foreground)] sm:px-2 sm:text-sm">
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

            {/* City filter (desktop) */}
            <div className="hidden w-36 md:block">
              <SearchableSelect
                value={cityFilter === "all" ? null : cityFilter}
                onChange={(id) => setCityFilter(id ?? "all")}
                placeholder="All Cities"
                searchPlaceholder="Search cities…"
                aria-label="Filter by city"
                items={cityOptions.map((o) => ({ id: o.value, label: o.label }))}
              />
            </div>

            {/* Property filter (desktop) */}
            <div className="hidden w-48 md:block">
              <SearchableSelect
                value={propertyFilter === "all" ? null : propertyFilter}
                onChange={(id) => setPropertyFilter(id ?? "all")}
                placeholder="All Properties"
                searchPlaceholder="Search properties…"
                aria-label="Filter by property"
                items={propertyPickerOptions}
              />
            </div>

            {/* Tasks: mine-only toggle (desktop; moved into the filter sheet on mobile) */}
            <label
              className={`hidden shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold transition md:inline-flex ${
                mineOnly
                  ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]"
                  : "bg-[var(--card)] text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
              }`}
              title="Show only tasks assigned to me"
            >
              <input
                type="checkbox"
                className="h-3 w-3"
                checked={mineOnly}
                onChange={(e) => setMineOnly(e.target.checked)}
                aria-label="Mine only"
              />
              My tasks
            </label>

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

            {/* Label mode cycle (desktop; moved into the filter sheet on mobile) */}
            <button
              type="button"
              onClick={cycleLabelMode}
              className="hidden rounded-md border px-2 py-1 text-[10px] hover:bg-[var(--accent)] sm:text-xs md:inline-block"
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
              onClick={() => selectView(rangeMode === "month" ? "week" : "month")}
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

            <div className="max-w-[120px]">
              <SearchableSelect
                value={cityFilter === "all" ? null : cityFilter}
                onChange={(id) => setCityFilter(id ?? "all")}
                placeholder="All Cities"
                searchPlaceholder="Search…"
                aria-label="Filter by city"
                items={cityOptions.map((o) => ({ id: o.value, label: o.label }))}
              />
            </div>

            <div className="max-w-[160px]">
              <SearchableSelect
                value={propertyFilter === "all" ? null : propertyFilter}
                onChange={(id) => setPropertyFilter(id ?? "all")}
                placeholder="All"
                searchPlaceholder="Search…"
                aria-label="Filter by property"
                items={propertyPickerOptions}
              />
            </div>

            {/* Mine-only toggle (relocated here from the top row on mobile) */}
            <label
              className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold transition ${
                mineOnly
                  ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]"
                  : "bg-[var(--card)] text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
              }`}
              title="Show only tasks assigned to me"
            >
              <input
                type="checkbox"
                className="h-3 w-3"
                checked={mineOnly}
                onChange={(e) => setMineOnly(e.target.checked)}
                aria-label="Mine only"
              />
              My tasks
            </label>

            {/* Property label density (relocated here from the top row on mobile) */}
            <button
              type="button"
              onClick={cycleLabelMode}
              className="rounded-md border px-2 py-1 text-[10px] font-semibold hover:bg-[var(--accent)]"
              title={`Property labels: ${propertyLabelMode}`}
            >
              Labels: {propertyLabelMode === "full" ? "Aa" : propertyLabelMode === "initials" ? "AB" : "Off"}
            </button>
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
        <div className="relative">
        <section
          ref={gridScrollRef}
          onScroll={handleGridScroll}
          className={cn(
            "relative rounded-2xl border bg-[var(--card)] overflow-x-auto",
            mobileTab !== "schedule" && "hidden md:block",
          )}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Grid header row — drag anywhere here (mouse) to pan the month */}
          <div
            className={cn(
              "grid w-max select-none border-b",
              maxScroll > 1 && "md:cursor-grab md:active:cursor-grabbing",
            )}
            style={{ gridTemplateColumns: scheduleGridTemplateColumns }}
            onPointerDown={handleHeaderPointerDown}
            onPointerMove={handleHeaderPointerMove}
            onPointerUp={handleHeaderPointerUp}
            onPointerCancel={handleHeaderPointerUp}
          >
            {propertyLabelMode !== "hidden" ? (
              <button
                type="button"
                onClick={togglePropertyDrawer}
                onPointerDown={(e) => e.stopPropagation()}
                title={propertyLabelMode === "full" ? "Collapse to image only" : "Expand to show property names"}
                aria-label={propertyLabelMode === "full" ? "Collapse property column to image only" : "Expand property column to show names"}
                aria-expanded={propertyLabelMode === "full"}
                className="sticky left-0 z-20 flex items-center justify-between gap-1 border-r bg-[var(--card)] p-2 text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] sm:p-3 sm:text-xs"
              >
                {propertyLabelMode === "full" ? (
                  <>
                    <span>Property</span>
                    <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
                  </>
                ) : (
                  <ChevronRight className="mx-auto h-3.5 w-3.5 shrink-0" />
                )}
              </button>
            ) : null}
            {rangeDays.map((day) => {
              const isToday = dateKeyFn(day) === todayKey;
              return (
                <div
                  key={dateKeyFn(day)}
                  className={`p-1.5 text-center sm:p-3 ${
                    isToday
                      ? "border-l-2 border-l-violet-500 bg-violet-500/[0.06]"
                      : "border-l"
                  }`}
                >
                  {isToday ? (
                    <span className="mx-auto flex w-fit items-center gap-1 rounded-full bg-violet-500 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow-sm sm:text-[10px]">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
                      </span>
                      Today
                    </span>
                  ) : (
                    <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] sm:text-[10px]">
                      {day.toLocaleDateString([], { weekday: "short" })}
                    </p>
                  )}
                  <p
                    className={`text-sm font-extrabold leading-none sm:text-lg ${
                      isToday ? "text-violet-500" : ""
                    }`}
                  >
                    {day.toLocaleDateString([], { day: "2-digit" })}
                  </p>
                  {boardMode === "tasks" ? (
                    <ScheduleDateHeaderTaskOverlay day={day} mineOnly={mineOnly} myUserId={myUserId} summary={summaryFor("global", day)} />
                  ) : null}
                </div>
              );
            })}
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
              {/* All properties — show active and idle together. Portfolio is
                  too small to make hiding idle rows worthwhile. */}
              {[...activeProperties, ...idleProperties].map((property) => (
                <div
                  key={property._id}
                  className="grid w-max border-b last:border-b-0"
                  style={{ gridTemplateColumns: scheduleGridTemplateColumns }}
                >
                  {renderPropertyCell(property as { _id: string; name: string; address: string; status?: unknown; primaryPhotoUrl?: string; imageUrl?: string; picture?: string })}
                  {boardMode === "occupancy"
                    ? renderOccupancyLane(property._id)
                    : rangeDays.map((day) => {
                        const key = `${property._id}-${dateKeyFn(day)}`;
                        const cellJobs = jobsByCell.get(key) ?? [];
                        return renderJobCell(cellJobs, property._id, day);
                      })}
                </div>
              ))}
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
                            {formatTimeInZone(job.scheduledStartAt ?? 0, resolveDisplayTimezone(job.property?.timezone), { hour: "2-digit", minute: "2-digit" })}
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
                              {hasAssignedCleaner ? (
                                <button
                                  type="button"
                                  disabled={assigningJobId === job._id}
                                  onClick={() => void handleQuickAssign(job._id, null)}
                                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[11px] text-[var(--destructive)] hover:bg-black/10 disabled:opacity-60"
                                >
                                  <span className="truncate">Unassign cleaner</span>
                                </button>
                              ) : null}
                              {companyCleaners.length === 0 ? (
                                <p className="text-[11px] opacity-60">
                                  {availableAssignment?.blockedReason ??
                                    (availableAssignment?.companyName
                                      ? `No cleaners in ${availableAssignment.companyName}`
                                      : "No company assigned to property")}
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

          {/* Edge arrows at the date-header level (desktop) — nudge ~a week */}
          {maxScroll > 1 ? (
            <>
              {canScrollLeft ? (
                <button
                  type="button"
                  onClick={() => scrollByPage(-1)}
                  className="absolute top-2 z-30 hidden h-8 w-8 items-center justify-center rounded-full border bg-[var(--card)] shadow-md hover:bg-[var(--accent)] md:flex"
                  style={{ left: propColPxNum + 6 }}
                  aria-label="Scroll back a week"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              ) : null}
              {canScrollRight ? (
                <button
                  type="button"
                  onClick={() => scrollByPage(1)}
                  className="absolute right-2 top-2 z-30 hidden h-8 w-8 items-center justify-center rounded-full border bg-[var(--card)] shadow-md hover:bg-[var(--accent)] md:flex"
                  aria-label="Scroll forward a week"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {/* Smooth scroll slider — bound to the grid's horizontal scroll position
          (pixels), so dragging glides through the days instead of snapping. */}
      {maxScroll > 1 ? (
        <div className="rounded-xl border bg-[var(--card)] p-3">
          <input
            type="range"
            min={0}
            max={maxScroll}
            step={1}
            value={Math.min(scrollLeft, maxScroll)}
            onChange={(event) => {
              const next = Number(event.target.value);
              const el = gridScrollRef.current;
              if (el) el.scrollLeft = next;
              setScrollLeft(next);
            }}
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
