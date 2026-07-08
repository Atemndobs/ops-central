/**
 * Re-export of the canonical role definitions from convex/lib/roles.ts.
 * Web app code should import from "@/lib/roles" to keep import paths clean.
 */
export {
  ROLE_DEFINITIONS,
  ROLE_KEYS,
  ROLE_LITERALS,
  describeScope,
  getRoleDefinition,
  isTenantScoped,
  requiresCompanyMembership,
  requiresPropertyAssignment,
  type RoleDefinition,
  type RoleKey,
  type RoleScope,
} from "@convex/lib/roles";
