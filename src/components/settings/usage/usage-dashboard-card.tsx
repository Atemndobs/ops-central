"use client";

/**
 * Small entry-point card shown inside the "Service usage & cost"
 * collapsible on Settings → Integrations. Links to `/settings/usage` when
 * the `usage_dashboard` feature flag is ON; shows an enable prompt with a
 * deep link to the Feature Flags section when OFF.
 */

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { ArrowRight, Loader2 } from "lucide-react";

export function UsageDashboardCard() {
  const enabled = useQuery(api.admin.featureFlags.isFeatureEnabled, {
    key: "usage_dashboard",
  });

  if (enabled === undefined) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading flag&hellip;
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="space-y-2 text-sm text-[var(--muted-foreground)]">
        <p>
          The usage dashboard is currently disabled. Turn on the
          <code className="mx-1 rounded bg-[var(--muted)] px-1 py-0.5 text-xs">
            usage_dashboard
          </code>
          flag in the Feature flags section above to expose it.
        </p>
        <p className="text-xs">
          Events keep recording in the background even while the flag is
          off — only the admin UI is hidden.
        </p>
      </div>
    );
  }

  return (
    <Link
      href="/settings/usage"
      className="group flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--background)]/40 px-3 py-3 text-sm transition hover:border-[var(--primary)]/60"
    >
      <span className="min-w-0">
        <span className="block font-medium text-[var(--foreground)]">
          Open service usage dashboard
        </span>
        <span className="block text-xs text-[var(--muted-foreground)]">
          Drill into per-service cost, quota, and error detail.
        </span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition group-hover:translate-x-0.5 group-hover:text-[var(--foreground)]" />
    </Link>
  );
}
