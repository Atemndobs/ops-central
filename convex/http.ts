import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

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
    const payload = await request.json().catch(() => null);
    if (!payload) {
      return new Response("Bad Request", { status: 400 });
    }

    await ctx.runAction(internal.whatsapp.actions.processWebhookPayload, {
      payload,
    });

    return Response.json({ received: true });
  }),
});

export default http;
