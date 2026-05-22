import { OwnerStatementDetailClient } from "@/components/owner/owner-statement-detail-client";
import type { Id } from "@convex/_generated/dataModel";

export default async function OwnerStatementPage({
  params,
}: {
  params: Promise<{ id: string; statementId: string }>;
}) {
  const { id, statementId } = await params;
  return (
    <OwnerStatementDetailClient
      propertyId={id as Id<"properties">}
      statementId={statementId as Id<"ownerStatements">}
    />
  );
}
