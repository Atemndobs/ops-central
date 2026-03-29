"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { clearPendingUploads, listPendingUploads } from "@/features/cleaner/offline/indexeddb";

export function CleanerSettingsClient() {
  const notifications = useQuery(api.notifications.queries.getMyNotifications, {
    includeRead: true,
    limit: 20,
  }) as
    | Array<{ _id: string; title: string; message: string; createdAt: number; readAt?: number }>
    | undefined;

  const [pendingUploads, setPendingUploads] = useState(0);

  useEffect(() => {
    let active = true;
    void listPendingUploads().then((items) => {
      if (!active) return;
      setPendingUploads(items.length);
    });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-base font-semibold">Offline Sync</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Pending uploads in queue: <span className="font-semibold text-[var(--foreground)]">{pendingUploads}</span>
        </p>
        <button
          type="button"
          className="mt-3 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs"
          onClick={async () => {
            await clearPendingUploads();
            setPendingUploads(0);
          }}
        >
          Clear Offline Queue
        </button>
      </section>

      <section className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-base font-semibold">Recent Notifications</h2>
        {notifications === undefined ? (
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">Loading notifications...</p>
        ) : notifications.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">No notifications yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {notifications.map((notification) => (
              <li key={notification._id} className="rounded-md border border-[var(--border)] p-2">
                <p className="text-sm font-semibold">{notification.title}</p>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">{notification.message}</p>
                <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                  {new Date(notification.createdAt).toLocaleString()} · {notification.readAt ? "Read" : "Unread"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
