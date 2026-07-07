"use client";

// Admin Owner Overview — per-owner dashboard (Phase 2).
// Read-only mirror of /owner landing for one owner: property grid + statements list.
// Backed by `api.admin.ownerOverview.getOwnerDashboard`.

import Link from "next/link";
import { use } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  AlertTriangle,
  Ban,
  Building2,
  ChevronLeft,
  ExternalLink,
  FileText,
  Loader2,
} from "lucide-react";
import {
  CLAIM_FOLLOW_UP_LABELS,
  buildPlatformClaimSummary,
  type PlatformClaim,
} from "@/components/incidents/platform-claim";

function formatPeriod(periodStart: number): string {
  const d = new Date(periodStart);
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}

function formatPeriodKey(periodStart: number): string {
  const d = new Date(periodStart);
  return `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1).toString().padStart(2, "0")}`;
}

function formatCurrency(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function AdminOwnerDashboardPage({
  params,
}: {
  params: Promise<{ ownerId: string }>;
}) {
  const { ownerId } = use(params);
  const data = useQuery(api.admin.ownerOverview.getOwnerDashboard, {
    ownerUserId: ownerId as Id<"users">,
  });

  if (data === undefined) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { user, properties, statements, platformClaims } = data;

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin/owner-overview"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to all owners
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-semibold">{user.name}</h1>
        {user.email && (
          <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>
        )}
        <p className="mt-2 text-sm text-muted-foreground">
          {properties.length} {properties.length === 1 ? "property" : "properties"} ·{" "}
          {statements.length} {statements.length === 1 ? "statement" : "statements"} on file ·{" "}
          {platformClaims.length} platform {platformClaims.length === 1 ? "claim" : "claims"}
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Properties
        </h2>
        {properties.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This owner has no active property stakes.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {properties.map(({ property, ownership }) => (
              <Link
                key={property._id}
                href={`/admin/owner-overview/${ownerId}/properties/${property._id}`}
                className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/40 hover:bg-muted/20"
              >
                <div className="flex items-start gap-3">
                  <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{property.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {(ownership.stakePct * 100).toFixed(0)}% stake ·{" "}
                      {ownership.role}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Platform claims
          </h2>
          {platformClaims.some((claim) =>
            isActivePlatformClaim(claim.platformClaim),
          ) ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-600 dark:text-rose-400">
              <AlertTriangle className="h-3 w-3" />
              Active follow-up
            </span>
          ) : null}
        </div>
        {platformClaims.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center">
            <Ban className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              No platform suspension or claim follow-up incidents for this owner.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Incident</th>
                  <th className="px-4 py-3 text-left font-medium">Platform</th>
                  <th className="px-4 py-3 text-left font-medium">
                    Suspension
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    Canceled
                  </th>
                  <th className="px-4 py-3 text-left font-medium">
                    Follow-up
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {platformClaims.map((claim) => {
                  const summary = buildPlatformClaimSummary(claim.platformClaim);
                  return (
                    <tr
                      key={claim._id}
                      className="border-t border-border transition-colors hover:bg-muted/30"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium">{claim.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {claim.propertyName}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {summary.platform}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {summary.suspensionWindow}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {claim.platformClaim.canceledBookingCount ?? 0}
                      </td>
                      <td className="px-4 py-3">
                        <ClaimStateBadge
                          state={
                            claim.platformClaim.claimFollowUpState ??
                            "not_started"
                          }
                        />
                        {summary.followUpDueAt ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            Due {summary.followUpDueAt}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/incidents?id=${claim._id}`}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          Open <ExternalLink className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Statements
        </h2>
        {statements.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center">
            <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              No statements yet for this owner. Open a property to prepare one.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Period</th>
                  <th className="px-4 py-3 text-left font-medium">Property</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">
                    Owner payout
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {statements.map((s) => {
                  const prop = properties.find(
                    (p) => p.property._id === s.propertyId,
                  );
                  return (
                    <tr
                      key={s._id}
                      className="border-t border-border transition-colors hover:bg-muted/30"
                    >
                      <td className="px-4 py-3 font-medium">
                        {formatPeriod(s.periodStart)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {prop?.property.name ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={s.status} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatCurrency(
                          s.snapshotTotals.ownerPayout,
                          prop?.property.currency ?? "USD",
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {prop && (
                          <Link
                            href={`/admin/owner-overview/${ownerId}/properties/${s.propertyId}?period=${formatPeriodKey(s.periodStart)}`}
                            className="text-xs text-muted-foreground hover:text-foreground"
                          >
                            Open →
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function isActivePlatformClaim(platformClaim: PlatformClaim): boolean {
  const state = platformClaim.claimFollowUpState ?? "not_started";
  return state !== "approved" && state !== "denied" && state !== "closed";
}

function ClaimStateBadge({
  state,
}: {
  state: keyof typeof CLAIM_FOLLOW_UP_LABELS;
}) {
  const active = state !== "approved" && state !== "denied" && state !== "closed";
  return (
    <span
      className={
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wide " +
        (active
          ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
          : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300")
      }
    >
      {CLAIM_FOLLOW_UP_LABELS[state]}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    {
      draft: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
      ready: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
      issued: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      sent: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
      recalled: "bg-red-500/10 text-red-600 dark:text-red-400",
    }[status] ?? "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${cls}`}
    >
      {status}
    </span>
  );
}
