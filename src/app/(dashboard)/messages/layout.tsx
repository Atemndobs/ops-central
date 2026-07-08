import { Manrope } from "next/font/google";

const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-manrope",
  weight: ["400", "500", "600", "700", "800"],
});

export default function MessagesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`theme-messages ${manrope.variable} -m-6 md:-m-8`}>
      <div className="min-h-[calc(100vh-4rem)] bg-[var(--msg-surface)] p-4 md:p-6">
        {children}
      </div>
    </div>
  );
}
