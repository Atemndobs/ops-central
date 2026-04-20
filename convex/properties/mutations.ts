import { mutation } from "../_generated/server";
import { ConvexError, v } from "convex/values";

export const create = mutation({
  args: {
    name: v.string(),
    address: v.string(),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    zipCode: v.optional(v.string()),
    country: v.optional(v.string()),
    timezone: v.optional(v.string()),
    propertyType: v.optional(v.string()),
    bedrooms: v.optional(v.number()),
    bathrooms: v.optional(v.number()),
    squareFeet: v.optional(v.number()),
    hospitableId: v.optional(v.string()),
    airbnbUrl: v.optional(v.string()),
    vrboUrl: v.optional(v.string()),
    directBookingUrl: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    accessNotes: v.optional(v.string()),
    keyLocation: v.optional(v.string()),
    parkingNotes: v.optional(v.string()),
    urgentNotes: v.optional(v.string()),
    currency: v.optional(v.string()),
    amenities: v.optional(v.array(v.string())),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    try {
      const timestamp = Date.now();
      const name = args.name.trim();
      const address = args.address.trim();

      if (!name || !address) {
        throw new ConvexError("Name and address are required.");
      }

      if (
        args.bedrooms !== undefined &&
        (args.bedrooms < 0 || !Number.isFinite(args.bedrooms))
      ) {
        throw new ConvexError("Bedrooms must be a non-negative number.");
      }

      if (
        args.bathrooms !== undefined &&
        (args.bathrooms < 0 || !Number.isFinite(args.bathrooms))
      ) {
        throw new ConvexError("Bathrooms must be a non-negative number.");
      }

      return await ctx.db.insert("properties", {
        name,
        address,
        city: args.city?.trim(),
        state: args.state?.trim(),
        zipCode: args.zipCode?.trim(),
        country: args.country?.trim(),
        timezone: args.timezone?.trim(),
        propertyType: args.propertyType?.trim(),
        bedrooms: args.bedrooms,
        bathrooms: args.bathrooms,
        squareFeet: args.squareFeet,
        hospitableId: args.hospitableId,
        airbnbUrl: args.airbnbUrl,
        vrboUrl: args.vrboUrl,
        directBookingUrl: args.directBookingUrl,
        imageUrl: args.imageUrl,
        accessNotes: args.accessNotes?.trim() || undefined,
        keyLocation: args.keyLocation?.trim() || undefined,
        parkingNotes: args.parkingNotes?.trim() || undefined,
        urgentNotes: args.urgentNotes?.trim() || undefined,
        currency: args.currency,
        amenities: args.amenities,
        metadata: args.metadata,
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    } catch (error) {
      if (error instanceof ConvexError) {
        throw error;
      }
      throw new ConvexError("Unable to create property right now.");
    }
  },
});

export const update = mutation({
  args: {
    id: v.id("properties"),
    name: v.optional(v.string()),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    zipCode: v.optional(v.string()),
    country: v.optional(v.string()),
    timezone: v.optional(v.string()),
    propertyType: v.optional(v.string()),
    bedrooms: v.optional(v.number()),
    bathrooms: v.optional(v.number()),
    squareFeet: v.optional(v.number()),
    hospitableId: v.optional(v.string()),
    airbnbUrl: v.optional(v.string()),
    vrboUrl: v.optional(v.string()),
    directBookingUrl: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    accessNotes: v.optional(v.string()),
    keyLocation: v.optional(v.string()),
    parkingNotes: v.optional(v.string()),
    urgentNotes: v.optional(v.string()),
    currency: v.optional(v.string()),
    amenities: v.optional(v.array(v.string())),
    metadata: v.optional(v.any()),
    isActive: v.optional(v.boolean()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      const existing = await ctx.db.get(args.id);

      if (!existing || !existing.isActive) {
        throw new ConvexError("Property not found.");
      }

      const { id, ...patch } = args;

      if (patch.name !== undefined && !patch.name.trim()) {
        throw new ConvexError("Name cannot be empty.");
      }

      if (patch.address !== undefined && !patch.address.trim()) {
        throw new ConvexError("Address cannot be empty.");
      }

      if (
        patch.bedrooms !== undefined &&
        (patch.bedrooms < 0 || !Number.isFinite(patch.bedrooms))
      ) {
        throw new ConvexError("Bedrooms must be a non-negative number.");
      }

      if (
        patch.bathrooms !== undefined &&
        (patch.bathrooms < 0 || !Number.isFinite(patch.bathrooms))
      ) {
        throw new ConvexError("Bathrooms must be a non-negative number.");
      }

      await ctx.db.patch(id, {
        ...patch,
        name: patch.name?.trim(),
        address: patch.address?.trim(),
        city: patch.city?.trim(),
        state: patch.state?.trim(),
        zipCode: patch.zipCode?.trim(),
        country: patch.country?.trim(),
        timezone: patch.timezone?.trim(),
        propertyType: patch.propertyType?.trim(),
        accessNotes:
          patch.accessNotes === undefined
            ? undefined
            : patch.accessNotes.trim() || undefined,
        keyLocation:
          patch.keyLocation === undefined
            ? undefined
            : patch.keyLocation.trim() || undefined,
        parkingNotes:
          patch.parkingNotes === undefined
            ? undefined
            : patch.parkingNotes.trim() || undefined,
        urgentNotes:
          patch.urgentNotes === undefined
            ? undefined
            : patch.urgentNotes.trim() || undefined,
        updatedAt: Date.now(),
      });

      return id;
    } catch (error) {
      if (error instanceof ConvexError) {
        throw error;
      }
      throw new ConvexError("Unable to update property right now.");
    }
  },
});

export const softDelete = mutation({
  args: {
    id: v.id("properties"),
  },
  handler: async (ctx, args) => {
    try {
      const existing = await ctx.db.get(args.id);

      if (!existing || !existing.isActive) {
        throw new ConvexError("Property not found.");
      }

      await ctx.db.patch(args.id, {
        isActive: false,
        updatedAt: Date.now(),
      });

      return args.id;
    } catch (error) {
      if (error instanceof ConvexError) {
        throw error;
      }
      throw new ConvexError("Unable to archive property right now.");
    }
  },
});
