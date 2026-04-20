import { v } from "convex/values";
import { internalQuery } from "../_generated/server";

export const exportKnowledgeSnapshot = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit =
      typeof args.limit === "number" && Number.isFinite(args.limit)
        ? Math.max(1, Math.min(500, Math.floor(args.limit)))
        : 100;

    const properties = (await ctx.db.query("properties").take(limit)).filter((property) =>
      property.isActive,
    );

    const items: Array<{
      kind: string;
      externalId: string;
      summary: string;
      notes?: string;
    }> = [];

    for (const property of properties) {
      const stays = await ctx.db
        .query("stays")
        .withIndex("by_property", (q) => q.eq("propertyId", property._id))
        .order("desc")
        .take(5);

      const jobs = await ctx.db
        .query("cleaningJobs")
        .withIndex("by_property", (q) => q.eq("propertyId", property._id))
        .order("desc")
        .take(10);

      const openJobs = jobs.filter(
        (job) => job.status !== "completed" && job.status !== "cancelled",
      ).length;

      items.push({
        kind: "property_knowledge",
        externalId: property.hospitableId ?? String(property._id),
        summary: property.name,
        notes: [
          property.address,
          `stays_recent=${stays.length}`,
          `jobs_open=${openJobs}`,
          property.city ? `city=${property.city}` : undefined,
        ]
          .filter((value): value is string => Boolean(value))
          .join(" | "),
      });
    }

    return {
      source: "combined" as const,
      generatedAt: new Date(now).toISOString(),
      items,
    };
  },
});

export const exportProperties = internalQuery({
  args: {
    since: v.optional(v.number()),
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const includeInactive = args.includeInactive ?? true;
    const since = args.since ?? 0;

    const all = await ctx.db.query("properties").collect();

    const filtered = all.filter((p) => {
      if (!includeInactive && !p.isActive) return false;
      const ts = p.updatedAt ?? p.createdAt;
      return ts >= since;
    });

    return {
      generatedAt: Date.now(),
      since,
      count: filtered.length,
      properties: filtered.map((p) => ({
        convexId: p._id,
        hospitableId: p.hospitableId ?? null,
        name: p.name,
        address: p.address,
        city: p.city ?? null,
        state: p.state ?? null,
        zipCode: p.zipCode ?? null,
        country: p.country ?? null,
        timezone: p.timezone ?? null,
        currency: p.currency ?? null,
        imageUrl: p.imageUrl ?? null,
        bedrooms: p.bedrooms ?? null,
        bathrooms: p.bathrooms ?? null,
        rooms: p.rooms ?? [],
        isActive: p.isActive,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt ?? p.createdAt,
      })),
    };
  },
});
