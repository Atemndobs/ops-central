"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Bell,
  Building2,
  ChevronsLeftRight,
  ChevronsRightLeft,
  FileText,
  Filter,
  LayoutGrid,
  MapPin,
  Rows3,
  X,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import { fmtMoney, fmtMonth, upgradeAirbnbImageQuality } from "./owner-format";
import { MortgageCoverageBar } from "./mortgage-coverage";
import { MonthSwitcher } from "./month-switcher";
import { useMonthFromUrl } from "./use-month-from-url";
import { SearchableSelect } from "@/components/ui/searchable-select";

/**
 * Owner dashboard. Two view modes (card / list) — list scales to 30+
 * properties; card is the YC-demo aesthetic. Month picker lets the
 * owner page through history (already-issued statements) or peek
 * ahead at next month's draft.
 */
/** localStorage key for the user's explicit view-mode override. Absence
 *  of a value means "use the smart default based on portfolio size".
 *  Smart defaults: ≤3 properties → cards (showcase aesthetic);
 *  >3 → list (compact, scales). User toggle persists and wins. */
const VIEW_MODE_KEY = "owner-dashboard-view-mode";

export function OwnerDashboardClient() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  // `null` = no explicit user choice yet → fall back to the smart
  // portfolio-size default. Once the user toggles, we lock in their
  // preference and persist it.
  const [viewOverride, setViewOverride] = useState<"card" | "list" | null>(null);
  // Hydrate from localStorage on mount (client-only). SSR renders the
  // null state → smart default → no layout flash since the toolbar
  // toggle is the only thing that changes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(VIEW_MODE_KEY);
    // SSR/hydration-safe localStorage hydration: render server + first
    // client paint with `null` (matches), then hydrate the stored value
    // on mount. Avoids hydration mismatch warnings without
    // suppressHydrationWarning.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === "card" || stored === "list") setViewOverride(stored);
  }, []);
  function setViewMode(mode: "card" | "list") {
    setViewOverride(mode);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VIEW_MODE_KEY, mode);
    }
  }
  // URL-backed month — drill-ins preserve context, browser back/forward
  // navigate periods, deep-links share their state. See use-month-from-url.
  const [month, setMonth] = useMonthFromUrl();
  // Performance filters: empty Set = no filter (show all). Selecting a city
  // chip toggles it. Same for state. Multi-select within each axis is OR;
  // city ∩ state is AND. Default sort is "payout" DESC (best-performing
  // first) per owner's primary question: "how well is each property doing?"
  const [selectedCities, setSelectedCities] = useState<Set<string>>(new Set());
  const [selectedStates, setSelectedStates] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("payout");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");

  const dashboard = useQuery(
    api.owner.queries.getOwnerDashboard,
    isAuthenticated ? { month } : "skip",
  );

  if (isLoading || dashboard === undefined) return <SkeletonCard />;

  // Effective view mode: explicit user override wins, otherwise smart
  // default by portfolio size (1-3 properties → cards, 4+ → list).
  const propertyCount =
    dashboard.mode === "no_properties" ? 0 : dashboard.properties.length;
  const viewMode: "card" | "list" =
    viewOverride ?? (propertyCount > 3 ? "list" : "card");

  if (dashboard.mode === "no_properties") {
    return (
      <div
        className="rounded-2xl border border-black/[0.06] p-12 text-center"
        style={{ background: "var(--cleaner-surface)" }}
      >
        <Building2 size={32} className="mx-auto mb-3" style={{ color: "var(--cleaner-muted)" }} />
        <p className="text-lg" style={{ fontFamily: "var(--font-cleaner-display)", fontWeight: 700 }}>
          No properties yet
        </p>
        <p className="mt-2 text-sm" style={{ color: "var(--cleaner-muted)" }}>
          You&apos;ll see your properties here once they&apos;re added.
          Contact ChezSoiStays Operations.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1
          className="text-3xl tracking-tight"
          style={{ fontFamily: "var(--font-cleaner-display)", fontWeight: 700 }}
        >
          Welcome back{dashboard.user.name ? `, ${dashboard.user.name.split(" ")[0]}` : ""}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--cleaner-muted)" }}>
          {dashboard.mode === "single"
            ? "Your property at a glance."
            : `${dashboard.properties.length} properties — your portfolio at a glance.`}
        </p>
      </div>

      <Toolbar
        month={month}
        onMonthChange={setMonth}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      <FilterBar
        facets={dashboard.facets}
        selectedCities={selectedCities}
        selectedStates={selectedStates}
        onToggleCity={(c) =>
          setSelectedCities((prev) => {
            const next = new Set(prev);
            if (next.has(c)) next.delete(c);
            else next.add(c);
            return next;
          })
        }
        onToggleState={(s) =>
          setSelectedStates((prev) => {
            const next = new Set(prev);
            if (next.has(s)) next.delete(s);
            else next.add(s);
            return next;
          })
        }
        onClearFilters={() => {
          setSelectedCities(new Set());
          setSelectedStates(new Set());
        }}
        sortKey={sortKey}
        onSortChange={setSortKey}
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
      />

      <FilteredPortfolio
        properties={dashboard.properties}
        selectedCities={selectedCities}
        selectedStates={selectedStates}
        sortKey={sortKey}
        groupBy={groupBy}
        viewMode={viewMode}
        month={month}
        flags={dashboard.flags}
      />
    </div>
  );
}

// ─── Filter / sort / group orchestration ───────────────────────────────────

/**
 * Admin-toggleable visibility for the per-property tiles in the dashboard
 * card + list views. Mirrors the same flags the per-property summary card
 * honours (see convex/owner/queries.ts → getOwnerProperty / getOwnerDashboard).
 */
export type DashboardFlags = {
  showMgmtFee: boolean;
  showPayout: boolean;
};

function FilteredPortfolio({
  properties,
  selectedCities,
  selectedStates,
  sortKey,
  groupBy,
  viewMode,
  month,
  flags,
}: {
  properties: PropertyRow[];
  selectedCities: Set<string>;
  selectedStates: Set<string>;
  sortKey: SortKey;
  groupBy: GroupBy;
  viewMode: "card" | "list";
  month: string;
  flags: DashboardFlags;
}) {
  const filteredAndSorted = useMemo(() => {
    const filtered = properties.filter((p) => {
      if (selectedCities.size > 0 && (!p.city || !selectedCities.has(p.city))) return false;
      if (selectedStates.size > 0 && (!p.state || !selectedStates.has(p.state))) return false;
      return true;
    });
    return [...filtered].sort((a, b) => compareBySortKey(a, b, sortKey));
  }, [properties, selectedCities, selectedStates, sortKey]);

  // Render either flat or grouped (by city or state).
  if (groupBy === "none") {
    if (filteredAndSorted.length === 0) return <EmptyFiltered />;
    return viewMode === "card" ? (
      <CardView properties={filteredAndSorted} month={month} flags={flags} />
    ) : (
      <ListView properties={filteredAndSorted} month={month} flags={flags} />
    );
  }

  const groups = new Map<string, PropertyRow[]>();
  for (const p of filteredAndSorted) {
    const key = (groupBy === "city" ? p.city : p.state) ?? "(no " + groupBy + ")";
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }
  // Sort groups by total payout descending (most lucrative city/state first)
  const orderedGroups = Array.from(groups.entries()).sort((a, b) => {
    const totalA = a[1].reduce(
      (s, p) => s + ("totals" in p.draft ? p.draft.totals.ownerPayout : 0),
      0,
    );
    const totalB = b[1].reduce(
      (s, p) => s + ("totals" in p.draft ? p.draft.totals.ownerPayout : 0),
      0,
    );
    return totalB - totalA;
  });

  if (orderedGroups.length === 0) return <EmptyFiltered />;

  return (
    <div className="space-y-8">
      {orderedGroups.map(([groupName, rows]) => {
        const totalPayout = rows.reduce(
          (s, p) => s + ("totals" in p.draft ? p.draft.totals.ownerPayout : 0),
          0,
        );
        const currency = rows[0]?.currency ?? "USD";
        return (
          <section key={groupName}>
            <div className="mb-3 flex items-baseline justify-between">
              <h2
                className="flex items-center gap-2 text-base"
                style={{ fontFamily: "var(--font-cleaner-display)", fontWeight: 700 }}
              >
                <MapPin size={14} style={{ color: "var(--cleaner-primary)" }} />
                {groupName}
                <span
                  className="text-xs"
                  style={{ color: "var(--cleaner-muted)", fontWeight: 400 }}
                >
                  · {rows.length} {rows.length === 1 ? "property" : "properties"}
                </span>
              </h2>
              <span
                className="text-sm tabular-nums"
                style={{ fontFamily: "var(--font-cleaner-mono)", fontWeight: 700 }}
              >
                {fmtMoney(totalPayout, currency)}{" "}
                <span
                  className="ml-1 text-[10px] uppercase tracking-wider"
                  style={{ color: "var(--cleaner-muted)" }}
                >
                  group payout
                </span>
              </span>
            </div>
            {viewMode === "card" ? (
              <CardView properties={rows} month={month} flags={flags} />
            ) : (
              <ListView properties={rows} month={month} flags={flags} />
            )}
          </section>
        );
      })}
    </div>
  );
}

function compareBySortKey(a: PropertyRow, b: PropertyRow, key: SortKey): number {
  const aPayout = "totals" in a.draft ? a.draft.totals.ownerPayout : -Infinity;
  const bPayout = "totals" in b.draft ? b.draft.totals.ownerPayout : -Infinity;
  const aGross = "totals" in a.draft ? a.draft.totals.grossRevenue : -Infinity;
  const bGross = "totals" in b.draft ? b.draft.totals.grossRevenue : -Infinity;
  switch (key) {
    case "payout":
      return bPayout - aPayout;
    case "gross":
      return bGross - aGross;
    case "name":
      return a.propertyName.localeCompare(b.propertyName);
    case "pendingFirst":
      // Pending approvals first, then payout desc within each bucket
      if (a.pendingApprovalCount !== b.pendingApprovalCount) {
        return b.pendingApprovalCount - a.pendingApprovalCount;
      }
      return bPayout - aPayout;
  }
}

function EmptyFiltered() {
  return (
    <div
      className="rounded-2xl border border-dashed border-black/[0.06] p-8 text-center"
      style={{ background: "var(--cleaner-surface)" }}
    >
      <p className="text-sm" style={{ color: "var(--cleaner-muted)" }}>
        No properties match the current filters.
      </p>
    </div>
  );
}

// ─── FilterBar — chips for city/state + sort + group ───────────────────────

function FilterBar({
  facets,
  selectedCities,
  selectedStates,
  onToggleCity,
  onToggleState,
  onClearFilters,
  sortKey,
  onSortChange,
  groupBy,
  onGroupByChange,
}: {
  facets: { cities: string[]; states: string[] };
  selectedCities: Set<string>;
  selectedStates: Set<string>;
  onToggleCity: (c: string) => void;
  onToggleState: (s: string) => void;
  onClearFilters: () => void;
  sortKey: SortKey;
  onSortChange: (k: SortKey) => void;
  groupBy: GroupBy;
  onGroupByChange: (g: GroupBy) => void;
}) {
  // Don't bother rendering filter chips if there's only one option per axis
  // (or none) — the chips would be pure noise on a single-property dashboard.
  const showCityFilter = facets.cities.length > 1;
  const showStateFilter = facets.states.length > 1;
  const hasActive = selectedCities.size > 0 || selectedStates.size > 0;
  // Hide the whole bar if no filters apply AND no sort/group choices matter
  // (only 1 property in portfolio).
  if (!showCityFilter && !showStateFilter && facets.cities.length <= 1) {
    return null;
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-2xl border border-black/[0.06] p-3"
      style={{ background: "var(--cleaner-surface)" }}
    >
      {showCityFilter && (
        <ChipGroup
          icon={<Filter size={12} />}
          label="City"
          values={facets.cities}
          selected={selectedCities}
          onToggle={onToggleCity}
        />
      )}
      {showStateFilter && (
        <ChipGroup
          icon={<MapPin size={12} />}
          label="State"
          values={facets.states}
          selected={selectedStates}
          onToggle={onToggleState}
        />
      )}

      <div className="ml-auto flex items-center gap-2">
        {hasActive && (
          <button
            onClick={onClearFilters}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] hover:bg-black/[0.04]"
            style={{ color: "var(--cleaner-muted)" }}
          >
            <X size={10} /> Clear
          </button>
        )}

        <div className="w-[160px]">
          <SearchableSelect
            aria-label="Sort by"
            value={sortKey}
            onChange={(id) => id && onSortChange(id as SortKey)}
            items={[
              { id: "payout", label: "↓ Payout" },
              { id: "gross", label: "↓ Gross" },
              { id: "name", label: "A → Z Name" },
              { id: "pendingFirst", label: "Pending first" },
            ]}
            placeholder="Sort by…"
          />
        </div>

        {(showCityFilter || showStateFilter) && (
          <div className="w-[160px]">
            <SearchableSelect
              aria-label="Group by"
              value={groupBy}
              onChange={(id) => id && onGroupByChange(id as GroupBy)}
              items={[
                { id: "none", label: "No grouping" },
                ...(showCityFilter
                  ? [{ id: "city", label: "Group by city" }]
                  : []),
                ...(showStateFilter
                  ? [{ id: "state", label: "Group by state" }]
                  : []),
              ]}
              placeholder="Group by…"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ChipGroup({
  icon,
  label,
  values,
  selected,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  values: string[];
  selected: Set<string>;
  onToggle: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="flex items-center gap-1 text-[10px] uppercase tracking-wider"
        style={{ color: "var(--cleaner-muted)", fontFamily: "var(--font-cleaner-mono)" }}
      >
        {icon} {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {values.map((v) => {
          const isActive = selected.has(v);
          return (
            <button
              key={v}
              onClick={() => onToggle(v)}
              className="rounded-full px-2 py-0.5 text-[11px] transition"
              style={{
                background: isActive
                  ? "var(--cleaner-primary)"
                  : "var(--cleaner-bg)",
                color: isActive ? "white" : "var(--cleaner-ink)",
                fontFamily: "var(--font-cleaner-mono)",
              }}
              aria-pressed={isActive}
            >
              {v}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type PropertyRow = {
  propertyId: string;
  propertyName: string;
  propertyImage: string | null;
  currency: string;
  city: string | null;
  state: string | null;
  currentMonth: string;
  pendingApprovalCount: number;
  issuedStatementId: string | null;
  /** Raw monthly lease/mortgage obligation (sum of active lease-bucket cost items). 0 = no obligation configured. */
  leaseRawMonthly: number;
  draft:
    | { error: string }
    | {
        totals: {
          grossRevenue: number;
          ownerPayout: number;
          mgmtFee: number;
          feePct: number;
          feeBase: string;
        };
      };
};

type SortKey = "payout" | "gross" | "name" | "pendingFirst";
type GroupBy = "none" | "city" | "state";

// ─── Toolbar (month picker + view toggle) ──────────────────────────────────

function Toolbar({
  month,
  onMonthChange,
  viewMode,
  onViewModeChange,
}: {
  month: string;
  onMonthChange: (m: string) => void;
  viewMode: "card" | "list";
  onViewModeChange: (m: "card" | "list") => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <MonthSwitcher month={month} onMonthChange={onMonthChange} />

      <div
        className="flex items-center rounded-lg border border-black/[0.06] p-0.5"
        style={{ background: "var(--cleaner-surface)" }}
      >
        <button
          onClick={() => onViewModeChange("card")}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs"
          style={{
            background: viewMode === "card" ? "var(--cleaner-bg)" : "transparent",
            color: viewMode === "card" ? "var(--cleaner-ink)" : "var(--cleaner-muted)",
          }}
        >
          <LayoutGrid size={12} /> Cards
        </button>
        <button
          onClick={() => onViewModeChange("list")}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs"
          style={{
            background: viewMode === "list" ? "var(--cleaner-bg)" : "transparent",
            color: viewMode === "list" ? "var(--cleaner-ink)" : "var(--cleaner-muted)",
          }}
        >
          <Rows3 size={12} /> List
        </button>
      </div>
    </div>
  );
}

// ─── Card view (existing, slightly tightened) ──────────────────────────────

function CardView({
  properties,
  month,
  flags,
}: {
  properties: PropertyRow[];
  month: string;
  flags: DashboardFlags;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {properties.map((p) => (
        <PropertyCard key={p.propertyId} p={p} month={month} flags={flags} />
      ))}
    </div>
  );
}

function PropertyCard({
  p,
  month,
  flags,
}: {
  p: PropertyRow;
  month: string;
  flags: DashboardFlags;
}) {
  const totals = "totals" in p.draft ? p.draft.totals : null;
  const hasError = totals === null;
  const isPaid = p.issuedStatementId !== null;
  // Stat grid column count tracks how many tiles the flags expose:
  //   gross (always) + mgmtFee? + payout?  →  1..3
  const visibleStats = 1 + (flags.showMgmtFee ? 1 : 0) + (flags.showPayout ? 1 : 0);
  const statGridCols =
    visibleStats === 3 ? "grid-cols-3" : visibleStats === 2 ? "grid-cols-2" : "grid-cols-1";

  return (
    <Link
      href={`/owner/properties/${p.propertyId}?month=${month}`}
      className="group relative flex flex-col gap-4 rounded-2xl border border-black/[0.06] p-6 transition hover:border-[var(--cleaner-primary)]/40 hover:shadow-sm"
      style={{ background: "var(--cleaner-surface)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2
            className="truncate text-xl tracking-tight"
            style={{ fontFamily: "var(--font-cleaner-display)", fontWeight: 700 }}
          >
            {p.propertyName}
          </h2>
          <p
            className="mt-0.5 text-[10px] uppercase tracking-wider"
            style={{ color: "var(--cleaner-muted)", fontFamily: "var(--font-cleaner-mono)" }}
          >
            {fmtMonth(p.currentMonth)} — {isPaid ? "paid out" : "in progress"}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {p.pendingApprovalCount > 0 && (
            <Link
              href={`/owner/properties/${p.propertyId}/approvals`}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px]"
              style={{
                background: "var(--color-amber-100,#fef3c7)",
                color: "var(--color-amber-900,#8a4a00)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <Bell size={11} />
              {p.pendingApprovalCount} pending
            </Link>
          )}
          {/* Property thumbnail — top-right corner of every card. The whole
              card is already a Link to the detail page, so this image
              participates in that link (no nested anchor). Square 64px so
              it stays compact even on mobile. Falls back to a Building2
              placeholder when the property has no imageUrl set. */}
          <div
            className="relative h-16 w-16 overflow-hidden rounded-xl border border-black/[0.06]"
            style={{ background: "var(--cleaner-bg)" }}
          >
            {p.propertyImage ? (
              // eslint-disable-next-line @next/next/no-img-element -- external CDN with signed params
              <img
                src={upgradeAirbnbImageQuality(p.propertyImage)}
                alt={p.propertyName}
                className="h-full w-full object-cover"
              />
            ) : (
              <div
                className="flex h-full w-full items-center justify-center"
                style={{ color: "var(--cleaner-muted)" }}
              >
                <Building2 size={20} />
              </div>
            )}
          </div>
        </div>
      </div>

      {hasError ? (
        <p className="text-sm italic" style={{ color: "var(--cleaner-muted)" }}>
          Live preview unavailable — {(p.draft as { error: string }).error}
        </p>
      ) : (
        <>
          <div className={`grid ${statGridCols} gap-4 border-t border-black/[0.04] pt-4`}>
            <Stat label="Gross" value={fmtMoney(totals!.grossRevenue, p.currency)} muted />
            {flags.showMgmtFee && (
              <Stat label="Mgmt fee" value={fmtMoney(-totals!.mgmtFee, p.currency)} muted />
            )}
            {flags.showPayout && (
              <Stat
                label={isPaid ? "Paid out" : "Your payout"}
                value={fmtMoney(totals!.ownerPayout, p.currency)}
                accent
              />
            )}
          </div>
          {/* Mortgage progress mini-card — at-a-glance "did this property
              clear its rent/mortgage this month?". Uses the SHARED
              MortgageCoverageBar primitive (mortgage-coverage.tsx) so the
              dashboard mini-bar and the per-property-page indicator
              ALWAYS use the same math + visual. Owner mental model:
              "first dollar of revenue covers the mortgage" → progress =
              grossRevenue, NOT post-fee payout. Hides itself when no
              lease obligation is configured. */}
          <MortgageCoverageBar
            currency={p.currency}
            obligation={p.leaseRawMonthly}
            grossRevenue={totals!.grossRevenue}
            variant="dense"
          />
          <p
            className="text-xs"
            style={{ color: "var(--cleaner-muted)", fontFamily: "var(--font-cleaner-mono)" }}
          >
            Fee formula: {(totals!.feePct * 100).toFixed(1)}% × {totals!.feeBase}
          </p>
        </>
      )}

      <div
        className="flex items-center gap-1 text-sm font-medium"
        style={{ color: "var(--cleaner-primary)" }}
      >
        <FileText size={14} />
        View statements
        <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

// ─── List view (scales to 30+) ─────────────────────────────────────────────

/** localStorage key for the list-view "show names" preference. Default
 *  is ON (names visible) so the table is self-describing on first load;
 *  user toggle persists across reloads. */
const SHOW_NAMES_KEY = "owner-dashboard-list-show-names";

function ListView({
  properties,
  month,
  flags,
}: {
  properties: PropertyRow[];
  month: string;
  flags: DashboardFlags;
}) {
  const router = useRouter();
  // Default ON (names visible). The toggle persists to localStorage so
  // the user's choice is remembered across reloads. The Action ("View →")
  // and Status columns were removed earlier; whole row is clickable.
  const [showNames, setShowNamesState] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(SHOW_NAMES_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === "0") setShowNamesState(false);
    else if (stored === "1") setShowNamesState(true);
  }, []);
  function setShowNames(next: boolean) {
    setShowNamesState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SHOW_NAMES_KEY, next ? "1" : "0");
    }
  }

  // Sort by ownerPayout desc, errors last
  const sorted = useMemo(() => {
    return [...properties].sort((a, b) => {
      const aOk = "totals" in a.draft ? a.draft.totals.ownerPayout : -Infinity;
      const bOk = "totals" in b.draft ? b.draft.totals.ownerPayout : -Infinity;
      return bOk - aOk;
    });
  }, [properties]);

  // Aggregate revenue across the currently-displayed (already-filtered)
  // rows. Currency follows the first property — same as the rest of the
  // page; portfolios mixing currencies are extremely rare in practice.
  const totalRevenue = useMemo(
    () =>
      sorted.reduce(
        (s, p) => s + ("totals" in p.draft ? p.draft.totals.grossRevenue : 0),
        0,
      ),
    [sorted],
  );
  const totalCurrency = sorted[0]?.currency ?? "USD";

  return (
    <div
      className="overflow-hidden rounded-2xl border border-black/[0.06]"
      style={{ background: "var(--cleaner-surface)" }}
    >
      {/* Toolbar row — count + aggregate revenue total on the left, the
          show/hide names toggle on the right. Total respects whatever
          filters are active (rows already filtered upstream). */}
      <div
        className="flex items-center justify-between gap-3 border-b border-black/[0.04] px-3 py-2"
        style={{ background: "var(--cleaner-bg)" }}
      >
        <span
          className="text-[10px] uppercase tracking-wider"
          style={{ color: "var(--cleaner-muted)", fontFamily: "var(--font-cleaner-mono)" }}
        >
          {sorted.length} {sorted.length === 1 ? "property" : "properties"}
          {totalRevenue > 0 && (
            <>
              <span className="mx-1.5 opacity-40">·</span>
              <span style={{ color: "var(--cleaner-ink)" }}>
                {fmtMoney(totalRevenue, totalCurrency)} revenue
              </span>
            </>
          )}
        </span>
        <button
          onClick={() => setShowNames(!showNames)}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] hover:bg-black/[0.04]"
          style={{ color: "var(--cleaner-muted)" }}
          aria-label={showNames ? "Hide property names" : "Show property names"}
          title={showNames ? "Hide property names" : "Show property names"}
        >
          {showNames ? (
            <>
              <ChevronsRightLeft size={12} /> Hide names
            </>
          ) : (
            <>
              <ChevronsLeftRight size={12} /> Show names
            </>
          )}
        </button>
      </div>
      {/* `table-fixed` so the name column truncates instead of pushing the
          revenue/payout columns off the right edge when names are visible.
          Widths: image+name flexes, numeric columns sized to their content. */}
      <table className="w-full text-sm table-fixed">
        <thead>
          <tr style={{ background: "var(--cleaner-bg)" }}>
            <Th>{showNames ? "Property" : ""}</Th>
            <Th align="right">Revenue</Th>
            {flags.showMgmtFee && <Th align="right">Mgmt fee</Th>}
            {flags.showPayout && <Th align="right">Your payout</Th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => {
            const totals = "totals" in p.draft ? p.draft.totals : null;
            const href = `/owner/properties/${p.propertyId}?month=${month}`;
            return (
              <tr
                key={p.propertyId}
                onClick={() => router.push(href)}
                className={`cursor-pointer transition hover:bg-black/[0.02] ${
                  i > 0 ? "border-t border-black/[0.04]" : ""
                }`}
              >
                <Td>
                  <Link
                    href={href}
                    onClick={(e) => e.stopPropagation()}
                    className="flex min-w-0 items-center gap-3"
                    style={{ fontWeight: 500 }}
                  >
                    {/* Thumbnail always renders — visual identifier when
                        names are hidden. Alt-text falls back to the
                        property name so screen-readers still know. */}
                    <span
                      className="relative block h-9 w-9 shrink-0 overflow-hidden rounded-md border border-black/[0.06]"
                      style={{ background: "var(--cleaner-bg)" }}
                      title={!showNames ? p.propertyName : undefined}
                    >
                      {p.propertyImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={upgradeAirbnbImageQuality(p.propertyImage)}
                          alt={!showNames ? p.propertyName : ""}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span
                          className="flex h-full w-full items-center justify-center"
                          style={{ color: "var(--cleaner-muted)" }}
                          title={p.propertyName}
                        >
                          <Building2 size={14} />
                        </span>
                      )}
                    </span>
                    {showNames && (
                      <span
                        className="min-w-0 flex-1 truncate hover:underline"
                        title={p.propertyName}
                      >
                        {p.propertyName}
                      </span>
                    )}
                  </Link>
                  {showNames && p.pendingApprovalCount > 0 && (
                    <span
                      className="ml-2 rounded-full px-1.5 py-0.5 text-[10px]"
                      style={{
                        background: "var(--color-amber-100,#fef3c7)",
                        color: "var(--color-amber-900,#8a4a00)",
                      }}
                    >
                      {p.pendingApprovalCount} pending
                    </span>
                  )}
                </Td>
                <Td align="right" mono muted={totals === null} nowrap>
                  {totals ? fmtMoney(totals.grossRevenue, p.currency) : "—"}
                </Td>
                {flags.showMgmtFee && (
                  <Td align="right" mono muted={totals === null} nowrap>
                    {totals ? fmtMoney(-totals.mgmtFee, p.currency) : "—"}
                  </Td>
                )}
                {flags.showPayout && (
                  <Td align="right" mono bold nowrap>
                    {totals ? fmtMoney(totals.ownerPayout, p.currency) : "—"}
                  </Td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" | "center" }) {
  return (
    <th
      className="px-3 py-2.5 text-[10px] uppercase tracking-wider sm:px-4"
      style={{
        textAlign: align,
        color: "var(--cleaner-muted)",
        fontFamily: "var(--font-cleaner-mono)",
        fontWeight: 500,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  mono,
  bold,
  muted,
  nowrap,
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
  mono?: boolean;
  bold?: boolean;
  muted?: boolean;
  /** Prevent the cell from wrapping — important for currency strings that
   *  hit two lines when negative + thousands separator combine (e.g.
   *  "-$1,233.76" was wrapping in narrow mobile columns). */
  nowrap?: boolean;
}) {
  return (
    <td
      className={`px-3 py-3 sm:px-4 ${nowrap ? "whitespace-nowrap" : ""}`}
      style={{
        textAlign: align,
        fontFamily: mono ? "var(--font-cleaner-mono)" : undefined,
        fontVariantNumeric: mono ? "tabular-nums" : undefined,
        fontWeight: bold ? 700 : undefined,
        color: muted ? "var(--cleaner-muted)" : undefined,
      }}
    >
      {children}
    </td>
  );
}

// `Badge` was retired when the Status column was dropped from ListView.
// No callers remain in this file.

// ─── Shared bits ────────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  accent,
  muted,
}: {
  label: string;
  value: string;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div>
      <div
        className="text-[10px] uppercase tracking-wider"
        style={{ color: "var(--cleaner-muted)", fontFamily: "var(--font-cleaner-mono)" }}
      >
        {label}
      </div>
      <div
        className="mt-1 text-base tabular-nums"
        style={{
          fontFamily: "var(--font-cleaner-mono)",
          fontWeight: accent ? 700 : muted ? 400 : 500,
          color: accent ? "var(--cleaner-primary)" : muted ? "var(--cleaner-muted)" : undefined,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {[1, 2].map((i) => (
        <div
          key={i}
          className="h-48 animate-pulse rounded-2xl border border-black/[0.06]"
          style={{ background: "var(--cleaner-surface)" }}
        />
      ))}
    </div>
  );
}

// Date helpers (currentMonthKey, shiftMonth) live in ./month-switcher to
// stay co-located with the only component that needs them.
