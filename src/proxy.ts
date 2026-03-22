import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  canAccessPath,
  getDefaultRouteForRole,
  getRoleFromSessionClaims,
} from "@/lib/auth";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();

    const { sessionClaims } = await auth();
    const role = getRoleFromSessionClaims(
      sessionClaims as Record<string, unknown> | null,
    );

    if (!canAccessPath(role, request.nextUrl.pathname)) {
      return NextResponse.redirect(
        new URL(getDefaultRouteForRole(role), request.url),
      );
    }
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
