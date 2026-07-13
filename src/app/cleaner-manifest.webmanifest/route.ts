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
 * Dynamic manifest for the Cleaner PWA (scope /cleaner). Icons follow the
 * admin-selected color for the "cleaner" app; the light theme is preserved.
 */
export async function GET() {
  let color: IconColorKey = APP_ICON_DEFAULT.cleaner;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (convexUrl) {
    try {
      const client = new ConvexHttpClient(convexUrl);
      const res = await client.query(api.appSettings.getInstalledIconColor, {
        app: "cleaner",
      });
      if (res && isIconColorKey(res.color)) color = res.color;
    } catch {
      // keep default
    }
  }
  const base = iconAssetBase(color);

  const manifest = {
    name: "ChezSoi Ops — Cleaner",
    short_name: "Cleaner",
    description:
      "ChezSoi Ops workspace for assigned jobs, photos, and incident reports.",
    id: "/cleaner",
    start_url: "/cleaner",
    scope: "/cleaner",
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
      { name: "My Jobs", short_name: "Jobs", url: "/cleaner" },
      { name: "History", short_name: "History", url: "/cleaner/history" },
      { name: "New Incident", short_name: "Incident", url: "/cleaner/incidents/new" },
    ],
  };

  return NextResponse.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=300, must-revalidate",
    },
  });
}
