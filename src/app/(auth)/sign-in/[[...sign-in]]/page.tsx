import { SignIn } from "@clerk/nextjs";
import { mobileAuthAppearance } from "@/lib/clerk-auth-appearance";

export default function SignInPage() {
  return (
    <SignIn
      signUpUrl="/sign-up"
      fallbackRedirectUrl="/"
      appearance={mobileAuthAppearance}
    />
  );
}
