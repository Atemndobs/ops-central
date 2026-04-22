"use client";

import { useEffect, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { translateRoomDisplay } from "@/lib/room-i18n";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MapPin,
  RefreshCw,
  Trello,
  User,
  X,
} from "lucide-react";
import {
  INCIDENT_STATUSES,
  SEVERITY_CHIP_CLASSNAMES,
  STATUS_CHIP_CLASSNAMES,
  isTerminalStatus,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentType,
} from "@/components/incidents/incident-status";

type Props = {
  incidentId: Id<"incidents"> | null;
  onClose: () => void;
};

export function IncidentDetailDrawer({ incidentId, onClose }: Props) {
  const { isAuthenticated } = useConvexAuth();
  const open = incidentId !== null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex" aria-modal role="dialog">
      <button
        type="button"
        aria-label="Close incident details"
        onClick={onClose}
        className="flex-1 bg-black/60"
      />
      <aside className="relative flex h-full w-full max-w-xl flex-col border-l bg-[var(--card)] shadow-2xl">
        {incidentId && isAuthenticated ? (
          <DrawerBody incidentId={incidentId} onClose={onClose} />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
          </div>
        )}
      </aside>
    </div>
  );
}

function DrawerBody({
  incidentId,
  onClose,
}: {
  incidentId: Id<"incidents">;
  onClose: () => void;
}) {
  const t = useTranslations("incidentsAdmin");
  const locale = useLocale();
  const incident = useQuery(api.incidents.queries.getIncidentById, {
    incidentId,
  });
  const updateStatus = useMutation(api.incidents.mutations.updateIncidentStatus);
  const retryTrello = useMutation(api.integrations.trello.retryIncidentSync);

  const [editMode, setEditMode] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<IncidentStatus | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (incident) {
      setPendingStatus(incident.status as IncidentStatus);
      setNotes(incident.resolutionNotes ?? "");
      setEditMode(false);
      setError(null);
    }
  }, [incident?._id, incident]);

  if (incident === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  if (incident === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertTriangle className="h-8 w-8 text-[var(--muted-foreground)]" />
        <p className="text-sm font-semibold">{t("detail.notFound")}</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-none border border-[var(--border)] px-3 py-1.5 text-xs font-semibold uppercase"
        >
          {t("detail.close")}
        </button>
      </div>
    );
  }

  const severity = incident.severity as IncidentSeverity | undefined;
  const status = incident.status as IncidentStatus;
  const canResolve = incident.canResolve;

  async function handleSave() {
    if (!pendingStatus) return;
    setSaving(true);
    setError(null);
    try {
      await updateStatus({
        incidentId,
        status: pendingStatus,
        resolutionNotes: notes.trim() ? notes.trim() : undefined,
      });
      setEditMode(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setSaving(false);
    }
  }

  async function handleRetryTrello() {
    setRetrying(true);
    try {
      await retryTrello({ incidentId });
    } catch (err) {
      console.error("Trello retry failed", err);
    } finally {
      setRetrying(false);
    }
  }

  const hasChanges =
    pendingStatus !== status ||
    (notes.trim() || "") !== (incident.resolutionNotes ?? "");

  return (
    <>
      <header className="flex items-start justify-between gap-3 border-b p-5">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={
                "rounded-none border px-2 py-1 text-[10px] font-bold uppercase " +
                STATUS_CHIP_CLASSNAMES[status]
              }
            >
              {t(`tabs.${status}`)}
            </span>
            {severity ? (
              <span
                className={
                  "rounded-none border px-2 py-1 text-[10px] font-bold uppercase " +
                  SEVERITY_CHIP_CLASSNAMES[severity]
                }
              >
                {t(`severity.${severity}`)}
              </span>
            ) : null}
            <span className="text-micro rounded-none bg-[var(--secondary)] px-1.5 py-0.5 text-[var(--muted-foreground)]">
              {t(`types.${incident.incidentType as IncidentType}`)}
            </span>
          </div>
          <h2 className="mt-2 text-lg font-bold leading-tight">
            {incident.title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("detail.close")}
          className="rounded-none border border-[var(--border)] p-2 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {incident.photos.length > 0 ? (
          <div className="grid grid-cols-2 gap-1 p-1 sm:grid-cols-3">
            {incident.photos.map((p) =>
              p.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <a
                  key={p.id}
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="relative block aspect-square overflow-hidden border border-[var(--border)]"
                >
                  <img
                    src={p.url}
                    alt=""
                    className="h-full w-full object-cover transition-transform hover:scale-105"
                  />
                </a>
              ) : null,
            )}
          </div>
        ) : null}

        <dl className="grid grid-cols-2 gap-0 border-t">
          <InfoCell
            icon={<Building2 className="h-4 w-4" />}
            label={t("detail.property")}
            value={incident.property?.name ?? "—"}
          />
          <InfoCell
            icon={<MapPin className="h-4 w-4" />}
            label={t("detail.room")}
            value={translateRoomDisplay(incident.roomName ?? "", locale) || "—"}
          />
          <InfoCell
            icon={<User className="h-4 w-4" />}
            label={t("detail.reportedByLabel")}
            value={incident.reporter?.name ?? incident.reporter?.email ?? "—"}
          />
          <InfoCell
            icon={<CalendarClock className="h-4 w-4" />}
            label={t("detail.reportedAt")}
            value={new Date(incident.createdAt).toLocaleString()}
          />
          {incident.cleaningJobId ? (
            <div className="col-span-2 flex items-center justify-between gap-2 border-t px-5 py-3 text-sm">
              <span className="text-micro text-[var(--muted-foreground)]">
                {t("detail.linkedJob")}
              </span>
              <Link
                href={`/jobs/${incident.cleaningJobId}`}
                className="flex items-center gap-1 font-medium text-[var(--primary)] hover:underline"
              >
                {t("detail.openJob")} <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>
          ) : null}
        </dl>

        <section className="border-t px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
              <Trello className="h-4 w-4" />
              <span className="font-semibold uppercase tracking-wide">Trello</span>
            </div>
            {incident.trelloCardUrl ? (
              <a
                href={incident.trelloCardUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs font-semibold text-[var(--primary)] hover:underline"
              >
                Open card <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <button
                type="button"
                onClick={handleRetryTrello}
                disabled={retrying}
                className="flex items-center gap-1 rounded-none border border-[var(--border)] px-2 py-1 text-[10px] font-bold uppercase tracking-wide hover:bg-[var(--accent)] disabled:opacity-50"
              >
                {retrying ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                {retrying ? "Syncing…" : "Sync to Trello"}
              </button>
            )}
          </div>
          {incident.trelloSyncError && !incident.trelloCardUrl ? (
            <p className="mt-2 rounded-none border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
              Last sync failed: {incident.trelloSyncError}
            </p>
          ) : null}
        </section>

        {incident.description ? (
          <section className="border-t p-5">
            <p className="text-micro text-[var(--muted-foreground)]">
              {t("detail.description")}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
              {incident.description}
            </p>
          </section>
        ) : null}

        {incident.incidentContext ? (
          <section className="border-t p-5">
            <p className="text-micro text-[var(--muted-foreground)]">
              {t("detail.context")}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
              {incident.incidentContext}
            </p>
          </section>
        ) : null}

        {incident.customItemDescription ? (
          <section className="border-t p-5">
            <p className="text-micro text-[var(--muted-foreground)]">
              {t("detail.missingItem")}
            </p>
            <p className="mt-2 text-sm">
              {incident.customItemDescription}
              {incident.quantityMissing ? ` × ${incident.quantityMissing}` : ""}
            </p>
          </section>
        ) : null}

        {isTerminalStatus(status) && incident.resolvedAt ? (
          <section className="border-t bg-[var(--secondary)]/30 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              {t(`tabs.${status}`)}
            </div>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              {new Date(incident.resolvedAt).toLocaleString()}{" "}
              {t("detail.resolvedBy")}{" "}
              {incident.resolver?.name ??
                incident.resolver?.email ??
                t("detail.unknownUser")}
            </p>
            {incident.resolutionNotes ? (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
                {incident.resolutionNotes}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>

      {canResolve ? (
        <footer className="border-t bg-[var(--card)] p-5">
          {!editMode ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-[var(--muted-foreground)]">
                {isTerminalStatus(status)
                  ? t("detail.resolveFooterTerminal")
                  : t("detail.resolveFooterActive")}
              </p>
              <button
                type="button"
                onClick={() => setEditMode(true)}
                className="rounded-none bg-[var(--primary)] px-4 py-2 text-xs font-bold uppercase tracking-wide text-[var(--primary-foreground)] hover:opacity-90"
              >
                {t("detail.updateStatus")}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="status-select"
                  className="text-micro text-[var(--muted-foreground)]"
                >
                  {t("detail.statusField")}
                </label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {INCIDENT_STATUSES.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setPendingStatus(opt)}
                      disabled={saving}
                      className={
                        "flex items-center justify-between gap-2 rounded-none border px-3 py-2 text-xs font-semibold uppercase transition-colors " +
                        (pendingStatus === opt
                          ? STATUS_CHIP_CLASSNAMES[opt] +
                            " ring-2 ring-[var(--primary)] ring-offset-0"
                          : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]")
                      }
                    >
                      <span>{t(`tabs.${opt}`)}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label
                  htmlFor="resolution-notes"
                  className="text-micro text-[var(--muted-foreground)]"
                >
                  {pendingStatus && isTerminalStatus(pendingStatus)
                    ? t("detail.notesField")
                    : t("detail.notesFieldOptional")}
                </label>
                <textarea
                  id="resolution-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder={t("detail.notesPlaceholder")}
                  className="mt-1 w-full rounded-none border bg-[var(--background)] p-3 text-sm outline-none focus:border-[var(--primary)]"
                  disabled={saving}
                />
              </div>
              {error ? (
                <p className="rounded-none border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {error}
                </p>
              ) : null}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditMode(false);
                    setPendingStatus(status);
                    setNotes(incident.resolutionNotes ?? "");
                    setError(null);
                  }}
                  disabled={saving}
                  className="rounded-none border border-[var(--border)] px-4 py-2 text-xs font-semibold uppercase hover:bg-[var(--accent)]"
                >
                  {t("detail.cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !hasChanges}
                  className="flex items-center gap-2 rounded-none bg-[var(--primary)] px-4 py-2 text-xs font-bold uppercase tracking-wide text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {t("detail.save")}
                </button>
              </div>
            </div>
          )}
        </footer>
      ) : null}
    </>
  );
}

function InfoCell({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 border-t border-r px-5 py-3 text-sm last:border-r-0">
      <span className="mt-0.5 text-[var(--muted-foreground)]">{icon}</span>
      <div className="min-w-0">
        <p className="text-micro text-[var(--muted-foreground)]">{label}</p>
        <p className="mt-0.5 truncate font-medium">{value}</p>
      </div>
    </div>
  );
}
