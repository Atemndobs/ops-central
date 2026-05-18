/**
 * Hospitable v2 webhook receiver.
 *
 * Receives reservation/property/message/review events from Hospitable and
 * forwards them to Convex for idempotent ingestion. Phase 0 of the agentic-OS
 * roadmap (see Docs/2026-05-18-agentic-os-roadmap.md) — currently we act on
 * reservation events only.
 *
 * Flow:
 *   GET   → liveness ping
 *   POST  → 1. read raw body
 *           2. compute HMAC-SHA256(body, HOSPITABLE_WEBHOOK_SECRET)
 *           3. compare against every candidate signature header and log
 *              which header (if any) matched — verification is OBSERVED but
 *              NOT enforced in PR B; the goal is to learn the real header
 *              name from production traffic before flipping to enforced in
 *              PR C
 *           4. dispatch to convex.hospitable.webhooks.ingestEvent which is
 *              idempotent on payload.id
 *           5. always return 200 unless the payload is unparseable, so
 *              Hospitable does not burn retries on our bugs
 *
 * Required env (set in Vercel for Production + Preview):
 *   NEXT_PUBLIC_CONVEX_URL
 *   HOSPITABLE_WEBHOOK_SECRET   — must match Convex env var of the same name
 *
 * Source IPs (Hospitable v2): 38.80.170.0/24. We don't enforce IP allowlist
 * at the application layer — Vercel's firewall can if needed.
 */

import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import crypto from "node:crypto";

export const runtime = "nodejs";

// Hospitable does not document the signature header name. We log which of
// these candidates (if any) carries an HMAC that matches the body, so we can
// pick the real one and enforce in PR C. List ordered by community-SDK guess
// then plain conventions.
const SIGNATURE_HEADER_CANDIDATES = [
  "x-hospitable-signature",
  "x-hospitable-webhook-signature",
  "x-webhook-signature",
  "x-signature",
  "x-signature-sha256",
  "hospitable-signature",
  "signature",
] as const;

type SignatureObservation = {
  /** Header name (if any) whose value matched HMAC(body, secret). */
  matchedHeader: string | null;
  /** All candidate headers we saw values for, with redacted values. */
  observedHeaders: Record<string, string>;
};

function timingSafeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function observeHospitableSignature(args: {
  body: string;
  secret: string;
  headers: Headers;
}): SignatureObservation {
  const { body, secret, headers } = args;
  const expectedHex = crypto.createHmac("sha256", secret).update(body).digest("hex");
  const expectedB64 = crypto.createHmac("sha256", secret).update(body).digest("base64");
  // Hospitable may format the signature header as "<algo>=<digest>" (Stripe-style).
  const expectedHexWithAlgo = `sha256=${expectedHex}`;

  const observedHeaders: Record<string, string> = {};
  let matchedHeader: string | null = null;

  for (const name of SIGNATURE_HEADER_CANDIDATES) {
    const value = headers.get(name);
    if (!value) continue;
    observedHeaders[name] = value;
    if (matchedHeader) continue;
    if (
      timingSafeStringEqual(value, expectedHex) ||
      timingSafeStringEqual(value, expectedB64) ||
      timingSafeStringEqual(value, expectedHexWithAlgo)
    ) {
      matchedHeader = name;
    }
  }

  return { matchedHeader, observedHeaders };
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "hospitable-webhook" });
}

export async function POST(request: Request) {
  const body = await request.text();

  // Try to parse JSON to extract the event id + action even before we hit Convex.
  // Hospitable docs use the field name `action`; payload `id` is the delivery id.
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
    // 400 here — payload is malformed; we don't want Hospitable to keep retrying.
    return new NextResponse("Bad Request: missing payload.id", { status: 400 });
  }

  const secret = process.env.HOSPITABLE_WEBHOOK_SECRET;
  let signatureObservation: SignatureObservation = {
    matchedHeader: null,
    observedHeaders: {},
  };
  if (secret) {
    signatureObservation = observeHospitableSignature({
      body,
      secret,
      headers: request.headers,
    });
  } else {
    console.warn(
      "Hospitable webhook: HOSPITABLE_WEBHOOK_SECRET is unset; signature observation skipped."
    );
  }

  // Structured log for the 24h discovery window (PR B).
  console.log("hospitable-webhook-received", {
    hospitableEventId,
    action,
    signatureMatchedHeader: signatureObservation.matchedHeader,
    signatureObservedHeaderNames: Object.keys(signatureObservation.observedHeaders),
  });

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl || !secret) {
    console.error("Hospitable webhook: missing NEXT_PUBLIC_CONVEX_URL or secret");
    // 200 anyway — config bugs on our side should not cause Hospitable to disable
    // the webhook on us. Surfaced in app logs + (eventually) a "last webhook
    // received" admin counter.
    return NextResponse.json({ received: true });
  }

  try {
    const convex = new ConvexHttpClient(convexUrl);
    await convex.mutation(api.hospitable.webhooks.ingestEvent, {
      secret,
      hospitableEventId,
      action,
      receivedAt: Date.now(),
      rawPayload: payload,
      signatureValid: signatureObservation.matchedHeader !== null,
      signatureHeaders: signatureObservation.observedHeaders,
    });
  } catch (err) {
    console.error("Hospitable webhook: Convex ingest failed", err);
    // 200 anyway so Hospitable doesn't burn retries on transient errors;
    // surface via app logs.
  }

  return NextResponse.json({ received: true });
}
