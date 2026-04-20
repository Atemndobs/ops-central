"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Bath,
  BedDouble,
  CalendarDays,
  ClipboardList,
  Clock,
  Info,
  MapPin,
  MessageCircle,
  Minimize2,
  RefreshCw,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Countdown hook + badge                                             */
/* ------------------------------------------------------------------ */

export type CountdownTier = "calm" | "soon" | "urgent";

function getCountdownTier(ms: number): CountdownTier {
  if (ms <= 0) return "urgent";
  if (ms <= 60 * 60 * 1000) return "urgent";       // ≤ 60 min
  if (ms <= 24 * 60 * 60 * 1000) return "soon";    // ≤ 1 day
  return "calm";                                     // > 1 day
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "Now";

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  // Under 1 hour — show minutes'seconds"
  return `${minutes}' ${String(seconds).padStart(2, "0")}"`;
}

export function useCountdown(targetTimestamp: number | null | undefined) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (targetTimestamp == null) return;

    const remaining = targetTimestamp - Date.now();
    // Tick every second when < 1 hour, every 30s otherwise
    const interval = remaining <= 60 * 60 * 1000 ? 1000 : 30_000;

    const id = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(id);
  }, [targetTimestamp, now]);

  if (targetTimestamp == null) {
    return { formatted: "—", tier: "calm" as CountdownTier, remaining: Infinity };
  }

  const remaining = Math.max(0, targetTimestamp - now);
  return {
    formatted: formatCountdown(remaining),
    tier: getCountdownTier(remaining),
    remaining,
  };
}

const TIER_STYLES: Record<CountdownTier, string> = {
  calm: "bg-white text-[var(--cleaner-ink)]",
  soon: "bg-[var(--cleaner-primary)] text-white",
  urgent: "bg-[var(--destructive)] text-white",
};

export function CleanerCountdownBadge({
  targetTimestamp,
  label,
  size = "normal",
}: {
  targetTimestamp: number | null | undefined;
  label?: string;
  size?: "normal" | "compact";
}) {
  const t = useTranslations();
  const { formatted, tier } = useCountdown(targetTimestamp);
  const displayLabel = label ?? t("cleaner.summary.timeToNextJob");

  // Don't render anything for past timestamps
  if (targetTimestamp != null && targetTimestamp <= Date.now()) {
    return null;
  }

  if (size === "compact") {
    return (
      <div
        className={cn(
          "inline-flex items-center justify-center rounded-[10px] px-3 py-2 text-[13px] font-semibold",
          TIER_STYLES[tier],
        )}
      >
        {formatted}
      </div>
    );
  }

  return (
    <div className={cn("rounded-[10px] px-4 py-2 shadow-sm", TIER_STYLES[tier])}>
      <p className="font-[var(--font-cleaner-body)] text-[31px] font-bold leading-none tracking-[-0.03em]">
        {formatted}
      </p>
      <p className={cn("mt-1 text-[10px]", tier === "calm" ? "text-[var(--cleaner-muted)]" : "text-white/90")}>
        {displayLabel}
      </p>
    </div>
  );
}

export type CleanerJobAppearance = "open" | "in_review" | "completed" | "rework";

export function mapJobAppearance(status: string): CleanerJobAppearance {
  if (status === "completed") {
    return "completed";
  }
  if (status === "awaiting_approval") {
    return "in_review";
  }
  if (status === "rework_required") {
    return "rework";
  }
  return "open";
}

export function formatCleanerDate(value?: number | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString([], {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCleanerTime(value: number) {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatCleanerTimeRange(
  start?: number | null,
  end?: number | null,
): string {
  if (!start) return "—";
  if (!end) return formatCleanerTime(start);
  return `${formatCleanerTime(start)} – ${formatCleanerTime(end)}`;
}

export function CleanerSection({
  title,
  eyebrow,
  children,
}: {
  title?: string;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="cleaner-card p-4">
      {eyebrow ? <p className="cleaner-eyebrow">{eyebrow}</p> : null}
      {title ? <h2 className="cleaner-card-title mt-1">{title}</h2> : null}
      <div className={title || eyebrow ? "mt-4" : ""}>{children}</div>
    </section>
  );
}

export function CleanerStatusPill({
  appearance,
  label,
}: {
  appearance: CleanerJobAppearance;
  label: string;
}) {
  const className =
    appearance === "open"
      ? "bg-[var(--cleaner-primary)] text-white"
      : appearance === "in_review"
        ? "bg-[var(--cleaner-ink)] text-white"
        : appearance === "completed"
          ? "bg-[#111111] text-white"
          : "bg-[var(--destructive)] text-white";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 cleaner-meta text-[9px]",
        className,
      )}
    >
      {label}
    </span>
  );
}

export function CleanerIconButton({
  icon: Icon,
  label,
  active = false,
  badge,
  onClick,
  size = "tool",
  className,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  badge?: number;
  onClick?: () => void;
  size?: "tool" | "nav";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "cleaner-tool-button relative",
        size === "nav" ? "h-12 w-12" : "h-8 w-8",
        active
          ? "bg-[var(--cleaner-primary)] text-white"
          : size === "nav"
            ? "bg-[var(--cleaner-muted)] text-white"
            : "bg-white text-[var(--cleaner-ink)]",
        className,
      )}
    >
      <Icon className={cn(size === "nav" ? "h-6 w-6" : "h-4.5 w-4.5")} />
      {badge && badge > 0 ? (
        <span className="absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-[var(--destructive)] px-1 text-[9px] font-bold text-white">
          {badge > 9 ? "9+" : badge}
        </span>
      ) : null}
    </button>
  );
}

export function CleanerSummaryCard({
  nextJobs,
  inReview,
  unreadMessages,
  updates,
  onToggle,
  userName,
  nextJobAt,
}: {
  nextJobs: number;
  inReview: number;
  unreadMessages: number;
  updates: number;
  onToggle?: () => void;
  userName?: string;
  nextJobAt?: number | null;
}) {
  const t = useTranslations();
  const items = [
    { label: t("cleaner.summary.nextJobs"), value: nextJobs, icon: ClipboardList },
    { label: t("cleaner.summary.inReview"), value: inReview, icon: Info },
    { label: t("cleaner.summary.messages"), value: unreadMessages, icon: MessageCircle },
    { label: t("cleaner.summary.update"), value: updates, icon: RefreshCw },
  ];

  return (
    <section className="rounded-[18px] bg-[linear-gradient(135deg,var(--cleaner-primary),var(--cleaner-primary-soft))] px-4 py-4 text-white shadow-[var(--cleaner-shadow)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="cleaner-display text-white">{t("cleaner.summary.greeting", { name: userName ?? "" })}</p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="rounded-full p-1 text-white/90 transition hover:bg-white/10"
          aria-label={t("cleaner.summary.collapseSummary")}
          title={t("cleaner.summary.collapseSummary")}
        >
          <Minimize2 className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-4 flex items-start justify-between gap-3">
        <CleanerCountdownBadge targetTimestamp={nextJobAt} />
        <div className="grid flex-1 grid-cols-4 gap-2">
          {items.map(({ label, value, icon: Icon }) => (
            <div key={label} className="flex flex-col items-center gap-1.5 text-center">
              <div className="relative flex h-7 w-7 items-center justify-center rounded-full bg-white/15">
                <Icon className="h-3.5 w-3.5" />
                {value > 0 ? (
                  <span className="absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-[var(--destructive)] px-1 text-[8px] font-bold text-white">
                    {value > 9 ? "9+" : value}
                  </span>
                ) : null}
              </div>
              <span className="text-[8px] leading-tight text-white/90">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function CleanerJobCard({
  propertyName,
  address,
  city,
  guestCount,
  bedrooms,
  bathrooms,
  partyRiskFlag,
  scheduledAt,
  scheduledEndAt,
  notes,
  appearance,
  statusLabel,
  detailHref,
  actionHref,
  actionLabel,
}: {
  propertyName: string;
  address?: string | null;
  city?: string | null;
  guestCount?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  partyRiskFlag?: boolean;
  scheduledAt?: number | null;
  scheduledEndAt?: number | null;
  notes?: string | null;
  appearance: CleanerJobAppearance;
  statusLabel: string;
  detailHref: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  const t = useTranslations();
  const titleClass =
    appearance === "open" ? "text-[var(--cleaner-primary)]" : "text-[var(--cleaner-ink)]";
  const mapsHref = address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
    : null;

  return (
    <article
      className={cn(
        "cleaner-card relative p-4 transition-colors hover:bg-[var(--muted)]/40",
        appearance === "open" ? "border-[3px] border-[var(--cleaner-primary)]" : "",
      )}
    >
      {/* Full-card tap target → job detail. Interactive children sit above via z-10. */}
      <Link
        href={detailHref}
        aria-label={address || propertyName}
        className="absolute inset-0 z-0 rounded-[24px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--cleaner-primary)]"
      />

      <div className="relative z-10 flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1.5 text-[var(--cleaner-muted)]">
          <Clock className="h-4 w-4" />
          <span className="text-[13px] font-medium">
            {formatCleanerTimeRange(scheduledAt, scheduledEndAt)}
          </span>
        </div>
        <CleanerStatusPill appearance={appearance} label={statusLabel} />
      </div>

      <div className="relative z-10 mt-3">
        {mapsHref ? (
          <a
            href={mapsHref}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex items-start gap-1.5 cleaner-display text-[18px] hover:underline",
              titleClass,
            )}
          >
            <MapPin className="mt-1 h-4 w-4 shrink-0" />
            <span>{address}</span>
          </a>
        ) : (
          <h3 className={cn("cleaner-display text-[18px]", titleClass)}>
            {t("cleaner.noAddress")}
          </h3>
        )}
      </div>

      <div className="relative z-10 mt-3 space-y-2.5">
        <CleanerMetaRow icon={ClipboardList} text={propertyName} />
        {city ? <CleanerMetaRow icon={MapPin} text={city} /> : null}
        {typeof guestCount === "number" && guestCount > 0 ? (
          <CleanerMetaRow
            icon={Users}
            text={t("cleaner.guestCount", { count: guestCount })}
          />
        ) : null}
        <CleanerMetaRow icon={Info} text={notes || t("cleaner.noCleanerNotes")} />
      </div>

      <div className="relative z-10 mt-4 flex flex-wrap items-center gap-2">
        {typeof bedrooms === "number" && bedrooms > 0 ? (
          <Link
            href={detailHref}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--muted)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--cleaner-ink)] hover:bg-[var(--muted)]/80"
          >
            <BedDouble className="h-3.5 w-3.5" />
            {t("cleaner.bedCount", { count: bedrooms })}
          </Link>
        ) : null}
        {typeof bathrooms === "number" && bathrooms > 0 ? (
          <Link
            href={detailHref}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--muted)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--cleaner-ink)] hover:bg-[var(--muted)]/80"
          >
            <Bath className="h-3.5 w-3.5" />
            {t("cleaner.bathCount", { count: bathrooms })}
          </Link>
        ) : null}
        {partyRiskFlag ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--destructive)]/15 px-2.5 py-1.5 text-[12px] font-semibold text-[var(--destructive)]">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t("cleaner.highRisk")}
          </span>
        ) : null}
        {actionHref && actionLabel ? (
          <Link href={actionHref} className="cleaner-primary-button ml-auto">
            {actionLabel}
          </Link>
        ) : null}
        <CleanerCountdownBadge targetTimestamp={scheduledAt} size="compact" />
      </div>
    </article>
  );
}

function CleanerMetaRow({
  icon: Icon,
  text,
}: {
  icon: LucideIcon;
  text: string;
}) {
  return (
    <div className="flex items-start gap-2 text-[var(--cleaner-muted)]">
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="min-w-0 whitespace-pre-line text-[13px] leading-[1.35]">{text}</p>
    </div>
  );
}
