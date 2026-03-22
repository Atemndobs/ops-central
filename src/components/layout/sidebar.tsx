"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton, useAuth, useUser } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import { getRoleFromSessionClaims, type UserRole } from "@/lib/auth";
import {
  LayoutDashboard,
  Calendar,
  ClipboardList,
  Building2,
  Users,
  Package,
  Wrench,
  BarChart3,
  Settings,
} from "lucide-react";

const navigation = [
  {
    name: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
    roles: ["admin", "property_ops", "manager"],
  },
  {
    name: "Schedule",
    href: "/schedule",
    icon: Calendar,
    roles: ["admin", "property_ops"],
  },
  {
    name: "Jobs",
    href: "/jobs",
    icon: ClipboardList,
    roles: ["admin", "property_ops", "manager"],
  },
  {
    name: "Properties",
    href: "/properties",
    icon: Building2,
    roles: ["admin", "property_ops", "manager"],
  },
  {
    name: "Team",
    href: "/team",
    icon: Users,
    roles: ["admin", "property_ops", "manager"],
  },
  {
    name: "Inventory",
    href: "/inventory",
    icon: Package,
    roles: ["admin"],
  },
  {
    name: "Work Orders",
    href: "/work-orders",
    icon: Wrench,
    roles: ["admin"],
  },
  {
    name: "Reports",
    href: "/reports",
    icon: BarChart3,
    roles: ["admin", "property_ops", "manager"],
  },
  {
    name: "Settings",
    href: "/settings",
    icon: Settings,
    roles: ["admin"],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { sessionClaims } = useAuth();
  const { user } = useUser();
  const role = getRoleFromSessionClaims(
    sessionClaims as Record<string, unknown> | null,
  );
  const roleLabel: Record<UserRole, string> = {
    admin: "Admin",
    property_ops: "Property Ops",
    manager: "Manager",
    cleaner: "Cleaner",
  };

  return (
    <aside className="flex w-[var(--sidebar-width)] flex-col border-r border-[var(--border)] bg-[var(--card)]">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 border-b border-[var(--border)] px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--primary)] text-sm font-bold text-white">
          OC
        </div>
        <span className="text-sm font-semibold tracking-tight">OpsCentral</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-3">
        {navigation.filter((item) => item.roles.includes(role)).map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-[var(--border)] p-3">
        <div className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-[var(--accent)]">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {user?.fullName || user?.primaryEmailAddress?.emailAddress || "User"}
            </p>
            <p className="truncate text-xs text-[var(--muted-foreground)]">
              {roleLabel[role]}
            </p>
          </div>
          <UserButton afterSignOutUrl="/sign-in" />
        </div>
      </div>
    </aside>
  );
}
