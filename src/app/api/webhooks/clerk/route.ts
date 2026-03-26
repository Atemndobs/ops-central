import { NextRequest, NextResponse } from "next/server";
import type { WebhookEvent, WebhookEventType } from "@clerk/nextjs/webhooks";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";

type AppRole = "cleaner" | "manager" | "property_ops" | "admin";

const SUPPORTED_EVENTS = new Set<WebhookEventType>([
  "user.created",
  "user.updated",
]);

function parseRole(value: unknown): AppRole | undefined {
  if (
    value === "cleaner" ||
    value === "manager" ||
    value === "property_ops" ||
    value === "admin"
  ) {
    return value;
  }
  return undefined;
}

function normalizeString(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function resolvePrimaryEmail(user: WebhookEvent["data"]): string | null {
  if (!("email_addresses" in user) || !Array.isArray(user.email_addresses)) {
    return null;
  }

  const emailAddresses = user.email_addresses;
  if (emailAddresses.length === 0) {
    return null;
  }

  const primary = emailAddresses.find(
    (email) => email.id === user.primary_email_address_id,
  );

  return (
    normalizeString(primary?.email_address) ??
    normalizeString(emailAddresses[0]?.email_address) ??
    null
  );
}

function resolveName(user: WebhookEvent["data"], email: string): string {
  const firstName = "first_name" in user ? normalizeString(user.first_name) : undefined;
  const lastName = "last_name" in user ? normalizeString(user.last_name) : undefined;
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

  if (fullName.length > 0) {
    return fullName;
  }

  const username = "username" in user ? normalizeString(user.username) : undefined;
  if (username) {
    return username;
  }

  return email.split("@")[0] || "User";
}

function resolveRole(user: WebhookEvent["data"]): AppRole | undefined {
  const fromPublicMetadata =
    "public_metadata" in user &&
    user.public_metadata &&
    typeof user.public_metadata === "object"
      ? parseRole((user.public_metadata as Record<string, unknown>).role)
      : undefined;

  if (fromPublicMetadata) {
    return fromPublicMetadata;
  }

  const fromUnsafeMetadata =
    "unsafe_metadata" in user &&
    user.unsafe_metadata &&
    typeof user.unsafe_metadata === "object"
      ? parseRole((user.unsafe_metadata as Record<string, unknown>).role)
      : undefined;

  return fromUnsafeMetadata;
}

export async function POST(request: NextRequest) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const webhookSyncToken = process.env.CLERK_WEBHOOK_SYNC_TOKEN;

  if (!convexUrl) {
    return NextResponse.json(
      { error: "Missing NEXT_PUBLIC_CONVEX_URL." },
      { status: 500 },
    );
  }

  if (!webhookSyncToken) {
    return NextResponse.json(
      { error: "Missing CLERK_WEBHOOK_SYNC_TOKEN." },
      { status: 500 },
    );
  }

  let event: WebhookEvent;
  try {
    event = await verifyWebhook(request);
  } catch {
    return NextResponse.json(
      { error: "Webhook signature verification failed." },
      { status: 400 },
    );
  }

  if (!SUPPORTED_EVENTS.has(event.type)) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const email = resolvePrimaryEmail(event.data);
  if (!email) {
    return NextResponse.json(
      { error: "Webhook user payload has no email address." },
      { status: 400 },
    );
  }

  const name = resolveName(event.data, email);
  const avatarUrl =
    "image_url" in event.data ? normalizeString(event.data.image_url) : undefined;
  const role = resolveRole(event.data);
  const clerkId =
    "id" in event.data && typeof event.data.id === "string"
      ? event.data.id
      : null;

  if (!clerkId) {
    return NextResponse.json(
      { error: "Webhook payload missing user id." },
      { status: 400 },
    );
  }

  const convex = new ConvexHttpClient(convexUrl);
  await convex.mutation(api.admin.mutations.upsertUserFromClerkWebhook, {
    clerkId,
    email,
    name,
    avatarUrl,
    role,
    webhookToken: webhookSyncToken,
  });

  return NextResponse.json({
    received: true,
    eventType: event.type,
    clerkId,
  });
}
