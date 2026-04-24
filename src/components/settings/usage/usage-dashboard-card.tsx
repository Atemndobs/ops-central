"use client";

/**
 * Small entry-point card shown in Settings → Integrations that links to
 * `/settings/usage` when the `usage_dashboard` feature flag is ON. Renders
 * nothing when the flag is OFF so the tab stays uncluttered.
 */

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { ArrowRight, Gauge } from "lucide-react";

export function UsageDashboardCard() {
  const enabled = useQuery(api.admin.featureFlags.isFeatureEnabled, {
    key: "usage_dashboard",
  });

  if (!enabled) {
    return null;
  }

  return (
    <Link
      href="/settings/usage"
      className="group flex items-start gap-4 rounded-lg border border-[var(--border)] bg-[var(--card)] p-5 transition hover:border-[var(--primary)]/60"
    >
      <div className="rounded-md bg-[var(--primary)]/10 p-3 text-[var(--primary)]">
        <Gauge className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-medium text-[var(--foreground)]">
          Service Usage &amp; Cost
        </h3>
        <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
          Month-to-date spend, quota consumption, and error health across
          every tracked external service. Admin-only.
        </p>
      </div>
      <ArrowRight className="mt-2 h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition group-hover:translate-x-0.5 group-hover:text-[var(--foreground)]" />
    </Link>
  );
}
