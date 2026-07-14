"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2, MessageSquare, RotateCcw } from "lucide-react";
import { api } from "@convex/_generated/api";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/components/ui/toast-provider";

const DEFAULT_PROMPT = `You are a hospitality operations manager drafting public replies to guest reviews for ChezSoi Stays, a premium short-term rental company. Your replies appear publicly on Airbnb and are visible to future guests. Always:
- Thank the guest by first name and reference something specific from their review
- Be warm and appreciative for positive reviews; measured, non-defensive, and professional for complaints
- Acknowledge issues without admitting fault or making specific fix promises with dates
- Never offer discounts, refunds, or use legal/liability language
- Keep replies to 2–4 sentences maximum
- Show that management cares and acts on feedback`;

function formatRelativeTime(timestamp: number): string {
  const diffMin = Math.round((Date.now() - timestamp) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.round(diffHr / 24)}d ago`;
}

export function ReviewPromptCard() {
  const { showToast } = useToast();

  const current = useQuery(api.appSettings.getReviewSystemPrompt, {});
  const savePrompt = useMutation(api.appSettings.setReviewSystemPrompt);

  const [value, setValue] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (current !== undefined && !initialized) {
      setValue(current.prompt ?? "");
      setInitialized(true);
    }
  }, [current, initialized]);

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

  const dirty = value !== (current.prompt ?? "");

  async function handleSave() {
    if (!dirty) return;
    setSaving(true);
    try {
      await savePrompt({ prompt: value });
      showToast("Review prompt saved.", "success");
    } catch (error) {
      showToast(getErrorMessage(error, "Could not save prompt"), "error");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setValue(DEFAULT_PROMPT);
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-violet-500/10 p-2 text-violet-600">
          <MessageSquare className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-medium text-[var(--foreground)]">
            AI review reply system prompt
          </h3>
          <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
            This prompt is injected into every AI-generated review response (Gemini, Claude, and OpenAI).
            Edit it to match your brand voice and operational guidelines.
            Leave blank to use the built-in default.
          </p>
        </div>
      </div>

      {/* Variables reference */}
      <div className="rounded-md bg-[var(--muted)]/40 border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] space-y-1">
        <p className="font-medium text-[var(--foreground)]">Context injected automatically (no need to add these):</p>
        <p>Guest name · Property name · Star rating · Stay dates · Total paid · Review text · Private feedback</p>
      </div>

      <textarea
        rows={10}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={saving}
        placeholder={DEFAULT_PROMPT}
        className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm font-mono leading-relaxed text-[var(--foreground)] resize-y disabled:opacity-60"
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="text-xs text-[var(--muted-foreground)]">
            {current.prompt
              ? current.updatedAt
                ? `Last saved ${formatRelativeTime(current.updatedAt)}`
                : "Custom prompt active"
              : "Using built-in default"}
          </div>
          {current.prompt && (
            <button
              type="button"
              onClick={() => { setValue(""); }}
              className="text-xs text-[var(--muted-foreground)] underline underline-offset-2 hover:text-[var(--foreground)]"
            >
              Clear (revert to default)
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to default
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-2 rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save prompt"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
