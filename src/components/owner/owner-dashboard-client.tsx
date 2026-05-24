"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import {
  ArrowRight,
  Bell,
  Building2,
  FileText,
  Filter,
  LayoutGrid,
  MapPin,
  Rows3,
  X,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import { fmtMoney, fmtMonth } from "./owner-format";
import { MonthSwitcher } from "./month-switcher";
import { useMonthFromUrl } from "./use-month-from-url";
import { SearchableSelect } from "@/components/ui/searchable-select";

/**
 * Owner dashboard. Two view modes (card / list) — list scales to 30+
 * properties; card is the YC-demo aesthetic. Month picker lets the
 * owner page through history (already-issued statements) or peek
 * ahead at next month's draft.
 */
export function OwnerDashboardClient() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [viewMode, setViewMode] = useState<"card" | "list">("card");
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
      />
    </div>
  );
}

// ─── Filter / sort / group orchestration ───────────────────────────────────

function FilteredPortfolio({
  properties,
  selectedCities,
  selectedStates,
  sortKey,
  groupBy,
  viewMode,
  month,
}: {
  properties: PropertyRow[];
  selectedCities: Set<string>;
  selectedStates: Set<string>;
  sortKey: SortKey;
  groupBy: GroupBy;
  viewMode: "card" | "list";
  month: string;
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
      <CardView properties={filteredAndSorted} month={month} />
    ) : (
      <ListView properties={filteredAndSorted} month={month} />
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
              <CardView properties={rows} month={month} />
            ) : (
              <ListView properties={rows} month={month} />
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

function CardView({ properties, month }: { properties: PropertyRow[]; month: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {properties.map((p) => (
        <PropertyCard key={p.propertyId} p={p} month={month} />
      ))}
    </div>
  );
}

function PropertyCard({ p, month }: { p: PropertyRow; month: string }) {
  const totals = "totals" in p.draft ? p.draft.totals : null;
  const hasError = totals === null;
  const isPaid = p.issuedStatementId !== null;

  return (
    <Link
      href={`/owner/properties/${p.propertyId}?month=${month}`}
      className="group relative flex flex-col gap-4 rounded-2xl border border-black/[0.06] p-6 transition hover:border-[var(--cleaner-primary)]/40 hover:shadow-sm"
      style={{ background: "var(--cleaner-surface)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2
            className="text-xl tracking-tight"
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
        {p.pendingApprovalCount > 0 && (
          <Link
            href={`/owner/properties/${p.propertyId}/approvals`}
            className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs"
            style={{
              background: "var(--color-amber-100,#fef3c7)",
              color: "var(--color-amber-900,#8a4a00)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <Bell size={12} />
            {p.pendingApprovalCount} pending
          </Link>
        )}
      </div>

      {hasError ? (
        <p className="text-sm italic" style={{ color: "var(--cleaner-muted)" }}>
          Live preview unavailable — {(p.draft as { error: string }).error}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4 border-t border-black/[0.04] pt-4">
            <Stat label="Gross" value={fmtMoney(totals!.grossRevenue, p.currency)} muted />
            <Stat label="Mgmt fee" value={fmtMoney(-totals!.mgmtFee, p.currency)} muted />
            <Stat
              label={isPaid ? "Paid out" : "Your payout"}
              value={fmtMoney(totals!.ownerPayout, p.currency)}
              accent
            />
          </div>
          {/* Mortgage progress mini-card — at-a-glance "did this property
              clear its rent/mortgage this month?". Hidden when no lease
              obligation is configured (e.g. owned outright). Uses
              ownerPayout (post-mgmt-fee, i.e. what the owner actually
              keeps) vs the raw monthly lease, so the bar fills only when
              the owner's net actually covers the obligation. */}
          {p.leaseRawMonthly > 0 && (
            <MortgageMiniBar
              currency={p.currency}
              obligation={p.leaseRawMonthly}
              progress={Math.max(0, totals!.ownerPayout)}
            />
          )}
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

function ListView({ properties, month }: { properties: PropertyRow[]; month: string }) {
  // Sort by ownerPayout desc, errors last
  const sorted = useMemo(() => {
    return [...properties].sort((a, b) => {
      const aOk = "totals" in a.draft ? a.draft.totals.ownerPayout : -Infinity;
      const bOk = "totals" in b.draft ? b.draft.totals.ownerPayout : -Infinity;
      return bOk - aOk;
    });
  }, [properties]);

  return (
    <div
      className="overflow-hidden rounded-2xl border border-black/[0.06]"
      style={{ background: "var(--cleaner-surface)" }}
    >
      <table className="w-full text-sm">
        <thead>
          <tr style={{ background: "var(--cleaner-bg)" }}>
            <Th>Property</Th>
            <Th align="right">Gross</Th>
            <Th align="right">Mgmt fee</Th>
            <Th align="right">Your payout</Th>
            <Th align="center">Status</Th>
            <Th align="center">Action</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => {
            const totals = "totals" in p.draft ? p.draft.totals : null;
            return (
              <tr
                key={p.propertyId}
                className={i > 0 ? "border-t border-black/[0.04]" : ""}
              >
                <Td>
                  <Link
                    href={`/owner/properties/${p.propertyId}?month=${month}`}
                    className="hover:underline"
                    style={{ fontWeight: 500 }}
                  >
                    {p.propertyName}
                  </Link>
                  {p.pendingApprovalCount > 0 && (
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
                <Td align="right" mono muted={totals === null}>
                  {totals ? fmtMoney(totals.grossRevenue, p.currency) : "—"}
                </Td>
                <Td align="right" mono muted={totals === null}>
                  {totals ? fmtMoney(-totals.mgmtFee, p.currency) : "—"}
                </Td>
                <Td align="right" mono bold>
                  {totals ? fmtMoney(totals.ownerPayout, p.currency) : "—"}
                </Td>
                <Td align="center">
                  {totals === null ? (
                    <Badge tone="error">error</Badge>
                  ) : p.issuedStatementId ? (
                    <Badge tone="success">paid out</Badge>
                  ) : (
                    <Badge tone="info">in progress</Badge>
                  )}
                </Td>
                <Td align="center">
                  <Link
                    href={`/owner/properties/${p.propertyId}?month=${month}`}
                    className="text-xs hover:underline"
                    style={{ color: "var(--cleaner-primary)" }}
                  >
                    View →
                  </Link>
                </Td>
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
      className="px-4 py-2.5 text-[10px] uppercase tracking-wider"
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
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
  mono?: boolean;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className="px-4 py-3"
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

/**
 * Compact horizontal progress bar showing payout-vs-mortgage coverage.
 * Three visual states:
 *   - covered (green ✓):    progress ≥ obligation
 *   - partial (amber bar):  0 < progress < obligation
 *   - empty (gray):         no revenue this period
 *
 * Mirrors the larger MortgageIndicator on the per-property page but
 * trimmed to fit two extra lines inside a dashboard card.
 */
function MortgageMiniBar({
  currency,
  obligation,
  progress,
}: {
  currency: string;
  obligation: number;
  progress: number;
}) {
  const ratio = obligation > 0 ? progress / obligation : 0;
  const pct = Math.min(100, Math.max(0, ratio * 100));
  const covered = ratio >= 1.0;
  const color = covered
    ? "rgb(34,197,94)"
    : ratio > 0
      ? "rgb(245,158,11)"
      : "rgba(0,0,0,0.15)";
  return (
    <div className="rounded-lg border border-black/[0.04] p-3"
         style={{ background: "var(--cleaner-bg)" }}>
      <div
        className="flex items-baseline justify-between text-[10px]"
        style={{
          fontFamily: "var(--font-cleaner-mono)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--cleaner-muted)",
        }}
      >
        <span>Mortgage</span>
        {covered ? (
          <span
            style={{
              color: "rgb(21,128,61)",
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "none",
            }}
          >
            Covered ✓
          </span>
        ) : (
          <span
            style={{
              color: "var(--cleaner-ink)",
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "none",
            }}
          >
            {Math.round(pct)}%
          </span>
        )}
      </div>
      <div
        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full"
        style={{ background: "rgba(0,0,0,0.06)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <div
        className="mt-1 text-[10px] tabular-nums"
        style={{
          fontFamily: "var(--font-cleaner-mono)",
          color: "var(--cleaner-muted)",
        }}
      >
        {fmtMoney(Math.min(progress, obligation), currency)} /{" "}
        {fmtMoney(obligation, currency)}
      </div>
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "info" | "success" | "error" }) {
  const palette = {
    info: { bg: "rgba(155,81,224,0.12)", fg: "var(--cleaner-primary)" },
    success: { bg: "rgba(34,197,94,0.12)", fg: "rgb(21,128,61)" },
    error: { bg: "rgba(239,68,68,0.12)", fg: "rgb(153,27,27)" },
  }[tone];
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px]"
      style={{
        background: palette.bg,
        color: palette.fg,
        fontFamily: "var(--font-cleaner-mono)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
  );
}

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
