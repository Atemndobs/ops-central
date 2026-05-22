import { OwnerPropertyClient } from "@/components/owner/owner-property-client";
import type { Id } from "@convex/_generated/dataModel";

export default async function OwnerPropertyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OwnerPropertyClient propertyId={id as Id<"properties">} />;
}
