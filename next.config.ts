import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.convex.cloud" },
      { protocol: "https", hostname: "img.clerk.com" },
      { protocol: "https", hostname: "res.cloudinary.com" },
      { protocol: "https", hostname: "assets.hospitable.com" },
      { protocol: "https", hostname: "a0.muscache.com" },
      { protocol: "https", hostname: "*.muscache.com" },
      { protocol: "https", hostname: "chezsoistays.com" },
      { protocol: "https", hostname: "*.backblazeb2.com" },
    ],
  },
};

export default nextConfig;
