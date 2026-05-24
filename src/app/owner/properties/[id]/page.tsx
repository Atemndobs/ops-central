import { OwnerPropertyClient } from "@/components/owner/owner-property-client";
import type { Id } from "@convex/_generated/dataModel";

export default async function OwnerPropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { id } = await params;
  const { month } = await searchParams;
  return (
    <OwnerPropertyClient
      propertyId={id as Id<"properties">}
      month={month}
    />
  );
}
