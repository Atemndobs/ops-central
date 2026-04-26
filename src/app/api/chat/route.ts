import { streamText, tool, convertToModelMessages, stepCountIs } from "ai";
import type { UIMessage } from "ai";
import { google } from "@ai-sdk/google";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import { z } from "zod";
import {
  ADAPTERS,
  getAdapter,
  type ProviderKey,
} from "@convex/serviceUsage/providers";

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
    "",
    "IMPORTANT RULES:",
    "- You MUST call one or more tools before answering ANY question about operations data. Never say you cannot answer without trying tools first.",
    "- If a question is about a property, use getProperties or searchProperty to find it, then use getJobsByStatus to find cleaning history.",
    "- If asked 'who cleaned X' or 'when was X last cleaned', use getPropertyCleaningHistory — it searches the property and returns recent jobs in one step.",
    "- If a property search returns no results, suggest the correct names from the availableProperties list so the user can try again.",
    "- If asked about rooms, bedrooms, or bathrooms, use getProperties — it has that data.",
    "- If asked about incidents or issues, use getRecentActivity, getQuickStats, or getJobsByStatus with status 'rework_required' or 'awaiting_approval'.",
    "- You can call multiple tools in sequence to build a complete answer.",
    "- Be concise. Use bullet points for lists. Flag urgent items.",
    "- You are read-only — you cannot make changes. If asked to modify something, suggest the user navigate to the relevant page.",
    "- For platform usage, quotas, billing limits, or 'are we running out of X' questions, call getServiceUsage. It hits each provider's API directly — never answer from memory; numbers change constantly.",
  ].join("\n");
}

const SERVICE_KEY_SCHEMA = z.enum(["convex", "clerk", "b2"]);

function summarizeQuotas(
  snapshots: Array<{
    serviceKey: string;
    quotaKey: string;
    used: number;
    limit: number;
    unit: string;
    fetchedAt: number;
  }>,
): string {
  if (snapshots.length === 0) return "No quota data available.";
  const critical: string[] = [];
  const warning: string[] = [];
  const ok: string[] = [];
  for (const s of snapshots) {
    const pct = s.limit > 0 ? (s.used / s.limit) * 100 : 0;
    const line = `${s.serviceKey}/${s.quotaKey}: ${pct.toFixed(1)}% (${s.used} / ${s.limit} ${s.unit})`;
    if (pct >= 90) critical.push(line);
    else if (pct >= 80) warning.push(line);
    else ok.push(line);
  }
  const parts: string[] = [];
  if (critical.length) parts.push(`CRITICAL (≥90%): ${critical.join("; ")}`);
  if (warning.length) parts.push(`WARNING (≥80%): ${warning.join("; ")}`);
  if (ok.length && parts.length === 0)
    parts.push(`All clear (<80%): ${ok.join("; ")}`);
  return parts.join(" | ");
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
        "Get cleaning jobs filtered by status and/or property. Use status 'completed' to find who last cleaned a property. Valid statuses: scheduled, assigned, in_progress, awaiting_approval, rework_required, completed, cancelled. Returns jobs with property name, cleaner names, and schedule times.",
      inputSchema: z.object({
        status: JOB_STATUS.optional().describe("Filter by job status"),
        propertyId: z
          .string()
          .optional()
          .describe(
            "Filter by property ID (get this from searchProperty or getProperties first)",
          ),
        limit: z
          .number()
          .optional()
          .default(20)
          .describe("Max number of jobs to return"),
      }),
      execute: async ({ status, propertyId, limit }) => {
        const jobs = await convex.query(api.cleaningJobs.queries.getAll, {
          status,
          propertyId: propertyId as any,
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
        "Get the list of active properties with their names, addresses, bedrooms, bathrooms, and other details.",
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
          squareFeet: p.squareFeet,
          propertyType: p.propertyType,
        }));
      },
    }),

    searchProperty: tool({
      description:
        "Search for a property by name. Use this when the user asks about a specific property. Returns property details including bedrooms, bathrooms, address, and square footage.",
      inputSchema: z.object({
        query: z.string().describe("The property name or partial name to search for"),
      }),
      execute: async ({ query }) => {
        const properties = await convex.query(api.properties.queries.search, {
          query,
          limit: 5,
        });
        if (properties.length === 0) {
          const allProperties = await convex.query(
            api.properties.queries.list,
            {},
          );
          return {
            results: [],
            availableProperties: allProperties.map((p) => p.name),
          };
        }
        return {
          results: properties.map((p) => ({
            id: p._id,
            name: p.name,
            address: p.address,
            city: p.city,
            state: p.state,
            bedrooms: p.bedrooms,
            bathrooms: p.bathrooms,
            squareFeet: p.squareFeet,
            propertyType: p.propertyType,
            isActive: p.isActive,
          })),
        };
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

    getPropertyCleaningHistory: tool({
      description:
        "Find who last cleaned a property by name. Searches for the property, then returns its most recent completed and in-progress cleaning jobs with cleaner names and dates. Use this when asked 'who cleaned X?', 'when was X last cleaned?', or 'cleaning history for X'.",
      inputSchema: z.object({
        propertyName: z
          .string()
          .describe("The property name or partial name to search for"),
        limit: z
          .number()
          .optional()
          .default(5)
          .describe("Max number of recent jobs to return"),
      }),
      execute: async ({ propertyName, limit }) => {
        const properties = await convex.query(api.properties.queries.search, {
          query: propertyName,
          limit: 3,
        });

        if (properties.length === 0) {
          const allProperties = await convex.query(
            api.properties.queries.list,
            {},
          );
          return {
            error: `No property found matching "${propertyName}"`,
            availableProperties: allProperties.map((p) => p.name),
          };
        }

        const property = properties[0];
        const jobs = await convex.query(api.cleaningJobs.queries.getAll, {
          propertyId: property._id,
          limit: limit ?? 5,
        });

        const sorted = [...jobs].sort(
          (a, b) => b.scheduledStartAt - a.scheduledStartAt,
        );

        return {
          property: {
            id: property._id,
            name: property.name,
            address: property.address,
          },
          recentJobs: sorted.map((j) => ({
            id: j._id,
            status: j.status,
            cleanerNames: j.cleaners
              .filter(Boolean)
              .map((c) => c!.name ?? c!.email)
              .join(", "),
            scheduledStart: new Date(j.scheduledStartAt).toLocaleString(
              "en-US",
              {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              },
            ),
            completedAt: j.updatedAt
              ? new Date(j.updatedAt).toLocaleString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })
              : null,
          })),
          otherMatches:
            properties.length > 1
              ? properties.slice(1).map((p) => ({
                  id: p._id,
                  name: p.name,
                }))
              : [],
        };
      },
    }),

    getTeamMembers: tool({
      description:
        "Get team members (cleaners, managers, staff). Use this when asked about team, cleaners, staff, or who is available.",
      inputSchema: z.object({
        role: z
          .enum(["cleaner", "manager", "property_ops", "admin"])
          .optional()
          .describe(
            "Filter by role. Omit to get all team members.",
          ),
      }),
      execute: async ({ role }) => {
        if (role) {
          const users = await convex.query(api.users.queries.getByRole, {
            role,
          });
          return users.map((u) => ({
            id: u._id,
            name: u.name ?? "No name",
            email: u.email,
            role: u.role,
            phone: u.phone,
          }));
        }

        const roles = ["cleaner", "manager", "property_ops", "admin"] as const;
        const allUsers = await Promise.all(
          roles.map((r) =>
            convex.query(api.users.queries.getByRole, { role: r }),
          ),
        );
        return allUsers.flat().map((u) => ({
          id: u._id,
          name: u.name ?? "No name",
          email: u.email,
          role: u.role,
          phone: u.phone,
        }));
      },
    }),

    getServiceUsage: tool({
      description:
        "Check live quota usage for the paid platforms we depend on (Convex, Clerk, Backblaze B2). Calls each provider's billing API directly and returns current usage vs. plan limit, plus a percentage. Use whenever the user asks about quotas, usage, limits, billing pressure, or 'are we running out of X'. Always call this — never answer from cached memory.",
      inputSchema: z.object({
        serviceKey: SERVICE_KEY_SCHEMA.optional().describe(
          "Which platform to check. Omit to check ALL providers (recommended when the user just asks 'how is our usage?').",
        ),
      }),
      execute: async ({ serviceKey }) => {
        const targets: Array<[ProviderKey, () => Promise<unknown>]> = serviceKey
          ? [[serviceKey, getAdapter(serviceKey)!]]
          : (Object.entries(ADAPTERS) as Array<[ProviderKey, () => Promise<unknown>]>);

        const results = await Promise.allSettled(
          targets.map(async ([key, adapter]) => ({
            key,
            snapshots: (await adapter()) as Array<{
              serviceKey: string;
              quotaKey: string;
              used: number;
              limit: number;
              unit: string;
              fetchedAt: number;
            }>,
          })),
        );

        const flat: Array<{
          serviceKey: string;
          quotaKey: string;
          used: number;
          limit: number;
          unit: string;
          pct: number;
          fetchedAt: number;
        }> = [];
        const errors: Array<{ serviceKey: string; error: string }> = [];

        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          const [key] = targets[i];
          if (r.status === "fulfilled") {
            for (const s of r.value.snapshots) {
              flat.push({
                ...s,
                pct: s.limit > 0 ? (s.used / s.limit) * 100 : 0,
              });
            }
          } else {
            errors.push({
              serviceKey: key,
              error:
                r.reason instanceof Error
                  ? r.reason.message
                  : String(r.reason),
            });
          }
        }

        return {
          summary: summarizeQuotas(flat),
          quotas: flat,
          errors,
          fetchedAt: new Date().toISOString(),
        };
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
  try {
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

    // 3. Role gate — only admin and property_ops. Cleaning managers and
    //    cleaners are not allowed.
    const profile = await convex.query(api.users.queries.getMyProfile, {});
    const allowedRoles = ["admin", "property_ops"];
    if (!allowedRoles.includes(profile.role)) {
      return Response.json(
        { error: "Only admins and property ops can use the AI assistant" },
        { status: 403 },
      );
    }

    // 4. Parse messages and stream response
    const body = await req.json();
    console.log("[OpsBot] Received messages:", JSON.stringify(body.messages?.length));
    const messages: UIMessage[] = body.messages;
    const modelMessages = await convertToModelMessages(messages);
    console.log("[OpsBot] Converted to model messages:", modelMessages.length);

    const modelId = process.env.AI_MODEL ?? "gemini-2.5-flash";
    console.log("[OpsBot] Calling Gemini model:", modelId);
    console.log("[OpsBot] API key present:", !!process.env.GOOGLE_GENERATIVE_AI_API_KEY);

    const startedAt = Date.now();

    const result = streamText({
      model: google(modelId),
      system: buildSystemPrompt(),
      messages: modelMessages,
      tools: buildTools(convex),
      stopWhen: stepCountIs(5),
      onError: (errorContainer) => {
        const error = (errorContainer as { error?: unknown })?.error ?? errorContainer;
        console.error("[OpsBot] streamText error:", error);
        // Fire-and-forget usage log for failures. `ConvexHttpClient` keeps
        // the auth token set earlier in this function.
        const message =
          error instanceof Error ? error.message : String(error ?? "unknown");
        void convex
          .mutation(api.serviceUsage.logger.logFromClient, {
            serviceKey: "gemini",
            feature: "admin_ai_chat",
            status: "unknown_error",
            durationMs: Date.now() - startedAt,
            errorMessage: message.slice(0, 500),
            metadata: { model: modelId },
          })
          .catch((logError) => {
            console.warn("[OpsBot] failed to log usage failure:", logError);
          });
      },
      onFinish: async (finish) => {
        // AI SDK v5+ exposes totalUsage on the finish payload. Different
        // model providers populate different field names, so we defensively
        // read the two common shapes.
        const usage = (finish as {
          totalUsage?: {
            inputTokens?: number;
            outputTokens?: number;
            promptTokens?: number;
            completionTokens?: number;
          };
          usage?: {
            inputTokens?: number;
            outputTokens?: number;
            promptTokens?: number;
            completionTokens?: number;
          };
        }).totalUsage ?? (finish as { usage?: unknown }).usage ?? {};
        const u = usage as {
          inputTokens?: number;
          outputTokens?: number;
          promptTokens?: number;
          completionTokens?: number;
        };
        const inputTokens = u.inputTokens ?? u.promptTokens;
        const outputTokens = u.outputTokens ?? u.completionTokens;

        try {
          await convex.mutation(api.serviceUsage.logger.logFromClient, {
            serviceKey: "gemini",
            feature: "admin_ai_chat",
            status: "success",
            durationMs: Date.now() - startedAt,
            inputTokens,
            outputTokens,
            metadata: { model: modelId, messages: modelMessages.length },
          });
        } catch (logError) {
          console.warn("[OpsBot] failed to log usage:", logError);
        }
      },
    });

    // Surface real error messages to the client. Without this, ai-sdk
    // returns a generic "An error occurred" and the chat appears to die
    // silently when a tool call throws (e.g. a Convex auth/permission
    // error for non-admin users).
    return result.toUIMessageStreamResponse({
      onError: (error) => {
        if (error == null) return "Unknown error";
        if (typeof error === "string") return error;
        if (error instanceof Error) return error.message;
        try {
          return JSON.stringify(error);
        } catch {
          return "Unknown error";
        }
      },
    });
  } catch (error) {
    console.error("[OpsBot] Error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 },
    );
  }
}
