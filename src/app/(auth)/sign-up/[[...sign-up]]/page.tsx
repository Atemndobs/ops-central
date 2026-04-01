import { SignUp } from "@clerk/nextjs";
import { mobileAuthAppearance } from "@/lib/clerk-auth-appearance";

export default function SignUpPage() {
  return (
    <SignUp
      signInUrl="/sign-in"
      fallbackRedirectUrl="/"
      appearance={mobileAuthAppearance}
    />
  );
}
