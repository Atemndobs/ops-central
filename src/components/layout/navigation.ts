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
  AlertTriangle,
  Wrench,
  BarChart3,
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
    nameKey: "common.messages",
    href: "/messages",
    icon: MessageSquare,
    roles: ["admin", "property_ops", "manager"],
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
    roles: ["admin", "property_ops", "manager"],
  },
  {
    nameKey: "common.team",
    href: "/team",
    icon: Users,
    roles: ["admin", "property_ops", "manager"],
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
    nameKey: "common.maintenance",
    href: "/maintenance",
    icon: Wrench,
    roles: ["admin", "property_ops", "manager"],
  },
  {
    nameKey: "common.reports",
    href: "/reports",
    icon: BarChart3,
    roles: ["admin", "property_ops", "manager"],
  },
  {
    nameKey: "common.settings",
    href: "/settings",
    icon: Settings,
    roles: ["admin"],
  },
];
