import Link from "next/link";
import { CostsManager } from "@/admin/tools/monthly-close/costs/CostsManager";

export const metadata = {
  title: "Property Costs",
};

export default function PropertyCostsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Property Costs</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Edit each property&apos;s recurring cost lines (lease, cleaning, utilities, subscriptions…).
          These feed the{" "}
          <Link href="/reports/monthly-close" className="text-[var(--primary)] underline">
            Monthly Close
          </Link>{" "}
          P&amp;L and the Chez Soi Stays owner statement.
        </p>
      </div>
      <CostsManager />
    </div>
  );
}
