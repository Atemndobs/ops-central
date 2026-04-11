"use client";

import { useAuth } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { Id } from "@convex/_generated/dataModel";
import Image from "next/image";
import Link from "next/link";
import { type ChangeEvent, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@convex/_generated/api";
import { clearPendingUploads, listPendingUploads } from "@/features/cleaner/offline/indexeddb";
import { uploadImageFile } from "@/lib/upload-image";
import {
  disableWebPushSubscription,
  ensureWebPushSubscription,
  getExistingWebPushSubscription,
  hasWebPushPublicKey,
  isWebPushSupported,
  requestWebPushPermission,
} from "@/lib/web-push";

const THEME_STORAGE_KEY = "opscentral-theme";

type ThemePreference = "dark" | "light";

function applyTheme(theme: ThemePreference) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function getCleanerNotificationHref(type: string, data: unknown): string {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const jobId = (data as { jobId?: unknown }).jobId;
    if (typeof jobId === "string" && jobId.length > 0) {
      return `/cleaner/jobs/${jobId}`;
    }
  }

  if (type === "incident_created") {
    return "/cleaner/incidents/new";
  }

  return "/cleaner";
}

export function CleanerSettingsClient() {
  const t = useTranslations();
  const { signOut } = useAuth();
  const { isAuthenticated: isConvexAuthenticated, isLoading: isConvexAuthLoading } = useConvexAuth();
  const profile = useQuery(
    api.users.queries.getMyProfile,
    isConvexAuthenticated ? {} : "skip",
  );
  const themePreference = useQuery(
    api.users.queries.getThemePreference,
    isConvexAuthenticated ? {} : "skip",
  );
  const setThemePreference = useMutation(api.users.mutations.setThemePreference);
  const updateMyProfile = useMutation(api.users.mutations.updateMyProfile);
  const markNotificationRead = useMutation(api.users.mutations.markNotificationRead);
  const dismissNotification = useMutation(api.users.mutations.dismissNotification);
  const updateWebPushSubscription = useMutation(api.users.mutations.updateWebPushSubscription);
  const clearWebPushSubscription = useMutation(api.users.mutations.clearWebPushSubscription);
  const notifications = useQuery(
    api.notifications.queries.getMyNotifications,
    isConvexAuthenticated
      ? {
          includeRead: true,
          limit: 20,
        }
      : "skip",
  ) as
    | Array<{
        _id: Id<"notifications">;
        type: string;
        title: string;
        message: string;
        data?: unknown;
        createdAt: number;
        readAt?: number;
      }>
    | undefined;

  const [pendingUploads, setPendingUploads] = useState(0);
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [profileAvatarUrl, setProfileAvatarUrl] = useState("");
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | "unsupported">(
    () => {
      if (typeof window === "undefined" || !isWebPushSupported()) {
        return "unsupported";
      }

      return Notification.permission;
    },
  );
  const [hasPushSubscription, setHasPushSubscription] = useState(false);
  const [pushMessage, setPushMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [isUpdatingPush, setIsUpdatingPush] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [localTheme, setLocalTheme] = useState<ThemePreference>(() => {
    if (typeof window === "undefined") {
      return "light";
    }

    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "dark" || stored === "light" ? stored : "light";
  });
  const resolvedTheme: ThemePreference = themePreference?.theme ?? localTheme;
  const isDarkMode = resolvedTheme === "dark";

  useEffect(() => {
    if (!isConvexAuthenticated) {
      return;
    }
    let active = true;
    void listPendingUploads().then((items) => {
      if (!active) return;
      setPendingUploads(items.length);
    });

    return () => {
      active = false;
    };
  }, [isConvexAuthenticated]);

  useEffect(() => {
    applyTheme(resolvedTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    if (!isWebPushSupported()) {
      setPushPermission("unsupported");
      setHasPushSubscription(false);
      return;
    }

    let active = true;
    setPushPermission(Notification.permission);

    void getExistingWebPushSubscription().then((subscription) => {
      if (!active) {
        return;
      }

      setHasPushSubscription(Boolean(subscription));
    });

    return () => {
      active = false;
    };
  }, [isConvexAuthenticated]);

  useEffect(() => {
    if (!profile) {
      return;
    }
    setProfileName(profile.name ?? "");
    setProfilePhone(profile.phone ?? "");
    setProfileAvatarUrl(profile.avatarUrl ?? "");
  }, [profile]);

  const handleAvatarSelected = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    setProfileMessage(null);
    setIsUploadingAvatar(true);
    try {
      const nextAvatarUrl = await uploadImageFile(file);
      setProfileAvatarUrl(nextAvatarUrl);
    } catch (error) {
      setProfileMessage({
        tone: "error",
        text: error instanceof Error ? error.message : t("cleaner.settings.failedUploadPhoto"),
      });
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleProfileSave = async () => {
    if (!isConvexAuthenticated) {
      return;
    }

    const normalizedName = profileName.trim();
    if (normalizedName.length < 2) {
      setProfileMessage({
        tone: "error",
        text: t("cleaner.settings.enterValidNameSave"),
      });
      return;
    }

    setProfileMessage(null);
    setIsSavingProfile(true);
    try {
      await updateMyProfile({
        name: normalizedName,
        phone: profilePhone,
        avatarUrl: profileAvatarUrl || undefined,
      });
      setProfileMessage({
        tone: "success",
        text: t("cleaner.settings.profileUpdated"),
      });
    } catch (error) {
      setProfileMessage({
        tone: "error",
        text: error instanceof Error ? error.message : t("cleaner.settings.failedSaveProfile"),
      });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleClearCache = async () => {
    setClearingCache(true);
    try {
      // 1. Delete all caches directly from the page context (works without SW messaging)
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }

      // 2. Tell the active SW to also wipe its own caches and skip waiting
      const reg = await navigator.serviceWorker?.getRegistration?.();
      if (reg) {
        reg.active?.postMessage({ type: "CLEAR_ALL_CACHES" });
        // Trigger an update check so the new SW installs immediately
        await reg.update().catch(() => undefined);
        reg.waiting?.postMessage({ type: "SKIP_WAITING" });
      }

      setCacheCleared(true);
      // Short pause so the user sees the confirmation, then reload fresh
      await new Promise<void>((resolve) => setTimeout(resolve, 800));
      window.location.reload();
    } catch {
      setClearingCache(false);
    }
  };

  const refreshPushStatus = async () => {
    if (!isWebPushSupported()) {
      setPushPermission("unsupported");
      setHasPushSubscription(false);
      return;
    }

    setPushPermission(Notification.permission);
    const subscription = await getExistingWebPushSubscription();
    setHasPushSubscription(Boolean(subscription));
  };

  const handleEnablePush = async () => {
    if (!isConvexAuthenticated) {
      return;
    }

    setPushMessage(null);
    setIsUpdatingPush(true);

    try {
      const permission = await requestWebPushPermission();
      setPushPermission(permission);

      if (permission !== "granted") {
        setPushMessage({
          tone: "error",
          text: t("cleaner.settings.permissionNotGranted"),
        });
        return;
      }

      const subscription = await ensureWebPushSubscription();
      if (!subscription) {
        throw new Error("Browser subscription could not be created.");
      }

      await updateWebPushSubscription({ subscription });
      setHasPushSubscription(true);
      setPushMessage({
        tone: "success",
        text: t("cleaner.settings.pushEnabled"),
      });
    } catch (error) {
      setPushMessage({
        tone: "error",
        text: error instanceof Error ? error.message : t("cleaner.settings.failedEnablePush"),
      });
    } finally {
      setIsUpdatingPush(false);
      await refreshPushStatus();
    }
  };

  const handleDisablePush = async () => {
    setPushMessage(null);
    setIsUpdatingPush(true);

    try {
      await disableWebPushSubscription();
      await clearWebPushSubscription({});
      setHasPushSubscription(false);
      setPushMessage({
        tone: "success",
        text: t("cleaner.settings.pushDisabled"),
      });
    } catch (error) {
      setPushMessage({
        tone: "error",
        text: error instanceof Error ? error.message : t("cleaner.settings.failedDisablePush"),
      });
    } finally {
      setIsUpdatingPush(false);
      await refreshPushStatus();
    }
  };

  return (
    <div className="space-y-4">
      <section className="cleaner-card p-4">
        <h2 className="text-base font-semibold">{t("cleaner.settings.account")}</h2>
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex items-center gap-4">
            {profileAvatarUrl ? (
              <div className="relative h-20 w-20 overflow-hidden rounded-full border border-[var(--border)]">
                <Image
                  src={profileAvatarUrl}
                  alt={profileName || profile?.email || "Cleaner profile"}
                  fill
                  unoptimized
                  className="object-cover"
                  sizes="80px"
                />
              </div>
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--accent)] text-2xl font-semibold text-[var(--muted-foreground)]">
                {(profileName || profile?.email || "U").trim().charAt(0).toUpperCase()}
              </div>
            )}
            <div className="space-y-2">
              <label className="cleaner-outline-button inline-flex cursor-pointer text-sm">
                {isUploadingAvatar ? t("cleaner.settings.uploading") : t("cleaner.settings.changePhoto")}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={isUploadingAvatar}
                  onChange={(event) => {
                    void handleAvatarSelected(event);
                  }}
                />
              </label>
              <p className="text-xs text-[var(--muted-foreground)]">
                {t("cleaner.settings.photoHint")}
              </p>
            </div>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--muted-foreground)]">{t("cleaner.settings.name")}</span>
            <input
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
              placeholder={t("cleaner.settings.namePlaceholder")}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--muted-foreground)]">{t("cleaner.settings.phone")}</span>
            <input
              value={profilePhone}
              onChange={(event) => setProfilePhone(event.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
              placeholder={t("cleaner.settings.phonePlaceholder")}
            />
          </label>

          <div className="text-sm text-[var(--muted-foreground)]">
            <p>{profile?.email || t("cleaner.settings.noEmail")}</p>
            <p className="mt-1 uppercase tracking-wider">
              {(() => { try { return t(`roles.${profile?.role ?? "cleaner"}`); } catch { return profile?.role?.replace("_", " ") ?? t("roles.cleaner"); } })()}
            </p>
          </div>

          {profileMessage ? (
            <p
              className={`rounded-md border px-3 py-2 text-sm ${
                profileMessage.tone === "success"
                  ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-400"
                  : "border-rose-600/30 bg-rose-500/10 text-rose-400"
              }`}
            >
              {profileMessage.text}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="cleaner-primary-button text-sm disabled:opacity-60"
              onClick={() => {
                void handleProfileSave();
              }}
              disabled={isSavingProfile || isUploadingAvatar || !isConvexAuthenticated}
            >
              {isSavingProfile ? t("cleaner.settings.saving") : t("cleaner.settings.saveProfile")}
            </button>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-2">
          <button
            type="button"
            className="cleaner-outline-button text-sm"
            onClick={async () => {
              const nextTheme: ThemePreference = isDarkMode ? "light" : "dark";
              setLocalTheme(nextTheme);
              applyTheme(nextTheme);
              window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
              if (isConvexAuthenticated) {
                await setThemePreference({ theme: nextTheme });
              }
            }}
          >
            {t("cleaner.settings.switchToTheme", { theme: isDarkMode ? t("cleaner.settings.light") : t("cleaner.settings.dark") })}
          </button>
          <button
            type="button"
            className="cleaner-outline-button text-sm"
            onClick={async () => {
              await disableWebPushSubscription().catch(() => false);
              await clearWebPushSubscription({}).catch(() => ({ success: false }));
              await signOut();
              window.location.href = "/sign-in";
            }}
          >
            {t("cleaner.settings.signOut")}
          </button>
          </div>
        </div>
      </section>

      <section className="cleaner-card p-4">
        <h2 className="text-base font-semibold">{t("cleaner.settings.offlineSync")}</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {t("cleaner.settings.pendingUploads")} <span className="font-semibold text-[var(--foreground)]">{pendingUploads}</span>
        </p>
        <button
          type="button"
          className="mt-3 cleaner-outline-button text-sm"
          onClick={async () => {
            await clearPendingUploads();
            setPendingUploads(0);
          }}
        >
          {t("cleaner.settings.clearOfflineQueue")}
        </button>
      </section>

      <section className="cleaner-card p-4">
        <h2 className="text-base font-semibold">{t("cleaner.settings.appCache")}</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {t("cleaner.settings.appCacheHint")}
        </p>
        <button
          type="button"
          disabled={clearingCache}
          className="mt-3 rounded-md border border-[var(--destructive)]/50 bg-[var(--destructive)]/10 px-3 py-2 text-sm font-semibold text-[var(--destructive)] hover:bg-[var(--destructive)]/20 active:opacity-70 disabled:opacity-50"
          onClick={() => { void handleClearCache(); }}
        >
          {cacheCleared ? `✓ ${t("cleaner.settings.cacheCleared")}` : clearingCache ? t("cleaner.settings.clearing") : t("cleaner.settings.clearCacheRefresh")}
        </button>
      </section>

      <section className="cleaner-card p-4">
        <h2 className="text-base font-semibold">{t("cleaner.settings.pushNotifications")}</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {t("cleaner.settings.pushHint")}
        </p>
        <div className="mt-3 space-y-2 text-sm">
          <p>
            {t("cleaner.settings.support")}{" "}
            <span className="font-semibold text-[var(--foreground)]">
              {isWebPushSupported() ? t("cleaner.settings.available") : t("cleaner.settings.unavailable")}
            </span>
          </p>
          <p>
            {t("cleaner.settings.vapidKey")}{" "}
            <span className="font-semibold text-[var(--foreground)]">
              {hasWebPushPublicKey() ? t("cleaner.settings.configured") : t("cleaner.settings.missing")}
            </span>
          </p>
          <p>
            {t("cleaner.settings.permission")}{" "}
            <span className="font-semibold text-[var(--foreground)]">
              {pushPermission === "unsupported" ? t("cleaner.settings.unsupported") : pushPermission}
            </span>
          </p>
          <p>
            {t("cleaner.settings.deviceSubscription")}{" "}
            <span className="font-semibold text-[var(--foreground)]">
              {hasPushSubscription ? t("cleaner.settings.activeSub") : t("cleaner.settings.inactiveSub")}
            </span>
          </p>
        </div>
        {pushMessage ? (
          <p
            className={`mt-3 rounded-md border px-3 py-2 text-sm ${
              pushMessage.tone === "success"
                ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-400"
                : "border-rose-600/30 bg-rose-500/10 text-rose-400"
            }`}
          >
            {pushMessage.text}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-60"
            onClick={() => {
              void handleEnablePush();
            }}
            disabled={
              isUpdatingPush ||
              !isConvexAuthenticated ||
              !isWebPushSupported() ||
              !hasWebPushPublicKey()
            }
          >
            {isUpdatingPush ? t("cleaner.settings.updating") : hasPushSubscription ? t("cleaner.settings.refreshPush") : t("cleaner.settings.enablePush")}
          </button>
          <button
            type="button"
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-60"
            onClick={() => {
              void handleDisablePush();
            }}
            disabled={isUpdatingPush || !hasPushSubscription}
          >
            {t("cleaner.settings.disablePush")}
          </button>
        </div>
      </section>

      <section className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-base font-semibold">{t("cleaner.settings.recentNotifications")}</h2>
        {isConvexAuthLoading || !isConvexAuthenticated || notifications === undefined ? (
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">{t("cleaner.settings.loadingNotifications")}</p>
        ) : notifications.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">{t("cleaner.settings.noNotifications")}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {notifications.map((notification) => (
              <li key={notification._id} className="rounded-md border border-[var(--border)] p-2">
                <p className="text-sm font-semibold">{notification.title}</p>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">{notification.message}</p>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  {new Date(notification.createdAt).toLocaleString()} · {notification.readAt ? t("cleaner.settings.read") : t("cleaner.settings.unread")}
                </p>
                <div className="mt-2 flex gap-2">
                  <Link
                    href={getCleanerNotificationHref(notification.type, notification.data)}
                    onClick={() => {
                      if (!notification.readAt) {
                        void markNotificationRead({ id: notification._id }).catch(() => undefined);
                      }
                    }}
                    className="rounded-md border border-[var(--border)] px-2 py-1 text-xs"
                  >
                    {t("common.open")}
                  </Link>
                  {!notification.readAt ? (
                    <button
                      type="button"
                      onClick={() => {
                        void markNotificationRead({ id: notification._id }).catch(() => undefined);
                      }}
                      className="rounded-md border border-[var(--border)] px-2 py-1 text-xs"
                    >
                      {t("cleaner.settings.markRead")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      void dismissNotification({ id: notification._id }).catch(() => undefined);
                    }}
                    className="rounded-md border border-[var(--border)] px-2 py-1 text-xs"
                  >
                    {t("common.dismiss")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
