import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Calendar,
  ClipboardList,
  ClipboardCheck,
  MessageSquare,
  Building2,
  Building,
  Users,
  Package,
  Wrench,
  BarChart3,
  Settings,
} from "lucide-react";
import type { UserRole } from "@/lib/auth";

export type NavigationItem = {
  name: string;
  href: string;
  icon: LucideIcon;
  roles: UserRole[];
};

export const navigation: NavigationItem[] = [
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
    roles: ["admin", "property_ops", "manager"],
  },
  {
    name: "Jobs",
    href: "/jobs",
    icon: ClipboardList,
    roles: ["admin", "property_ops", "manager", "cleaner"],
  },
  {
    name: "Messages",
    href: "/messages",
    icon: MessageSquare,
    roles: ["admin", "property_ops", "manager"],
  },
  {
    name: "Review",
    href: "/review",
    icon: ClipboardCheck,
    roles: ["property_ops", "manager"],
  },
  {
    name: "Properties",
    href: "/properties",
    icon: Building2,
    roles: ["admin", "property_ops", "manager"],
  },
  {
    name: "Companies",
    href: "/companies",
    icon: Building,
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
