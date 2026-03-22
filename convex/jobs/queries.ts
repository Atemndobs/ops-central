import { v } from "convex/values";
import { query } from "../_generated/server";

const jobStatusValidator = v.union(
  v.literal("scheduled"),
  v.literal("assigned"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("approved"),
  v.literal("cancelled"),
);

async function enrichJob(ctx: { db: any }, job: any) {
  const property = await ctx.db.get(job.propertyId);
  const cleaner = job.cleanerId ? await ctx.db.get(job.cleanerId) : null;

  return {
    ...job,
    property,
    cleaner,
  };
}

export const list = query({
  args: {
    status: v.optional(jobStatusValidator),
    propertyId: v.optional(v.id("properties")),
    cleanerId: v.optional(v.id("users")),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const source = args.status
      ? await ctx.db
          .query("jobs")
          .withIndex("by_status", (q) => q.eq("status", args.status!))
          .collect()
      : await ctx.db.query("jobs").collect();

    const filtered = source.filter((job) => {
      if (args.propertyId && job.propertyId !== args.propertyId) {
        return false;
      }
      if (args.cleanerId && job.cleanerId !== args.cleanerId) {
        return false;
      }
      return true;
    });

    const enriched = await Promise.all(filtered.map((job) => enrichJob(ctx, job)));
    const searchValue = args.search?.trim().toLowerCase();

    const bySearch = searchValue
      ? enriched.filter((job) => {
          const inId = String(job._id).toLowerCase().includes(searchValue);
          const inProperty = (job.property?.name ?? "")
            .toLowerCase()
            .includes(searchValue);
          const inCleaner = (job.cleaner?.name ?? "")
            .toLowerCase()
            .includes(searchValue);
          const inTitle = (job.title ?? "").toLowerCase().includes(searchValue);
          return inId || inProperty || inCleaner || inTitle;
        })
      : enriched;

    return bySearch.sort((a, b) => b.scheduledFor - a.scheduledFor);
  },
});

export const getById = query({
  args: {
    id: v.id("jobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.id);
    if (!job) {
      return null;
    }

    return enrichJob(ctx, job);
  },
});

export const getByProperty = query({
  args: {
    propertyId: v.id("properties"),
  },
  handler: async (ctx, args) => {
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();

    const enriched = await Promise.all(jobs.map((job) => enrichJob(ctx, job)));
    return enriched.sort((a, b) => b.scheduledFor - a.scheduledFor);
  },
});

export const getByCleaner = query({
  args: {
    cleanerId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_cleaner", (q) => q.eq("cleanerId", args.cleanerId))
      .collect();

    const enriched = await Promise.all(jobs.map((job) => enrichJob(ctx, job)));
    return enriched.sort((a, b) => b.scheduledFor - a.scheduledFor);
  },
});
