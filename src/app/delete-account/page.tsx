import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Delete Account — JNA Cleaners | J&A Business Solutions",
  description: "Request deletion of your JNA Cleaners account and data",
  robots: { index: true, follow: true },
  alternates: { canonical: "https://jnabusinesssolutions.com/delete-account" },
};

export const dynamic = "force-static";

export default function DeleteAccountPage() {
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
            Account and Data Deletion — JNA Cleaners
          </h1>

          <p>
            To request deletion of your JNA Cleaners account and associated data, email{" "}
            <strong>
              <a
                className="text-blue-300 underline hover:text-blue-200"
                href="mailto:privacy@jnabusinesssolutions.com?subject=Delete%20my%20JNA%20Cleaners%20account"
              >
                privacy@jnabusinesssolutions.com
              </a>
            </strong>{" "}
            from the email address registered to your account, with the subject line &ldquo;Delete
            my JNA Cleaners account&rdquo;.
          </p>

          <p>We will:</p>
          <ul className="list-disc space-y-2 pl-6">
            <li>Verify your identity by replying from the registered email</li>
            <li>Process the deletion within 30 days</li>
            <li>Confirm completion by email</li>
          </ul>

          <hr className="border-white/10" />

          <h2 className="text-2xl font-semibold text-white">What is deleted</h2>
          <ul className="list-disc space-y-2 pl-6">
            <li>Account profile (name, email, phone, role)</li>
            <li>Authentication credentials</li>
            <li>Push notification token</li>
            <li>Photos and media you uploaded</li>
            <li>Personal notes and annotations</li>
            <li>Analytics data tied to your user ID</li>
          </ul>

          <hr className="border-white/10" />

          <h2 className="text-2xl font-semibold text-white">What is retained</h2>
          <p>
            For legal, tax, and operational record-keeping, we retain (in anonymized or
            pseudonymized form where possible):
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              Completed job records and audit logs (retained for the period required by our
              property contracts and applicable law, typically up to 7 years)
            </li>
            <li>Incident reports tied to property safety records</li>
            <li>Aggregated, non-identifying analytics</li>
          </ul>

          <hr className="border-white/10" />

          <h2 className="text-2xl font-semibold text-white">Partial deletion</h2>
          <p>
            If you want to delete specific data (e.g. a single photo or report) without closing
            your account, include the request in the same email and we&rsquo;ll handle it.
          </p>

          <hr className="border-white/10" />

          <h2 className="text-2xl font-semibold text-white">Contact</h2>
          <p>
            <strong>J&amp;A Business Solutions LLC</strong>
            <br />
            Tucson, Arizona, USA
            <br />
            <a
              className="text-blue-300 underline hover:text-blue-200"
              href="mailto:privacy@jnabusinesssolutions.com"
            >
              privacy@jnabusinesssolutions.com
            </a>
          </p>
        </article>
      </main>

      <footer className="border-t border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-6 text-xs text-white/50">
          © {new Date().getFullYear()} J&amp;A Business Solutions LLC ·{" "}
          <Link href="/privacy" className="hover:text-white">
            Privacy Policy
          </Link>{" "}
          ·{" "}
          <Link href="/delete-account" className="hover:text-white">
            Delete Account
          </Link>
        </div>
      </footer>
    </div>
  );
}
