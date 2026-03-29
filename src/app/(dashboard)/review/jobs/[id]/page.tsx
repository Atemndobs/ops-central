import { ReviewJobDetailClient } from "@/components/review/review-job-detail-client";

export default async function ReviewJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ReviewJobDetailClient id={id} />;
}
