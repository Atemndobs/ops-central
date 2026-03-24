import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    clerkId: v.optional(v.string()),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    role: v.optional(v.string()),
    status: v.optional(v.string()),
    pushToken: v.optional(v.string()),
    companyId: v.optional(v.id("users")),
    metadata: v.optional(v.any()),
    lastActiveAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_role", ["role"])
    .index("by_email", ["email"]),

  properties: defineTable({
    name: v.string(),
    address: v.string(),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    country: v.optional(v.string()),
    status: v.optional(v.union(
      v.literal("ready"),
      v.literal("dirty"),
      v.literal("in_progress"),
      v.literal("vacant"),
    )),
    propertyType: v.optional(v.string()),
    bedrooms: v.optional(v.number()),
    bathrooms: v.optional(v.number()),
    estimatedCleaningMinutes: v.optional(v.number()),
    accessNotes: v.optional(v.string()),
    tag: v.optional(v.string()),
    primaryPhotoUrl: v.optional(v.string()),
    photoUrls: v.optional(v.array(v.string())),
    assignedCleanerName: v.optional(v.string()),
    hospitableId: v.optional(v.string()),
    airbnbUrl: v.optional(v.string()),
    vrboUrl: v.optional(v.string()),
    bookingUrl: v.optional(v.string()),
    directUrl: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    picture: v.optional(v.string()),
    currency: v.optional(v.string()),
    timezone: v.optional(v.string()),
    amenities: v.optional(v.array(v.string())),
    public_name: v.optional(v.string()),
    property_type: v.optional(v.string()),
    room_type: v.optional(v.string()),
    summary: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    listed: v.optional(v.boolean()),
    listings: v.optional(v.any()),
    parent_child: v.optional(v.any()),
    room_details: v.optional(v.any()),
    ical_imports: v.optional(v.any()),
    house_rules: v.optional(v.any()),
    metadata: v.optional(v.any()),
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
    .index("by_nextCheckInAt", ["nextCheckInAt"])
    .index("by_updatedAt", ["updatedAt"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["status", "isActive"],
    }),

  jobs: defineTable({
    propertyId: v.id("properties"),
    cleanerId: v.optional(v.id("users")),
    title: v.string(),
    description: v.optional(v.string()),
    type: v.optional(v.string()),
    priority: v.optional(v.string()),
    notes: v.optional(v.string()),
    scheduledFor: v.number(),
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
    assignedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    approvedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    reservationId: v.optional(v.string()),
    source: v.optional(v.string()),
    metadata: v.optional(v.any()),
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
    .index("by_property_status", ["propertyId", "status"])
    .index("by_status_scheduled", ["status", "scheduledFor"]),
});
