import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import {
  INSTALL_SLUG_ROLE,
  ROLE_ICON_COLOR,
  ROLE_META,
  iconAssetBase,
  iconColorHex,
  isIconColorKey,
  isInstallSlug,
  type BrandRole,
  type IconColorKey,
} from "@/lib/brand";
import { StandaloneRedirect } from "./standalone-redirect";

export const dynamic = "force-dynamic";

async function resolveColor(role: BrandRole): Promise<IconColorKey> {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return ROLE_ICON_COLOR[role];
  try {
    const client = new ConvexHttpClient(convexUrl);
    const colors = await client.query(api.appSettings.getRoleIconColors, {});
    const c = colors?.[role];
    return isIconColorKey(c) ? c : ROLE_ICON_COLOR[role];
  } catch {
    return ROLE_ICON_COLOR[role];
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isInstallSlug(slug)) return { title: "Install" };
  const role = INSTALL_SLUG_ROLE[slug];
  const color = await resolveColor(role);
  const base = iconAssetBase(color);
  const label = ROLE_META[role].label;

  return {
    title: `Install ChezSoi Ops · ${label}`,
    description: `Add the ${label} app to your home screen.`,
    manifest: `/install/${slug}/manifest.webmanifest`,
    // Direct static assets (no redirect) so iOS grabs the right apple-touch-icon.
    icons: {
      icon: [
        { url: `${base}.svg`, type: "image/svg+xml" },
        { url: `${base}-192.png`, sizes: "192x192", type: "image/png" },
        { url: `${base}-512.png`, sizes: "512x512", type: "image/png" },
      ],
      apple: [{ url: `${base}-apple-touch.png`, sizes: "180x180" }],
    },
    appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: label },
  };
}

export default async function InstallPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isInstallSlug(slug)) notFound();
  const role = INSTALL_SLUG_ROLE[slug];
  const color = await resolveColor(role);
  const base = iconAssetBase(color);
  const hex = iconColorHex(color);
  const label = ROLE_META[role].label;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-6 py-12 text-center">
      <StandaloneRedirect />

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`${base}-192.png`}
        alt={`${label} app icon`}
        width={96}
        height={96}
        className="h-24 w-24 rounded-[22%] shadow-lg"
      />

      <div>
        <h1 className="text-2xl font-bold">ChezSoi Ops</h1>
        <p
          className="mt-1 inline-block rounded-full px-3 py-0.5 text-sm font-semibold text-white"
          style={{ backgroundColor: hex }}
        >
          {label}
        </p>
      </div>

      <p className="text-sm text-gray-500">
        Add this to your home screen to install the {label} app with its own icon.
        It opens the normal dashboard.
      </p>

      <div className="w-full space-y-4 text-left">
        <div className="rounded-xl border p-4">
          <p className="mb-1 text-sm font-semibold">iPhone / iPad (Safari)</p>
          <p className="text-sm text-gray-500">
            Tap the <span className="font-semibold">Share</span> button, then{" "}
            <span className="font-semibold">Add to Home Screen</span>.
          </p>
        </div>
        <div className="rounded-xl border p-4">
          <p className="mb-1 text-sm font-semibold">Android / Desktop (Chrome)</p>
          <p className="text-sm text-gray-500">
            Open the browser menu and choose{" "}
            <span className="font-semibold">Install app</span> (or the install icon
            in the address bar).
          </p>
        </div>
      </div>

      <a
        href="/"
        className="mt-2 rounded-lg px-4 py-2 text-sm font-semibold text-white"
        style={{ backgroundColor: hex }}
      >
        Open the dashboard →
      </a>
    </main>
  );
}
