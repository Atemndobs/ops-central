import { NextResponse, type NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import {
  DEFAULT_ICON_COLOR,
  iconAssetBase,
  isIconColorKey,
  type IconColorKey,
} from "@/lib/brand";

// Recompute against the current admin setting on each request; the redirect
// response itself is cached briefly (below) and the target PNG/SVG is served
// statically from /icons with normal CDN caching.
export const dynamic = "force-dynamic";

/**
 * Color-aware favicon + apple-touch-icon for the admin (Ops) app.
 *
 * The installed-icon color is an org-wide admin setting
 * (`appSettings.installedIconColor`). The manifest route already honors it, but
 * the `<link rel="icon">` favicon and `<link rel="apple-touch-icon">` are what
 * iOS "Add to Home Screen" and Chrome's desktop install dialog actually use —
 * so those must be color-aware too. This route reads the setting and redirects
 * to the matching static asset. `layout.tsx` points the head links here.
 *
 * Same caveat as the manifest: only affects NEW installs / uncached fetches;
 * existing home-screen icons keep their color until reinstalled (iOS caches
 * apple-touch-icons especially hard).
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
  { params }: { params: Promise<{ asset: string }> },
) {
  const { asset } = await params;
  const suffix = ASSET_SUFFIX[asset];
  if (!suffix) {
    return new NextResponse("Not found", { status: 404 });
  }

  let color: IconColorKey = DEFAULT_ICON_COLOR;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (convexUrl) {
    try {
      const client = new ConvexHttpClient(convexUrl);
      const res = await client.query(api.appSettings.getInstalledIconColor, {});
      if (res && isIconColorKey(res.color)) {
        color = res.color;
      }
    } catch {
      // Fall back to the default color if the backend is unreachable.
    }
  }

  const target = new URL(`${iconAssetBase(color)}${suffix}`, req.url);
  return NextResponse.redirect(target, {
    status: 307,
    headers: { "Cache-Control": "public, max-age=300, must-revalidate" },
  });
}
