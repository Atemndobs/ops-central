import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { z } from "zod";
import { ROLE_KEYS } from "@/lib/roles";
import { getPostHogServerClient } from "@/lib/posthog/server";

// This endpoint is upsert — used for both invites AND in-place role updates
// (the role-editor modal on /team posts here too). Accept every role.
const ALLOWED_ROLES = ROLE_KEYS;

const createPayloadSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2),
  role: z.enum(ALLOWED_ROLES as [string, ...string[]]),
  // Treat empty strings as "not provided" — the form sends "" when skipped.
  phone: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  companyId: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});

function splitFullName(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) {
    return { firstName: parts[0] || fullName.trim(), lastName: "" };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function generateTempPassword() {
  return `Tmp!${Math.random().toString(36).slice(2, 10)}A1`;
}

export async function POST(request: Request) {
  const { userId, getToken } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return NextResponse.json(
      { error: "Missing NEXT_PUBLIC_CONVEX_URL." },
      { status: 500 },
    );
  }

  const convex = new ConvexHttpClient(convexUrl);
  const convexToken =
    (await getToken({ template: "convex" }).catch(() => null)) ??
    (await getToken());

  if (!convexToken) {
    return NextResponse.json(
      { error: "Unable to authenticate with Convex." },
      { status: 401 },
    );
  }
  convex.setAuth(convexToken);

  try {
    const requesterProfile = await convex.query(api.users.queries.getMyProfile, {});
    if (process.env.NODE_ENV !== "development" && requesterProfile.role !== "admin") {
      return NextResponse.json(
        { error: "Only admins can manage team members." },
        { status: 403 },
      );
    }

    let payload: z.infer<typeof createPayloadSchema>;
    try {
      const json = await request.json();
      payload = createPayloadSchema.parse(json);
    } catch (err) {
      const issues =
        err instanceof z.ZodError
          ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
          : undefined;
      console.error("team-members POST validation failed", issues ?? err);
      return NextResponse.json(
        { error: "Invalid request payload.", issues },
        { status: 400 },
      );
    }

    const { firstName, lastName } = splitFullName(payload.fullName);
    const clerk = await clerkClient();

    const existingUsers = await clerk.users.getUserList({
      emailAddress: [payload.email],
      limit: 1,
    });

    let clerkUser = existingUsers.data[0];

    if (clerkUser) {
      clerkUser = await clerk.users.updateUser(clerkUser.id, {
        firstName,
        lastName: lastName || undefined,
        publicMetadata: {
          ...(clerkUser.publicMetadata ?? {}),
          role: payload.role as (typeof ALLOWED_ROLES)[number],
        },
      });
    } else {
      try {
        clerkUser = await clerk.users.createUser({
          emailAddress: [payload.email],
          firstName,
          lastName: lastName || undefined,
          skipPasswordRequirement: true,
          skipPasswordChecks: true,
          publicMetadata: { role: payload.role },
        });
      } catch {
        clerkUser = await clerk.users.createUser({
          emailAddress: [payload.email],
          firstName,
          lastName: lastName || undefined,
          password: generateTempPassword(),
          skipPasswordChecks: true,
          publicMetadata: { role: payload.role },
        });
      }
    }

    const existingConvexUser = await convex.query(
      api.users.queries.getByClerkId,
      { clerkId: clerkUser.id },
    );

    if (existingConvexUser?._id) {
      await convex.mutation(
        api.admin.mutations.updateUser,
        {
          id: existingConvexUser._id as never,
          name: payload.fullName,
          email: payload.email,
          phone: payload.phone,
          role: payload.role as (typeof ALLOWED_ROLES)[number],
        },
      );
    } else {
      await convex.mutation(
        api.admin.mutations.createUser,
        {
          clerkId: clerkUser.id,
          email: payload.email,
          name: payload.fullName,
          phone: payload.phone,
          role: payload.role as (typeof ALLOWED_ROLES)[number],
        },
      );
    }

    // Optional company attach
    let attachedCompanyId: string | null = null;
    if (payload.companyId && (payload.role === "cleaner" || payload.role === "manager")) {
      const convexUserAfter = await convex.query(api.users.queries.getByClerkId, {
        clerkId: clerkUser.id,
      });
      if (convexUserAfter?._id) {
        try {
          await convex.mutation(api.admin.mutations.assignUserCompanyMembership, {
            userId: convexUserAfter._id as never,
            companyId: payload.companyId as never,
          });
          attachedCompanyId = payload.companyId;
        } catch (e) {
          console.error("Failed to attach new user to company", e);
        }
      }
    }

    const posthog = getPostHogServerClient();
    posthog.capture({
      distinctId: userId,
      event: "team_member_created",
      properties: {
        role: payload.role,
        has_company: !!attachedCompanyId,
        is_new_clerk_user: !existingConvexUser?._id,
      },
    });
    await posthog.flush();

    return NextResponse.json({
      success: true,
      clerkUserId: clerkUser.id,
      email: payload.email,
      role: payload.role,
      companyId: attachedCompanyId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create team member.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const deletePayloadSchema = z.object({
  userId: z.string().min(1),
});

/**
 * Permanently remove a team member.
 *
 * Order matters: Convex deletes FIRST (its reference check refuses to
 * orphan operational history and is transactional), and only if that
 * succeeds do we delete the identity from Clerk. If the Clerk delete
 * fails we still return success for the Convex removal but surface a
 * warning so the admin can finish the job in the Clerk dashboard.
 */
export async function DELETE(request: Request) {
  const { userId, getToken } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return NextResponse.json(
      { error: "Missing NEXT_PUBLIC_CONVEX_URL." },
      { status: 500 },
    );
  }

  const convex = new ConvexHttpClient(convexUrl);
  const convexToken =
    (await getToken({ template: "convex" }).catch(() => null)) ??
    (await getToken());
  if (!convexToken) {
    return NextResponse.json(
      { error: "Unable to authenticate with Convex." },
      { status: 401 },
    );
  }
  convex.setAuth(convexToken);

  let payload: z.infer<typeof deletePayloadSchema>;
  try {
    payload = deletePayloadSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: "A userId is required to delete a team member." },
      { status: 400 },
    );
  }

  try {
    const requesterProfile = await convex.query(
      api.users.queries.getMyProfile,
      {},
    );
    if (
      process.env.NODE_ENV !== "development" &&
      requesterProfile.role !== "admin"
    ) {
      return NextResponse.json(
        { error: "Only admins can delete team members." },
        { status: 403 },
      );
    }

    // 1) Convex removal — reference-safe, transactional. Throws if blocked.
    const result = await convex.mutation(api.admin.mutations.deleteUser, {
      userId: payload.userId as Id<"users">,
    });

    // 2) Best-effort Clerk identity removal.
    let clerkDeleted = false;
    let clerkWarning: string | undefined;
    if (result.clerkId) {
      try {
        const client = await clerkClient();
        await client.users.deleteUser(result.clerkId);
        clerkDeleted = true;
      } catch (clerkError) {
        clerkWarning =
          "Removed from the app, but the Clerk login could not be deleted. " +
          "Remove them manually in the Clerk dashboard.";
        console.error("Clerk user delete failed", clerkError);
      }
    }

    const posthog = getPostHogServerClient();
    posthog.capture({
      distinctId: userId,
      event: "team_member_deleted",
      properties: {
        clerk_deleted: clerkDeleted,
      },
    });
    await posthog.flush();

    return NextResponse.json({
      success: true,
      clerkDeleted,
      clerkWarning,
      name: result.name,
      email: result.email,
    });
  } catch (error) {
    // ConvexError carries the human-readable reason in `.data`.
    const message =
      error instanceof ConvexError
        ? String(error.data)
        : error instanceof Error
          ? error.message
          : "Failed to delete team member.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
