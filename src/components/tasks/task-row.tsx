"use client";

import Image from "next/image";
import { User } from "lucide-react";
import { useTranslations } from "next-intl";

const PRIORITY_TONE: Record<string, string> = {
  urgent: "bg-rose-100 text-rose-700 border-rose-200",
  high: "bg-amber-100 text-amber-700 border-amber-200",
  normal: "bg-slate-100 text-slate-700 border-slate-200",
  low: "bg-slate-50 text-slate-500 border-slate-200",
};

const STATUS_TONE: Record<string, string> = {
  open: "bg-blue-100 text-blue-700 border-blue-200",
  in_progress: "bg-amber-100 text-amber-700 border-amber-200",
  done: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

type Assignee = {
  name?: string;
  email: string;
  role: string;
  avatarUrl?: string | null;
};

type Task = {
  _id: string;
  title: string;
  status: "open" | "in_progress" | "done";
  priority: "low" | "normal" | "high" | "urgent";
  anchorDate: number;
  property: { name: string } | null;
  assignee: Assignee | null;
};

function initialsOf(name?: string, email?: string): string {
  const src = (name && name.trim()) || email || "";
  const words = src.split(/\s+|@/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
}

function AssigneeAvatar({
  assignee,
  unassignedLabel,
}: {
  assignee: Assignee | null;
  unassignedLabel: string;
}) {
  if (!assignee) {
    return (
      <span
        title={unassignedLabel}
        aria-label={unassignedLabel}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-[var(--muted-foreground)]/60 bg-[var(--background)] text-[var(--muted-foreground)]"
      >
        <User className="h-3.5 w-3.5" />
      </span>
    );
  }
  const tooltip = assignee.name ?? assignee.email;
  return (
    <span
      title={tooltip}
      aria-label={tooltip}
      className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--primary)]/15"
    >
      {assignee.avatarUrl ? (
        <Image
          src={assignee.avatarUrl}
          alt={tooltip}
          fill
          unoptimized
          sizes="28px"
          className="object-cover"
        />
      ) : (
        <span className="text-[10px] font-bold text-[var(--primary)]">
          {initialsOf(assignee.name, assignee.email)}
        </span>
      )}
    </span>
  );
}

export function TaskRow({ task }: { task: Task }) {
  const t = useTranslations();
  // anchorDate is UTC start-of-day ms (see convex/opsTasks/mutations.ts).
  // Format with `timeZone: "UTC"` so the visible date matches the day the
  // user picked, regardless of the viewer's tz.
  const dateLabel = new Date(task.anchorDate).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const unassignedLabel = t("tasks.unassigned");

  return (
    <div className="flex items-center justify-between gap-3 px-2 py-2.5">
      <AssigneeAvatar assignee={task.assignee} unassignedLabel={unassignedLabel} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{task.title}</p>
        <p className="truncate text-xs text-[var(--muted-foreground)]">
          {dateLabel}
          {task.property?.name ? ` · ${task.property.name}` : ""}
          {task.assignee
            ? ` · ${task.assignee.name ?? task.assignee.email}`
            : ` · ${unassignedLabel}`}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${PRIORITY_TONE[task.priority] ?? PRIORITY_TONE.normal}`}
        >
          {t(`tasks.priority.${task.priority}`)}
        </span>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_TONE[task.status]}`}
        >
          {t(`tasks.status.${task.status}`)}
        </span>
      </div>
    </div>
  );
}
