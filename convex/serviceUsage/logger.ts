/**
 * Internal mutation wrapper around `logServiceUsage` so actions can persist
 * usage events via `ctx.runMutation(internal.serviceUsage.logger.log, ...)`.
 *
 * See convex/lib/serviceUsage.ts for the underlying helper and
 * Docs/usage-tracking/ADR.md §"Write Path" for the contract.
 */

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { logServiceUsage } from "../lib/serviceUsage";
import type { ServiceKey } from "../lib/serviceRegistry";

export const log = internalMutation({
  args: {
    serviceKey: v.union(
      v.literal("gemini"),
      v.literal("clerk"),
      v.literal("hospitable"),
      v.literal("resend"),
      v.literal("convex"),
    ),
    feature: v.string(),
    status: v.union(
      v.literal("success"),
      v.literal("rate_limited"),
      v.literal("quota_exceeded"),
      v.literal("auth_error"),
      v.literal("client_error"),
      v.literal("server_error"),
      v.literal("timeout"),
      v.literal("unknown_error"),
    ),
    userId: v.optional(v.id("users")),
    durationMs: v.optional(v.number()),
    requestBytes: v.optional(v.number()),
    responseBytes: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    audioSeconds: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    metadata: v.optional(v.any()),
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
