"use client";

import { useMutation } from "convex/react";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

export function useConsumeNotificationIdFromSearchParam(enabled: boolean) {
  const pathname = usePathname();
  const markNotificationRead = useMutation(api.users.mutations.markNotificationRead);
  const handledNotificationIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    const notificationId = searchParams.get("notificationId");
    if (!enabled || !notificationId || handledNotificationIdRef.current === notificationId) {
      return;
    }

    handledNotificationIdRef.current = notificationId;
    let cancelled = false;

    void markNotificationRead({
      id: notificationId as Id<"notifications">,
    })
      .catch((error) => {
        console.warn("[Notifications] Failed to mark deep-linked notification as read", error);
      })
      .finally(() => {
        if (cancelled) {
          return;
        }

        const nextSearchParams = new URLSearchParams(searchParams.toString());
        nextSearchParams.delete("notificationId");
        const nextQuery = nextSearchParams.toString();
        const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;
        window.history.replaceState(window.history.state, "", nextUrl);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, markNotificationRead, pathname]);
}
