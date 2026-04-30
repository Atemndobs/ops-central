import { Wrench } from "lucide-react";

export default function MaintenancePage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <Wrench className="h-10 w-10 text-muted-foreground" aria-hidden />
      <h1 className="text-2xl font-semibold">Maintenance</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Track repairs, vendor work, and recurring upkeep across properties.
        Implementation in progress — see{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">
          Docs/2026-04-28-maintenance-section-plan.md
        </code>
        .
      </p>
    </div>
  );
}
