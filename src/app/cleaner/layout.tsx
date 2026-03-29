import type { Metadata, Viewport } from "next";
import { CleanerShell } from "@/components/cleaner/cleaner-shell";

export const metadata: Metadata = {
  title: "ChezSoisCleaning",
  description: "ChezSoisCleaning workspace for assigned jobs, evidence capture, and incident reporting.",
  manifest: "/cleaner-manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ChezSoisCleaning",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icons/cleaner-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/cleaner-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/cleaner-apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#f3f7ff",
};

export default function CleanerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <CleanerShell>{children}</CleanerShell>;
}
