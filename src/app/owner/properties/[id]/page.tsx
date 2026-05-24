import { OwnerPropertyClient } from "@/components/owner/owner-property-client";
import type { Id } from "@convex/_generated/dataModel";

export default async function OwnerPropertyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Month is read client-side from `?month=...` via useMonthFromUrl so the
  // switcher can update the URL without a server round-trip.
  return <OwnerPropertyClient propertyId={id as Id<"properties">} />;
}
