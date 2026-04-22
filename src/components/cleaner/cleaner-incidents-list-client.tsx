"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { translateRoomDisplay } from "@/lib/room-i18n";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  AlertTriangle,
  Image as ImageIcon,
  Loader2,
  Plus,
} from "lucide-react";
import {
  SEVERITY_DOT_CLASSNAMES,
  STATUS_CHIP_CLASSNAMES,
  formatRelativeTime,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentType,
} from "@/components/incidents/incident-status";

type StatusFilter = IncidentStatus | "all";

const STATUS_TAB_VALUES: StatusFilter[] = [
  "all",
  "open",
  "in_progress",
  "resolved",
];

export function CleanerIncidentsListClient() {
  const t = useTranslations("cleaner.incidents");
  const tAdmin = useTranslations("incidentsAdmin");
  const locale = useLocale();
  const { isAuthenticated } = useConvexAuth();
  const searchParams = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [nowTs, setNowTs] = useState<number>(() => Date.now());
  const [showBanner, setShowBanner] = useState<boolean>(false);

  useEffect(() => {
    if (searchParams.get("submitted") === "1") {
      setShowBanner(true);
      const timer = window.setTimeout(() => setShowBanner(false), 4000);
      return () => window.clearTimeout(timer);
    }
  }, [searchParams]);

  useEffect(() => {
    const id = window.setInterval(() => setNowTs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const incidents = useQuery(
    api.incidents.queries.listMyIncidents,
    isAuthenticated
      ? {
          status: statusFilter === "all" ? undefined : statusFilter,
          limit: 200,
        }
      : "skip",
  );

  const filtered = useMemo(() => incidents ?? [], [incidents]);
  const isLoading = incidents === undefined;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{t("title")}</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {t("subtitle")}
          </p>
        </div>
        <Link
          href="/cleaner/incidents/new"
          className="flex items-center gap-2 rounded-md bg-[var(--primary)] px-3 py-2 text-xs font-bold uppercase tracking-wide text-[var(--primary-foreground)] hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          {t("reportNew")}
        </Link>
      </div>

      {showBanner ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          {t("submittedBanner")}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_TAB_VALUES.map((value) => {
          const active = statusFilter === value;
          const labelKey =
            value === "all"
              ? "tabAll"
              : value === "open"
                ? "tabOpen"
                : value === "in_progress"
                  ? "tabInProgress"
                  : "tabResolved";
          return (
            <button
              key={value}
              type="button"
              onClick={() => setStatusFilter(value)}
              className={
                "rounded-md border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors " +
                (active
                  ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]")
              }
            >
              {t(labelKey)}
            </button>
          );
        })}
      </div>

      <div className="rounded-md border border-[var(--border)] bg-[var(--card)] overflow-hidden">
        {isLoading ? (
          <div className="flex min-h-48 items-center justify-center p-6">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex min-h-48 items-center justify-center p-6 text-center">
            <div className="max-w-xs">
              <AlertTriangle className="mx-auto mb-2 h-7 w-7 text-[var(--muted-foreground)]" />
              <p className="text-sm font-semibold">
                {statusFilter === "all" ? t("emptyAll") : t("emptyFiltered")}
              </p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                {statusFilter === "all"
                  ? t("emptyAllHint")
                  : t("emptyFilteredHint")}
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {filtered.map((incident) => (
              <Link
                key={incident._id}
                href={`/cleaner/incidents/${incident._id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--accent)]/40 focus:bg-[var(--accent)]/60 focus:outline-none"
              >
                {incident.firstPhotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={incident.firstPhotoUrl}
                    alt=""
                    className="h-12 w-12 flex-shrink-0 rounded border border-[var(--border)] object-cover"
                  />
                ) : (
                  <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded border border-dashed border-[var(--border)] text-[var(--muted-foreground)]">
                    <ImageIcon className="h-4 w-4" />
                  </span>
                )}
                <span className="flex flex-1 flex-col gap-0.5 min-w-0">
                  <span className="flex items-center gap-2">
                    {incident.severity ? (
                      <span
                        className={
                          "h-2 w-2 shrink-0 rounded-full " +
                          SEVERITY_DOT_CLASSNAMES[
                            incident.severity as IncidentSeverity
                          ]
                        }
                      />
                    ) : null}
                    <span className="text-sm font-semibold text-[var(--foreground)] truncate">
                      {incident.title}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--muted-foreground)]">
                    <span>{incident.property?.name ?? "—"}</span>
                    {incident.roomName ? (
                      <span>· {translateRoomDisplay(incident.roomName, locale)}</span>
                    ) : null}
                    <span>
                      ·{" "}
                      {tAdmin(
                        `types.${incident.incidentType as IncidentType}`,
                      )}
                    </span>
                    <span className="font-mono">
                      · {formatRelativeTime(incident.createdAt, nowTs)}
                    </span>
                  </span>
                </span>
                <span
                  className={
                    "shrink-0 rounded-md border px-2 py-1 text-[10px] font-bold uppercase " +
                    STATUS_CHIP_CLASSNAMES[incident.status as IncidentStatus]
                  }
                >
                  {t(`status.${incident.status as IncidentStatus}`)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
