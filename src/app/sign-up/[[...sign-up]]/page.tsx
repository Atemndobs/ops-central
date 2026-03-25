import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] p-4">
      <SignUp signInUrl="/sign-in" fallbackRedirectUrl="/" />
    </div>
  );
}
