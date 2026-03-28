import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, mutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireRole } from "../lib/auth";
import { resolveTimeRange } from "./lib";

const presetValidator = v.union(
  v.literal("7d"),
  v.literal("30d"),
  v.literal("90d"),
  v.literal("custom"),
);

const formatValidator = v.union(
  v.literal("csv"),
  v.literal("xlsx"),
  v.literal("pdf"),
);

export const requestExport = mutation({
  args: {
    format: formatValidator,
    preset: v.optional(presetValidator),
    fromTs: v.optional(v.number()),
    toTs: v.optional(v.number()),
    propertyIds: v.optional(v.array(v.id("properties"))),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["admin", "property_ops", "manager"]);
    const range = resolveTimeRange({
      preset: args.preset,
      fromTs: args.fromTs,
      toTs: args.toTs,
    });

    const exportId = await ctx.db.insert("reportExports", {
      requestedBy: user._id,
      status: "queued",
      format: args.format,
      scope: {
        preset: range.preset,
        fromTs: range.fromTs,
        toTs: range.toTs,
        propertyIds: args.propertyIds ?? [],
      },
      createdAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.reports.actions.generateExport, {
      exportId,
    });

    return {
      exportId,
      status: "queued" as const,
    };
  },
});

export const markExportRunning = internalMutation({
  args: {
    exportId: v.id("reportExports"),
    startedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.exportId);
    if (!row || row.status !== "queued") {
      return;
    }

    await ctx.db.patch(args.exportId, {
      status: "running",
      startedAt: args.startedAt,
      updatedAt: args.startedAt,
      error: undefined,
    });
  },
});

export const markExportCompleted = internalMutation({
  args: {
    exportId: v.id("reportExports"),
    storageId: v.id("_storage"),
    mimeType: v.string(),
    fileName: v.string(),
    byteSize: v.number(),
    rowCount: v.number(),
    finishedAt: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.exportId);
    if (!row || row.status !== "running") {
      return;
    }

    await ctx.db.patch(args.exportId, {
      status: "completed",
      storageId: args.storageId,
      mimeType: args.mimeType,
      fileName: args.fileName,
      byteSize: args.byteSize,
      rowCount: args.rowCount,
      finishedAt: args.finishedAt,
      expiresAt: args.expiresAt,
      updatedAt: args.finishedAt,
      error: undefined,
    });
  },
});

export const markExportFailed = internalMutation({
  args: {
    exportId: v.id("reportExports"),
    error: v.string(),
    finishedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.exportId);
    if (!row || (row.status !== "running" && row.status !== "queued")) {
      return;
    }

    await ctx.db.patch(args.exportId, {
      status: "failed",
      error: args.error.slice(0, 1500),
      finishedAt: args.finishedAt,
      updatedAt: args.finishedAt,
    });
  },
});

export const expireExports = internalMutation({
  args: {
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();

    const expiredRows = await ctx.db
      .query("reportExports")
      .withIndex("by_status_and_expires_at", (q) =>
        q.eq("status", "completed").lte("expiresAt", now),
      )
      .take(100);

    for (const row of expiredRows) {
      if (row.storageId) {
        await ctx.storage.delete(row.storageId);
      }
      await ctx.db.patch(row._id, {
        status: "expired",
        updatedAt: now,
      });
    }

    const retentionCutoff = now - 30 * 24 * 60 * 60 * 1000;
    const staleRows = await ctx.db
      .query("reportExports")
      .withIndex("by_created_at", (q) => q.lt("createdAt", retentionCutoff))
      .take(200);

    let deletedCount = 0;
    for (const row of staleRows) {
      if (row.status === "queued" || row.status === "running") {
        continue;
      }
      await deleteExportRow(ctx, row._id, row.storageId);
      deletedCount += 1;
    }

    if (expiredRows.length === 100 || staleRows.length === 200) {
      await ctx.scheduler.runAfter(0, internal.reports.mutations.expireExports, {
        now,
      });
    }

    return {
      expiredCount: expiredRows.length,
      deletedCount,
    };
  },
});

async function deleteExportRow(
  ctx: MutationCtx,
  exportId: Id<"reportExports">,
  storageId: Id<"_storage"> | undefined,
) {
  if (storageId) {
    await ctx.storage.delete(storageId);
  }
  await ctx.db.delete(exportId);
}
