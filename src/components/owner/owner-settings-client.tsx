"use client";

import { useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { Bell, Mail, MessageSquare, Smartphone } from "lucide-react";
import { api } from "@convex/_generated/api";

/**
 * Owner settings — currently just notification preferences (per-channel
 * toggles for each event type). Defaults to "on" for every (channel,event)
 * pair when no row exists. Spec §11.
 *
 * Email/SMS channels are spec'd but their dispatch isn't wired in Wave 3c
 * (only in-app + push). Toggles are kept visible so the matrix doesn't
 * change shape when those channels light up later.
 */
export function OwnerSettingsClient() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const prefs = useQuery(
    api.owner.queries.getOwnerNotificationPrefs,
    isAuthenticated ? {} : "skip",
  );
  const upsert = useMutation(api.owner.mutations.upsertOwnerNotificationPref);

  if (isLoading || prefs === undefined) {
    return <div className="h-96 animate-pulse rounded-2xl bg-[var(--cleaner-surface)]" />;
  }

  return (
    <div className="space-y-8">
      <div>
        {/* Inline back link removed — OwnerShell renders the universal
            back button above the page chrome. */}
        <h1
          className="text-3xl tracking-tight"
          style={{ fontFamily: "var(--font-cleaner-display)", fontWeight: 700 }}
        >
          Settings
        </h1>
      </div>

      <section
        className="rounded-2xl border border-black/[0.06] p-6"
        style={{ background: "var(--cleaner-surface)" }}
      >
        <div
          className="mb-2 flex items-center gap-2 text-lg"
          style={{ fontFamily: "var(--font-cleaner-display)", fontWeight: 700 }}
        >
          <Bell size={18} /> Notifications
        </div>
        <p className="mb-5 text-sm" style={{ color: "var(--cleaner-muted)" }}>
          Pick which events reach you on which channel. In-app inbox always
          updates regardless of these settings.
        </p>

        <PrefsMatrix prefs={prefs} upsert={upsert} />
      </section>
    </div>
  );
}

type EventField = "statementIssued" | "approvalRequest" | "incidentReport";
type Channel = "email" | "sms" | "push";

const EVENT_LABELS: Array<{ field: EventField; label: string; help: string }> = [
  {
    field: "statementIssued",
    label: "Statement issued",
    help: "When your monthly P&L is finalized and ready.",
  },
  {
    field: "approvalRequest",
    label: "Approval request",
    help: "When ChezSoiStays asks you to approve a maintenance cost over your threshold.",
  },
  {
    field: "incidentReport",
    label: "Incident report",
    help: "Damage or guest issues at your property.",
  },
];

const CHANNELS: Array<{ id: Channel; label: string; Icon: typeof Mail; available: boolean }> = [
  { id: "push", label: "Push", Icon: Smartphone, available: true },
  { id: "email", label: "Email", Icon: Mail, available: false }, // Wave 3d
  { id: "sms", label: "SMS", Icon: MessageSquare, available: false }, // Phase 2
];

function PrefsMatrix({
  prefs,
  upsert,
}: {
  prefs: ReadonlyArray<{
    channel: Channel;
    statementIssued: boolean;
    approvalRequest: boolean;
    incidentReport: boolean;
  }>;
  upsert: ReturnType<typeof useMutation<typeof api.owner.mutations.upsertOwnerNotificationPref>>;
}) {
  const [pending, setPending] = useState<string | null>(null);

  function get(channel: Channel, field: EventField): boolean {
    const row = prefs.find((p) => p.channel === channel);
    if (!row) return true; // default-on
    return row[field];
  }

  async function toggle(channel: Channel, field: EventField, next: boolean) {
    const key = `${channel}:${field}`;
    setPending(key);
    try {
      const row = prefs.find((p) => p.channel === channel);
      const base = {
        channel,
        statementIssued: row?.statementIssued ?? true,
        approvalRequest: row?.approvalRequest ?? true,
        incidentReport: row?.incidentReport ?? true,
      };
      await upsert({ ...base, [field]: next });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-black/[0.06]">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ background: "var(--cleaner-bg)" }}>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide"
                style={{ color: "var(--cleaner-muted)" }}>
              Event
            </th>
            {CHANNELS.map(({ id, label, Icon }) => (
              <th key={id} className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide"
                  style={{ color: "var(--cleaner-muted)" }}>
                <span className="inline-flex items-center gap-1.5">
                  <Icon size={12} />
                  {label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {EVENT_LABELS.map(({ field, label, help }, i) => (
            <tr key={field} className={i > 0 ? "border-t border-black/[0.04]" : ""}>
              <td className="px-4 py-4 align-top">
                <div style={{ color: "var(--cleaner-ink)", fontWeight: 500 }}>{label}</div>
                <div className="mt-0.5 text-xs" style={{ color: "var(--cleaner-muted)" }}>
                  {help}
                </div>
              </td>
              {CHANNELS.map(({ id, available }) => {
                const checked = get(id, field);
                const key = `${id}:${field}`;
                const disabled = !available || pending === key;
                return (
                  <td key={id} className="px-4 py-4 text-center">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggle(id, field, e.target.checked)}
                      disabled={disabled}
                      className="h-4 w-4 accent-[var(--cleaner-primary)] disabled:cursor-not-allowed disabled:opacity-30"
                      aria-label={`${label} via ${id}`}
                    />
                    {!available && (
                      <div className="mt-1 text-[10px]" style={{ color: "var(--cleaner-muted)" }}>
                        soon
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
