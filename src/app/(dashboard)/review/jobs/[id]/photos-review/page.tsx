import { ReviewPhotosReviewClient } from "@/components/review/review-photos-review-client";

export default async function ReviewJobPhotosPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ReviewPhotosReviewClient id={id} />;
}
