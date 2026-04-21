"use client";

import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MapPin,
} from "lucide-react";
import {
  SEVERITY_CHIP_CLASSNAMES,
  STATUS_CHIP_CLASSNAMES,
  isTerminalStatus,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentType,
} from "@/components/incidents/incident-status";

type Props = {
  incidentId: Id<"incidents">;
};

export function CleanerIncidentDetailClient({ incidentId }: Props) {
  const t = useTranslations("cleaner.incidents");
  const tAdmin = useTranslations("incidentsAdmin");
  const { isAuthenticated } = useConvexAuth();

  const incident = useQuery(
    api.incidents.queries.getIncidentById,
    isAuthenticated ? { incidentId } : "skip",
  );

  if (incident === undefined) {
    return (
      <div className="flex min-h-48 items-center justify-center p-6">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  if (incident === null) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertTriangle className="h-8 w-8 text-[var(--muted-foreground)]" />
        <p className="text-sm font-semibold">{t("emptyFiltered")}</p>
        <Link
          href="/cleaner/incidents"
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-semibold uppercase"
        >
          {t("backToList")}
        </Link>
      </div>
    );
  }

  const status = incident.status as IncidentStatus;
  const severity = incident.severity as IncidentSeverity | undefined;
  const type = incident.incidentType as IncidentType;

  return (
    <div className="space-y-4">
      <Link
        href="/cleaner/incidents"
        className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t("backToList")}
      </Link>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={
              "rounded-md border px-2 py-1 text-[10px] font-bold uppercase " +
              STATUS_CHIP_CLASSNAMES[status]
            }
          >
            {t(`status.${status}`)}
          </span>
          {severity ? (
            <span
              className={
                "rounded-md border px-2 py-1 text-[10px] font-bold uppercase " +
                SEVERITY_CHIP_CLASSNAMES[severity]
              }
            >
              {tAdmin(`severity.${severity}`)}
            </span>
          ) : null}
          <span className="rounded-md bg-[var(--secondary)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--muted-foreground)]">
            {tAdmin(`types.${type}`)}
          </span>
        </div>
        <h1 className="text-lg font-bold leading-tight">{incident.title}</h1>
      </div>

      {incident.photos && incident.photos.length > 0 ? (
        <div className="grid grid-cols-3 gap-1.5">
          {incident.photos
            .filter((p) => p.url)
            .map((p) =>
              p.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <a
                  key={p.id}
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="aspect-square overflow-hidden rounded border border-[var(--border)]"
                >
                  <img
                    src={p.url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </a>
              ) : null,
            )}
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-0 rounded-md border border-[var(--border)] bg-[var(--card)] overflow-hidden">
        <InfoCell
          icon={<Building2 className="h-4 w-4" />}
          label={t("detail.property")}
          value={incident.property?.name ?? "—"}
        />
        <InfoCell
          icon={<MapPin className="h-4 w-4" />}
          label={t("detail.room")}
          value={incident.roomName ?? "—"}
        />
        <InfoCell
          icon={<CalendarClock className="h-4 w-4" />}
          label={t("detail.reported")}
          value={new Date(incident.createdAt).toLocaleString()}
          className="col-span-2"
        />
        {incident.cleaningJobId ? (
          <div className="col-span-2 flex items-center justify-between border-t border-[var(--border)] px-4 py-3">
            <span className="text-[10px] font-semibold uppercase text-[var(--muted-foreground)]">
              {t("detail.linkedJob")}
            </span>
            <Link
              href={`/cleaner/jobs/${incident.cleaningJobId}`}
              className="flex items-center gap-1 text-xs font-semibold text-[var(--primary)] hover:underline"
            >
              {t("detail.openJob")}
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        ) : null}
      </dl>

      {incident.description ? (
        <section className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-[10px] font-semibold uppercase text-[var(--muted-foreground)]">
            {t("detail.description")}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
            {incident.description}
          </p>
        </section>
      ) : null}

      {isTerminalStatus(status) && incident.resolvedAt ? (
        <section className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 className="h-4 w-4" />
            {t(`status.${status}`)}
          </div>
          <p className="mt-1 text-xs">
            {new Date(incident.resolvedAt).toLocaleString()}
            {incident.resolver?.name
              ? ` · ${incident.resolver.name}`
              : incident.resolver?.email
                ? ` · ${incident.resolver.email}`
                : ""}
          </p>
          {incident.resolutionNotes ? (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
              {incident.resolutionNotes}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function InfoCell({
  icon,
  label,
  value,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div
      className={
        "flex items-start gap-3 border-t border-r border-[var(--border)] px-4 py-3 text-sm " +
        "last:border-r-0 " +
        (className ?? "")
      }
    >
      <span className="mt-0.5 text-[var(--muted-foreground)]">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase text-[var(--muted-foreground)]">
          {label}
        </p>
        <p className="mt-0.5 truncate font-medium">{value}</p>
      </div>
    </div>
  );
}
