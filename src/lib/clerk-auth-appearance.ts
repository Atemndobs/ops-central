import { dark } from "@clerk/themes";

/**
 * Clerk appearance config — mirrors the mobile app's glass-morphism login UI.
 * See: jna-cleaners-app/app/(auth)/login.tsx for reference styling.
 */
export const mobileAuthAppearance = {
  baseTheme: dark,
  variables: {
    colorPrimary: "#ffffff",
    colorBackground: "transparent",
    colorText: "#ffffff",
    colorTextSecondary: "rgba(255,255,255,0.7)",
    colorInputBackground: "rgba(0,0,0,0.4)",
    colorInputText: "#ffffff",
    colorNeutral: "rgba(255,255,255,0.08)",
    colorDanger: "#f87171",
    borderRadius: "1rem",
    fontFamily:
      "var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, sans-serif",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "w-full max-w-[480px] shadow-none",
    card: "bg-transparent shadow-none border-0 p-0",
    headerTitle:
      "text-white text-[36px] leading-tight font-medium tracking-[-0.5px]",
    headerSubtitle: "text-white/70 mt-2 text-base",
    formFieldLabel:
      "text-white text-sm font-medium mb-2 tracking-[0.01em]",
    formFieldInput:
      "h-[60px] rounded-2xl border border-white/[0.08] bg-black/40 text-white text-base placeholder:text-white/40 focus:border-white/25 focus:ring-1 focus:ring-white/25",
    formFieldAction:
      "text-white/70 hover:text-white text-sm font-medium",
    formButtonPrimary:
      "h-[60px] rounded-2xl border border-white/20 bg-white/[0.15] text-white text-base font-semibold shadow-none hover:bg-white/20 mt-6",
    socialButtonsBlockButton:
      "h-[60px] rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 text-white",
    socialButtonsBlockButtonText: "text-white font-semibold",
    dividerLine: "bg-white/10",
    dividerText:
      "text-white/30 text-xs font-semibold tracking-[1px] uppercase",
    footer: "hidden",
    alert: "bg-red-500/10 border border-red-400/30 text-red-100",
    formResendCodeLink:
      "text-white/70 hover:text-white font-medium",
    otpCodeFieldInput:
      "h-[60px] rounded-2xl border border-white/[0.08] bg-black/40 text-white",
    identityPreview: "bg-white/5 border border-white/10 text-white",
    identityPreviewText: "text-white",
    identityPreviewEditButton: "text-white/70 hover:text-white",
  },
} as const;
