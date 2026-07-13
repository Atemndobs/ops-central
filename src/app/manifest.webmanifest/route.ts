import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import {
  DEFAULT_ICON_COLOR,
  iconAssetBase,
  iconColorHex,
  isIconColorKey,
  type IconColorKey,
} from "@/lib/brand";

// Always recompute against the current admin setting; the CDN/browser still
// caches the response for a few minutes (see Cache-Control below).
export const dynamic = "force-dynamic";

/**
 * Dynamic PWA manifest for the admin app. The installed home-screen icon color
 * is an org-wide admin setting (`appSettings.installedIconColor`), so this route
 * reads it and points the manifest at the matching icon set. Switching the color
 * in Settings affects NEW installs; existing installs keep their icon until
 * reinstalled (browsers cache the manifest aggressively).
 */
export async function GET() {
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
      // Fall back to the default color if the backend is unreachable — a
      // missing manifest would break installability entirely.
    }
  }

  const hex = iconColorHex(color);
  const base = iconAssetBase(color);

  const manifest = {
    name: "Ops",
    short_name: "Ops",
    description: "ChezSoi property operations management",
    start_url: "/",
    display: "standalone",
    background_color: hex,
    theme_color: hex,
    icons: [
      { src: `${base}.svg`, type: "image/svg+xml", sizes: "any" },
      { src: `${base}-192.png`, type: "image/png", sizes: "192x192" },
      { src: `${base}-512.png`, type: "image/png", sizes: "512x512" },
      {
        src: `${base}-maskable-512.png`,
        type: "image/png",
        sizes: "512x512",
        purpose: "maskable",
      },
    ],
  };

  return NextResponse.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=300, must-revalidate",
    },
  });
}
