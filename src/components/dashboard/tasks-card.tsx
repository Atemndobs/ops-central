"use client";

/**
 * Dashboard Tasks card — replaces the M0 placeholder.
 *
 * Layout per Docs/ops-tasks-and-handover/open-questions.md OQ-8:
 *   ┌── Tasks ────────── New ─┐
 *   │ My open: 7 · …          │
 *   │ • top 3 by priority/age │
 *   │ View all · Hand off     │
 *   └─────────────────────────┘
 *
 * Handover counters and "Hand off shift" CTA wire up in M2; in M1 we render
 * the slot but disabled.
 */

import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { ClipboardList, Loader2 } from "lucide-react";
import { api } from "@convex/_generated/api";

const PRIORITY_RANK: Record<string, number> = {
  urgent: 4,
  high: 3,
  normal: 2,
  low: 1,
};

const PRIORITY_TONE: Record<string, string> = {
  urgent: "bg-rose-100 text-rose-700 border-rose-200",
  high: "bg-amber-100 text-amber-700 border-amber-200",
  normal: "bg-slate-100 text-slate-700 border-slate-200",
  low: "bg-slate-50 text-slate-500 border-slate-200",
};

function ageTier(anchorDate: number, now: number): "calm" | "soon" | "urgent" {
  const days = Math.max(0, (now - anchorDate) / 86_400_000);
  if (days < 2) return "calm";
  if (days < 5) return "soon";
  return "urgent";
}

const TIER_TONE: Record<string, string> = {
  calm: "text-emerald-600",
  soon: "text-amber-600",
  urgent: "text-rose-600",
};

export function TasksCard() {
  const t = useTranslations();
  const { isAuthenticated } = useConvexAuth();

  const counts = useQuery(
    api.opsTasks.queries.countOpenForUser,
    isAuthenticated ? {} : "skip",
  );
  const myTasks = useQuery(
    api.opsTasks.queries.listForAssignee,
    isAuthenticated ? { status: "open", limit: 50 } : "skip",
  );

  const loading = counts === undefined || myTasks === undefined;

  const top3 = (myTasks ?? [])
    .slice()
    .sort((a, b) => {
      const pr = (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0);
      if (pr !== 0) return pr;
      return (a.anchorDate ?? 0) - (b.anchorDate ?? 0); // older first
    })
    .slice(0, 3);

  const now = Date.now();

  return (
    <section className="rounded-2xl border bg-[var(--card)] p-3 sm:p-5 xl:col-span-4">
      <div className="mb-3 flex items-center justify-between sm:mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold sm:text-lg">{t("dashboard.tasks")}</h2>
        </div>
        <Link
          href="/tasks"
          className="text-xs font-semibold text-[var(--primary)] hover:underline"
        >
          {t("dashboard.viewAllTasks")}
        </Link>
      </div>

      {loading ? (
        <div className="flex min-h-32 items-center justify-center text-sm text-[var(--muted-foreground)]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t("dashboard.loadingTasks")}
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-baseline gap-3 text-sm">
            <span className="font-semibold">
              {t("dashboard.myOpen")}:{" "}
              <span className="text-lg font-extrabold">{counts?.open ?? 0}</span>
            </span>
            <span className="text-[var(--muted-foreground)]">
              · {t("dashboard.inProgress")}: {counts?.inProgress ?? 0}
            </span>
          </div>

          {top3.length === 0 ? (
            <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-[var(--muted-foreground)]">
              <ClipboardList className="mx-auto mb-2 h-5 w-5 opacity-50" />
              {t("dashboard.noOpenTasks")}
            </div>
          ) : (
            <ul className="space-y-2">
              {top3.map((task) => {
                const tier = ageTier(task.anchorDate, now);
                return (
                  <li key={task._id}>
                    <Link
                      href={`/tasks/${task._id}`}
                      className="flex items-start justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--muted)]/15 px-3 py-2 transition hover:border-[var(--primary)]/40 hover:bg-[var(--accent)]/40"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{task.title}</p>
                        {task.property?.name ? (
                          <p className="truncate text-xs text-[var(--muted-foreground)]">
                            {task.property.name}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${PRIORITY_TONE[task.priority] ?? PRIORITY_TONE.normal}`}
                        >
                          {t(`tasks.priority.${task.priority}`)}
                        </span>
                        <span
                          className={`text-[10px] font-semibold ${TIER_TONE[tier]}`}
                        >
                          {t(`tasks.age.${tier}`)}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-3 flex items-center justify-between gap-2 text-xs">
            <Link
              href="/tasks?assignee=me&status=open"
              className="font-semibold text-[var(--primary)] hover:underline"
            >
              {t("dashboard.viewAllTasks")}
            </Link>
            {/* M2: handover dialog trigger */}
            <button
              type="button"
              disabled
              className="cursor-not-allowed rounded-md border border-dashed border-[var(--border)] px-2 py-1 text-[var(--muted-foreground)]"
              title={t("dashboard.handoverComingSoon")}
            >
              {t("dashboard.handOffShift")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
