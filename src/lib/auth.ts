export const USER_ROLES = ["admin", "property_ops", "manager", "cleaner", "owner"] as const;

export type UserRole = (typeof USER_ROLES)[number];

type ClaimsLike = Record<string, unknown> | null | undefined;

const ROUTE_ACCESS: Record<UserRole, string[]> = {
  admin: ["/"],
  // Scoped 2026-07-12: ops handles day-to-day operations, not user
  // management (/team, /admin/owner-overview) or financial reporting
  // (/reports incl. Monthly Close + Property Costs, which live under it).
  // /settings was previously missing entirely — that was a bug, not a
  // deliberate restriction (ops needs Scheduling/Notifications/Integrations
  // tabs; the Team tab and cost dashboard within Settings are separately
  // role-gated in settings-page-client.tsx).
  property_ops: ["/", "/schedule", "/jobs", "/tasks", "/messages", "/review", "/properties", "/companies", "/incidents", "/maintenance", "/settings"],
  manager: ["/", "/schedule", "/jobs", "/tasks", "/messages", "/review", "/properties", "/team", "/incidents", "/maintenance"],
  cleaner: ["/cleaner"],
  // Wave 1 of owner portal is schema-only — `/owner` routes ship in Wave 4.
  // Until then owners hitting the app land on `/owner` and get a 404 from Next,
  // which is the correct interim behavior (no leakage to other surfaces).
  owner: ["/owner"],
};

function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && USER_ROLES.includes(value as UserRole);
}

function readRoleFromMetadata(metadata: unknown): UserRole | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const candidate = (metadata as Record<string, unknown>).role;
  return isUserRole(candidate) ? candidate : null;
}

export function getRoleFromMetadata(metadata: unknown): UserRole | null {
  return readRoleFromMetadata(metadata);
}

export function getRoleFromSessionClaimsOrNull(claims: ClaimsLike): UserRole | null {
  if (!claims) {
    return null;
  }

  const directRole = claims.role;
  if (isUserRole(directRole)) {
    return directRole;
  }

  const metadataRole = readRoleFromMetadata(claims.metadata);
  if (metadataRole) {
    return metadataRole;
  }

  const publicMetadataRole = readRoleFromMetadata(claims.publicMetadata);
  if (publicMetadataRole) {
    return publicMetadataRole;
  }

  const publicMetadataSnakeRole = readRoleFromMetadata(
    (claims as Record<string, unknown>).public_metadata,
  );
  if (publicMetadataSnakeRole) {
    return publicMetadataSnakeRole;
  }

  const unsafeMetadataRole = readRoleFromMetadata(
    (claims as Record<string, unknown>).unsafeMetadata,
  );
  if (unsafeMetadataRole) {
    return unsafeMetadataRole;
  }

  const unsafeMetadataSnakeRole = readRoleFromMetadata(
    (claims as Record<string, unknown>).unsafe_metadata,
  );
  if (unsafeMetadataSnakeRole) {
    return unsafeMetadataSnakeRole;
  }

  const allClaims = claims as Record<string, unknown>;
  for (const value of Object.values(allClaims)) {
    const nestedRole = readRoleFromMetadata(value);
    if (nestedRole) {
      return nestedRole;
    }
  }

  for (const [key, value] of Object.entries(allClaims)) {
    if (!key.toLowerCase().includes("role")) {
      continue;
    }
    if (isUserRole(value)) {
      return value;
    }
  }

  return null;
}

export function getRoleFromSessionClaims(claims: ClaimsLike): UserRole {
  const resolvedRole = getRoleFromSessionClaimsOrNull(claims);
  if (resolvedRole) {
    return resolvedRole;
  }

  const configuredFallbackRole = process.env.NEXT_PUBLIC_DEFAULT_ROLE;
  const fallbackRole =
    isUserRole(configuredFallbackRole) && configuredFallbackRole !== "admin"
      ? configuredFallbackRole
      : "manager";

  return fallbackRole;
}

export function canAccessPath(role: UserRole, pathname: string): boolean {
  if (role === "admin") {
    return true;
  }

  return ROUTE_ACCESS[role].some(
    (allowedPath) =>
      pathname === allowedPath ||
      pathname.startsWith(`${allowedPath}/`) ||
      (allowedPath === "/" && pathname === "/"),
  );
}

export function getDefaultRouteForRole(role: UserRole): string {
  switch (role) {
    case "admin":
      return "/";
    case "property_ops":
      return "/schedule";
    case "manager":
      return "/jobs";
    case "cleaner":
      return "/cleaner";
    case "owner":
      return "/owner";
    default:
      return "/";
  }
}
