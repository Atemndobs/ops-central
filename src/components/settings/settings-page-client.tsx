"use client";

import { useState } from "react";
import { Bell, Building2, Settings, Users, Zap } from "lucide-react";

export type SettingsTab =
  | "general"
  | "scheduling"
  | "notifications"
  | "integrations"
  | "team";

type TabOption = {
  id: SettingsTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

type SettingsSection = {
  title: string;
  description: string;
};

const tabs: TabOption[] = [
  { id: "general", label: "General", icon: Settings },
  { id: "scheduling", label: "Scheduling", icon: Zap },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "integrations", label: "Integrations", icon: Building2 },
  { id: "team", label: "Team", icon: Users },
];

const tabSections: Record<SettingsTab, SettingsSection[]> = {
  general: [
    {
      title: "Company Settings",
      description: "Update company profile, timezone, and workspace defaults for operations reporting.",
    },
    {
      title: "Branding",
      description: "Configure dashboard naming and owner-facing branding preferences.",
    },
  ],
  scheduling: [
    {
      title: "Automated Scheduling Rules",
      description: "Define trigger + condition + assignment workflows for check-ins, check-outs, and same-day turns.",
    },
    {
      title: "Draft vs Commit Mode",
      description: "Control whether tasks are created silently for review or committed immediately to staff.",
    },
  ],
  notifications: [
    {
      title: "Notification Preferences",
      description: "Configure role-based SMS, email, and push preferences for operational alerts.",
    },
    {
      title: "Escalation Rules",
      description: "Set timing and routing when jobs remain unassigned, overdue, or require manager approval.",
    },
  ],
  integrations: [
    {
      title: "Hospitable Webhook Health",
      description: "Review sync status, last delivery results, and connectivity checks for reservation ingestion.",
    },
    {
      title: "Messaging Integrations",
      description: "Configure provider credentials and delivery channels for outbound notifications.",
    },
  ],
  team: [
    {
      title: "Role & Access",
      description: "Manage admin, property ops, manager, and cleaner access boundaries across the app.",
    },
    {
      title: "Member Lifecycle",
      description: "Track onboarding status, assignment readiness, and deactivation workflows.",
    },
  ],
};

export function SettingsPageClient({ initialTab }: { initialTab: SettingsTab }) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const sections = tabSections[activeTab];

  return (
    <div className="space-y-4">
      <div className="border-b border-[var(--border)]">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm ${
                activeTab === id
                  ? "border-[var(--primary)] text-[var(--foreground)]"
                  : "border-transparent text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)]"
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <Icon className="h-4 w-4" />
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-2xl space-y-6">
        {sections.map((section) => (
          <div
            key={section.title}
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6"
          >
            <h3 className="mb-2 text-sm font-semibold">{section.title}</h3>
            <p className="text-sm text-[var(--muted-foreground)]">
              {section.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
