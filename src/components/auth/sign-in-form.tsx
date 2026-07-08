"use client";

import { useAuth, useSignIn } from "@clerk/nextjs";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function readClerkErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const maybeError = error as {
    errors?: Array<{
      longMessage?: string;
      long_message?: string;
      message?: string;
    }>;
  };

  const firstError = maybeError.errors?.[0];
  return firstError?.longMessage ?? firstError?.long_message ?? firstError?.message ?? null;
}

function getAuthErrorMessage(error: unknown): string {
  const clerkMessage = readClerkErrorMessage(error);
  if (clerkMessage) {
    return clerkMessage;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Sign in failed.";
}

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();
  const { signIn, fetchStatus } = useSignIn();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!isAuthLoaded || !isSignedIn) {
      return;
    }
    const rawRedirect = searchParams?.get("redirect_url") ?? null;
    let target = "/";
    if (rawRedirect) {
      try {
        const parsed = new URL(rawRedirect, window.location.origin);
        if (parsed.origin === window.location.origin) {
          target = `${parsed.pathname}${parsed.search}${parsed.hash}` || "/";
        }
      } catch {
        if (rawRedirect.startsWith("/")) {
          target = rawRedirect;
        }
      }
    }
    router.replace(target);
  }, [isAuthLoaded, isSignedIn, router, searchParams]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oauthLoading, setOauthLoading] = useState(false);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!signIn) {
      return;
    }

    if (!email || !password) {
      setError("Enter both email and password to continue.");
      return;
    }

    setError(null);

    startTransition(async () => {
      try {
        const passwordResult = await signIn.password({
          identifier: email,
          password,
        });

        if (passwordResult.error) {
          throw passwordResult.error;
        }

        if (signIn.status !== "complete") {
          throw new Error("Sign in did not complete. Please try again.");
        }

        const finalizeResult = await signIn.finalize();
        if (finalizeResult.error) {
          throw finalizeResult.error;
        }

        router.push("/");
        router.refresh();
      } catch (caughtError) {
        setError(getAuthErrorMessage(caughtError));
      }
    });
  };

  const handleGoogleSignIn = async () => {
    if (!signIn) return;

    setOauthLoading(true);
    setError(null);

    try {
      const result = await signIn.create({
        strategy: "oauth_google",
        redirectUrl: `${window.location.origin}/sso-callback`,
        actionCompleteRedirectUrl: "/",
      });

      if (result.error) {
        throw result.error;
      }

      const redirectUrl = signIn.firstFactorVerification?.externalVerificationRedirectURL;
      if (redirectUrl) {
        window.location.href = redirectUrl.toString();
        return;
      }
    } catch (caughtError) {
      setError(getAuthErrorMessage(caughtError));
      setOauthLoading(false);
    }
  };

  const isSubmitting = isPending || fetchStatus === "fetching" || !signIn;

  return (
    <div className="space-y-6 text-white">
      <h1 className="text-center text-[32px] leading-tight font-medium tracking-[-0.5px] sm:text-[36px]">
        Welcome back
      </h1>

      <form onSubmit={handleSubmit} className="space-y-5" suppressHydrationWarning>
        <div className="space-y-4" suppressHydrationWarning>
          <div className="space-y-1.5" suppressHydrationWarning>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-white/70"
            >
              Email address
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Enter your email"
              className="h-[52px] w-full rounded-2xl bg-black/40 px-4 text-[15px] text-white outline-none ring-1 ring-white/[0.08] placeholder:text-white/35 focus:ring-white/25 sm:h-[56px] sm:px-5 sm:text-base"
              suppressHydrationWarning
            />
          </div>

          <div className="space-y-1.5" suppressHydrationWarning>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-white/70"
            >
              Password
            </label>
            <div className="relative" suppressHydrationWarning>
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                className="h-[52px] w-full rounded-2xl bg-black/40 px-4 pr-12 text-[15px] text-white outline-none ring-1 ring-white/[0.08] placeholder:text-white/35 focus:ring-white/25 sm:h-[56px] sm:px-5 sm:pr-14 sm:text-base"
                suppressHydrationWarning
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-white/40 transition hover:text-white/70 sm:w-14"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <div className="rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="flex h-[52px] w-full items-center justify-center gap-2.5 rounded-2xl bg-white/15 text-[15px] font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50 sm:h-[56px] sm:text-base"
        >
          {isSubmitting ? <LoaderCircle className="h-5 w-5 animate-spin" /> : null}
          <span>{isSubmitting ? "Signing in…" : "Sign in"}</span>
        </button>
      </form>

      <div className="flex items-center gap-4">
        <div className="h-px flex-1 bg-white/10" />
        <span className="text-[11px] font-semibold tracking-[1px] text-white/30 uppercase select-none">
          Or continue with
        </span>
        <div className="h-px flex-1 bg-white/10" />
      </div>

      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={isSubmitting || oauthLoading}
        className="flex h-[52px] w-full items-center justify-center gap-3 rounded-2xl bg-white/[0.06] text-[15px] font-medium text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 sm:h-[56px] sm:text-base"
      >
        {oauthLoading ? (
          <LoaderCircle className="h-5 w-5 animate-spin" />
        ) : (
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
        )}
        <span>Google</span>
      </button>

      <p className="text-center text-[13px] text-white/30">
        By signing in, you agree to our Terms of Service
      </p>
    </div>
  );
}
