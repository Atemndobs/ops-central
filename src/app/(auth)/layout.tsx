"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isSignUp = pathname?.startsWith("/sign-up");
  const isSignIn = !isSignUp;

  return (
    <>
      {/* Force black body/html to prevent white bleed on mobile overscroll */}
      <style>{`html, body { background: #000 !important; overflow: hidden; }`}</style>
    <div
      className="fixed inset-0 overflow-hidden bg-black text-white"
      style={{ colorScheme: "dark" }}
    >
      {/* Background image — same as mobile app */}
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage:
            "url('https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop')",
        }}
      />
      {/* Gradient overlay — matches mobile: from-black/30 to-black/80 */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/30 to-black/80" />

      {/* Full-viewport glass card — matches mobile's edge-to-edge BlurView */}
      <div className="relative flex h-full flex-col items-center justify-center overflow-y-auto bg-[rgba(10,10,10,0.6)] px-8 pt-20 pb-16 backdrop-blur-[80px]">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.04] via-transparent to-black/20" />

        {/* Pill tab toggle — matches mobile's tabContainer */}
        <div className="relative mb-8 inline-flex rounded-full border border-white/5 bg-black/50 p-1">
          <Link
            href="/sign-up"
            className={`rounded-full px-6 py-2.5 text-sm font-semibold transition ${
              isSignUp
                ? "border border-white/10 bg-white/10 text-white"
                : "text-white/50 hover:bg-white/10 hover:text-white"
            }`}
          >
            Sign up
          </Link>
          <Link
            href="/sign-in"
            className={`rounded-full px-6 py-2.5 text-sm font-semibold transition ${
              isSignIn
                ? "border border-white/10 bg-white/10 text-white"
                : "text-white/50 hover:bg-white/10 hover:text-white"
            }`}
          >
            Sign in
          </Link>
        </div>

        {/* Auth form container */}
        <div className="relative w-full max-w-[480px]">{children}</div>
      </div>
    </div>
    </>
  );
}
