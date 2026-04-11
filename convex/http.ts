import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

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

export default http;
