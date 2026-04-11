import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, Montserrat, Spectral } from "next/font/google";
import { CleanerShell } from "@/components/cleaner/cleaner-shell";

const cleanerDisplay = Spectral({
  subsets: ["latin"],
  weight: ["700"],
  variable: "--font-cleaner-display",
});

const cleanerBody = Montserrat({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-cleaner-body",
});

const cleanerMono = Atkinson_Hyperlegible({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-cleaner-mono",
});

export const metadata: Metadata = {
  title: "ChezSoiCleaning",
  description: "ChezSoiCleaning workspace for assigned jobs, evidence capture, and incident reporting.",
  manifest: "/cleaner-manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ChezSoiCleaning",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icons/chezsoi-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/chezsoi-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/chezsoi-apple-touch-icon.png", sizes: "180x180" }],
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
  return (
    <div className={`${cleanerDisplay.variable} ${cleanerBody.variable} ${cleanerMono.variable}`}>
      <CleanerShell>{children}</CleanerShell>
    </div>
  );
}
