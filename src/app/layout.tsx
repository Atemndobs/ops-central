import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getLocale } from "next-intl/server";
import { ClerkThemeProvider } from "@/components/providers/clerk-theme-provider";
import { ConvexClientProvider } from "@/components/providers/convex-provider";
import { ClerkUserSync } from "@/components/providers/clerk-user-sync";
import { ToastProvider } from "@/components/ui/toast-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChezSoi",
  description: "Property operations management for J&A Business Solutions",
  icons: {
    icon: [
      { url: "/icons/chezsoi-icon.svg", type: "image/svg+xml" },
      { url: "/icons/chezsoi-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/chezsoi-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/chezsoi-apple-touch-icon.png", sizes: "180x180" }],
  },
  manifest: "/manifest.json",
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
              <ToastProvider>{children}</ToastProvider>
            </ConvexClientProvider>
          </ClerkThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
