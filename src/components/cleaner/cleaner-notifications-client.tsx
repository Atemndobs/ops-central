"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { api } from "@convex/_generated/api";
import { CleanerSection } from "@/components/cleaner/cleaner-ui";

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

type NotificationItem = {
  _id: string;
  type: string;
  title: string;
  message?: string;
  data?: unknown;
  createdAt: number;
  readAt?: number;
  dismissedAt?: number;
};

export function CleanerNotificationsClient() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const t = useTranslations();

  const notifications = useQuery(
    api.notifications.queries.getMyNotifications,
    isAuthenticated ? { includeRead: true, limit: 100 } : "skip",
  ) as NotificationItem[] | undefined;

  const markNotificationRead = useMutation(
    api.users.mutations.markNotificationRead,
  );

  const visible = useMemo(
    () => (notifications ?? []).filter((n) => !n.dismissedAt),
    [notifications],
  );
  const unreadCount = useMemo(
    () => visible.filter((n) => !n.readAt).length,
    [visible],
  );

  if (isLoading || !isAuthenticated) {
    return (
      <p className="px-1 py-6 text-sm text-[var(--muted-foreground)]">
        {t("cleaner.shell.signInToView")}
      </p>
    );
  }

  if (notifications === undefined) {
    return (
      <p className="px-1 py-6 text-sm text-[var(--muted-foreground)]">
        {t("cleaner.shell.loadingNotifications")}
      </p>
    );
  }

  if (visible.length === 0) {
    return (
      <CleanerSection
        eyebrow={t("cleaner.shell.notifications")}
        title={t("cleaner.shell.noUnreadNotifications")}
      >
        <p className="text-sm text-[var(--cleaner-muted)]">
          {t("cleaner.shell.noUnreadNotifications")}
        </p>
      </CleanerSection>
    );
  }

  return (
    <div className="space-y-3">
      <CleanerSection eyebrow={t("cleaner.shell.notifications")}>
        <p className="text-sm text-[var(--cleaner-muted)]">
          {t("cleaner.shell.unreadCount", { count: unreadCount })}
        </p>
      </CleanerSection>
      <div className="cleaner-card divide-y divide-[var(--border)]">
        {visible.map((notification) => (
          <Link
            key={notification._id}
            href={getCleanerNotificationHref(notification.type, notification.data)}
            onClick={() => {
              if (!notification.readAt) {
                void markNotificationRead({
                  id: notification._id as never,
                }).catch((error) => {
                  console.warn(
                    "[CleanerNotifications] Failed to mark item as read",
                    error,
                  );
                });
              }
            }}
            className="block px-4 py-3 hover:bg-[var(--accent)]"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 text-sm font-semibold text-[var(--cleaner-ink)]">
                {notification.title}
              </p>
              {!notification.readAt ? (
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--cleaner-primary)]" />
              ) : null}
            </div>
            {notification.message ? (
              <p className="mt-0.5 break-words text-xs text-[var(--cleaner-muted)]">
                {notification.message}
              </p>
            ) : null}
            <p className="mt-1 text-[11px] text-[var(--cleaner-muted)]">
              {formatNotificationTime(notification.createdAt)}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
