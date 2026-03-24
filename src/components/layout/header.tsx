"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Bell, Settings } from "lucide-react";

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
        <button className="relative rounded-none p-2 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]">
          <Bell className="h-4 w-4" />
        </button>
        <button className="relative rounded-none p-2 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]">
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
