/**
 * opsTasks queries — see Docs/ops-tasks-and-handover/architecture.md §2.
 *
 * Visibility: ops users see all; cleaners see only their own assignments
 * (enforced by getTaskVisibility helper).
 */

import { v } from "convex/values";
import { query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { getTaskVisibility } from "../lib/opsTaskAuth";
import { getCurrentUser } from "../lib/auth";

const STATUS = v.union(
  v.literal("open"),
  v.literal("in_progress"),
  v.literal("done"),
);

type Task = Doc<"opsTasks">;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function hydrate(ctx: any, task: Task) {
  const [property, assignee, createdBy] = await Promise.all([
    task.propertyId ? ctx.db.get(task.propertyId) : Promise.resolve(null),
    task.assigneeId ? ctx.db.get(task.assigneeId) : Promise.resolve(null),
    ctx.db.get(task.createdBy),
  ]);
  return {
    ...task,
    property: property
      ? { _id: (property as Doc<"properties">)._id, name: (property as Doc<"properties">).name }
      : null,
    assignee: assignee
      ? {
          _id: (assignee as Doc<"users">)._id,
          name: (assignee as Doc<"users">).name,
          email: (assignee as Doc<"users">).email,
          role: (assignee as Doc<"users">).role,
        }
      : null,
    createdByUser: createdBy
      ? {
          _id: (createdBy as Doc<"users">)._id,
          name: (createdBy as Doc<"users">).name,
        }
      : null,
  };
}

/** Tasks assigned to a specific user. Used by cleaner mobile app and
 *  by ops users viewing "my tasks". */
export const listForAssignee = query({
  args: {
    userId: v.optional(v.id("users")), // omit → current user
    status: v.optional(STATUS),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const me = await getCurrentUser(ctx);
    const targetId = args.userId ?? me._id;

    // Cleaners can only ask for their own list.
    if (me.role === "cleaner" && targetId !== me._id) {
      throw new Error("Cleaners may only view their own tasks");
    }

    const limit = args.limit ?? 200;
    const status = args.status;

    const tasks = await ctx.db
      .query("opsTasks")
      .withIndex("by_assignee_status", (q) =>
        status
          ? q.eq("assigneeId", targetId).eq("status", status)
          : q.eq("assigneeId", targetId),
      )
      .order("desc")
      .take(limit);

    return Promise.all(tasks.map((t) => hydrate(ctx, t)));
  },
});

/** Tasks for a single (property × day) cell — drives the schedule cell drawer. */
export const listForCell = query({
  args: {
    propertyId: v.id("properties"),
    anchorDate: v.number(), // start-of-day UTC ms
  },
  handler: async (ctx, args) => {
    const { isOps, canSee } = await getTaskVisibility(ctx);
    if (!isOps) {
      // Cleaners don't access the schedule grid; refuse early.
      throw new Error("Schedule cell tasks are ops-only");
    }
    const tasks = await ctx.db
      .query("opsTasks")
      .withIndex("by_property_anchor", (q) =>
        q.eq("propertyId", args.propertyId).eq("anchorDate", args.anchorDate),
      )
      .collect();
    return Promise.all(tasks.filter(canSee).map((t) => hydrate(ctx, t)));
  },
});

/** All tasks intersecting a date range for a property. Used by the schedule
 *  grid to render drag-across bars. */
export const listForPropertyRange = query({
  args: {
    propertyId: v.id("properties"),
    rangeStart: v.number(), // inclusive UTC ms
    rangeEnd: v.number(), // exclusive UTC ms
    includeClosed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { isOps } = await getTaskVisibility(ctx);
    if (!isOps) {
      throw new Error("Schedule range tasks are ops-only");
    }
    // Pull anchored-in-window tasks via the (property, anchor) index.
    const inWindow = await ctx.db
      .query("opsTasks")
      .withIndex("by_property_anchor", (q) =>
        q
          .eq("propertyId", args.propertyId)
          .gte("anchorDate", args.rangeStart)
          .lt("anchorDate", args.rangeEnd),
      )
      .collect();

    // Plus open tasks anchored *before* the window that still drag into it.
    const draggingIn = await ctx.db
      .query("opsTasks")
      .withIndex("by_property_anchor", (q) =>
        q.eq("propertyId", args.propertyId).lt("anchorDate", args.rangeStart),
      )
      .collect();
    const stillOpen = draggingIn.filter(
      (t) =>
        t.status !== "done" ||
        (args.includeClosed && (t.closedAt ?? 0) >= args.rangeStart),
    );

    const all = [...inWindow, ...stillOpen];
    const filtered = args.includeClosed
      ? all
      : all.filter((t) => t.status !== "done");

    return Promise.all(filtered.map((t) => hydrate(ctx, t)));
  },
});

/** All tasks for a property (paged for the property detail page). */
export const listForProperty = query({
  args: {
    propertyId: v.id("properties"),
    status: v.optional(STATUS),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { isOps } = await getTaskVisibility(ctx);
    if (!isOps) {
      throw new Error("Property task lists are ops-only");
    }
    const limit = args.limit ?? 100;
    const tasks = await ctx.db
      .query("opsTasks")
      .withIndex("by_property_anchor", (q) =>
        q.eq("propertyId", args.propertyId),
      )
      .order("desc")
      .take(limit);
    const filtered = args.status
      ? tasks.filter((t) => t.status === args.status)
      : tasks;
    return Promise.all(filtered.map((t) => hydrate(ctx, t)));
  },
});

/** Full /tasks page query — broad filter for ops users. */
export const listAll = query({
  args: {
    status: v.optional(STATUS),
    assigneeId: v.optional(v.id("users")),
    propertyId: v.optional(v.id("properties")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { isOps, user } = await getTaskVisibility(ctx);
    if (!isOps) {
      // Cleaners get only their own.
      const list = await ctx.db
        .query("opsTasks")
        .withIndex("by_assignee_status", (q) =>
          args.status
            ? q.eq("assigneeId", user._id).eq("status", args.status)
            : q.eq("assigneeId", user._id),
        )
        .take(args.limit ?? 100);
      return Promise.all(list.map((t) => hydrate(ctx, t)));
    }

    const limit = args.limit ?? 300;
    let tasks: Task[];
    if (args.assigneeId) {
      tasks = await ctx.db
        .query("opsTasks")
        .withIndex("by_assignee_status", (q) =>
          args.status
            ? q.eq("assigneeId", args.assigneeId).eq("status", args.status)
            : q.eq("assigneeId", args.assigneeId),
        )
        .order("desc")
        .take(limit);
    } else if (args.propertyId) {
      tasks = await ctx.db
        .query("opsTasks")
        .withIndex("by_property_anchor", (q) =>
          q.eq("propertyId", args.propertyId),
        )
        .order("desc")
        .take(limit);
      if (args.status) tasks = tasks.filter((t) => t.status === args.status);
    } else if (args.status) {
      tasks = await ctx.db
        .query("opsTasks")
        .withIndex("by_status_priority", (q) => q.eq("status", args.status!))
        .order("desc")
        .take(limit);
    } else {
      tasks = await ctx.db
        .query("opsTasks")
        .withIndex("by_created")
        .order("desc")
        .take(limit);
    }
    return Promise.all(tasks.map((t) => hydrate(ctx, t)));
  },
});

/** Count of open tasks for a user — drives the dashboard card top line. */
export const countOpenForUser = query({
  args: { userId: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    const me = await getCurrentUser(ctx);
    const targetId = args.userId ?? me._id;
    if (me.role === "cleaner" && targetId !== me._id) {
      throw new Error("Cleaners may only count their own tasks");
    }
    const open = await ctx.db
      .query("opsTasks")
      .withIndex("by_assignee_status", (q) =>
        q.eq("assigneeId", targetId).eq("status", "open"),
      )
      .collect();
    const inProgress = await ctx.db
      .query("opsTasks")
      .withIndex("by_assignee_status", (q) =>
        q.eq("assigneeId", targetId).eq("status", "in_progress"),
      )
      .collect();
    return { open: open.length, inProgress: inProgress.length };
  },
});

/** Single task with comments — drives /tasks/[id] and mobile detail screen. */
export const getById = query({
  args: { taskId: v.id("opsTasks") },
  handler: async (ctx, args) => {
    const { canSee } = await getTaskVisibility(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task) return null;
    if (!canSee(task)) {
      throw new Error("Not authorized to view this task");
    }

    const comments = await ctx.db
      .query("opsTaskComments")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .order("asc")
      .collect();
    const commentAuthors = await Promise.all(
      comments.map((c) => ctx.db.get(c.authorId)),
    );
    const commentsHydrated = comments.map((c, i) => {
      const a = commentAuthors[i] as Doc<"users"> | null;
      return {
        ...c,
        author: a ? { _id: a._id, name: a.name, role: a.role } : null,
      };
    });

    const hydrated = await hydrate(ctx, task);
    return { ...hydrated, comments: commentsHydrated };
  },
});
