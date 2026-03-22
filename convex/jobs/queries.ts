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

type EnrichableJob = {
  _id: string;
  propertyId: string;
  cleanerId?: string;
  title: string;
  scheduledFor: number;
  [key: string]: unknown;
};

type RelatedEntity = {
  _id: string;
  name?: string;
  email?: string;
  address?: string;
};

async function enrichJobs(
  ctx: unknown,
  jobs: EnrichableJob[],
) {
  const db = (ctx as { db: { get: (id: unknown) => Promise<RelatedEntity | null> } }).db;
  const propertyIds = [...new Set(jobs.map((job) => job.propertyId))];

  const properties = await Promise.all(propertyIds.map((propertyId) => db.get(propertyId)));
  const cleaners = await Promise.all(
    jobs.map((job) => (job.cleanerId ? db.get(job.cleanerId) : null)),
  );

  const propertyById = new Map(
    properties.filter(Boolean).map((property) => [property!._id, property!]),
  );
  const cleanerById = new Map(
    cleaners.filter(Boolean).map((cleaner) => [cleaner!._id, cleaner!]),
  );

  return jobs.map((job) => ({
    ...job,
    property: propertyById.get(job.propertyId) ?? null,
    cleaner: job.cleanerId ? cleanerById.get(job.cleanerId) ?? null : null,
  }));
}

export const list = query({
  args: {
    status: v.optional(jobStatusValidator),
    propertyId: v.optional(v.id("properties")),
    cleanerId: v.optional(v.id("users")),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let source;
    if (args.status) {
      source = await ctx.db
        .query("jobs")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
    } else if (args.propertyId && !args.cleanerId) {
      source = await ctx.db
        .query("jobs")
        .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId!))
        .collect();
    } else if (args.cleanerId && !args.propertyId) {
      source = await ctx.db
        .query("jobs")
        .withIndex("by_cleaner", (q) => q.eq("cleanerId", args.cleanerId!))
        .collect();
    } else {
      source = await ctx.db.query("jobs").collect();
    }

    const filtered = source.filter((job) => {
      if (args.propertyId && job.propertyId !== args.propertyId) {
        return false;
      }
      if (args.cleanerId && job.cleanerId !== args.cleanerId) {
        return false;
      }
      return true;
    });

    const enriched = await enrichJobs(ctx, filtered);
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

    const [enriched] = await enrichJobs(ctx, [job]);
    return enriched;
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

    const enriched = await enrichJobs(ctx, jobs);
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

    const enriched = await enrichJobs(ctx, jobs);
    return enriched.sort((a, b) => b.scheduledFor - a.scheduledFor);
  },
});

export const listCleanerOptions = query({
  args: {},
  handler: async (ctx) => {
    const cleaners = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "cleaner"))
      .collect();

    return cleaners
      .map((cleaner) => ({
        id: cleaner._id,
        name:
          cleaner.name?.trim() ||
          cleaner.email?.split("@")[0] ||
          `Cleaner ${String(cleaner._id).slice(-6)}`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});
