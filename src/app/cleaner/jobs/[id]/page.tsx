import { CleanerJobDetailClient } from "@/components/cleaner/cleaner-job-detail-client";

export default async function CleanerJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CleanerJobDetailClient id={id} />;
}
