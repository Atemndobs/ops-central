"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { SignOutButton, UserButton, useAuth, useUser } from "@clerk/nextjs";
import { useState } from "react";
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
  HelpCircle,
  LogOut,
  Moon,
  Menu,
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
    roles: ["admin", "property_ops", "manager", "cleaner"],
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
  const [isCollapsed, setIsCollapsed] = useState(true);
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
            Operations Management
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
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex rounded-none transition-colors",
                isCollapsed
                  ? "mx-auto h-11 w-11 items-center justify-center"
                  : "items-center gap-3 px-3 py-2.5 text-sm font-medium",
                isActive
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
              )}
              title={isCollapsed ? item.name : undefined}
            >
              <item.icon className={cn(isCollapsed ? "h-6 w-6" : "h-4 w-4")} />
              {!isCollapsed ? item.name : null}
            </Link>
          );
        })}
      </nav>

      <div className={cn("border-t py-4", isCollapsed ? "px-2" : "px-4")}>
        <div className="space-y-1">
          <button
            type="button"
            className={cn(
              "flex w-full rounded-none text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
              isCollapsed
                ? "mx-auto h-11 w-11 items-center justify-center"
                : "items-center gap-3 px-3 py-2.5 text-sm",
            )}
            title={isCollapsed ? "Help" : undefined}
          >
            <HelpCircle className={cn(isCollapsed ? "h-6 w-6" : "h-4 w-4")} />
            {!isCollapsed ? "Help" : null}
          </button>
          <SignOutButton redirectUrl="/sign-in">
            <button
              type="button"
              className={cn(
                "flex w-full rounded-none text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                isCollapsed
                  ? "mx-auto h-11 w-11 items-center justify-center"
                  : "items-center gap-3 px-3 py-2.5 text-sm",
              )}
              title={isCollapsed ? "Logout" : undefined}
            >
              <LogOut className={cn(isCollapsed ? "h-6 w-6" : "h-4 w-4")} />
              {!isCollapsed ? "Logout" : null}
            </button>
          </SignOutButton>
          <button
            type="button"
            className={cn(
              "flex w-full rounded-none text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
              isCollapsed
                ? "mx-auto h-11 w-11 items-center justify-center"
                : "items-center gap-3 px-3 py-2.5 text-sm",
            )}
            title={isCollapsed ? "Theme" : undefined}
          >
            <Moon className={cn(isCollapsed ? "h-6 w-6" : "h-4 w-4")} />
            {!isCollapsed ? "Dark Mode" : null}
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
            title={isCollapsed ? "Expand Sidebar" : undefined}
          >
            <Menu className={cn(isCollapsed ? "h-6 w-6" : "h-4 w-4")} />
            {!isCollapsed ? "Collapse" : null}
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
            <UserButton afterSignOutUrl="/sign-in" />
          </div>
        ) : null}
      </div>
    </aside>
  );
}
