import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

async function resolvePropertyId(
  ctx: MutationCtx,
  entityId: string,
): Promise<Id<"properties"> | null> {
  // Try direct Convex document id first.
  try {
    const byId = await ctx.db.get(entityId as Id<"properties">);
    if (byId) {
      return byId._id;
    }
  } catch {
    // Not a valid Convex id shape; try alternate lookup.
  }

  const byHospitable = await ctx.db
    .query("properties")
    .withIndex("by_hospitable", (q) => q.eq("hospitableId", entityId))
    .first();

  return byHospitable?._id ?? null;
}

export const applyPropertyOverride = internalMutation({
  args: {
    entityId: v.string(),
    changes: v.any(),
    approvedBy: v.string(),
    approvedAt: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const propertyId = await resolvePropertyId(ctx, args.entityId);
    if (!propertyId) {
      throw new Error(`No property found for entityId ${args.entityId}`);
    }

    const property = await ctx.db.get(propertyId);
    if (!property) {
      throw new Error(`Property disappeared during override for ${args.entityId}`);
    }

    const previousMetadata =
      property.metadata && typeof property.metadata === "object" && !Array.isArray(property.metadata)
        ? (property.metadata as Record<string, unknown>)
        : {};

    const overrideHistory = Array.isArray(previousMetadata.overrideHistory)
      ? [...previousMetadata.overrideHistory]
      : [];

    overrideHistory.push({
      approvedBy: args.approvedBy,
      approvedAt: args.approvedAt,
      reason: args.reason,
      changes: args.changes,
      source: "integration_api",
      appliedAt: new Date().toISOString(),
    });

    const mergedMetadata = {
      ...previousMetadata,
      profileOverrides:
        previousMetadata.profileOverrides &&
        typeof previousMetadata.profileOverrides === "object" &&
        !Array.isArray(previousMetadata.profileOverrides)
          ? {
              ...(previousMetadata.profileOverrides as Record<string, unknown>),
              ...(args.changes as Record<string, unknown>),
            }
          : (args.changes as Record<string, unknown>),
      overrideHistory,
    };

    await ctx.db.patch(propertyId, {
      metadata: mergedMetadata,
      updatedAt: Date.now(),
    });

    return {
      propertyId,
      applied: true,
      approvedBy: args.approvedBy,
      approvedAt: args.approvedAt,
    };
  },
});
