import { Plus, Search, Package, AlertTriangle } from "lucide-react";

/**
 * INVENTORY PAGE
 *
 * Design brief for designer:
 * - Table of inventory items with stock levels
 * - Columns: Item, Category, Property, Current Stock, Par Level, Status
 * - Status: OK (green), Low (yellow), Out (red)
 * - Low stock alerts banner at top (items below par level)
 * - Filter by: property, category, status
 * - "Generate Shopping List" button → creates reorder list
 * - Click item → edit stock levels
 */
export default function InventoryPage() {
  return (
    <div className="space-y-4">
      {/* Low stock alert banner */}
      <div className="flex items-center gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
        <AlertTriangle className="h-4 w-4 text-yellow-500" />
        <span className="text-sm text-yellow-500">
          Low stock alerts will appear here when items fall below par level
        </span>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-1.5">
            <Search className="h-4 w-4 text-[var(--muted-foreground)]" />
            <input
              type="text"
              placeholder="Search inventory..."
              className="bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:bg-[var(--accent)]">
            Shopping List
          </button>
          <button className="flex items-center gap-2 rounded-md bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
            <Plus className="h-4 w-4" />
            Add Item
          </button>
        </div>
      </div>

      {/* Inventory table placeholder */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
        <div className="flex items-center justify-center py-24 text-sm text-[var(--muted-foreground)]">
          <div className="text-center">
            <Package className="mx-auto h-8 w-8 mb-2 opacity-40" />
            <p>Inventory items will load from Convex</p>
            <p className="text-xs mt-1">
              Table with stock levels, par levels, and status indicators
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
