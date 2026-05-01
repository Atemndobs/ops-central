"use client";

/**
 * Minimal task creation dialog for the /tasks page (and reusable elsewhere).
 *
 * v1 fields: title, description, priority, anchor date, property, assignee.
 * Linking to job/incident/conversation is supported via prefill props for
 * future call-sites (e.g. "Create related task" on a job detail page).
 */

import { useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, X } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useToast } from "@/components/ui/toast-provider";
import { getErrorMessage } from "@/lib/errors";

type Priority = "low" | "normal" | "high" | "urgent";

const PRIORITIES: ReadonlyArray<Priority> = ["low", "normal", "high", "urgent"];

export function TaskQuickCreateDialog({
  open,
  onClose,
  prefill,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  prefill?: {
    propertyId?: Id<"properties">;
    anchorDate?: number;
    jobId?: Id<"cleaningJobs">;
    incidentId?: Id<"incidents">;
    conversationId?: Id<"conversations">;
  };
  onCreated?: (taskId: Id<"opsTasks">) => void;
}) {
  const t = useTranslations();
  const locale = useLocale() as "en" | "es";
  const { showToast } = useToast();
  const { isAuthenticated } = useConvexAuth();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [propertyId, setPropertyId] = useState<Id<"properties"> | "">(
    prefill?.propertyId ?? "",
  );
  const [assigneeId, setAssigneeId] = useState<Id<"users"> | "">("");
  const [anchorDate, setAnchorDate] = useState<string>(() => {
    const d = new Date(prefill?.anchorDate ?? Date.now());
    return new Date(d.getFullYear(), d.getMonth(), d.getDate())
      .toISOString()
      .slice(0, 10);
  });
  const [submitting, setSubmitting] = useState(false);

  const properties = useQuery(
    api.properties.queries.getAll,
    isAuthenticated ? { limit: 500 } : "skip",
  );

  const opsAdmins = useQuery(
    api.users.queries.getByRole,
    isAuthenticated ? { role: "admin" } : "skip",
  );
  const opsManagers = useQuery(
    api.users.queries.getByRole,
    isAuthenticated ? { role: "manager" } : "skip",
  );
  const opsProp = useQuery(
    api.users.queries.getByRole,
    isAuthenticated ? { role: "property_ops" } : "skip",
  );
  const cleaners = useQuery(
    api.users.queries.getByRole,
    isAuthenticated ? { role: "cleaner" } : "skip",
  );

  const create = useMutation(api.opsTasks.mutations.create);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const taskId = await create({
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        anchorDate: new Date(anchorDate + "T00:00:00Z").getTime(),
        propertyId: propertyId ? (propertyId as Id<"properties">) : undefined,
        assigneeId: assigneeId ? (assigneeId as Id<"users">) : undefined,
        jobId: prefill?.jobId,
        incidentId: prefill?.incidentId,
        conversationId: prefill?.conversationId,
        authoredLocale: locale,
      });
      showToast(t("tasks.created"));
      onCreated?.(taskId);
      onClose();
    } catch (err) {
      showToast(getErrorMessage(err, t("tasks.createFailed")), "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-lg rounded-2xl border bg-[var(--card)] p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{t("tasks.newTask")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 hover:bg-[var(--accent)]/40"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-semibold">{t("tasks.fields.title")} *</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
              placeholder={t("tasks.fields.titlePlaceholder")}
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs font-semibold">{t("tasks.fields.description")}</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold">{t("tasks.fields.priority")}</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {t(`tasks.priority.${p}`)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold">{t("tasks.fields.anchorDate")}</label>
              <input
                type="date"
                required
                value={anchorDate}
                onChange={(e) => setAnchorDate(e.target.value)}
                className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold">{t("tasks.fields.property")}</label>
            <select
              value={propertyId as string}
              onChange={(e) =>
                setPropertyId((e.target.value as Id<"properties">) || "")
              }
              className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm"
            >
              <option value="">{t("tasks.fields.noProperty")}</option>
              {(properties ?? []).map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold">{t("tasks.fields.assignee")}</label>
            <select
              value={assigneeId as string}
              onChange={(e) =>
                setAssigneeId((e.target.value as Id<"users">) || "")
              }
              className="mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm"
            >
              <option value="">{t("tasks.fields.unassigned")}</option>
              <optgroup label={t("tasks.fields.opsGroup")}>
                {[...(opsAdmins ?? []), ...(opsManagers ?? []), ...(opsProp ?? [])].map(
                  (u) => (
                    <option key={u._id} value={u._id}>
                      {u.name ?? u.email} · {t(`roles.${u.role}`)}
                    </option>
                  ),
                )}
              </optgroup>
              <optgroup label={t("tasks.fields.cleanersGroup")}>
                {(cleaners ?? []).map((u) => (
                  <option key={u._id} value={u._id}>
                    {u.name ?? u.email}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border px-3 py-1.5 text-sm font-semibold hover:bg-[var(--accent)]/40"
              disabled={submitting}
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting || !title.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-4 py-1.5 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("tasks.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
