export const JOB_STATUSES = [
  "scheduled",
  "assigned",
  "in_progress",
  "awaiting_approval",
  "rework_required",
  "completed",
  "cancelled",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const WORKFLOW_STEPS: JobStatus[] = [
  "scheduled",
  "assigned",
  "in_progress",
  "awaiting_approval",
  "completed",
];

export const STATUS_LABELS: Record<JobStatus, string> = {
  scheduled: "Scheduled",
  assigned: "Assigned",
  in_progress: "In Progress",
  awaiting_approval: "Awaiting Approval",
  rework_required: "Rework Required",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const STATUS_CLASSNAMES: Record<JobStatus, string> = {
  scheduled: "bg-slate-100 text-slate-700 border-slate-200",
  assigned: "bg-blue-50 text-blue-700 border-blue-200",
  in_progress: "bg-amber-50 text-amber-700 border-amber-200",
  awaiting_approval: "bg-indigo-50 text-indigo-700 border-indigo-200",
  rework_required: "bg-orange-50 text-orange-700 border-orange-200",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-rose-50 text-rose-700 border-rose-200",
};

const NEXT_STATUS: Partial<Record<JobStatus, JobStatus>> = {
  scheduled: "assigned",
  assigned: "in_progress",
  in_progress: "awaiting_approval",
  awaiting_approval: "completed",
  rework_required: "in_progress",
};

export function getNextStatus(status: JobStatus): JobStatus | null {
  return NEXT_STATUS[status] ?? null;
}

const PHOTO_REVIEW_STATUSES: JobStatus[] = [
  "in_progress",
  "awaiting_approval",
  "rework_required",
  "completed",
];

export function canAccessJobPhotoReview(status: JobStatus): boolean {
  return PHOTO_REVIEW_STATUSES.includes(status);
}

export function canReturnJobToRework(status: JobStatus): boolean {
  return status === "awaiting_approval";
}

export function getJobPhotoReviewActionLabel(status: JobStatus): string {
  return status === "completed" ? "View Photos" : "Review";
}
