import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { normalizeGuestReview } from "../guestReviews/normalize";

const DEFAULT_HOSPITABLE_BASE_URL = "https://public.api.hospitable.com/v2";
const DEFAULT_SYNC_WINDOW_DAYS = 30;

type GenericRecord = Record<string, unknown>;
type AppRole = "cleaner" | "manager" | "property_ops" | "admin";

interface NormalizedTeammateForImport {
  sourceId?: string;
  fullName: string;
  email: string;
  phone?: string;
  companyName?: string;
  roles: string[];
  appRole: AppRole;
}

interface NormalizedReservation {
  reservationId: string;
  propertyHospitableId: string;
  guestName: string;
  guestEmail?: string;
  guestPhone?: string;
  numberOfGuests?: number;
  checkInAt: number;
  checkOutAt: number;
  lateCheckout: boolean;
  partyRiskFlag: boolean;
  platform?: string;
  confirmationCode?: string;
  specialRequests?: string;
  status?: string;
  /** Total guest-paid amount for the stay, in `currency`. Source of truth
   *  for the owner-portal grossRevenue calculation. May be undefined for
   *  reservations created before the financial-extraction wiring landed —
   *  re-sync to backfill. */
  totalAmount?: number;
  currency?: string;
  /** Set when the reservation status indicates cancellation; the upsert
   *  mutation writes this to `stays.cancelledAt` so the fee engine
   *  excludes it from grossRevenue. */
  cancelledAt?: number;
  cancellationSource?: string;
  metadata?: GenericRecord;
}

interface SyncReservationsResult {
  success: boolean;
  syncStatus: string;
  summary: {
    reservationsReceived: number;
    staysCreated: number;
    staysUpdated: number;
    jobsCreated: number;
    jobsUpdated: number;
    jobsCancelled: number;
    skippedMissingProperty: number;
    sourceErrors: number;
  };
  errors: string[];
}

function isRecord(value: unknown): value is GenericRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Hospitable's reservation payload exposes the booking channel under
 * several different field names across API versions / channels:
 *   - `platform` (legacy / some webhook payloads)
 *   - `channel` (V2 — sometimes a string, sometimes a nested object)
 *   - `channel.name` / `channel.id`
 *   - `source` / `source.name`
 *
 * Trying each in order means we capture the platform even when
 * Hospitable changes which field they populate — first non-empty wins.
 */
function extractPlatform(reservation: GenericRecord): string | undefined {
  // Direct string fields, in priority order.
  const direct =
    asString(reservation.platform) ??
    asString(reservation.source) ??
    asString(reservation.channel);
  if (direct) return direct;

  // Nested object shapes: { channel: { name, id }, source: { name } }
  const channel = reservation.channel;
  if (isRecord(channel)) {
    const fromChannel =
      asString(channel.name) ?? asString(channel.id) ?? asString(channel.slug);
    if (fromChannel) return fromChannel;
  }
  const source = reservation.source;
  if (isRecord(source)) {
    const fromSource =
      asString(source.name) ?? asString(source.id) ?? asString(source.slug);
    if (fromSource) return fromSource;
  }
  return undefined;
}

function dateToEpochMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }

  if (typeof value === "string" && value.length > 0) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

/**
 * Follow Hospitable's pagination. The API uses a Laravel-style envelope:
 *   { data: [...], meta: { current_page, last_page, per_page, total },
 *     links: { next, prev, first, last } }
 *
 * We send `per_page=100` to minimise round-trips, then keep paging until
 * we hit `meta.last_page` (or `links.next === null`, as a fallback).
 * Bounded by `maxPages` (50 × 100 = 5000 reservations) so a misconfigured
 * loop can never run away.
 *
 * Returns the concatenated `data[]` arrays. Caller still passes the
 * result through `getArrayFromApiPayload` semantics if needed (we do
 * here).
 */
async function fetchAllHospitablePages(
  apiKey: string,
  url: string,
  ctx?: UsageLogCtx,
  feature: string = "hospitable_sync",
  maxPages: number = 50,
): Promise<unknown[]> {
  const accumulated: unknown[] = [];
  const u = new URL(url);
  if (!u.searchParams.has("per_page")) u.searchParams.set("per_page", "100");

  let page = 1;
  while (page <= maxPages) {
    u.searchParams.set("page", String(page));
    const payload = await fetchHospitableJson(apiKey, u.toString(), ctx, feature);
    const rows = getArrayFromApiPayload(payload);
    accumulated.push(...rows);

    // Decide whether to keep going.
    if (rows.length === 0) break;
    if (isRecord(payload)) {
      const meta = isRecord(payload.meta) ? payload.meta : null;
      const links = isRecord(payload.links) ? payload.links : null;
      const lastPage = meta && typeof meta.last_page === "number" ? meta.last_page : null;
      const nextLink = links && typeof links.next === "string" ? links.next : null;
      if (lastPage !== null) {
        if (page >= lastPage) break;
      } else if (nextLink === null) {
        // No meta and no next link → assume single page or done.
        break;
      }
    } else {
      // Non-envelope response → can't paginate further.
      break;
    }
    page += 1;
  }
  return accumulated;
}

function getArrayFromApiPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return [];
  }

  const data = payload.data;
  if (Array.isArray(data)) {
    return data;
  }

  const results = payload.results;
  if (Array.isArray(results)) {
    return results;
  }

  const teammates = payload.teammates;
  if (Array.isArray(teammates)) {
    return teammates;
  }

  const users = payload.users;
  if (Array.isArray(users)) {
    return users;
  }

  return [];
}

function mapToAppRole(roles: string[]): AppRole {
  const normalized = roles.map((role) => role.toLowerCase());

  if (
    normalized.some(
      (role) =>
        role.includes("property_ops") ||
        role.includes("property ops") ||
        role.includes("operations") ||
        role.includes("ops")
    )
  ) {
    return "property_ops";
  }

  if (
    normalized.some(
      (role) =>
        role.includes("manager") ||
        role.includes("owner") ||
        role.includes("admin")
    )
  ) {
    return "manager";
  }

  return "cleaner";
}

function extractRoles(payload: GenericRecord): string[] {
  const roles = new Set<string>();

  const pushRole = (value: unknown) => {
    const role = asString(value);
    if (role) {
      roles.add(role.toLowerCase());
    }
  };

  pushRole(payload.role);

  for (const roleEntry of Array.isArray(payload.roles) ? payload.roles : []) {
    if (typeof roleEntry === "string") {
      pushRole(roleEntry);
      continue;
    }
    if (!isRecord(roleEntry)) {
      continue;
    }
    pushRole(roleEntry.name);
    pushRole(roleEntry.slug);
    pushRole(roleEntry.key);
    pushRole(roleEntry.type);
    pushRole(roleEntry.title);
  }

  return Array.from(roles);
}

function resolveFullName(payload: GenericRecord, fallbackEmail: string): string {
  const explicitName =
    asString(payload.full_name) ??
    asString(payload.name) ??
    asString(payload.display_name);
  if (explicitName) {
    return explicitName;
  }

  const firstName = asString(payload.first_name) ?? asString(payload.firstName);
  const lastName = asString(payload.last_name) ?? asString(payload.lastName);
  const combined = [firstName, lastName].filter(Boolean).join(" ").trim();
  if (combined.length > 0) {
    return combined;
  }

  return fallbackEmail.split("@")[0] || "Team Member";
}

function normalizeTeammateForImport(
  rawValue: unknown
): NormalizedTeammateForImport | null {
  if (!isRecord(rawValue)) {
    return null;
  }

  const contact = isRecord(rawValue.contact) ? rawValue.contact : undefined;
  const user = isRecord(rawValue.user) ? rawValue.user : undefined;
  const company = isRecord(rawValue.company) ? rawValue.company : undefined;

  const email =
    asString(rawValue.email) ?? asString(contact?.email) ?? asString(user?.email);
  if (!email) {
    return null;
  }

  const normalizedEmail = email.toLowerCase();
  const roles = extractRoles(rawValue);

  return {
    sourceId: asString(rawValue.id),
    fullName: resolveFullName(rawValue, normalizedEmail),
    email: normalizedEmail,
    phone:
      asString(rawValue.phone) ??
      asString(contact?.phone) ??
      asString(user?.phone),
    companyName:
      asString(rawValue.company_name) ??
      asString(company?.name) ??
      (typeof rawValue.company === "string" ? asString(rawValue.company) : undefined),
    roles,
    appRole: mapToAppRole(roles),
  };
}

function mergeTeammatesByEmail(
  teammates: NormalizedTeammateForImport[]
): NormalizedTeammateForImport[] {
  const merged = new Map<string, NormalizedTeammateForImport>();

  for (const teammate of teammates) {
    const existing = merged.get(teammate.email);
    if (!existing) {
      merged.set(teammate.email, teammate);
      continue;
    }

    const roleSet = new Set([...existing.roles, ...teammate.roles]);
    const roles = Array.from(roleSet);
    merged.set(teammate.email, {
      ...existing,
      sourceId: existing.sourceId ?? teammate.sourceId,
      fullName:
        existing.fullName.length >= teammate.fullName.length
          ? existing.fullName
          : teammate.fullName,
      phone: existing.phone ?? teammate.phone,
      companyName: existing.companyName ?? teammate.companyName,
      roles,
      appRole: mapToAppRole(roles),
    });
  }

  return Array.from(merged.values());
}

function buildGuestName(reservation: GenericRecord): string {
  const guest = isRecord(reservation.guest) ? reservation.guest : undefined;
  const firstName = asString(guest?.first_name);
  const lastName = asString(guest?.last_name);
  const full = [firstName, lastName].filter(Boolean).join(" ").trim();
  return full.length > 0 ? full : "Guest";
}

function assessPartyRisk(
  numberOfGuests: number | undefined,
  specialRequests: string | undefined
): boolean {
  if (typeof numberOfGuests === "number" && numberOfGuests >= 8) {
    return true;
  }

  if (specialRequests && /party|event|celebration/i.test(specialRequests)) {
    return true;
  }

  return false;
}

export function normalizeReservation(
  rawReservation: unknown,
  fallbackPropertyId: string
): { reservation?: NormalizedReservation; error?: string } {
  if (!isRecord(rawReservation)) {
    return { error: "Reservation payload is not an object." };
  }

  const reservationId = asString(rawReservation.id);
  if (!reservationId) {
    return { error: "Reservation is missing an id." };
  }

  const checkInAt =
    dateToEpochMs(rawReservation.check_in) ??
    dateToEpochMs(rawReservation.arrival_date) ??
    dateToEpochMs(rawReservation.check_in_at);
  const checkOutAt =
    dateToEpochMs(rawReservation.check_out) ??
    dateToEpochMs(rawReservation.departure_date) ??
    dateToEpochMs(rawReservation.check_out_at);

  if (!checkInAt || !checkOutAt) {
    return {
      error: `Reservation ${reservationId} is missing check-in/check-out dates.`,
    };
  }

  const guestsPayload = isRecord(rawReservation.guests) ? rawReservation.guests : undefined;
  const numberOfGuests =
    asNumber(guestsPayload?.total) ?? asNumber(rawReservation.number_of_guests);

  const specialRequests =
    asString(rawReservation.special_requests) ?? asString(rawReservation.notes);
  const propertyHospitableId =
    asString(rawReservation.property_id) ??
    asString(rawReservation.propertyId) ??
    fallbackPropertyId;

  const lateCheckout = new Date(checkOutAt).getHours() > 11;

  // ─── Financial extraction ───────────────────────────────────────────────
  // Hospitable v2 returns financials ONLY when ?include=financials is set.
  // The canonical "what the host actually earned" number is exposed as a
  // single computed field — `data.financials.host.revenue.amount` (cents).
  // That value already nets:
  //     + accommodation (nightly × N)
  //     − discounts (non-refundable, length-of-stay, etc.)
  //     + guest_fees (cleaning, host's own mgmt fee, …)
  //     − host_fees  (Airbnb / channel service fee taken from the host)
  // Matches what Hospitable's own reporting screen shows as "Net Revenue".
  //
  // Earlier we summed `accommodation + guest_fees` manually, which ignored
  // discounts AND the channel commission — inflating totalAmount by ~28%
  // on Airbnb stays (verified against the reporting screen for Houston-
  // The Lisboa, Mar 2026: ours $7,973.91 vs Hospitable $5,744.00).
  //
  // If `host.revenue` isn't in the payload (older API version / no
  // financials include), fall back to the manual sum.
  const financials = isRecord(rawReservation.financials)
    ? (rawReservation.financials as GenericRecord)
    : undefined;
  const host = financials && isRecord(financials.host)
    ? (financials.host as GenericRecord)
    : undefined;

  function sumAmountCents(list: unknown): number | undefined {
    if (!Array.isArray(list)) return undefined;
    let sum = 0;
    let any = false;
    for (const item of list) {
      if (!isRecord(item)) continue;
      const amt = asNumber(item.amount);
      if (amt !== undefined) {
        sum += amt;
        any = true;
      }
    }
    return any ? sum : undefined;
  }

  const hostRevenueCents =
    host && isRecord(host.revenue) ? asNumber(host.revenue.amount) : undefined;
  const accommodationCents = sumAmountCents(host?.accommodation_breakdown);
  const hostFeesCents = sumAmountCents(host?.guest_fees);
  const totalCents =
    hostRevenueCents !== undefined
      ? hostRevenueCents
      : accommodationCents !== undefined || hostFeesCents !== undefined
        ? (accommodationCents ?? 0) + (hostFeesCents ?? 0)
        : undefined;
  // Convert cents → dollars
  const totalAmount =
    totalCents !== undefined
      ? totalCents / 100
      : // Fallback paths for non-financials payload shapes (other API
        // versions / channels). First non-undefined wins.
        asNumber(rawReservation.total_amount) ??
        asNumber(rawReservation.total_price) ??
        asNumber(rawReservation.payout) ??
        undefined;
  // Currency — try the first nested location, else top-level.
  const firstAccommodation = Array.isArray(host?.accommodation_breakdown)
    ? (host?.accommodation_breakdown as unknown[])[0]
    : undefined;
  const firstFee = Array.isArray(host?.guest_fees)
    ? (host?.guest_fees as unknown[])[0]
    : undefined;
  const currency =
    (isRecord(firstAccommodation)
      ? asString(firstAccommodation.currency)
      : undefined) ??
    (isRecord(firstFee) ? asString(firstFee.currency) : undefined) ??
    asString(rawReservation.currency) ??
    undefined;

  // Cancellation: Hospitable reports status="cancelled" for cancelled stays.
  // Capture cancelledAt as the cancellation-date when present, else "now"
  // (best-effort timestamp; the field's primary purpose is "is this stay
  // currently cancelled" — exact time matters less).
  const status = asString(rawReservation.status);
  const isCancelled =
    status?.toLowerCase().includes("cancel") ?? false;
  const cancelledAt = isCancelled
    ? dateToEpochMs(rawReservation.cancelled_at) ??
      dateToEpochMs(rawReservation.cancellation_date) ??
      Date.now()
    : undefined;
  const cancellationSource = isCancelled ? "hospitable" : undefined;

  return {
    reservation: {
      reservationId,
      propertyHospitableId,
      guestName: buildGuestName(rawReservation),
      guestEmail: asString(rawReservation.guest_email),
      guestPhone: asString(rawReservation.guest_phone),
      numberOfGuests,
      checkInAt,
      checkOutAt,
      lateCheckout,
      partyRiskFlag: assessPartyRisk(numberOfGuests, specialRequests),
      platform: extractPlatform(rawReservation),
      confirmationCode: asString(rawReservation.code),
      specialRequests,
      status,
      totalAmount,
      currency,
      cancelledAt,
      cancellationSource,
      metadata: {
        nights: asNumber(rawReservation.nights),
        source: "hospitable",
      },
    },
  };
}

type HospitableStatus =
  | "success"
  | "rate_limited"
  | "quota_exceeded"
  | "auth_error"
  | "client_error"
  | "server_error"
  | "timeout"
  | "unknown_error";

function classifyHttpStatus(status: number): HospitableStatus {
  if (status === 401 || status === 403) return "auth_error";
  if (status === 429) return "rate_limited";
  if (status === 402) return "quota_exceeded";
  if (status >= 400 && status < 500) return "client_error";
  if (status >= 500) return "server_error";
  return "unknown_error";
}

/**
 * Minimal Convex-context subset we need for usage logging. Typed structurally
 * so unit tests (and the few paths that don't carry a real ActionCtx) can
 * pass `undefined` and skip logging entirely.
 */
type UsageLogCtx = Pick<ActionCtx, "runMutation">;

/**
 * Fetch a Hospitable v2 JSON endpoint. When `ctx` is provided, one
 * `serviceUsageEvents` row is written per request (success or error). Logging
 * is fire-and-forget — a logger failure never affects the sync result.
 */
async function fetchHospitableJson(
  apiKey: string,
  url: string,
  ctx?: UsageLogCtx,
  feature: string = "hospitable_sync",
): Promise<unknown> {
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error ?? "unknown");
    if (ctx) {
      try {
        await ctx.runMutation(internal.serviceUsage.logger.log, {
          serviceKey: "hospitable",
          feature,
          status: "timeout",
          durationMs: Date.now() - startedAt,
          errorMessage: errorMessage.slice(0, 500),
          metadata: { url: stripUrlSecrets(url) },
        });
      } catch {
        // best-effort
      }
    }
    throw error;
  }

  const durationMs = Date.now() - startedAt;

  if (!response.ok) {
    const errorBody = await response.text();
    if (ctx) {
      try {
        await ctx.runMutation(internal.serviceUsage.logger.log, {
          serviceKey: "hospitable",
          feature,
          status: classifyHttpStatus(response.status),
          durationMs,
          errorCode: String(response.status),
          errorMessage: errorBody.slice(0, 500),
          metadata: { url: stripUrlSecrets(url) },
        });
      } catch {
        // best-effort
      }
    }
    throw new Error(`Hospitable request failed (${response.status}): ${errorBody}`);
  }

  const json = await response.json();

  if (ctx) {
    try {
      const byteLength = JSON.stringify(json).length;
      await ctx.runMutation(internal.serviceUsage.logger.log, {
        serviceKey: "hospitable",
        feature,
        status: "success",
        durationMs,
        responseBytes: byteLength,
        metadata: { url: stripUrlSecrets(url) },
      });
    } catch {
      // best-effort
    }
  }

  return json;
}

/** Remove query-string api keys from metadata before persisting. */
function stripUrlSecrets(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    return u.toString();
  } catch {
    return url;
  }
}

export const syncReservations = internalAction({
  args: {
    daysForward: v.optional(v.number()),
    daysBack: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SyncReservationsResult> => {
    const syncedAt = Date.now();

    try {
      const apiKey = process.env.HOSPITABLE_API_KEY ?? process.env.HOSPITABLE_API_TOKEN;
      if (!apiKey) {
        throw new Error("Missing HOSPITABLE_API_KEY/HOSPITABLE_API_TOKEN environment variable.");
      }

      const baseUrl = process.env.HOSPITABLE_API_URL ?? DEFAULT_HOSPITABLE_BASE_URL;
      const configuredWindow = Number(process.env.HOSPITABLE_SYNC_WINDOW_DAYS ?? DEFAULT_SYNC_WINDOW_DAYS);
      const syncWindowDays = Number.isFinite(configuredWindow) ? configuredWindow : DEFAULT_SYNC_WINDOW_DAYS;

      const daysForward = args.daysForward ?? syncWindowDays;
      const daysBack = args.daysBack ?? 0;

      const windowStart = new Date();
      windowStart.setDate(windowStart.getDate() - daysBack);

      const windowEnd = new Date();
      windowEnd.setDate(windowEnd.getDate() + daysForward);

      const checkOutFrom = windowStart.toISOString().split("T")[0];
      const checkOutTo = windowEnd.toISOString().split("T")[0];

      // Page through ALL properties — previously we only got page 1
      // (~3 properties) and silently skipped the rest of the portfolio
      // for reservation sync.
      const properties = await fetchAllHospitablePages(
        apiKey,
        `${baseUrl}/properties`,
        ctx,
        "hospitable_reservations_sync",
      );

      const reservations: NormalizedReservation[] = [];
      const sourceErrors: string[] = [];

      for (const property of properties) {
        if (!isRecord(property)) {
          continue;
        }

        const propertyId = asString(property.id);
        if (!propertyId) {
          continue;
        }

        const params = new URLSearchParams();
        params.set("check_out_from", checkOutFrom);
        params.set("check_out_to", checkOutTo);
        params.append("properties[]", propertyId);

        // Page through ALL reservations matching the window — Hospitable
        // paginates at ~10/page by default, which is why a 3-year backfill
        // was previously returning only the first page's worth.
        const propertyReservations = await fetchAllHospitablePages(
          apiKey,
          `${baseUrl}/reservations?${params.toString()}`,
          ctx,
          "hospitable_reservations_sync",
        );

        for (const rawReservation of propertyReservations) {
          const { reservation, error } = normalizeReservation(rawReservation, propertyId);

          if (!reservation) {
            if (error) {
              sourceErrors.push(error);
            }
            continue;
          }

          reservations.push(reservation);
        }
      }

      return await ctx.runMutation(internal.hospitable.mutations.upsertReservations, {
        reservations,
        syncedAt,
        syncWindowDays: daysForward,
        sourceErrors,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await ctx.runMutation(internal.hospitable.mutations.markSyncFailed, {
        error: message,
        syncedAt,
      });

      throw error;
    }
  },
});

export const listTeammatesForImport = action({
  args: {},
  handler: async (ctx): Promise<{
    endpointUsed: string;
    sourceCount: number;
    skippedMissingEmail: number;
    teammates: NormalizedTeammateForImport[];
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated.");
    }

    const currentUser: Doc<"users"> | null = await ctx.runQuery(
      api.users.queries.getByClerkId,
      { clerkId: identity.subject }
    );
    if (!currentUser || currentUser.role !== "admin") {
      throw new Error("Only admins can import teammates from Hospitable.");
    }

    const apiKey = process.env.HOSPITABLE_API_KEY ?? process.env.HOSPITABLE_API_TOKEN;
    if (!apiKey) {
      throw new Error(
        "Missing HOSPITABLE_API_KEY/HOSPITABLE_API_TOKEN environment variable."
      );
    }

    const baseUrl = (process.env.HOSPITABLE_API_URL ?? DEFAULT_HOSPITABLE_BASE_URL).replace(
      /\/$/,
      ""
    );
    const configuredCandidates = process.env.HOSPITABLE_TEAMMATES_ENDPOINTS
      ?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const candidates =
      configuredCandidates && configuredCandidates.length > 0
        ? configuredCandidates
        : ["/teammates", "/users?include=roles", "/users"];

    const errors: string[] = [];
    for (const candidate of candidates) {
      const endpoint = candidate.startsWith("http")
        ? candidate
        : `${baseUrl}${candidate.startsWith("/") ? candidate : `/${candidate}`}`;
      try {
        const payload = await fetchHospitableJson(
          apiKey,
          endpoint,
          ctx,
          "hospitable_teammates_import",
        );
        const rawRows = getArrayFromApiPayload(payload);
        const normalizedRows = rawRows
          .map(normalizeTeammateForImport)
          .filter((row): row is NormalizedTeammateForImport => row !== null);
        const skippedMissingEmail = Math.max(0, rawRows.length - normalizedRows.length);

        return {
          endpointUsed: endpoint,
          sourceCount: rawRows.length,
          skippedMissingEmail,
          teammates: mergeTeammatesByEmail(normalizedRows),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${endpoint} -> ${message}`);
      }
    }

    throw new Error(
      `Unable to fetch Hospitable teammates. Tried: ${errors.join(" | ") || "no endpoints"}`,
    );
  },
});

interface NormalizedRoom {
  name: string;
  type: string;
}

interface NormalizedPropertyDetails {
  hospitableId: string;
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  timezone?: string;
  currency?: string;
  imageUrl?: string;
  bedrooms?: number;
  bathrooms?: number;
  rooms: NormalizedRoom[];
}

const ROOM_TYPE_LABELS: Record<string, string> = {
  bedroom: "Bedroom",
  full_bathroom: "Bathroom",
  half_bathroom: "Half Bath",
  living_room: "Living Room",
  kitchen: "Kitchen",
  dining_room: "Dining Room",
  laundry_room: "Laundry Room",
  patio: "Patio",
  backyard: "Backyard",
  office: "Office",
  garage: "Garage",
  workspace: "Workspace",
  balcony: "Balcony",
};

// Types we skip (not cleanable rooms)
const SKIPPED_ROOM_TYPES = new Set(["exterior"]);

function extractRoomsFromProperty(property: GenericRecord): NormalizedRoom[] {
  const rooms: NormalizedRoom[] = [];

  // Hospitable API v2 returns room_details: [{type, beds}]
  const roomDetails = property.room_details;
  if (Array.isArray(roomDetails) && roomDetails.length > 0) {
    // Count occurrences of each type to number them
    const typeCounts: Record<string, number> = {};
    const typeInstances: Array<{ type: string; index: number }> = [];

    for (const entry of roomDetails) {
      if (!isRecord(entry)) continue;
      const type = asString(entry.type);
      if (!type || SKIPPED_ROOM_TYPES.has(type)) continue;
      typeCounts[type] = (typeCounts[type] ?? 0) + 1;
      typeInstances.push({ type, index: typeCounts[type] });
    }

    for (const { type, index } of typeInstances) {
      const total = typeCounts[type] ?? 1;
      const baseLabel = ROOM_TYPE_LABELS[type] ?? type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const name = total === 1 ? baseLabel : `${baseLabel} ${index}`;
      rooms.push({ name, type });
    }

    return rooms;
  }

  // Fallback: use capacity object for counts
  const capacity = isRecord(property.capacity) ? property.capacity : undefined;
  const bedroomCount = asNumber(property.bedrooms) ?? asNumber(capacity?.bedrooms);
  const bathroomCount = asNumber(property.bathrooms) ?? asNumber(capacity?.bathrooms);

  if (typeof bedroomCount === "number" && bedroomCount > 0) {
    for (let i = 1; i <= bedroomCount; i++) {
      rooms.push({ name: bedroomCount === 1 ? "Bedroom" : `Bedroom ${i}`, type: "bedroom" });
    }
  }

  if (typeof bathroomCount === "number" && bathroomCount > 0) {
    const whole = Math.floor(bathroomCount);
    const hasHalf = bathroomCount > whole;
    for (let i = 1; i <= whole; i++) {
      rooms.push({ name: whole === 1 && !hasHalf ? "Bathroom" : `Bathroom ${i}`, type: "bathroom" });
    }
    if (hasHalf) {
      rooms.push({ name: "Half Bath", type: "bathroom" });
    }
  }

  // Add common rooms if we have no rooms at all
  if (rooms.length === 0) {
    rooms.push({ name: "Living Room", type: "living_room" });
    rooms.push({ name: "Kitchen", type: "kitchen" });
  }

  return rooms;
}

function normalizePropertyDetails(rawProperty: unknown): NormalizedPropertyDetails | null {
  if (!isRecord(rawProperty)) return null;

  const hospitableId = asString(rawProperty.id);
  if (!hospitableId) return null;

  const capacity = isRecord(rawProperty.capacity) ? rawProperty.capacity : undefined;
  const bedroomCount = asNumber(rawProperty.bedrooms) ?? asNumber(capacity?.bedrooms);
  const bathroomCount = asNumber(rawProperty.bathrooms) ?? asNumber(capacity?.bathrooms);

  const rooms = extractRoomsFromProperty(rawProperty);

  // Hospitable v2 returns an `address` object: { street, city, state, postcode, country, ... }
  const addr = isRecord(rawProperty.address) ? rawProperty.address : undefined;
  const streetAddress =
    asString(addr?.street) ??
    asString(addr?.display) ??
    asString(addr?.line1) ??
    asString(rawProperty.address_line1);

  // Hospitable returns IANA timezone like "America/Chicago" on the property.
  const timezone =
    asString(rawProperty.timezone) ??
    asString(rawProperty.time_zone) ??
    asString(addr?.timezone) ??
    asString(addr?.time_zone);

  return {
    hospitableId,
    name: asString(rawProperty.name) ?? asString(rawProperty.title),
    address: streetAddress,
    city: asString(addr?.city) ?? asString(rawProperty.city),
    state: asString(addr?.state) ?? asString(addr?.region) ?? asString(rawProperty.state),
    zipCode:
      asString(addr?.postcode) ?? asString(addr?.postal_code) ?? asString(rawProperty.zip_code),
    country: asString(addr?.country) ?? asString(addr?.country_code),
    currency: asString(rawProperty.currency),
    imageUrl:
      asString(rawProperty.picture) ??
      asString(rawProperty.main_picture) ??
      asString(rawProperty.thumbnail_url),
    bedrooms: bedroomCount,
    bathrooms: bathroomCount,
    timezone,
    rooms,
  };
}

async function fetchAllHospitableProperties(
  apiKey: string,
  baseUrl: string,
  ctx?: UsageLogCtx,
): Promise<unknown[]> {
  const perPage = 50;
  const maxPages = 20; // hard cap — 1,000 properties is plenty of headroom
  const all: unknown[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = `${baseUrl}/properties?page=${page}&per_page=${perPage}`;
    const payload = await fetchHospitableJson(apiKey, url, ctx, "hospitable_properties_sync");
    const rows = getArrayFromApiPayload(payload);
    if (rows.length === 0) break;
    all.push(...rows);

    // Stop early if we can see we've fetched everything
    const meta = isRecord(payload) && isRecord(payload.meta) ? payload.meta : undefined;
    const lastPage = asNumber(meta?.last_page);
    if (typeof lastPage === "number" && page >= lastPage) break;
    if (rows.length < perPage) break;
  }

  return all;
}

export const syncPropertyDetails = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    success: boolean;
    propertiesSynced: number;
    propertiesInserted: number;
    propertiesUpdated: number;
    propertiesSkipped: number;
    propertiesDeactivated: number;
    deactivationSkipped: string | null;
    errors: string[];
  }> => {
    const apiKey = process.env.HOSPITABLE_API_KEY ?? process.env.HOSPITABLE_API_TOKEN;
    if (!apiKey) {
      throw new Error("Missing HOSPITABLE_API_KEY/HOSPITABLE_API_TOKEN environment variable.");
    }

    const baseUrl = process.env.HOSPITABLE_API_URL ?? DEFAULT_HOSPITABLE_BASE_URL;

    const rawProperties = await fetchAllHospitableProperties(apiKey, baseUrl, ctx);

    let propertiesInserted = 0;
    let propertiesUpdated = 0;
    let propertiesSkipped = 0;
    const hospitableIdsSeen: string[] = [];
    const errors: string[] = [];

    for (const rawProperty of rawProperties) {
      const details = normalizePropertyDetails(rawProperty);
      if (!details) {
        propertiesSkipped++;
        errors.push("Skipped a Hospitable property with no id / non-object shape.");
        continue;
      }

      // Fetch individual property detail for richer address + room data
      let enrichedRooms = details.rooms;
      try {
        const detailPayload = await fetchHospitableJson(
          apiKey,
          `${baseUrl}/properties/${details.hospitableId}`,
          ctx,
          "hospitable_properties_sync",
        );
        const detailData = isRecord(detailPayload) && isRecord(detailPayload.data) ? detailPayload.data : detailPayload;
        if (isRecord(detailData)) {
          const detailCapacity = isRecord(detailData.capacity) ? detailData.capacity : undefined;
          details.bedrooms = details.bedrooms ?? asNumber(detailCapacity?.bedrooms);
          details.bathrooms = details.bathrooms ?? asNumber(detailCapacity?.bathrooms);

          // Detail endpoint can carry timezone we missed in the list payload.
          const detailAddress = isRecord(detailData.address) ? detailData.address : undefined;
          details.timezone =
            details.timezone ??
            asString(detailData.timezone) ??
            asString(detailData.time_zone) ??
            asString(detailAddress?.timezone) ??
            asString(detailAddress?.time_zone);

          // Detail endpoint has room_details — extract rooms from it
          const detailRooms = extractRoomsFromProperty(detailData);
          if (detailRooms.length > enrichedRooms.length) {
            enrichedRooms = detailRooms;
          }

          // Address merge — prefer detail endpoint since list is often sparse
          const detailNormalized = normalizePropertyDetails(detailData);
          if (detailNormalized) {
            details.name ??= detailNormalized.name;
            details.address ??= detailNormalized.address;
            details.city ??= detailNormalized.city;
            details.state ??= detailNormalized.state;
            details.zipCode ??= detailNormalized.zipCode;
            details.country ??= detailNormalized.country;
            details.timezone ??= detailNormalized.timezone;
            details.currency ??= detailNormalized.currency;
            details.imageUrl ??= detailNormalized.imageUrl;
          }
        }
      } catch {
        // Fall through with list-level data
      }

      try {
        const result = await ctx.runMutation(internal.hospitable.mutations.upsertPropertyFromHospitable, {
          hospitableId: details.hospitableId,
          name: details.name,
          address: details.address,
          city: details.city,
          state: details.state,
          zipCode: details.zipCode,
          country: details.country,
          timezone: details.timezone,
          currency: details.currency,
          imageUrl: details.imageUrl,
          bedrooms: details.bedrooms,
          bathrooms: details.bathrooms,
          rooms: enrichedRooms,
        });
        if (result.action === "inserted") propertiesInserted++;
        else propertiesUpdated++;
        hospitableIdsSeen.push(details.hospitableId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Property ${details.hospitableId}: ${message}`);
        propertiesSkipped++;
      }
    }

    // Deactivation pass — anything in Convex with a hospitableId that we did NOT see is now gone
    // from Hospitable. Safety cap: never deactivate >25% in a single run.
    const deactivationResult = await ctx.runMutation(
      internal.hospitable.mutations.deactivateMissingProperties,
      {
        hospitableIdsSeen,
        maxDeactivationRatio: 0.25,
      },
    );

    if (deactivationResult.skipped) {
      errors.push(`Deactivation pass skipped: ${deactivationResult.reason}`);
    }

    return {
      success: errors.length === 0,
      propertiesSynced: propertiesInserted + propertiesUpdated,
      propertiesInserted,
      propertiesUpdated,
      propertiesSkipped,
      propertiesDeactivated: deactivationResult.deactivated,
      deactivationSkipped: deactivationResult.skipped ? deactivationResult.reason ?? null : null,
      errors,
    };
  },
});

/**
 * Resync a single property's details (rooms, bedrooms, bathrooms, timezone) from
 * Hospitable. Admin-facing alternative to the full-sweep `syncPropertyDetails` cron.
 */
export const resyncPropertyDetails = action({
  args: {
    propertyId: v.id("properties"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    success: boolean;
    roomsSynced: number;
    bedrooms?: number;
    bathrooms?: number;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated.");
    }

    const currentUser: Doc<"users"> | null = await ctx.runQuery(
      api.users.queries.getByClerkId,
      { clerkId: identity.subject },
    );
    if (
      !currentUser ||
      (currentUser.role !== "admin" &&
        currentUser.role !== "property_ops" &&
        currentUser.role !== "manager")
    ) {
      throw new Error("You do not have permission to resync property details.");
    }

    const property: Doc<"properties"> | null = await ctx.runQuery(
      api.properties.queries.getById,
      { id: args.propertyId },
    );
    if (!property) {
      throw new Error("Property not found.");
    }
    if (!property.hospitableId) {
      throw new Error(
        "This property has no Hospitable ID — nothing to resync. Set hospitableId on the property first.",
      );
    }

    const apiKey = process.env.HOSPITABLE_API_KEY ?? process.env.HOSPITABLE_API_TOKEN;
    if (!apiKey) {
      throw new Error("Missing HOSPITABLE_API_KEY/HOSPITABLE_API_TOKEN environment variable.");
    }

    const baseUrl = process.env.HOSPITABLE_API_URL ?? DEFAULT_HOSPITABLE_BASE_URL;
    const detailPayload = await fetchHospitableJson(
      apiKey,
      `${baseUrl}/properties/${property.hospitableId}`,
      ctx,
      "hospitable_property_resync",
    );
    const detailData =
      isRecord(detailPayload) && isRecord(detailPayload.data)
        ? detailPayload.data
        : detailPayload;
    const details = normalizePropertyDetails(detailData);
    if (!details) {
      throw new Error("Hospitable returned no usable property details.");
    }

    if (isRecord(detailData)) {
      const detailCapacity = isRecord(detailData.capacity) ? detailData.capacity : undefined;
      details.bedrooms = details.bedrooms ?? asNumber(detailCapacity?.bedrooms);
      details.bathrooms = details.bathrooms ?? asNumber(detailCapacity?.bathrooms);
      const detailAddress = isRecord(detailData.address) ? detailData.address : undefined;
      details.timezone =
        details.timezone ??
        asString(detailData.timezone) ??
        asString(detailData.time_zone) ??
        asString(detailAddress?.timezone) ??
        asString(detailAddress?.time_zone);
    }

    await ctx.runMutation(internal.hospitable.mutations.updatePropertyDetails, {
      hospitableId: details.hospitableId,
      bedrooms: details.bedrooms,
      bathrooms: details.bathrooms,
      timezone: details.timezone,
      rooms: details.rooms,
    });

    return {
      success: true,
      roomsSynced: details.rooms.length,
      bedrooms: details.bedrooms,
      bathrooms: details.bathrooms,
    };
  },
});

/**
 * Public, auth-gated entry point that runs the full Hospitable resync chain
 * in one shot. Called from the admin UI "Sync from Hospitable" button on
 * the Properties page.
 *
 * Order:
 *   1. bootstrapMissingProperties  — creates rows for new Hospitable properties
 *   2. syncPropertyDetails         — refreshes rooms/capacity/timezone
 *   3. syncReservations            — creates/updates upcoming cleaningJobs
 *
 * Safe for any signed-in user: all three steps are idempotent (upserts only).
 * Manager-scoped views still apply on read, so triggering a sync never leaks
 * other companies' data to a manager.
 */
export const syncAllFromHospitable = action({
  args: {
    daysForward: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    bootstrap: { total: number; created: number; skipped: number };
    propertyDetails: {
      success: boolean;
      propertiesSynced: number;
      propertiesSkipped: number;
      errorCount: number;
    };
    reservations: {
      success: boolean;
      summary: {
        reservationsReceived: number;
        staysCreated: number;
        staysUpdated: number;
        jobsCreated: number;
        jobsUpdated: number;
        jobsCancelled: number;
        skippedMissingProperty: number;
      };
    };
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated.");
    }

    const bootstrap = await ctx.runAction(
      internal.hospitable.actions.bootstrapMissingProperties,
      {},
    );

    const propertyDetails = await ctx.runAction(
      internal.hospitable.actions.syncPropertyDetails,
      {},
    );

    const reservations = await ctx.runAction(
      internal.hospitable.actions.syncReservations,
      args.daysForward !== undefined ? { daysForward: args.daysForward } : {},
    );

    return {
      bootstrap: {
        total: bootstrap.total,
        created: bootstrap.created,
        skipped: bootstrap.skipped,
      },
      propertyDetails: {
        success: propertyDetails.success,
        propertiesSynced: propertyDetails.propertiesSynced,
        propertiesSkipped: propertyDetails.propertiesSkipped,
        errorCount: propertyDetails.errors.length,
      },
      reservations: {
        success: reservations.success,
        summary: {
          reservationsReceived: reservations.summary.reservationsReceived,
          staysCreated: reservations.summary.staysCreated,
          staysUpdated: reservations.summary.staysUpdated,
          jobsCreated: reservations.summary.jobsCreated,
          jobsUpdated: reservations.summary.jobsUpdated,
          jobsCancelled: reservations.summary.jobsCancelled,
          skippedMissingProperty: reservations.summary.skippedMissingProperty,
        },
      },
    };
  },
});

/**
 * Bootstrap any Hospitable properties that are missing from Convex.
 *
 * `syncPropertyDetails` only updates existing properties; `syncReservations`
 * skips reservations whose property isn't in Convex. That left the door open
 * for a Hospitable-side new property to never get a Convex row.
 *
 * This action lists Hospitable's `/properties`, then for every one that's
 * missing from Convex it fetches the detail endpoint and inserts a
 * `properties` row via `createPropertyFromHospitable` (which is idempotent —
 * safe to re-run).
 *
 * Usage (prod):
 *   npx convex run hospitable/actions:bootstrapMissingProperties
 *
 * Pairs with `syncPropertyDetails` (richer metadata refresh) and
 * `syncReservations` (jobs creation). Recommended order on a cold start:
 *   1. bootstrapMissingProperties   ← creates missing property rows
 *   2. syncPropertyDetails          ← refreshes rooms/capacity/timezone
 *   3. syncReservations             ← creates upcoming cleaningJobs
 */
export const bootstrapMissingProperties = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    total: number;
    created: number;
    skipped: number;
    results: Array<{
      hospitableId: string;
      name?: string;
      created: boolean;
      skippedReason?: string;
    }>;
  }> => {
    const apiKey = process.env.HOSPITABLE_API_KEY ?? process.env.HOSPITABLE_API_TOKEN;
    if (!apiKey) {
      throw new Error("Missing HOSPITABLE_API_KEY/HOSPITABLE_API_TOKEN environment variable.");
    }
    const baseUrl = process.env.HOSPITABLE_API_URL ?? DEFAULT_HOSPITABLE_BASE_URL;

    const listPayload = await fetchHospitableJson(
      apiKey,
      `${baseUrl}/properties`,
      ctx,
      "hospitable_bootstrap_properties",
    );
    const rawList = getArrayFromApiPayload(listPayload);

    const results: Array<{
      hospitableId: string;
      name?: string;
      created: boolean;
      skippedReason?: string;
    }> = [];

    for (const raw of rawList) {
      if (!isRecord(raw)) continue;
      const hospitableId = asString(raw.id);
      if (!hospitableId) continue;

      // Fetch the detail endpoint for richer address + capacity data.
      let detailData: unknown = raw;
      try {
        const detail = await fetchHospitableJson(
          apiKey,
          `${baseUrl}/properties/${hospitableId}`,
          ctx,
          "hospitable_bootstrap_properties",
        );
        detailData =
          isRecord(detail) && isRecord(detail.data) ? detail.data : detail;
      } catch {
        // Fall back to list payload.
      }

      if (!isRecord(detailData)) {
        results.push({ hospitableId, created: false, skippedReason: "no detail payload" });
        continue;
      }

      const name =
        asString(detailData.name) ??
        asString(detailData.title) ??
        hospitableId;

      const address = isRecord(detailData.address) ? detailData.address : undefined;
      const street =
        asString(address?.street) ??
        asString(address?.address1) ??
        asString(address?.line1) ??
        asString(address?.address);
      const city = asString(address?.city);
      const state = asString(address?.state) ?? asString(address?.region);
      const zipCode =
        asString(address?.postal_code) ??
        asString(address?.postcode) ??
        asString(address?.zip);
      const country =
        asString(address?.country) ?? asString(address?.country_code);
      const timezone =
        asString(detailData.timezone) ??
        asString(detailData.time_zone) ??
        asString(address?.timezone) ??
        asString(address?.time_zone);

      const addressLine =
        [street, city, state, zipCode].filter(Boolean).join(", ") || name;

      const capacity = isRecord(detailData.capacity) ? detailData.capacity : undefined;
      const bedrooms = asNumber(detailData.bedrooms) ?? asNumber(capacity?.bedrooms);
      const bathrooms = asNumber(detailData.bathrooms) ?? asNumber(capacity?.bathrooms);

      // Hospitable returns the cover image as a string under `picture`.
      const imageUrl =
        asString(detailData.picture) ??
        asString(detailData.cover_picture) ??
        asString(detailData.thumbnail_url);

      const rooms = extractRoomsFromProperty(detailData);

      const r = await ctx.runMutation(
        internal.hospitable.mutations.createPropertyFromHospitable,
        {
          hospitableId,
          name,
          address: addressLine,
          city,
          state,
          zipCode,
          country,
          timezone,
          bedrooms,
          bathrooms,
          imageUrl,
          rooms,
        },
      );

      results.push({
        hospitableId,
        name,
        created: r.created,
      });
    }

    const created = results.filter((r) => r.created).length;
    return {
      total: results.length,
      created,
      skipped: results.length - created,
      results,
    };
  },
});

// ─── DIAGNOSTIC: dump a single Hospitable reservation as JSON ──────────────
// Helps figure out which financial-field path Hospitable actually uses for
// stays where backfillReservationFinancials returns skippedNoChange. Pass
// the stay's hospitableId; logs the full payload to console + returns the
// extracted financial paths.

export const inspectReservation = action({
  args: { hospitableId: v.string() },
  handler: async (_ctx, args): Promise<unknown> => {
    const apiKey =
      process.env.HOSPITABLE_API_KEY ?? process.env.HOSPITABLE_API_TOKEN;
    if (!apiKey) throw new Error("Missing HOSPITABLE_API_KEY");
    const baseUrl =
      process.env.HOSPITABLE_API_URL ?? DEFAULT_HOSPITABLE_BASE_URL;
    const r = await fetch(
      `${baseUrl}/reservations/${encodeURIComponent(args.hospitableId)}`,
      { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } },
    );
    if (!r.ok) throw new Error(`Hospitable HTTP ${r.status}: ${await r.text()}`);
    const json = (await r.json()) as unknown;
    return json;
  },
});

/**
 * Probe known Hospitable financial-data endpoints for a single reservation
 * to find which one our account actually exposes. Tries each in turn and
 * reports HTTP status + first 500 bytes of payload.
 */
export const probeReservationFinancialEndpoints = action({
  args: { hospitableId: v.string() },
  handler: async (
    _ctx,
    args,
  ): Promise<Array<{ url: string; status: number; preview: string }>> => {
    const apiKey =
      process.env.HOSPITABLE_API_KEY ?? process.env.HOSPITABLE_API_TOKEN;
    if (!apiKey) throw new Error("Missing HOSPITABLE_API_KEY");
    const baseUrl =
      process.env.HOSPITABLE_API_URL ?? DEFAULT_HOSPITABLE_BASE_URL;
    const id = encodeURIComponent(args.hospitableId);
    const endpoints = [
      `${baseUrl}/reservations/${id}/financials`,
      `${baseUrl}/reservations/${id}/transactions`,
      `${baseUrl}/reservations/${id}/charges`,
      `${baseUrl}/reservations/${id}/payouts`,
      `${baseUrl}/reservations/${id}/payments`,
      `${baseUrl}/reservations/${id}/quote`,
      `${baseUrl}/reservations/${id}?include=financials`,
      `${baseUrl}/reservations/${id}?include=transactions`,
      `${baseUrl}/transactions?reservation_id=${id}`,
    ];
    const results: Array<{ url: string; status: number; preview: string }> = [];
    for (const url of endpoints) {
      try {
        const r = await fetch(url, {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        });
        const body = await r.text();
        results.push({ url, status: r.status, preview: body.slice(0, 500) });
      } catch (e) {
        results.push({
          url,
          status: -1,
          preview: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return results;
  },
});

// ─── Per-reservation financial backfill (Wave 4c) ──────────────────────────
//
// Historical stays from before the totalAmount-extraction fix have
// totalAmount=undefined. The cron-driven /reservations LIST endpoint is
// paginated and we don't follow pages, so it only heals the first page on
// each sync window. This action explicitly refetches each stay by its
// hospitableId via GET /reservations/{id} so we backfill in one shot.
//
// Default scope: last 90 days. Owner-portal demos work off rolling 1-3
// months — backfilling further is rarely useful. Pass lookbackDays to
// override.

export const backfillReservationFinancials = internalAction({
  args: {
    lookbackDays: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
    /** When true, re-fetches EVERY stay in the window (not just those
     *  missing totalAmount) and overwrites. Use after fixing the
     *  extraction formula to correct previously-stored buggy values —
     *  e.g. the 2026-05-26 fix that switched from `accommodation +
     *  guest_fees` (which over-counted by ~28% on Airbnb) to
     *  `host.revenue.amount` (which already nets discounts + Airbnb
     *  service fee). Default false. */
    forceRefresh: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    scanned: number;
    fetched: number;
    patched: number;
    skippedNoChange: number;
    errors: string[];
    dryRun: boolean;
  }> => {
    const apiKey = process.env.HOSPITABLE_API_KEY ?? process.env.HOSPITABLE_API_TOKEN;
    if (!apiKey) {
      throw new Error("Missing HOSPITABLE_API_KEY/HOSPITABLE_API_TOKEN.");
    }
    const baseUrl = process.env.HOSPITABLE_API_URL ?? DEFAULT_HOSPITABLE_BASE_URL;
    // Defaults: 90 days back (user's "3 months max"). Pass explicit value to override.
    const lookbackDays = args.lookbackDays ?? 90;
    const dryRun = args.dryRun ?? false;
    const forceRefresh = args.forceRefresh ?? false;
    const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

    // Pull candidates: by default only stays missing totalAmount, OR all
    // stays in the window when `forceRefresh` is true.
    const candidates = await ctx.runQuery(
      internal.hospitable.queries.listStaysMissingTotalAmount,
      { sinceMs: cutoff, includeAlreadyPopulated: forceRefresh },
    );

    let fetched = 0;
    let patched = 0;
    let skippedNoChange = 0;
    const errors: string[] = [];

    for (const c of candidates) {
      if (!c.hospitableId) continue;
      try {
        // ?include=financials is REQUIRED for Hospitable v2 to return the
        // host.accommodation_breakdown + host.guest_fees arrays. Without it
        // the response has no money fields at all.
        const raw = await fetchHospitableJson(
          apiKey,
          `${baseUrl}/reservations/${encodeURIComponent(c.hospitableId)}?include=financials`,
          ctx,
          "hospitable_reservation_backfill",
        );
        fetched += 1;
        // Hospitable wraps single-resource responses in `{ data: {...} }`.
        const data =
          isRecord(raw) && isRecord((raw as GenericRecord).data)
            ? (raw as GenericRecord).data
            : raw;
        const { reservation, error } = normalizeReservation(
          data,
          c.propertyHospitableId ?? "",
        );
        if (!reservation) {
          if (error) errors.push(`${c.hospitableId}: ${error}`);
          continue;
        }
        if (
          reservation.totalAmount === undefined &&
          reservation.currency === undefined &&
          reservation.cancelledAt === undefined
        ) {
          skippedNoChange += 1;
          continue;
        }
        if (dryRun) {
          patched += 1;
          continue;
        }
        await ctx.runMutation(internal.hospitable.mutations.patchStayFinancials, {
          stayId: c._id,
          totalAmount: reservation.totalAmount,
          currency: reservation.currency,
          cancelledAt: reservation.cancelledAt,
          cancellationSource: reservation.cancellationSource,
        });
        patched += 1;
      } catch (e) {
        errors.push(
          `${c.hospitableId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    return {
      scanned: candidates.length,
      fetched,
      patched,
      skippedNoChange,
      errors,
      dryRun,
    };
  },
});

/**
 * Daily backstop sync for guest reviews. The `review.created` webhook
 * (convex/hospitable/webhooks.ts) is the primary ingestion path; this sweep
 * catches deliveries that failed before our ingest mutation ran, and
 * backfills review history the first time this runs against a property.
 * Iterates OUR properties table (not Hospitable's) — only properties with
 * hospitableId set are queryable against the reviews endpoint.
 */
export const syncGuestReviews = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    propertiesScanned: number;
    reviewsUpserted: number;
    reviewsSkipped: number;
    errors: string[];
  }> => {
    const apiKey = process.env.HOSPITABLE_API_KEY ?? process.env.HOSPITABLE_API_TOKEN;
    if (!apiKey) {
      throw new Error("Missing HOSPITABLE_API_KEY/HOSPITABLE_API_TOKEN environment variable.");
    }
    const baseUrl = process.env.HOSPITABLE_API_URL ?? DEFAULT_HOSPITABLE_BASE_URL;

    const properties: Array<Doc<"properties">> = await ctx.runQuery(
      internal.hospitable.queries.listPropertiesWithHospitableId,
      {},
    );

    let reviewsUpserted = 0;
    let reviewsSkipped = 0;
    const errors: string[] = [];

    for (const property of properties) {
      if (!property.hospitableId) continue;

      let rawReviews: unknown[];
      try {
        rawReviews = await fetchAllHospitablePages(
          apiKey,
          `${baseUrl}/properties/${property.hospitableId}/reviews`,
          ctx,
          "hospitable_reviews_sync",
        );
      } catch (error) {
        errors.push(
          `Property ${property.hospitableId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }

      for (const rawReview of rawReviews) {
        const { review, error } = normalizeGuestReview(rawReview);
        if (!review) {
          if (error) errors.push(error);
          reviewsSkipped++;
          continue;
        }

        const result = await ctx.runMutation(internal.hospitable.mutations.upsertGuestReview, review);
        if (result.outcome === "skipped_no_property") {
          reviewsSkipped++;
        } else {
          reviewsUpserted++;
        }
      }
    }

    return {
      propertiesScanned: properties.length,
      reviewsUpserted,
      reviewsSkipped,
      errors,
    };
  },
});

/**
 * One-shot backfill for stays whose `platform` was dropped during ingest
 * (Hospitable swaps which field carries the channel name across API
 * versions — see `extractPlatform`). Re-fetches each missing stay and
 * patches the platform field only. Safe to re-run.
 */
export const backfillReservationPlatforms = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (
    ctx,
    args,
  ): Promise<{
    scanned: number;
    fetched: number;
    patched: number;
    skippedNoChange: number;
    errors: string[];
    dryRun: boolean;
  }> => {
    const apiKey = process.env.HOSPITABLE_API_KEY ?? process.env.HOSPITABLE_API_TOKEN;
    if (!apiKey) {
      throw new Error("Missing HOSPITABLE_API_KEY/HOSPITABLE_API_TOKEN.");
    }
    const baseUrl = process.env.HOSPITABLE_API_URL ?? DEFAULT_HOSPITABLE_BASE_URL;
    const dryRun = args.dryRun ?? false;

    const candidates = await ctx.runQuery(
      internal.hospitable.queries.listStaysMissingPlatform,
      {},
    );

    let fetched = 0;
    let patched = 0;
    let skippedNoChange = 0;
    const errors: string[] = [];

    for (const c of candidates) {
      if (!c.hospitableId) continue;
      try {
        const raw = await fetchHospitableJson(
          apiKey,
          `${baseUrl}/reservations/${encodeURIComponent(c.hospitableId)}?include=financials`,
          ctx,
          "hospitable_reservation_platform_backfill",
        );
        fetched += 1;
        const data =
          isRecord(raw) && isRecord((raw as GenericRecord).data)
            ? (raw as GenericRecord).data
            : raw;
        const { reservation, error } = normalizeReservation(
          data,
          c.propertyHospitableId ?? "",
        );
        if (!reservation) {
          if (error) errors.push(`${c.hospitableId}: ${error}`);
          continue;
        }
        if (reservation.platform === undefined) {
          skippedNoChange += 1;
          continue;
        }
        if (dryRun) {
          patched += 1;
          continue;
        }
        await ctx.runMutation(internal.hospitable.mutations.patchStayPlatform, {
          stayId: c._id,
          platform: reservation.platform,
        });
        patched += 1;
      } catch (e) {
        errors.push(
          `${c.hospitableId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    return {
      scanned: candidates.length,
      fetched,
      patched,
      skippedNoChange,
      errors,
      dryRun,
    };
  },
});

/**
 * POST /v2/reviews/{uuid}/respond — publishes a reply to a guest review on
 * Airbnb (also supports Booking.com per Hospitable's docs, but we don't
 * operate there). Plain exported function, NOT a Convex action — called
 * in-process from convex/guestReviews/actions.ts::sendApprovedReply to
 * avoid an unnecessary action-to-action runtime hop (both run on the
 * default V8 runtime; see convex/_generated/ai/guidelines.md).
 */
export async function postReviewResponse(args: {
  apiKey: string;
  baseUrl: string;
  hospitableReviewId: string;
  responseText: string;
  ctx?: UsageLogCtx;
}): Promise<{ id: string; respondedAt: string }> {
  const url = `${args.baseUrl}/reviews/${args.hospitableReviewId}/respond`;
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ response: args.responseText }),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error ?? "unknown");
    if (args.ctx) {
      try {
        await args.ctx.runMutation(internal.serviceUsage.logger.log, {
          serviceKey: "hospitable",
          feature: "hospitable_review_respond",
          status: "timeout",
          durationMs: Date.now() - startedAt,
          errorMessage: errorMessage.slice(0, 500),
          metadata: { url: stripUrlSecrets(url) },
        });
      } catch {
        // best-effort
      }
    }
    throw new Error(`Network error posting review response: ${errorMessage}`);
  }

  const durationMs = Date.now() - startedAt;

  if (!response.ok) {
    const errorBody = await response.text();
    if (args.ctx) {
      try {
        await args.ctx.runMutation(internal.serviceUsage.logger.log, {
          serviceKey: "hospitable",
          feature: "hospitable_review_respond",
          status: classifyHttpStatus(response.status),
          durationMs,
          errorCode: String(response.status),
          errorMessage: errorBody.slice(0, 500),
          metadata: { url: stripUrlSecrets(url) },
        });
      } catch {
        // best-effort
      }
    }
    throw new Error(`Hospitable respond-to-review failed (${response.status}): ${errorBody}`);
  }

  const json = (await response.json()) as { id?: string; responded_at?: string };
  if (args.ctx) {
    try {
      await args.ctx.runMutation(internal.serviceUsage.logger.log, {
        serviceKey: "hospitable",
        feature: "hospitable_review_respond",
        status: "success",
        durationMs,
        metadata: { url: stripUrlSecrets(url) },
      });
    } catch {
      // best-effort
    }
  }

  return {
    id: json.id ?? args.hospitableReviewId,
    respondedAt: json.responded_at ?? new Date().toISOString(),
  };
}
