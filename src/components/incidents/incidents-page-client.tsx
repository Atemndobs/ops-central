"use client";

import { useEffect, useMemo, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { translateRoomDisplay } from "@/lib/room-i18n";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  AlertTriangle,
  CircleDot,
  Clock,
  Filter,
  Image as ImageIcon,
  Loader2,
  Search,
  ShieldAlert,
} from "lucide-react";
import {
  INCIDENT_STATUSES,
  SEVERITY_CHIP_CLASSNAMES,
  SEVERITY_DOT_CLASSNAMES,
  STATUS_BAR_CLASSNAMES,
  STATUS_CHIP_CLASSNAMES,
  formatRelativeTime,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentType,
} from "@/components/incidents/incident-status";
import { IncidentDetailDrawer } from "@/components/incidents/incident-detail-drawer";

type StatusFilter = IncidentStatus | "all";
type SeverityFilter = IncidentSeverity | "all";

const STATUS_TAB_VALUES: StatusFilter[] = [
  "all",
  "open",
  "in_progress",
  "resolved",
  "wont_fix",
];

export function IncidentsPageClient() {
  const t = useTranslations("incidentsAdmin");
  const locale = useLocale();
  const { isAuthenticated } = useConvexAuth();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<Id<"incidents"> | null>(null);
  const [nowTs, setNowTs] = useState<number>(() => Date.now());

  // Deep-link support: ?id=<incidentId> auto-opens the drawer. Used by the
  // "OpsCentral" link on Trello cards (see convex/integrations/trello.ts).
  const searchParams = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    const idParam = searchParams.get("id");
    if (idParam && idParam !== selectedId) {
      setSelectedId(idParam as Id<"incidents">);
    }
  }, [searchParams, selectedId]);

  function handleDrawerClose() {
    setSelectedId(null);
    // Drop the ?id= from the URL so refresh doesn't re-open it.
    if (searchParams.get("id")) {
      router.replace("/incidents", { scroll: false });
    }
  }

  useEffect(() => {
    const id = window.setInterval(() => setNowTs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const incidents = useQuery(
    api.incidents.queries.listIncidents,
    isAuthenticated
      ? {
          status: statusFilter === "all" ? undefined : statusFilter,
          severity: severityFilter === "all" ? undefined : severityFilter,
          limit: 200,
        }
      : "skip",
  );

  const allIncidents = useQuery(
    api.incidents.queries.listIncidents,
    isAuthenticated ? { limit: 500 } : "skip",
  );

  const summary = useMemo(() => {
    const base = allIncidents ?? [];
    const openCount = base.filter((i) => i.status === "open").length;
    const inProgressCount = base.filter((i) => i.status === "in_progress").length;
    const resolvedCount = base.filter((i) => i.status === "resolved").length;
    const criticalCount = base.filter(
      (i) => i.severity === "critical" && i.status !== "resolved" && i.status !== "wont_fix",
    ).length;
    return { openCount, inProgressCount, resolvedCount, criticalCount };
  }, [allIncidents]);

  const filtered = useMemo(() => {
    const list = incidents ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((i) => {
      return (
        i.title.toLowerCase().includes(needle) ||
        (i.property?.name ?? "").toLowerCase().includes(needle) ||
        (i.reporter?.name ?? "").toLowerCase().includes(needle) ||
        (i.roomName ?? "").toLowerCase().includes(needle)
      );
    });
  }, [incidents, search]);

  const isLoading = incidents === undefined;

  return (
    <>
      <div className="space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-micro text-[var(--muted-foreground)]">
              {t("eyebrow")}
            </p>
            <h1 className="mt-2 text-display">{t("title")}</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {t("subtitle")}
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <StatCard
            label={t("stats.open")}
            count={summary.openCount}
            tone="bg-slate-400"
            icon={<CircleDot className="h-5 w-5 text-slate-500" />}
          />
          <StatCard
            label={t("stats.inProgress")}
            count={summary.inProgressCount}
            tone="bg-amber-500"
            icon={<Clock className="h-5 w-5 text-amber-500" />}
          />
          <StatCard
            label={t("stats.resolved")}
            count={summary.resolvedCount}
            tone="bg-emerald-500"
            icon={<ShieldAlert className="h-5 w-5 text-emerald-500" />}
          />
          <StatCard
            label={t("stats.criticalActive")}
            count={summary.criticalCount}
            tone="bg-rose-500"
            icon={<AlertTriangle className="h-5 w-5 text-rose-500" />}
          />
        </div>

        <div className="no-line-card overflow-hidden border">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-[var(--secondary)]/40 p-4">
            <div className="flex flex-wrap items-center gap-2">
              {STATUS_TAB_VALUES.map((value) => {
                const active = statusFilter === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setStatusFilter(value)}
                    className={
                      "rounded-none border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors " +
                      (active
                        ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                        : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]")
                    }
                  >
                    {t(`tabs.${value}`)}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("searchPlaceholder")}
                  className="w-72 rounded-none border bg-[var(--card)] py-2 pl-10 pr-3 text-sm outline-none focus:border-[var(--primary)]"
                />
              </div>
              <div className="flex items-center gap-2 rounded-none border bg-[var(--card)] px-3 py-2 text-xs">
                <Filter className="h-4 w-4 text-[var(--muted-foreground)]" />
                <label className="text-[var(--muted-foreground)]" htmlFor="severity-filter">
                  {t("severityLabel")}
                </label>
                <select
                  id="severity-filter"
                  value={severityFilter}
                  onChange={(e) =>
                    setSeverityFilter(e.target.value as SeverityFilter)
                  }
                  className="bg-transparent text-sm font-medium outline-none"
                >
                  <option value="all">{t("severityAll")}</option>
                  <option value="critical">{t("severity.critical")}</option>
                  <option value="high">{t("severity.high")}</option>
                  <option value="medium">{t("severity.medium")}</option>
                  <option value="low">{t("severity.low")}</option>
                </select>
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="flex min-h-72 items-center justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              hasFilter={
                statusFilter !== "all" || severityFilter !== "all" || search !== ""
              }
              t={t}
            />
          ) : (
            <div className="divide-y">
              {filtered.map((incident) => (
                <button
                  key={incident._id}
                  type="button"
                  onClick={() => setSelectedId(incident._id)}
                  className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-[var(--accent)]/40 focus:bg-[var(--accent)]/60 focus:outline-none"
                >
                  <span
                    className={
                      "h-14 w-1 shrink-0 " + STATUS_BAR_CLASSNAMES[incident.status as IncidentStatus]
                    }
                    aria-hidden
                  />
                  {/* Photo thumbnail — mirrors the cleaner mobile list */}
                  <span className="relative block h-14 w-14 shrink-0 overflow-hidden border border-[var(--border)]">
                    {incident.firstPhotoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={incident.firstPhotoUrl}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center bg-[var(--secondary)]/40 text-[var(--muted-foreground)]">
                        <ImageIcon className="h-5 w-5" />
                      </span>
                    )}
                    {(incident.photoCount ?? 0) > 1 ? (
                      <span className="absolute bottom-0 right-0 rounded-none bg-black/70 px-1 text-[9px] font-bold leading-tight text-white">
                        +{(incident.photoCount ?? 0) - 1}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex flex-1 flex-col gap-1 min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      {incident.severity ? (
                        <span
                          className={
                            "inline-block h-2 w-2 rounded-full " +
                            SEVERITY_DOT_CLASSNAMES[incident.severity as IncidentSeverity]
                          }
                          aria-label={t(`severity.${incident.severity as IncidentSeverity}`)}
                        />
                      ) : null}
                      <span className="text-sm font-semibold text-[var(--foreground)] truncate">
                        {incident.title}
                      </span>
                      <span className="text-micro rounded-none bg-[var(--secondary)] px-1.5 py-0.5 text-[var(--muted-foreground)]">
                        {t(`types.${incident.incidentType as IncidentType}`)}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted-foreground)]">
                      <span className="font-medium text-[var(--foreground)]">
                        {incident.property?.name ?? "Unknown property"}
                      </span>
                      {incident.roomName ? <span>{translateRoomDisplay(incident.roomName, locale)}</span> : null}
                      <span>
                        {t("reportedBy")}{" "}
                        {incident.reporter?.name ?? t("detail.unknownUser")}
                      </span>
                      <span className="font-mono">{formatRelativeTime(incident.createdAt, nowTs)}</span>
                    </span>
                  </span>
                  <span className="flex items-center gap-3 shrink-0">
                    {incident.severity ? (
                      <span
                        className={
                          "hidden rounded-none border px-2 py-1 text-[10px] font-bold uppercase md:inline-block " +
                          SEVERITY_CHIP_CLASSNAMES[incident.severity as IncidentSeverity]
                        }
                      >
                        {t(`severity.${incident.severity as IncidentSeverity}`)}
                      </span>
                    ) : null}
                    <span
                      className={
                        "rounded-none border px-2 py-1 text-[10px] font-bold uppercase " +
                        STATUS_CHIP_CLASSNAMES[incident.status as IncidentStatus]
                      }
                    >
                      {t(`tabs.${incident.status as IncidentStatus}`)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <IncidentDetailDrawer
        incidentId={selectedId}
        onClose={handleDrawerClose}
      />
    </>
  );
}

type StatCardProps = {
  label: string;
  count: number;
  tone: string;
  icon: React.ReactNode;
};

function StatCard({ label, count, tone, icon }: StatCardProps) {
  return (
    <div className="no-line-card flex items-center justify-between border p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center border border-[var(--border)]">
          {icon}
        </span>
        <div>
          <p className="text-micro text-[var(--muted-foreground)]">{label}</p>
          <p className="mt-0.5 text-2xl font-bold">{count}</p>
        </div>
      </div>
      <span className={"h-10 w-1.5 " + tone} aria-hidden />
    </div>
  );
}

function EmptyState({
  hasFilter,
  t,
}: {
  hasFilter: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex min-h-72 items-center justify-center p-8 text-center">
      <div className="max-w-sm">
        <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-[var(--muted-foreground)]" />
        <p className="text-sm font-semibold">
          {hasFilter ? t("emptyFiltered") : t("emptyAll")}
        </p>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          {hasFilter ? t("emptyFilteredHint") : t("emptyAllHint")}
        </p>
      </div>
    </div>
  );
}

// Re-export for downstream references
export { INCIDENT_STATUSES };
