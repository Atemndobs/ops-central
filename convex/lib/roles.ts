import { v } from "convex/values";

/**
 * Single source of truth for platform roles.
 *
 * Role = permission verbs (what they can do).
 * Scope = which slice of data those permissions act on.
 *
 * See Docs/2026-06-01-role-scope-axis-adr.md
 */

export type RoleScope = "tenant" | "company" | "entity" | "ownership";

export type RoleDefinition = {
  key: string;
  label: string;
  scope: RoleScope;
  requiresCompany: boolean;
  requiresProperty: boolean;
  canBecomeCompanyMember: boolean;
  canBecomeOwner: boolean;
  description: string;
};

export const ROLE_DEFINITIONS = {
  admin: {
    key: "admin",
    label: "Admin",
    scope: "tenant",
    requiresCompany: false,
    requiresProperty: false,
    canBecomeCompanyMember: false,
    canBecomeOwner: false,
    description: "Full access to everything in the tenant.",
  },
  property_ops: {
    key: "property_ops",
    label: "Property Ops",
    scope: "tenant",
    requiresCompany: false,
    requiresProperty: false,
    canBecomeCompanyMember: false,
    canBecomeOwner: false,
    description: "Internal J&A role; portfolio-wide oversight, no scoping.",
  },
  manager: {
    key: "manager",
    label: "Vendor Manager",
    scope: "company",
    requiresCompany: true,
    requiresProperty: false,
    canBecomeCompanyMember: true,
    canBecomeOwner: false,
    description: "Cleaning-company manager; dispatches their company's cleaners.",
  },
  cleaner: {
    key: "cleaner",
    label: "Cleaner",
    scope: "entity",
    requiresCompany: true,
    requiresProperty: false,
    canBecomeCompanyMember: true,
    canBecomeOwner: false,
    description: "Field worker; sees only the jobs assigned to them.",
  },
  owner: {
    key: "owner",
    label: "Owner",
    scope: "ownership",
    requiresCompany: false,
    requiresProperty: false,
    canBecomeCompanyMember: false,
    canBecomeOwner: true,
    description: "Property owner; sees properties they hold stake in.",
  },
} as const satisfies Record<string, RoleDefinition>;

export type RoleKey = keyof typeof ROLE_DEFINITIONS;

export const ROLE_KEYS = Object.keys(ROLE_DEFINITIONS) as RoleKey[];

export const ROLE_LITERALS = [
  v.literal("cleaner"),
  v.literal("manager"),
  v.literal("property_ops"),
  v.literal("admin"),
  v.literal("owner"),
] as const;

export function getRoleDefinition(role: string | undefined | null): RoleDefinition | undefined {
  if (!role) return undefined;
  return (ROLE_DEFINITIONS as Record<string, RoleDefinition>)[role];
}

export function isTenantScoped(role: string | undefined | null): boolean {
  return getRoleDefinition(role)?.scope === "tenant";
}

export function requiresCompanyMembership(role: string | undefined | null): boolean {
  return getRoleDefinition(role)?.requiresCompany ?? false;
}

export function requiresPropertyAssignment(role: string | undefined | null): boolean {
  return getRoleDefinition(role)?.requiresProperty ?? false;
}

/**
 * Short label for the scope. One word. Long-form explanation belongs in
 * the role/scope settings page, not inline in every UI surface.
 */
export function describeScope(scope: RoleScope): string {
  switch (scope) {
    case "tenant":
      return "Portfolio";
    case "company":
      return "Company";
    case "entity":
      return "Jobs";
    case "ownership":
      return "Ownership";
  }
}
