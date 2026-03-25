import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../lib/auth";

export const createIncident = mutation({
  args: {
    propertyId: v.id("properties"),
    cleaningJobId: v.optional(v.id("cleaningJobs")),
    incidentType: v.union(
      v.literal("missing_item"),
      v.literal("damaged_item"),
      v.literal("maintenance_needed"),
      v.literal("guest_issue"),
      v.literal("suggestion"),
      v.literal("other")
    ),
    severity: v.optional(
      v.union(
        v.literal("low"),
        v.literal("medium"),
        v.literal("high"),
        v.literal("critical")
      )
    ),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    roomName: v.optional(v.string()),
    inventoryItemId: v.optional(v.id("inventoryItems")),
    quantityMissing: v.optional(v.number()),
    photoStorageIds: v.optional(v.array(v.id("_storage"))),
    customItemDescription: v.optional(v.string()),
    incidentContext: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    const property = await ctx.db.get(args.propertyId);
    if (!property) {
      throw new Error("Property not found");
    }

    if (args.cleaningJobId) {
      const job = await ctx.db.get(args.cleaningJobId);
      if (!job) {
        throw new Error("Cleaning job not found");
      }
    }

    const now = Date.now();
    const title =
      args.title?.trim() ||
      [
        args.incidentType.replace("_", " "),
        args.roomName ? `(${args.roomName})` : undefined,
      ]
        .filter(Boolean)
        .join(" ");

    const incidentId = await ctx.db.insert("incidents", {
      cleaningJobId: args.cleaningJobId,
      propertyId: args.propertyId,
      reportedBy: user._id,
      incidentType: args.incidentType,
      severity: args.severity,
      title,
      description: args.description,
      roomName: args.roomName,
      inventoryItemId: args.inventoryItemId,
      quantityMissing: args.quantityMissing,
      photoIds: (args.photoStorageIds ?? []).map((id) => id as string),
      customItemDescription: args.customItemDescription,
      incidentContext: args.incidentContext,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });

    return incidentId;
  },
});
