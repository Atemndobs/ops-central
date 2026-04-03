"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { Bell, Building2, CheckCheck, ExternalLink, Settings, Trash2, Users, Zap } from "lucide-react";
import { api } from "@convex/_generated/api";
import { navigation } from "@/components/layout/navigation";
import { useToast } from "@/components/ui/toast-provider";
import {
  getRoleFromMetadata,
  getRoleFromSessionClaimsOrNull,
  type UserRole,
} from "@/lib/auth";

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

type NotificationFilter = "all" | "unread";

const tabs: TabOption[] = [
  { id: "general", label: "General", icon: Settings },
  { id: "scheduling", label: "Scheduling", icon: Zap },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "integrations", label: "Integrations", icon: Building2 },
  { id: "team", label: "Team", icon: Users },
];

const placeholderSections: Record<
  Exclude<SettingsTab, "notifications" | "team">,
  SettingsSection[]
> = {
  general: [
    {
      title: "Company Settings",
      description:
        "Update company profile, timezone, and workspace defaults for operations reporting.",
    },
    {
      title: "Branding",
      description:
        "Configure dashboard naming and owner-facing branding preferences.",
    },
  ],
  scheduling: [
    {
      title: "Automated Scheduling Rules",
      description:
        "Define trigger + condition + assignment workflows for check-ins, check-outs, and same-day turns.",
    },
    {
      title: "Draft vs Commit Mode",
      description:
        "Control whether tasks are created silently for review or committed immediately to staff.",
    },
  ],
  integrations: [
    {
      title: "Hospitable Webhook Health",
      description:
        "Review sync status, last delivery results, and connectivity checks for reservation ingestion.",
    },
    {
      title: "Messaging Integrations",
      description:
        "Configure provider credentials and delivery channels for outbound notifications.",
    },
  ],
};

const roleOrder: UserRole[] = ["admin", "property_ops", "manager", "cleaner"];

function formatRoleLabel(role: UserRole): string {
  switch (role) {
    case "property_ops":
      return "Property Ops";
    case "manager":
      return "Manager";
    case "cleaner":
      return "Cleaner";
    case "admin":
    default:
      return "Admin";
  }
}

function getNotificationHref(type: string, data: unknown): string {
  if (data && typeof data === "object") {
    const candidate = data as { jobId?: string };
    if (candidate.jobId) {
      if (type === "awaiting_approval" || type === "rework_required") {
        return `/review?jobId=${candidate.jobId}`;
      }
      return `/jobs?jobId=${candidate.jobId}`;
    }
  }

  return "/settings?tab=notifications";
}

function formatNotificationTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function StatCard({
  label,
  value,
  caption,
}: {
  label: string;
  value: string | number;
  caption?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{value}</p>
      {caption ? (
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">{caption}</p>
      ) : null}
    </div>
  );
}

function PlaceholderTab({
  sections,
}: {
  sections: SettingsSection[];
}) {
  return (
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
  );
}

function SchedulingSettingsPanel() {
  const hospitableSync = useQuery(api.hospitable.queries.getSyncStatus, {});
  const jobs = useQuery(api.cleaningJobs.queries.getAll, { limit: 1000 });
  const properties = useQuery(api.properties.queries.getAll, { limit: 500 });
  const [referenceNow] = useState(() => Date.now());

  const schedulingMetrics = useMemo(() => {
    const now = referenceNow;
    const nextTwentyFourHours = now + 24 * 60 * 60 * 1000;
    const sourceJobs = jobs ?? [];

    const scheduled = sourceJobs.filter((job) => job.status === "scheduled").length;
    const assigned = sourceJobs.filter((job) => job.status === "assigned").length;
    const inProgress = sourceJobs.filter((job) => job.status === "in_progress").length;
    const reworkRequired = sourceJobs.filter(
      (job) => job.status === "rework_required",
    ).length;
    const unassignedUpcoming = sourceJobs.filter(
      (job) =>
        (job.status === "scheduled" || job.status === "assigned") &&
        (job.assignedCleanerIds?.length ?? 0) === 0 &&
        typeof job.scheduledStartAt === "number" &&
        job.scheduledStartAt >= now &&
        job.scheduledStartAt <= nextTwentyFourHours,
    ).length;
    const urgentUpcoming = sourceJobs.filter(
      (job) =>
        (job.isUrgent || job.partyRiskFlag || job.opsRiskFlag) &&
        typeof job.scheduledStartAt === "number" &&
        job.scheduledStartAt >= now &&
        job.scheduledStartAt <= nextTwentyFourHours,
    ).length;
    const hospitableJobs = sourceJobs.filter(
      (job) =>
        job.metadata &&
        typeof job.metadata === "object" &&
        !Array.isArray(job.metadata) &&
        (job.metadata as Record<string, unknown>).source === "hospitable",
    ).length;

    return {
      scheduled,
      assigned,
      inProgress,
      reworkRequired,
      unassignedUpcoming,
      urgentUpcoming,
      hospitableJobs,
    };
  }, [jobs, referenceNow]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          label="Scheduled"
          value={schedulingMetrics.scheduled}
          caption="Open jobs waiting for execution"
        />
        <StatCard
          label="Assigned"
          value={schedulingMetrics.assigned}
          caption="Jobs with a cleaner assigned"
        />
        <StatCard
          label="Unassigned Next 24h"
          value={schedulingMetrics.unassignedUpcoming}
          caption="Immediate dispatch risk"
        />
        <StatCard
          label="Urgent / Risk"
          value={schedulingMetrics.urgentUpcoming}
          caption="Urgent, party-risk, or ops-risk jobs"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">Automated Scheduling Rules</h3>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                These rules reflect the scheduling behavior currently implemented in the shared
                backend.
              </p>
            </div>
            <Link
              href="/schedule"
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-[var(--accent)]"
            >
              Open Schedule
              <ExternalLink className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-6 space-y-4">
            <div className="rounded-lg border border-[var(--border)] p-4">
              <p className="text-sm font-semibold text-[var(--foreground)]">
                Turnover creation from Hospitable reservations
              </p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Each synced reservation creates or updates a cleaning job at guest checkout time.
                If there is no next stay, the backend uses a six-hour fallback cleaning window.
              </p>
            </div>

            <div className="rounded-lg border border-[var(--border)] p-4">
              <p className="text-sm font-semibold text-[var(--foreground)]">
                Dynamic rescheduling while work is still open
              </p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Jobs still in `scheduled` or `assigned` are automatically rescheduled when
                reservation dates shift, which keeps the live grid aligned with the source stay.
              </p>
            </div>

            <div className="rounded-lg border border-[var(--border)] p-4">
              <p className="text-sm font-semibold text-[var(--foreground)]">
                Risk-aware cleaner notes
              </p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Party-risk reservations and booking notes feed directly into cleaner-facing job
                notes so the dispatch team sees operational context before assignment.
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
            <h3 className="text-lg font-semibold">Draft vs Commit Mode</h3>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Current assignment actions default to controlled dispatch rather than instant cleaner
              notification.
            </p>
            <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
              <p className="text-sm font-semibold text-amber-300">Current mode: Manual commit</p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Quick-assign flows in the dashboard and schedule currently call assignment mutations
                with cleaner notifications turned off. Ops can stage assignments first, then notify
                through the review and job workflows.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
            <h3 className="text-lg font-semibold">Sync Health</h3>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[var(--muted-foreground)]">Hospitable sync status</span>
                <span className="font-medium text-[var(--foreground)]">
                  {hospitableSync?.lastSyncStatus || "Not synced yet"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[var(--muted-foreground)]">Last sync</span>
                <span className="font-medium text-[var(--foreground)]">
                  {hospitableSync?.lastSyncAt
                    ? formatNotificationTime(hospitableSync.lastSyncAt)
                    : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[var(--muted-foreground)]">Sync window</span>
                <span className="font-medium text-[var(--foreground)]">
                  {hospitableSync?.syncWindowDays ?? 30} days
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[var(--muted-foreground)]">Properties tracked</span>
                <span className="font-medium text-[var(--foreground)]">
                  {properties?.length ?? 0}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[var(--muted-foreground)]">Hospitable-sourced jobs</span>
                <span className="font-medium text-[var(--foreground)]">
                  {schedulingMetrics.hospitableJobs}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
            <h3 className="text-lg font-semibold">Execution Snapshot</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <StatCard label="In Progress" value={schedulingMetrics.inProgress} />
              <StatCard label="Rework" value={schedulingMetrics.reworkRequired} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function TeamSettingsPanel() {
  const userManagementMetrics = useQuery(api.admin.queries.getUserManagementMetrics, {});
  const teamMetrics = useQuery(api.admin.queries.getTeamMetrics, {});

  const availabilitySummary = useMemo(() => {
    const members = teamMetrics?.members ?? [];
    return {
      working: members.filter((member) => member.availability === "working").length,
      available: members.filter((member) => member.availability === "available").length,
      off: members.filter((member) => member.availability === "off").length,
    };
  }, [teamMetrics]);

  const roleCounts = userManagementMetrics?.roleCounts ?? {};

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        {roleOrder.map((role) => (
          <StatCard
            key={role}
            label={formatRoleLabel(role)}
            value={roleCounts[role] ?? 0}
            caption="Active user records"
          />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">Role Access Matrix</h3>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Current page access is derived from the app navigation rules, so this reflects the
                real boundaries enforced in the dashboard.
              </p>
            </div>
            <Link
              href="/team"
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-[var(--accent)]"
            >
              Open Team
              <ExternalLink className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
                <tr>
                  <th className="px-3 py-3 font-medium">Area</th>
                  {roleOrder.map((role) => (
                    <th key={role} className="px-3 py-3 text-center font-medium">
                      {formatRoleLabel(role)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {navigation.map((item) => (
                  <tr key={item.href} className="border-b last:border-b-0">
                    <td className="px-3 py-3">
                      <div>
                        <p className="font-medium text-[var(--foreground)]">{item.name}</p>
                        <p className="text-xs text-[var(--muted-foreground)]">{item.href}</p>
                      </div>
                    </td>
                    {roleOrder.map((role) => {
                      const allowed = item.roles.includes(role);
                      return (
                        <td key={`${item.href}:${role}`} className="px-3 py-3 text-center">
                          <span
                            className={`inline-flex min-w-16 justify-center rounded-full px-2 py-1 text-xs font-semibold ${
                              allowed
                                ? "bg-emerald-500/10 text-emerald-400"
                                : "bg-[var(--accent)] text-[var(--muted-foreground)]"
                            }`}
                          >
                            {allowed ? "Allowed" : "Blocked"}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
            <h3 className="text-lg font-semibold">Member Lifecycle</h3>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Current staffing readiness and recent user creation activity.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <StatCard label="Working Now" value={availabilitySummary.working} />
              <StatCard label="Available" value={availabilitySummary.available} />
              <StatCard label="Off Shift" value={availabilitySummary.off} />
              <StatCard
                label="Last User Added"
                value={
                  userManagementMetrics?.lastUserCreatedAt
                    ? new Date(userManagementMetrics.lastUserCreatedAt).toLocaleDateString()
                    : "—"
                }
                caption="Most recent user creation"
              />
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
            <h3 className="text-lg font-semibold">Admin Notes</h3>
            <div className="mt-4 space-y-3 text-sm text-[var(--muted-foreground)]">
              <p>
                Role changes and company assignments are managed from the live team roster so edits
                apply directly to real user records.
              </p>
              <p>
                Pending invites and live presence are still placeholders in backend metrics. The
                counts shown here reflect actual Convex users and current assignment status.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function NotificationsSettingsPanel() {
  const { showToast } = useToast();
  const { isLoaded, isSignedIn, userId, sessionClaims } = useAuth();
  const { user } = useUser();
  const { isAuthenticated } = useConvexAuth();
  const convexUser = useQuery(
    api.users.queries.getByClerkId,
    isAuthenticated && isLoaded && isSignedIn && userId ? { clerkId: userId } : "skip",
  );
  const markNotificationRead = useMutation(api.users.mutations.markNotificationRead);
  const markAllNotificationsRead = useMutation(api.users.mutations.markAllNotificationsRead);
  const dismissNotification = useMutation(api.users.mutations.dismissNotification);
  const [filter, setFilter] = useState<NotificationFilter>("all");

  const roleFromClaims = getRoleFromSessionClaimsOrNull(
    sessionClaims as Record<string, unknown> | null,
  );
  const roleFromMetadata = getRoleFromMetadata(user?.publicMetadata);
  const currentRole: UserRole =
    roleFromClaims ?? roleFromMetadata ?? convexUser?.role ?? "admin";

  const notifications = useQuery(
    api.notifications.queries.getUserNotifications,
    convexUser?._id
      ? {
          userId: convexUser._id,
          includeRead: true,
          limit: 50,
        }
      : "skip",
  );

  const visibleNotifications = useMemo(() => {
    const list = notifications ?? [];
    if (filter === "unread") {
      return list.filter((item) => !item.readAt && !item.dismissedAt);
    }
    return list.filter((item) => !item.dismissedAt);
  }, [filter, notifications]);

  const unreadCount = (notifications ?? []).filter(
    (item) => !item.readAt && !item.dismissedAt,
  ).length;
  const pushDeliveredCount = (notifications ?? []).filter((item) => item.pushSent).length;
  const archivedCount = (notifications ?? []).filter((item) => item.dismissedAt).length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Unread"
          value={unreadCount}
          caption={`${formatRoleLabel(currentRole)} inbox`}
        />
        <StatCard
          label="Push Delivered"
          value={pushDeliveredCount}
          caption="Notifications marked as sent"
        />
        <StatCard
          label="Archived"
          value={archivedCount}
          caption="Dismissed from active inbox"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold">Notification Management</h3>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Review operational alerts, mark them read, or dismiss them from the active queue.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setFilter("all")}
                className={`rounded-md border px-3 py-2 text-sm ${
                  filter === "all" ? "bg-[var(--accent)]" : ""
                }`}
              >
                All Active
              </button>
              <button
                type="button"
                onClick={() => setFilter("unread")}
                className={`rounded-md border px-3 py-2 text-sm ${
                  filter === "unread" ? "bg-[var(--accent)]" : ""
                }`}
              >
                Unread Only
              </button>
              <button
                type="button"
                onClick={() => {
                  void markAllNotificationsRead()
                    .then(() => showToast("All notifications marked as read."))
                    .catch((error) =>
                      showToast(
                        error instanceof Error
                          ? error.message
                          : "Failed to mark notifications as read.",
                        "error",
                      ),
                    );
                }}
                disabled={unreadCount === 0}
                className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
              >
                <CheckCheck className="h-4 w-4" />
                Mark All Read
              </button>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {notifications === undefined ? (
              <p className="text-sm text-[var(--muted-foreground)]">Loading notifications...</p>
            ) : visibleNotifications.length === 0 ? (
              <div className="rounded-md border border-dashed border-[var(--border)] p-6 text-sm text-[var(--muted-foreground)]">
                No notifications match the current filter.
              </div>
            ) : (
              visibleNotifications.map((notification) => {
                const unread = !notification.readAt && !notification.dismissedAt;
                return (
                  <div
                    key={notification._id}
                    className="rounded-lg border border-[var(--border)] p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-[var(--foreground)]">
                            {notification.title}
                          </p>
                          {unread ? (
                            <span className="rounded-full bg-[var(--primary)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--primary)]">
                              Unread
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                          {notification.message}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
                          <span>{notification.type.replaceAll("_", " ")}</span>
                          <span>{formatNotificationTime(notification.createdAt)}</span>
                          <span>{notification.pushSent ? "Push sent" : "In-app only"}</span>
                        </div>
                      </div>

                      <div className="flex shrink-0 gap-2">
                        <Link
                          href={getNotificationHref(notification.type, notification.data)}
                          className="rounded-md border px-3 py-2 text-xs font-medium hover:bg-[var(--accent)]"
                        >
                          Open
                        </Link>
                        {unread ? (
                          <button
                            type="button"
                            onClick={() => {
                              void markNotificationRead({ id: notification._id })
                                .then(() => showToast("Notification marked as read."))
                                .catch((error) =>
                                  showToast(
                                    error instanceof Error
                                      ? error.message
                                      : "Failed to mark notification as read.",
                                    "error",
                                  ),
                                );
                            }}
                            className="rounded-md border px-3 py-2 text-xs font-medium hover:bg-[var(--accent)]"
                          >
                            Read
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            void dismissNotification({ id: notification._id })
                              .then(() => showToast("Notification dismissed."))
                              .catch((error) =>
                                showToast(
                                  error instanceof Error
                                    ? error.message
                                    : "Failed to dismiss notification.",
                                  "error",
                                ),
                              );
                          }}
                          className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-xs font-medium hover:bg-[var(--accent)]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Dismiss
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
            <h3 className="text-lg font-semibold">Alert Routing</h3>
            <div className="mt-4 space-y-3 text-sm text-[var(--muted-foreground)]">
              <p>
                Operational alerts are currently generated by backend workflows and routed to ops
                roles: admin, property ops, and manager.
              </p>
              <p>
                Cleaner-facing notifications continue to use the same shared notifications table and
                appear in the mobile app and cleaner PWA inboxes.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
            <h3 className="text-lg font-semibold">Current Capabilities</h3>
            <ul className="mt-4 space-y-3 text-sm text-[var(--muted-foreground)]">
              <li>Review the live notification queue for your account.</li>
              <li>Mark individual alerts or the whole queue as read.</li>
              <li>Dismiss handled items from the active inbox.</li>
              <li>Open the related job or review context from each alert.</li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

export function SettingsPageClient({ initialTab }: { initialTab: SettingsTab }) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

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

      {activeTab === "scheduling" ? <SchedulingSettingsPanel /> : null}
      {activeTab === "team" ? <TeamSettingsPanel /> : null}
      {activeTab === "notifications" ? <NotificationsSettingsPanel /> : null}
      {activeTab !== "team" && activeTab !== "notifications" && activeTab !== "scheduling" ? (
        <PlaceholderTab
          sections={placeholderSections[activeTab as keyof typeof placeholderSections]}
        />
      ) : null}
    </div>
  );
}
