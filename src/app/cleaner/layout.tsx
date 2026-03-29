import type { Metadata, Viewport } from "next";
import { CleanerShell } from "@/components/cleaner/cleaner-shell";

export const metadata: Metadata = {
  title: "OpsCentral Cleaner",
  description: "Cleaner workspace for assigned jobs, evidence capture, and incident reporting.",
  manifest: "/cleaner-manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "OpsCentral Cleaner",
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
  themeColor: "#081018",
};

export default function CleanerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <section
      className="min-h-screen [--background:#081018] [--foreground:#f8fafc] [--card:#111a2a] [--card-foreground:#f8fafc] [--muted:#162236] [--muted-foreground:#94a3b8] [--border:#20304a] [--primary:#22d3ee] [--primary-foreground:#082f49] [--destructive:#fb7185]"
      style={{ colorScheme: "dark" }}
    >
      <CleanerShell>{children}</CleanerShell>
    </section>
  );
}
