/**
 * Trello webhook receiver.
 *
 * Why this lives in Next.js instead of Convex HTTP:
 *   Convex HTTP routes don't allow the HEAD method. Trello issues a HEAD
 *   request to the callback URL to verify it before activating the webhook,
 *   so the endpoint must accept HEAD. Next.js does, so we host here and
 *   forward the parsed payload to a Convex action.
 *
 * Flow:
 *   HEAD/GET  → 200 (liveness / Trello verification)
 *   POST      → optional HMAC-SHA1 signature check, then forward payload to
 *               convex.integrations.trello.processTrelloWebhookPayload with
 *               a shared secret.
 *
 * Required env:
 *   NEXT_PUBLIC_CONVEX_URL
 *   TRELLO_WEBHOOK_SHARED_SECRET  — must match the Convex env var of the
 *                                   same name
 * Optional env:
 *   TRELLO_API_SECRET             — the "API secret" from Trello power-up
 *                                   admin. When set with CALLBACK_URL,
 *                                   signature verification is enforced.
 *   TRELLO_WEBHOOK_CALLBACK_URL   — the full public URL Trello was registered
 *                                   against (e.g. https://ja-bs.com/api/webhooks/trello)
 */

import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import crypto from "node:crypto";

export const runtime = "nodejs";

async function verifyTrelloSignature(args: {
  body: string;
  apiSecret: string;
  callbackUrl: string;
  signatureHeader: string | null;
}): Promise<boolean> {
  const { body, apiSecret, callbackUrl, signatureHeader } = args;
  if (!signatureHeader) return false;
  const digest = crypto
    .createHmac("sha1", apiSecret)
    .update(body + callbackUrl)
    .digest("base64");
  return crypto.timingSafeEqual(
    Buffer.from(digest),
    Buffer.from(signatureHeader),
  );
}

// Trello HEAD request during webhook creation — respond 200.
export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}

// Occasional liveness check.
export async function GET() {
  return NextResponse.json({ ok: true, service: "trello-webhook" });
}

export async function POST(request: Request) {
  const body = await request.text();

  const apiSecret = process.env.TRELLO_API_SECRET;
  const callbackUrl = process.env.TRELLO_WEBHOOK_CALLBACK_URL;
  if (apiSecret && callbackUrl) {
    const ok = await verifyTrelloSignature({
      body,
      apiSecret,
      callbackUrl,
      signatureHeader: request.headers.get("x-trello-webhook"),
    });
    if (!ok) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body) as unknown;
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const sharedSecret = process.env.TRELLO_WEBHOOK_SHARED_SECRET;
  if (!convexUrl || !sharedSecret) {
    console.error("Trello webhook: missing Convex URL or shared secret");
    return new NextResponse("Server Misconfigured", { status: 500 });
  }

  try {
    const convex = new ConvexHttpClient(convexUrl);
    await convex.action(api.integrations.trello.processTrelloWebhookPayload, {
      payload,
      secret: sharedSecret,
    });
  } catch (err) {
    console.error("Trello webhook: Convex action failed", err);
    // Return 200 anyway so Trello doesn't disable the webhook on transient
    // errors; the action logs will show the failure.
  }

  return NextResponse.json({ received: true });
}
