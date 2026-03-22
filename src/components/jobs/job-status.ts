export const JOB_STATUSES = [
  "scheduled",
  "assigned",
  "in_progress",
  "completed",
  "approved",
  "cancelled",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const WORKFLOW_STEPS: JobStatus[] = [
  "scheduled",
  "assigned",
  "in_progress",
  "completed",
  "approved",
];

export const STATUS_LABELS: Record<JobStatus, string> = {
  scheduled: "Scheduled",
  assigned: "Assigned",
  in_progress: "In Progress",
  completed: "Completed",
  approved: "Approved",
  cancelled: "Cancelled",
};

export const STATUS_CLASSNAMES: Record<JobStatus, string> = {
  scheduled: "bg-gray-500/15 text-gray-300 border-gray-500/40",
  assigned: "bg-blue-500/15 text-blue-300 border-blue-500/40",
  in_progress: "bg-yellow-500/15 text-yellow-300 border-yellow-500/40",
  completed: "bg-green-500/15 text-green-300 border-green-500/40",
  approved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  cancelled: "bg-red-500/15 text-red-300 border-red-500/40",
};

const NEXT_STATUS: Partial<Record<JobStatus, JobStatus>> = {
  scheduled: "assigned",
  assigned: "in_progress",
  in_progress: "completed",
  completed: "approved",
};

export function getNextStatus(status: JobStatus): JobStatus | null {
  return NEXT_STATUS[status] ?? null;
}
