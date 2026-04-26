"use client";

import { useAuth } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Bell,
  ClipboardList,
  MessageCircle,
  AlertTriangle,
  User,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import { localeNames, type Locale } from "@/lib/locales";
import type { Id } from "@convex/_generated/dataModel";
import { InstallPrompt } from "@/components/cleaner/install-prompt";
import { CleanerIconButton } from "@/components/cleaner/cleaner-ui";
import { useConsumeNotificationIdFromSearchParam } from "@/lib/notifications-client";
import {
  ensureWebPushSubscription,
  hasWebPushPublicKey,
  isWebPushSupported,
} from "@/lib/web-push";

const NAV_ITEMS: Array<{
  href: string;
  labelKey: string;
  icon: typeof ClipboardList;
  // Path prefixes this tab claims. Longest-prefix-wins, so a specific tab
  // like Messages can beat the generic Jobs ("/cleaner") root.
  matchPrefixes: string[];
}> = [
  {
    href: "/cleaner",
    labelKey: "common.jobs",
    icon: ClipboardList,
    matchPrefixes: ["/cleaner/jobs", "/cleaner/history", "/cleaner"],
  },
  {
    href: "/cleaner/messages",
    labelKey: "common.messages",
    icon: MessageCircle,
    matchPrefixes: ["/cleaner/messages"],
  },
  {
    href: "/cleaner/incidents",
    labelKey: "cleaner.incidentNav",
    icon: AlertTriangle,
    matchPrefixes: ["/cleaner/incidents"],
  },
  {
    href: "/cleaner/more",
    labelKey: "cleaner.more",
    icon: User,
    matchPrefixes: [
      "/cleaner/more",
      "/cleaner/settings",
      "/cleaner/notifications",
    ],
  },
];

function matchLength(prefixes: string[], pathname: string): number {
  let best = 0;
  for (const prefix of prefixes) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      if (prefix.length > best) best = prefix.length;
    }
  }
  return best;
}

function isNavItemActive(itemHref: string, pathname: string): boolean {
  let winnerHref: string | null = null;
  let winnerLength = 0;
  for (const candidate of NAV_ITEMS) {
    const length = matchLength(candidate.matchPrefixes, pathname);
    if (length > winnerLength) {
      winnerLength = length;
      winnerHref = candidate.href;
    }
  }
  return winnerHref === itemHref;
}

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
  const t = useTranslations();
  const { userId } = useAuth();
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
  const unreadMessageCount = useQuery(
    api.conversations.queries.getUnreadConversationCount,
    isConvexAuthenticated ? {} : "skip",
  );
  const assignedJobs = useQuery(
    api.cleaningJobs.queries.getMyAssigned,
    isConvexAuthenticated ? { limit: 200 } : "skip",
  ) as Array<{ status: string }> | undefined;
  const setThemePreference = useMutation(api.users.mutations.setThemePreference);
  const setLocalePreference = useMutation(api.users.mutations.setLocalePreference);
  const markNotificationRead = useMutation(api.users.mutations.markNotificationRead);
  const updateWebPushSubscription = useMutation(api.users.mutations.updateWebPushSubscription);
  const clearWebPushSubscription = useMutation(api.users.mutations.clearWebPushSubscription);
  const setThemePreferenceRef = useRef(setThemePreference);
  const setLocalePreferenceRef = useRef(setLocalePreference);
  const updateWebPushSubscriptionRef = useRef(updateWebPushSubscription);
  const clearWebPushSubscriptionRef = useRef(clearWebPushSubscription);
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
  // Use the true summary total emitted by the home client so the bell badge
  // always matches the summary card (avoids query-param mismatches).
  const [homeSummaryCount, setHomeSummaryCount] = useState(0);

  useEffect(() => {
    const handler = (event: Event) => {
      setHomeSummaryCount((event as CustomEvent<number>).detail);
    };
    window.addEventListener("cleaner:summary-count", handler);
    return () => window.removeEventListener("cleaner:summary-count", handler);
  }, []);

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
    setLocalePreferenceRef.current = setLocalePreference;
  }, [setLocalePreference]);

  useEffect(() => {
    updateWebPushSubscriptionRef.current = updateWebPushSubscription;
  }, [updateWebPushSubscription]);

  useEffect(() => {
    clearWebPushSubscriptionRef.current = clearWebPushSubscription;
  }, [clearWebPushSubscription]);

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

  // Source locale from next-intl so SSR and client agree on first paint.
  const currentLocale = useLocale() as Locale;

  const toggleLocale = useCallback(() => {
    const nextLocale: Locale = currentLocale === "en" ? "es" : "en";
    document.cookie = `NEXT_LOCALE=${nextLocale}; path=/; max-age=31536000`;

    if (isConvexAuthenticated) {
      void setLocalePreferenceRef.current({ locale: nextLocale }).catch((error) => {
        console.warn("[CleanerLocale] Failed to save locale in Convex", error);
      });
    }

    setTimeout(() => window.location.reload(), 300);
  }, [currentLocale, isConvexAuthenticated]);

  const title = useMemo(() => {
    if (!pathname) {
      return t("common.jobs");
    }
    if (pathname.startsWith("/cleaner/jobs/")) {
      return pathname.endsWith("/active") ? t("cleaner.activeJob") : t("cleaner.jobDetail");
    }
    if (pathname.startsWith("/cleaner/history")) {
      return t("cleaner.history");
    }
    if (pathname === "/cleaner/incidents/new") {
      return t("cleaner.incidentReport");
    }
    if (pathname.startsWith("/cleaner/incidents")) {
      return t("cleaner.incidents.title");
    }
    if (pathname.startsWith("/cleaner/settings")) {
      return t("common.settings");
    }
    if (pathname.startsWith("/cleaner/more")) {
      return t("cleaner.more");
    }
    if (pathname.startsWith("/cleaner/messages")) {
      return t("common.messages");
    }
    return t("cleaner.myJobs");
  }, [pathname, t]);

  const isPropertyDetail = pathname?.startsWith("/cleaner/properties/") ?? false;

  return (
    <div className="cleaner-theme cleaner-app-shell relative h-[100svh] overflow-hidden text-[15px] text-[var(--foreground)]">
      <header
        className={`fixed inset-x-0 top-0 z-40 px-3 py-3 transition-colors ${
          isPropertyDetail
            ? "bg-transparent"
            : "border-b border-[var(--border)] bg-white/92 backdrop-blur"
        }`}
      >
        <div className="mx-auto flex w-full max-w-[402px] items-center justify-between gap-3">
          <Link
            href="/cleaner"
            aria-label={t("cleaner.myJobs")}
            className="flex min-w-0 items-center gap-3 rounded-lg transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cleaner-primary)]"
          >
            <Image
              src="/icons/chezsoi-icon-192.png"
              alt="ChezSoiCleaning logo"
              width={32}
              height={32}
              className="h-8 w-8 shrink-0 rounded-md object-contain"
              priority
            />
            <div className="min-w-0">
              <h1 className="truncate font-[var(--font-cleaner-body)] text-[22px] font-bold leading-tight tracking-tight text-[var(--cleaner-ink)]">
                {title}
              </h1>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <div className="relative" ref={notificationPanelRef}>
              <button
                type="button"
                onClick={() => {
                  if (pathname === "/cleaner") {
                    setIsNotificationsOpen(false);
                    window.dispatchEvent(new Event("cleaner:toggle-summary"));
                    return;
                  }
                  setIsNotificationsOpen((prev) => !prev);
                }}
                className="cleaner-tool-button relative h-8 w-8 bg-[var(--cleaner-primary)] text-white"
                aria-label="Notifications"
                aria-expanded={isNotificationsOpen}
                aria-haspopup="dialog"
              >
                <Bell className="h-4.5 w-4.5" />
                {(pathname === "/cleaner" ? homeSummaryCount : unreadCount) > 0 ? (
                  <span className="absolute -right-1 -top-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-[var(--destructive)] px-1 text-[10px] font-bold text-white">
                    {(pathname === "/cleaner" ? homeSummaryCount : unreadCount) > 9
                      ? "9+"
                      : pathname === "/cleaner"
                        ? homeSummaryCount
                        : unreadCount}
                  </span>
                ) : null}
              </button>

              {isNotificationsOpen ? (
                <div className="fixed left-3 right-3 top-[calc(env(safe-area-inset-top)+6.5rem)] z-50 overflow-hidden rounded-[24px] border border-[var(--border)] bg-[var(--card)] shadow-[var(--cleaner-shadow)] sm:absolute sm:left-auto sm:right-0 sm:top-12 sm:w-[320px] sm:max-w-[calc(100vw-1rem)]">
                  <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
                    <p className="cleaner-card-title text-[18px]">{t("cleaner.shell.notifications")}</p>
                    <span className="cleaner-meta text-[10px] text-[var(--cleaner-muted)]">
                      {t("cleaner.shell.unreadCount", { count: unreadCount })}
                    </span>
                  </div>

                  <div className="max-h-80 overflow-y-auto">
                    {!isConvexAuthenticated ? (
                      <p className="px-3 py-4 text-sm text-[var(--muted-foreground)]">
                        {t("cleaner.shell.signInToView")}
                      </p>
                    ) : notifications === undefined ? (
                      <p className="px-3 py-4 text-sm text-[var(--muted-foreground)]">
                        {t("cleaner.shell.loadingNotifications")}
                      </p>
                    ) : visibleNotifications.length === 0 ? (
                      <p className="px-3 py-4 text-sm text-[var(--muted-foreground)]">
                        {t("cleaner.shell.noUnreadNotifications")}
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
                      {t("cleaner.shell.viewAllInSettings")}
                    </Link>
                  </div>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={toggleLocale}
              className="cleaner-tool-button h-8 w-8 bg-white text-[var(--cleaner-ink)]"
              aria-label={`Switch to ${localeNames[currentLocale === "en" ? "es" : "en"]}`}
              title={`Switch to ${localeNames[currentLocale === "en" ? "es" : "en"]}`}
              suppressHydrationWarning
            >
              <span
                className="font-[var(--font-cleaner-body)] text-[10px] font-bold uppercase"
                suppressHydrationWarning
              >
                {currentLocale}
              </span>
            </button>
          </div>
        </div>
      </header>

      <main
        className="fixed inset-x-0 z-10 overflow-y-auto px-3"
        style={{
          top: "calc(env(safe-area-inset-top) + 72px)",
          bottom: "max(env(safe-area-inset-bottom), 8px)",
        }}
      >
        <div className="mx-auto w-full max-w-[402px] pb-24">
          <InstallPrompt />
          {updateReady ? (
            <div className="cleaner-card mt-2 border-blue-500/60 bg-blue-500/10 p-3 text-xs text-blue-100">
              <p>{t("cleaner.shell.newVersionReady")}</p>
              <button
                type="button"
                className="mt-2 rounded-[10px] bg-blue-500 px-3 py-1.5 font-semibold text-white"
                onClick={() => {
                  if (!registration?.waiting) {
                    window.location.reload();
                    return;
                  }

                  registration.waiting.postMessage({ type: "SKIP_WAITING" });
                }}
              >
                {t("cleaner.shell.updateNow")}
              </button>
            </div>
          ) : null}
          {children}
        </div>
      </main>

      <nav
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 bg-transparent"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 6px)" }}
      >
        <ul className="pointer-events-auto mx-auto grid max-w-[402px] grid-cols-4 items-center justify-items-center gap-x-3 px-9 pb-2">
          {NAV_ITEMS.map((item) => {
            const isActive = isNavItemActive(item.href, pathname ?? "");
            const showMessageBadge =
              item.href === "/cleaner/messages" &&
              typeof unreadMessageCount === "number" &&
              unreadMessageCount > 0;
            return (
              <li key={item.href} className="list-none">
                <Link
                  href={item.href}
                  aria-label={t(item.labelKey)}
                  title={t(item.labelKey)}
                  className="block"
                >
                  <CleanerIconButton
                    icon={item.icon}
                    label={t(item.labelKey)}
                    active={isActive}
                    size="nav"
                    badge={showMessageBadge ? unreadMessageCount : undefined}
                    className="shadow-[0px_2px_8.2px_rgba(0,0,0,0.18)]"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
