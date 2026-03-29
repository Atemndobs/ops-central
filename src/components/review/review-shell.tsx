"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { useQuery } from "convex/react";
import { UserButton } from "@clerk/nextjs";
import { api } from "@convex/_generated/api";
import { Bell, ClipboardCheck, ExternalLink } from "lucide-react";

const NAV_ITEMS = [
  { href: "/review", label: "Review Queue", icon: ClipboardCheck },
];

export function ReviewShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const notifications = useQuery(api.notifications.queries.getMyNotifications, {
    includeRead: false,
    limit: 20,
  });

  const unreadCount = useMemo(() => {
    if (!notifications) {
      return 0;
    }
    return notifications.filter((item) => item.readAt === undefined).length;
  }, [notifications]);

  const title = useMemo(() => {
    if (!pathname || pathname === "/review") {
      return "Review Queue";
    }
    if (pathname.includes("/photos-review")) {
      return "Photo Review";
    }
    if (pathname.startsWith("/review/jobs/")) {
      return "Job Review";
    }
    return "Reviewer";
  }, [pathname]);

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--card)]/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted-foreground)]">OpsCentral</p>
            <h1 className="text-lg font-semibold">{title}</h1>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/jobs"
              className="hidden items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] md:flex"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open Admin Jobs
            </Link>
            <div className="flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs">
              <Bell className="h-3.5 w-3.5" />
              <span>{notifications === undefined ? "..." : unreadCount}</span>
            </div>
            <UserButton />
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden rounded-lg border border-[var(--border)] bg-[var(--card)] p-2 md:block">
          <ul className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`flex items-center gap-2 rounded-md px-2 py-2 text-sm ${
                      active
                        ? "bg-[var(--primary)]/15 text-[var(--foreground)]"
                        : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </aside>

        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
