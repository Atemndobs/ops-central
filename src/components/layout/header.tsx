"use client";

import { UserButton, useAuth, useUser } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@convex/_generated/api";
import { Bell, LogOut, Menu, Moon, Settings, Sun, X } from "lucide-react";
import {
  canAccessPath,
  getRoleFromMetadata,
  getRoleFromSessionClaimsOrNull,
  type UserRole,
} from "@/lib/auth";
import { useConsumeNotificationIdFromSearchParam } from "@/lib/notifications-client";
import { cn } from "@/lib/utils";
import { navigation } from "@/components/layout/navigation";

const pageTitles: Record<string, string> = {
  "/": "Dashboard",
  "/schedule": "Schedule",
  "/jobs": "Jobs",
  "/properties": "Properties",
  "/companies": "Companies",
  "/team": "Team",
  "/inventory": "Inventory",
  "/work-orders": "Work Orders",
  "/reports": "Reports",
  "/settings": "Settings",
};

const THEME_STORAGE_KEY = "opscentral-theme";
const THEME_CHANGE_EVENT = "opscentral:theme-change";
type ThemePreference = "dark" | "light";

function readClientThemePreference(): ThemePreference {
  if (typeof window === "undefined") {
    return "light";
  }

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "dark" || stored === "light") {
    return stored;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function subscribeToThemePreference(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handleStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) {
      onStoreChange();
    }
  };
  const handleThemeChange = () => onStoreChange();

  window.addEventListener("storage", handleStorage);
  window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);

  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", handleThemeChange);
  } else {
    mediaQuery.addListener(handleThemeChange);
  }

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    if (typeof mediaQuery.removeEventListener === "function") {
      mediaQuery.removeEventListener("change", handleThemeChange);
    } else {
      mediaQuery.removeListener(handleThemeChange);
    }
  };
}

function getThemeServerSnapshot(): ThemePreference {
  return "light";
}

function applyTheme(theme: ThemePreference) {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function Header() {
  const pathname = usePathname();
  const { isLoaded, isSignedIn, userId, sessionClaims, signOut } = useAuth();
  const { user } = useUser();
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const theme = useSyncExternalStore(
    subscribeToThemePreference,
    readClientThemePreference,
    getThemeServerSnapshot,
  );
  const isDarkMode = theme === "dark";
  const notificationPanelRef = useRef<HTMLDivElement | null>(null);
  const setThemePreference = useMutation(api.users.mutations.setThemePreference);
  const markNotificationRead = useMutation(api.users.mutations.markNotificationRead);
  const setThemePreferenceRef = useRef(setThemePreference);

  useEffect(() => {
    setThemePreferenceRef.current = setThemePreference;
  }, [setThemePreference]);

  const convexUser = useQuery(
    api.users.queries.getByClerkId,
    isLoaded && isSignedIn && userId ? { clerkId: userId } : "skip",
  );
  const roleFromClaims = getRoleFromSessionClaimsOrNull(
    sessionClaims as Record<string, unknown> | null,
  );
  const roleFromMetadata = getRoleFromMetadata(user?.publicMetadata);
  const role: UserRole = roleFromClaims ?? roleFromMetadata ?? convexUser?.role ?? "manager";
  const canViewSettings = isLoaded && canAccessPath(role, "/settings");
  const mobileNavigation = navigation.filter((item) => item.roles.includes(role));

  useConsumeNotificationIdFromSearchParam(Boolean(convexUser?._id));

  const notifications = useQuery(
    api.notifications.queries.getUserNotifications,
    convexUser?._id
      ? {
          userId: convexUser._id,
          includeRead: true,
          limit: 10,
        }
      : "skip",
  );

  const isNotificationsLoading =
    (isLoaded && isSignedIn && Boolean(userId) && convexUser === undefined) ||
    (Boolean(convexUser?._id) && notifications === undefined);

  const unreadCount = useMemo(() => {
    return (notifications ?? []).filter(
      (item) => !item.readAt && !item.dismissedAt,
    ).length;
  }, [notifications]);
  const visibleNotifications = useMemo(() => {
    return (notifications ?? []).filter(
      (item) => !item.readAt && !item.dismissedAt,
    );
  }, [notifications]);

  const toggleTheme = useCallback(() => {
    const nextTheme: ThemePreference = isDarkMode ? "light" : "dark";
    applyTheme(nextTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));

    if (isLoaded && isSignedIn) {
      void setThemePreferenceRef.current({ theme: nextTheme }).catch((error) => {
        console.warn("[ThemePreference] Failed to save theme in Convex", error);
      });
    }
  }, [isDarkMode, isLoaded, isSignedIn]);

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

  const title = getPageTitle(pathname);

  return (
    <>
      <header className="flex h-16 items-center justify-between border-b bg-[var(--card)]/90 px-6 backdrop-blur-md">
        <div className="flex items-center gap-4 md:gap-8">
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(true)}
            className="rounded-none p-2 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] md:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <span className="truncate text-base font-black tracking-tight md:text-lg">{title}</span>

          <nav className="hidden items-center gap-6 md:flex">
            <Link href="/" className="text-sm font-bold text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
              Dashboard
            </Link>
            <Link href="/reports" className="text-sm font-bold text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
              Reports
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative" ref={notificationPanelRef}>
            <button
              type="button"
              onClick={() => setIsNotificationsOpen((prev) => !prev)}
              className="relative rounded-none p-2 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              aria-label="Notifications"
              aria-expanded={isNotificationsOpen}
              aria-haspopup="dialog"
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 ? (
                <span className="absolute -right-1 -top-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-[var(--destructive)] px-1 text-[10px] font-bold text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              ) : null}
            </button>

            {isNotificationsOpen ? (
              <div className="absolute right-0 top-11 z-50 w-[320px] max-w-[calc(100vw-1rem)] overflow-hidden rounded-md border bg-[var(--card)] shadow-xl">
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <p className="text-sm font-semibold">Notifications</p>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {unreadCount} unread
                  </span>
                </div>

                <div className="max-h-80 overflow-y-auto">
                  {!isSignedIn ? (
                    <p className="px-3 py-4 text-sm text-[var(--muted-foreground)]">
                      Sign in to view notifications.
                    </p>
                  ) : isNotificationsLoading ? (
                    <p className="px-3 py-4 text-sm text-[var(--muted-foreground)]">
                      Loading notifications...
                    </p>
                  ) : !visibleNotifications.length ? (
                    <p className="px-3 py-4 text-sm text-[var(--muted-foreground)]">
                      No unread notifications.
                    </p>
                  ) : (
                    <div className="divide-y">
                      {visibleNotifications.map((notification) => {
                        const href = getNotificationHref(
                          notification.type,
                          notification.data,
                        );

                        return (
                          <Link
                            key={notification._id}
                            href={href}
                            onClick={() => {
                              setIsNotificationsOpen(false);
                              if (!notification.readAt && !notification.dismissedAt) {
                                void markNotificationRead({ id: notification._id }).catch((error) => {
                                  console.warn("[Notifications] Failed to mark header item as read", error);
                                });
                              }
                            }}
                            className="block px-3 py-2 hover:bg-[var(--accent)]"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-semibold">{notification.title}</p>
                              {!notification.readAt && !notification.dismissedAt ? (
                                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--primary)]" />
                              ) : null}
                            </div>
                            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                              {notification.message}
                            </p>
                            <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                              {formatNotificationTime(notification.createdAt)}
                            </p>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="border-t px-3 py-2">
                  <Link
                    href="/settings?tab=notifications"
                    onClick={() => setIsNotificationsOpen(false)}
                    className="text-xs font-medium text-[var(--primary)] hover:opacity-80"
                  >
                    Notification settings
                  </Link>
                </div>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            className="rounded-none p-2 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            aria-label={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
            title={isDarkMode ? "Light mode" : "Dark mode"}
          >
            {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          {isSignedIn ? (
            <div className="flex items-center">
              <UserButton signInUrl="/sign-in" />
            </div>
          ) : null}

          {canViewSettings ? (
            <Link
              href="/settings"
              className="relative rounded-none p-2 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              aria-label="Settings"
              title="Settings"
            >
              <Settings className="h-4 w-4" />
            </Link>
          ) : null}
        </div>
      </header>

      {isMobileMenuOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(false)}
            className="absolute inset-0 bg-black/50"
            aria-label="Close mobile menu backdrop"
          />

          <aside className="relative z-10 flex h-full w-80 max-w-[85vw] flex-col border-r bg-[var(--card)]">
            <div className="flex items-center justify-between border-b px-4 py-4">
              <p className="text-lg font-black tracking-tight">Menu</p>
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(false)}
                className="rounded-none p-2 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                aria-label="Close mobile menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
              {mobileNavigation.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/" && pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-none px-3 py-3 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                        : "text-[var(--accent-foreground)] opacity-80 hover:bg-[var(--accent)] hover:opacity-100",
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.name}
                  </Link>
                );
              })}
            </nav>

            <div className="space-y-1 border-t px-3 py-3">
              <button
                type="button"
                onClick={toggleTheme}
                className="flex w-full items-center gap-3 rounded-none px-3 py-3 text-sm text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              >
                {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                {isDarkMode ? "Light Mode" : "Dark Mode"}
              </button>

              <button
                type="button"
                onClick={async () => {
                  setIsMobileMenuOpen(false);
                  await signOut();
                  window.location.href = "/sign-in";
                }}
                className="flex w-full items-center gap-3 rounded-none px-3 py-3 text-sm text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

function getPageTitle(pathname: string) {
  if (/^\/jobs\/[^/]+\/photos-review$/.test(pathname)) {
    return "Photo Review";
  }

  return (
    pageTitles[pathname] ||
    Object.entries(pageTitles).find(([key]) =>
      key !== "/" && pathname.startsWith(key),
    )?.[1] ||
    "ChezSoi"
  );
}

function getNotificationHref(type: string, data: unknown): string {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const jobId = (data as { jobId?: unknown }).jobId;
    if (typeof jobId === "string" && jobId.length > 0) {
      return `/jobs/${jobId}`;
    }
  }

  if (type === "low_stock") return "/inventory";
  if (type === "incident_created") return "/work-orders";
  return "/reports";
}

function formatNotificationTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
