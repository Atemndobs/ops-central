import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser, requireRole } from "../lib/auth";
import { normalizeRoomName } from "../lib/rooms";

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
    photoIds: v.optional(v.array(v.id("photos"))),
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

    const normalizedRoomName = normalizeRoomName(property, args.roomName);
    const roomName = normalizedRoomName || undefined;

    const now = Date.now();
    const title =
      args.title?.trim() ||
      [
        args.incidentType.replace("_", " "),
        roomName ? `(${roomName})` : undefined,
      ]
        .filter(Boolean)
        .join(" ");
    const mergedPhotoIds = [
      ...new Set([
        ...(args.photoStorageIds ?? []).map((id) => id as string),
        ...(args.photoIds ?? []).map((id) => id as string),
      ]),
    ];

    const incidentId = await ctx.db.insert("incidents", {
      cleaningJobId: args.cleaningJobId,
      propertyId: args.propertyId,
      reportedBy: user._id,
      incidentType: args.incidentType,
      severity: args.severity,
      title,
      description: args.description,
      roomName,
      inventoryItemId: args.inventoryItemId,
      quantityMissing: args.quantityMissing,
      photoIds: mergedPhotoIds,
      customItemDescription: args.customItemDescription,
      incidentContext: args.incidentContext,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });

    return incidentId;
  },
});

export const updateIncidentStatus = mutation({
  args: {
    incidentId: v.id("incidents"),
    status: v.union(
      v.literal("open"),
      v.literal("in_progress"),
      v.literal("resolved"),
      v.literal("wont_fix"),
    ),
    resolutionNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["admin", "property_ops", "manager"]);

    const incident = await ctx.db.get(args.incidentId);
    if (!incident) {
      throw new Error("Incident not found");
    }

    const now = Date.now();
    const isTerminal = args.status === "resolved" || args.status === "wont_fix";
    const wasTerminal =
      incident.status === "resolved" || incident.status === "wont_fix";

    const patch: Record<string, unknown> = {
      status: args.status,
      updatedAt: now,
    };

    if (args.resolutionNotes !== undefined) {
      patch.resolutionNotes = args.resolutionNotes.trim() || undefined;
    }

    if (isTerminal) {
      patch.resolvedAt = incident.resolvedAt ?? now;
      patch.resolvedBy = incident.resolvedBy ?? user._id;
    } else if (wasTerminal) {
      patch.resolvedAt = undefined;
      patch.resolvedBy = undefined;
    }

    await ctx.db.patch(args.incidentId, patch);
    return args.incidentId;
  },
});
