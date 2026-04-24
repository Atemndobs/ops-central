"use client";

/**
 * FeatureFlagsCard — admin-only picker for UI feature flags.
 *
 * Reads the list from `listFeatureFlags` (server-side metadata + current
 * state) and lets admins flip each one via `setFeatureFlag`. Defaults to
 * all OFF so new flags ship dark until an admin explicitly enables them.
 *
 * Non-admin users may see the card through the existing Settings UI but
 * their save call will be rejected by the mutation's `requireAdmin` guard.
 */

import { useMutation, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { Flag, Loader2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/components/ui/toast-provider";

type FlagKey =
  | "theme_switcher"
  | "voice_messages"
  | "voice_audio_attachments"
  | "usage_dashboard";

export function FeatureFlagsCard() {
  const t = useTranslations();
  const { showToast } = useToast();

  const flags = useQuery(api.admin.featureFlags.listFeatureFlags, {});
  const setFlag = useMutation(api.admin.featureFlags.setFeatureFlag);

  if (flags === undefined) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
        <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      </div>
    );
  }

  const handleToggle = async (key: FlagKey, enabled: boolean) => {
    try {
      await setFlag({ key, enabled });
      showToast(t("settings.featureFlags.saved"), "success");
    } catch (error) {
      const message = getErrorMessage(error, "Could not save flag");
      showToast(
        t("settings.featureFlags.saveFailed", { error: message }),
        "error"
      );
    }
  };

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-[var(--primary)]/10 p-2 text-[var(--primary)]">
          <Flag className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-medium text-[var(--foreground)]">
            {t("settings.featureFlags.title")}
          </h3>
          <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
            {t("settings.featureFlags.description")}
          </p>
        </div>
      </div>

      <div className="divide-y divide-[var(--border)]">
        {flags.map((flag) => (
          <div
            key={flag.key}
            className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--foreground)]">
                {flag.label}
              </p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                {flag.description}
              </p>
              <p className="mt-1 text-xs italic text-[var(--muted-foreground)]/70">
                {t("settings.featureFlags.offBehaviour", {
                  detail: flag.offBehaviour,
                })}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={flag.enabled}
              onClick={() => handleToggle(flag.key as FlagKey, !flag.enabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                flag.enabled
                  ? "bg-[var(--primary)]"
                  : "bg-[var(--muted)]"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  flag.enabled ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
              <span className="sr-only">
                {flag.enabled
                  ? t("settings.featureFlags.disable")
                  : t("settings.featureFlags.enable")}
              </span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
