import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
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

const clerkAppearance = {
  baseTheme: dark,
  variables: {
    colorPrimary: "oklch(0.623 0.214 259)",
    colorBackground: "oklch(0.178 0 0)",
    colorInputBackground: "oklch(0.22 0 0)",
    colorInputText: "oklch(0.985 0 0)",
    colorText: "oklch(0.985 0 0)",
    colorTextSecondary: "oklch(0.65 0 0)",
    colorDanger: "oklch(0.577 0.245 27.33)",
    borderRadius: "0.75rem",
    fontFamily:
      "var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, sans-serif",
    fontSize: "0.9375rem",
  },
  elements: {
    card: "bg-transparent shadow-none",
    headerTitle: "text-xl font-semibold",
    headerSubtitle: "text-[oklch(0.6_0_0)]",
    formButtonPrimary:
      "bg-[oklch(0.623_0.214_259)] hover:bg-[oklch(0.56_0.214_259)] text-white font-medium rounded-lg h-10 text-sm",
    formFieldInput:
      "bg-[oklch(0.22_0_0)] border-[oklch(0.3_0_0)] text-white rounded-lg h-10 focus:border-[oklch(0.623_0.214_259)] focus:ring-1 focus:ring-[oklch(0.623_0.214_259)]",
    formFieldLabel: "text-[oklch(0.75_0_0)] text-sm font-medium",
    footerActionLink:
      "text-[oklch(0.623_0.214_259)] hover:text-[oklch(0.7_0.214_259)]",
    socialButtonsBlockButton:
      "bg-[oklch(0.22_0_0)] border-[oklch(0.3_0_0)] text-white hover:bg-[oklch(0.26_0_0)] rounded-lg h-10",
    socialButtonsBlockButtonText: "text-sm font-medium",
    dividerLine: "bg-[oklch(0.3_0_0)]",
    dividerText: "text-[oklch(0.5_0_0)]",
    identityPreview: "bg-[oklch(0.2_0_0)] border-[oklch(0.3_0_0)]",
    identityPreviewText: "text-[oklch(0.85_0_0)]",
    identityPreviewEditButton:
      "text-[oklch(0.623_0.214_259)] hover:text-[oklch(0.7_0.214_259)]",
    formFieldAction:
      "text-[oklch(0.623_0.214_259)] hover:text-[oklch(0.7_0.214_259)]",
    otpCodeFieldInput:
      "bg-[oklch(0.22_0_0)] border-[oklch(0.3_0_0)] text-white",
    alert: "bg-[oklch(0.2_0_0)] border-[oklch(0.3_0_0)]",
    alertText: "text-[oklch(0.85_0_0)]",
    footer: "hidden",
  },
} as const;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ClerkProvider appearance={clerkAppearance}>
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
