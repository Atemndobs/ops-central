import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getLocale } from "next-intl/server";
import { ClerkThemeProvider } from "@/components/providers/clerk-theme-provider";
import { ConvexClientProvider } from "@/components/providers/convex-provider";
import { ClerkUserSync } from "@/components/providers/clerk-user-sync";
import { PostHogProvider } from "@/components/providers/posthog-provider";
import { ToastProvider } from "@/components/ui/toast-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChezSoi Ops",
  description: "Property operations management for J&A Business Solutions",
  icons: {
    // Color-aware: these routes redirect to the admin-selected color's asset
    // (see src/app/brand-icon/[asset]/route.ts). iOS "Add to Home Screen" and
    // Chrome's install dialog use these, so they must follow the setting too.
    icon: [
      { url: "/brand-icon/ops/favicon.svg", type: "image/svg+xml" },
      { url: "/brand-icon/ops/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/brand-icon/ops/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/brand-icon/ops/apple-touch.png", sizes: "180x180" }],
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Ops",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0d9488",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ClerkThemeProvider>
            <ConvexClientProvider>
              <ClerkUserSync />
              <PostHogProvider>
                <ToastProvider>{children}</ToastProvider>
              </PostHogProvider>
            </ConvexClientProvider>
          </ClerkThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
