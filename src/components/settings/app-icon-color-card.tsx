"use client";

/**
 * AppIconColorCard — per-role brand color picker.
 *
 * An admin assigns a color to each role (Admin, Ops, Manager, Owner). Cleaner is
 * locked to purple. These colors drive:
 *   - the in-app logo / favicon / accent, by the logged-in role (all roles);
 *   - the 3 installable apps' home-screen icons (Ops app → Ops color,
 *     Owner app → Owner color, Cleaner app → purple).
 *
 * Admin, Ops, and Manager share the same installable app (the Ops dashboard), so
 * their home-screen icon is the same — they differ *inside* the app. Installed
 * icons take effect for new installs (existing update after reinstalling).
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, Loader2, Lock } from "lucide-react";
import { api } from "@convex/_generated/api";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/components/ui/toast-provider";
import {
  ICON_COLOR_KEYS,
  ICON_COLORS,
  ROLE_META,
  iconAssetBase,
  isAdjustableRole,
  type BrandRole,
  type IconColorKey,
} from "@/lib/brand";

export function AppIconColorCard() {
  const { showToast } = useToast();
  const roles = useQuery(api.appSettings.listRoleIconColors, {});
  const setColor = useMutation(api.appSettings.setRoleIconColor);
  const [saving, setSaving] = useState<string | null>(null);

  async function choose(role: BrandRole, key: IconColorKey, current: IconColorKey) {
    if (key === current || saving || !isAdjustableRole(role)) return;
    setSaving(`${role}:${key}`);
    try {
      await setColor({ role, color: key });
      showToast(
        `${ROLE_META[role].label} set to ${ICON_COLORS[key].label}. In-app updates now; installed icons update on next install/reinstall.`,
        "success",
      );
    } catch (error) {
      showToast(getErrorMessage(error, "Could not update the role color"), "error");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-[var(--muted-foreground)]">
        Assign a color to each role. It colors the logo, favicon and accents{" "}
        <strong>inside the app</strong> for whoever is logged in, and the home-screen
        icons of the installable apps. Cleaner is locked to purple. Admin, Ops and
        Manager share the Ops app, so they look distinct inside the app; installed-icon
        changes apply to new installs.
      </p>

      {roles === undefined ? (
        <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        roles.map(({ role, color, locked }) => (
          <div
            key={role}
            className={`rounded-lg border p-3 ${locked ? "opacity-60" : ""}`}
          >
            <div className="mb-3 flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${iconAssetBase(color)}-192.png`}
                alt={`${ROLE_META[role].label} icon`}
                width={40}
                height={40}
                className="h-10 w-10 shrink-0"
              />
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  {ROLE_META[role].label}
                  {locked ? <Lock className="h-3 w-3 text-[var(--muted-foreground)]" /> : null}
                </p>
                <p className="truncate text-xs text-[var(--muted-foreground)]">
                  {ROLE_META[role].description}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {ICON_COLOR_KEYS.map((key) => {
                const isActive = key === color;
                const isSaving = saving === `${role}:${key}`;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => choose(role, key, color)}
                    disabled={locked || saving !== null}
                    aria-pressed={isActive}
                    title={locked ? "Locked" : ICON_COLORS[key].label}
                    className={`relative flex flex-col items-center gap-1 rounded-md border p-2 transition disabled:cursor-not-allowed ${
                      isActive
                        ? "border-[var(--primary)] ring-2 ring-[var(--primary)]/40"
                        : locked
                          ? ""
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
