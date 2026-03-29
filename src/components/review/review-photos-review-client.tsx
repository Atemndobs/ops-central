"use client";

import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ChevronRight, Loader2 } from "lucide-react";
import { JobPhotosReviewClient } from "@/components/jobs/job-photos-review-client";

export function ReviewPhotosReviewClient({ id }: { id: string }) {
  const { isAuthenticated } = useConvexAuth();
  const jobId = id as Id<"cleaningJobs">;
  const detail = useQuery(api.cleaningJobs.queries.getReviewJobDetail, isAuthenticated ? { jobId } : "skip");

  if (detail === undefined) {
    return (
      <div className="flex min-h-48 items-center justify-center text-sm text-[var(--muted-foreground)]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading photo review...
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--card)] px-4 py-12 text-center text-sm text-[var(--muted-foreground)]">
        Job not found.
      </div>
    );
  }

  const propertyName = detail.property?.name ?? "Unknown property";

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        <Link href="/review" className="hover:text-[var(--foreground)]">Review Queue</Link>
        <ChevronRight className="h-3 w-3" />
        <Link href={`/review/jobs/${jobId}`} className="hover:text-[var(--foreground)]">{propertyName}</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-[var(--foreground)]">Photos</span>
      </nav>

      <JobPhotosReviewClient id={id} />
    </div>
  );
}
