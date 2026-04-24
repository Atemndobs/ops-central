import { clerkClient, clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { locales, roleDefaultLocale, type Locale } from "@/i18n";
import {
  USER_ROLES,
  canAccessPath,
  getDefaultRouteForRole,
  getRoleFromMetadata,
  getRoleFromSessionClaimsOrNull,
  type UserRole,
} from "@/lib/auth";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/sso-callback(.*)",
  "/api/webhooks/hospitable(.*)",
  "/api/webhooks/clerk(.*)",
  "/api/webhooks/trello(.*)",
  ...(process.env.NODE_ENV !== "production" ? ["/playground(.*)"] : []),
]);

function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && USER_ROLES.includes(value as UserRole);
}

async function getRoleFromConvexByClerkId(clerkId: string): Promise<UserRole | null> {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    console.error(
      "[ProxyAuth] NEXT_PUBLIC_CONVEX_URL is not set — cannot resolve role from Convex",
    );
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
      console.error(
        `[ProxyAuth] Convex role lookup for ${clerkId} returned HTTP ${response.status}`,
      );
      return null;
    }

    const payload = (await response.json()) as {
      status?: string;
      value?: unknown;
    };

    if (payload.status !== "success" || !payload.value || typeof payload.value !== "object") {
      console.error(
        `[ProxyAuth] Convex returned no user row for clerkId=${clerkId}`,
        payload.status,
      );
      return null;
    }

    const role = (payload.value as Record<string, unknown>).role;
    if (!isUserRole(role)) {
      console.error(
        `[ProxyAuth] Convex user row for clerkId=${clerkId} has invalid/missing role`,
        role,
      );
      return null;
    }
    return role;
  } catch (error) {
    console.error("[ProxyAuth] Failed to resolve role from Convex", error);
    return null;
  }
}

async function getRoleFromClerkMetadata(clerkId: string): Promise<UserRole | null> {
  try {
    const clerk = await clerkClient();
    const user = await clerk.users.getUser(clerkId);
    const role = getRoleFromMetadata(user.publicMetadata);
    if (!role) {
      console.error(
        `[ProxyAuth] Clerk publicMetadata for clerkId=${clerkId} has no role`,
        user.publicMetadata,
      );
    }
    return role;
  } catch (error) {
    console.error("[ProxyAuth] Failed to resolve role from Clerk metadata", error);
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

  const response = NextResponse.next();

  const claims = sessionClaims as Record<string, unknown> | null;
  const roleFromClaims = getRoleFromSessionClaimsOrNull(claims);

  // Set locale cookie based on user role (will be refined in Phase 2 with Convex preference)
  const locale = (roleFromClaims && roleDefaultLocale[roleFromClaims]) || "en";

  if (!req.cookies.get("NEXT_LOCALE")) {
    response.cookies.set("NEXT_LOCALE", locale, {
      maxAge: 31536000, // 1 year
      httpOnly: false, // Allow client-side access for language switcher
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });
  }
  const roleFromClerkMetadata = roleFromClaims
    ? null
    : await getRoleFromClerkMetadata(userId);
  const roleFromConvex = roleFromClaims || roleFromClerkMetadata
    ? null
    : await getRoleFromConvexByClerkId(userId);
  const resolvedRole =
    roleFromClaims ?? roleFromClerkMetadata ?? roleFromConvex ?? null;
  const pathname = req.nextUrl.pathname;

  // Fail closed: if we can't resolve the user's role from any source, do not
  // fall back to a privileged role. Send them to sign-in with an error flag so
  // they can't accidentally land on admin routes.
  if (!resolvedRole) {
    console.error(
      `[ProxyAuth] Unable to resolve role for userId=${userId}; redirecting to sign-in. ` +
        `Check: Clerk JWT template role claim, publicMetadata.role, and Convex users row for this clerkId.`,
    );
    const url = req.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = "?authError=role_unresolved";
    return NextResponse.redirect(url);
  }

  const role: UserRole = resolvedRole;

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

  return response;
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
