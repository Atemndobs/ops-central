"use client";

import { useAuth } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { Id } from "@convex/_generated/dataModel";
import Image from "next/image";
import Link from "next/link";
import { type ChangeEvent, useEffect, useState } from "react";
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
        text: error instanceof Error ? error.message : "Failed to upload photo.",
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
        text: "Enter a valid name before saving.",
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
        text: "Profile updated.",
      });
    } catch (error) {
      setProfileMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Failed to save profile.",
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
          text: "Browser permission was not granted.",
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
        text: "Push notifications are enabled on this device.",
      });
    } catch (error) {
      setPushMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Failed to enable push notifications.",
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
        text: "Push notifications were disabled for this device.",
      });
    } catch (error) {
      setPushMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Failed to disable push notifications.",
      });
    } finally {
      setIsUpdatingPush(false);
      await refreshPushStatus();
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-base font-semibold">Account</h2>
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
              <label className="inline-flex cursor-pointer rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                {isUploadingAvatar ? "Uploading..." : "Change Photo"}
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
                Upload a square photo for the cleanest result.
              </p>
            </div>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--muted-foreground)]">Name</span>
            <input
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
              placeholder="Your name"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--muted-foreground)]">Phone</span>
            <input
              value={profilePhone}
              onChange={(event) => setProfilePhone(event.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
              placeholder="Phone number"
            />
          </label>

          <div className="text-sm text-[var(--muted-foreground)]">
            <p>{profile?.email || "No email available"}</p>
            <p className="mt-1 uppercase tracking-wider">
              {profile?.role?.replace("_", " ") || "cleaner"}
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
              className="rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-60"
              onClick={() => {
                void handleProfileSave();
              }}
              disabled={isSavingProfile || isUploadingAvatar || !isConvexAuthenticated}
            >
              {isSavingProfile ? "Saving..." : "Save Profile"}
            </button>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-2">
          <button
            type="button"
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm"
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
            Switch to {isDarkMode ? "Light" : "Dark"} Theme
          </button>
          <button
            type="button"
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm"
            onClick={async () => {
              await disableWebPushSubscription().catch(() => false);
              await clearWebPushSubscription({}).catch(() => ({ success: false }));
              await signOut();
              window.location.href = "/sign-in";
            }}
          >
            Sign Out
          </button>
          </div>
        </div>
      </section>

      <section className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-base font-semibold">Offline Sync</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Pending uploads in queue: <span className="font-semibold text-[var(--foreground)]">{pendingUploads}</span>
        </p>
        <button
          type="button"
          className="mt-3 rounded-md border border-[var(--border)] px-3 py-2 text-sm"
          onClick={async () => {
            await clearPendingUploads();
            setPendingUploads(0);
          }}
        >
          Clear Offline Queue
        </button>
      </section>

      <section className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-base font-semibold">App Cache</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          If the app is showing outdated information or behaving strangely, clear the cache and reload.
        </p>
        <button
          type="button"
          disabled={clearingCache}
          className="mt-3 rounded-md border border-[var(--destructive)]/50 bg-[var(--destructive)]/10 px-3 py-2 text-sm font-semibold text-[var(--destructive)] hover:bg-[var(--destructive)]/20 active:opacity-70 disabled:opacity-50"
          onClick={() => { void handleClearCache(); }}
        >
          {cacheCleared ? "✓ Cache cleared — reloading…" : clearingCache ? "Clearing…" : "Clear Cache & Refresh"}
        </button>
      </section>

      <section className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-base font-semibold">Push Notifications</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Receive job assignments, approvals, and rework alerts on this device.
        </p>
        <div className="mt-3 space-y-2 text-sm">
          <p>
            Support:{" "}
            <span className="font-semibold text-[var(--foreground)]">
              {isWebPushSupported() ? "Available" : "Unavailable"}
            </span>
          </p>
          <p>
            VAPID Key:{" "}
            <span className="font-semibold text-[var(--foreground)]">
              {hasWebPushPublicKey() ? "Configured" : "Missing"}
            </span>
          </p>
          <p>
            Permission:{" "}
            <span className="font-semibold text-[var(--foreground)]">
              {pushPermission === "unsupported" ? "Unsupported" : pushPermission}
            </span>
          </p>
          <p>
            Device Subscription:{" "}
            <span className="font-semibold text-[var(--foreground)]">
              {hasPushSubscription ? "Active" : "Inactive"}
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
            {isUpdatingPush ? "Updating..." : hasPushSubscription ? "Refresh Push Setup" : "Enable Push"}
          </button>
          <button
            type="button"
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-60"
            onClick={() => {
              void handleDisablePush();
            }}
            disabled={isUpdatingPush || !hasPushSubscription}
          >
            Disable Push
          </button>
        </div>
      </section>

      <section className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-base font-semibold">Recent Notifications</h2>
        {isConvexAuthLoading || !isConvexAuthenticated || notifications === undefined ? (
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">Loading notifications...</p>
        ) : notifications.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">No notifications yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {notifications.map((notification) => (
              <li key={notification._id} className="rounded-md border border-[var(--border)] p-2">
                <p className="text-sm font-semibold">{notification.title}</p>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">{notification.message}</p>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  {new Date(notification.createdAt).toLocaleString()} · {notification.readAt ? "Read" : "Unread"}
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
                    Open
                  </Link>
                  {!notification.readAt ? (
                    <button
                      type="button"
                      onClick={() => {
                        void markNotificationRead({ id: notification._id }).catch(() => undefined);
                      }}
                      className="rounded-md border border-[var(--border)] px-2 py-1 text-xs"
                    >
                      Mark Read
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      void dismissNotification({ id: notification._id }).catch(() => undefined);
                    }}
                    className="rounded-md border border-[var(--border)] px-2 py-1 text-xs"
                  >
                    Dismiss
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
