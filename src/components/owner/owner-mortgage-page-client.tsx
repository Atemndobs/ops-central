"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { MapPin } from "lucide-react";
import { fmtMonth } from "./owner-format";
import { MonthSwitcher } from "./month-switcher";
import { useMonthFromUrl } from "./use-month-from-url";
import { OwnerMortgageCoverCard } from "./owner-mortgage-cover-card";

/**
 * Drill-in detail page for a property's mortgage / lease coverage. The
 * summary card on /owner/properties/:id shows a compact bar; clicking it
 * lands here for the full pitch surface: milestone marker, 12-month
 * coverage strip, streak, projected total, trailing-12 avg buffer.
 *
 * Reuses `OwnerMortgageCoverCard` (built in PR #116) which was orphaned —
 * this wires it into the route tree so it actually renders.
 */
export function OwnerMortgagePageClient({
  propertyId,
}: {
  propertyId: Id<"properties">;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [month, setMonth] = useMonthFromUrl();
  const prop = useQuery(
    api.owner.queries.getOwnerProperty,
    isAuthenticated ? { propertyId } : "skip",
  );

  if (isLoading || prop === undefined) {
    return (
      <div
        className="h-96 animate-pulse rounded-3xl"
        style={{ background: "var(--cleaner-surface)" }}
      />
    );
  }

  const currency = prop.property.currency ?? "USD";

  return (
    <div className="space-y-6">
      <div>
        <h1
          className="text-3xl tracking-tight"
          style={{
            fontFamily: "var(--font-cleaner-display)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
          }}
        >
          Mortgage coverage
        </h1>
        <p
          className="mt-1 flex items-center gap-1.5 text-sm"
          style={{ color: "var(--cleaner-muted)" }}
        >
          <MapPin size={14} /> {prop.property.name} · {fmtMonth(month)}
        </p>
      </div>

      <div className="rounded-2xl border border-black/[0.06] bg-[var(--cleaner-surface)] p-4">
        <MonthSwitcher month={month} onMonthChange={setMonth} />
      </div>

      <OwnerMortgageCoverCard
        propertyId={propertyId}
        currency={currency}
        month={month}
      />
    </div>
  );
}
