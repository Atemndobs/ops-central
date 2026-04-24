"use client";

/**
 * AIProviderCard — admin-facing picker for the voice-transcription provider.
 *
 * Renders a card with a dropdown of the 4 curated providers surfaced by
 * `api.ai.settings.listVoiceProviders`. Each option shows its cost label,
 * a short description, and an "API key missing" chip when the backing env
 * var isn't set on the server. Save is admin-only on the backend — if a
 * non-admin user somehow sees this card, the mutation will reject them.
 *
 * This card intentionally does not render anything about *usage* — that
 * lives in the separate usage-tracking ADR being built in parallel. This
 * card only controls which provider is active.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Check, Loader2, Sparkles } from "lucide-react";
import { api } from "@convex/_generated/api";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/components/ui/toast-provider";

type VoiceProviderKey =
  | "gemini-flash"
  | "groq-whisper-turbo"
  | "openai-whisper";

function formatRelativeTime(timestamp: number, locale: string): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return locale === "es" ? "hace un momento" : "just now";
  if (diffMin < 60) {
    return locale === "es" ? `hace ${diffMin} min` : `${diffMin} min ago`;
  }
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) {
    return locale === "es" ? `hace ${diffHr} h` : `${diffHr}h ago`;
  }
  const diffDays = Math.round(diffHr / 24);
  return locale === "es" ? `hace ${diffDays} d` : `${diffDays}d ago`;
}

export function AIProviderCard({ locale = "en" }: { locale?: string }) {
  const t = useTranslations();
  const { showToast } = useToast();

  const data = useQuery(api.ai.settings.listVoiceProviders, {});
  const currentSetting = useQuery(api.ai.settings.getVoiceProvider, {});
  const setProvider = useMutation(api.ai.settings.setVoiceProvider);

  const [selected, setSelected] = useState<VoiceProviderKey | null>(null);
  const [saving, setSaving] = useState(false);

  // Sync local selection with the server's active provider whenever it
  // loads or changes (e.g. another admin switched it from another tab).
  useEffect(() => {
    if (data?.activeKey && selected === null) {
      setSelected(data.activeKey as VoiceProviderKey);
    }
  }, [data?.activeKey, selected]);

  const isLoading = data === undefined || currentSetting === undefined;

  if (isLoading) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
        <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      </div>
    );
  }

  const activeKey = data.activeKey;
  const dirty = selected !== null && selected !== activeKey;

  const handleSave = async () => {
    if (!selected || !dirty) return;
    setSaving(true);
    try {
      await setProvider({ providerKey: selected });
      showToast(t("settings.aiProviders.saved"), "success");
    } catch (error) {
      const message = getErrorMessage(error, "Could not save provider");
      showToast(
        t("settings.aiProviders.saveFailed", { error: message }),
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-[var(--primary)]/10 p-2 text-[var(--primary)]">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-medium text-[var(--foreground)]">
            {t("settings.aiProviders.voiceTitle")}
          </h3>
          <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
            {t("settings.aiProviders.voiceDescription")}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {data.providers.map((provider) => {
          const isActive = provider.key === activeKey;
          const isSelected = provider.key === selected;
          const unavailable = !provider.isConfigured && !isActive;
          return (
            <label
              key={provider.key}
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
                isSelected
                  ? "border-[var(--primary)] bg-[var(--primary)]/5"
                  : "border-[var(--border)] hover:border-[var(--muted-foreground)]"
              } ${unavailable ? "opacity-60" : ""}`}
            >
              <input
                type="radio"
                name="voice-provider"
                value={provider.key}
                checked={isSelected}
                onChange={() => setSelected(provider.key as VoiceProviderKey)}
                disabled={unavailable || saving}
                className="mt-1"
              />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-[var(--foreground)]">
                    {provider.label}
                  </span>
                  <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs font-mono text-[var(--muted-foreground)]">
                    {provider.costLabel}
                  </span>
                  {isActive ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-600">
                      <Check className="h-3 w-3" />
                      {t("settings.aiProviders.active")}
                    </span>
                  ) : null}
                  {!provider.isConfigured ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/15 px-2 py-0.5 text-xs font-medium text-yellow-600">
                      <AlertTriangle className="h-3 w-3" />
                      {t("settings.aiProviders.notConfigured")}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  {provider.description}
                </p>
                <p className="mt-1 text-xs font-mono text-[var(--muted-foreground)]/70">
                  {provider.envVar}
                </p>
              </div>
            </label>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-1">
        <div className="text-xs text-[var(--muted-foreground)]">
          {currentSetting.updatedAt
            ? t("settings.aiProviders.lastUpdated", {
                when: formatRelativeTime(currentSetting.updatedAt, locale),
              })
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
              {t("settings.aiProviders.saving")}
            </>
          ) : (
            t("settings.aiProviders.save")
          )}
        </button>
      </div>
    </div>
  );
}
