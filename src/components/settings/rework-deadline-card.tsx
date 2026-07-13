"use client";

/**
 * ReworkDeadlineCard — admin picker for the org-wide default "rework fix
 * deadline" (minutes). When a job's photos are rejected, the cleaner has this
 * long to fix it before it escalates; the countdown the cleaner sees is driven
 * by it. Overridable per-property on the property page. Mirrors the settings
 * card pattern (load → dirty → save, admin-only mutation).
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { AlarmClock, Loader2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/components/ui/toast-provider";

function formatRelativeTime(timestamp: number): string {
  const diffMin = Math.round((Date.now() - timestamp) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.round(diffHr / 24)}d ago`;
}

export function ReworkDeadlineCard() {
  const { showToast } = useToast();

  const current = useQuery(api.appSettings.getReworkDeadlineMinutes, {});
  const setMinutes = useMutation(api.appSettings.setReworkDeadlineMinutes);

  const [value, setValue] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (current && value === "") {
      setValue(String(current.minutes));
    }
  }, [current, value]);

  if (current === undefined) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
        <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      </div>
    );
  }

  const parsed = Number(value);
  const valid =
    Number.isInteger(parsed) && parsed >= 1 && parsed <= 24 * 60;
  const dirty = valid && parsed !== current.minutes;

  const handleSave = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      await setMinutes({ minutes: parsed });
      showToast("Rework deadline saved.", "success");
    } catch (error) {
      showToast(getErrorMessage(error, "Could not save deadline"), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-[var(--primary)]/10 p-2 text-[var(--primary)]">
          <AlarmClock className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-medium text-[var(--foreground)]">
            Rework fix deadline
          </h3>
          <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
            When work is rejected, how long the cleaner has to fix it before it
            escalates. Individual properties can override this.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="number"
          min={1}
          max={1440}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={saving}
          className="w-28 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
        />
        <span className="text-sm text-[var(--muted-foreground)]">minutes</span>
      </div>
      {!valid ? (
        <p className="text-xs text-red-600">
          Enter a whole number of minutes between 1 and 1440.
        </p>
      ) : null}

      <div className="flex items-center justify-between pt-1">
        <div className="text-xs text-[var(--muted-foreground)]">
          {current.isDefault
            ? "Using default (30 min)"
            : current.updatedAt
              ? `Last changed ${formatRelativeTime(current.updatedAt)}`
              : null}
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            "Save"
          )}
        </button>
      </div>
    </div>
  );
}
