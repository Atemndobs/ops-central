"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { UserButton, useAuth, useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { api } from "@convex/_generated/api";
import { cn } from "@/lib/utils";
import {
  getRoleFromMetadata,
  getRoleFromSessionClaimsOrNull,
  type UserRole,
} from "@/lib/auth";
import { navigation } from "@/components/layout/navigation";
import {
  HelpCircle,
  LogOut,
  Menu,
  X,
} from "lucide-react";

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
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function Sidebar() {
  const pathname = usePathname();
  const t = useTranslations();
  const { isLoaded, isSignedIn, userId, sessionClaims, signOut } = useAuth();
  const { user } = useUser();
  const { isAuthenticated: isConvexAuthenticated, isLoading: isConvexAuthLoading } =
    useConvexAuth();
  const themePreference = useQuery(
    api.users.queries.getThemePreference,
    isConvexAuthenticated ? {} : "skip",
  );
  const setThemePreference = useMutation(api.users.mutations.setThemePreference);
  const setThemePreferenceRef = useRef(setThemePreference);
  const convexUser = useQuery(
    api.users.queries.getByClerkId,
    isLoaded && isSignedIn && userId && isConvexAuthenticated
      ? { clerkId: userId }
      : "skip",
  );
  const unreadMessageCount = useQuery(
    api.conversations.queries.getUnreadConversationCount,
    isConvexAuthenticated ? {} : "skip",
  );
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const localTheme = useSyncExternalStore(
    subscribeToThemePreference,
    readClientThemePreference,
    getThemeServerSnapshot,
  );
  const initializedThemeScopeRef = useRef<string | null>(null);
  const roleFromClaims = getRoleFromSessionClaimsOrNull(
    sessionClaims as Record<string, unknown> | null,
  );
  const roleFromMetadata = getRoleFromMetadata(user?.publicMetadata);
  const role: UserRole = roleFromClaims ?? roleFromMetadata ?? convexUser?.role ?? "manager";
  const resolvedTheme: ThemePreference =
    isConvexAuthenticated && themePreference?.theme
      ? themePreference.theme
      : localTheme;
  const isDarkMode = resolvedTheme === "dark";
  const roleLabel: Record<UserRole, string> = {
    admin: t("roles.admin"),
    property_ops: t("roles.property_ops"),
    manager: t("roles.manager"),
    cleaner: t("roles.cleaner"),
  };
  const quickLinks = navigation
    .filter((item) => item.roles.includes(role))
    .slice(0, 5);
  const themeScopeKey = isConvexAuthenticated
    ? `auth:${user?.id ?? "unknown"}`
    : "anon";

  useEffect(() => {
    setThemePreferenceRef.current = setThemePreference;
  }, [setThemePreference]);

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
    initializedThemeScopeRef.current = themeScopeKey;

    if (isConvexAuthenticated && !themePreference?.theme) {
      void setThemePreferenceRef.current({ theme: resolvedTheme }).catch((error) => {
        console.warn("[ThemePreference] Failed to initialize theme in Convex", error);
      });
    }
  }, [
    isConvexAuthenticated,
    isConvexAuthLoading,
    themePreference,
    themeScopeKey,
    resolvedTheme,
  ]);

  const toggleTheme = useCallback(() => {
    const nextTheme: ThemePreference = resolvedTheme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));

    if (isConvexAuthenticated) {
      void setThemePreferenceRef.current({ theme: nextTheme }).catch((error) => {
        console.warn("[ThemePreference] Failed to save theme in Convex", error);
      });
    }
  }, [isConvexAuthenticated, resolvedTheme]);

  return (
    <aside
      className={cn(
        "hidden flex-col border-r bg-[var(--card)] transition-all duration-200 md:flex",
        isCollapsed ? "w-24" : "w-[var(--sidebar-width)]",
      )}
    >
      <div className={cn("pb-4 pt-6", isCollapsed ? "px-2" : "px-6")}>
        <div className={cn("flex items-center", isCollapsed ? "justify-center" : "gap-3")}>
          <Image
            src="https://chezsoistays.com/wp-content/uploads/2026/02/cropped-chezsoi_favicon@2x.png"
            alt="ChezSoi logo"
            width={44}
            height={44}
            className="h-11 w-11 bg-[var(--primary)] p-2 object-contain"
            priority
          />
          {!isCollapsed ? <p className="text-3xl font-black tracking-tighter">ChezSoi</p> : null}
        </div>
        {!isCollapsed ? (
          <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
            {t("nav.operationsManagement")}
          </p>
        ) : null}
      </div>

      <nav
        className={cn(
          "flex-1 py-2",
          isCollapsed ? "space-y-3 px-2" : "space-y-1 px-4",
        )}
      >
        {navigation.filter((item) => item.roles.includes(role)).map((item) => {
          const label = t(item.nameKey);
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          const showBadge = item.href === "/messages" && typeof unreadMessageCount === "number" && unreadMessageCount > 0;
          return (
            <Link
              key={item.nameKey}
              href={item.href}
              className={cn(
                "relative flex rounded-none transition-colors",
                isCollapsed
                  ? "mx-auto h-11 w-11 items-center justify-center"
                  : "items-center gap-3 px-3 py-2.5 text-sm font-medium",
                isActive
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "text-[var(--accent-foreground)] opacity-70 hover:opacity-100 hover:bg-[var(--accent)]",
              )}
              title={isCollapsed ? label : undefined}
            >
              <span className="relative">
                <item.icon className={cn(isCollapsed ? "h-6 w-6" : "h-4 w-4")} />
                {showBadge && isCollapsed ? (
                  <span className="absolute -right-1.5 -top-1.5 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-[var(--destructive)] px-0.5 text-[9px] font-bold text-white">
                    {unreadMessageCount > 9 ? "9+" : unreadMessageCount}
                  </span>
                ) : null}
              </span>
              {!isCollapsed ? (
                <>
                  <span className="flex-1">{label}</span>
                  {showBadge ? (
                    <span className="inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-[var(--destructive)] px-1 text-[10px] font-bold text-white">
                      {unreadMessageCount > 9 ? "9+" : unreadMessageCount}
                    </span>
                  ) : null}
                </>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className={cn("border-t py-4", isCollapsed ? "px-2" : "px-4")}>
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => setIsHelpOpen(true)}
            className={cn(
              "flex w-full rounded-none text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
              isCollapsed
                ? "mx-auto h-11 w-11 items-center justify-center"
                : "items-center gap-3 px-3 py-2.5 text-sm",
            )}
            title={isCollapsed ? t("nav.help") : undefined}
          >
            <HelpCircle className={cn(isCollapsed ? "h-6 w-6" : "h-4 w-4")} />
            {!isCollapsed ? t("nav.help") : null}
          </button>
          <button
            type="button"
            onClick={async () => {
              await signOut();
              window.location.href = "/sign-in";
            }}
            className={cn(
              "flex w-full rounded-none text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
              isCollapsed
                ? "mx-auto h-11 w-11 items-center justify-center"
                : "items-center gap-3 px-3 py-2.5 text-sm",
            )}
            title={isCollapsed ? t("common.logout") : undefined}
          >
            <LogOut className={cn(isCollapsed ? "h-6 w-6" : "h-4 w-4")} />
            {!isCollapsed ? t("common.logout") : null}
          </button>
          <button
            type="button"
            onClick={() => setIsCollapsed((prev) => !prev)}
            className={cn(
              "flex w-full rounded-none border-2 border-[#1d62d5] text-[#1d62d5] transition-colors hover:bg-[#1d62d5]/10",
              isCollapsed
                ? "mx-auto h-11 w-11 items-center justify-center"
                : "items-center gap-3 px-3 py-2.5 text-sm",
            )}
            title={isCollapsed ? t("nav.expandSidebar") : undefined}
          >
            <Menu className={cn(isCollapsed ? "h-6 w-6" : "h-4 w-4")} />
            {!isCollapsed ? t("nav.collapse") : null}
          </button>
        </div>

        {!isCollapsed ? (
          <div className="mt-4 flex items-center justify-between rounded-none px-2 py-2 hover:bg-[var(--accent)]">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {user?.fullName || user?.primaryEmailAddress?.emailAddress || "User"}
              </p>
              <p className="truncate text-xs text-[var(--muted-foreground)]">
                {roleLabel[role]}
              </p>
            </div>
            <UserButton signInUrl="/sign-in" />
          </div>
        ) : null}
      </div>

      {isHelpOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setIsHelpOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl border bg-[var(--card)] p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">{t("nav.helpTitle")}</h3>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  {t("nav.helpDescription")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsHelpOpen(false)}
                className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                aria-label="Close help"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {quickLinks.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsHelpOpen(false)}
                  className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-[var(--accent)]"
                >
                  <item.icon className="h-4 w-4 text-[var(--muted-foreground)]" />
                  <span>{t(item.nameKey)}</span>
                </Link>
              ))}
            </div>

            <div className="mt-4 rounded-md border border-dashed px-3 py-2 text-xs text-[var(--muted-foreground)]">
              {t("nav.helpSettingsHint")}
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
