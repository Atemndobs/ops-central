import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import { z } from "zod";
import { ROLE_KEYS } from "@/lib/roles";

// Invite flow currently cannot create owner accounts via this API; owner
// onboarding happens through the owner portal. Filter to invite-eligible roles.
const INVITE_ROLES = ROLE_KEYS.filter((r) => r !== "owner") as Array<
  Exclude<(typeof ROLE_KEYS)[number], "owner">
>;

const createPayloadSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2),
  role: z.enum(INVITE_ROLES as [string, ...string[]]),
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
          role: payload.role as (typeof INVITE_ROLES)[number],
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
          role: payload.role as (typeof INVITE_ROLES)[number],
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
          role: payload.role as (typeof INVITE_ROLES)[number],
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
