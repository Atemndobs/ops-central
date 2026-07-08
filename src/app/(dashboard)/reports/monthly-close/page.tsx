import MonthlyCloseApp from "@/admin/tools/monthly-close/App";

export const metadata = {
  title: "Monthly Close",
};

export default function MonthlyClosePage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Monthly Close</h1>
        <p className="text-sm text-muted-foreground">
          Deterministic portfolio P&amp;L — import Hospitable revenue, review the
          arbitrage table, and export a Chez Soi Stays owner statement.
        </p>
      </div>
      <MonthlyCloseApp />
    </div>
  );
}
