import type { Metadata } from "next";
import { ClerkThemeProvider } from "@/components/providers/clerk-theme-provider";
import { ConvexClientProvider } from "@/components/providers/convex-provider";
import { ClerkUserSync } from "@/components/providers/clerk-user-sync";
import { ToastProvider } from "@/components/ui/toast-provider";
import { GlobalAuthHeader } from "@/components/layout/global-auth-header";
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ClerkThemeProvider>
          <GlobalAuthHeader />
          <ConvexClientProvider>
            <ClerkUserSync />
            <ToastProvider>{children}</ToastProvider>
          </ConvexClientProvider>
        </ClerkThemeProvider>
      </body>
    </html>
  );
}
