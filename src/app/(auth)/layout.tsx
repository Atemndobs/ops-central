"use client";

import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
      <div className="relative flex h-full flex-col items-center overflow-y-auto bg-[rgba(10,10,10,0.6)] px-5 py-12 backdrop-blur-[80px] sm:justify-center sm:px-8 sm:pt-20 sm:pb-16">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.04] via-transparent to-black/20" />

        {/* Sign-up is intentionally hidden: accounts are provisioned
            internally, not self-service. Only the sign-in surface is exposed. */}

        {/* Auth form container */}
        <div className="relative w-full max-w-[480px]">{children}</div>

        {/* Footer with legal links — public, crawlable */}
        <div className="relative mt-8 text-center text-xs text-white/50">
          <Link href="/privacy" className="hover:text-white/80">
            Privacy Policy
          </Link>
          <span className="px-2 text-white/30">·</span>
          <Link href="/delete-account" className="hover:text-white/80">
            Delete Account
          </Link>
        </div>
      </div>
    </div>
    </>
  );
}
