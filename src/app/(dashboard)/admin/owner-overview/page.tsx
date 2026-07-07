"use client";

// Admin Owner Overview — index page (Phase 2).
// One row per active owner with summary counters. Read-only.
// Backed by `api.admin.ownerOverview.listOwners`.

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { AlertTriangle, Loader2, ChevronRight, UserCog } from "lucide-react";

function formatPeriod(periodStart: number): string {
  const d = new Date(periodStart);
  return d.toLocaleString(undefined, { month: "short", year: "numeric" });
}

export default function AdminOwnerOverviewIndexPage() {
  const owners = useQuery(api.admin.ownerOverview.listOwners, {});

  if (owners === undefined) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Owner Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            See what each owner sees on their portal — and prepare statements
            from one place.
          </p>
        </div>
      </header>

      {owners.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-12 text-center">
          <UserCog className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            No active property owners yet. Assign an owner to a property in
            Settings to see them here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Owner</th>
                <th className="px-4 py-3 text-right font-medium">Properties</th>
                <th className="px-4 py-3 text-left font-medium">
                  Last statement
                </th>
                <th className="px-4 py-3 text-right font-medium">Drafts</th>
                <th className="px-4 py-3 text-right font-medium">
                  Claims
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {owners.map((o) => (
                <tr
                  key={o.userId}
                  className="border-t border-border transition-colors hover:bg-muted/30"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/owner-overview/${o.userId}`}
                      className="block"
                    >
                      <div className="font-medium">{o.name}</div>
                      {o.email && (
                        <div className="text-xs text-muted-foreground">
                          {o.email}
                        </div>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {o.propertyCount}
                  </td>
                  <td className="px-4 py-3 text-left">
                    {o.lastStatement ? (
                      <span>
                        <span className="font-medium">
                          {formatPeriod(o.lastStatement.periodStart)}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {o.lastStatement.propertyName} ·{" "}
                          {o.lastStatement.status}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {o.draftsPending > 0 ? (
                      <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                        {o.draftsPending}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {o.activePlatformClaims > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-600 dark:text-rose-400">
                        <AlertTriangle className="h-3 w-3" />
                        {o.activePlatformClaims}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/owner-overview/${o.userId}`}
                      className="inline-flex items-center text-muted-foreground hover:text-foreground"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
