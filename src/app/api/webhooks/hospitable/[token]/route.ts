/**
 * Hospitable v2 webhook receiver — URL-token auth.
 *
 * Hospitable does NOT sign webhook payloads (confirmed via the official help
 * doc: https://help.hospitable.com/en/articles/10008203 — the dashboard's
 * "Add webhook" form exposes only name + URL + event types, no signing-secret
 * field, and the help article documents only Content-Type + 200-OK as the
 * transport contract). Therefore we authenticate via a secret in the URL
 * path itself: only requests POSTed to
 *
 *     /api/webhooks/hospitable/<HOSPITABLE_WEBHOOK_URL_TOKEN>
 *
 * are accepted. Any other token (or none) returns 404 — we deliberately do
 * not 401, so the endpoint's existence is unobservable from the outside.
 *
 * Defense in depth: the Convex `ingestEvent` mutation still requires a second
 * shared secret (`HOSPITABLE_WEBHOOK_SECRET`) because the Convex deployment
 * URL is public.
 *
 * Required env (Vercel Production + Preview):
 *   NEXT_PUBLIC_CONVEX_URL
 *   HOSPITABLE_WEBHOOK_URL_TOKEN — path-segment token, must match the URL
 *                                  pasted into the Hospitable dashboard
 *   HOSPITABLE_WEBHOOK_SECRET    — Next→Convex shared secret, must match the
 *                                  Convex env var of the same name
 *
 * We keep a transient block that logs all observed request headers on the
 * first N deliveries so we can empirically confirm Hospitable really sends
 * no signature header. After confirmation we'll drop this in a follow-up.
 *
 * Source IPs (Hospitable v2): 38.80.170.0/24. We don't enforce IP allowlist
 * at the application layer — Vercel's firewall can if needed.
 */

import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import crypto from "node:crypto";
import { getPostHogServerClient } from "@/lib/posthog/server";

export const runtime = "nodejs";

function timingSafeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Collect a small, redacted snapshot of request headers for empirical study. */
function snapshotHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    // Skip Vercel/Next infrastructure noise. We care about what Hospitable
    // chooses to send.
    if (name.startsWith("x-vercel-")) return;
    if (name.startsWith("x-forwarded-")) return;
    if (name === "cookie") return;
    out[name] = value;
  });
  return out;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  // Liveness ping — does NOT reveal whether the token is valid.
  const { token } = await params;
  const expected = process.env.HOSPITABLE_WEBHOOK_URL_TOKEN;
  if (!expected || !timingSafeStringEqual(token, expected)) {
    return new NextResponse("Not Found", { status: 404 });
  }
  return NextResponse.json({ ok: true, service: "hospitable-webhook" });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const expected = process.env.HOSPITABLE_WEBHOOK_URL_TOKEN;

  // Authenticate via path token. 404 (not 401) so we don't advertise the route.
  if (!expected) {
    console.error("Hospitable webhook: HOSPITABLE_WEBHOOK_URL_TOKEN unset");
    return new NextResponse("Not Found", { status: 404 });
  }
  if (!timingSafeStringEqual(token, expected)) {
    console.warn("Hospitable webhook: bad URL token", { len: token.length });
    return new NextResponse("Not Found", { status: 404 });
  }

  const body = await request.text();

  let payload: { id?: string; action?: string } & Record<string, unknown>;
  try {
    payload = JSON.parse(body) as typeof payload;
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const hospitableEventId =
    typeof payload.id === "string" && payload.id.length > 0 ? payload.id : null;
  const action =
    typeof payload.action === "string" && payload.action.length > 0
      ? payload.action
      : "unknown";

  if (!hospitableEventId) {
    console.error("Hospitable webhook: payload missing id", { action });
    return new NextResponse("Bad Request: missing payload.id", { status: 400 });
  }

  // Transient: snapshot all incoming headers (minus infra noise) so we can
  // verify the no-signature hypothesis from real Hospitable traffic.
  const observedHeaders = snapshotHeaders(request.headers);

  console.log("hospitable-webhook-received", {
    hospitableEventId,
    action,
    observedHeaderNames: Object.keys(observedHeaders),
  });

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const ingestSecret = process.env.HOSPITABLE_WEBHOOK_SECRET;
  if (!convexUrl || !ingestSecret) {
    console.error(
      "Hospitable webhook: missing NEXT_PUBLIC_CONVEX_URL or HOSPITABLE_WEBHOOK_SECRET",
    );
    // 200 anyway — config bugs on our side should not cause Hospitable to
    // disable the webhook. We surface via app logs.
    return NextResponse.json({ received: true });
  }

  try {
    const convex = new ConvexHttpClient(convexUrl);
    await convex.mutation(api.hospitable.webhooks.ingestEvent, {
      secret: ingestSecret,
      hospitableEventId,
      action,
      receivedAt: Date.now(),
      rawPayload: payload,
      // No HMAC any more — signature was a wrong assumption (see header).
      // We persist the observed header snapshot for one more deploy so we
      // can confirm empirically that no signature header is sent.
      signatureValid: undefined,
      signatureHeaders: observedHeaders,
    });

    const posthog = getPostHogServerClient();
    posthog.capture({
      distinctId: "hospitable-webhook",
      event: "hospitable_webhook_received",
      properties: {
        action,
        hospitable_event_id: hospitableEventId,
      },
    });
    await posthog.flush();
  } catch (err) {
    console.error("Hospitable webhook: Convex ingest failed", err);
  }

  return NextResponse.json({ received: true });
}
