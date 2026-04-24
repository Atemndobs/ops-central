"use client";

import { FormEvent, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useToast } from "@/components/ui/toast-provider";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { getErrorMessage } from "@/lib/errors";

type Option = {
  id: string;
  name: string;
};

type CreateJobModalProps = {
  open: boolean;
  onClose: () => void;
  propertyOptions: Option[];
  cleanerOptions: Option[];
};

function getAssignWarnings(result: unknown): string[] {
  if (!result || typeof result !== "object") {
    return [];
  }
  const warnings = (result as { warnings?: unknown }).warnings;
  if (!Array.isArray(warnings)) {
    return [];
  }
  return warnings.filter((warning): warning is string => typeof warning === "string");
}

export function CreateJobModal({
  open,
  onClose,
  propertyOptions,
  cleanerOptions,
}: CreateJobModalProps) {
  const createJob = useMutation(
    api.cleaningJobs.mutations.create,
  );
  const assignJob = useMutation(
    api.cleaningJobs.mutations.assign,
  );
  const { showToast } = useToast();

  const [propertyId, setPropertyId] = useState("");
  const [cleanerId, setCleanerId] = useState("");
  const [title, setTitle] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [notes, setNotes] = useState("");
  const [photoUrls, setPhotoUrls] = useState("");
  const [manualPropertyId, setManualPropertyId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return null;
  }

  const effectivePropertyId = propertyId || manualPropertyId;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();

    if (!effectivePropertyId || !title.trim() || !scheduledFor) {
      setError("Property, title, and schedule are required.");
      return;
    }

    const scheduledTimestamp = new Date(scheduledFor).getTime();
    if (!Number.isFinite(scheduledTimestamp)) {
      setError("Enter a valid schedule date and time.");
      return;
    }

    setError(null);
    setSaving(true);

    try {
      const durationMs = 2 * 60 * 60 * 1000;
      const jobId = await createJob({
        propertyId: effectivePropertyId as Id<"properties">,
        scheduledStartAt: scheduledTimestamp,
        scheduledEndAt: scheduledTimestamp + durationMs,
        notesForCleaner: [title.trim(), notes.trim()].filter(Boolean).join("\n") || undefined,
      });

      if (cleanerId) {
        const assignResult = await assignJob({
          jobId,
          cleanerIds: [cleanerId as Id<"users">],
          notifyCleaners: false,
          source: "create_job_modal",
          returnWarnings: true,
        });
        const warnings = getAssignWarnings(assignResult);
        if (warnings.length > 0) {
          showToast(`Dispatch warning: ${warnings.join(" ")}`, "error");
        }
      }

      setPropertyId("");
      setCleanerId("");
      setTitle("");
      setScheduledFor("");
      setNotes("");
      setPhotoUrls("");
      setManualPropertyId("");
      showToast("Job created successfully.");
      onClose();
    } catch (submitError) {
      const message = getErrorMessage(submitError, "Failed to create job.");
      setError(message);
      showToast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-xl space-y-4 rounded-lg border border-[var(--border)] bg-[var(--card)] p-5"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold">Create Job</h2>
            <p className="text-xs text-[var(--muted-foreground)]">
              Create a job and optionally assign a cleaner immediately.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
          >
            Close
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-[var(--muted-foreground)]">Property</span>
            <SearchableSelect
              value={propertyId || null}
              onChange={(id) => setPropertyId(id ?? "")}
              placeholder="Select property"
              searchPlaceholder="Search properties…"
              aria-label="Property"
              items={propertyOptions.map((p) => ({ id: p.id, label: p.name }))}
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-[var(--muted-foreground)]">Cleaner</span>
            <SearchableSelect
              value={cleanerId || null}
              onChange={(id) => setCleanerId(id ?? "")}
              placeholder="Unassigned"
              searchPlaceholder="Search cleaners…"
              aria-label="Cleaner"
              items={cleanerOptions.map((c) => ({ id: c.id, label: c.name }))}
            />
          </label>
        </div>

        <label className="block space-y-1 text-sm">
          <span className="text-[var(--muted-foreground)]">Property ID (manual)</span>
          <input
            value={manualPropertyId}
            onChange={(event) => setManualPropertyId(event.target.value)}
            placeholder="Use this when no property options are available"
            className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-[var(--muted-foreground)]">Title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Turnover clean"
              className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-[var(--muted-foreground)]">Scheduled For</span>
            <input
              type="datetime-local"
              value={scheduledFor}
              onChange={(event) => setScheduledFor(event.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            />
          </label>
        </div>

        <label className="block space-y-1 text-sm">
          <span className="text-[var(--muted-foreground)]">Notes</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
          />
        </label>

        <label className="block space-y-1 text-sm">
          <span className="text-[var(--muted-foreground)]">Photo URLs (one per line)</span>
          <textarea
            value={photoUrls}
            onChange={(event) => setPhotoUrls(event.target.value)}
            rows={3}
            placeholder="https://..."
            className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
          />
        </label>

        {error ? <p className="text-sm text-[var(--destructive)]">{error}</p> : null}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {saving ? "Creating..." : "Create Job"}
          </button>
        </div>
      </form>
    </div>
  );
}
