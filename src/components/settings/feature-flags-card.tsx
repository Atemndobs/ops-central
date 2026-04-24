"use client";

/**
 * FeatureFlagsCard — admin-only picker for UI feature flags.
 *
 * Reads the list from `listFeatureFlags` (server-side metadata + current
 * state) and lets admins flip each one via `setFeatureFlag`. Defaults to
 * all OFF so new flags ship dark until an admin explicitly enables them.
 *
 * Each flag is its own collapsible row — the toggle is always visible in
 * the header so on/off state can be scanned at a glance, and the full
 * description + off-behaviour copy is tucked behind a click. Open/closed
 * state persists per flag in localStorage.
 *
 * Non-admin users may see the card through the existing Settings UI but
 * their save call will be rejected by the mutation's `requireAdmin` guard.
 */

import { useMutation, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/components/ui/toast-provider";
import { CollapsibleSection } from "@/components/ui/collapsible-section";

type FlagKey =
  | "theme_switcher"
  | "voice_messages"
  | "voice_audio_attachments"
  | "usage_dashboard";

type FlagRow = {
  key: FlagKey;
  label: string;
  description: string;
  offBehaviour: string;
  enabled: boolean;
  updatedAt?: number;
};

function FlagToggle({
  enabled,
  onToggle,
  ariaLabel,
}: {
  enabled: boolean;
  onToggle: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={ariaLabel}
      onClick={(event) => {
        // Prevent the outer collapsible header from toggling when the
        // user clicks the switch.
        event.stopPropagation();
        onToggle();
      }}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        enabled ? "bg-[var(--primary)]" : "bg-[var(--muted)]"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          enabled ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

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
        "error",
      );
    }
  };

  const enabledCount = flags.filter((f) => f.enabled).length;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[var(--foreground)]">
            {t("settings.featureFlags.title")}
          </h3>
          <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
            {t("settings.featureFlags.description")}
          </p>
        </div>
        <p className="shrink-0 text-xs text-[var(--muted-foreground)]">
          {enabledCount} / {flags.length} enabled
        </p>
      </div>

      <div className="space-y-2">
        {(flags as FlagRow[]).map((flag) => (
          <CollapsibleSection
            key={flag.key}
            persistKey={`flag-${flag.key}`}
            title={flag.label}
            subtitle={flag.enabled ? "On" : "Off"}
            badge={
              <FlagToggle
                enabled={flag.enabled}
                onToggle={() => handleToggle(flag.key, !flag.enabled)}
                ariaLabel={
                  flag.enabled
                    ? t("settings.featureFlags.disable")
                    : t("settings.featureFlags.enable")
                }
              />
            }
          >
            <div className="space-y-2 text-sm">
              <p className="text-[var(--muted-foreground)]">
                {flag.description}
              </p>
              <p className="text-xs italic text-[var(--muted-foreground)]/70">
                {t("settings.featureFlags.offBehaviour", {
                  detail: flag.offBehaviour,
                })}
              </p>
              {flag.updatedAt ? (
                <p className="pt-1 text-xs text-[var(--muted-foreground)]/70">
                  Last changed{" "}
                  {new Date(flag.updatedAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              ) : null}
              <p className="pt-1 font-mono text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]/60">
                {flag.key}
              </p>
            </div>
          </CollapsibleSection>
        ))}
      </div>
    </div>
  );
}
