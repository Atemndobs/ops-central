"use client";

/**
 * R2a — date-header overlay for portfolio/global ops tasks.
 *
 * Mirrors ScheduleCellTaskOverlay's affordances but for tasks with no
 * propertyId (`propertyId == undefined`). Renders inside the schedule's
 * date-header column for `day`.
 *
 *   ┌── MON 27 ────────────┐
 *   │                       │
 *   │  [avatars] [count] +  │
 *   └───────────────────────┘
 */

import Link from "next/link";
import { useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { TaskQuickCreateDialog } from "@/components/tasks/task-quick-create-dialog";
import {
  AssigneeAvatarStackPublic,
  deriveAvatarStackPublic,
  type CellSummary,
} from "@/components/schedule/schedule-cell-task-overlay";

const STATUS_DOT: Record<string, string> = {
  open: "bg-blue-500",
  in_progress: "bg-amber-500",
  done: "bg-emerald-500",
};

/**
 * Storage stores `anchorDate` as `Date.UTC(...)` — see
 * `convex/opsTasks/mutations.ts#startOfUtcDay`. The grid must read with the
 * same convention or `listForDateRow` misses every record.
 */
function startOfDayMs(day: Date): number {
  return Date.UTC(day.getFullYear(), day.getMonth(), day.getDate());
}

type GlobalTask = {
  _id: Id<"opsTasks">;
  title: string;
  status: "open" | "in_progress" | "done";
  priority: "low" | "normal" | "high" | "urgent";
  assignee: {
    _id: Id<"users">;
    name?: string;
    email: string;
    avatarUrl?: string | null;
  } | null;
};

export function ScheduleDateHeaderTaskOverlay({
  day,
  mineOnly = false,
  myUserId,
  summary,
}: {
  day: Date;
  /** When true, drop global tasks whose assignee !== `myUserId`. */
  mineOnly?: boolean;
  /** Required when `mineOnly` is true. Ignored otherwise. */
  myUserId?: Id<"users"> | null;
  /** Pre-computed summary for this cell from the batched range query.
   *  When provided, `listForDateRow` is deferred until the popover opens. */
  summary?: CellSummary;
}) {
  const t = useTranslations();
  const { isAuthenticated } = useConvexAuth();
  const anchorDate = startOfDayMs(day);

  const [showCreate, setShowCreate] = useState(false);
  const [showList, setShowList] = useState(false);

  const useEagerQuery = summary === undefined;
  const tasks = useQuery(
    api.opsTasks.queries.listForDateRow,
    isAuthenticated && (useEagerQuery || showList) ? { anchorDate } : "skip",
  ) as GlobalTask[] | undefined;

  const openTasks = (tasks ?? [])
    .filter((t) => t.status !== "done")
    .filter((t) =>
      mineOnly && myUserId ? t.assignee?._id === myUserId : true,
    );

  const summaryFiltered = summary
    ? mineOnly && myUserId
      ? {
          assignees: summary.assignees.filter((a) => a._id === myUserId),
          unassignedCount: 0,
          openCount: summary.assignees.some((a) => a._id === myUserId) ? 1 : 0,
        }
      : summary
    : undefined;

  const count = summaryFiltered ? summaryFiltered.openCount : openTasks.length;
  const { assignees, unassignedCount } = summaryFiltered
    ? {
        assignees: summaryFiltered.assignees,
        unassignedCount: summaryFiltered.unassignedCount > 0 ? 1 : 0,
      }
    : deriveAvatarStackPublic(openTasks);

  return (
    <>
      <div className="mt-1 flex items-center justify-end gap-1">
        {count > 0 ? (
          <AssigneeAvatarStackPublic
            assignees={assignees}
            unassignedCount={unassignedCount}
            size="sm"
            onAvatarClick={() => setShowList(true)}
            onOverflowClick={() => setShowList(true)}
          />
        ) : null}
        {count > 0 ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowList(true);
            }}
            className="rounded-full bg-[var(--primary)]/15 px-1.5 py-px text-[8px] font-bold text-[var(--primary)]"
            title={t("tasks.cellOpenCountGlobal", { count })}
          >
            {count}
          </button>
        ) : null}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowCreate(true);
          }}
          className="rounded-full p-px text-[var(--muted-foreground)] hover:bg-[var(--accent)]/60 hover:text-[var(--primary)]"
          title={t("tasks.addPortfolioTask")}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>

      {showCreate ? (
        <TaskQuickCreateDialog
          open={showCreate}
          onClose={() => setShowCreate(false)}
          prefill={{ anchorDate, lockGlobal: true }}
        />
      ) : null}

      {showList ? (
        <DateHeaderTasksPopover
          tasks={openTasks}
          onClose={() => setShowList(false)}
          anchorDate={anchorDate}
        />
      ) : null}
    </>
  );
}

function DateHeaderTasksPopover({
  tasks,
  onClose,
  anchorDate,
}: {
  tasks: GlobalTask[];
  onClose: () => void;
  anchorDate: number;
}) {
  const t = useTranslations();
  const [showCreate, setShowCreate] = useState(false);
  const dateLabel = new Date(anchorDate).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border bg-[var(--card)] p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold">{t("tasks.fields.portfolioTask")}</h3>
            <p className="text-xs text-[var(--muted-foreground)]">{dateLabel}</p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-[var(--primary)] px-2.5 py-1 text-xs font-semibold text-[var(--primary-foreground)] hover:opacity-90"
          >
            <Plus className="h-3 w-3" />
            {t("tasks.addPortfolioTask")}
          </button>
        </div>

        {tasks.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-6 text-center text-xs text-[var(--muted-foreground)]">
            {t("tasks.noTasks")}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {tasks.map((task) => (
              <li key={task._id}>
                <Link
                  href={`/tasks/${task._id}`}
                  onClick={onClose}
                  className="flex items-center justify-between gap-2 rounded-lg border bg-[var(--muted)]/15 px-2.5 py-1.5 text-sm hover:bg-[var(--accent)]/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{task.title}</p>
                    {task.assignee ? (
                      <p className="truncate text-[10px] text-[var(--muted-foreground)]">
                        {task.assignee.name ?? task.assignee.email}
                      </p>
                    ) : null}
                  </div>
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[task.status]}`}
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showCreate ? (
        <TaskQuickCreateDialog
          open={showCreate}
          onClose={() => {
            setShowCreate(false);
            onClose();
          }}
          prefill={{ anchorDate, lockGlobal: true }}
        />
      ) : null}
    </div>
  );
}
