"use client";

import { useAuth } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardList,
  History,
  AlertTriangle,
  Settings,
  Wifi,
  WifiOff,
  LogOut,
  Moon,
  Sun,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import { InstallPrompt } from "@/components/cleaner/install-prompt";

const NAV_ITEMS = [
  { href: "/cleaner", label: "Jobs", icon: ClipboardList },
  { href: "/cleaner/history", label: "History", icon: History },
  { href: "/cleaner/incidents/new", label: "Incident", icon: AlertTriangle },
  { href: "/cleaner/settings", label: "Settings", icon: Settings },
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

export function CleanerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { signOut, userId } = useAuth();
  const { isAuthenticated: isConvexAuthenticated, isLoading: isConvexAuthLoading } =
    useConvexAuth();
  const themePreference = useQuery(
    api.users.queries.getThemePreference,
    isConvexAuthenticated ? {} : "skip",
  );
  const setThemePreference = useMutation(api.users.mutations.setThemePreference);
  const [isOnline, setIsOnline] = useState(true);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [localTheme, setLocalTheme] = useState<ThemePreference>(() =>
    readClientThemePreference(),
  );
  const initializedThemeScopeRef = useRef<string | null>(null);
  const themeScopeKey = isConvexAuthenticated
    ? `auth:${userId ?? "unknown"}`
    : "anon";
  const resolvedTheme: ThemePreference =
    isConvexAuthenticated && themePreference?.theme
      ? themePreference.theme
      : localTheme;
  const isDarkMode = resolvedTheme === "dark";

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
      void setThemePreference({ theme: resolvedTheme }).catch((error) => {
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
    setThemePreference,
    themePreference,
    themeScopeKey,
  ]);

  const toggleTheme = useCallback(() => {
    const nextTheme: ThemePreference = resolvedTheme === "dark" ? "light" : "dark";
    setLocalTheme(nextTheme);
    applyTheme(nextTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);

    if (isConvexAuthenticated) {
      void setThemePreference({ theme: nextTheme }).catch((error) => {
        console.warn("[CleanerTheme] Failed to save theme in Convex", error);
      });
    }
  }, [isConvexAuthenticated, resolvedTheme, setThemePreference]);

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
    return "My Jobs";
  }, [pathname]);

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--card)]/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">OpsCentral</p>
            <h1 className="text-base font-semibold">{title}</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs">
              {isOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
              <span>{isOnline ? "Online" : "Offline"}</span>
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-md border border-[var(--border)] p-2 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              aria-label={isDarkMode ? "Switch to light theme" : "Switch to dark theme"}
              title={isDarkMode ? "Light Mode" : "Dark Mode"}
            >
              {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={async () => {
                await signOut();
                window.location.href = "/sign-in";
              }}
              className="rounded-md border border-[var(--border)] p-2 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="mt-3">
          <InstallPrompt />
        </div>
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
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-4">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--border)] bg-[var(--card)]/95 backdrop-blur">
        <ul className="mx-auto grid max-w-2xl grid-cols-4">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex flex-col items-center justify-center gap-1 px-2 py-3 text-xs ${
                    isActive ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]"
                  }`}
                >
                  <item.icon className="h-4 w-4" />
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
