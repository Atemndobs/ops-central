"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser, useAuth } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import {
  LayoutDashboard,
  Calendar,
  ClipboardList,
  MessageSquare,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import {
  getRoleFromMetadata,
  getRoleFromSessionClaimsOrNull,
  type UserRole,
} from "@/lib/auth";
import { CleanerIconButton } from "@/components/cleaner/cleaner-ui";
import { cn } from "@/lib/utils";

type Tab = {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  roles: UserRole[];
  matchPrefixes: string[];
};

const TABS: Tab[] = [
  {
    href: "/",
    labelKey: "common.dashboard",
    icon: LayoutDashboard,
    roles: ["admin", "property_ops", "manager"],
    matchPrefixes: ["/"],
  },
  {
    href: "/schedule",
    labelKey: "common.schedule",
    icon: Calendar,
    roles: ["admin", "property_ops", "manager"],
    matchPrefixes: ["/schedule"],
  },
  {
    href: "/jobs",
    labelKey: "common.jobs",
    icon: ClipboardList,
    roles: ["admin", "property_ops", "manager", "cleaner"],
    matchPrefixes: ["/jobs", "/tasks", "/review"],
  },
  {
    href: "/messages",
    labelKey: "common.messages",
    icon: MessageSquare,
    roles: ["admin", "property_ops", "manager"],
    matchPrefixes: ["/messages"],
  },
];

// Remembers whether the user has tucked the nav away, so it stays hidden as they
// move between screens (and across reloads) until they pull it back.
const COLLAPSE_STORAGE_KEY = "opscentral:navCollapsed";

function matchLength(prefixes: string[], pathname: string): number {
  let best = 0;
  for (const prefix of prefixes) {
    if (prefix === "/") {
      if (pathname === "/") best = Math.max(best, 1);
      continue;
    }
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      if (prefix.length > best) best = prefix.length;
    }
  }
  return best;
}

export function MobileBottomNav() {
  const pathname = usePathname() ?? "";
  const t = useTranslations();
  const { isLoaded, isSignedIn, userId, sessionClaims } = useAuth();
  const { user } = useUser();
  const convexUser = useQuery(
    api.users.queries.getByClerkId,
    isLoaded && isSignedIn && userId ? { clerkId: userId } : "skip",
  );
  const unreadMessageCount = useQuery(
    api.conversations.queries.getUnreadConversationCount,
    convexUser?._id ? {} : "skip",
  );

  // Collapsed state is hydrated from localStorage after mount to avoid an
  // SSR/hydration mismatch. Default is expanded; one frame may show expanded
  // before the stored value applies, which is fine.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1");
    } catch {
      // Storage may be unavailable (private mode); default to expanded.
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Ignore storage failures; the in-memory state still toggles.
      }
      return next;
    });
  };

  const roleFromClaims = getRoleFromSessionClaimsOrNull(
    sessionClaims as Record<string, unknown> | null,
  );
  const roleFromMetadata = getRoleFromMetadata(user?.publicMetadata);
  const role: UserRole = roleFromClaims ?? roleFromMetadata ?? convexUser?.role ?? "manager";

  const visible = TABS.filter((tab) => tab.roles.includes(role));
  // The AI assistant is gated to admins/ops (same as AiChatPanel). When shown,
  // it takes the last nav slot — replacing the old "More" button, which just
  // duplicated the top-left hamburger drawer.
  const showChat = role === "admin" || role === "property_ops";
  const columns = visible.length + (showChat ? 1 : 0);

  const hasUnread =
    typeof unreadMessageCount === "number" && unreadMessageCount > 0;

  // Longest-prefix-wins so /jobs/abc stays on Jobs, not Dashboard.
  let activeHref: string | null = null;
  let bestLen = 0;
  for (const tab of visible) {
    const len = matchLength(tab.matchPrefixes, pathname);
    if (len > bestLen) {
      bestLen = len;
      activeHref = tab.href;
    }
  }

  return (
    <nav
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 bg-transparent md:hidden"
      // Lift the row off the very bottom (was `pb-2` on the pill) so the icons
      // and the chevron tab share one baseline.
      style={{ paddingBottom: "calc(max(env(safe-area-inset-bottom), 6px) + 8px)" }}
      aria-label="Primary navigation"
    >
      {/* pr-9 reserves a fixed right gutter for the chevron tab so it never
          overlaps the rightmost icon, in either state. */}
      <div className="relative mx-auto flex max-w-[480px] items-center pr-9">
        <ul
          aria-hidden={collapsed}
          className={cn(
            "grid flex-1 items-center justify-items-center gap-x-2 px-6 transition-all duration-200 ease-out motion-reduce:transition-none motion-reduce:duration-0",
            collapsed
              ? "pointer-events-none translate-x-[115%] opacity-0"
              : "pointer-events-auto translate-x-0 opacity-100",
          )}
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {visible.map((tab) => {
            const label = t(tab.labelKey);
            const isActive = activeHref === tab.href;
            const showBadge =
              tab.href === "/messages" &&
              typeof unreadMessageCount === "number" &&
              unreadMessageCount > 0;
            return (
              <li key={tab.href} className="list-none">
                <Link
                  href={tab.href}
                  aria-label={label}
                  title={label}
                  tabIndex={collapsed ? -1 : undefined}
                  className="block"
                >
                  <CleanerIconButton
                    icon={tab.icon}
                    label={label}
                    active={isActive}
                    size="nav"
                    badge={showBadge ? unreadMessageCount : undefined}
                    className="shadow-[0px_2px_8.2px_rgba(0,0,0,0.18)]"
                  />
                </Link>
              </li>
            );
          })}
          {showChat ? (
            <li className="list-none">
              <button
                type="button"
                aria-label={t("common.assistant")}
                title={t("common.assistant")}
                tabIndex={collapsed ? -1 : undefined}
                className="block"
                onClick={() => window.dispatchEvent(new Event("opscentral:open-ai-chat"))}
              >
                <CleanerIconButton
                  icon={Sparkles}
                  label={t("common.assistant")}
                  active={false}
                  size="nav"
                  className="shadow-[0px_2px_8.2px_rgba(0,0,0,0.18)]"
                />
              </button>
            </li>
          ) : null}
        </ul>

        {/* Chevron tab, always present on the right edge. Collapses the pill to
            the right (›) and pulls it back (‹). Shows an unread dot when the nav
            is tucked away so hidden message badges aren't missed. */}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Show navigation" : "Hide navigation"}
          className="pointer-events-auto absolute inset-y-0 right-1 my-auto flex h-11 w-7 items-center justify-center rounded-full border border-black/5 bg-white text-[var(--cleaner-primary)] shadow-[0px_2px_8.2px_rgba(0,0,0,0.18)]"
        >
          {collapsed ? (
            <ChevronLeft className="h-5 w-5" />
          ) : (
            <ChevronRight className="h-5 w-5" />
          )}
          {collapsed && hasUnread ? (
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[var(--destructive)] ring-2 ring-white" />
          ) : null}
        </button>
      </div>
    </nav>
  );
}
