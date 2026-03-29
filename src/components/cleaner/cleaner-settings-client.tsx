"use client";

import { useAuth } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@convex/_generated/api";
import { clearPendingUploads, listPendingUploads } from "@/features/cleaner/offline/indexeddb";

const THEME_STORAGE_KEY = "opscentral-theme";

type ThemePreference = "dark" | "light";

function applyTheme(theme: ThemePreference) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function CleanerSettingsClient() {
  const { signOut } = useAuth();
  const { isAuthenticated: isConvexAuthenticated } = useConvexAuth();
  const themePreference = useQuery(
    api.users.queries.getThemePreference,
    isConvexAuthenticated ? {} : "skip",
  );
  const setThemePreference = useMutation(api.users.mutations.setThemePreference);
  const notifications = useQuery(api.notifications.queries.getMyNotifications, {
    includeRead: true,
    limit: 20,
  }) as
    | Array<{ _id: string; title: string; message: string; createdAt: number; readAt?: number }>
    | undefined;

  const [pendingUploads, setPendingUploads] = useState(0);
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
    let active = true;
    void listPendingUploads().then((items) => {
      if (!active) return;
      setPendingUploads(items.length);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    applyTheme(resolvedTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, resolvedTheme);
  }, [resolvedTheme]);

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-base font-semibold">Account</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs"
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
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs"
            onClick={async () => {
              await signOut();
              window.location.href = "/sign-in";
            }}
          >
            Sign Out
          </button>
        </div>
      </section>

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
