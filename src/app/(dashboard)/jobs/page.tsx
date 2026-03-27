import { JobsPageClient } from "@/components/jobs/jobs-page-client";
import { JOB_STATUSES, type JobStatus } from "@/components/jobs/job-status";

type JobsPageProps = {
  searchParams: Promise<{
    status?: string;
  }>;
};

export default async function JobsPage({ searchParams }: JobsPageProps) {
  const { status } = await searchParams;
  const initialStatus = parseStatusFilter(status);

  return <JobsPageClient key={initialStatus} initialStatus={initialStatus} />;
}

function parseStatusFilter(value?: string): JobStatus | "all" {
  if (!value) {
    return "all";
  }
  return JOB_STATUSES.includes(value as JobStatus) ? (value as JobStatus) : "all";
}
