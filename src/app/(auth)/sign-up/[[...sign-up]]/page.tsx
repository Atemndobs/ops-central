import { SignUp } from "@clerk/nextjs";

const lightAppearance = {
  baseTheme: undefined,
  variables: {
    colorPrimary: "oklch(0.623 0.214 259)",
    colorBackground: "white",
    colorInputBackground: "oklch(0.97 0 0)",
    colorInputText: "oklch(0.15 0 0)",
    colorText: "oklch(0.15 0 0)",
    colorTextSecondary: "oklch(0.45 0 0)",
    colorDanger: "oklch(0.577 0.245 27.33)",
    borderRadius: "0.75rem",
    fontFamily:
      "var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, sans-serif",
    fontSize: "0.9375rem",
  },
  elements: {
    card: "bg-transparent shadow-none",
    headerTitle: "text-xl font-semibold text-gray-900",
    headerSubtitle: "text-gray-500",
    formButtonPrimary:
      "bg-[oklch(0.623_0.214_259)] hover:bg-[oklch(0.56_0.214_259)] text-white font-medium rounded-lg h-10 text-sm",
    formFieldInput:
      "bg-gray-50 border-gray-300 text-gray-900 rounded-lg h-10 focus:border-[oklch(0.623_0.214_259)] focus:ring-1 focus:ring-[oklch(0.623_0.214_259)]",
    formFieldLabel: "text-gray-600 text-sm font-medium",
    footerActionLink:
      "text-[oklch(0.623_0.214_259)] hover:text-[oklch(0.5_0.214_259)]",
    socialButtonsBlockButton:
      "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg h-10",
    socialButtonsBlockButtonText: "text-sm font-medium",
    dividerLine: "bg-gray-200",
    dividerText: "text-gray-400",
    identityPreview: "bg-gray-50 border-gray-200",
    identityPreviewText: "text-gray-700",
    identityPreviewEditButton:
      "text-[oklch(0.623_0.214_259)] hover:text-[oklch(0.5_0.214_259)]",
    formFieldAction:
      "text-[oklch(0.623_0.214_259)] hover:text-[oklch(0.5_0.214_259)]",
    otpCodeFieldInput: "bg-gray-50 border-gray-300 text-gray-900",
    alert: "bg-gray-50 border-gray-200",
    alertText: "text-gray-700",
    footer: "hidden",
  },
} as const;

export default function SignUpPage() {
  return (
    <SignUp
      signInUrl="/sign-in"
      fallbackRedirectUrl="/"
      appearance={lightAppearance}
    />
  );
}
