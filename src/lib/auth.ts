export const USER_ROLES = ["admin", "property_ops", "manager", "cleaner"] as const;

export type UserRole = (typeof USER_ROLES)[number];

type ClaimsLike = Record<string, unknown> | null | undefined;

const ROUTE_ACCESS: Record<UserRole, string[]> = {
  admin: ["/"],
  property_ops: ["/", "/schedule", "/jobs", "/properties", "/team", "/reports"],
  manager: ["/", "/jobs", "/properties", "/team", "/reports"],
  cleaner: [],
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
  if (!claims) {
    return "cleaner";
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

  return "cleaner";
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
    default:
      return "/sign-in";
  }
}

