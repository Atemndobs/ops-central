"use client";

import Link from "next/link";
import { useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Loader2, Send, Trash2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useToast } from "@/components/ui/toast-provider";
import { getErrorMessage } from "@/lib/errors";

const STATUS_TONE: Record<string, string> = {
  open: "bg-blue-100 text-blue-700 border-blue-200",
  in_progress: "bg-amber-100 text-amber-700 border-amber-200",
  done: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

const STATUSES = ["open", "in_progress", "done"] as const;

export function TaskDetailClient({ taskId }: { taskId: Id<"opsTasks"> }) {
  const t = useTranslations();
  const locale = useLocale() as "en" | "es";
  const { showToast } = useToast();
  const { isAuthenticated } = useConvexAuth();

  const task = useQuery(
    api.opsTasks.queries.getById,
    isAuthenticated ? { taskId } : "skip",
  );
  const setStatus = useMutation(api.opsTasks.mutations.setStatus);
  const addComment = useMutation(api.opsTasks.mutations.addComment);
  const deleteTask = useMutation(api.opsTasks.mutations.deleteTask);

  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  const [busy, setBusy] = useState(false);

  if (task === undefined) {
    return (
      <div className="flex min-h-64 items-center justify-center text-sm text-[var(--muted-foreground)]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("tasks.loading")}
      </div>
    );
  }
  if (task === null) {
    return (
      <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-[var(--muted-foreground)]">
        {t("tasks.notFound")}
      </div>
    );
  }

  const handleStatus = async (next: (typeof STATUSES)[number]) => {
    setBusy(true);
    try {
      await setStatus({ taskId, status: next });
      showToast(t("tasks.statusUpdated"));
    } catch (err) {
      showToast(getErrorMessage(err, t("tasks.statusFailed")), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) return;
    setPosting(true);
    try {
      await addComment({ taskId, body: comment.trim(), authoredLocale: locale });
      setComment("");
    } catch (err) {
      showToast(getErrorMessage(err, t("tasks.commentFailed")), "error");
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(t("tasks.confirmDelete"))) return;
    try {
      await deleteTask({ taskId });
      showToast(t("tasks.deleted"));
      window.location.href = "/tasks";
    } catch (err) {
      showToast(getErrorMessage(err, t("tasks.deleteFailed")), "error");
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/tasks"
          className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("tasks.backToList")}
        </Link>
        <button
          type="button"
          onClick={handleDelete}
          className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t("common.delete")}
        </button>
      </div>

      <section className="rounded-2xl border bg-[var(--card)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-extrabold tracking-tight">{task.title}</h1>
            {task.description ? (
              <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--muted-foreground)]">
                {task.description}
              </p>
            ) : null}
          </div>
          <span
            className={`rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${STATUS_TONE[task.status]}`}
          >
            {t(`tasks.status.${task.status}`)}
          </span>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-xs sm:grid-cols-4">
          <div>
            <dt className="font-semibold text-[var(--muted-foreground)]">
              {t("tasks.fields.priority")}
            </dt>
            <dd className="mt-0.5 font-bold">{t(`tasks.priority.${task.priority}`)}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted-foreground)]">
              {t("tasks.fields.anchorDate")}
            </dt>
            <dd className="mt-0.5 font-bold">
              {new Date(task.anchorDate).toLocaleDateString()}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted-foreground)]">
              {t("tasks.fields.property")}
            </dt>
            <dd className="mt-0.5 font-bold">
              {task.property?.name ?? t("tasks.fields.noProperty")}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted-foreground)]">
              {t("tasks.fields.assignee")}
            </dt>
            <dd className="mt-0.5 font-bold">
              {task.assignee?.name ?? task.assignee?.email ?? t("tasks.unassigned")}
            </dd>
          </div>
        </dl>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              disabled={busy || s === task.status}
              onClick={() => handleStatus(s)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                s === task.status
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "hover:bg-[var(--accent)]/40"
              }`}
            >
              {t(`tasks.status.${s}`)}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border bg-[var(--card)] p-5">
        <h2 className="text-base font-bold">{t("tasks.comments")}</h2>
        <ul className="mt-3 space-y-2">
          {task.comments.length === 0 ? (
            <li className="rounded-xl border border-dashed px-4 py-6 text-center text-xs text-[var(--muted-foreground)]">
              {t("tasks.noComments")}
            </li>
          ) : (
            task.comments.map((c) => (
              <li
                key={c._id}
                className="rounded-xl border bg-[var(--muted)]/15 px-3 py-2"
              >
                <div className="text-[11px] font-semibold text-[var(--muted-foreground)]">
                  {c.author?.name ?? "—"} ·{" "}
                  {new Date(c.createdAt).toLocaleString()}
                </div>
                <div className="mt-1 whitespace-pre-wrap text-sm">{c.body}</div>
              </li>
            ))
          )}
        </ul>

        <form onSubmit={handleComment} className="mt-3 flex items-end gap-2">
          <textarea
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t("tasks.commentPlaceholder")}
            className="flex-1 rounded-lg border bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
          />
          <button
            type="submit"
            disabled={posting || !comment.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-60"
          >
            {posting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {t("tasks.postComment")}
          </button>
        </form>
      </section>
    </div>
  );
}
