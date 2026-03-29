export const USER_ROLES = ["admin", "property_ops", "manager", "cleaner"] as const;

export type UserRole = (typeof USER_ROLES)[number];

type ClaimsLike = Record<string, unknown> | null | undefined;

const ROUTE_ACCESS: Record<UserRole, string[]> = {
  admin: ["/"],
  property_ops: ["/", "/schedule", "/jobs", "/review", "/properties", "/companies", "/team", "/reports"],
  manager: ["/", "/jobs", "/review", "/properties", "/companies", "/team", "/reports"],
  cleaner: ["/cleaner"],
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

export function getRoleFromSessionClaims(claims: ClaimsLike): UserRole {
  const configuredFallbackRole = process.env.NEXT_PUBLIC_DEFAULT_ROLE;
  // Never grant admin when claims are missing/invalid.
  // Unknown users default to least-privileged web surface.
  const fallbackRole =
    isUserRole(configuredFallbackRole) && configuredFallbackRole !== "admin"
      ? configuredFallbackRole
      : "cleaner";

  if (!claims) {
    return fallbackRole;
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
    default:
      return "/";
  }
}
