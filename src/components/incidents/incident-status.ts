export const INCIDENT_STATUSES = [
  "open",
  "in_progress",
  "resolved",
  "wont_fix",
] as const;

export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_TYPES = [
  "missing_item",
  "damaged_item",
  "maintenance_needed",
  "guest_issue",
  "suggestion",
  "other",
] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export const STATUS_LABELS: Record<IncidentStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  wont_fix: "Won't Fix",
};

export const STATUS_CHIP_CLASSNAMES: Record<IncidentStatus, string> = {
  open: "bg-slate-100 text-slate-700 border-slate-200",
  in_progress: "bg-amber-50 text-amber-700 border-amber-200",
  resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  wont_fix: "bg-rose-50 text-rose-700 border-rose-200",
};

export const STATUS_BAR_CLASSNAMES: Record<IncidentStatus, string> = {
  open: "bg-slate-400",
  in_progress: "bg-amber-500",
  resolved: "bg-emerald-500",
  wont_fix: "bg-rose-500",
};

export const SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const SEVERITY_DOT_CLASSNAMES: Record<IncidentSeverity, string> = {
  low: "bg-slate-400",
  medium: "bg-amber-500",
  high: "bg-orange-500",
  critical: "bg-rose-500",
};

export const SEVERITY_CHIP_CLASSNAMES: Record<IncidentSeverity, string> = {
  low: "bg-slate-100 text-slate-700 border-slate-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  high: "bg-orange-50 text-orange-700 border-orange-200",
  critical: "bg-rose-50 text-rose-700 border-rose-200",
};

export const TYPE_LABELS: Record<IncidentType, string> = {
  missing_item: "Missing Item",
  damaged_item: "Damaged Item",
  maintenance_needed: "Maintenance",
  guest_issue: "Guest Issue",
  suggestion: "Suggestion",
  other: "Other",
};

export function isTerminalStatus(status: IncidentStatus): boolean {
  return status === "resolved" || status === "wont_fix";
}

export function formatRelativeTime(ms: number, now: number = Date.now()): string {
  const diff = now - ms;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(ms).toLocaleDateString();
}
