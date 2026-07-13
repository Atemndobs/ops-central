import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import {
  APP_ICON_DEFAULT,
  iconAssetBase,
  isIconColorKey,
  type IconColorKey,
} from "@/lib/brand";

export const dynamic = "force-dynamic";

/**
 * Dynamic manifest for the Owner PWA (scope /owner). Icons follow the
 * admin-selected color for the "owner" app; the light theme is preserved.
 */
export async function GET() {
  let color: IconColorKey = APP_ICON_DEFAULT.owner;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (convexUrl) {
    try {
      const client = new ConvexHttpClient(convexUrl);
      const res = await client.query(api.appSettings.getInstalledIconColor, {
        app: "owner",
      });
      if (res && isIconColorKey(res.color)) color = res.color;
    } catch {
      // keep default
    }
  }
  const base = iconAssetBase(color);

  const manifest = {
    name: "ChezSoi Ops — Owner",
    short_name: "Owner",
    description:
      "Radical financial transparency for property owners. Every line on your statement is a clickable receipt.",
    id: "/owner",
    start_url: "/owner",
    scope: "/owner",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f3f7ff",
    theme_color: "#f3f7ff",
    icons: [
      { src: `${base}-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${base}-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${base}-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Home", short_name: "Home", url: "/owner" },
      { name: "Properties", short_name: "Properties", url: "/owner/properties" },
      { name: "Date Blocks", short_name: "Blocks", url: "/owner/blocks" },
    ],
  };

  return NextResponse.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=300, must-revalidate",
    },
  });
}
