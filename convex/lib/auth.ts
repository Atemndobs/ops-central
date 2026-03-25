/**
 * Authentication Utilities for Convex Functions
 *
 * This module provides helper functions to handle authentication and authorization
 * in Convex queries, mutations, and actions.
 *
 * Usage:
 * ```ts
 * import { requireAuth, requireRole, optionalAuth } from "./lib/auth";
 *
 * // In a query or mutation:
 * export const myProtectedFunction = query({
 *   handler: async (ctx) => {
 *     const identity = await requireAuth(ctx);
 *     // identity.subject contains the Clerk user ID
 *     // Continue with authenticated logic...
 *   },
 * });
 *
 * // For role-based access:
 * export const adminOnlyFunction = mutation({
 *   handler: async (ctx) => {
 *     const user = await requireRole(ctx, ["admin"]);
 *     // user contains the full user document
 *     // Continue with admin logic...
 *   },
 * });
 * ```
 */

import { QueryCtx, MutationCtx, ActionCtx } from "../_generated/server";
import { Doc } from "../_generated/dataModel";

/**
 * User identity from Clerk JWT token
 */
export interface UserIdentity {
  /** Clerk user ID (subject claim) */
  subject: string;
  /** User's email address */
  email?: string;
  /** User's name */
  name?: string;
  /** Token issuer (Clerk domain) */
  issuer: string;
  /** Token issued at timestamp */
  tokenIdentifier: string;
}

/**
 * Require authentication for a Convex function.
 * Throws an error if the user is not authenticated.
 *
 * @param ctx - The Convex context (query, mutation, or action)
 * @returns The authenticated user's identity
 * @throws Error if not authenticated
 *
 * @example
 * ```ts
 * export const getMyData = query({
 *   handler: async (ctx) => {
 *     const identity = await requireAuth(ctx);
 *     console.log("User ID:", identity.subject);
 *     // ...
 *   },
 * });
 * ```
 */
export async function requireAuth(
  ctx: QueryCtx | MutationCtx | ActionCtx
): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) {
    throw new Error("Not authenticated. Please sign in to continue.");
  }

  return identity as UserIdentity;
}

/**
 * Get the user's identity if authenticated, or null if not.
 * Useful for endpoints that work for both authenticated and anonymous users.
 *
 * @param ctx - The Convex context
 * @returns The user's identity or null
 *
 * @example
 * ```ts
 * export const getData = query({
 *   handler: async (ctx) => {
 *     const identity = await optionalAuth(ctx);
 *     if (identity) {
 *       // Return personalized data
 *     } else {
 *       // Return public data
 *     }
 *   },
 * });
 * ```
 */
export async function optionalAuth(
  ctx: QueryCtx | MutationCtx | ActionCtx
): Promise<UserIdentity | null> {
  const identity = await ctx.auth.getUserIdentity();
  return identity as UserIdentity | null;
}

/**
 * Require the user to have one of the specified roles.
 * First verifies authentication, then checks the user's role in the database.
 *
 * @param ctx - The Convex context (query or mutation - not action since it needs db access)
 * @param allowedRoles - Array of role names that are allowed
 * @returns The user document from the database
 * @throws Error if not authenticated or if user doesn't have a required role
 *
 * @example
 * ```ts
 * export const adminAction = mutation({
 *   handler: async (ctx) => {
 *     const user = await requireRole(ctx, ["admin"]);
 *     console.log("Admin user:", user.email);
 *     // ...
 *   },
 * });
 *
 * export const managerOrAdmin = mutation({
 *   handler: async (ctx) => {
 *     const user = await requireRole(ctx, ["admin", "manager"]);
 *     // ...
 *   },
 * });
 * ```
 */
export async function requireRole(
  ctx: QueryCtx | MutationCtx,
  allowedRoles: Array<Doc<"users">["role"]>
): Promise<Doc<"users">> {
  const identity = await requireAuth(ctx);

  // Look up the user by their Clerk ID
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .first();

  if (!user) {
    throw new Error(
      "User not found in database. Please complete your profile setup."
    );
  }

  if (!allowedRoles.includes(user.role)) {
    throw new Error(
      `Insufficient permissions. Required role: ${allowedRoles.join(" or ")}. ` +
        `Your role: ${user.role}`
    );
  }

  return user;
}

/**
 * Get the current user from the database.
 * Requires authentication and returns the user document.
 *
 * @param ctx - The Convex context (query or mutation)
 * @returns The user document from the database
 * @throws Error if not authenticated or user not found
 *
 * @example
 * ```ts
 * export const getProfile = query({
 *   handler: async (ctx) => {
 *     const user = await getCurrentUser(ctx);
 *     return {
 *       name: user.name,
 *       email: user.email,
 *       role: user.role,
 *     };
 *   },
 * });
 * ```
 */
export async function getCurrentUser(
  ctx: QueryCtx | MutationCtx
): Promise<Doc<"users">> {
  const identity = await requireAuth(ctx);

  const user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .first();

  if (!user) {
    throw new Error(
      "User not found in database. Please complete your profile setup."
    );
  }

  return user;
}

/**
 * Get the current user from the database, or null if not authenticated.
 * Useful for optional personalization.
 *
 * @param ctx - The Convex context (query or mutation)
 * @returns The user document or null
 *
 * @example
 * ```ts
 * export const getData = query({
 *   handler: async (ctx) => {
 *     const user = await getCurrentUserOrNull(ctx);
 *     if (user) {
 *       // Show personalized content
 *     }
 *     // ...
 *   },
 * });
 * ```
 */
export async function getCurrentUserOrNull(
  ctx: QueryCtx | MutationCtx
): Promise<Doc<"users"> | null> {
  const identity = await optionalAuth(ctx);

  if (!identity) {
    return null;
  }

  const user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .first();

  return user;
}

/**
 * Check if the current user has one of the specified roles.
 * Returns true/false instead of throwing an error.
 *
 * @param ctx - The Convex context (query or mutation)
 * @param allowedRoles - Array of role names to check
 * @returns True if user has one of the roles, false otherwise
 *
 * @example
 * ```ts
 * export const getData = query({
 *   handler: async (ctx) => {
 *     const isAdmin = await hasRole(ctx, ["admin"]);
 *     if (isAdmin) {
 *       // Include admin-only data
 *     }
 *     // ...
 *   },
 * });
 * ```
 */
export async function hasRole(
  ctx: QueryCtx | MutationCtx,
  allowedRoles: Array<Doc<"users">["role"]>
): Promise<boolean> {
  const identity = await optionalAuth(ctx);

  if (!identity) {
    return false;
  }

  const user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .first();

  if (!user) {
    return false;
  }

  return allowedRoles.includes(user.role);
}

/**
 * Verify that the current user is an admin.
 * Shorthand for requireRole(ctx, ["admin"]).
 *
 * @param ctx - The Convex context
 * @returns The admin user document
 * @throws Error if not admin
 */
export async function requireAdmin(
  ctx: QueryCtx | MutationCtx
): Promise<Doc<"users">> {
  return requireRole(ctx, ["admin"]);
}

/**
 * Verify that the current user is a manager or admin.
 * Shorthand for requireRole(ctx, ["manager", "admin"]).
 *
 * @param ctx - The Convex context
 * @returns The user document
 * @throws Error if not manager or admin
 */
export async function requireManagerOrAdmin(
  ctx: QueryCtx | MutationCtx
): Promise<Doc<"users">> {
  return requireRole(ctx, ["manager", "admin"]);
}

/**
 * Verify that the current user is property ops, manager, or admin.
 *
 * @param ctx - The Convex context
 * @returns The user document
 * @throws Error if not authorized
 */
export async function requirePropertyOpsOrAbove(
  ctx: QueryCtx | MutationCtx
): Promise<Doc<"users">> {
  return requireRole(ctx, ["property_ops", "manager", "admin"]);
}
