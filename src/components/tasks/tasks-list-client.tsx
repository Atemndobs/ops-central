"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { TaskQuickCreateDialog } from "@/components/tasks/task-quick-create-dialog";
import { TaskRow } from "@/components/tasks/task-row";

type Status = "open" | "in_progress" | "done";

const STATUS_TABS: ReadonlyArray<{ key: Status | "all"; labelKey: string }> = [
  { key: "open", labelKey: "tasks.status.open" },
  { key: "in_progress", labelKey: "tasks.status.in_progress" },
  { key: "done", labelKey: "tasks.status.done" },
  { key: "all", labelKey: "tasks.status.all" },
];

export function TasksListClient() {
  const t = useTranslations();
  const { isAuthenticated } = useConvexAuth();
  const [status, setStatus] = useState<Status | "all">("open");
  const [mineOnly, setMineOnly] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const me = useQuery(api.users.queries.getMyProfile, isAuthenticated ? {} : "skip") as
    | { _id: Id<"users">; role: string }
    | null
    | undefined;

  const args = useMemo(() => {
    const a: {
      status?: Status;
      assigneeId?: Id<"users">;
      limit: number;
    } = { limit: 300 };
    if (status !== "all") a.status = status;
    if (mineOnly && me?._id) a.assigneeId = me._id;
    return a;
  }, [status, mineOnly, me?._id]);

  const tasks = useQuery(
    api.opsTasks.queries.listAll,
    isAuthenticated ? args : "skip",
  );

  const loading = tasks === undefined;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            {t("tasks.title")}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {t("tasks.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          {t("tasks.newTask")}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border bg-[var(--card)] p-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatus(tab.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                status === tab.key
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]/40"
              }`}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>

        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border bg-[var(--card)] px-3 py-1.5 text-xs font-semibold">
          <input
            type="checkbox"
            checked={mineOnly}
            onChange={(e) => setMineOnly(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          {t("tasks.mineOnly")}
        </label>
      </div>

      <section className="rounded-2xl border bg-[var(--card)] p-3 sm:p-5">
        {loading ? (
          <div className="flex min-h-32 items-center justify-center text-sm text-[var(--muted-foreground)]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t("tasks.loading")}
          </div>
        ) : tasks.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-[var(--muted-foreground)]">
            {t("tasks.empty")}
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {tasks.map((task) => (
              <li key={task._id}>
                <Link
                  href={`/tasks/${task._id}`}
                  className="block py-1 transition hover:bg-[var(--accent)]/30"
                >
                  <TaskRow task={task} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {createOpen ? (
        <TaskQuickCreateDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
        />
      ) : null}
    </div>
  );
}
