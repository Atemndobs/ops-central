import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

function jsonResponse(
  payload: unknown,
  status = 200,
  headers?: Record<string, string>,
) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
  });
}

function getBearerToken(request: Request): string | null {
  const raw = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!raw) return null;
  const [scheme, token] = raw.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

async function verifyIntegrationBearerToken(request: Request) {
  const expected = process.env.INTEGRATION_BEARER_TOKEN;
  if (!expected) {
    return {
      ok: false,
      response: jsonResponse(
        { error: "Integration token not configured on server." },
        500,
      ),
    };
  }

  const provided = getBearerToken(request);
  if (!provided || provided !== expected) {
    return {
      ok: false,
      response: jsonResponse({ error: "Unauthorized" }, 401),
    };
  }

  return { ok: true as const };
}

function hexToBytes(hex: string) {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    return null;
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < hex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

async function verifyMetaSignature(args: {
  body: string;
  appSecret: string;
  signatureHeader: string | null;
}) {
  const { body, appSecret, signatureHeader } = args;
  if (!signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const providedSignature = signatureHeader.slice("sha256=".length).trim();
  if (!providedSignature) {
    return false;
  }

  const providedBytes = hexToBytes(providedSignature);
  if (!providedBytes) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return constantTimeEqual(providedBytes, new Uint8Array(digest));
}

http.route({
  path: "/whatsapp/webhook",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expectedToken: string = await ctx.runAction(
      internal.whatsapp.actions.getWebhookVerifyToken,
      {},
    );

    if (mode !== "subscribe" || token !== expectedToken || !challenge) {
      return new Response("Forbidden", { status: 403 });
    }

    return new Response(challenge, { status: 200 });
  }),
});

http.route({
  path: "/whatsapp/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.text().catch(() => null);
    if (!body) {
      return new Response("Bad Request", { status: 400 });
    }

    const appSecret: string = await ctx.runAction(
      internal.whatsapp.actions.getWebhookAppSecret,
      {},
    );
    const signatureHeader = request.headers.get("x-hub-signature-256");
    if (!(await verifyMetaSignature({ body, appSecret, signatureHeader }))) {
      return new Response("Forbidden", { status: 403 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body) as unknown;
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    await ctx.runAction(internal.whatsapp.actions.processWebhookPayload, {
      payload,
    });

    return Response.json({ received: true });
  }),
});

http.route({
  path: "/api/integrations/hospitable/reservation",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await verifyIntegrationBearerToken(request);
    if (!auth.ok) return auth.response;

    let payload: Record<string, unknown>;
    try {
      payload = (await request.json()) as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: "Invalid JSON body." }, 400);
    }

    const sync = await ctx.runAction(internal.hospitable.actions.syncReservations, {
      daysForward: undefined,
      daysBack: 1,
    });

    return jsonResponse({
      ok: true,
      route: "hospitable/reservation",
      received: {
        eventType: payload?.eventType ?? payload?.event,
        eventId: payload?.eventId ?? payload?.id,
        reservationId: payload?.reservationId,
      },
      sync,
    });
  }),
});

http.route({
  path: "/api/integrations/reconcile/reservations",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await verifyIntegrationBearerToken(request);
    if (!auth.ok) return auth.response;

    let payload: Record<string, unknown> = {};
    try {
      payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    } catch {
      payload = {};
    }

    const daysForward =
      typeof payload.daysForward === "number" ? payload.daysForward : undefined;
    const daysBack = typeof payload.daysBack === "number" ? payload.daysBack : 0;

    const result = await ctx.runAction(internal.hospitable.actions.syncReservations, {
      daysForward,
      daysBack,
    });

    return jsonResponse({
      ok: true,
      route: "reconcile/reservations",
      result,
    });
  }),
});

http.route({
  path: "/api/integrations/hospitable/property-event",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await verifyIntegrationBearerToken(request);
    if (!auth.ok) return auth.response;

    let payload: Record<string, unknown>;
    try {
      payload = (await request.json()) as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: "Invalid JSON body." }, 400);
    }

    const eventType = typeof payload.eventType === "string" ? payload.eventType.toLowerCase() : "";
    const body = (payload.body ?? payload) as Record<string, unknown>;
    const hospitableId =
      (typeof body.propertyId === "string" && body.propertyId) ||
      (typeof body.property_id === "string" && body.property_id) ||
      (typeof body.id === "string" && body.id) ||
      "";

    if (!hospitableId) {
      return jsonResponse({ error: "Missing property id in payload." }, 400);
    }

    if (eventType.includes("delet") || eventType.includes("remov") || eventType.includes("archiv")) {
      const result = await ctx.runMutation(
        internal.hospitable.mutations.softDeletePropertyByHospitableId,
        { hospitableId, reason: `hospitable_event:${eventType}` },
      );
      return jsonResponse({ ok: true, route: "hospitable/property-event", action: result.action });
    }

    // Treat create/update/default as upsert — reconciliation will fill in any gaps within the hour.
    const result = await ctx.runMutation(internal.hospitable.mutations.upsertPropertyFromHospitable, {
      hospitableId,
      name: typeof body.name === "string" ? body.name : typeof body.title === "string" ? body.title : undefined,
      address:
        typeof body.address === "object" && body.address !== null
          ? (body.address as Record<string, unknown>).street as string | undefined
          : undefined,
      city:
        typeof body.address === "object" && body.address !== null
          ? (body.address as Record<string, unknown>).city as string | undefined
          : undefined,
      rooms: [],
    });

    return jsonResponse({ ok: true, route: "hospitable/property-event", action: result.action });
  }),
});

http.route({
  path: "/api/integrations/export/properties",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = await verifyIntegrationBearerToken(request);
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const sinceParam = url.searchParams.get("since");
    const since = sinceParam ? Number(sinceParam) : undefined;
    const includeInactiveParam = url.searchParams.get("includeInactive");
    const includeInactive =
      includeInactiveParam === null ? true : includeInactiveParam === "true";

    const result = await ctx.runQuery(internal.integrations.queries.exportProperties, {
      since: typeof since === "number" && Number.isFinite(since) ? since : undefined,
      includeInactive,
    });

    return jsonResponse({
      ok: true,
      route: "export/properties",
      result,
    });
  }),
});

http.route({
  path: "/api/integrations/reconcile/listings",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await verifyIntegrationBearerToken(request);
    if (!auth.ok) return auth.response;

    const result = await ctx.runAction(internal.hospitable.actions.syncPropertyDetails, {});
    return jsonResponse({
      ok: true,
      route: "reconcile/listings",
      result,
    });
  }),
});

http.route({
  path: "/api/integrations/overrides/apply",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await verifyIntegrationBearerToken(request);
    if (!auth.ok) return auth.response;

    let payload: Record<string, any>;
    try {
      payload = (await request.json()) as Record<string, any>;
    } catch {
      return jsonResponse({ error: "Invalid JSON body." }, 400);
    }

    const target = payload.target;
    const changes = payload.changes;
    const approved = payload.approved === true;
    const approvedBy = typeof payload.approvedBy === "string" ? payload.approvedBy : "";
    const approvedAt = typeof payload.approvedAt === "string" ? payload.approvedAt : "";

    if (!approved) {
      return jsonResponse({ error: "Override must be approved=true." }, 400);
    }

    if (!target || typeof target !== "object" || typeof target.entityId !== "string") {
      return jsonResponse({ error: "Invalid target payload." }, 400);
    }

    if ((target as Record<string, unknown>).entityType !== "property") {
      return jsonResponse(
        { error: "Only property overrides are supported in this handler." },
        400,
      );
    }

    if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
      return jsonResponse({ error: "Invalid changes payload." }, 400);
    }

    const result = await ctx.runMutation(internal.integrations.mutations.applyPropertyOverride, {
      entityId: (target as Record<string, string>).entityId,
      changes,
      approvedBy,
      approvedAt,
      reason: typeof payload.reason === "string" ? payload.reason : undefined,
    });

    return jsonResponse({
      ok: true,
      route: "overrides/apply",
      result,
    });
  }),
});

http.route({
  path: "/api/integrations/knowledge/export",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = await verifyIntegrationBearerToken(request);
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get("limit") ?? "100");
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(500, Math.floor(limitRaw)))
      : 100;

    const snapshot = await ctx.runQuery(internal.integrations.queries.exportKnowledgeSnapshot, {
      limit,
    });

    return jsonResponse(snapshot);
  }),
});

export default http;
