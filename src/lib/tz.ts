/**
 * Timezone-aware date/time formatting for the admin web app.
 *
 * Mirrors the mobile app's `lib/datetime.ts` design so both apps behave
 * identically (see jna-cleaners-app/docs/superpowers/specs/
 * 2026-07-10-app-timezone-setting-design.md):
 *
 *   displayZone = property.timezone ?? appDefaultTimezone
 *
 * Property-local time always wins when a property zone is known; the app
 * default (per-device, from Settings, default America/Chicago = Dallas) is the
 * fallback everywhere the code previously fell back to the *browser* zone.
 * Net effect: the viewer's browser timezone is never used for display again.
 *
 * The app default lives in a module-level singleton so pure formatters can
 * resolve it without prop-drilling a hook into every call site. The
 * TimezoneProvider keeps the singleton in sync with localStorage/React state.
 */

export const DEFAULT_TIMEZONE = "America/Chicago";

export type CuratedTimezone = { id: string; label: string };

// Curated US list — identical to the mobile picker.
export const CURATED_TIMEZONES: CuratedTimezone[] = [
  { id: "America/Chicago", label: "Dallas · Central" },
  { id: "America/New_York", label: "Eastern" },
  { id: "America/Denver", label: "Mountain" },
  { id: "America/Phoenix", label: "Arizona" },
  { id: "America/Los_Angeles", label: "Pacific" },
];

// ─────────────────────────────────────────────────────────────────────────────
// App-default singleton (kept in sync by TimezoneProvider)
// ─────────────────────────────────────────────────────────────────────────────

let currentDefaultTimezone = DEFAULT_TIMEZONE;

export function getDefaultTimezone(): string {
  return currentDefaultTimezone;
}

export function setDefaultTimezone(tz: string): void {
  if (tz && isValidTimeZone(tz)) currentDefaultTimezone = tz;
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the zone to display a record in: the property's own zone when known,
 * otherwise the app default. Accepts an IANA name ("America/Chicago") or a
 * `±HHMM` offset (normalized to `±HH:MM`), matching the mobile helper.
 */
export function resolveDisplayTimezone(propertyTz?: string | null): string {
  const normalized = normalizeZone(propertyTz);
  return normalized ?? currentDefaultTimezone;
}

function normalizeZone(tz?: string | null): string | null {
  if (!tz) return null;
  const trimmed = tz.trim();
  if (!trimmed) return null;
  // `±HHMM` / `±HH:MM` offset → keep as-is if already colon-form, else insert.
  const offsetMatch = /^([+-])(\d{2}):?(\d{2})$/.exec(trimmed);
  if (offsetMatch) {
    const zone = `${offsetMatch[1]}${offsetMatch[2]}:${offsetMatch[3]}`;
    // Intl doesn't accept bare offsets; represent as a fixed-offset via Etc?
    // Intl supports offset zones like "+06:00" only through the `timeZone`
    // option in modern engines. Validate before trusting it.
    return isValidTimeZone(zone) ? zone : null;
  }
  return isValidTimeZone(trimmed) ? trimmed : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────────────

type DateInput = Date | string | number;

function toDate(value: DateInput): Date {
  if (value instanceof Date) return value;
  return new Date(value);
}

const LOCALE = "en-US";

/** Time only, e.g. "5:00 PM". */
export function formatTimeInZone(
  value: DateInput,
  zone: string,
  opts?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    ...opts,
  }).format(toDate(value));
}

/** Date only, e.g. "Jul 10, 2026". */
export function formatDateInZone(
  value: DateInput,
  zone: string,
  opts?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: zone,
    year: "numeric",
    month: "short",
    day: "numeric",
    ...opts,
  }).format(toDate(value));
}

/** Date + time, e.g. "Jul 10, 2026, 5:00 PM". */
export function formatDateTimeInZone(
  value: DateInput,
  zone: string,
  opts?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: zone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    ...opts,
  }).format(toDate(value));
}

/** Schedule day header, e.g. "Fri" / "10". Pass explicit opts for parts. */
export function formatDayLabelInZone(value: DateInput, zone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: zone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(toDate(value));
}

// Convenience wrappers that use the app default zone directly — for call sites
// with no property context.
export const formatTime = (v: DateInput, opts?: Intl.DateTimeFormatOptions) =>
  formatTimeInZone(v, currentDefaultTimezone, opts);
export const formatDate = (v: DateInput, opts?: Intl.DateTimeFormatOptions) =>
  formatDateInZone(v, currentDefaultTimezone, opts);
export const formatDateTime = (v: DateInput, opts?: Intl.DateTimeFormatOptions) =>
  formatDateTimeInZone(v, currentDefaultTimezone, opts);

/** Short abbreviated zone name for a given instant, e.g. "CDT". */
export function timezoneAbbrev(zone: string, at: DateInput = new Date()): string {
  const parts = new Intl.DateTimeFormat(LOCALE, {
    timeZone: zone,
    timeZoneName: "short",
  }).formatToParts(toDate(at));
  return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
}

/** Human label for a zone id, using the curated list when available. */
export function timezoneLabel(zone: string): string {
  return CURATED_TIMEZONES.find((z) => z.id === zone)?.label ?? zone;
}
