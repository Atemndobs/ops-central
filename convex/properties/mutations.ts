import { mutationGeneric } from "convex/server";
import { v } from "convex/values";

const propertyStatusValidator = v.union(
  v.literal("ready"),
  v.literal("dirty"),
  v.literal("in_progress"),
  v.literal("vacant"),
);

export const create = mutationGeneric({
  args: {
    name: v.string(),
    address: v.string(),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    country: v.optional(v.string()),
    status: v.optional(propertyStatusValidator),
    propertyType: v.optional(v.string()),
    bedrooms: v.optional(v.number()),
    bathrooms: v.optional(v.number()),
    estimatedCleaningMinutes: v.optional(v.number()),
    accessNotes: v.optional(v.string()),
    tag: v.optional(v.string()),
    primaryPhotoUrl: v.optional(v.string()),
    photoUrls: v.optional(v.array(v.string())),
    assignedCleanerName: v.optional(v.string()),
    nextCheckInAt: v.optional(v.number()),
    nextCheckOutAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const timestamp = Date.now();

    return await ctx.db.insert("properties", {
      name: args.name.trim(),
      address: args.address.trim(),
      city: args.city?.trim(),
      state: args.state?.trim(),
      postalCode: args.postalCode?.trim(),
      country: args.country?.trim(),
      status: args.status ?? "vacant",
      propertyType: args.propertyType?.trim(),
      bedrooms: args.bedrooms,
      bathrooms: args.bathrooms,
      estimatedCleaningMinutes: args.estimatedCleaningMinutes,
      accessNotes: args.accessNotes?.trim(),
      tag: args.tag?.trim(),
      primaryPhotoUrl: args.primaryPhotoUrl,
      photoUrls: args.photoUrls,
      assignedCleanerName: args.assignedCleanerName?.trim(),
      nextCheckInAt: args.nextCheckInAt,
      nextCheckOutAt: args.nextCheckOutAt,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  },
});

export const update = mutationGeneric({
  args: {
    id: v.id("properties"),
    name: v.optional(v.string()),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    country: v.optional(v.string()),
    status: v.optional(propertyStatusValidator),
    propertyType: v.optional(v.string()),
    bedrooms: v.optional(v.number()),
    bathrooms: v.optional(v.number()),
    estimatedCleaningMinutes: v.optional(v.number()),
    accessNotes: v.optional(v.string()),
    tag: v.optional(v.string()),
    primaryPhotoUrl: v.optional(v.string()),
    photoUrls: v.optional(v.array(v.string())),
    assignedCleanerName: v.optional(v.string()),
    nextCheckInAt: v.optional(v.number()),
    nextCheckOutAt: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);

    if (!existing) {
      throw new Error("Property not found");
    }

    const { id, ...patch } = args;

    await ctx.db.patch(id, {
      ...patch,
      name: patch.name?.trim(),
      address: patch.address?.trim(),
      city: patch.city?.trim(),
      state: patch.state?.trim(),
      postalCode: patch.postalCode?.trim(),
      country: patch.country?.trim(),
      propertyType: patch.propertyType?.trim(),
      accessNotes: patch.accessNotes?.trim(),
      tag: patch.tag?.trim(),
      assignedCleanerName: patch.assignedCleanerName?.trim(),
      updatedAt: Date.now(),
    });

    return id;
  },
});

export const softDelete = mutationGeneric({
  args: {
    id: v.id("properties"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);

    if (!existing) {
      throw new Error("Property not found");
    }

    await ctx.db.patch(args.id, {
      isActive: false,
      deletedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return args.id;
  },
});
