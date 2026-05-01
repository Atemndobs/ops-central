"use client";

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

type Task = {
  _id: string;
  title: string;
  status: "open" | "in_progress" | "done";
  priority: "low" | "normal" | "high" | "urgent";
  anchorDate: number;
  property: { name: string } | null;
  assignee: { name?: string; email: string; role: string } | null;
};

export function TaskRow({ task }: { task: Task }) {
  const t = useTranslations();
  const date = new Date(task.anchorDate);
  const dateLabel = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return (
    <div className="flex items-center justify-between gap-3 px-2 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{task.title}</p>
        <p className="truncate text-xs text-[var(--muted-foreground)]">
          {dateLabel}
          {task.property?.name ? ` · ${task.property.name}` : ""}
          {task.assignee
            ? ` · ${task.assignee.name ?? task.assignee.email}`
            : ` · ${t("tasks.unassigned")}`}
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
