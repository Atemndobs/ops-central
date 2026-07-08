import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { UsageOverviewClient } from "@/components/settings/usage/usage-overview-client";

/**
 * /settings/usage — admin-only overview of external-service usage.
 *
 * Phase B of the service-usage-tracking workstream
 * (see Docs/usage-tracking/ADR.md §"Read Path"). Gated behind the
 * `usage_dashboard` feature flag; see Docs/feature-flags/PATTERN.md.
 *
 * The parent route group is already admin-only via the sidebar nav. The
 * Convex queries additionally enforce `requireAdmin` so any non-admin that
 * reaches this page via a direct URL still gets an error.
 */
export default function UsagePage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 border-b border-[var(--border)] pb-4">
        <Link
          href="/settings?tab=integrations"
          className="inline-flex w-fit items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to Settings
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">
            Service Usage &amp; Cost
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--muted-foreground)]">
            Month-to-date spend, quota consumption, and error health across
            every external service J&amp;A is billed for. Data is recorded by
            the canonical <code>logServiceUsage</code> helper and aggregated
            hourly. See{" "}
            <a
              href="https://github.com/Atemndobs/ops-central/blob/main/Docs/usage-tracking/ADR.md"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              the ADR
            </a>{" "}
            for the data model.
          </p>
        </div>
      </div>

      <UsageOverviewClient />
    </div>
  );
}
