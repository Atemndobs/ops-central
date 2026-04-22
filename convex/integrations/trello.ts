/**
 * Trello integration — Ops board
 *
 * When an incident is created in OpsCentral, we create a card on the Ops
 * Trello board so the operations team can track/resolve from their existing
 * workflow.
 *
 * Env vars (set via `npx convex env set ...`):
 *   TRELLO_API_KEY              — API key from https://trello.com/power-ups/admin
 *   TRELLO_API_TOKEN            — token from the authorize URL
 *   TRELLO_OPS_BOARD_ID         — 697d1390ee0dff5e7ac53138 (Ops board)
 *   TRELLO_OPS_BACKLOG_LIST_ID  — 697fa6b95135f9e1054e2d73 (Backlog list)
 */

import { v } from "convex/values";
import { action, internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { resolvePhotoAccessUrl } from "../lib/photoUrls";

// ─────────────────────────────────────────────────────────────────────────────
// Label mapping — hardcoded from the Incidents board
// (https://trello.com/b/TDZa1A6K/incidents). Update these IDs if labels are
// renamed or re-created.
// ─────────────────────────────────────────────────────────────────────────────
const LABEL_IDS = {
  urgent: "69e8ab57c64168603cf78d68",
  operations: "69e8ab57c0abae7ba32221a7",
  repair: "69e8ab588852e060f1eae6ae",
  cleaning: "69e8ab5856780bec26508d1f",
  claim: "69e8ab59571e38f50763a3f3",
  guestIssue: "69e8ab5974d7b2b7f9e86335",
  suggestion: "69e8ab59213a2303e2a39676",
} as const;

// Property-name → Trello label ID. Keyed by a normalized property name match.
// Matching is fuzzy (substring, case-insensitive) so "Dallas Sleeps 14" still
// picks up the "Dallas, The Scandi" label if that's the only Dallas property.
const PROPERTY_LABELS: Array<{ match: string; labelId: string }> = [
  { match: "scandi", labelId: "69e8ab5a13f031fa2d9b2fb6" },
  { match: "andaluz", labelId: "69e8ab5abf131ec277b6c2e8" },
  { match: "lisboa", labelId: "69e8ab5a03010c86c74e0cd3" },
  { match: "skagen", labelId: "69e8ab5b810e5f7985d4bff6" },
  { match: "berlin", labelId: "69e8ab5b1cfd9deae81e34ce" },
  { match: "sierra", labelId: "69e8ab5b5aeed8819e7095ff" },
];

type IncidentType = Doc<"incidents">["incidentType"];
type Severity = NonNullable<Doc<"incidents">["severity"]>;

function pickTypeLabel(type: IncidentType): string {
  switch (type) {
    case "damaged_item":
    case "maintenance_needed":
      return LABEL_IDS.repair;
    case "missing_item":
      return LABEL_IDS.claim;
    case "guest_issue":
      return LABEL_IDS.guestIssue;
    case "suggestion":
      return LABEL_IDS.suggestion;
    case "other":
    default:
      return LABEL_IDS.operations;
  }
}

function labelsForIncident(
  type: IncidentType,
  severity: Severity | undefined,
  propertyName: string,
): string[] {
  const labels = new Set<string>();
  labels.add(pickTypeLabel(type));
  if (severity === "critical" || severity === "high") {
    labels.add(LABEL_IDS.urgent);
  }
  const propName = propertyName.toLowerCase();
  for (const { match, labelId } of PROPERTY_LABELS) {
    if (propName.includes(match)) {
      labels.add(labelId);
      break;
    }
  }
  return [...labels];
}

function formatSeverityPrefix(severity: Severity | undefined): string {
  if (!severity) return "";
  return `[${severity.toUpperCase()}] `;
}

function humanizeType(type: IncidentType): string {
  return type.replace(/_/g, " ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal query — load everything the action needs in one shot.
// Actions can't touch ctx.db, so we hydrate here.
// ─────────────────────────────────────────────────────────────────────────────
export const getIncidentSyncContext = internalQuery({
  args: { incidentId: v.id("incidents") },
  handler: async (ctx, { incidentId }) => {
    const incident = await ctx.db.get(incidentId);
    if (!incident) return null;

    const property = await ctx.db.get(incident.propertyId);
    const reporter = incident.reportedBy
      ? await ctx.db.get(incident.reportedBy)
      : null;
    const job = incident.cleaningJobId
      ? await ctx.db.get(incident.cleaningJobId)
      : null;

    // Resolve up to 5 photo URLs. photoIds may be either `photos` table IDs
    // or raw `_storage` IDs (see mutations.ts merge logic).
    const photoUrls: string[] = [];
    for (const raw of incident.photoIds.slice(0, 5)) {
      const photoId = ctx.db.normalizeId("photos", raw);
      if (photoId) {
        const photoDoc = await ctx.db.get(photoId);
        if (photoDoc) {
          const url = await resolvePhotoAccessUrl(ctx, photoDoc);
          if (url) photoUrls.push(url);
          continue;
        }
      }
      // Fall back: treat raw as a storage ID. Same pattern used in
      // incidents/mutations.ts pruneIncidentsWithBrokenPhotos.
      try {
        const storageId = raw as Id<"_storage">;
        const systemDoc = await ctx.db.system.get(storageId);
        if (systemDoc) {
          const url = await ctx.storage.getUrl(storageId);
          if (url) photoUrls.push(url);
        }
      } catch {
        // malformed — skip
      }
    }

    return {
      incident,
      propertyName: property?.name ?? "Unknown property",
      propertyCity: property?.city ?? null,
      reporterName: reporter?.name ?? reporter?.email ?? "Unknown",
      jobId: job?._id ?? null,
      photoUrls,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Internal action — creates the Trello card.
// Scheduled from createIncident. Fire-and-forget: never throws.
// ─────────────────────────────────────────────────────────────────────────────
export const syncIncidentToCard = internalAction({
  args: { incidentId: v.id("incidents") },
  handler: async (ctx, { incidentId }) => {
    const apiKey = process.env.TRELLO_API_KEY;
    const apiToken = process.env.TRELLO_API_TOKEN;
    const listId = process.env.TRELLO_OPS_BACKLOG_LIST_ID;

    if (!apiKey || !apiToken || !listId) {
      await ctx.runMutation(internal.integrations.trello.markIncidentSyncError, {
        incidentId,
        error: "Trello env vars not configured",
      });
      return;
    }

    const context = await ctx.runQuery(
      internal.integrations.trello.getIncidentSyncContext,
      { incidentId },
    );
    if (!context) return;

    const { incident, propertyName, propertyCity, reporterName, photoUrls } =
      context;

    // Skip if already synced (defense against duplicate schedules).
    if (incident.trelloCardId) return;

    const name =
      `${formatSeverityPrefix(incident.severity)}${incident.title} — ${propertyName}`
        .slice(0, 512);

    const siteUrl = process.env.OPSCENTRAL_SITE_URL ?? "https://ja-bs.com";

    const descParts: string[] = [
      `**Type:** ${humanizeType(incident.incidentType)}`,
      incident.severity ? `**Severity:** ${incident.severity}` : null,
      `**Property:** ${propertyName}${propertyCity ? ` (${propertyCity})` : ""}`,
      incident.roomName ? `**Room:** ${incident.roomName}` : null,
      `**Reported by:** ${reporterName}`,
      incident.cleaningJobId ? `**Job:** ${siteUrl}/jobs/${incident.cleaningJobId}` : null,
      `**OpsCentral:** ${siteUrl}/incidents/${incident._id}`,
    ].filter(Boolean) as string[];

    if (incident.description) {
      descParts.push("", "---", "", incident.description);
    }
    if (incident.customItemDescription) {
      descParts.push("", `**Item:** ${incident.customItemDescription}`);
    }
    if (incident.incidentContext) {
      descParts.push("", `**Context:** ${incident.incidentContext}`);
    }

    const desc = descParts.join("\n");
    const idLabels = labelsForIncident(
      incident.incidentType,
      incident.severity,
      propertyName,
    );

    try {
      const cardRes = await trelloFetch("POST", "/1/cards", apiKey, apiToken, {
        idList: listId,
        name,
        desc,
        idLabels: idLabels.join(","),
        pos: "top",
      });

      const cardId = cardRes.id as string;
      const cardUrl = cardRes.url as string;
      const cardShortLink = cardRes.shortLink as string | undefined;

      // Attach photos (best-effort — failures don't block card creation).
      for (const url of photoUrls) {
        try {
          await trelloFetch(
            "POST",
            `/1/cards/${cardId}/attachments`,
            apiKey,
            apiToken,
            { url, setCover: "false" },
          );
        } catch (err) {
          console.error("trello: failed to attach photo", { cardId, url, err });
        }
      }

      await ctx.runMutation(internal.integrations.trello.markIncidentSynced, {
        incidentId,
        trelloCardId: cardId,
        trelloCardUrl: cardUrl,
        trelloCardShortLink: cardShortLink,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("trello: card creation failed", { incidentId, message });
      await ctx.runMutation(internal.integrations.trello.markIncidentSyncError, {
        incidentId,
        error: message.slice(0, 500),
      });
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Trello REST fetch
// ─────────────────────────────────────────────────────────────────────────────
async function trelloFetch(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  apiKey: string,
  apiToken: string,
  params: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const url = new URL(`https://api.trello.com${path}`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("token", apiToken);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), { method });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Trello ${method} ${path} → ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal mutations — persist sync status
// ─────────────────────────────────────────────────────────────────────────────
import { internalMutation, mutation } from "../_generated/server";
import { requireRole } from "../lib/auth";

export const markIncidentSynced = internalMutation({
  args: {
    incidentId: v.id("incidents"),
    trelloCardId: v.string(),
    trelloCardUrl: v.string(),
    trelloCardShortLink: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.incidentId, {
      trelloCardId: args.trelloCardId,
      trelloCardUrl: args.trelloCardUrl,
      trelloCardShortLink: args.trelloCardShortLink,
      trelloSyncedAt: Date.now(),
      trelloSyncError: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const markIncidentSyncError = internalMutation({
  args: {
    incidentId: v.id("incidents"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.incidentId, {
      trelloSyncError: args.error,
      updatedAt: Date.now(),
    });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Public mutation — manual retry (admin UI button)
// ─────────────────────────────────────────────────────────────────────────────
export const retryIncidentSync = mutation({
  args: { incidentId: v.id("incidents") },
  handler: async (ctx, { incidentId }) => {
    await requireRole(ctx, ["admin", "property_ops", "manager"]);
    const incident = await ctx.db.get(incidentId);
    if (!incident) throw new Error("Incident not found");
    if (incident.trelloCardId) {
      return { skipped: true, reason: "already_synced" };
    }
    await ctx.db.patch(incidentId, {
      trelloSyncError: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      internal.integrations.trello.syncIncidentToCard,
      { incidentId },
    );
    return { skipped: false };
  },
});

// ═════════════════════════════════════════════════════════════════════════════
// BIDIRECTIONAL SYNC — Incident status ↔ Trello list
// ═════════════════════════════════════════════════════════════════════════════

type IncidentStatus = Doc<"incidents">["status"];

/** Maps an incident status to the Trello list env var name. */
function listEnvVarForStatus(status: IncidentStatus): string | null {
  switch (status) {
    case "open":
      return "TRELLO_OPS_BACKLOG_LIST_ID";
    case "in_progress":
      return "TRELLO_OPS_IN_PROGRESS_LIST_ID";
    case "resolved":
      return "TRELLO_OPS_COMPLETE_LIST_ID";
    case "wont_fix":
      return "TRELLO_OPS_ON_HOLD_LIST_ID";
    default:
      return null;
  }
}

/** Reverse map — only trigger status changes for lists that map back. */
function statusForListId(listId: string): IncidentStatus | null {
  if (listId === process.env.TRELLO_OPS_IN_PROGRESS_LIST_ID) return "in_progress";
  if (listId === process.env.TRELLO_OPS_COMPLETE_LIST_ID) return "resolved";
  if (listId === process.env.TRELLO_OPS_ON_HOLD_LIST_ID) return "wont_fix";
  if (listId === process.env.TRELLO_OPS_BACKLOG_LIST_ID) return "open";
  return null;
}

/**
 * Outbound: move the Trello card to match the new incident status.
 * Scheduled by `updateIncidentStatus`. Idempotent — if the card is already
 * on the target list Trello returns 200 and nothing happens.
 */
export const moveTrelloCardForStatus = internalAction({
  args: {
    incidentId: v.id("incidents"),
    status: v.union(
      v.literal("open"),
      v.literal("in_progress"),
      v.literal("resolved"),
      v.literal("wont_fix"),
    ),
  },
  handler: async (ctx, { incidentId, status }) => {
    const apiKey = process.env.TRELLO_API_KEY;
    const apiToken = process.env.TRELLO_API_TOKEN;
    if (!apiKey || !apiToken) return;

    const envVar = listEnvVarForStatus(status);
    if (!envVar) return;
    const targetListId = process.env[envVar];
    if (!targetListId) return;

    const context = await ctx.runQuery(
      internal.integrations.trello.getIncidentSyncContext,
      { incidentId },
    );
    if (!context?.incident.trelloCardId) return;

    try {
      await trelloFetch(
        "PUT",
        `/1/cards/${context.incident.trelloCardId}`,
        apiKey,
        apiToken,
        { idList: targetListId },
      );
    } catch (err) {
      console.error("trello: failed to move card", { incidentId, status, err });
    }
  },
});

/**
 * Inbound: Trello webhook posted a card-list change. Update the incident.
 * Called from `processTrelloWebhookPayload`.
 *
 * Uses an internal mutation (not the public `updateIncidentStatus`) so that
 * we don't re-schedule an outbound card move and cause a loop.
 */
export const applyTrelloStatusFromWebhook = internalMutation({
  args: {
    incidentId: v.id("incidents"),
    status: v.union(
      v.literal("open"),
      v.literal("in_progress"),
      v.literal("resolved"),
      v.literal("wont_fix"),
    ),
    trelloMemberName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get(args.incidentId);
    if (!incident) return;
    if (incident.status === args.status) return; // no-op, also breaks loops

    const now = Date.now();
    const isTerminal = args.status === "resolved" || args.status === "wont_fix";
    const wasTerminal =
      incident.status === "resolved" || incident.status === "wont_fix";

    const patch: Record<string, unknown> = {
      status: args.status,
      updatedAt: now,
    };
    if (isTerminal) {
      patch.resolvedAt = incident.resolvedAt ?? now;
      patch.resolutionNotes =
        incident.resolutionNotes ??
        (args.trelloMemberName
          ? `Resolved in Trello by ${args.trelloMemberName}`
          : "Resolved in Trello");
    } else if (wasTerminal) {
      patch.resolvedAt = undefined;
      patch.resolvedBy = undefined;
      patch.resolutionNotes = undefined;
    }

    await ctx.db.patch(args.incidentId, patch);
  },
});

/** Internal query: find an incident by its Trello card ID. */
export const findIncidentByCardId = internalQuery({
  args: { trelloCardId: v.string() },
  handler: async (ctx, { trelloCardId }) => {
    // No index on trelloCardId — small table, scan is fine.
    const all = await ctx.db.query("incidents").collect();
    return all.find((i) => i.trelloCardId === trelloCardId) ?? null;
  },
});

/**
 * Process a Trello webhook payload. Called from the Next.js
 * /api/webhooks/trello route (Convex HTTP doesn't support the HEAD method
 * Trello uses to verify the callback URL, so Next.js handles the HTTP layer
 * and forwards the parsed payload here).
 *
 * Public, but gated by a shared bearer token (TRELLO_WEBHOOK_SHARED_SECRET).
 * Docs: https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/
 */
export const processTrelloWebhookPayload = action({
  args: { payload: v.any(), secret: v.string() },
  handler: async (ctx, { payload, secret }) => {
    const expected = process.env.TRELLO_WEBHOOK_SHARED_SECRET;
    if (!expected || secret !== expected) {
      throw new Error("Unauthorized");
    }
    // Trello wraps events in { action: { type, data, memberCreator } }
    const action = (payload as { action?: Record<string, unknown> })?.action;
    if (!action) return;
    const type = action.type as string | undefined;
    if (type !== "updateCard") return;

    const data = (action.data ?? {}) as Record<string, unknown>;
    const card = (data.card ?? {}) as Record<string, unknown>;
    const listAfter = (data.listAfter ?? null) as Record<string, unknown> | null;
    const listBefore = (data.listBefore ?? null) as Record<string, unknown> | null;

    // Only care about list-change events.
    if (!listAfter || !listBefore) return;

    const cardId = card.id as string | undefined;
    const newListId = listAfter.id as string | undefined;
    if (!cardId || !newListId) return;

    const newStatus = statusForListId(newListId);
    if (!newStatus) return; // list we don't track

    const incident = await ctx.runQuery(
      internal.integrations.trello.findIncidentByCardId,
      { trelloCardId: cardId },
    );
    if (!incident) return;

    const memberCreator = (action.memberCreator ?? {}) as Record<string, unknown>;
    const trelloMemberName =
      (memberCreator.fullName as string | undefined) ??
      (memberCreator.username as string | undefined);

    await ctx.runMutation(
      internal.integrations.trello.applyTrelloStatusFromWebhook,
      { incidentId: incident._id, status: newStatus, trelloMemberName },
    );
  },
});

// ═════════════════════════════════════════════════════════════════════════════
// WEBHOOK MANAGEMENT — one-shot actions for admins
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Register a Trello webhook on the Ops board. Run once per deployment:
 *
 *   npx convex run integrations/trello:registerOpsBoardWebhook \\
 *     '{"callbackUrl":"https://usable-anaconda-394.convex.site/trello/webhook"}'
 *
 * The callback URL MUST be HTTPS and publicly reachable. Trello performs a
 * HEAD request to verify it before activating the webhook.
 */
export const registerOpsBoardWebhook = internalAction({
  args: { callbackUrl: v.string(), description: v.optional(v.string()) },
  handler: async (_ctx, args) => {
    const apiKey = process.env.TRELLO_API_KEY;
    const apiToken = process.env.TRELLO_API_TOKEN;
    const boardId = process.env.TRELLO_OPS_BOARD_ID;
    if (!apiKey || !apiToken || !boardId) {
      throw new Error("Trello env vars missing");
    }
    const res = await trelloFetch("POST", "/1/webhooks", apiKey, apiToken, {
      idModel: boardId,
      callbackURL: args.callbackUrl,
      description: args.description ?? "OpsCentral ↔ Ops board sync",
    });
    return res;
  },
});

export const listTrelloWebhooks = internalAction({
  args: {},
  handler: async () => {
    const apiKey = process.env.TRELLO_API_KEY;
    const apiToken = process.env.TRELLO_API_TOKEN;
    if (!apiKey || !apiToken) throw new Error("Trello env vars missing");
    const res = await fetch(
      `https://api.trello.com/1/tokens/${apiToken}/webhooks?key=${apiKey}`,
    );
    if (!res.ok) throw new Error(`Trello list webhooks → ${res.status}`);
    return (await res.json()) as unknown;
  },
});

export const deleteTrelloWebhook = internalAction({
  args: { webhookId: v.string() },
  handler: async (_ctx, { webhookId }) => {
    const apiKey = process.env.TRELLO_API_KEY;
    const apiToken = process.env.TRELLO_API_TOKEN;
    if (!apiKey || !apiToken) throw new Error("Trello env vars missing");
    await trelloFetch(
      "DELETE",
      `/1/webhooks/${webhookId}`,
      apiKey,
      apiToken,
      {},
    );
    return { deleted: webhookId };
  },
});

// ═════════════════════════════════════════════════════════════════════════════
// MIGRATION — drop stale card pointers (when the board changes)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Clear trelloCardId/Url/ShortLink/SyncedAt on every incident. Use when the
 * target Trello board changes (existing card pointers now dangle).
 *
 * Runs with optional dryRun:
 *   npx convex run integrations/trello:resetAllTrelloPointers '{"dryRun":true}'
 *   npx convex run integrations/trello:resetAllTrelloPointers
 */
export const resetAllTrelloPointers = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;
    const all = await ctx.db.query("incidents").collect();
    const affected = all.filter((i) => i.trelloCardId);
    if (!dryRun) {
      for (const i of affected) {
        await ctx.db.patch(i._id, {
          trelloCardId: undefined,
          trelloCardUrl: undefined,
          trelloCardShortLink: undefined,
          trelloSyncedAt: undefined,
          trelloSyncError: undefined,
        });
      }
    }
    return { dryRun, cleared: affected.length };
  },
});

// ═════════════════════════════════════════════════════════════════════════════
// BACKFILL — create cards for already-open incidents missing a Trello card
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Schedule card creation for every open incident lacking a Trello card.
 * Spaces calls 250ms apart to stay well under Trello's rate limit.
 *
 *   npx convex run integrations/trello:backfillOpenIncidents
 *   npx convex run integrations/trello:backfillOpenIncidents '{"dryRun":true}'
 */
export const backfillOpenIncidents = internalMutation({
  args: { dryRun: v.optional(v.boolean()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;
    const limit = args.limit ?? 500;
    const candidates = await ctx.db
      .query("incidents")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .collect();

    const missing = candidates.filter((i) => !i.trelloCardId).slice(0, limit);

    if (!dryRun) {
      let delay = 0;
      for (const incident of missing) {
        await ctx.scheduler.runAfter(
          delay,
          internal.integrations.trello.syncIncidentToCard,
          { incidentId: incident._id },
        );
        delay += 250; // 4 req/sec — well under 100 req/10s limit
      }
    }

    return {
      dryRun,
      totalOpen: candidates.length,
      scheduled: missing.length,
      sample: missing
        .slice(0, 10)
        .map((i) => ({ _id: i._id, title: i.title, createdAt: i.createdAt })),
    };
  },
});

// Keep `Id` imported at top-level useful; TS will drop if unused.
export type _Keep = Id<"incidents">;
