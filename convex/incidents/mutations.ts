import { internalMutation, mutation } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { getCurrentUser, requireRole } from "../lib/auth";
import { resolvePhotoAccessUrl } from "../lib/photoUrls";
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


/**
 * One-shot cleanup: delete incidents whose photoIds array is non-empty but
 * NONE of the referenced photos resolve (either missing `photos` table doc
 * OR invalid `_storage` shape). Leaves alone incidents that legitimately
 * have no photos (suggestion/guest_issue) and any incident with at least
 * one valid photo.
 *
 * Invoke with:
 *   npx convex run --prod incidents/mutations:pruneIncidentsWithBrokenPhotos '{"dryRun":true}'
 *   npx convex run --prod incidents/mutations:pruneIncidentsWithBrokenPhotos '{"dryRun":false}'
 */
export const pruneIncidentsWithBrokenPhotos = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    includeEmpty: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const includeEmpty = args.includeEmpty ?? false;

    const all = await ctx.db.query("incidents").collect();

    const sampleDeletions: Array<{
      _id: Id<"incidents">;
      title: string;
      createdAt: number;
      photoCount: number;
    }> = [];
    let totalScanned = 0;
    let toDelete = 0;
    let skippedNoPhotos = 0;
    let skippedHasValid = 0;

    for (const incident of all) {
      totalScanned++;
      if (incident.photoIds.length === 0) {
        if (includeEmpty) {
          toDelete++;
          if (sampleDeletions.length < 20) {
            sampleDeletions.push({
              _id: incident._id,
              title: incident.title,
              createdAt: incident.createdAt,
              photoCount: 0,
            });
          }
          if (!dryRun) {
            await ctx.db.delete(incident._id);
          }
        } else {
          skippedNoPhotos++;
        }
        continue;
      }

      let hasValidPhoto = false;
      for (const rawId of incident.photoIds) {
        // A photo is "valid" only if the backing bytes actually exist.
        // ctx.storage.getUrl() just formats a URL without checking; so we
        // verify via ctx.db.system.get on _storage, or (for B2 photos)
        // by presence of provider/bucket/objectKey.
        const photoTableId = ctx.db.normalizeId("photos", rawId);
        if (photoTableId) {
          const photoDoc = await ctx.db.get(photoTableId);
          if (photoDoc) {
            if (photoDoc.storageId) {
              try {
                const systemDoc = await ctx.db.system.get(photoDoc.storageId);
                if (systemDoc) {
                  hasValidPhoto = true;
                  break;
                }
              } catch {
                // malformed storageId — treat as invalid
              }
            } else if (
              photoDoc.provider &&
              photoDoc.bucket &&
              photoDoc.objectKey
            ) {
              hasValidPhoto = true;
              break;
            }
          }
        } else {
          try {
            const systemDoc = await ctx.db.system.get(
              rawId as Id<"_storage">,
            );
            if (systemDoc) {
              hasValidPhoto = true;
              break;
            }
          } catch {
            // malformed storage ID — keep checking other photoIds
          }
        }
      }

      if (hasValidPhoto) {
        skippedHasValid++;
        continue;
      }

      toDelete++;
      if (sampleDeletions.length < 20) {
        sampleDeletions.push({
          _id: incident._id,
          title: incident.title,
          createdAt: incident.createdAt,
          photoCount: incident.photoIds.length,
        });
      }
      if (!dryRun) {
        await ctx.db.delete(incident._id);
      }
    }

    return {
      dryRun,
      totalScanned,
      toDelete,
      skippedNoPhotos,
      skippedHasValid,
      sampleDeletions,
    };
  },
});

/**
 * One-shot cleanup: delete incidents whose `title` matches any entry in the
 * supplied list (case-insensitive, exact match). Used to sweep specific
 * batches of test/duplicate data identified visually.
 *
 *   npx convex run incidents/mutations:deleteIncidentsByTitle \\
 *     '{"titles":["Nightstand table","Fixer"],"dryRun":true}'
 */
export const deleteIncidentsByTitle = internalMutation({
  args: {
    titles: v.array(v.string()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const wanted = new Set(args.titles.map((t) => t.trim().toLowerCase()));

    const all = await ctx.db.query("incidents").collect();
    const deletions: Array<{
      _id: Id<"incidents">;
      title: string;
      createdAt: number;
    }> = [];

    for (const incident of all) {
      const key = incident.title.trim().toLowerCase();
      if (!wanted.has(key)) continue;
      deletions.push({
        _id: incident._id,
        title: incident.title,
        createdAt: incident.createdAt,
      });
      if (!dryRun) {
        await ctx.db.delete(incident._id);
      }
    }

    return { dryRun, matched: deletions.length, deletions };
  },
});

/**
 * One-shot data-hygiene: replace the literal "cleaner.incident" i18n-key
 * string (which leaked into roomName from a bug in the active-job composer)
 * with a sensible label. Scans both photos.roomName and incidents.roomName.
 *
 *   npx convex run incidents/mutations:renameCleanerIncidentRoomName \
 *     '{"dryRun":true}'
 */
export const renameCleanerIncidentRoomName = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    replacement: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const replacement = (args.replacement ?? "Incident").trim() || "Incident";
    const BAD = "cleaner.incident";

    const photos = await ctx.db.query("photos").collect();
    let photosTouched = 0;
    for (const photo of photos) {
      if (photo.roomName === BAD) {
        photosTouched++;
        if (!dryRun) {
          await ctx.db.patch(photo._id, { roomName: replacement });
        }
      }
    }

    const incidents = await ctx.db.query("incidents").collect();
    let incidentsTouched = 0;
    for (const incident of incidents) {
      if (incident.roomName === BAD) {
        incidentsTouched++;
        if (!dryRun) {
          await ctx.db.patch(incident._id, { roomName: replacement });
        }
      }
    }

    return { dryRun, replacement, photosTouched, incidentsTouched };
  },
});
