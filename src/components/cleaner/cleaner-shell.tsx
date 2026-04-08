"use client";

import { useAuth } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  ClipboardList,
  MessageSquare,
  AlertTriangle,
  MoreHorizontal,
  Wifi,
  WifiOff,
  LogOut,
  Moon,
  Sun,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { InstallPrompt } from "@/components/cleaner/install-prompt";
import { useConsumeNotificationIdFromSearchParam } from "@/lib/notifications-client";
import {
  disableWebPushSubscription as disableBrowserWebPushSubscription,
  ensureWebPushSubscription,
  hasWebPushPublicKey,
  isWebPushSupported,
} from "@/lib/web-push";

const NAV_ITEMS = [
  { href: "/cleaner", label: "Jobs", icon: ClipboardList },
  { href: "/cleaner/messages", label: "Messages", icon: MessageSquare },
  { href: "/cleaner/incidents/new", label: "Incident", icon: AlertTriangle },
  { href: "/cleaner/more", label: "More", icon: MoreHorizontal },
];

const THEME_STORAGE_KEY = "opscentral-theme";

type ThemePreference = "dark" | "light";

function readClientThemePreference(): ThemePreference {
  if (typeof window === "undefined") {
    return "light";
  }

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "dark" || stored === "light") {
    return stored;
  }

  return "light";
}

function applyTheme(theme: ThemePreference) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function getCleanerNotificationHref(type: string, data: unknown): string {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const conversationId = (data as { conversationId?: unknown }).conversationId;
    if (
      type === "message_received" &&
      typeof conversationId === "string" &&
      conversationId.length > 0
    ) {
      return `/cleaner/messages?conversationId=${conversationId}`;
    }
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

function formatNotificationTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CleanerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { signOut, userId } = useAuth();
  const { isAuthenticated: isConvexAuthenticated, isLoading: isConvexAuthLoading } =
    useConvexAuth();
  const themePreference = useQuery(
    api.users.queries.getThemePreference,
    isConvexAuthenticated ? {} : "skip",
  );
  const notifications = useQuery(
    api.notifications.queries.getMyNotifications,
    isConvexAuthenticated
      ? {
          includeRead: true,
          limit: 10,
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
        dismissedAt?: number;
      }>
    | undefined;
  const setThemePreference = useMutation(api.users.mutations.setThemePreference);
  const markNotificationRead = useMutation(api.users.mutations.markNotificationRead);
  const updateWebPushSubscription = useMutation(api.users.mutations.updateWebPushSubscription);
  const clearWebPushSubscription = useMutation(api.users.mutations.clearWebPushSubscription);
  const setThemePreferenceRef = useRef(setThemePreference);
  const updateWebPushSubscriptionRef = useRef(updateWebPushSubscription);
  const clearWebPushSubscriptionRef = useRef(clearWebPushSubscription);
  const [isOnline, setIsOnline] = useState(true);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  // Initialize to "light" so server and client render the same HTML during hydration.
  // The actual localStorage preference is applied in a useEffect after mount.
  const [localTheme, setLocalTheme] = useState<ThemePreference>("light");
  const initializedThemeScopeRef = useRef<string | null>(null);
  const themeScopeKey = isConvexAuthenticated
    ? `auth:${userId ?? "unknown"}`
    : "anon";
  const resolvedTheme: ThemePreference =
    isConvexAuthenticated && themePreference?.theme
      ? themePreference.theme
      : localTheme;
  const isDarkMode = resolvedTheme === "dark";
  const notificationPanelRef = useRef<HTMLDivElement | null>(null);
  const unreadNotifications = useMemo(
    () => (notifications ?? []).filter((item) => !item.readAt && !item.dismissedAt),
    [notifications],
  );
  const visibleNotifications = unreadNotifications;
  const unreadCount = unreadNotifications.length;

  useConsumeNotificationIdFromSearchParam(isConvexAuthenticated);

  // Sync localTheme from localStorage after hydration to avoid SSR mismatch
  useEffect(() => {
    const nextTheme = readClientThemePreference();
    if (nextTheme === localTheme) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      setLocalTheme(nextTheme);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [localTheme]);

  useEffect(() => {
    setThemePreferenceRef.current = setThemePreference;
  }, [setThemePreference]);

  useEffect(() => {
    updateWebPushSubscriptionRef.current = updateWebPushSubscription;
  }, [updateWebPushSubscription]);

  useEffect(() => {
    clearWebPushSubscriptionRef.current = clearWebPushSubscription;
  }, [clearWebPushSubscription]);

  useEffect(() => {
    const updateOnlineState = () => setIsOnline(window.navigator.onLine);
    updateOnlineState();

    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);
    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, []);

  useEffect(() => {
    if (!isNotificationsOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (
        notificationPanelRef.current &&
        !notificationPanelRef.current.contains(event.target as Node)
      ) {
        setIsNotificationsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsNotificationsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isNotificationsOpen]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    let isMounted = true;

    const onControllerChange = () => {
      window.location.reload();
    };

    const register = async () => {
      try {
        const nextRegistration = await navigator.serviceWorker.register("/cleaner-sw.js");
        if (!isMounted) {
          return;
        }

        setRegistration(nextRegistration);
        if (nextRegistration.waiting) {
          setUpdateReady(true);
        }

        nextRegistration.addEventListener("updatefound", () => {
          const worker = nextRegistration.installing;
          if (!worker) {
            return;
          }

          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              setUpdateReady(true);
            }
          });
        });
      } catch (error) {
        console.warn("[CleanerPWA] Service worker registration failed", error);
      }
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    void register();

    return () => {
      isMounted = false;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  useEffect(() => {
    if (!isConvexAuthenticated || !isWebPushSupported()) {
      return;
    }

    if (Notification.permission !== "denied") {
      return;
    }

    void clearWebPushSubscriptionRef.current({}).catch((error) => {
      console.warn("[CleanerPWA] Failed to clear denied push subscription", error);
    });
  }, [isConvexAuthenticated]);

  useEffect(() => {
    if (!registration || !isConvexAuthenticated || !isWebPushSupported() || !hasWebPushPublicKey()) {
      return;
    }

    if (Notification.permission !== "granted") {
      return;
    }

    let cancelled = false;

    void ensureWebPushSubscription()
      .then((subscription) => {
        if (!subscription || cancelled) {
          return;
        }

        return updateWebPushSubscriptionRef.current({ subscription });
      })
      .catch((error) => {
        console.warn("[CleanerPWA] Failed to sync push subscription", error);
      });

    return () => {
      cancelled = true;
    };
  }, [registration, isConvexAuthenticated]);

  useEffect(() => {
    if (initializedThemeScopeRef.current === themeScopeKey) {
      return;
    }
    if (isConvexAuthLoading) {
      return;
    }
    if (isConvexAuthenticated && themePreference === undefined) {
      return;
    }

    applyTheme(resolvedTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, resolvedTheme);

    if (
      isConvexAuthenticated &&
      !themePreference?.theme &&
      initializedThemeScopeRef.current !== themeScopeKey
    ) {
      void setThemePreferenceRef.current({ theme: resolvedTheme }).catch((error) => {
        console.warn("[CleanerTheme] Failed to initialize theme in Convex", error);
      });
      initializedThemeScopeRef.current = themeScopeKey;
    } else if (isConvexAuthenticated && themePreference?.theme) {
      initializedThemeScopeRef.current = themeScopeKey;
    }
  }, [
    resolvedTheme,
    isConvexAuthenticated,
    isConvexAuthLoading,
    themePreference,
    themeScopeKey,
  ]);

  const toggleTheme = useCallback(() => {
    const nextTheme: ThemePreference = resolvedTheme === "dark" ? "light" : "dark";
    setLocalTheme(nextTheme);
    applyTheme(nextTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);

    if (isConvexAuthenticated) {
      void setThemePreferenceRef.current({ theme: nextTheme }).catch((error) => {
        console.warn("[CleanerTheme] Failed to save theme in Convex", error);
      });
    }
  }, [isConvexAuthenticated, resolvedTheme]);

  const title = useMemo(() => {
    if (!pathname) {
      return "Cleaner";
    }
    if (pathname.startsWith("/cleaner/jobs/")) {
      return pathname.endsWith("/active") ? "Active Job" : "Job Detail";
    }
    if (pathname.startsWith("/cleaner/history")) {
      return "History";
    }
    if (pathname.startsWith("/cleaner/incidents")) {
      return "Incident Report";
    }
    if (pathname.startsWith("/cleaner/settings")) {
      return "Settings";
    }
    if (pathname.startsWith("/cleaner/more")) {
      return "More";
    }
    if (pathname.startsWith("/cleaner/messages")) {
      return "Messages";
    }
    return "My Jobs";
  }, [pathname]);

  const handleSignOut = useCallback(async () => {
    try {
      await disableBrowserWebPushSubscription();
      await clearWebPushSubscriptionRef.current({});
    } catch (error) {
      console.warn("[CleanerPWA] Failed to clear push subscription during sign out", error);
    }

    await signOut();
    window.location.href = "/sign-in";
  }, [signOut]);

  return (
    <div className="relative h-[100svh] overflow-hidden bg-[var(--background)] text-[15px] text-[var(--foreground)]">
      <header className="fixed inset-x-0 top-0 z-40 border-b border-[var(--border)] bg-[var(--card)]/95 px-4 py-3.5 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Image
              src="https://chezsoistays.com/wp-content/uploads/2026/02/cropped-chezsoi_favicon@2x.png"
              alt="ChezSoiCleaning logo"
              width={36}
              height={36}
              className="h-9 w-9 rounded-md border border-[var(--border)]"
              priority
            />
            <div>
              <p className="text-sm uppercase tracking-wide text-[var(--muted-foreground)]">ChezSoiCleaning</p>
              <h1 className="text-lg font-semibold">{title}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="flex items-center justify-center rounded-md border border-[var(--border)] px-2.5 py-2 text-[var(--muted-foreground)]"
              aria-label={isOnline ? "Online" : "Offline"}
              title={isOnline ? "Online" : "Offline"}
            >
              {isOnline ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            </div>
            <div className="relative" ref={notificationPanelRef}>
              <button
                type="button"
                onClick={() => setIsNotificationsOpen((prev) => !prev)}
                className="relative rounded-md border border-[var(--border)] p-2.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                aria-label="Notifications"
                aria-expanded={isNotificationsOpen}
                aria-haspopup="dialog"
              >
                <Bell className="h-5 w-5" />
                {unreadCount > 0 ? (
                  <span className="absolute -right-1 -top-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-[var(--destructive)] px-1 text-[10px] font-bold text-white">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                ) : null}
              </button>

              {isNotificationsOpen ? (
                <div className="fixed left-2 right-2 top-[calc(env(safe-area-inset-top)+5.5rem)] z-50 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--card)] shadow-xl sm:absolute sm:left-auto sm:right-0 sm:top-12 sm:w-[320px] sm:max-w-[calc(100vw-1rem)]">
                  <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
                    <p className="text-sm font-semibold">Notifications</p>
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {unreadCount} unread
                    </span>
                  </div>

                  <div className="max-h-80 overflow-y-auto">
                    {!isConvexAuthenticated ? (
                      <p className="px-3 py-4 text-sm text-[var(--muted-foreground)]">
                        Sign in to view notifications.
                      </p>
                    ) : notifications === undefined ? (
                      <p className="px-3 py-4 text-sm text-[var(--muted-foreground)]">
                        Loading notifications...
                      </p>
                    ) : visibleNotifications.length === 0 ? (
                      <p className="px-3 py-4 text-sm text-[var(--muted-foreground)]">
                        No unread notifications.
                      </p>
                    ) : (
                      <div className="divide-y divide-[var(--border)]">
                        {visibleNotifications.map((notification) => (
                          <Link
                            key={notification._id}
                            href={getCleanerNotificationHref(notification.type, notification.data)}
                            onClick={() => {
                              setIsNotificationsOpen(false);
                              if (!notification.readAt && !notification.dismissedAt) {
                                void markNotificationRead({ id: notification._id }).catch((error) => {
                                  console.warn("[CleanerNotifications] Failed to mark item as read", error);
                                });
                              }
                            }}
                            className="block px-3 py-2 hover:bg-[var(--accent)]"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="min-w-0 text-sm font-semibold">{notification.title}</p>
                              {!notification.readAt && !notification.dismissedAt ? (
                                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--primary)]" />
                              ) : null}
                            </div>
                            <p className="mt-0.5 break-words text-xs text-[var(--muted-foreground)]">
                              {notification.message}
                            </p>
                            <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                              {formatNotificationTime(notification.createdAt)}
                            </p>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-[var(--border)] px-3 py-2">
                    <Link
                      href="/cleaner/settings"
                      onClick={() => setIsNotificationsOpen(false)}
                      className="text-xs font-medium text-[var(--primary)] hover:opacity-80"
                    >
                      View all in Settings
                    </Link>
                  </div>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-md border border-[var(--border)] p-2.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              aria-label={isDarkMode ? "Switch to light theme" : "Switch to dark theme"}
              title={isDarkMode ? "Light Mode" : "Dark Mode"}
            >
              {isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={() => {
                void handleSignOut();
              }}
              className="rounded-md border border-[var(--border)] p-2.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <main
        className="fixed inset-x-0 overflow-y-auto px-4"
        style={{
          top: "78px",
          bottom: "calc(84px + max(env(safe-area-inset-bottom), 6px))",
        }}
      >
        <div className="mx-auto w-full max-w-2xl pb-4 pt-4">
          <InstallPrompt />
          {updateReady ? (
            <div className="mt-2 rounded-md border border-blue-500/60 bg-blue-500/10 p-2 text-xs text-blue-100">
              <p>A new app version is ready.</p>
              <button
                type="button"
                className="mt-2 rounded-md bg-blue-500 px-2 py-1 font-semibold text-white"
                onClick={() => {
                  if (!registration?.waiting) {
                    window.location.reload();
                    return;
                  }

                  registration.waiting.postMessage({ type: "SKIP_WAITING" });
                }}
              >
                Update now
              </button>
            </div>
          ) : null}
          {children}
        </div>
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--card)]/95 backdrop-blur"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 6px)" }}
      >
        <ul className="mx-auto grid max-w-2xl grid-cols-4">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex min-h-[74px] flex-col items-center justify-center gap-1.5 px-2 py-3.5 text-[13px] font-medium ${
                    isActive ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]"
                  }`}
                >
                  <item.icon className="h-5 w-5" />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
