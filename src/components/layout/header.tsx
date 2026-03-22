"use client";

import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";

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
    "OpsCentral";

  return (
    <header className="flex h-14 items-center justify-between border-b border-[var(--border)] px-4 md:px-6">
      <h1 className="truncate text-base font-semibold md:text-lg">{title}</h1>
      <div className="flex items-center gap-4">
        <button className="relative rounded-md p-2 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]">
          <Bell className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
