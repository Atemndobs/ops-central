import { OwnerApprovalDetailClient } from "@/components/owner/owner-approval-detail-client";
import type { Id } from "@convex/_generated/dataModel";

export default async function OwnerApprovalDetailPage({
  params,
}: {
  params: Promise<{ id: string; requestId: string }>;
}) {
  const { id, requestId } = await params;
  return (
    <OwnerApprovalDetailClient
      propertyId={id as Id<"properties">}
      requestId={requestId as Id<"maintenanceApprovalRequests">}
    />
  );
}
