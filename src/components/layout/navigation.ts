import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Calendar,
  ClipboardList,
  ClipboardCheck,
  ListChecks,
  MessageSquare,
  Star,
  Building2,
  Building,
  Users,
  UserCog,
  Package,
  AlertTriangle,
  BarChart3,
  Calculator,
  Receipt,
  Settings,
} from "lucide-react";
import type { UserRole } from "@/lib/auth";

export type NavigationItem = {
  nameKey: string;
  href: string;
  icon: LucideIcon;
  roles: UserRole[];
};

export const navigation: NavigationItem[] = [
  {
    nameKey: "common.dashboard",
    href: "/",
    icon: LayoutDashboard,
    roles: ["admin", "property_ops", "manager"],
  },
  {
    nameKey: "common.schedule",
    href: "/schedule",
    icon: Calendar,
    roles: ["admin", "property_ops", "manager"],
  },
  {
    nameKey: "common.jobs",
    href: "/jobs",
    icon: ClipboardList,
    roles: ["admin", "property_ops", "manager", "cleaner"],
  },
  {
    nameKey: "common.tasks",
    href: "/tasks",
    icon: ListChecks,
    roles: ["admin", "property_ops", "manager"],
  },
  {
    nameKey: "common.messages",
    href: "/messages",
    icon: MessageSquare,
    roles: ["admin", "property_ops", "manager"],
  },
  {
    nameKey: "nav.reviews",
    href: "/reviews",
    icon: Star,
    roles: ["admin", "property_ops"],
  },
  {
    nameKey: "nav.review",
    href: "/review",
    icon: ClipboardCheck,
    roles: ["property_ops", "manager"],
  },
  {
    nameKey: "common.properties",
    href: "/properties",
    icon: Building2,
    roles: ["admin", "property_ops", "manager"],
  },
  {
    nameKey: "nav.companies",
    href: "/companies",
    icon: Building,
    roles: ["admin", "property_ops"],
  },
  {
    // User management — ops does not handle this. Kept for manager (existing
    // behavior) and admin.
    nameKey: "common.team",
    href: "/team",
    icon: Users,
    roles: ["admin", "manager"],
  },
  {
    // Property-owner user management — ops does not handle this.
    nameKey: "nav.ownerOverview",
    href: "/admin/owner-overview",
    icon: UserCog,
    roles: ["admin"],
  },
  {
    nameKey: "common.inventory",
    href: "/inventory",
    icon: Package,
    roles: ["admin"],
  },
  {
    nameKey: "common.incidents",
    href: "/incidents",
    icon: AlertTriangle,
    roles: ["admin", "property_ops", "manager"],
  },
  {
    // Financial/reporting — not an ops responsibility. This also covers
    // /reports/monthly-close and /reports/costs below via the shared
    // /reports route-access prefix.
    nameKey: "common.reports",
    href: "/reports",
    icon: BarChart3,
    roles: ["admin"],
  },
  {
    nameKey: "nav.monthlyClose",
    href: "/reports/monthly-close",
    icon: Calculator,
    roles: ["admin"],
  },
  {
    nameKey: "nav.propertyCosts",
    href: "/reports/costs",
    icon: Receipt,
    roles: ["admin"],
  },
  {
    // Bug fix: ops previously had no way to reach Settings at all — the
    // page itself is now role-gated to a simplified tab set for ops (no
    // Team tab, no cost dashboard) in settings-page-client.tsx.
    nameKey: "common.settings",
    href: "/settings",
    icon: Settings,
    roles: ["admin", "property_ops"],
  },
];
