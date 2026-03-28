import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";

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

function normalizeReservation(
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
      platform: asString(rawReservation.platform),
      confirmationCode: asString(rawReservation.code),
      specialRequests,
      status: asString(rawReservation.status),
      metadata: {
        nights: asNumber(rawReservation.nights),
        source: "hospitable",
      },
    },
  };
}

async function fetchHospitableJson(apiKey: string, url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Hospitable request failed (${response.status}): ${errorBody}`);
  }

  return await response.json();
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

      const propertiesPayload = await fetchHospitableJson(apiKey, `${baseUrl}/properties`);
      const properties = getArrayFromApiPayload(propertiesPayload);

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

        const reservationPayload = await fetchHospitableJson(
          apiKey,
          `${baseUrl}/reservations?${params.toString()}`
        );

        const propertyReservations = getArrayFromApiPayload(reservationPayload);

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
        const payload = await fetchHospitableJson(apiKey, endpoint);
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
