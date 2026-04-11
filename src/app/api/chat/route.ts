import { streamText, tool, convertToModelMessages, stepCountIs } from "ai";
import type { UIMessage } from "ai";
import { google } from "@ai-sdk/google";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import { z } from "zod";

export const maxDuration = 30;

const JOB_STATUS = z.enum([
  "scheduled",
  "assigned",
  "in_progress",
  "awaiting_approval",
  "rework_required",
  "completed",
  "cancelled",
]);

const REFILL_STATUS = z.enum(["open", "acknowledged", "ordered", "resolved"]);

function buildSystemPrompt(): string {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return [
    "You are OpsBot, the AI assistant for OpsCentral property care operations.",
    `Today is ${today}.`,
    "You have read-only access to live operations data via tools.",
    "Always call a tool before answering questions about jobs, properties, inventory, or schedules — do not guess.",
    "Be concise. Use bullet points for lists. Flag urgent items.",
    "You cannot make changes — you are read-only.",
    "If asked to modify something, explain that you can only view data and suggest the user navigate to the relevant page in OpsCentral.",
  ].join("\n");
}

function buildTools(convex: ConvexHttpClient) {
  return {
    getQuickStats: tool({
      description:
        "Get a summary overview of operations: today's job count, in-progress, completed today, items needing attention, upcoming check-ins, and total open jobs.",
      inputSchema: z.object({}),
      execute: async () => {
        return await convex.query(api.dashboard.queries.getQuickStats, {});
      },
    }),

    getTodayJobs: tool({
      description:
        "Get today's cleaning jobs with their status, property name, cleaner name, scheduled times, and urgency flags.",
      inputSchema: z.object({}),
      execute: async () => {
        const jobs = await convex.query(
          api.dashboard.queries.getTodayJobs,
          {},
        );
        return jobs.map((j) => ({
          id: j.id,
          status: j.status,
          isUrgent: j.isUrgent,
          propertyName: j.propertyName,
          cleanerName: j.cleanerName,
          scheduledStartAt: new Date(j.scheduledStartAt).toLocaleTimeString(
            "en-US",
            { hour: "numeric", minute: "2-digit" },
          ),
        }));
      },
    }),

    getUpcomingCheckins: tool({
      description:
        "Get upcoming guest check-ins for the next 3 days with guest name, property, and check-in/check-out dates.",
      inputSchema: z.object({}),
      execute: async () => {
        const stays = await convex.query(
          api.dashboard.queries.getUpcomingCheckins,
          {},
        );
        return stays.map((s) => ({
          propertyName: s.propertyName,
          guestName: s.guestName,
          checkIn: new Date(s.checkInAt).toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          }),
          checkOut: new Date(s.checkOutAt).toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          }),
        }));
      },
    }),

    getRecentActivity: tool({
      description:
        "Get recent activity from the last 24 hours — job status changes with property name, cleaner name, and what happened.",
      inputSchema: z.object({}),
      execute: async () => {
        const activity = await convex.query(
          api.dashboard.queries.getRecentActivity,
          {},
        );
        return activity.map((a) => ({
          action: a.action,
          status: a.status,
          propertyName: a.propertyName,
          cleanerName: a.cleanerName,
          time: new Date(a.timestamp).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          }),
        }));
      },
    }),

    getJobsByStatus: tool({
      description:
        "Get cleaning jobs filtered by status. Valid statuses: scheduled, assigned, in_progress, awaiting_approval, rework_required, completed, cancelled. Returns jobs with property and cleaner info.",
      inputSchema: z.object({
        status: JOB_STATUS.optional().describe("Filter by job status"),
        limit: z
          .number()
          .optional()
          .default(20)
          .describe("Max number of jobs to return"),
      }),
      execute: async ({ status, limit }) => {
        const jobs = await convex.query(api.cleaningJobs.queries.getAll, {
          status,
          limit,
        });
        return jobs.map((j) => ({
          id: j._id,
          status: j.status,
          isUrgent: j.isUrgent,
          propertyName: j.property?.name ?? "Unknown",
          cleanerNames: j.cleaners
            .filter(Boolean)
            .map((c) => c!.name ?? c!.email)
            .join(", "),
          scheduledStart: new Date(j.scheduledStartAt).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          }),
        }));
      },
    }),

    getReviewQueue: tool({
      description:
        "Get jobs that need review or approval, sorted by priority (awaiting_approval first, then rework_required, then others).",
      inputSchema: z.object({
        status: JOB_STATUS.optional().describe(
          "Filter review queue by status",
        ),
        limit: z
          .number()
          .optional()
          .default(20)
          .describe("Max number of jobs to return"),
      }),
      execute: async ({ status, limit }) => {
        const jobs = await convex.query(
          api.cleaningJobs.queries.getReviewQueue,
          { status, limit },
        );
        return jobs.map((j) => ({
          id: j._id,
          status: j.status,
          isUrgent: j.isUrgent,
          propertyName: j.property?.name ?? "Unknown",
          cleanerNames: j.cleaners
            .filter(Boolean)
            .map((c) => c!.name ?? c!.email)
            .join(", "),
          scheduledStart: new Date(j.scheduledStartAt).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          }),
        }));
      },
    }),

    getProperties: tool({
      description:
        "Get the list of active properties with their names, addresses, and details.",
      inputSchema: z.object({}),
      execute: async () => {
        const properties = await convex.query(api.properties.queries.list, {});
        return properties.map((p) => ({
          id: p._id,
          name: p.name,
          address: p.address,
          city: p.city,
          bedrooms: p.bedrooms,
          bathrooms: p.bathrooms,
        }));
      },
    }),

    getLowStockItems: tool({
      description:
        "Get inventory items that are low on stock or out of stock, with the property they belong to.",
      inputSchema: z.object({}),
      execute: async () => {
        const items = await convex.query(
          api.inventory.queries.getLowStock,
          {},
        );
        return items.map((i) => ({
          name: i.name,
          status: i.status,
          currentQuantity: i.quantityCurrent,
          minimumQuantity: i.minimumQuantity,
          propertyName: i.propertyName,
          categoryName: i.categoryName,
        }));
      },
    }),

    getRefillQueue: tool({
      description:
        "Get items in the refill/restocking queue with their priority level and status.",
      inputSchema: z.object({
        status: REFILL_STATUS.optional().describe(
          "Filter by refill status: open, acknowledged, ordered, resolved",
        ),
        limit: z
          .number()
          .optional()
          .default(20)
          .describe("Max items to return"),
      }),
      execute: async ({ status, limit }) => {
        const queue = await convex.query(api.refills.queries.getQueue, {
          status,
          limit,
        });
        return queue.map((r) => ({
          itemName: r.item?.name ?? "Unknown item",
          propertyName: r.property?.name ?? "Unknown property",
          status: r.status,
          level: r.level,
          percentRemaining: r.lastPercentRemaining,
        }));
      },
    }),
  };
}

export async function POST(req: Request) {
  // 1. Clerk auth
  const { userId, getToken } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Convex client with JWT
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return Response.json(
      { error: "Missing NEXT_PUBLIC_CONVEX_URL" },
      { status: 500 },
    );
  }

  const convex = new ConvexHttpClient(convexUrl);
  const convexToken =
    (await getToken({ template: "convex" }).catch(() => null)) ??
    (await getToken());

  if (!convexToken) {
    return Response.json(
      { error: "Unable to authenticate with Convex" },
      { status: 401 },
    );
  }
  convex.setAuth(convexToken);

  // 3. Role gate — only admin, property_ops, manager
  const profile = await convex.query(api.users.queries.getMyProfile, {});
  const allowedRoles = ["admin", "property_ops", "manager"];
  if (!allowedRoles.includes(profile.role)) {
    return Response.json(
      { error: "Only admins and managers can use the AI assistant" },
      { status: 403 },
    );
  }

  // 4. Parse messages and stream response
  const { messages }: { messages: UIMessage[] } = await req.json();
  const modelMessages = await convertToModelMessages(messages);

  const modelId = process.env.AI_MODEL ?? "gemini-2.5-flash";

  const result = streamText({
    model: google(modelId),
    system: buildSystemPrompt(),
    messages: modelMessages,
    tools: buildTools(convex),
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse();
}
