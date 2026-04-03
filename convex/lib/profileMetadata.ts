type MetadataRecord = Record<string, unknown>;

type ProfileOverrideKey = "name" | "avatarUrl";

type ProfileOverrides = Partial<Record<ProfileOverrideKey, boolean>>;

function isRecord(value: unknown): value is MetadataRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readMetadataRecord(metadata: unknown): MetadataRecord {
  return isRecord(metadata) ? metadata : {};
}

export function readProfileOverrides(metadata: unknown): ProfileOverrides {
  const record = readMetadataRecord(metadata);
  const overrides = record.profileOverrides;
  return isRecord(overrides) ? (overrides as ProfileOverrides) : {};
}

export function setProfileOverride(
  metadata: unknown,
  key: ProfileOverrideKey,
  enabled: boolean,
): MetadataRecord {
  const record = readMetadataRecord(metadata);
  const overrides = readProfileOverrides(record);

  return {
    ...record,
    profileOverrides: {
      ...overrides,
      [key]: enabled,
    },
  };
}
