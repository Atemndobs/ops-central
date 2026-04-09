import { v } from "convex/values";
import { query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { getCurrentUser } from "../lib/auth";
import { resolvePhotoAccessUrl } from "../lib/photoUrls";

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
          // First try as a photos table ID
          const photoDoc = await ctx.db.get(photoId as Id<"photos">);
          if (photoDoc && "storageId" in photoDoc) {
            const url = await resolvePhotoAccessUrl(ctx, photoDoc);
            photoUrls.push({ id: photoId, url });
          } else {
            // Fall back to raw storage ID
            const url = await ctx.storage.getUrl(photoId as Id<"_storage">);
            photoUrls.push({ id: photoId, url });
          }
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
