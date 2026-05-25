"use client";

// Admin Owner Overview — property split view route (Phase 3).
// Reads ownerId + propertyId from path, period from ?month=YYYY-MM.

import { use } from "react";
import type { Id } from "@convex/_generated/dataModel";
import { PropertySplitView } from "@/components/admin/owner-overview/PropertySplitView";
import { useMonthFromUrl } from "@/components/owner/use-month-from-url";

export default function AdminOwnerOverviewPropertyPage({
  params,
}: {
  params: Promise<{ ownerId: string; propertyId: string }>;
}) {
  const { ownerId, propertyId } = use(params);
  const [period, setPeriod] = useMonthFromUrl();

  return (
    <PropertySplitView
      ownerId={ownerId as Id<"users">}
      propertyId={propertyId as Id<"properties">}
      period={period}
      onPeriodChange={setPeriod}
    />
  );
}
