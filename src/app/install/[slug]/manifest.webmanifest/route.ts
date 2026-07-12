import { NextResponse, type NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import {
  INSTALL_SLUG_ROLE,
  ROLE_ICON_COLOR,
  ROLE_META,
  iconAssetBase,
  iconColorHex,
  isInstallSlug,
  isIconColorKey,
  type BrandRole,
  type IconColorKey,
} from "@/lib/brand";

export const dynamic = "force-dynamic";

/**
 * Per-role install manifest. Admin, Ops, and Manager share the Ops dashboard, so
 * a shared manifest can't give them distinct home-screen icons. Installing from
 * /install/<slug> uses THIS manifest — a distinct `id` + the role's icon — while
 * `start_url` still opens the normal dashboard.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!isInstallSlug(slug)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const role: BrandRole = INSTALL_SLUG_ROLE[slug];

  let color: IconColorKey = ROLE_ICON_COLOR[role];
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (convexUrl) {
    try {
      const client = new ConvexHttpClient(convexUrl);
      const colors = await client.query(api.appSettings.getRoleIconColors, {});
      const c = colors?.[role];
      if (isIconColorKey(c)) color = c;
    } catch {
      // keep default
    }
  }

  const base = iconAssetBase(color);
  const hex = iconColorHex(color);
  const label = ROLE_META[role].label;

  const manifest = {
    name: `ChezSoi Ops · ${label}`,
    short_name: label,
    description: "ChezSoi property operations dashboard.",
    id: `/install/${slug}`,
    start_url: "/",
    scope: "/",
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
