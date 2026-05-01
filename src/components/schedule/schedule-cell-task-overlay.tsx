"use client";

/**
 * Renders the per-cell ops-task affordances on the schedule grid:
 *   ┌──────────────┐
 *   │ ...job cards │
 *   │              │
 *   │   2 + ───────┤  (count badge + plus button, top-right)
 *   └──────────────┘
 *
 * Anchored to a (propertyId, day) cell. Click `+` → open quick-create.
 * Click count → open CellTasksPopover listing those tasks.
 *
 * Cell-window query: tasks where `propertyId == X && anchorDate == startOfDay(day)`.
 * Uses the lightweight `listForCell` Convex query.
 */

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { Plus, User } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { TaskQuickCreateDialog } from "@/components/tasks/task-quick-create-dialog";

type Assignee = {
  _id: Id<"users">;
  name?: string;
  email?: string;
  avatarUrl?: string | null;
};

function initialsOf(name?: string, email?: string): string {
  const src = (name && name.trim()) || email || "";
  const words = src.split(/\s+|@/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
}

function AssigneeAvatarStack({
  assignees,
  unassignedCount,
  size = "sm",
  onAvatarClick,
  onOverflowClick,
}: {
  assignees: Assignee[];
  unassignedCount: number;
  size?: "sm" | "md";
  onAvatarClick?: (id: Id<"users">) => void;
  onOverflowClick?: () => void;
}) {
  const dim = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const text = size === "sm" ? "text-[8px]" : "text-[9px]";
  const visible = assignees.slice(0, 3);
  const overflow = Math.max(0, assignees.length - 3);
  const showCount = visible.length === 3 ? overflow : 0;

  return (
    <div role="group" aria-label="Task assignees" className="pointer-events-auto flex items-center">
      {visible.map((a, i) => (
        <button
          key={a._id}
          type="button"
          title={a.name ?? a.email ?? "Assignee"}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAvatarClick?.(a._id);
          }}
          style={{ marginLeft: i === 0 ? 0 : -6, zIndex: 10 - i }}
          className={`relative inline-flex ${dim} items-center justify-center overflow-hidden rounded-full border border-white bg-[var(--primary)]/15`}
        >
          {a.avatarUrl ? (
            <Image
              src={a.avatarUrl}
              alt={a.name ?? "Assignee"}
              fill
              unoptimized
              className="object-cover"
              sizes="20px"
            />
          ) : (
            <span className={`${text} font-bold text-[var(--primary)]`}>
              {initialsOf(a.name, a.email)}
            </span>
          )}
        </button>
      ))}
      {showCount > 0 ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOverflowClick?.();
          }}
          style={{ marginLeft: -6 }}
          className={`relative inline-flex ${dim} items-center justify-center rounded-full border border-white bg-[var(--muted)] ${text} font-bold text-[var(--foreground)]`}
        >
          +{showCount}
        </button>
      ) : null}
      {unassignedCount > 0 ? (
        <span
          title={`${unassignedCount} unassigned`}
          style={{ marginLeft: assignees.length > 0 ? -6 : 0 }}
          className={`relative inline-flex ${dim} items-center justify-center rounded-full border border-dashed border-[var(--muted-foreground)] bg-[var(--background)]`}
        >
          <User className="h-2.5 w-2.5 text-[var(--muted-foreground)]" />
        </span>
      ) : null}
    </div>
  );
}

const STATUS_DOT: Record<string, string> = {
  open: "bg-blue-500",
  in_progress: "bg-amber-500",
  done: "bg-emerald-500",
};

function startOfDayMs(day: Date): number {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0).getTime();
}

export function ScheduleCellTaskOverlay({
  propertyId,
  day,
  variant = "compact",
}: {
  propertyId: Id<"properties">;
  day: Date;
  variant?: "compact" | "full";
}) {
  const t = useTranslations();
  const { isAuthenticated } = useConvexAuth();
  const anchorDate = startOfDayMs(day);

  const tasks = useQuery(
    api.opsTasks.queries.listForCell,
    isAuthenticated ? { propertyId, anchorDate } : "skip",
  );

  const [showCreate, setShowCreate] = useState(false);
  const [showList, setShowList] = useState(false);

  const openTasks = (tasks ?? []).filter((t) => t.status !== "done");
  const count = openTasks.length;
  const { assignees, unassignedCount } = deriveAvatarStack(openTasks);

  // Compact = 7-day mobile dot mode; show only count or single +
  if (variant === "compact") {
    return (
      <>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-end gap-0.5 px-0.5 py-0.5">
          {count > 0 ? (
            <AssigneeAvatarStack
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
              className="pointer-events-auto rounded-full bg-[var(--primary)]/15 px-1.5 py-px text-[8px] font-bold text-[var(--primary)]"
              title={t("tasks.cellOpenCount", { count })}
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
            className="pointer-events-auto rounded-full p-px text-[var(--muted-foreground)] hover:bg-[var(--accent)]/60 hover:text-[var(--primary)]"
            title={t("tasks.addTaskHere")}
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>

        {showCreate ? (
          <TaskQuickCreateDialog
            open={showCreate}
            onClose={() => setShowCreate(false)}
            prefill={{ propertyId, anchorDate }}
          />
        ) : null}

        {showList ? (
          <CellTasksPopover
            tasks={openTasks}
            onClose={() => setShowList(false)}
            propertyId={propertyId}
            anchorDate={anchorDate}
          />
        ) : null}
      </>
    );
  }

  // Full = day/3-day desktop with full job cards; render footer row
  return (
    <>
      <div className="mt-1 flex items-center justify-between gap-1 border-t border-dashed border-[var(--border)] pt-1">
        {count > 0 ? (
          <div className="inline-flex items-center gap-1.5">
            <AssigneeAvatarStack
              assignees={assignees}
              unassignedCount={unassignedCount}
              size="md"
              onAvatarClick={() => setShowList(true)}
              onOverflowClick={() => setShowList(true)}
            />
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowList(true);
              }}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-[var(--muted-foreground)] hover:bg-[var(--accent)]/60 hover:text-[var(--foreground)]"
            >
              <span className="inline-flex items-center gap-0.5">
                {openTasks.slice(0, 3).map((task) => (
                  <span
                    key={task._id}
                    className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[task.status] ?? STATUS_DOT.open}`}
                  />
                ))}
              </span>
              {t("tasks.cellOpenCount", { count })}
            </button>
          </div>
        ) : (
          <span className="text-[10px] text-[var(--muted-foreground)]/60">
            {t("tasks.noTasks")}
          </span>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowCreate(true);
          }}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-[var(--primary)] hover:bg-[var(--primary)]/10"
          title={t("tasks.addTaskHere")}
        >
          <Plus className="h-3 w-3" />
          {t("tasks.addTask")}
        </button>
      </div>

      {showCreate ? (
        <TaskQuickCreateDialog
          open={showCreate}
          onClose={() => setShowCreate(false)}
          prefill={{ propertyId, anchorDate }}
        />
      ) : null}

      {showList ? (
        <CellTasksPopover
          tasks={openTasks}
          onClose={() => setShowList(false)}
          propertyId={propertyId}
          anchorDate={anchorDate}
        />
      ) : null}
    </>
  );
}

type CellTask = {
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

function deriveAvatarStack(tasks: CellTask[]): {
  assignees: Assignee[];
  unassignedCount: number;
} {
  const seen = new Map<string, Assignee>();
  let unassignedCount = 0;
  for (const t of tasks) {
    if (t.status === "done") continue;
    if (!t.assignee) {
      unassignedCount += 1;
      continue;
    }
    const key = String(t.assignee._id);
    if (seen.has(key)) continue;
    seen.set(key, {
      _id: t.assignee._id,
      name: t.assignee.name,
      email: t.assignee.email,
      avatarUrl: t.assignee.avatarUrl ?? null,
    });
  }
  return {
    assignees: Array.from(seen.values()),
    unassignedCount: unassignedCount > 0 ? 1 : 0,
  };
}

function CellTasksPopover({
  tasks,
  onClose,
  propertyId,
  anchorDate,
}: {
  tasks: CellTask[];
  onClose: () => void;
  propertyId: Id<"properties">;
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
            <h3 className="text-sm font-bold">{t("tasks.cellTasksTitle")}</h3>
            <p className="text-xs text-[var(--muted-foreground)]">{dateLabel}</p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-[var(--primary)] px-2.5 py-1 text-xs font-semibold text-[var(--primary-foreground)] hover:opacity-90"
          >
            <Plus className="h-3 w-3" />
            {t("tasks.addTask")}
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
          prefill={{ propertyId, anchorDate }}
        />
      ) : null}
    </div>
  );
}
