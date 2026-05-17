import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
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

      const propertiesPayload = await fetchHospitableJson(
        apiKey,
        `${baseUrl}/properties`,
        ctx,
        "hospitable_reservations_sync",
      );
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
          `${baseUrl}/reservations?${params.toString()}`,
          ctx,
          "hospitable_reservations_sync",
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
  bedrooms?: number;
  bathrooms?: number;
  timezone?: string;
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

  // Hospitable returns IANA timezone like "America/Chicago" on the property.
  const address = isRecord(rawProperty.address) ? rawProperty.address : undefined;
  const timezone =
    asString(rawProperty.timezone) ??
    asString(rawProperty.time_zone) ??
    asString(address?.timezone) ??
    asString(address?.time_zone);

  return {
    hospitableId,
    name: asString(rawProperty.name) ?? asString(rawProperty.title),
    bedrooms: bedroomCount,
    bathrooms: bathroomCount,
    timezone,
    rooms,
  };
}

export const syncPropertyDetails = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    success: boolean;
    propertiesSynced: number;
    propertiesSkipped: number;
    errors: string[];
  }> => {
    const apiKey = process.env.HOSPITABLE_API_KEY ?? process.env.HOSPITABLE_API_TOKEN;
    if (!apiKey) {
      throw new Error("Missing HOSPITABLE_API_KEY/HOSPITABLE_API_TOKEN environment variable.");
    }

    const baseUrl = process.env.HOSPITABLE_API_URL ?? DEFAULT_HOSPITABLE_BASE_URL;

    const propertiesPayload = await fetchHospitableJson(
      apiKey,
      `${baseUrl}/properties`,
      ctx,
      "hospitable_properties_sync",
    );
    const rawProperties = getArrayFromApiPayload(propertiesPayload);

    let propertiesSynced = 0;
    let propertiesSkipped = 0;
    const errors: string[] = [];

    for (const rawProperty of rawProperties) {
      const details = normalizePropertyDetails(rawProperty);
      if (!details) {
        propertiesSkipped++;
        continue;
      }

      // Also try fetching individual property detail for richer room data
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
          // Update counts from detail endpoint capacity object
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
        }
      } catch {
        // Individual property detail fetch failed, use list data
      }

      try {
        await ctx.runMutation(internal.hospitable.mutations.updatePropertyDetails, {
          hospitableId: details.hospitableId,
          bedrooms: details.bedrooms,
          bathrooms: details.bathrooms,
          timezone: details.timezone,
          rooms: enrichedRooms,
        });
        propertiesSynced++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Property ${details.hospitableId}: ${message}`);
        propertiesSkipped++;
      }
    }

    return {
      success: errors.length === 0,
      propertiesSynced,
      propertiesSkipped,
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
