"use client";

/**
 * AppIconColorCard — admin picker for the INSTALLED PWA icon color.
 *
 * The home-screen / installed icon is a single org-wide choice (the manifest is
 * one shared resource fetched before login, so it can't vary per role). Saving
 * updates `appSettings.installedIconColor`; the dynamic manifest route then
 * advertises the matching icon set. Takes effect for NEW installs — existing
 * home-screen icons update only after removing and re-adding the app.
 *
 * The in-app logo/accent is separate and colors itself by the logged-in role.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, Loader2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/components/ui/toast-provider";
import {
  ICON_COLOR_KEYS,
  ICON_COLORS,
  iconAssetBase,
  type IconColorKey,
} from "@/lib/brand";

export function AppIconColorCard() {
  const { showToast } = useToast();
  const current = useQuery(api.appSettings.getInstalledIconColor, {});
  const setColor = useMutation(api.appSettings.setInstalledIconColor);
  const [saving, setSaving] = useState<IconColorKey | null>(null);

  const active = current?.color;

  async function choose(key: IconColorKey) {
    if (key === active || saving) return;
    setSaving(key);
    try {
      await setColor({ color: key });
      showToast(
        `Installed app icon set to ${ICON_COLORS[key].label}. New installs will use it; existing ones update after reinstalling.`,
        "success",
      );
    } catch (error) {
      showToast(getErrorMessage(error, "Could not update the app icon color"), "error");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--muted-foreground)]">
        Color of the app icon when it&apos;s installed to a phone home screen. This is one
        choice for the whole team — it applies to <strong>new installs</strong>; anyone who
        already added the app updates their icon after removing and re-adding it.
      </p>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {ICON_COLOR_KEYS.map((key) => {
          const isActive = key === active;
          const isSaving = saving === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => choose(key)}
              disabled={saving !== null}
              aria-pressed={isActive}
              className={`relative flex flex-col items-center gap-2 rounded-lg border p-3 transition disabled:opacity-70 ${
                isActive
                  ? "border-[var(--primary)] ring-2 ring-[var(--primary)]/40"
                  : "hover:bg-[var(--accent)]"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${iconAssetBase(key)}-192.png`}
                alt={`${ICON_COLORS[key].label} app icon`}
                width={56}
                height={56}
                className="h-14 w-14"
              />
              <span className="text-xs font-medium">{ICON_COLORS[key].label}</span>
              {isActive ? (
                <span className="absolute right-1.5 top-1.5 rounded-full bg-[var(--primary)] p-0.5 text-white">
                  <Check className="h-3 w-3" />
                </span>
              ) : null}
              {isSaving ? (
                <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-[var(--card)]/60">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
