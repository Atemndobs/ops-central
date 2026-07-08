import { CleanerIncidentDetailClient } from "@/components/cleaner/cleaner-incident-detail-client";
import type { Id } from "@convex/_generated/dataModel";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function CleanerIncidentDetailPage({ params }: Props) {
  const { id } = await params;
  return <CleanerIncidentDetailClient incidentId={id as Id<"incidents">} />;
}
