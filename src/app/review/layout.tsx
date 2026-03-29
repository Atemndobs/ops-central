import type { Metadata } from "next";
import { ReviewShell } from "@/components/review/review-shell";

export const metadata: Metadata = {
  title: "OpsCentral Reviewer",
  description: "Scoped reviewer workspace for property ops and managers.",
};

export default function ReviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <section
      className="min-h-screen [--background:#0b1220] [--foreground:#e2e8f0] [--card:#111a2a] [--card-foreground:#e2e8f0] [--muted:#162236] [--muted-foreground:#94a3b8] [--border:#243045] [--primary:#38bdf8] [--primary-foreground:#082f49] [--destructive:#fb7185]"
      style={{ colorScheme: "dark" }}
    >
      <ReviewShell>{children}</ReviewShell>
    </section>
  );
}
