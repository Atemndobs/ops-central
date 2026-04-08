import { clerkClient, clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  USER_ROLES,
  canAccessPath,
  getDefaultRouteForRole,
  getRoleFromMetadata,
  getRoleFromSessionClaims,
  getRoleFromSessionClaimsOrNull,
  type UserRole,
} from "@/lib/auth";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/sso-callback(.*)",
  "/api/webhooks/hospitable(.*)",
  "/api/webhooks/clerk(.*)",
]);

function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && USER_ROLES.includes(value as UserRole);
}

async function getRoleFromConvexByClerkId(clerkId: string): Promise<UserRole | null> {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return null;
  }

  try {
    const response = await fetch(`${convexUrl}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "users/queries:getByClerkId",
        args: { clerkId },
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      status?: string;
      value?: unknown;
    };

    if (payload.status !== "success" || !payload.value || typeof payload.value !== "object") {
      return null;
    }

    const role = (payload.value as Record<string, unknown>).role;
    return isUserRole(role) ? role : null;
  } catch (error) {
    console.warn("[ProxyAuth] Failed to resolve role from Convex", error);
    return null;
  }
}

async function getRoleFromClerkMetadata(clerkId: string): Promise<UserRole | null> {
  try {
    const clerk = await clerkClient();
    const user = await clerk.users.getUser(clerkId);
    return getRoleFromMetadata(user.publicMetadata);
  } catch (error) {
    console.warn("[ProxyAuth] Failed to resolve role from Clerk metadata", error);
    return null;
  }
}

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) {
    return NextResponse.next();
  }

  const { userId, sessionClaims, redirectToSignIn } = await auth();

  if (!userId) {
    return redirectToSignIn({ returnBackUrl: req.url });
  }

  const claims = sessionClaims as Record<string, unknown> | null;
  const roleFromClaims = getRoleFromSessionClaimsOrNull(claims);
  const roleFromClerkMetadata = roleFromClaims
    ? null
    : await getRoleFromClerkMetadata(userId);
  const roleFromConvex = roleFromClaims || roleFromClerkMetadata
    ? null
    : await getRoleFromConvexByClerkId(userId);
  const role =
    roleFromClaims ??
    roleFromClerkMetadata ??
    roleFromConvex ??
    getRoleFromSessionClaims(claims);
  const pathname = req.nextUrl.pathname;

  if (role === "cleaner" && (pathname === "/jobs" || pathname.startsWith("/jobs/"))) {
    const url = req.nextUrl.clone();
    url.pathname = "/cleaner";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (role === "admin" && (pathname === "/review" || pathname.startsWith("/review/"))) {
    const url = req.nextUrl.clone();
    url.pathname = "/jobs";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (!canAccessPath(role, pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = getDefaultRouteForRole(role);
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
