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
    icon: [
      { url: "/icons/ops-icon.svg", type: "image/svg+xml" },
      { url: "/icons/ops-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/ops-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/ops-apple-touch-icon.png", sizes: "180x180" }],
  },
  manifest: "/manifest.json",
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
