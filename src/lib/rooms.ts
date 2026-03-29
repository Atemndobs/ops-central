const BASE_ROOMS = ["Living Room", "Kitchen", "Laundry"];

interface PropertyShape {
  bedrooms?: number | null;
  bathrooms?: number | null;
}

interface InventoryItemShape {
  room?: string | null;
}

/**
 * Build a deterministic room list from property metadata and inventory items.
 * Base rooms are always included; bedroom/bathroom counts expand dynamically.
 */
export function buildRoomOptions(
  property: PropertyShape | null,
  inventoryItems: InventoryItemShape[],
): string[] {
  const rooms = new Set<string>(BASE_ROOMS);

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

  for (const item of inventoryItems) {
    const value = item.room?.trim();
    if (value) {
      rooms.add(value);
    }
  }

  return Array.from(rooms);
}
