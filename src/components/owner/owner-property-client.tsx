"use client";

import { useState } from "react";
import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import {
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
  Globe,
  LogIn,
  LogOut,
  MapPin,
  User,
  Users,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { bucketLabel, fmtDate, fmtDateShort, fmtMoney, fmtMonth } from "./owner-format";
import { MortgageCoverageBar } from "./mortgage-coverage";
import { MonthSwitcher } from "./month-switcher";
import { useMonthFromUrl } from "./use-month-from-url";

export function OwnerPropertyClient({
  propertyId,
}: {
  propertyId: Id<"properties">;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  // URL-backed month so navigation in/out of property pages preserves
  // the period context, and back/forward navigate periods.
  const [month, setMonth] = useMonthFromUrl();
  const prop = useQuery(
    api.owner.queries.getOwnerProperty,
    isAuthenticated ? { propertyId } : "skip",
  );
  const draft = useQuery(
    api.owner.queries.getOwnerStatementDraft,
    isAuthenticated ? { propertyId, month } : "skip",
  );
  const statements = useQuery(
    api.owner.queries.listOwnerStatements,
    isAuthenticated ? { propertyId } : "skip",
  );
  const pendingApprovals = useQuery(
    api.owner.queries.listMaintenanceApprovalRequests,
    isAuthenticated ? { propertyId, status: "pending" } : "skip",
  );
  // Fetched at parent so the MonthSummary "Mortgage" card can show the
  // RAW monthly lease amount (matching the Operational Costs ledger
  // below). The fee engine's `costsByBucket.lease` is period-prorated
  // (× days/30.44) which doesn't match owner intuition of "my monthly
  // mortgage." Convex dedupes the subscription with CostsSection.
  const costItems = useQuery(
    api.owner.queries.listOwnerCostItems,
    isAuthenticated ? { propertyId } : "skip",
  );
  // Sibling list for prev/next nav — lets the owner page through every
  // property they own without bouncing back to the dashboard. Sorted by
  // name for stable, predictable ordering (independent of dashboard sort).
  const owned = useQuery(
    api.owner.queries.listOwnedProperties,
    isAuthenticated ? {} : "skip",
  );

  if (isLoading || prop === undefined) return <Skeleton />;

  const currency = prop.property.currency ?? "USD";
  // Raw monthly-lease total — what an owner sees on their rent invoice.
  // Falls back to 0 until costItems load.
  const leaseRawMonthly = (costItems ?? [])
    .filter((i) => i.bucket === "lease")
    .reduce((s, i) => s + i.amount, 0);

  // Compute prev/next sibling for in-place property navigation.
  const ordered = (owned ?? [])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const currentIdx = ordered.findIndex((p) => p._id === propertyId);
  const prevProp =
    ordered.length > 1 && currentIdx >= 0
      ? ordered[(currentIdx - 1 + ordered.length) % ordered.length]
      : null;
  const nextProp =
    ordered.length > 1 && currentIdx >= 0
      ? ordered[(currentIdx + 1) % ordered.length]
      : null;
  const showSiblingNav = ordered.length > 1;

  return (
    <div className="space-y-8">
      <div>
        {/* Back link removed — OwnerShell renders the universal back
            button at the top of the page chrome. */}
        <div className="flex items-start justify-between gap-3">
          <h1
            className="text-3xl tracking-tight"
            style={{ fontFamily: "var(--font-cleaner-display)", fontWeight: 700, letterSpacing: "-0.02em" }}
          >
            {prop.property.name}
          </h1>
          {showSiblingNav && (
            <SiblingNav
              prev={prevProp}
              next={nextProp}
              month={month}
              position={currentIdx + 1}
              total={ordered.length}
            />
          )}
        </div>
        <p
          className="mt-1 flex items-center gap-1.5 text-sm"
          style={{ color: "var(--cleaner-muted)" }}
        >
          <MapPin size={14} /> {prop.property.address}
        </p>
        <p className="mt-2 text-xs" style={{ color: "var(--cleaner-muted)" }}>
          You own{" "}
          <span style={{ fontWeight: 700, color: "var(--cleaner-ink)" }}>
            {(prop.ownership.stakePct * 100).toFixed(0)}%
          </span>{" "}
          as {prop.ownership.role}
          {prop.ownership.isPrimaryApprover && " · primary approver"}
        </p>
      </div>

      {/* Tab nav */}
      <nav className="flex gap-1 border-b" style={{ borderColor: "rgba(0,0,0,0.08)" }}>
        {/* Tabs are in-page anchors — sections are inlined below, not separate routes.
            Date Blocks IS a separate page since it's a cross-property surface. */}
        <TabLink href="#overview" active>
          Overview
        </TabLink>
        <TabLink href="#costs">Costs</TabLink>
        <TabLink href="#bookings">Bookings</TabLink>
        <TabLink href="/owner/blocks">
          <CalendarDays size={12} className="mr-1 inline" />
          Date Blocks
        </TabLink>
      </nav>

      {pendingApprovals && pendingApprovals.length > 0 && (
        <Card
          padding="p-5"
          style={{
            background: "rgba(255,189,89,0.1)",
            border: "1.5px solid rgba(255,189,89,0.5)",
          }}
        >
          <div
            className="mb-2 flex items-center gap-2 font-medium"
            style={{ color: "var(--color-amber-900,#7a4100)" }}
          >
            <Bell size={16} />
            {pendingApprovals.length} maintenance request
            {pendingApprovals.length === 1 ? "" : "s"} awaiting your approval
          </div>
          <ul className="space-y-2">
            {pendingApprovals.map((req) => (
              <li key={req._id} className="flex items-center justify-between text-sm">
                <span className="truncate" style={{ color: "var(--color-amber-950,#5a3000)" }}>
                  {req.description.slice(0, 60)}
                  {req.description.length > 60 && "…"}
                </span>
                <span className="flex items-center gap-3">
                  <span
                    className="tabular-nums"
                    style={{
                      fontFamily: "var(--font-cleaner-mono)",
                      fontWeight: 700,
                      color: "var(--color-amber-950,#5a3000)",
                    }}
                  >
                    {fmtMoney(req.proposedCost, currency)}
                  </span>
                  <Link
                    href={`/owner/properties/${propertyId}/approvals/${req._id}`}
                    className="rounded-lg px-3 py-1 text-xs font-medium text-white"
                    style={{ background: "var(--color-amber-900,#7a4100)" }}
                  >
                    Review
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {draft && (
        <Card padding="p-6">
          {/* Month switcher lives in the summary card so the period
              context is right next to the numbers it controls. Tapping
              ◀/▶ here re-runs every property query for the new period. */}
          <div className="mb-5 flex items-baseline justify-between">
            <MonthSwitcher month={month} onMonthChange={setMonth} />
          </div>
          <MonthSummary
            currency={currency}
            grossRevenue={draft.draft.totals.grossRevenue}
            ownerPayout={draft.draft.totals.ownerPayout}
            mgmtFee={draft.draft.totals.mgmtFee}
            feePct={draft.draft.totals.feePct}
            feeBase={draft.draft.totals.feeBase}
            // Admin-gated: when `owner_show_mgmt_fee` is enabled, the
            // mgmt-fee line renders inline so owners see the full
            // Gross → Mgmt fee → Payout breakdown. Default OFF — fee
            // still appears on the issued PDF & statement detail.
            showMgmtFee={prop.flags.showMgmtFee}
            // Use RAW monthly lease (matches Operational Costs ledger)
            // not engine's period-prorated value. Falls back to engine
            // value while costItems are loading.
            mortgageAmount={
              leaseRawMonthly > 0
                ? leaseRawMonthly
                : draft.draft.totals.costsByBucket.find((b) => b.bucket === "lease")
                    ?.amount ?? 0
            }
            stakePct={prop.ownership.stakePct}
          />
        </Card>
      )}

      <section id="overview" className="scroll-mt-20">
        <h2
          className="mb-3 flex items-center gap-2 text-lg"
          style={{ fontFamily: "var(--font-cleaner-display)", fontWeight: 700 }}
        >
          <FileText size={18} /> Statements
        </h2>
        {statements === undefined ? (
          <Skeleton />
        ) : statements.length === 0 ? (
          <Card padding="p-8">
            <p className="text-center text-sm" style={{ color: "var(--cleaner-muted)" }}>
              No issued statements yet. Once ChezSoiStays Ops finalizes your first month, it will appear here.
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {statements.map((s) => (
              <Link
                key={s._id}
                href={`/owner/properties/${propertyId}/statements/${s._id}`}
                className="flex items-center justify-between rounded-2xl p-4 transition"
                style={{
                  background: "var(--cleaner-surface)",
                  border: "1px solid rgba(0,0,0,0.06)",
                }}
              >
                <div>
                  <div style={{ fontWeight: 500 }}>
                    {fmtDate(s.periodStart)} – {fmtDate(s.periodEnd - 1)}
                  </div>
                  <div className="text-xs" style={{ color: "var(--cleaner-muted)" }}>
                    Issued {s.issuedAt ? fmtDate(s.issuedAt) : "—"}
                    {!s.pdfStorageId && " · PDF generating"}
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className="text-lg tabular-nums"
                    style={{
                      fontFamily: "var(--font-cleaner-mono)",
                      fontWeight: 700,
                    }}
                  >
                    {fmtMoney(s.ownerPayout, currency)}
                  </div>
                  <div
                    className="text-[10px]"
                    style={{
                      fontFamily: "var(--font-cleaner-mono)",
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "var(--cleaner-muted)",
                    }}
                  >
                    your payout
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <CostsSection propertyId={propertyId} currency={currency} />
      <BookingsSection
        propertyId={propertyId}
        currency={currency}
        month={
          draft?.month ??
          month ??
          (() => {
            const d = new Date();
            return `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1).toString().padStart(2, "0")}`;
          })()
        }
      />
    </div>
  );
}

function CostsSection({
  propertyId,
  currency,
}: {
  propertyId: Id<"properties">;
  currency: string;
}) {
  const items = useQuery(api.owner.queries.listOwnerCostItems, { propertyId });
  if (items === undefined) return <Skeleton />;

  // Group by bucket for readable rendering
  const byBucket = new Map<string, typeof items>();
  for (const it of items) {
    const list = byBucket.get(it.bucket) ?? [];
    list.push(it);
    byBucket.set(it.bucket, list);
  }
  // Sort buckets by total cost DESC (biggest expense category first) — owners
  // care about the largest line items, not alphabetical ordering. Revenue-
  // percentage items (variable, no fixed amount) sort last as a stable tail.
  const bucketTotals = new Map<string, number>();
  for (const [bucket, list] of byBucket.entries()) {
    const fixedTotal = list
      .filter((i) => i.frequency !== "revenue_percentage")
      .reduce((s, i) => s + i.amount, 0);
    bucketTotals.set(bucket, fixedTotal);
  }
  const sortedBuckets = Array.from(byBucket.keys()).sort(
    (a, b) => (bucketTotals.get(b) ?? 0) - (bucketTotals.get(a) ?? 0),
  );
  const grandTotal = Array.from(bucketTotals.values()).reduce((s, v) => s + v, 0);

  return (
    <section id="costs" className="scroll-mt-20">
      <div className="mb-3 flex items-baseline justify-between">
        <h2
          className="text-lg"
          style={{ fontFamily: "var(--font-cleaner-display)", fontWeight: 700 }}
        >
          Operational Costs
        </h2>
        {grandTotal > 0 && (
          <span
            className="text-sm tabular-nums"
            style={{
              fontFamily: "var(--font-cleaner-mono)",
              fontWeight: 700,
              color: "var(--cleaner-ink)",
            }}
          >
            {fmtMoney(grandTotal, currency)}
            <span
              className="ml-1 text-[10px] uppercase tracking-wider"
              style={{ color: "var(--cleaner-muted)", fontWeight: 400 }}
            >
              total / mo
            </span>
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <Card padding="p-8">
          <p className="text-center text-sm" style={{ color: "var(--cleaner-muted)" }}>
            No active cost items.
          </p>
        </Card>
      ) : (
        <Card padding="p-0">
          <div className="divide-y divide-black/[0.04]">
            {sortedBuckets.map((bucket) => {
              const bucketTotal = bucketTotals.get(bucket) ?? 0;
              const variableCount = byBucket
                .get(bucket)!
                .filter((i) => i.frequency === "revenue_percentage").length;
              return (
              <div key={bucket} className="p-4">
                <div className="mb-2 flex items-baseline justify-between">
                  <span
                    className="text-[10px] uppercase tracking-wider"
                    style={{ color: "var(--cleaner-muted)" }}
                  >
                    {bucketLabel(bucket)}
                  </span>
                  <span
                    className="tabular-nums text-sm"
                    style={{
                      fontFamily: "var(--font-cleaner-mono)",
                      fontWeight: 700,
                      color: "var(--cleaner-ink)",
                    }}
                  >
                    {bucketTotal > 0 ? fmtMoney(bucketTotal, currency) : "—"}
                    {variableCount > 0 && (
                      <span
                        className="ml-1 text-[10px]"
                        style={{
                          color: "var(--cleaner-muted)",
                          fontWeight: 400,
                        }}
                      >
                        + {variableCount} variable
                      </span>
                    )}
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {byBucket.get(bucket)!.map((it) => (
                    <li
                      key={it._id}
                      className="flex items-baseline justify-between text-sm"
                    >
                      <span className="flex items-center gap-2">
                        <span>{it.name}</span>
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px]"
                          style={{
                            background: "var(--cleaner-bg)",
                            color: "var(--cleaner-muted)",
                            fontFamily: "var(--font-cleaner-mono)",
                          }}
                        >
                          {it.frequency === "revenue_percentage"
                            ? `${((it.percentageRate ?? 0) * 100).toFixed(1)}% of revenue`
                            : it.frequency.replace("_", " ")}
                        </span>
                        {it.receiptCount > 0 && (
                          <span
                            className="text-[10px]"
                            style={{ color: "var(--cleaner-muted)" }}
                          >
                            · {it.receiptCount} receipt
                            {it.receiptCount === 1 ? "" : "s"}
                          </span>
                        )}
                      </span>
                      <span
                        className="tabular-nums"
                        style={{ fontFamily: "var(--font-cleaner-mono)" }}
                      >
                        {it.frequency === "revenue_percentage"
                          ? "— variable —"
                          : fmtMoney(it.amount, currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              );
            })}
          </div>
        </Card>
      )}
    </section>
  );
}

type SortKey = "checkIn" | "guests" | "total";
type SortDir = "asc" | "desc";

function BookingsSection({
  propertyId,
  currency,
  month,
}: {
  propertyId: Id<"properties">;
  currency: string;
  month: string;
}) {
  // Scope bookings to the SAME month the draft is computed for, so the
  // booking list reconciles to the headline revenue number above.
  const stays = useQuery(api.owner.queries.listOwnerStays, {
    propertyId,
    month,
  });

  // Local state for platform filter + sort
  const [platformFilter, setPlatformFilter] = useStateLazy<string | "all">("all");
  const [sortKey, setSortKey] = useStateLazy<SortKey>("checkIn");
  const [sortDir, setSortDir] = useStateLazy<SortDir>("desc");
  const [includeCancelled, setIncludeCancelled] = useStateLazy<boolean>(true);

  if (stays === undefined) return <Skeleton />;

  // Per-platform tallies (used for chip badges + filtered footer)
  const platforms = new Map<string, { count: number; total: number }>();
  for (const s of stays) {
    if (s.cancelledAt && !includeCancelled) continue;
    const key = s.platform ?? "direct";
    const cur = platforms.get(key) ?? { count: 0, total: 0 };
    cur.count += 1;
    cur.total += s.totalAmount ?? 0;
    platforms.set(key, cur);
  }
  const platformList = Array.from(platforms.entries()).sort(
    (a, b) => b[1].total - a[1].total,
  );
  const grandCount = Array.from(platforms.values()).reduce((s, p) => s + p.count, 0);
  const grandTotal = Array.from(platforms.values()).reduce((s, p) => s + p.total, 0);

  const visible = stays
    .filter((s) => (includeCancelled ? true : !s.cancelledAt))
    .filter((s) => platformFilter === "all" || (s.platform ?? "direct") === platformFilter)
    .sort((a, b) => {
      const dir = sortDir === "desc" ? -1 : 1;
      switch (sortKey) {
        case "checkIn":
          return (a.checkInAt - b.checkInAt) * dir;
        case "guests":
          return ((a.numberOfGuests ?? 0) - (b.numberOfGuests ?? 0)) * dir;
        case "total":
          return ((a.totalAmount ?? 0) - (b.totalAmount ?? 0)) * dir;
      }
    });

  const filteredCount = visible.length;
  const filteredTotal = visible.reduce((s, x) => s + (x.totalAmount ?? 0), 0);

  return (
    <section id="bookings" className="scroll-mt-20">
      <h2
        className="mb-3 flex items-center gap-2 text-lg"
        style={{ fontFamily: "var(--font-cleaner-display)", fontWeight: 700 }}
      >
        <CalendarDays size={18} /> Bookings — {fmtMonth(month)}
      </h2>

      {stays.length === 0 ? (
        <Card padding="p-8">
          <p className="text-center text-sm" style={{ color: "var(--cleaner-muted)" }}>
            No stays in {fmtMonth(month)}.
          </p>
        </Card>
      ) : (
        <Card padding="p-0">
          {/* Filter row */}
          <div className="flex flex-wrap items-center gap-2 border-b border-black/[0.04] p-3">
            <FilterChip
              active={platformFilter === "all"}
              onClick={() => setPlatformFilter("all")}
            >
              All · {grandCount}
            </FilterChip>
            {platformList.map(([name, { count, total }]) => (
              <FilterChip
                key={name}
                active={platformFilter === name}
                onClick={() => setPlatformFilter(name)}
                hint={`${count} · ${fmtMoney(total, currency)}`}
              >
                {name}
              </FilterChip>
            ))}
            <span className="ml-auto flex items-center gap-2 text-xs"
                  style={{ color: "var(--cleaner-muted)" }}>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeCancelled}
                  onChange={(e) => setIncludeCancelled(e.target.checked)}
                  className="h-3 w-3 accent-[var(--cleaner-primary)]"
                />
                include cancelled
              </label>
            </span>
          </div>

          {/* Desktop table — full layout w/ separate check-in/check-out cols.
              Hidden below md to make room for the dense mobile card layout
              that fits comfortably in the 360-402px frame. */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-left"
                  style={{ background: "var(--cleaner-bg)" }}
                >
                  <Th icon={<User size={11} />}>Guest</Th>
                  <Th icon={<Globe size={11} />}>Platform</Th>
                  <Th
                    icon={<LogIn size={11} />}
                    sortable
                    active={sortKey === "checkIn"}
                    dir={sortDir}
                    onClick={() => toggleSort("checkIn", sortKey, sortDir, setSortKey, setSortDir)}
                  >
                    Check-in
                  </Th>
                  <Th icon={<LogOut size={11} />}>Check-out</Th>
                  <Th
                    align="right"
                    icon={<Users size={11} />}
                    sortable
                    active={sortKey === "guests"}
                    dir={sortDir}
                    onClick={() => toggleSort("guests", sortKey, sortDir, setSortKey, setSortDir)}
                  >
                    Guests
                  </Th>
                  <Th
                    align="right"
                    sortable
                    active={sortKey === "total"}
                    dir={sortDir}
                    onClick={() => toggleSort("total", sortKey, sortDir, setSortKey, setSortDir)}
                  >
                    Total
                  </Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s, i) => (
                  <tr
                    key={s._id}
                    className={i > 0 ? "border-t border-black/[0.04]" : ""}
                    title={s.cancelledAt ? "Cancelled — this booking did not generate revenue" : undefined}
                    style={
                      s.cancelledAt
                        ? {
                            color: "var(--color-red-700,#b91c1c)",
                            background: "var(--color-red-50,rgba(254,226,226,0.4))",
                          }
                        : undefined
                    }
                  >
                    <Td>
                      <div className="font-medium">{s.guestName}</div>
                      {s.cancelledAt && (
                        <div
                          className="mt-0.5 text-[10px] uppercase tracking-wider"
                          style={{
                            color: "var(--color-red-700,#b91c1c)",
                            fontFamily: "var(--font-cleaner-mono)",
                          }}
                        >
                          cancelled
                        </div>
                      )}
                    </Td>
                    <Td>
                      <PlatformBadge platform={s.platform ?? "direct"} />
                    </Td>
                    <Td>{fmtDate(s.checkInAt)}</Td>
                    <Td>{fmtDate(s.checkOutAt)}</Td>
                    <Td align="right">{s.numberOfGuests ?? "—"}</Td>
                    <Td align="right" mono>
                      {s.totalAmount != null
                        ? fmtMoney(s.totalAmount, currency)
                        : "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr
                  className="border-t border-black/[0.04]"
                  style={{ background: "var(--cleaner-bg)" }}
                >
                  <Td colSpan={4}>
                    <span style={{ color: "var(--cleaner-muted)" }}>
                      {platformFilter === "all"
                        ? `All platforms · ${filteredCount} bookings`
                        : `${platformFilter} · ${filteredCount} bookings`}
                    </span>
                  </Td>
                  <Td align="right">
                    <span style={{ color: "var(--cleaner-muted)", fontSize: 11 }}>
                      subtotal
                    </span>
                  </Td>
                  <Td align="right" mono bold>
                    {fmtMoney(filteredTotal, currency)}
                  </Td>
                </tr>
                {platformFilter !== "all" && filteredTotal !== grandTotal && (
                  <tr style={{ background: "var(--cleaner-bg)" }}>
                    <Td colSpan={5}>
                      <span style={{ color: "var(--cleaner-muted)" }}>
                        Grand total (all platforms · {grandCount} bookings)
                      </span>
                    </Td>
                    <Td align="right" mono>
                      {fmtMoney(grandTotal, currency)}
                    </Td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>

          {/* Mobile compact card — 3 columns max 2 lines tall:
                COL 1 (left)   COL 2 (middle)        COL 3 (right)
                👥 N           🛬 IN  MM/DD/YY        $TOTAL
                Platform name  🛫 OUT MM/DD/YY        [cancelled]

              "Guest" word is intentionally dropped — every guest is
              literally the string "Guest" (anonymized at the source) so
              repeating it everywhere was noise. Platform name is now
              spelled out alongside the colored monogram chip so the
              chip is no longer a guessing game (user reported "A in a
              circle" was confusing). */}
          <ul className="md:hidden divide-y divide-black/[0.04]">
            {visible.map((s) => (
              <li
                key={s._id}
                className="px-3 py-3"
                title={s.cancelledAt ? "Cancelled — this booking did not generate revenue" : undefined}
                style={
                  s.cancelledAt
                    ? {
                        background: "var(--color-red-50,rgba(254,226,226,0.4))",
                        color: "var(--color-red-800,#991b1b)",
                      }
                    : undefined
                }
              >
                <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
                  {/* COL 1 — guest count + platform identifier */}
                  <div className="flex flex-col gap-1">
                    <span
                      className="inline-flex items-center gap-1 tabular-nums"
                      style={{
                        fontFamily: "var(--font-cleaner-mono)",
                        fontWeight: 700,
                        fontSize: 13,
                      }}
                    >
                      <Users size={12} className="opacity-60" />
                      {s.numberOfGuests ?? "—"}
                    </span>
                    <PlatformBadge platform={s.platform ?? "direct"} />
                  </div>

                  {/* COL 2 — stacked IN / OUT dates */}
                  <div
                    className="flex flex-col gap-0.5 text-[11px] tabular-nums"
                    style={{
                      fontFamily: "var(--font-cleaner-mono)",
                      color: s.cancelledAt
                        ? "var(--color-red-700,#b91c1c)"
                        : "var(--cleaner-ink)",
                    }}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <LogIn size={11} className="opacity-60" />
                      <span
                        style={{
                          color: "var(--cleaner-muted)",
                          fontSize: 9,
                          letterSpacing: "0.1em",
                        }}
                      >
                        IN
                      </span>
                      {fmtDateShort(s.checkInAt)}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <LogOut size={11} className="opacity-60" />
                      <span
                        style={{
                          color: "var(--cleaner-muted)",
                          fontSize: 9,
                          letterSpacing: "0.1em",
                        }}
                      >
                        OUT
                      </span>
                      {fmtDateShort(s.checkOutAt)}
                    </span>
                  </div>

                  {/* COL 3 — total + optional cancelled tag */}
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className="whitespace-nowrap tabular-nums"
                      style={{
                        fontFamily: "var(--font-cleaner-mono)",
                        fontWeight: 700,
                      }}
                    >
                      {s.totalAmount != null ? fmtMoney(s.totalAmount, currency) : "—"}
                    </span>
                    {s.cancelledAt && (
                      <span
                        className="rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider"
                        style={{
                          background: "var(--color-red-100,#fee2e2)",
                          color: "var(--color-red-800,#991b1b)",
                          fontFamily: "var(--font-cleaner-mono)",
                        }}
                      >
                        cancelled
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
            <li
              className="px-3 py-3 text-[11px]"
              style={{
                background: "var(--cleaner-bg)",
                color: "var(--cleaner-muted)",
              }}
            >
              <div className="flex items-baseline justify-between">
                <span>
                  {platformFilter === "all"
                    ? `All platforms · ${filteredCount} bookings`
                    : `${platformFilter} · ${filteredCount} bookings`}
                </span>
                <span
                  className="tabular-nums"
                  style={{ fontFamily: "var(--font-cleaner-mono)", fontWeight: 700, color: "var(--cleaner-ink)" }}
                >
                  {fmtMoney(filteredTotal, currency)}
                </span>
              </div>
              {platformFilter !== "all" && filteredTotal !== grandTotal && (
                <div className="mt-1 flex items-baseline justify-between opacity-70">
                  <span>Grand total (all · {grandCount})</span>
                  <span className="tabular-nums" style={{ fontFamily: "var(--font-cleaner-mono)" }}>
                    {fmtMoney(grandTotal, currency)}
                  </span>
                </div>
              )}
            </li>
          </ul>
        </Card>
      )}
    </section>
  );
}

function FilterChip({
  active,
  onClick,
  hint,
  children,
}: {
  active: boolean;
  onClick: () => void;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition"
      style={{
        background: active ? "var(--cleaner-primary)" : "transparent",
        color: active ? "white" : "var(--cleaner-ink)",
        borderColor: active ? "var(--cleaner-primary)" : "rgba(0,0,0,0.1)",
        fontFamily: "var(--font-cleaner-mono)",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      <span>{children}</span>
      {hint && (
        <span
          style={{
            color: active ? "rgba(255,255,255,0.85)" : "var(--cleaner-muted)",
            fontSize: 10,
          }}
        >
          {hint}
        </span>
      )}
    </button>
  );
}

function Th({
  children,
  align = "left",
  sortable,
  active,
  dir,
  onClick,
  icon,
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  active?: boolean;
  dir?: SortDir;
  onClick?: () => void;
  /** Optional lucide icon rendered before the label for visual scanning. */
  icon?: React.ReactNode;
}) {
  return (
    <th
      className={`px-3 py-2 text-[10px] uppercase tracking-wider ${sortable ? "cursor-pointer select-none" : ""}`}
      onClick={onClick}
      style={{
        textAlign: align,
        color: "var(--cleaner-muted)",
        fontFamily: "var(--font-cleaner-mono)",
        fontWeight: 500,
      }}
    >
      <span
        className="inline-flex items-center gap-1"
        style={align === "right" ? { float: "right" } : undefined}
      >
        {icon}
        {children}
        {sortable && active && (
          <span style={{ fontSize: 9 }}>{dir === "desc" ? "▼" : "▲"}</span>
        )}
      </span>
    </th>
  );
}

/**
 * Compact platform identifier — colored monogram chip + optional name. On
 * mobile (`compact`) the name is hidden so the chip alone communicates
 * platform identity in tight space.
 */
function PlatformBadge({ platform, compact }: { platform: string; compact?: boolean }) {
  const meta = platformMeta(platform);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-1 py-0.5 text-[10px] uppercase tracking-wider"
      style={{
        color: "var(--cleaner-muted)",
        fontFamily: "var(--font-cleaner-mono)",
      }}
    >
      <span
        aria-hidden
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
        style={{ background: meta.color }}
        title={platform}
      >
        {meta.glyph}
      </span>
      {!compact && <span>{platform}</span>}
    </span>
  );
}

function platformMeta(platform: string): { color: string; glyph: string } {
  const key = platform.toLowerCase();
  if (key.includes("airbnb")) return { color: "#FF5A5F", glyph: "A" };
  if (key.includes("vrbo")) return { color: "#245ABC", glyph: "V" };
  if (key.includes("booking")) return { color: "#003580", glyph: "B" };
  if (key.includes("direct")) return { color: "var(--cleaner-primary)", glyph: "•" };
  return { color: "var(--cleaner-muted)", glyph: platform.charAt(0).toUpperCase() || "?" };
}

function Td({
  children,
  align = "left",
  mono,
  bold,
  colSpan,
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
  mono?: boolean;
  bold?: boolean;
  colSpan?: number;
}) {
  return (
    <td
      className="px-3 py-2.5"
      colSpan={colSpan}
      style={{
        textAlign: align,
        fontFamily: mono ? "var(--font-cleaner-mono)" : undefined,
        fontVariantNumeric: mono ? "tabular-nums" : undefined,
        fontWeight: bold ? 700 : undefined,
      }}
    >
      {children}
    </td>
  );
}

function toggleSort(
  clicked: SortKey,
  currentKey: SortKey,
  currentDir: SortDir,
  setKey: (k: SortKey) => void,
  setDir: (d: SortDir) => void,
): void {
  if (clicked === currentKey) {
    setDir(currentDir === "desc" ? "asc" : "desc");
  } else {
    setKey(clicked);
    setDir(clicked === "checkIn" ? "desc" : "desc");
  }
}

/** Tiny alias for local consistency with the other Section helpers. */
function useStateLazy<T>(initial: T) {
  return useState<T>(initial);
}

/**
 * Compact prev / "n of N" / next nav for paging through every property the
 * owner holds without bouncing back to the dashboard. Wraps around — past
 * the last property goes to the first. Preserves the current `?month=` so
 * the period context follows the user across siblings.
 *
 * Hidden when the owner only holds one property (caller passes <=1 total).
 */
function SiblingNav({
  prev,
  next,
  month,
  position,
  total,
}: {
  prev: { _id: Id<"properties">; name: string } | null;
  next: { _id: Id<"properties">; name: string } | null;
  month: string;
  position: number;
  total: number;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-0.5 rounded-full border border-black/[0.06] p-0.5 text-xs"
      style={{ background: "var(--cleaner-surface)" }}
    >
      {prev && (
        <Link
          href={`/owner/properties/${prev._id}?month=${month}`}
          className="flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-black/[0.04]"
          aria-label={`Previous property: ${prev.name}`}
          title={prev.name}
          style={{ color: "var(--cleaner-muted)" }}
        >
          <ChevronLeft size={14} />
        </Link>
      )}
      <span
        className="px-2 tabular-nums"
        style={{
          fontFamily: "var(--font-cleaner-mono)",
          color: "var(--cleaner-muted)",
          letterSpacing: "0.04em",
        }}
      >
        {position} <span className="opacity-60">/ {total}</span>
      </span>
      {next && (
        <Link
          href={`/owner/properties/${next._id}?month=${month}`}
          className="flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-black/[0.04]"
          aria-label={`Next property: ${next.name}`}
          title={next.name}
          style={{ color: "var(--cleaner-muted)" }}
        >
          <ChevronRight size={14} />
        </Link>
      )}
    </div>
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="px-3 py-2 text-sm transition"
      style={{
        color: active ? "var(--cleaner-ink)" : "var(--cleaner-muted)",
        borderBottom: active ? "2px solid var(--cleaner-primary)" : "2px solid transparent",
        fontWeight: active ? 600 : 400,
        marginBottom: "-1px",
      }}
    >
      {children}
    </Link>
  );
}

/**
 * Three core stats owner sees on the property landing — gross, payout, and
 * the mortgage indicator. Management fee is intentionally HIDDEN here
 * (it's a J&A-internal concept; owners see it on the breakdown drilldown
 * later). Mortgage indicator uses GROSS REVENUE vs lease obligation
 * because that matches owner mental model: "the first thing we pay out
 * of revenue is the mortgage."
 */
function MonthSummary({
  currency,
  grossRevenue,
  ownerPayout,
  mgmtFee,
  feePct,
  feeBase,
  showMgmtFee,
  mortgageAmount,
  stakePct,
}: {
  currency: string;
  grossRevenue: number;
  ownerPayout: number;
  mgmtFee: number;
  feePct: number;
  feeBase: string;
  /** Admin-gated via `owner_show_mgmt_fee` feature flag. */
  showMgmtFee: boolean;
  /** Total lease/mortgage for the property in the period (J&A-side, full). */
  mortgageAmount: number;
  /** Owner's stake — used to scale both their payout/mortgage share. */
  stakePct: number;
}) {
  const myMortgage = mortgageAmount * stakePct;
  // Grid scales to 4 columns when the mgmt-fee tile is visible — keeps the
  // visual rhythm so "Your payout" stays the rightmost emphasized number.
  const cols = showMgmtFee ? "md:grid-cols-4" : "md:grid-cols-3";
  return (
    <div className={`grid grid-cols-1 gap-4 ${cols}`}>
      <Stat label="Gross revenue" value={fmtMoney(grossRevenue, currency)} />
      {showMgmtFee && (
        <Stat
          label="Mgmt fee"
          value={fmtMoney(-mgmtFee * stakePct, currency)}
          subtitle={`${(feePct * 100).toFixed(1)}% × ${feeBase}`}
        />
      )}
      <Stat
        label="Your payout"
        value={fmtMoney(ownerPayout * stakePct, currency)}
        accent
      />
      {myMortgage > 0 ? (
        <MortgageCoverageBar
          currency={currency}
          obligation={myMortgage}
          grossRevenue={grossRevenue * stakePct}
          variant="roomy"
        />
      ) : (
        <Stat label="Mortgage" value="—" />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  subtitle,
  accent,
}: {
  label: string;
  value: string;
  subtitle?: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div
        className="text-[10px]"
        style={{
          fontFamily: "var(--font-cleaner-mono)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--cleaner-muted)",
        }}
      >
        {label}
      </div>
      <div
        className="mt-1 text-xl tabular-nums"
        style={{
          fontFamily: "var(--font-cleaner-mono)",
          fontWeight: accent ? 700 : 400,
          color: accent ? "var(--cleaner-primary)" : "var(--cleaner-ink)",
        }}
      >
        {value}
      </div>
      {subtitle && (
        <div
          className="mt-0.5 text-[10px]"
          style={{
            fontFamily: "var(--font-cleaner-mono)",
            color: "var(--cleaner-muted)",
          }}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
}

function Card({
  children,
  padding = "p-6",
  style,
}: {
  children: React.ReactNode;
  padding?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`rounded-3xl ${padding}`}
      style={{
        background: "var(--cleaner-surface)",
        boxShadow: "var(--cleaner-shadow)",
        border: "1px solid rgba(0,0,0,0.06)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Skeleton() {
  return (
    <div
      className="h-64 animate-pulse rounded-3xl"
      style={{ background: "var(--cleaner-surface)" }}
    />
  );
}

// (currentMonthLocal moved to ./month-switcher as currentMonthKey.)
