import { CleanerPropertyDetailClient } from "@/components/cleaner/cleaner-property-detail-client";

export default async function CleanerPropertyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CleanerPropertyDetailClient id={id} />;
}
