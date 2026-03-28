import { JobPhotosReviewClient } from "@/components/jobs/job-photos-review-client";

export default async function JobPhotosReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <JobPhotosReviewClient id={id} />;
}
