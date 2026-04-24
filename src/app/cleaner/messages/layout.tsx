import { Manrope } from "next/font/google";

const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-manrope",
  weight: ["400", "500", "600", "700", "800"],
});

/**
 * Fixed-position wrapper: pins the messages page between the CleanerShell
 * header and the bottom nav so only the message list scrolls internally.
 * CleanerShell header: ~72px (top: safe + 72); bottom nav ≈ 72px tall.
 */
export default function CleanerMessagesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className={`theme-messages ${manrope.variable} fixed inset-x-0 z-10 flex flex-col bg-[var(--msg-surface)]`}
      style={{
        top: "calc(env(safe-area-inset-top) + 72px)",
        bottom: "calc(env(safe-area-inset-bottom) + 72px)",
      }}
    >
      <div className="mx-auto flex h-full w-full max-w-[402px] min-h-0 flex-col px-3 py-2">
        {children}
      </div>
    </div>
  );
}
