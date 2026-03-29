"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { JobPhotosReviewClient } from "@/components/jobs/job-photos-review-client";

export function ReviewPhotosReviewClient({ id }: { id: string }) {
  const jobId = id as Id<"cleaningJobs">;
  const detail = useQuery(api.cleaningJobs.queries.getReviewJobDetail, { jobId });

  if (detail === undefined) {
    return <p className="text-sm text-[var(--muted-foreground)]">Loading photo review...</p>;
  }

  if (!detail) {
    return <p className="text-sm text-[var(--muted-foreground)]">Job not found.</p>;
  }

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-[var(--border)] bg-[var(--card)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Reviewer Photo Audit</p>
            <h2 className="text-base font-semibold">{detail.property?.name ?? "Unknown property"}</h2>
          </div>
          <Link href={`/review/jobs/${jobId}`} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs">
            Back to Job Review
          </Link>
        </div>
      </section>

      <JobPhotosReviewClient id={id} />
    </div>
  );
}
