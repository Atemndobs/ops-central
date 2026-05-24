"use client";

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
  MoreHorizontal,
  type LucideIcon,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import {
  getRoleFromMetadata,
  getRoleFromSessionClaimsOrNull,
  type UserRole,
} from "@/lib/auth";
import { CleanerIconButton } from "@/components/cleaner/cleaner-ui";

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

  const roleFromClaims = getRoleFromSessionClaimsOrNull(
    sessionClaims as Record<string, unknown> | null,
  );
  const roleFromMetadata = getRoleFromMetadata(user?.publicMetadata);
  const role: UserRole = roleFromClaims ?? roleFromMetadata ?? convexUser?.role ?? "manager";

  const visible = TABS.filter((tab) => tab.roles.includes(role));

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
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 6px)" }}
      aria-label="Primary navigation"
    >
      <ul className="pointer-events-auto mx-auto grid max-w-[480px] grid-cols-5 items-center justify-items-center gap-x-2 px-6 pb-2">
        {visible.map((tab) => {
          const label = t(tab.labelKey);
          const isActive = activeHref === tab.href;
          const showBadge =
            tab.href === "/messages" &&
            typeof unreadMessageCount === "number" &&
            unreadMessageCount > 0;
          return (
            <li key={tab.href} className="list-none">
              <Link href={tab.href} aria-label={label} title={label} className="block">
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
        <li className="list-none">
          <button
            type="button"
            aria-label="More"
            title="More"
            className="block"
            onClick={() => window.dispatchEvent(new Event("opscentral:open-mobile-menu"))}
          >
            <CleanerIconButton
              icon={MoreHorizontal}
              label="More"
              active={false}
              size="nav"
              className="shadow-[0px_2px_8.2px_rgba(0,0,0,0.18)]"
            />
          </button>
        </li>
      </ul>
    </nav>
  );
}
