import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { ConvexClientProvider } from "@/components/providers/convex-provider";
import { ToastProvider } from "@/components/ui/toast-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpsCentral - Property Care Operations",
  description: "Property operations management for J&A Business Solutions",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ClerkProvider
          dynamic
          signInUrl="/sign-in"
          signUpUrl="/sign-up"
          afterSignOutUrl="/sign-in"
        >
          <ConvexClientProvider>
            <ToastProvider>{children}</ToastProvider>
          </ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
