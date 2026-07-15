import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n.ts");

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/array/:path*",
        destination: "https://us-assets.i.posthog.com/array/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
  skipTrailingSlashRedirect: true,
  turbopack: {
    root: __dirname,
  },
  images: {
    // Serve images directly, bypassing Vercel's Image Optimization. The account's
    // optimizer quota gets exhausted (/_next/image returns 402), which breaks
    // EVERY next/image on the site — the sidebar logo, property photos, avatars.
    // These images are already appropriately sized / come from CDNs (B2, Clerk,
    // Hospitable), so on-the-fly optimization adds no real benefit here and just
    // reintroduces the 402 failure mode.
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "*.convex.cloud" },
      { protocol: "https", hostname: "img.clerk.com" },
      { protocol: "https", hostname: "res.cloudinary.com" },
      { protocol: "https", hostname: "assets.hospitable.com" },
      { protocol: "https", hostname: "a0.muscache.com" },
      { protocol: "https", hostname: "*.muscache.com" },
      { protocol: "https", hostname: "chezsoistays.com" },
      { protocol: "https", hostname: "*.backblazeb2.com" },
      // Backblaze-B2 CDN Worker (infra/b2-cdn-worker). Photo/video read URLs
      // resolve to this host when B2_CDN_BASE_URL is set on Convex; next/image
      // rejects any remote host not listed here, so this must stay in sync with
      // that env value.
      { protocol: "https", hostname: "b2-cdn-worker.atem.workers.dev" },
    ],
  },
};

export default withNextIntl(nextConfig);
