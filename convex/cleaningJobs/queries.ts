import { v } from "convex/values";
import { query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

// ---------------------------------------------------------------------------
// Shared enrichment helper — preserves all document fields in return type
// ---------------------------------------------------------------------------

async function enrichJobs(
  ctx: QueryCtx,
  jobs: Doc<"cleaningJobs">[],
) {
  const uniquePropertyIds = [...new Set(jobs.map((j) => j.propertyId))];
  const uniqueCleanerIds = [
    ...new Set(jobs.flatMap((j) => j.assignedCleanerIds)),
  ];

  const [fetchedProperties, fetchedCleaners] = await Promise.all([
    Promise.all(uniquePropertyIds.map((id) => ctx.db.get(id))),
    Promise.all(uniqueCleanerIds.map((id) => ctx.db.get(id))),
  ]);

  const propertyById = new Map(
    fetchedProperties
      .filter(Boolean)
      .map((p) => [p!._id, { _id: p!._id, name: p!.name, address: p!.address }] as const),
  );

  const cleanerById = new Map(
    fetchedCleaners
      .filter(Boolean)
      .map((c) => [c!._id, { _id: c!._id, name: c!.name, email: c!.email }] as const),
  );

  return jobs.map((job) => ({
    ...job,
    property: propertyById.get(job.propertyId) ?? null,
    cleaners: job.assignedCleanerIds
      .map((id) => cleanerById.get(id) ?? null)
      .filter(Boolean),
  }));
}

// ---------------------------------------------------------------------------
// getAll — list cleaning jobs with optional status / propertyId filter
// ---------------------------------------------------------------------------

export const getAll = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("scheduled"),
        v.literal("assigned"),
        v.literal("in_progress"),
        v.literal("awaiting_approval"),
        v.literal("rework_required"),
        v.literal("completed"),
        v.literal("cancelled"),
      ),
    ),
    propertyId: v.optional(v.id("properties")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let jobs;

    if (args.status && args.propertyId) {
      jobs = await ctx.db
        .query("cleaningJobs")
        .withIndex("by_property_status", (q) =>
          q.eq("propertyId", args.propertyId!).eq("status", args.status!),
        )
        .collect();
    } else if (args.status) {
      jobs = await ctx.db
        .query("cleaningJobs")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
    } else if (args.propertyId) {
      jobs = await ctx.db
        .query("cleaningJobs")
        .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId!))
        .collect();
    } else {
      jobs = await ctx.db
        .query("cleaningJobs")
        .withIndex("by_scheduled")
        .collect();
    }

    const sorted = jobs.sort((a, b) => b.scheduledStartAt - a.scheduledStartAt);
    const limited = args.limit != null ? sorted.slice(0, args.limit) : sorted;

    return enrichJobs(ctx, limited);
  },
});

// ---------------------------------------------------------------------------
// getById — single cleaning job, enriched
// ---------------------------------------------------------------------------

export const getById = query({
  args: {
    jobId: v.id("cleaningJobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      return null;
    }
    const [enriched] = await enrichJobs(ctx, [job]);
    return enriched;
  },
});

// ---------------------------------------------------------------------------
// getForCleaner — all jobs where cleanerId is in assignedCleanerIds
// ---------------------------------------------------------------------------

export const getForCleaner = query({
  args: {
    cleanerId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // No direct index on the array field; collect all and filter in memory.
    const allJobs = await ctx.db.query("cleaningJobs").collect();
    const jobs = allJobs.filter((job) =>
      job.assignedCleanerIds.includes(args.cleanerId),
    );

    const enriched = await enrichJobs(ctx, jobs);
    return enriched.sort((a, b) => b.scheduledStartAt - a.scheduledStartAt);
  },
});
