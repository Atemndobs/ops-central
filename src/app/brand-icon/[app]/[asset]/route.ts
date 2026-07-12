import { NextResponse, type NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import {
  APP_ICON_DEFAULT,
  iconAssetBase,
  isIconApp,
  isIconColorKey,
  type IconApp,
  type IconColorKey,
} from "@/lib/brand";

// Recompute against the current admin setting on each request; the redirect
// response is cached briefly (below) and the target asset is served statically
// from /icons with normal CDN caching.
export const dynamic = "force-dynamic";

/**
 * Color-aware favicon + apple-touch-icon for a given installable app
 * (ops | cleaner | owner). Each app's installed-icon color is an admin setting
 * (`appSettings` per-app fields). iOS "Add to Home Screen" and Chrome's install
 * dialog use the `<link>` icons — so those must follow the setting too. This
 * route reads the app's color and redirects to the matching static asset.
 * Each app's layout points its head links here.
 *
 * Same caveat as the manifest: only affects new installs / uncached fetches.
 */

// Requested asset name → suffix on `/icons/app-icon-<color>`.
const ASSET_SUFFIX: Record<string, string> = {
  "favicon.svg": ".svg",
  "icon-192.png": "-192.png",
  "icon-512.png": "-512.png",
  "apple-touch.png": "-apple-touch.png",
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ app: string; asset: string }> },
) {
  const { app, asset } = await params;
  const suffix = ASSET_SUFFIX[asset];
  if (!suffix || !isIconApp(app)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const appKey: IconApp = app;
  let color: IconColorKey = APP_ICON_DEFAULT[appKey];
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (convexUrl) {
    try {
      const client = new ConvexHttpClient(convexUrl);
      const res = await client.query(api.appSettings.getInstalledIconColor, {
        app: appKey,
      });
      if (res && isIconColorKey(res.color)) {
        color = res.color;
      }
    } catch {
      // Fall back to the app's default color if the backend is unreachable.
    }
  }

  const target = new URL(`${iconAssetBase(color)}${suffix}`, req.url);
  return NextResponse.redirect(target, {
    status: 307,
    headers: { "Cache-Control": "public, max-age=300, must-revalidate" },
  });
}
