"use client";

import { useAuth } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import { Bell, Settings } from "lucide-react";
import { canAccessPath, getRoleFromSessionClaims } from "@/lib/auth";

const pageTitles: Record<string, string> = {
  "/": "Dashboard",
  "/schedule": "Schedule",
  "/jobs": "Jobs",
  "/properties": "Properties",
  "/team": "Team",
  "/inventory": "Inventory",
  "/work-orders": "Work Orders",
  "/reports": "Reports",
  "/settings": "Settings",
};

export function Header() {
  const pathname = usePathname();
  const { isLoaded, isSignedIn, userId, sessionClaims } = useAuth();
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const notificationPanelRef = useRef<HTMLDivElement | null>(null);
  const role = getRoleFromSessionClaims(
    sessionClaims as Record<string, unknown> | null,
  );
  const canViewSettings = isLoaded && canAccessPath(role, "/settings");

  const convexUser = useQuery(
    api.users.queries.getByClerkId,
    isLoaded && isSignedIn && userId ? { clerkId: userId } : "skip",
  );

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

  const title =
    pageTitles[pathname] ||
    Object.entries(pageTitles).find(([key]) =>
      key !== "/" && pathname.startsWith(key),
    )?.[1] ||
    "ChezSoi";

  return (
    <header className="flex h-16 items-center justify-between border-b bg-[var(--card)]/90 px-6 backdrop-blur-md">
      <div className="flex items-center gap-8">
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
            <div className="absolute right-0 top-11 z-50 w-80 rounded-md border bg-[var(--card)] shadow-xl">
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
                ) : !notifications?.length ? (
                  <p className="px-3 py-4 text-sm text-[var(--muted-foreground)]">
                    No notifications yet.
                  </p>
                ) : (
                  <div className="divide-y">
                    {notifications.map((notification) => {
                      const href = getNotificationHref(
                        notification.type,
                        notification.data,
                      );

                      return (
                        <Link
                          key={notification._id}
                          href={href}
                          onClick={() => setIsNotificationsOpen(false)}
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
