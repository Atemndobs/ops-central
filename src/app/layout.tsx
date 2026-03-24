import type { Metadata } from "next";
import { ConvexClientProvider } from "@/components/providers/convex-provider";
import { ToastProvider } from "@/components/ui/toast-provider";
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
        <ConvexClientProvider>
          <ToastProvider>{children}</ToastProvider>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
