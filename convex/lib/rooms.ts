import type { Doc } from "../_generated/dataModel";

/**
 * Normalize a user-supplied roomName against the property's canonical room list
 * (synced from Hospitable). If the input matches a canonical room name
 * case-insensitively, we return the canonical casing; otherwise we return the
 * trimmed input unchanged. This cleans up typo drift ("livingroom" →
 * "Living Room") without rejecting valid-but-unknown values (e.g. the
 * "Incident" default used when a cleaner captures a photo without picking a
 * specific room, or a legacy value on an in-flight job).
 *
 * See Docs/cleaner-rollout-and-saas/2026-04-21-property-rooms-from-hospitable-plan.md
 */
export function normalizeRoomName(
  property: Pick<Doc<"properties">, "rooms"> | null | undefined,
  input: string | null | undefined,
): string {
  const trimmed = typeof input === "string" ? input.trim() : "";
  if (trimmed.length === 0) {
    return "";
  }

  const rooms = property?.rooms ?? [];
  if (rooms.length === 0) {
    return trimmed;
  }

  const lower = trimmed.toLowerCase();
  for (const room of rooms) {
    if (typeof room?.name === "string" && room.name.trim().toLowerCase() === lower) {
      return room.name;
    }
  }

  return trimmed;
}
