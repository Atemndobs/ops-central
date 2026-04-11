import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocaleFromRequest, locales, type Locale } from "@/i18n";
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
      { url: "/icons/chezsoi-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/chezsoi-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/chezsoi-apple-touch-icon.png", sizes: "180x180" }],
  },
};

// Generate static params for all supported locales
export async function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale?: string }>;
}) {
  // Get the locale from params or resolve from request context
  const { locale: paramLocale } = await params;
  const locale = (paramLocale || (await getLocaleFromRequest())) as Locale;

  // Import messages for the locale
  const messages = await import(`@/messages/${locale}.json`).then(
    (module) => module.default
  );

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
