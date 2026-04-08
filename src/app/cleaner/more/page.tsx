"use client";

import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { Clock, Bell, Settings, LogOut, ChevronRight } from "lucide-react";

const MENU_SECTIONS = [
  {
    title: "Activity",
    items: [
      {
        id: "history",
        label: "Job History",
        description: "View your completed jobs",
        href: "/cleaner/history",
        icon: Clock,
      },
      {
        id: "notifications",
        label: "Notifications",
        description: "Alerts and updates",
        href: "#",
        icon: Bell,
      },
    ],
  },
  {
    title: "System",
    items: [
      {
        id: "settings",
        label: "Settings",
        description: "Theme, notifications, preferences",
        href: "/cleaner/settings",
        icon: Settings,
      },
    ],
  },
];

export default function CleanerMorePage() {
  const { signOut } = useAuth();
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    router.push("/sign-in");
  };

  return (
    <div className="space-y-6">
      {MENU_SECTIONS.map((section) => (
        <div key={section.title}>
          <h2 className="mb-3 ml-1 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            {section.title}
          </h2>
          <div className="space-y-2">
            {section.items.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3.5 transition-colors hover:bg-[var(--accent)]"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--muted)]">
                  <item.icon className="h-5 w-5 text-[var(--foreground)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[var(--foreground)]">{item.label}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">{item.description}</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
              </Link>
            ))}
          </div>
        </div>
      ))}

      {/* Sign Out */}
      <div>
        <h2 className="mb-3 ml-1 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Account
        </h2>
        <button
          type="button"
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3.5 text-left transition-colors hover:bg-red-100 dark:border-red-900/30 dark:bg-red-950/20 dark:hover:bg-red-950/40"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/30">
            <LogOut className="h-5 w-5 text-red-600 dark:text-red-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-red-700 dark:text-red-400">Sign Out</p>
            <p className="text-xs text-red-500/70 dark:text-red-400/60">Sign out of your account</p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-red-400" />
        </button>
      </div>

      <p className="text-center text-[11px] text-[var(--muted-foreground)]">
        ChezSoiCleaning v1.0.0
      </p>
    </div>
  );
}
