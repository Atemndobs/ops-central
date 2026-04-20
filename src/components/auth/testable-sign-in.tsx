"use client";

import { useSignIn } from "@clerk/nextjs";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TestAuthPreset, TestAuthRole } from "@/lib/test-auth-presets";

type TestableSignInProps = {
  presets: TestAuthPreset[];
  showTestPresets: boolean;
};

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

export function TestableSignIn({
  presets,
  showTestPresets,
}: TestableSignInProps) {
  const router = useRouter();
  const { signIn, fetchStatus } = useSignIn();
  const [isPending, startTransition] = useTransition();
  const availablePresets = useMemo(
    () => presets.filter((preset) => preset.email && preset.password),
    [presets],
  );
  const defaultPreset = availablePresets[0] ?? presets[0] ?? null;
  const [selectedRole, setSelectedRole] = useState<TestAuthRole>(
    defaultPreset?.role ?? "manager",
  );
  const [email, setEmail] = useState(defaultPreset?.email ?? "");
  const [password, setPassword] = useState(defaultPreset?.password ?? "");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oauthLoading, setOauthLoading] = useState(false);

  useEffect(() => {
    if (!defaultPreset) {
      return;
    }

    setSelectedRole((currentRole) => {
      const currentPreset = availablePresets.find((preset) => preset.role === currentRole);
      if (currentPreset) {
        return currentRole;
      }

      setEmail(defaultPreset.email);
      setPassword(defaultPreset.password);
      return defaultPreset.role;
    });
  }, [availablePresets, defaultPreset]);

  const applyPreset = (role: TestAuthRole) => {
    const preset = presets.find((entry) => entry.role === role);
    if (!preset) {
      return;
    }

    setSelectedRole(role);
    setEmail(preset.email);
    setPassword(preset.password);
    setError(null);
  };

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

      // Clerk v7 FutureResource: redirect may not fire automatically.
      // Check for the external provider redirect URL and navigate manually.
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

  const selectedPreset = presets.find((preset) => preset.role === selectedRole) ?? null;
  const isSubmitting = isPending || fetchStatus === "fetching" || !signIn;

  const rolePillLabel: Record<TestAuthRole, string> = {
    cleaner: "Cleaner",
    manager: "Manager",
    admin: "Admin",
    property_ops: "Ops",
  };

  return (
    <div className="space-y-6 text-white">
      {/* Title */}
      <h1 className="text-center text-[32px] leading-tight font-medium tracking-[-0.5px] sm:text-[36px]">
        Welcome back
      </h1>

      {/* Test role pill switcher — compact, mobile-app style */}
      {showTestPresets ? (
        <div className="flex flex-col items-center gap-2.5">
          <span className="text-[11px] font-semibold tracking-[1px] text-white/50 uppercase">
            Test as
          </span>
          <div className="flex flex-wrap justify-center gap-2">
            {presets.map((preset) => {
              const isReady = Boolean(preset.email && preset.password);
              const isSelected = preset.role === selectedRole;

              return (
                <button
                  key={preset.role}
                  type="button"
                  onClick={() => applyPreset(preset.role)}
                  disabled={!isReady || isSubmitting}
                  className={`rounded-full px-4 py-2 text-[13px] font-semibold transition-all ${
                    isSelected
                      ? "bg-white/25 text-white"
                      : "bg-white/10 text-white/60 hover:bg-white/15 hover:text-white/80"
                  } ${!isReady ? "cursor-not-allowed opacity-40" : ""}`}
                >
                  {rolePillLabel[preset.role] ?? preset.label}
                </button>
              );
            })}
          </div>
          {selectedPreset ? (
            <p className="text-[12px] text-white/40">
              {selectedPreset.email}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-5" suppressHydrationWarning>
        <div className="space-y-4" suppressHydrationWarning>
          {/* Email */}
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

          {/* Password */}
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

        {/* Error message */}
        {error ? (
          <div className="rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {/* Submit */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex h-[52px] w-full items-center justify-center gap-2.5 rounded-2xl bg-white/15 text-[15px] font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50 sm:h-[56px] sm:text-base"
        >
          {isSubmitting ? <LoaderCircle className="h-5 w-5 animate-spin" /> : null}
          <span>{isSubmitting ? "Signing in\u2026" : "Sign in"}</span>
        </button>
      </form>

      {/* Divider */}
      <div className="flex items-center gap-4">
        <div className="h-px flex-1 bg-white/10" />
        <span className="text-[11px] font-semibold tracking-[1px] text-white/30 uppercase select-none">
          Or continue with
        </span>
        <div className="h-px flex-1 bg-white/10" />
      </div>

      {/* Google OAuth */}
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

      {/* Terms footer */}
      <p className="text-center text-[13px] text-white/30">
        By signing in, you agree to our Terms of Service
      </p>
    </div>
  );
}
