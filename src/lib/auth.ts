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
    default:
      return "/";
  }
}
