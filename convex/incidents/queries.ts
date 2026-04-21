import { v } from "convex/values";
import { query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { getCurrentUser, requireRole } from "../lib/auth";
import { resolvePhotoAccessUrl } from "../lib/photoUrls";

type IncidentDoc = Doc<"incidents">;

async function getFirstPhotoUrl(
  ctx: QueryCtx,
  photoIds: IncidentDoc["photoIds"],
): Promise<string | null> {
  const firstId = photoIds[0];
  if (!firstId) return null;
  return resolvePhotoIdToUrl(ctx, firstId);
}

async function resolvePhotoIdToUrl(
  ctx: QueryCtx,
  rawId: string,
): Promise<string | null> {
  // photoIds may contain either a `photos` table ID or a raw `_storage` ID.
  // normalizeId returns null when the string isn't a valid ID for the given
  // user table, so we can safely fall through to storage without triggering
  // the "System tables can only be accessed with db.system" error.
  const photoTableId = ctx.db.normalizeId("photos", rawId);
  if (photoTableId) {
    const photoDoc = await ctx.db.get(photoTableId);
    if (photoDoc && "storageId" in photoDoc) {
      return resolvePhotoAccessUrl(ctx, photoDoc);
    }
  }
  return ctx.storage.getUrl(rawId as Id<"_storage">);
}

const incidentStatusValidator = v.union(
  v.literal("open"),
  v.literal("in_progress"),
  v.literal("resolved"),
  v.literal("wont_fix"),
);

const incidentSeverityValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("critical"),
);

export const getIncidentsForJob = query({
  args: {
    jobId: v.id("cleaningJobs"),
  },
  handler: async (ctx, args) => {
    await getCurrentUser(ctx);

    const incidents = await ctx.db
      .query("incidents")
      .withIndex("by_job", (q) => q.eq("cleaningJobId", args.jobId))
      .collect();

    const results = await Promise.all(
      incidents.map(async (incident) => {
        const photoUrls: Array<{ id: string; url: string | null }> = [];

        for (const photoId of incident.photoIds) {
          const url = await resolvePhotoIdToUrl(ctx, photoId);
          photoUrls.push({ id: photoId, url });
        }

        const reporter = incident.reportedBy
          ? await ctx.db.get(incident.reportedBy)
          : null;

        return {
          _id: incident._id,
          title: incident.title,
          description: incident.description,
          incidentType: incident.incidentType,
          severity: incident.severity,
          roomName: incident.roomName,
          status: incident.status,
          createdAt: incident.createdAt,
          resolvedAt: incident.resolvedAt,
          resolutionNotes: incident.resolutionNotes,
          reporter: reporter
            ? { _id: reporter._id, name: reporter.name, email: reporter.email }
            : null,
          photos: photoUrls,
        };
      }),
    );

    return results.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const listIncidents = query({
  args: {
    status: v.optional(incidentStatusValidator),
    severity: v.optional(incidentSeverityValidator),
    propertyId: v.optional(v.id("properties")),
    reporterId: v.optional(v.id("users")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "property_ops", "manager"]);

    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);

    let incidents: IncidentDoc[];
    if (args.propertyId) {
      incidents = await ctx.db
        .query("incidents")
        .withIndex("by_property_and_created_at", (q) =>
          q.eq("propertyId", args.propertyId!),
        )
        .order("desc")
        .take(limit * 4);
    } else if (args.status) {
      incidents = await ctx.db
        .query("incidents")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .take(limit * 4);
    } else {
      incidents = await ctx.db
        .query("incidents")
        .withIndex("by_created_at")
        .order("desc")
        .take(limit * 4);
    }

    const filtered = incidents
      .filter((i) => (args.status ? i.status === args.status : true))
      .filter((i) => (args.severity ? i.severity === args.severity : true))
      .filter((i) => (args.reporterId ? i.reportedBy === args.reporterId : true))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);

    return Promise.all(
      filtered.map(async (incident) => {
        const [property, reporter, firstPhotoUrl] = await Promise.all([
          ctx.db.get(incident.propertyId),
          incident.reportedBy ? ctx.db.get(incident.reportedBy) : null,
          getFirstPhotoUrl(ctx, incident.photoIds),
        ]);

        return {
          _id: incident._id,
          title: incident.title,
          incidentType: incident.incidentType,
          severity: incident.severity,
          status: incident.status,
          roomName: incident.roomName,
          createdAt: incident.createdAt,
          resolvedAt: incident.resolvedAt,
          cleaningJobId: incident.cleaningJobId,
          property: property ? { _id: property._id, name: property.name } : null,
          reporter: reporter
            ? { _id: reporter._id, name: reporter.name, email: reporter.email }
            : null,
          firstPhotoUrl,
        };
      }),
    );
  },
});

export const getIncidentById = query({
  args: { incidentId: v.id("incidents") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const incident = await ctx.db.get(args.incidentId);
    if (!incident) return null;

    const canViewAll =
      user.role === "admin" ||
      user.role === "property_ops" ||
      user.role === "manager";
    const isReporter = incident.reportedBy === user._id;
    if (!canViewAll && !isReporter) {
      throw new Error("Not authorized to view this incident");
    }

    const [property, reporter, resolver] = await Promise.all([
      ctx.db.get(incident.propertyId),
      incident.reportedBy ? ctx.db.get(incident.reportedBy) : null,
      incident.resolvedBy ? ctx.db.get(incident.resolvedBy) : null,
    ]);

    const photoUrls: Array<{ id: string; url: string | null }> = [];
    for (const photoId of incident.photoIds) {
      const url = await resolvePhotoIdToUrl(ctx, photoId);
      photoUrls.push({ id: photoId, url });
    }

    return {
      _id: incident._id,
      title: incident.title,
      description: incident.description,
      incidentType: incident.incidentType,
      severity: incident.severity,
      status: incident.status,
      roomName: incident.roomName,
      customItemDescription: incident.customItemDescription,
      incidentContext: incident.incidentContext,
      quantityMissing: incident.quantityMissing,
      inventoryItemId: incident.inventoryItemId,
      cleaningJobId: incident.cleaningJobId,
      createdAt: incident.createdAt,
      updatedAt: incident.updatedAt,
      resolvedAt: incident.resolvedAt,
      resolutionNotes: incident.resolutionNotes,
      property: property ? { _id: property._id, name: property.name } : null,
      reporter: reporter
        ? { _id: reporter._id, name: reporter.name, email: reporter.email }
        : null,
      resolver: resolver
        ? { _id: resolver._id, name: resolver.name, email: resolver.email }
        : null,
      photos: photoUrls,
      canResolve: canViewAll,
    };
  },
});

export const listMyIncidents = query({
  args: {
    limit: v.optional(v.number()),
    status: v.optional(incidentStatusValidator),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);

    const incidents = await ctx.db
      .query("incidents")
      .withIndex("by_reporter_and_created_at", (q) =>
        q.eq("reportedBy", user._id),
      )
      .order("desc")
      .take(limit * 2);

    const filtered = incidents
      .filter((i) => (args.status ? i.status === args.status : true))
      .slice(0, limit);

    return Promise.all(
      filtered.map(async (incident) => {
        const [property, firstPhotoUrl] = await Promise.all([
          ctx.db.get(incident.propertyId),
          getFirstPhotoUrl(ctx, incident.photoIds),
        ]);

        return {
          _id: incident._id,
          title: incident.title,
          incidentType: incident.incidentType,
          severity: incident.severity,
          status: incident.status,
          roomName: incident.roomName,
          createdAt: incident.createdAt,
          resolvedAt: incident.resolvedAt,
          resolutionNotes: incident.resolutionNotes,
          cleaningJobId: incident.cleaningJobId,
          property: property ? { _id: property._id, name: property.name } : null,
          firstPhotoUrl,
        };
      }),
    );
  },
});
