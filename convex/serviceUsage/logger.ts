/**
 * Internal + public mutation wrappers around `logServiceUsage`.
 *
 * - `log` (internal): called from Convex actions via
 *   `ctx.runMutation(internal.serviceUsage.logger.log, ...)`.
 * - `logFromClient` (public, auth-required): called from Next.js routes that
 *   already hold an authenticated Clerk/Convex JWT. The Next.js chat route
 *   uses this via `convex.mutation(api.serviceUsage.logger.logFromClient, …)`
 *   in `streamText`'s `onFinish`/`onError` hooks.
 *
 * See convex/lib/serviceUsage.ts for the underlying helper and
 * Docs/usage-tracking/ADR.md §"Write Path" for the contract.
 */

import { v } from "convex/values";
import { internalMutation, mutation } from "../_generated/server";
import { logServiceUsage } from "../lib/serviceUsage";
import { getCurrentUserOrNull } from "../lib/auth";
import type { ServiceKey } from "../lib/serviceRegistry";

const serviceKeyValidator = v.union(
  v.literal("gemini"),
  v.literal("clerk"),
  v.literal("hospitable"),
  v.literal("resend"),
  v.literal("convex"),
  v.literal("b2"),
);

const eventStatusValidator = v.union(
  v.literal("success"),
  v.literal("rate_limited"),
  v.literal("quota_exceeded"),
  v.literal("auth_error"),
  v.literal("client_error"),
  v.literal("server_error"),
  v.literal("timeout"),
  v.literal("unknown_error"),
);

const sharedArgs = {
  serviceKey: serviceKeyValidator,
  feature: v.string(),
  status: eventStatusValidator,
  durationMs: v.optional(v.number()),
  requestBytes: v.optional(v.number()),
  responseBytes: v.optional(v.number()),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  audioSeconds: v.optional(v.number()),
  errorCode: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  metadata: v.optional(v.any()),
};

export const log = internalMutation({
  args: {
    ...sharedArgs,
    userId: v.optional(v.id("users")),
  },
  returns: v.object({ eventId: v.id("serviceUsageEvents") }),
  handler: async (ctx, args) => {
    return await logServiceUsage(ctx, {
      ...args,
      serviceKey: args.serviceKey as ServiceKey,
      metadata: args.metadata as Record<string, unknown> | undefined,
    });
  },
});

/**
 * Public auth-gated logger for external callers (Next.js routes, etc.).
 *
 * Requires a signed-in caller. The caller's Convex `users._id` is resolved
 * server-side from the Clerk identity and used as `userId` — clients cannot
 * attribute usage to another user. Soft-fails (returns `{skipped:true}`) if
 * the caller isn't linked to a `users` row, so logging never breaks the
 * calling route.
 */
export const logFromClient = mutation({
  args: sharedArgs,
  returns: v.union(
    v.object({ eventId: v.id("serviceUsageEvents"), skipped: v.literal(false) }),
    v.object({ skipped: v.literal(true), reason: v.string() }),
  ),
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrNull(ctx);
    if (!user) {
      return { skipped: true as const, reason: "unauthenticated" };
    }
    const { eventId } = await logServiceUsage(ctx, {
      ...args,
      serviceKey: args.serviceKey as ServiceKey,
      metadata: args.metadata as Record<string, unknown> | undefined,
      userId: user._id,
    });
    return { eventId, skipped: false as const };
  },
});
