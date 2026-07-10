import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, Montserrat, Spectral } from "next/font/google";
import { OwnerShell } from "@/components/owner/owner-shell";

// Same font stack as the cleaner PWA (cross-platform ChezSoiStays brand) —
// Spectral (display), Montserrat (body), Atkinson Hyperlegible (mono/meta).
// Tokens declared in design-system/tokens/typography.ts.
const ownerDisplay = Spectral({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-cleaner-display",
});

const ownerBody = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-cleaner-body",
});

const ownerMono = Atkinson_Hyperlegible({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-cleaner-mono",
});

export const metadata: Metadata = {
  title: "ChezSoi Ops — Owner",
  description:
    "Radical financial transparency for property owners. Every line on your statement is a clickable receipt.",
  manifest: "/owner-manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ChezSoi Ops — Owner",
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

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${ownerDisplay.variable} ${ownerBody.variable} ${ownerMono.variable}`}>
      <OwnerShell>{children}</OwnerShell>
    </div>
  );
}
