"use client";

/**
 * AppIconColorCard — per-app installed-icon picker.
 *
 * Each installable PWA (Ops, Cleaner, Owner) has its own home-screen icon color,
 * chosen here by an admin. The dynamic manifest + icon routes for each app read
 * these settings. Takes effect for NEW installs — existing home-screen icons
 * update only after removing and re-adding the app (iOS caches especially hard).
 *
 * The in-app logo/accent is separate: it colors itself by the logged-in role.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, Loader2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/components/ui/toast-provider";
import {
  APP_META,
  ICON_COLOR_KEYS,
  ICON_COLORS,
  iconAssetBase,
  type IconApp,
  type IconColorKey,
} from "@/lib/brand";

export function AppIconColorCard() {
  const { showToast } = useToast();
  const apps = useQuery(api.appSettings.listAppIconColors, {});
  const setColor = useMutation(api.appSettings.setInstalledIconColor);
  const [saving, setSaving] = useState<string | null>(null);

  async function choose(app: IconApp, key: IconColorKey, current: IconColorKey) {
    if (key === current || saving) return;
    setSaving(`${app}:${key}`);
    try {
      await setColor({ app, color: key });
      showToast(
        `${APP_META[app].label} icon set to ${ICON_COLORS[key].label}. New installs use it; existing ones update after reinstalling.`,
        "success",
      );
    } catch (error) {
      showToast(getErrorMessage(error, "Could not update the app icon color"), "error");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-[var(--muted-foreground)]">
        Each installable app has its own home-screen icon color, so you can tell them
        apart on a phone. Applies to <strong>new installs</strong>; anyone who already
        added an app updates their icon after removing and re-adding it.
      </p>

      {apps === undefined ? (
        <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        apps.map(({ app, color }) => (
          <div key={app} className="rounded-lg border p-3">
            <div className="mb-3 flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${iconAssetBase(color)}-192.png`}
                alt={`${APP_META[app].label} icon`}
                width={40}
                height={40}
                className="h-10 w-10 shrink-0"
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold">{APP_META[app].label}</p>
                <p className="truncate text-xs text-[var(--muted-foreground)]">
                  {APP_META[app].description}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {ICON_COLOR_KEYS.map((key) => {
                const isActive = key === color;
                const isSaving = saving === `${app}:${key}`;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => choose(app, key, color)}
                    disabled={saving !== null}
                    aria-pressed={isActive}
                    title={ICON_COLORS[key].label}
                    className={`relative flex flex-col items-center gap-1 rounded-md border p-2 transition disabled:opacity-70 ${
                      isActive
                        ? "border-[var(--primary)] ring-2 ring-[var(--primary)]/40"
                        : "hover:bg-[var(--accent)]"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`${iconAssetBase(key)}-192.png`}
                      alt={ICON_COLORS[key].label}
                      width={36}
                      height={36}
                      className="h-9 w-9"
                    />
                    <span className="text-[10px] font-medium">{ICON_COLORS[key].label}</span>
                    {isActive ? (
                      <span className="absolute right-1 top-1 rounded-full bg-[var(--primary)] p-0.5 text-white">
                        <Check className="h-2.5 w-2.5" />
                      </span>
                    ) : null}
                    {isSaving ? (
                      <span className="absolute inset-0 flex items-center justify-center rounded-md bg-[var(--card)]/60">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
