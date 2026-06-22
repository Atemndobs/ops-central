import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Support — JNA Cleaners | J&A Business Solutions",
  description:
    "Support and help for the JNA Cleaners mobile app, used by employees and contractors of J&A Business Solutions LLC.",
  robots: { index: true, follow: true },
  alternates: { canonical: "https://ja-bs.com/support" },
};

export const dynamic = "force-static";

const SUPPORT_EMAIL = "info@jnabusinesssolutions.com";

function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <div className="border-b border-white/10 py-4 last:border-none">
      <h3 className="mb-1 font-semibold text-white">{q}</h3>
      <p className="text-white/75">{children}</p>
    </div>
  );
}

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <Link href="/" className="text-sm font-semibold tracking-wide text-white/80 hover:text-white">
            J&amp;A Business Solutions
          </Link>
          <Link href="/sign-in" className="text-sm text-white/60 hover:text-white">
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12 text-white/85">
        <article className="space-y-6 leading-relaxed">
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            JNA Cleaners — Support
          </h1>

          <p>
            <strong>JNA Cleaners</strong> is a field-operations app by{" "}
            <strong>J&amp;A Business Solutions LLC</strong>, used by our cleaning staff, managers,
            operations team, and property owners to coordinate cleaning jobs, capture photos, report
            incidents, and approve completed work. It is intended for authorized staff and partners.
          </p>

          <hr className="border-white/10" />

          <h2 className="text-2xl font-semibold text-white">Contact us</h2>
          <p>
            For help with the app — sign-in problems, account access, bugs, or any question — email us
            and we&rsquo;ll get back to you, typically within 1&ndash;2 business days:
          </p>
          <p>
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=JNA%20Cleaners%20App%20Support`}
              className="text-lg font-semibold text-white underline decoration-white/30 underline-offset-4 hover:decoration-white"
            >
              {SUPPORT_EMAIL}
            </a>
          </p>
          <p className="text-sm text-white/60">J&amp;A Business Solutions LLC · Tucson, Arizona, USA</p>

          <hr className="border-white/10" />

          <h2 className="text-2xl font-semibold text-white">Common questions</h2>
          <div>
            <Faq q="I can't sign in">
              Use the email your administrator set up for you. You can sign in with your email and
              password, or with Apple or Google. Forgot your password? Use &ldquo;Forgot password&rdquo;
              on the sign-in screen to reset it by email. Still stuck? Email us above.
            </Faq>
            <Faq q="I don't see any jobs">
              Jobs appear once a manager or the operations team assigns them to you. If you expect a job
              and don&rsquo;t see it, contact your manager, or email us.
            </Faq>
            <Faq q="Why does the app ask for camera, photos, and microphone access?">
              Camera &amp; photos are used to capture before/after and incident photos for your jobs. The
              microphone is used for voice-to-text messages. You can manage these in your device&rsquo;s
              Settings → JNA Cleaners.
            </Faq>
            <Faq q="Notifications aren't working">
              Enable notifications in Settings → JNA Cleaners → Notifications so you&rsquo;re alerted to
              new jobs and incidents.
            </Faq>
            <Faq q="I found a bug or have feedback">
              Please email us with a short description (and a screenshot if you can) — it helps us fix
              things quickly.
            </Faq>
            <Faq q="Account or role changes">
              Your role (cleaner, manager, operations, admin, owner) is managed by your administrator.
              Contact your manager or email us for changes.
            </Faq>
          </div>

          <hr className="border-white/10" />

          <h2 className="text-2xl font-semibold text-white">Privacy</h2>
          <p>
            Read how we handle your data in our{" "}
            <Link href="/privacy" className="underline decoration-white/30 underline-offset-4 hover:decoration-white">
              Privacy Policy
            </Link>
            .
          </p>

          <hr className="border-white/10" />

          <p className="text-sm text-white/50">
            © {new Date().getFullYear()} J&amp;A Business Solutions LLC · Tucson, Arizona, USA ·{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="underline decoration-white/30 underline-offset-4 hover:decoration-white">
              {SUPPORT_EMAIL}
            </a>
          </p>
        </article>
      </main>
    </div>
  );
}
