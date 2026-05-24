import { OwnerMortgagePageClient } from "@/components/owner/owner-mortgage-page-client";
import type { Id } from "@convex/_generated/dataModel";

/**
 * Mortgage-coverage detail page. Reached by clicking the mortgage progress
 * bar on the property summary card. Month is read client-side from
 * `?month=...` via useMonthFromUrl so the switcher updates the URL
 * without a server round-trip.
 */
export default async function OwnerPropertyMortgagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OwnerMortgagePageClient propertyId={id as Id<"properties">} />;
}
