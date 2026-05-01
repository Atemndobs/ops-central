/**
 * opsTasks mutations — see Docs/ops-tasks-and-handover/architecture.md §2.
 *
 * Permission split:
 * - create / update / assign / delete    → requireOpsRole
 * - setStatus / addComment / attachPhoto → requireTaskActor (ops or assignee)
 */

import { v } from "convex/values";
import { mutation } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { getCurrentUser } from "../lib/auth";
import { requireOpsRole, requireTaskActor } from "../lib/opsTaskAuth";

const PRIORITY = v.union(
  v.literal("low"),
  v.literal("normal"),
  v.literal("high"),
  v.literal("urgent"),
);

const STATUS = v.union(
  v.literal("open"),
  v.literal("in_progress"),
  v.literal("done"),
);

const LOCALE = v.union(v.literal("en"), v.literal("es"));

function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

async function resolveAssigneeRole(
  ctx: { db: { get: (id: Id<"users">) => Promise<Doc<"users"> | null> } },
  assigneeId: Id<"users"> | undefined,
): Promise<Doc<"opsTasks">["assigneeRole"]> {
  if (!assigneeId) return undefined;
  const u = await ctx.db.get(assigneeId);
  if (!u) throw new Error("Assignee user not found");
  return u.role as Doc<"opsTasks">["assigneeRole"];
}

export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    priority: v.optional(PRIORITY),
    anchorDate: v.optional(v.number()), // defaults to today (UTC start-of-day)
    dueDate: v.optional(v.number()),
    assigneeId: v.optional(v.id("users")),
    propertyId: v.optional(v.id("properties")),
    jobId: v.optional(v.id("cleaningJobs")),
    incidentId: v.optional(v.id("incidents")),
    conversationId: v.optional(v.id("conversations")),
    authoredLocale: v.optional(LOCALE),
  },
  handler: async (ctx, args) => {
    const ops = await requireOpsRole(ctx);
    const trimmedTitle = args.title.trim();
    if (!trimmedTitle) throw new Error("Title is required");

    const assigneeRole = await resolveAssigneeRole(ctx, args.assigneeId);
    const now = Date.now();
    const anchorDate = startOfUtcDay(args.anchorDate ?? now);

    const taskId = await ctx.db.insert("opsTasks", {
      title: trimmedTitle,
      description: args.description?.trim() || undefined,
      status: "open",
      priority: args.priority ?? "normal",
      anchorDate,
      dueDate: args.dueDate,
      createdBy: ops._id,
      assigneeId: args.assigneeId,
      assigneeRole,
      propertyId: args.propertyId,
      jobId: args.jobId,
      incidentId: args.incidentId,
      conversationId: args.conversationId,
      authoredLocale: args.authoredLocale,
      createdAt: now,
      updatedAt: now,
    });

    return taskId;
  },
});

export const update = mutation({
  args: {
    taskId: v.id("opsTasks"),
    patch: v.object({
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      priority: v.optional(PRIORITY),
      anchorDate: v.optional(v.number()),
      dueDate: v.optional(v.number()),
      propertyId: v.optional(v.id("properties")),
      jobId: v.optional(v.id("cleaningJobs")),
      incidentId: v.optional(v.id("incidents")),
      conversationId: v.optional(v.id("conversations")),
    }),
  },
  handler: async (ctx, args) => {
    await requireOpsRole(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");

    const patch: Partial<Doc<"opsTasks">> = { updatedAt: Date.now() };
    if (args.patch.title !== undefined) {
      const t = args.patch.title.trim();
      if (!t) throw new Error("Title cannot be empty");
      patch.title = t;
    }
    if (args.patch.description !== undefined) {
      patch.description = args.patch.description.trim() || undefined;
    }
    if (args.patch.priority !== undefined) patch.priority = args.patch.priority;
    if (args.patch.anchorDate !== undefined) {
      patch.anchorDate = startOfUtcDay(args.patch.anchorDate);
    }
    if (args.patch.dueDate !== undefined) patch.dueDate = args.patch.dueDate;
    if (args.patch.propertyId !== undefined) patch.propertyId = args.patch.propertyId;
    if (args.patch.jobId !== undefined) patch.jobId = args.patch.jobId;
    if (args.patch.incidentId !== undefined) patch.incidentId = args.patch.incidentId;
    if (args.patch.conversationId !== undefined) {
      patch.conversationId = args.patch.conversationId;
    }

    await ctx.db.patch(args.taskId, patch);
    return args.taskId;
  },
});

export const assign = mutation({
  args: {
    taskId: v.id("opsTasks"),
    assigneeId: v.optional(v.id("users")), // undefined → unassign
  },
  handler: async (ctx, args) => {
    await requireOpsRole(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");

    const assigneeRole = await resolveAssigneeRole(ctx, args.assigneeId);
    await ctx.db.patch(args.taskId, {
      assigneeId: args.assigneeId,
      assigneeRole,
      updatedAt: Date.now(),
    });
    return args.taskId;
  },
});

export const setStatus = mutation({
  args: {
    taskId: v.id("opsTasks"),
    status: STATUS,
  },
  handler: async (ctx, args) => {
    const { user, task } = await requireTaskActor(ctx, args.taskId);
    const now = Date.now();
    const patch: Partial<Doc<"opsTasks">> = {
      status: args.status,
      updatedAt: now,
    };

    if (args.status === "done" && task.status !== "done") {
      patch.closedAt = now;
      patch.closedBy = user._id;
    } else if (args.status !== "done" && task.status === "done") {
      // Re-opening — clear closedAt/closedBy so the drag-bar resumes.
      patch.closedAt = undefined;
      patch.closedBy = undefined;
    }

    await ctx.db.patch(args.taskId, patch);
    return args.taskId;
  },
});

export const addComment = mutation({
  args: {
    taskId: v.id("opsTasks"),
    body: v.string(),
    authoredLocale: v.optional(LOCALE),
  },
  handler: async (ctx, args) => {
    const { user } = await requireTaskActor(ctx, args.taskId);
    const body = args.body.trim();
    if (!body) throw new Error("Comment body is required");

    const id = await ctx.db.insert("opsTaskComments", {
      taskId: args.taskId,
      authorId: user._id,
      body,
      authoredLocale: args.authoredLocale,
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.taskId, { updatedAt: Date.now() });
    return id;
  },
});

export const attachPhoto = mutation({
  args: {
    taskId: v.id("opsTasks"),
    photoId: v.string(), // photos table id or storage id; soft-typed for flexibility
  },
  handler: async (ctx, args) => {
    const { task } = await requireTaskActor(ctx, args.taskId);
    const photoIds = [...(task.photoIds ?? []), args.photoId];
    await ctx.db.patch(args.taskId, {
      photoIds,
      updatedAt: Date.now(),
    });
    return args.taskId;
  },
});

export const deleteTask = mutation({
  args: { taskId: v.id("opsTasks") },
  handler: async (ctx, args) => {
    await requireOpsRole(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task) return null;

    // Cascade: comments
    const comments = await ctx.db
      .query("opsTaskComments")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .collect();
    for (const c of comments) await ctx.db.delete(c._id);

    await ctx.db.delete(args.taskId);
    return null;
  },
});
