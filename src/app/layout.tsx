import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { ConvexClientProvider } from "@/components/providers/convex-provider";
import { ClerkUserSync } from "@/components/providers/clerk-user-sync";
import { ToastProvider } from "@/components/ui/toast-provider";
import { GlobalAuthHeader } from "@/components/layout/global-auth-header";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChezSoi",
  description: "Property operations management for J&A Business Solutions",
  icons: {
    icon: "https://chezsoistays.com/wp-content/uploads/2026/02/chezsoi_favicon@2x.png",
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
        <ClerkProvider>
          <GlobalAuthHeader />
          <ConvexClientProvider>
            <ClerkUserSync />
            <ToastProvider>{children}</ToastProvider>
          </ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
