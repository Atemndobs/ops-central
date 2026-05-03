import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — JNA Cleaners | J&A Business Solutions",
  description:
    "Privacy policy for the JNA Cleaners mobile app, used by employees and contractors of J&A Business Solutions LLC.",
  robots: { index: true, follow: true },
  alternates: { canonical: "https://ja-bs.com/privacy" },
};

export const dynamic = "force-static";

export default function PrivacyPolicyPage() {
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
            Privacy Policy — JNA Cleaners
          </h1>

          <p className="text-sm text-white/60">
            <strong className="text-white/80">Effective date:</strong> May 3, 2026
            <br />
            <strong className="text-white/80">Last updated:</strong> May 3, 2026
          </p>

          <p>
            J&amp;A Business Solutions LLC (&ldquo;J&amp;A,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) operates the{" "}
            <strong>JNA Cleaners</strong> mobile application (the &ldquo;App&rdquo;), a workforce tool used by
            employees and contractors of J&amp;A Business Solutions LLC and its affiliated property
            operators to manage cleaning, inspection, incident reporting, and field operations at
            properties under our management.
          </p>

          <p>
            This Privacy Policy explains what information the App collects, how we use it, who we
            share it with, and the rights you have. The App is intended for use by authorized
            personnel only — it is not a consumer-facing product.
          </p>

          <hr className="border-white/10" />

          <h2 className="text-2xl font-semibold text-white">1. Who we are</h2>
          <p>
            <strong>Data controller:</strong> J&amp;A Business Solutions LLC
            <br />
            <strong>Principal office:</strong> Tucson, Arizona, USA
            <br />
            <strong>Contact:</strong>{" "}
            <a className="text-blue-300 underline hover:text-blue-200" href="mailto:privacy@ja-bs.com">
              privacy@ja-bs.com
            </a>
          </p>
          <p>
            If you have any questions about this policy or wish to exercise your rights, contact us
            at the email above.
          </p>

          <hr className="border-white/10" />

          <h2 className="text-2xl font-semibold text-white">2. Information we collect</h2>
          <p>
            We collect only the information needed to operate the App and run our cleaning
            operations.
          </p>

          <h3 className="text-xl font-semibold text-white">2.1 Information you provide</h3>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Account information:</strong> name, email address, phone number, and role
              (cleaner, manager, operations, admin) when you sign in.
            </li>
            <li>
              <strong>Authentication credentials:</strong> password or OAuth identity (Apple Sign In,
              Google Sign In) handled by our authentication provider.
            </li>
            <li>
              <strong>Job content:</strong> notes, checklists, and incident reports you create while
              working a job.
            </li>
          </ul>

          <h3 className="text-xl font-semibold text-white">2.2 Information collected automatically</h3>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Photos and media:</strong> when you use the camera or attach a photo to a job,
              inspection, or incident, we store the image and any annotations you add. The camera is
              used solely to document property condition and verify completed work.
            </li>
            <li>
              <strong>Device information:</strong> device type, operating system, app version, and
              language settings.
            </li>
            <li>
              <strong>Push notification token:</strong> an Expo-issued device token used to deliver
              job-assignment and operational notifications.
            </li>
            <li>
              <strong>Usage data:</strong> screens viewed, actions taken, and feature interactions,
              used for product analytics and debugging.
            </li>
            <li>
              <strong>Approximate location (optional):</strong> if you enable location features, we
              may record the location associated with a job check-in or photo. Location is not
              tracked in the background.
            </li>
          </ul>

          <h3 className="text-xl font-semibold text-white">2.3 Information we do not collect</h3>
          <ul className="list-disc space-y-2 pl-6">
            <li>We do not collect financial or payment information through the App.</li>
            <li>We do not access your contacts, calendar, microphone, or SMS.</li>
            <li>We do not sell your personal information.</li>
            <li>We do not use the App to advertise or profile you for marketing.</li>
          </ul>

          <hr className="border-white/10" />

          <h2 className="text-2xl font-semibold text-white">3. How we use information</h2>
          <p>We use the information described above to:</p>
          <ul className="list-disc space-y-2 pl-6">
            <li>Authenticate you and grant role-based access to the App&rsquo;s features.</li>
            <li>Assign, schedule, and track cleaning and inspection jobs.</li>
            <li>Allow you to capture and submit photos, notes, and incident reports.</li>
            <li>
              Send push notifications about job assignments, schedule changes, and operational
              alerts.
            </li>
            <li>Maintain quality control, audit history, and compliance records.</li>
            <li>Diagnose crashes, debug issues, and improve the App.</li>
            <li>Comply with legal, contractual, and tax obligations.</li>
          </ul>
          <p>
            We do not use your information for automated decision-making that produces legal or
            similarly significant effects.
          </p>

          <hr className="border-white/10" />

          <h2 className="text-2xl font-semibold text-white">4. Service providers</h2>
          <p>
            We share information only with service providers that help us operate the App. Each
            provider is bound by contract to handle data on our behalf:
          </p>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-white/20">
                  <th scope="col" className="py-2 pr-4 font-semibold text-white">
                    Provider
                  </th>
                  <th scope="col" className="py-2 font-semibold text-white">
                    Purpose
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-white/10">
                  <td className="py-2 pr-4">
                    <strong>Convex</strong>
                  </td>
                  <td className="py-2">Backend database, server functions, file storage</td>
                </tr>
                <tr className="border-b border-white/10">
                  <td className="py-2 pr-4">
                    <strong>Clerk</strong>
                  </td>
                  <td className="py-2">User authentication and account management</td>
                </tr>
                <tr className="border-b border-white/10">
                  <td className="py-2 pr-4">
                    <strong>Expo / EAS</strong>
                  </td>
                  <td className="py-2">Push notifications, over-the-air updates, builds</td>
                </tr>
                <tr className="border-b border-white/10">
                  <td className="py-2 pr-4">
                    <strong>PostHog</strong>
                  </td>
                  <td className="py-2">Product analytics and crash diagnostics</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">
                    <strong>Apple / Google</strong>
                  </td>
                  <td className="py-2">Optional sign-in with Apple ID or Google Account</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p>
            We do not share your information with advertisers, data brokers, or any third party for
            their own marketing purposes.
          </p>
          <p>
            We may disclose information if required by law, court order, or to protect the rights,
            property, or safety of J&amp;A, our personnel, our guests, or the public.
          </p>

          <hr className="border-white/10" />

          <h2 className="text-2xl font-semibold text-white">5. Data retention</h2>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Account data</strong> is retained while you are an active user and for a
              reasonable period after deactivation for audit and legal purposes.
            </li>
            <li>
              <strong>Job records, photos, and incident reports</strong> are retained for the
              operational and legal record-keeping period required by our property and contractual
              obligations.
            </li>
            <li>
              <strong>Analytics and diagnostic data</strong> is retained for up to 24 months in
              aggregated or de-identified form.
            </li>
          </ul>
          <p>When the retention period ends, we delete or anonymize the data.</p>

          <hr className="border-white/10" />

          <h2 className="text-2xl font-semibold text-white">6. Security</h2>
          <p>
            We use industry-standard safeguards to protect your information, including encryption in
            transit (HTTPS/TLS), encryption at rest with our cloud providers, role-based access
            controls, and secure credential storage on the device (Expo Secure Store / Android
            Keystore / iOS Keychain). No system is perfectly secure; we cannot guarantee absolute
            security.
          </p>

          <hr className="border-white/10" />

          <h2 className="text-2xl font-semibold text-white">7. Your rights</h2>
          <p>Depending on where you live, you may have the right to:</p>
          <ul className="list-disc space-y-2 pl-6">
            <li>Access the personal information we hold about you.</li>
            <li>Correct inaccurate information.</li>
            <li>Request deletion of your information.</li>
            <li>Object to or restrict certain processing.</li>
            <li>Withdraw consent where processing is based on consent.</li>
            <li>Lodge a complaint with your local data protection authority.</li>
          </ul>
          <p>
            To exercise any of these rights, email{" "}
            <strong>
              <a className="text-blue-300 underline hover:text-blue-200" href="mailto:privacy@ja-bs.com">
                privacy@ja-bs.com
              </a>
            </strong>
            . We will respond within the time period required by applicable law (typically 30 days).
            We may need to verify your identity before fulfilling the request.
          </p>

          <h3 className="text-xl font-semibold text-white">Account and data deletion</h3>
          <p>
            You can request deletion of your account and associated personal data at any time by
            emailing{" "}
            <strong>
              <a className="text-blue-300 underline hover:text-blue-200" href="mailto:privacy@ja-bs.com">
                privacy@ja-bs.com
              </a>
            </strong>
            . Some records (such as completed job logs, audit trails, and tax-related records) may
            be retained where law or our property contracts require it; we will explain what is
            retained and why.
          </p>

          <hr className="border-white/10" />

          <h2 className="text-2xl font-semibold text-white">8. Children&rsquo;s privacy</h2>
          <p>
            The App is intended for adult employees and contractors only. We do not knowingly
            collect information from anyone under 18. If we learn we have collected information from
            a child, we will delete it.
          </p>

          <hr className="border-white/10" />

          <h2 className="text-2xl font-semibold text-white">9. International users</h2>
          <p>
            The App is operated from the United States. If you access it from outside the U.S., your
            information will be transferred to and processed in the U.S., where data protection laws
            may differ from those in your country.
          </p>

          <hr className="border-white/10" />

          <h2 className="text-2xl font-semibold text-white">10. Changes to this policy</h2>
          <p>
            We may update this policy as the App evolves. The &ldquo;Last updated&rdquo; date at the
            top will reflect the most recent version. Significant changes will be communicated
            through the App or by email.
          </p>

          <hr className="border-white/10" />

          <h2 className="text-2xl font-semibold text-white">11. Contact</h2>
          <p>
            For questions, requests, or complaints about this policy or our handling of your
            information:
          </p>
          <p>
            <strong>J&amp;A Business Solutions LLC</strong>
            <br />
            Tucson, Arizona, USA
            <br />
            Email:{" "}
            <a className="text-blue-300 underline hover:text-blue-200" href="mailto:privacy@ja-bs.com">
              privacy@ja-bs.com
            </a>
          </p>
        </article>
      </main>

      <footer className="border-t border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-6 text-xs text-white/50">
          © {new Date().getFullYear()} J&amp;A Business Solutions LLC ·{" "}
          <Link href="/privacy" className="hover:text-white">
            Privacy Policy
          </Link>
        </div>
      </footer>
    </div>
  );
}
