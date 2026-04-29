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
  // Walk through photoIds until we find one that resolves to a URL. Avoids
  // "broken thumbnail" when photoIds[0] is stale/corrupt but later indices
  // point at valid photos.
  for (const rawId of photoIds) {
    const url = await resolvePhotoIdToUrl(ctx, rawId);
    if (url) return url;
  }
  return null;
}

async function resolvePhotoIdToUrl(
  ctx: QueryCtx,
  rawId: string,
): Promise<string | null> {
  // photoIds may contain either a `photos` table ID, a raw `_storage` ID, or
  // (from legacy/orphaned data) an ID that no longer matches any known table.
  //
  // ctx.db.get() throws for system-table IDs ("System tables can only be
  // accessed with db.system") and ctx.storage.getUrl() throws for IDs that
  // belong to a non-storage user table ("Invalid storage ID"). We use
  // normalizeId to safely probe `photos` first, then try storage with a
  // defensive try/catch so a single bad reference doesn't blow up the list.
  const photoTableId = ctx.db.normalizeId("photos", rawId);
  if (photoTableId) {
    const photoDoc = await ctx.db.get(photoTableId);
    if (photoDoc) {
      // resolvePhotoAccessUrl handles BOTH storage paths: Convex _storage
      // (legacy, via photo.storageId) and B2 (primary, via
      // photo.provider/bucket/objectKey). The earlier `"storageId" in photoDoc`
      // check was wrong — for B2-only photos the key is absent from the doc,
      // so the check skipped the resolver and we silently lost B2 thumbnails.
      return resolvePhotoAccessUrl(ctx, photoDoc);
    }
  }
  try {
    return await ctx.storage.getUrl(rawId as Id<"_storage">);
  } catch {
    return null;
  }
}

/**
 * Phase 3 of video-support — richer variant of `resolvePhotoIdToUrl` that
 * also returns the poster URL and the kind/duration/dimensions for video
 * rows. The web admin uses this to decide whether to render `<img>` or
 * `<video>` per attachment in the incident detail drawer.
 *
 * For legacy `_storage` IDs (no canonical `photos` row), every value
 * except `url` returns null/"image" — the caller treats those as images.
 */
async function resolvePhotoIdToMedia(
  ctx: QueryCtx,
  rawId: string,
): Promise<{
  url: string | null;
  posterUrl: string | null;
  mediaKind: "image" | "video";
  durationMs: number | undefined;
  width: number | undefined;
  height: number | undefined;
}> {
  const photoTableId = ctx.db.normalizeId("photos", rawId);
  if (photoTableId) {
    const photoDoc = await ctx.db.get(photoTableId);
    if (photoDoc) {
      const mediaKind = (photoDoc.mediaKind ?? "image") as "image" | "video";
      const [url, posterUrl] = await Promise.all([
        resolvePhotoAccessUrl(ctx, photoDoc),
        mediaKind === "video"
          ? resolvePhotoAccessUrl(ctx, photoDoc, "poster")
          : Promise.resolve(null),
      ]);
      return {
        url,
        posterUrl,
        mediaKind,
        durationMs: photoDoc.durationMs,
        width: photoDoc.width,
        height: photoDoc.height,
      };
    }
  }
  // Legacy `_storage` ID — image only, no poster, no metadata.
  let url: string | null = null;
  try {
    url = await ctx.storage.getUrl(rawId as Id<"_storage">);
  } catch {
    url = null;
  }
  return {
    url,
    posterUrl: null,
    mediaKind: "image",
    durationMs: undefined,
    width: undefined,
    height: undefined,
  };
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
        // Phase 3 of video-support: each photo row carries enough metadata
        // for the web admin to render `<img>` for images and `<video>` (with
        // poster) for video rows.
        const photoUrls: Array<{
          id: string;
          url: string | null;
          posterUrl: string | null;
          mediaKind: "image" | "video";
          durationMs?: number;
          width?: number;
          height?: number;
        }> = [];

        for (const photoId of incident.photoIds) {
          const media = await resolvePhotoIdToMedia(ctx, photoId);
          photoUrls.push({
            id: photoId,
            url: media.url,
            posterUrl: media.posterUrl,
            mediaKind: media.mediaKind,
            durationMs: media.durationMs,
            width: media.width,
            height: media.height,
          });
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

export const getOpenIncidentCounts = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin", "property_ops", "manager"]);

    const [openIncidents, inProgressIncidents, resolvedIncidents, wontFixIncidents] =
      await Promise.all([
        ctx.db
          .query("incidents")
          .withIndex("by_status", (q) => q.eq("status", "open"))
          .take(500),
        ctx.db
          .query("incidents")
          .withIndex("by_status", (q) => q.eq("status", "in_progress"))
          .take(500),
        ctx.db
          .query("incidents")
          .withIndex("by_status", (q) => q.eq("status", "resolved"))
          .take(500),
        ctx.db
          .query("incidents")
          .withIndex("by_status", (q) => q.eq("status", "wont_fix"))
          .take(500),
      ]);

    let critical = 0;
    let high = 0;
    for (const incident of openIncidents) {
      if (incident.severity === "critical") critical += 1;
      else if (incident.severity === "high") high += 1;
    }

    return {
      total:
        openIncidents.length +
        inProgressIncidents.length +
        resolvedIncidents.length +
        wontFixIncidents.length,
      open: openIncidents.length,
      inProgress: inProgressIncidents.length,
      resolved: resolvedIncidents.length,
      wontFix: wontFixIncidents.length,
      critical,
      high,
    };
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
          photoCount: incident.photoIds.length,
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

    // Phase 4a — return rich media metadata so cleaner / admin detail
    // pages can render `<img>` for images and `<video>`-style tiles for
    // videos.
    const photoUrls: Array<{
      id: string;
      url: string | null;
      posterUrl: string | null;
      mediaKind: "image" | "video";
      durationMs?: number;
      width?: number;
      height?: number;
    }> = [];
    for (const photoId of incident.photoIds) {
      const media = await resolvePhotoIdToMedia(ctx, photoId);
      photoUrls.push({
        id: photoId,
        url: media.url,
        posterUrl: media.posterUrl,
        mediaKind: media.mediaKind,
        durationMs: media.durationMs,
        width: media.width,
        height: media.height,
      });
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
      trelloCardId: incident.trelloCardId,
      trelloCardUrl: incident.trelloCardUrl,
      trelloSyncedAt: incident.trelloSyncedAt,
      trelloSyncError: incident.trelloSyncError,
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
