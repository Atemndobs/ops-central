"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useConvexAuth, useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertCircle,
  Car,
  ChevronLeft,
  Dog,
  DoorOpen,
  Droplet,
  ExternalLink,
  Flame,
  Grid3x3,
  Home,
  Info,
  Loader2,
  LogOut,
  Maximize,
  MapPin,
  Scissors,
  Trash2,
  Waves,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CleanerAccessSection, CleanerSection } from "@/components/cleaner/cleaner-ui";

type PropertyRecord = {
  _id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  country?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  squareFeet?: number | null;
  propertyType?: string | null;
  imageUrl?: string | null;
  airbnbUrl?: string | null;
  rooms?: Array<{ name: string; type: string }> | null;
  accessNotes?: string | null;
  keyLocation?: string | null;
  parkingNotes?: string | null;
  urgentNotes?: string | null;
  instructions?: Array<{
    id: string;
    category: PropertyInstructionCategory;
    title: string;
    body: string;
    sourceLang?: "en" | "es" | null;
    translations?: Partial<
      Record<"en" | "es", { title: string; body: string }>
    > | null;
    updatedAt: number;
  }> | null;
};

/** Pick the user-locale text if present, else fall back to source. */
function localizedInstruction(
  instruction: {
    title: string;
    body: string;
    sourceLang?: "en" | "es" | null;
    translations?: Partial<
      Record<"en" | "es", { title: string; body: string }>
    > | null;
  },
  locale: "en" | "es",
): { title: string; body: string } {
  const source: "en" | "es" = (instruction.sourceLang as "en" | "es") ?? "en";
  if (locale === source) {
    return { title: instruction.title, body: instruction.body };
  }
  return (
    instruction.translations?.[locale] ?? {
      title: instruction.title,
      body: instruction.body,
    }
  );
}

type PropertyInstructionCategory =
  | "access"
  | "trash"
  | "lawn"
  | "hot_tub"
  | "pool"
  | "parking"
  | "wifi"
  | "checkout"
  | "pets"
  | "other";

const INSTRUCTION_ICON: Record<PropertyInstructionCategory, LucideIcon> = {
  access: DoorOpen,
  trash: Trash2,
  lawn: Scissors,
  hot_tub: Flame,
  pool: Waves,
  parking: Car,
  wifi: Wifi,
  checkout: LogOut,
  pets: Dog,
  other: Info,
};

const INSTRUCTION_TINT: Record<PropertyInstructionCategory, string> = {
  access: "text-sky-500",
  trash: "text-amber-600",
  lawn: "text-emerald-500",
  hot_tub: "text-rose-500",
  pool: "text-cyan-500",
  parking: "text-indigo-500",
  wifi: "text-violet-500",
  checkout: "text-fuchsia-500",
  pets: "text-orange-500",
  other: "text-slate-500",
};

// Mirrors the mobile app: upgrade Airbnb-CDN image quality when the URL uses
// aki_policy hints. Safe no-op for non-Airbnb images.
function upgradeAirbnbImageQuality(url: string): string {
  return url.includes("aki_policy=")
    ? url.replace(/aki_policy=[^&]+/, "aki_policy=x_large")
    : url;
}

// Mirrors the mobile fallback: extract the Airbnb listing id from a Hosting-
// prefixed CDN URL when no explicit airbnbUrl is stored.
function deriveAirbnbUrl(property: PropertyRecord | null): string | null {
  if (!property) return null;
  if (property.airbnbUrl) return property.airbnbUrl;
  if (property.imageUrl) {
    const match = property.imageUrl.match(/Hosting-(\d+)/);
    if (match?.[1]) {
      return `https://www.airbnb.com/rooms/${match[1]}`;
    }
  }
  return null;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function CleanerPropertyDetailClient({ id }: { id: string }) {
  const t = useTranslations();
  const { isAuthenticated } = useConvexAuth();

  const property = useQuery(
    api.properties.queries.getById,
    isAuthenticated ? { id: id as Id<"properties"> } : "skip",
  ) as PropertyRecord | null | undefined;

  const loading = property === undefined;
  const airbnbUrl = deriveAirbnbUrl(property ?? null);
  const subAddress = property
    ? [property.city, property.state, property.zipCode].filter(Boolean).join(", ")
    : "";
  const typeLabel = property?.propertyType
    ? capitalize(property.propertyType)
    : t("cleaner.propertyDefaultType");

  // Hero image is rendered as a fixed element behind the cleaner shell's
  // translucent header (z-40), so it bleeds full-bleed under the nav with no
  // gap. Page content scrolls in main on top, hiding the image as it rises.
  // 360px hero ÷ 402px mobile frame ratio matches the mobile app.
  const HERO_HEIGHT = 360;
  // Pull the scrolling content card up by ~60px so it overlaps the bottom of
  // the hero with the 30px rounded top, matching mobile.
  const CARD_OVERLAP = 60;

  // iOS Safari has a known quirk where a `fixed` element nested inside
  // another `fixed` + overflow-scroll parent (our CleanerShell <main>) is
  // treated as `absolute` relative to that parent instead of the viewport.
  // That causes the hero to render below the nav instead of behind it.
  // Portal the hero into document.body so it's a direct viewport child.
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  const heroNode = (
    <div
      aria-hidden={!property}
      className="pointer-events-none fixed inset-x-0 top-0 z-[5] mx-auto w-full max-w-[402px] overflow-hidden bg-[color-mix(in_srgb,var(--cleaner-bg)_90%,black)]"
      style={{ height: HERO_HEIGHT }}
    >
      {property?.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- external CDN with signed params
        <img
          src={upgradeAirbnbImageQuality(property.imageUrl)}
          alt={property.name}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[var(--cleaner-muted)]">
          <Home className="h-10 w-10" />
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/30" />
      <Link
        href="/cleaner"
        className="pointer-events-auto absolute left-4 inline-flex items-center gap-1 rounded-full bg-black/45 px-3 py-1.5 text-[13px] font-semibold text-white backdrop-blur-md transition-colors hover:bg-black/60"
        style={{ top: "calc(env(safe-area-inset-top) + 80px)" }}
      >
        <ChevronLeft className="h-4 w-4" />
        {t("cleaner.propertyBackLabel")}
      </Link>
    </div>
  );

  return (
    <div className="relative">
      {portalTarget ? createPortal(heroNode, portalTarget) : null}

      {/* Spacer reserves the area visually occupied by the hero, accounting
          for the cleaner shell's 72px header offset already applied to main. */}
      <div
        aria-hidden
        className="-mx-3"
        style={{ height: HERO_HEIGHT - 72 }}
      />

      <div
        className="relative z-10 -mx-3 rounded-t-[30px] bg-[var(--cleaner-bg)] px-5 pb-10 pt-6 shadow-[0_-8px_24px_-16px_rgba(0,0,0,0.2)] sm:px-6"
        style={{ marginTop: -CARD_OVERLAP }}
      >
        {loading ? (
          <div className="flex items-center justify-center py-16 text-[var(--cleaner-muted)]">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="ml-3 text-[14px]">{t("cleaner.propertyLoading")}</span>
          </div>
        ) : !property ? (
          <div className="flex flex-col items-center justify-center py-16 text-[var(--cleaner-muted)]">
            <AlertCircle className="h-12 w-12" />
            <p className="mt-4 text-[15px]">{t("cleaner.propertyNotFound")}</p>
          </div>
        ) : (
          <>
            <header className="mt-2">
              <h1 className="cleaner-display text-[26px] font-bold leading-[1.2] text-[var(--cleaner-ink)]">
                {property.name}
              </h1>
              <div className="mt-3 flex items-start gap-3">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cleaner-muted)]" />
                <div className="min-w-0">
                  {property.address ? (
                    <p className="text-[15px] text-[var(--cleaner-ink)]">
                      {property.address}
                    </p>
                  ) : (
                    <p className="text-[15px] text-[var(--cleaner-muted)]">
                      {t("cleaner.noAddress")}
                    </p>
                  )}
                  {subAddress ? (
                    <p className="text-[13px] text-[var(--cleaner-muted)]">
                      {subAddress}
                    </p>
                  ) : null}
                </div>
              </div>
            </header>

            <section
              className={cn(
                "mt-6 grid gap-2 border-y border-[color-mix(in_srgb,var(--cleaner-primary)_20%,transparent)] px-2 py-5",
                typeof property.squareFeet === "number" && property.squareFeet > 0
                  ? "grid-cols-4"
                  : "grid-cols-3",
              )}
            >
              <StatCell
                icon={<Home className="h-6 w-6" strokeWidth={2} />}
                iconClass="text-sky-500"
                value={typeLabel}
                label={t("cleaner.propertyType")}
              />
              <StatCell
                icon={<Grid3x3 className="h-6 w-6" strokeWidth={2} />}
                iconClass="text-amber-500"
                value={
                  typeof property.bedrooms === "number"
                    ? String(Math.max(property.bedrooms, 0))
                    : "–"
                }
                label={t("cleaner.propertyBedrooms")}
              />
              <StatCell
                icon={<Droplet className="h-6 w-6" strokeWidth={2} />}
                iconClass="text-emerald-500"
                value={
                  typeof property.bathrooms === "number"
                    ? formatBathroomCount(property.bathrooms)
                    : "–"
                }
                label={t("cleaner.propertyBathrooms")}
              />
              {typeof property.squareFeet === "number" && property.squareFeet > 0 ? (
                <StatCell
                  icon={<Maximize className="h-6 w-6" strokeWidth={2} />}
                  iconClass="text-fuchsia-500"
                  value={String(property.squareFeet)}
                  label={t("cleaner.propertySquareFeet")}
                />
              ) : null}
            </section>

            {airbnbUrl ? (
              <a
                href={airbnbUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ backgroundColor: "#FF385C" }}
                className="mt-8 flex w-full items-center justify-center gap-2.5 rounded-[12px] px-4 py-4 text-[15px] font-semibold text-white transition-opacity hover:opacity-90"
              >
                <ExternalLink className="h-5 w-5" strokeWidth={2.25} />
                {t("cleaner.viewOnAirbnb")}
              </a>
            ) : null}

            <div className="mt-8">
              <CleanerAccessSection
                accessNotes={property.accessNotes ?? null}
                keyLocation={property.keyLocation ?? null}
                parkingNotes={property.parkingNotes ?? null}
                urgentNotes={property.urgentNotes ?? null}
              />
            </div>

            <RoomsBlock rooms={property.rooms ?? []} />

            <InstructionsBlock instructions={property.instructions ?? []} />
          </>
        )}
      </div>
    </div>
  );
}

function RoomsBlock({
  rooms,
}: {
  rooms: Array<{ name: string; type: string }>;
}) {
  const t = useTranslations();
  const count = rooms.length;
  const countLabel =
    count === 1
      ? t("cleaner.roomsSection.countOne", { count })
      : t("cleaner.roomsSection.countOther", { count });

  return (
    <div className="mt-4">
      <CleanerSection
        eyebrow={t("cleaner.roomsSection.eyebrow")}
        title={t("cleaner.roomsSection.title")}
      >
        {count === 0 ? (
          <p className="text-[13px] text-[var(--cleaner-muted)]">
            {t("cleaner.roomsSection.empty")}
          </p>
        ) : (
          <>
            <p className="mb-3 text-[12px] font-medium uppercase tracking-wide text-[var(--cleaner-muted)]">
              {countLabel}
            </p>
            <ul className="flex flex-wrap gap-2">
              {rooms.map((room, index) => (
                <li
                  key={`${room.name}-${index}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--cleaner-primary)_18%,transparent)] bg-[var(--cleaner-bg)] px-3 py-1.5 text-[13px] font-medium text-[var(--cleaner-ink)]"
                >
                  {room.name}
                </li>
              ))}
            </ul>
          </>
        )}
      </CleanerSection>
    </div>
  );
}

function InstructionsBlock({
  instructions,
}: {
  instructions: Array<{
    id: string;
    category: PropertyInstructionCategory;
    title: string;
    body: string;
    sourceLang?: "en" | "es" | null;
    translations?: Partial<
      Record<"en" | "es", { title: string; body: string }>
    > | null;
    updatedAt: number;
  }>;
}) {
  const t = useTranslations();
  const rawLocale = useLocale();
  const locale: "en" | "es" = rawLocale === "es" ? "es" : "en";
  if (instructions.length === 0) return null;
  // Access-tagged instructions float to the top; others follow in insertion order
  const sorted = [...instructions].sort((a, b) => {
    if (a.category === "access" && b.category !== "access") return -1;
    if (b.category === "access" && a.category !== "access") return 1;
    return a.updatedAt - b.updatedAt;
  });
  return (
    <div className="mt-4">
      <CleanerSection
        eyebrow={t("cleaner.instructions.eyebrow")}
        title={t("cleaner.instructions.title")}
      >
        <ul className="space-y-3">
          {sorted.map((instruction) => {
            const Icon = INSTRUCTION_ICON[instruction.category] ?? Info;
            const tint = INSTRUCTION_TINT[instruction.category] ?? "text-slate-500";
            const localized = localizedInstruction(instruction, locale);
            return (
              <li key={instruction.id} className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[color-mix(in_srgb,var(--cleaner-primary)_18%,transparent)] bg-[var(--cleaner-bg)] ${tint}`}
                >
                  <Icon className="h-4 w-4" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[14px] font-semibold text-[var(--cleaner-ink)]">
                    {localized.title}
                  </h3>
                  <p className="mt-0.5 whitespace-pre-line text-[13px] leading-[1.4] text-[var(--cleaner-muted)]">
                    {localized.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </CleanerSection>
    </div>
  );
}

function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function StatCell({
  icon,
  iconClass,
  value,
  label,
}: {
  icon: React.ReactNode;
  iconClass: string;
  value: string;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <span className={iconClass}>{icon}</span>
      <span className="text-[16px] font-bold text-[var(--cleaner-ink)]">
        {value}
      </span>
      <span className="text-[12px] text-[var(--cleaner-muted)]">{label}</span>
    </div>
  );
}

function formatBathroomCount(raw: number): string {
  const safe = Math.max(raw, 0);
  const rounded = Math.round(safe * 2) / 2;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
