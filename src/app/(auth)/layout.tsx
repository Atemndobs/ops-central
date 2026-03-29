import Image from "next/image";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="dark min-h-screen bg-[oklch(0.13_0.01_260)] text-[oklch(0.985_0_0)]">
      <div className="flex min-h-screen flex-col lg:flex-row">
        {/* Brand panel */}
        <div className="relative flex flex-col items-center justify-center px-8 py-12 lg:w-[45%] lg:py-0">
          {/* Subtle gradient overlay */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[oklch(0.18_0.04_260)] via-transparent to-[oklch(0.15_0.03_280)] opacity-60" />

          {/* Dot pattern */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage:
                "radial-gradient(circle, oklch(0.9 0 0) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          />

          <div className="relative z-10 flex max-w-sm flex-col items-center text-center lg:items-start lg:text-left">
            {/* Logo */}
            <div className="mb-8 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[oklch(0.623_0.214_259)] text-white">
                <Image
                  src="/chezsoi-logo.svg"
                  alt="ChezSoi"
                  width={32}
                  height={32}
                  className="invert"
                />
              </div>
              <span className="text-2xl font-semibold tracking-tight">
                ChezSoi
              </span>
            </div>

            {/* Tagline */}
            <h1 className="mb-3 text-3xl font-bold tracking-tight lg:text-4xl">
              Operations Console
            </h1>
            <p className="text-base leading-relaxed text-[oklch(0.65_0_0)]">
              Property readiness starts here. Manage schedules, teams, and
              inspections from one place.
            </p>

            {/* Decorative stat chips — desktop only */}
            <div className="mt-10 hidden gap-3 lg:flex">
              <div className="rounded-lg border border-[oklch(0.3_0_0)] bg-[oklch(0.17_0_0)] px-4 py-2.5">
                <p className="text-xs font-medium text-[oklch(0.55_0_0)]">
                  Scheduling
                </p>
                <p className="text-sm font-semibold">Automated</p>
              </div>
              <div className="rounded-lg border border-[oklch(0.3_0_0)] bg-[oklch(0.17_0_0)] px-4 py-2.5">
                <p className="text-xs font-medium text-[oklch(0.55_0_0)]">
                  Inspections
                </p>
                <p className="text-sm font-semibold">Real-time</p>
              </div>
              <div className="rounded-lg border border-[oklch(0.3_0_0)] bg-[oklch(0.17_0_0)] px-4 py-2.5">
                <p className="text-xs font-medium text-[oklch(0.55_0_0)]">
                  Team Ops
                </p>
                <p className="text-sm font-semibold">Unified</p>
              </div>
            </div>
          </div>
        </div>

        {/* Auth widget panel — light card for Clerk readability */}
        <div className="flex flex-1 items-center justify-center px-4 py-12 lg:px-12">
          <div className="w-full max-w-[440px] rounded-2xl bg-white p-6 shadow-2xl" style={{ colorScheme: "light" }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
