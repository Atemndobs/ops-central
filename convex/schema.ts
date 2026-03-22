import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    role: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  }).index("by_role", ["role"]),

  properties: defineTable({
    name: v.string(),
    address: v.string(),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    country: v.optional(v.string()),
    status: v.union(
      v.literal("ready"),
      v.literal("dirty"),
      v.literal("in_progress"),
      v.literal("vacant"),
    ),
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
    isActive: v.boolean(),
    deletedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_name", ["name"])
    .index("by_status", ["status"])
    .index("by_isActive", ["isActive"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["status", "isActive"],
    }),

  jobs: defineTable({
    propertyId: v.id("properties"),
    cleanerId: v.optional(v.id("users")),
    title: v.string(),
    notes: v.optional(v.string()),
    scheduledFor: v.number(),
    status: v.union(
      v.literal("scheduled"),
      v.literal("assigned"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("approved"),
      v.literal("cancelled"),
    ),
    photos: v.optional(
      v.array(
        v.object({
          url: v.string(),
          caption: v.optional(v.string()),
          uploadedAt: v.number(),
        }),
      ),
    ),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_property", ["propertyId"])
    .index("by_cleaner", ["cleanerId"])
    .index("by_scheduled", ["scheduledFor"])
    .index("by_property_status", ["propertyId", "status"]),
});
