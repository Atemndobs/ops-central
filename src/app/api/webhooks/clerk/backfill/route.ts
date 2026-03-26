import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";

type AppRole = "cleaner" | "manager" | "property_ops" | "admin";

type ClerkDirectoryUser = {
  clerkId: string;
  email: string;
  name?: string;
  role?: AppRole;
  avatarUrl?: string;
};

function normalizeString(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

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

function fromClerkUser(user: {
  id: string;
  emailAddresses: Array<{ id: string; emailAddress: string }>;
  primaryEmailAddressId: string | null;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  imageUrl: string;
  publicMetadata: Record<string, unknown>;
  unsafeMetadata: Record<string, unknown>;
}): ClerkDirectoryUser | null {
  const primary =
    user.emailAddresses.find(
      (email) => email.id === user.primaryEmailAddressId,
    ) ?? user.emailAddresses[0];

  const email = normalizeString(primary?.emailAddress)?.toLowerCase();
  if (!email) {
    return null;
  }

  const firstName = normalizeString(user.firstName);
  const lastName = normalizeString(user.lastName);
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const username = normalizeString(user.username);

  const role =
    parseRole(user.publicMetadata?.role) ??
    parseRole(user.unsafeMetadata?.role);

  return {
    clerkId: user.id,
    email,
    name: fullName || username || email.split("@")[0],
    role,
    avatarUrl: normalizeString(user.imageUrl),
  };
}

export async function POST(request: Request) {
  const expectedToken =
    process.env.CLERK_BACKFILL_TOKEN ?? process.env.CLERK_WEBHOOK_SYNC_TOKEN;
  const providedToken = request.headers.get("x-backfill-token")?.trim();

  if (!expectedToken) {
    return NextResponse.json(
      { error: "Missing CLERK_BACKFILL_TOKEN or CLERK_WEBHOOK_SYNC_TOKEN." },
      { status: 500 },
    );
  }

  if (!providedToken || providedToken !== expectedToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return NextResponse.json(
      { error: "Missing NEXT_PUBLIC_CONVEX_URL." },
      { status: 500 },
    );
  }

  const clerk = await clerkClient();
  const clerkUsers: ClerkDirectoryUser[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const page = await clerk.users.getUserList({
      limit,
      offset,
      orderBy: "created_at",
    });

    for (const user of page.data) {
      const normalized = fromClerkUser(user);
      if (normalized) {
        clerkUsers.push(normalized);
      }
    }

    if (page.data.length < limit) {
      break;
    }

    offset += page.data.length;
  }

  if (clerkUsers.length === 0) {
    return NextResponse.json({
      success: true,
      message: "No Clerk users found for reconciliation.",
    });
  }

  const convex = new ConvexHttpClient(convexUrl);
  const result = await convex.mutation(api.admin.userSync.reconcileWithClerk, {
    clerkUsers,
    dryRun: false,
    pruneUnmatched: false,
    webhookToken: expectedToken,
  });

  return NextResponse.json({
    success: true,
    processed: clerkUsers.length,
    result,
  });
}
