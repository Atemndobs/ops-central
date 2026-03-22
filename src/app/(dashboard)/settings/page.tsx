import { Settings, Bell, Zap, Users, Building2 } from "lucide-react";

/**
 * SETTINGS PAGE
 *
 * Design brief for designer:
 * - Tabs: General | Scheduling | Notifications | Integrations | Team
 *
 * General: company name, timezone, branding
 *
 * Scheduling:
 * - Automated workflow rules (Breezeway pattern):
 *   IF [trigger: check-in/check-out/same-day-turn]
 *   + [conditions: guest type, stay length, property group]
 *   THEN [create task with template] + [assign] + [schedule at offset]
 * - Draft vs Commit mode toggle
 * - Recurring task templates
 * - Default job durations per property type
 *
 * Notifications:
 * - Per-user notification preferences
 * - SMS, email, push toggles
 * - Quiet hours
 * - Escalation rules
 *
 * Integrations:
 * - Hospitable/Airbnb webhook status
 * - Twilio SMS configuration
 * - Future: smart lock integrations
 *
 * Team:
 * - Invite members
 * - Role management
 * - Permissions
 */
export default function SettingsPage() {
  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--border)]">
        {[
          { label: "General", icon: Settings },
          { label: "Scheduling", icon: Zap },
          { label: "Notifications", icon: Bell },
          { label: "Integrations", icon: Building2 },
          { label: "Team", icon: Users },
        ].map(({ label, icon: Icon }) => (
          <button
            key={label}
            className="flex items-center gap-2 border-b-2 border-transparent px-4 py-2 text-sm text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)]"
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Settings content placeholder */}
      <div className="max-w-2xl space-y-6">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
          <h3 className="text-sm font-semibold mb-2">Company Settings</h3>
          <p className="text-sm text-[var(--muted-foreground)]">
            General configuration for J&A Business Solutions
          </p>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
          <h3 className="text-sm font-semibold mb-2">
            Automated Scheduling Rules
          </h3>
          <p className="text-sm text-[var(--muted-foreground)]">
            Configure auto-scheduling workflows: trigger events, conditions,
            templates, and assignment rules
          </p>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
          <h3 className="text-sm font-semibold mb-2">Notification Preferences</h3>
          <p className="text-sm text-[var(--muted-foreground)]">
            SMS, email, and push notification settings per user role
          </p>
        </div>
      </div>
    </div>
  );
}
