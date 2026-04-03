import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { getCurrentUser } from "../lib/auth";
import type { Doc } from "../_generated/dataModel";

function requirePrivilegedRole(user: Doc<"users">) {
  if (
    user.role !== "admin" &&
    user.role !== "property_ops" &&
    user.role !== "manager"
  ) {
    throw new ConvexError("Only privileged users can manage property checkpoints.");
  }
}

function normalizeSortOrder(value: number | undefined, fallback: number) {
  if (value === undefined || Number.isNaN(value) || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

export const create = mutation({
  args: {
    propertyId: v.id("properties"),
    roomName: v.string(),
    title: v.string(),
    instruction: v.optional(v.string()),
    referenceStorageId: v.optional(v.id("_storage")),
    referenceImageUrl: v.optional(v.string()),
    linkedInventoryItemId: v.optional(v.id("inventoryItems")),
    isRequired: v.optional(v.boolean()),
    isActive: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    requirePrivilegedRole(user);

    const property = await ctx.db.get(args.propertyId);
    if (!property) {
      throw new ConvexError("Property not found.");
    }

    if (args.linkedInventoryItemId) {
      const item = await ctx.db.get(args.linkedInventoryItemId);
      if (!item || item.propertyId !== args.propertyId) {
        throw new ConvexError("Linked inventory item must belong to the same property.");
      }
    }

    const now = Date.now();
    return await ctx.db.insert("propertyCriticalCheckpoints", {
      propertyId: args.propertyId,
      roomName: args.roomName.trim(),
      title: args.title.trim(),
      instruction: args.instruction?.trim(),
      referenceStorageId: args.referenceStorageId,
      referenceImageUrl: args.referenceImageUrl?.trim(),
      linkedInventoryItemId: args.linkedInventoryItemId,
      isRequired: args.isRequired ?? true,
      isActive: args.isActive ?? true,
      sortOrder: normalizeSortOrder(args.sortOrder, 100),
      createdBy: user._id,
      updatedBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    checkpointId: v.id("propertyCriticalCheckpoints"),
    roomName: v.optional(v.string()),
    title: v.optional(v.string()),
    instruction: v.optional(v.string()),
    referenceStorageId: v.optional(v.id("_storage")),
    referenceImageUrl: v.optional(v.string()),
    linkedInventoryItemId: v.optional(v.id("inventoryItems")),
    isRequired: v.optional(v.boolean()),
    isActive: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    requirePrivilegedRole(user);

    const checkpoint = await ctx.db.get(args.checkpointId);
    if (!checkpoint) {
      throw new ConvexError("Checkpoint not found.");
    }

    if (args.linkedInventoryItemId) {
      const item = await ctx.db.get(args.linkedInventoryItemId);
      if (!item || item.propertyId !== checkpoint.propertyId) {
        throw new ConvexError("Linked inventory item must belong to the same property.");
      }
    }

    await ctx.db.patch(args.checkpointId, {
      roomName: args.roomName?.trim(),
      title: args.title?.trim(),
      instruction: args.instruction?.trim(),
      referenceStorageId: args.referenceStorageId,
      referenceImageUrl: args.referenceImageUrl?.trim(),
      linkedInventoryItemId: args.linkedInventoryItemId,
      isRequired: args.isRequired,
      isActive: args.isActive,
      sortOrder:
        typeof args.sortOrder === "number"
          ? Math.max(0, Math.floor(args.sortOrder))
          : undefined,
      updatedBy: user._id,
      updatedAt: Date.now(),
    });

    return args.checkpointId;
  },
});

export const remove = mutation({
  args: {
    checkpointId: v.id("propertyCriticalCheckpoints"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    requirePrivilegedRole(user);

    const checkpoint = await ctx.db.get(args.checkpointId);
    if (!checkpoint) {
      throw new ConvexError("Checkpoint not found.");
    }

    await ctx.db.delete(args.checkpointId);
    return { ok: true };
  },
});

export const setActive = mutation({
  args: {
    checkpointId: v.id("propertyCriticalCheckpoints"),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    requirePrivilegedRole(user);

    const checkpoint = await ctx.db.get(args.checkpointId);
    if (!checkpoint) {
      throw new ConvexError("Checkpoint not found.");
    }

    await ctx.db.patch(args.checkpointId, {
      isActive: args.isActive,
      updatedBy: user._id,
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});

export const upsertMany = mutation({
  args: {
    propertyId: v.id("properties"),
    checkpoints: v.array(
      v.object({
        checkpointId: v.optional(v.id("propertyCriticalCheckpoints")),
        roomName: v.string(),
        title: v.string(),
        instruction: v.optional(v.string()),
        referenceStorageId: v.optional(v.id("_storage")),
        referenceImageUrl: v.optional(v.string()),
        linkedInventoryItemId: v.optional(v.id("inventoryItems")),
        isRequired: v.optional(v.boolean()),
        isActive: v.optional(v.boolean()),
        sortOrder: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    requirePrivilegedRole(user);

    const property = await ctx.db.get(args.propertyId);
    if (!property) {
      throw new ConvexError("Property not found.");
    }

    const now = Date.now();
    const upsertedIds = await Promise.all(
      args.checkpoints.map(async (checkpoint, index) => {
        if (checkpoint.linkedInventoryItemId) {
          const item = await ctx.db.get(checkpoint.linkedInventoryItemId);
          if (!item || item.propertyId !== args.propertyId) {
            throw new ConvexError("Linked inventory item must belong to the same property.");
          }
        }

        if (checkpoint.checkpointId) {
          const existing = await ctx.db.get(checkpoint.checkpointId);
          if (!existing || existing.propertyId !== args.propertyId) {
            throw new ConvexError("Checkpoint does not belong to this property.");
          }

          await ctx.db.patch(checkpoint.checkpointId, {
            roomName: checkpoint.roomName.trim(),
            title: checkpoint.title.trim(),
            instruction: checkpoint.instruction?.trim(),
            referenceStorageId: checkpoint.referenceStorageId,
            referenceImageUrl: checkpoint.referenceImageUrl?.trim(),
            linkedInventoryItemId: checkpoint.linkedInventoryItemId,
            isRequired: checkpoint.isRequired ?? true,
            isActive: checkpoint.isActive ?? true,
            sortOrder: Math.max(
              0,
              Math.floor(checkpoint.sortOrder ?? (index + 1) * 10),
            ),
            updatedBy: user._id,
            updatedAt: now,
          });
          return checkpoint.checkpointId;
        }

        return await ctx.db.insert("propertyCriticalCheckpoints", {
          propertyId: args.propertyId,
          roomName: checkpoint.roomName.trim(),
          title: checkpoint.title.trim(),
          instruction: checkpoint.instruction?.trim(),
          referenceStorageId: checkpoint.referenceStorageId,
          referenceImageUrl: checkpoint.referenceImageUrl?.trim(),
          linkedInventoryItemId: checkpoint.linkedInventoryItemId,
          isRequired: checkpoint.isRequired ?? true,
          isActive: checkpoint.isActive ?? true,
          sortOrder: Math.max(
            0,
            Math.floor(checkpoint.sortOrder ?? (index + 1) * 10),
          ),
          createdBy: user._id,
          updatedBy: user._id,
          createdAt: now,
          updatedAt: now,
        });
      }),
    );

    return { checkpointIds: upsertedIds };
  },
});
