import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import { z } from "zod";

const createPayloadSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2),
  role: z.union([
    z.literal("cleaner"),
    z.literal("manager"),
    z.literal("property_ops"),
    z.literal("admin"),
  ]),
  phone: z.string().optional(),
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
  const { userId, sessionClaims, getToken } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roleFromClaims =
    (sessionClaims?.role as string | undefined) ??
    (sessionClaims?.metadata as { role?: string } | undefined)?.role ??
    (sessionClaims?.publicMetadata as { role?: string } | undefined)?.role;

  if (process.env.NODE_ENV !== "development" && roleFromClaims !== "admin") {
    return NextResponse.json(
      { error: "Only admins can add team members." },
      { status: 403 },
    );
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return NextResponse.json(
      { error: "Missing NEXT_PUBLIC_CONVEX_URL." },
      { status: 500 },
    );
  }

  let payload: z.infer<typeof createPayloadSchema>;
  try {
    const json = await request.json();
    payload = createPayloadSchema.parse(json);
  } catch {
    return NextResponse.json(
      { error: "Invalid request payload." },
      { status: 400 },
    );
  }

  const { firstName, lastName } = splitFullName(payload.fullName);
  const clerk = await clerkClient();

  try {
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
          role: payload.role,
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
          role: payload.role,
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
          role: payload.role,
        },
      );
    }

    return NextResponse.json({
      success: true,
      clerkUserId: clerkUser.id,
      email: payload.email,
      role: payload.role,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create team member.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

