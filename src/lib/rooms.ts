const FALLBACK_BASE_ROOMS = ["Living Room", "Kitchen", "Laundry"];

interface PropertyShape {
  bedrooms?: number | null;
  bathrooms?: number | null;
  rooms?: Array<{ name: string; type: string }> | null;
}

interface InventoryItemShape {
  room?: string | null;
}

/**
 * Build the room list for dropdowns. `property.rooms` (synced from Hospitable)
 * is the source of truth — see Docs/cleaner-rollout-and-saas/2026-04-21-property-rooms-from-hospitable-plan.md.
 * Inventory room names are merged in so legacy inventory rows stay selectable.
 * The bedroom/bathroom synthesis fallback only runs when rooms is missing.
 */
export function buildRoomOptions(
  property: PropertyShape | null,
  inventoryItems: InventoryItemShape[],
): string[] {
  const rooms = new Set<string>();

  const syncedRooms = property?.rooms ?? [];
  const hasSyncedRooms = syncedRooms.length > 0;

  if (hasSyncedRooms) {
    for (const room of syncedRooms) {
      const name = room?.name?.trim();
      if (name) {
        rooms.add(name);
      }
    }
  } else {
    for (const base of FALLBACK_BASE_ROOMS) {
      rooms.add(base);
    }

    const bedroomCount = Math.max(0, Math.floor(property?.bedrooms ?? 0));
    if (bedroomCount === 1) {
      rooms.add("Bedroom");
    } else if (bedroomCount > 1) {
      for (let index = 1; index <= bedroomCount; index += 1) {
        rooms.add(`Bedroom ${index}`);
      }
    }

    const bathroomCount = Math.max(0, Math.ceil(property?.bathrooms ?? 0));
    if (bathroomCount === 1) {
      rooms.add("Bathroom");
    } else if (bathroomCount > 1) {
      for (let index = 1; index <= bathroomCount; index += 1) {
        rooms.add(`Bathroom ${index}`);
      }
    }
  }

  for (const item of inventoryItems) {
    const value = item.room?.trim();
    if (value) {
      rooms.add(value);
    }
  }

  return Array.from(rooms);
}
