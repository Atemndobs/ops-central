"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Loader2, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";
import { Button, Input, Label, Select } from "../ui";

type Frequency =
  | "one_time" | "monthly" | "quarterly" | "annual" | "yearly"
  | "per_booking" | "revenue_percentage";

const FREQUENCIES: Array<{ value: Frequency; label: string }> = [
  { value: "monthly", label: "Monthly" },
  { value: "per_booking", label: "Per booking" },
  { value: "revenue_percentage", label: "% of revenue" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annual" },
  { value: "one_time", label: "One-time (excluded)" },
];
const freqLabel = (f: string) => FREQUENCIES.find((x) => x.value === f)?.label ?? f;
const isPct = (f: string) => f === "revenue_percentage";

const fmtUsd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

/** Monthly-equivalent display; variable frequencies show a basis label. */
function monthlyHint(amount: number, frequency: string, pct: number | null): string {
  switch (frequency) {
    case "monthly": return `${fmtUsd(amount)}/mo`;
    case "quarterly": return `${fmtUsd(amount / 3)}/mo`;
    case "annual":
    case "yearly": return `${fmtUsd(amount / 12)}/mo`;
    case "per_booking": return `${fmtUsd(amount)} × bookings`;
    case "revenue_percentage": return `${pct ?? 0}% of revenue`;
    case "one_time": return "excluded";
    default: return "";
  }
}

type Draft = {
  name: string;
  categoryId: string;
  frequency: Frequency;
  amount: string; // raw input — $ for most, % for revenue_percentage
  isActive: boolean;
};
const emptyDraft = (categoryId: string): Draft => ({
  name: "", categoryId, frequency: "monthly", amount: "", isActive: true,
});

type CategoryOption = { _id: string; name: string };

/**
 * Editable cells shared by the add + edit rows. Module-scoped (not nested in
 * CostsManager) so it isn't recreated each render — a nested component would
 * remount on every keystroke and the inputs would lose focus.
 */
function DraftFields({
  draft,
  onChange,
  categories,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  categories: CategoryOption[];
}) {
  return (
    <>
      <td className="p-2">
        <Input
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="e.g. Lease"
          className="h-8 w-40"
        />
      </td>
      <td className="p-2">
        <Select
          value={draft.categoryId}
          onChange={(e) => onChange({ ...draft, categoryId: e.target.value })}
          className="h-8 w-44"
        >
          {categories.map((c) => (
            <option key={c._id} value={c._id}>{c.name}</option>
          ))}
        </Select>
      </td>
      <td className="p-2">
        <Select
          value={draft.frequency}
          onChange={(e) => onChange({ ...draft, frequency: e.target.value as Frequency })}
          className="h-8 w-40"
        >
          {FREQUENCIES.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </Select>
      </td>
      <td className="p-2 text-right">
        <div className="inline-flex items-center gap-1">
          {!isPct(draft.frequency) && <span className="text-[var(--muted-foreground)]">$</span>}
          <Input
            type="number"
            value={draft.amount}
            onChange={(e) => onChange({ ...draft, amount: e.target.value })}
            className="h-8 w-24 text-right"
            placeholder={isPct(draft.frequency) ? "%" : "0"}
          />
          {isPct(draft.frequency) && <span className="text-[var(--muted-foreground)]">%</span>}
        </div>
      </td>
      <td className="p-2 text-center">
        <input
          type="checkbox"
          checked={draft.isActive}
          onChange={(e) => onChange({ ...draft, isActive: e.target.checked })}
          className="h-4 w-4 rounded border-[var(--input)] accent-[var(--primary)]"
        />
      </td>
    </>
  );
}

export function CostsManager() {
  const { showToast } = useToast();
  const properties = useQuery(api.strCosts.queries.getProperties, {});
  const categories = useQuery(api.strCosts.costItems.listCostCategories, {});

  const [propertyId, setPropertyId] = useState<string>("");
  const items = useQuery(
    api.strCosts.costItems.listPropertyCostItems,
    propertyId ? { propertyId: propertyId as Id<"properties">, includeInactive: true } : "skip",
  );

  const createItem = useMutation(api.strCosts.costItems.createPropertyCostItem);
  const updateItem = useMutation(api.strCosts.costItems.updatePropertyCostItem);
  const deleteItem = useMutation(api.strCosts.costItems.deletePropertyCostItem);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft | null>(null);
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const defaultCategoryId = useMemo(() => categories?.[0]?._id ?? "", [categories]);

  function startAdd() {
    setAddDraft(emptyDraft(defaultCategoryId as string));
    setAdding(true);
  }

  function draftToArgs(d: Draft) {
    const num = Number(d.amount) || 0;
    return {
      categoryId: d.categoryId as Id<"costCategories">,
      name: d.name,
      frequency: d.frequency,
      amount: isPct(d.frequency) ? 0 : num,
      percentageRate: isPct(d.frequency) ? num : undefined,
      isActive: d.isActive,
    };
  }

  function validate(d: Draft): string | null {
    if (!d.name.trim()) return "Name is required.";
    if (!d.categoryId) return "Pick a category.";
    if (isPct(d.frequency)) {
      if (Number(d.amount) <= 0) return "Enter a percentage.";
    } else if (d.frequency !== "one_time" && Number(d.amount) <= 0) {
      return "Enter an amount.";
    }
    return null;
  }

  async function handleCreate() {
    if (!addDraft || !propertyId) return;
    const err = validate(addDraft);
    if (err) return showToast(err, "error");
    setBusy(true);
    try {
      await createItem({ propertyId: propertyId as Id<"properties">, ...draftToArgs(addDraft) });
      showToast("Cost line added.", "success");
      setAdding(false);
      setAddDraft(null);
    } catch (e) {
      showToast(`Add failed: ${String(e)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdate(id: string) {
    if (!editDraft) return;
    const err = validate(editDraft);
    if (err) return showToast(err, "error");
    setBusy(true);
    try {
      await updateItem({ id: id as Id<"propertyCostItems">, ...draftToArgs(editDraft) });
      showToast("Cost line saved.", "success");
      setEditingId(null);
      setEditDraft(null);
    } catch (e) {
      showToast(`Save failed: ${String(e)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete cost line "${name}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      await deleteItem({ id: id as Id<"propertyCostItems"> });
      showToast("Cost line deleted.", "success");
    } catch (e) {
      showToast(`Delete failed: ${String(e)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(id: string, next: boolean) {
    setBusy(true);
    try {
      await updateItem({ id: id as Id<"propertyCostItems">, isActive: next });
    } catch (e) {
      showToast(`Update failed: ${String(e)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  const catName = (id: string) => categories?.find((c) => c._id === id)?.name ?? "—";

  const loading = properties === undefined || categories === undefined;

  return (
    <div className="space-y-4">
      {/* Property picker */}
      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor="costs-property">Property</Label>
        <Select
          id="costs-property"
          value={propertyId}
          onChange={(e) => {
            setPropertyId(e.target.value);
            setEditingId(null);
            setAdding(false);
          }}
          className="w-64"
          disabled={loading}
        >
          <option value="">— Select a property —</option>
          {(properties ?? []).map((p) => (
            <option key={p._id} value={p._id}>{p.name}</option>
          ))}
        </Select>
        {propertyId && (
          <Button variant="outline" onClick={startAdd} disabled={adding || busy}>
            <Plus className="h-4 w-4" /> Add cost line
          </Button>
        )}
      </div>

      {!propertyId ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          Pick a property to view and edit its recurring cost lines.
        </p>
      ) : items === undefined ? (
        <div className="flex items-center gap-2 p-6 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--muted)] text-left">
                <th className="p-2 font-medium">Name</th>
                <th className="p-2 font-medium">Category</th>
                <th className="p-2 font-medium">Frequency</th>
                <th className="p-2 text-right font-medium">Amount</th>
                <th className="p-2 text-center font-medium">Active</th>
                <th className="p-2 text-right font-medium">Monthly</th>
                <th className="p-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {/* Add row */}
              {adding && addDraft && (
                <tr className="border-b border-[var(--border)] bg-[var(--muted)]">
                  <DraftFields draft={addDraft} onChange={setAddDraft} categories={categories ?? []} />
                  <td className="p-2 text-right text-[var(--muted-foreground)]">—</td>
                  <td className="p-2 text-right">
                    <div className="inline-flex gap-1">
                      <Button size="sm" onClick={() => void handleCreate()} disabled={busy}>
                        <Check className="h-3 w-3" /> Add
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setAddDraft(null); }} disabled={busy}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              )}

              {items.length === 0 && !adding ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-[var(--muted-foreground)]">
                    No cost lines yet. Click “Add cost line” to create one.
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const editing = editingId === item._id;
                  if (editing && editDraft) {
                    return (
                      <tr key={item._id} className="border-b border-[var(--border)]">
                        <DraftFields draft={editDraft} onChange={setEditDraft} categories={categories ?? []} />
                        <td className="p-2 text-right text-[var(--muted-foreground)]">—</td>
                        <td className="p-2 text-right">
                          <div className="inline-flex gap-1">
                            <Button size="sm" onClick={() => void handleUpdate(item._id)} disabled={busy}>
                              <Check className="h-3 w-3" /> Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => { setEditingId(null); setEditDraft(null); }} disabled={busy}>
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr
                      key={item._id}
                      className={`border-b border-[var(--border)] hover:bg-[var(--muted)]${item.isActive ? "" : " opacity-50"}`}
                    >
                      <td className="p-2 font-medium">{item.name}</td>
                      <td className="p-2 text-[var(--muted-foreground)]">{catName(item.categoryId as string)}</td>
                      <td className="p-2">{freqLabel(item.frequency)}</td>
                      <td className="p-2 text-right">
                        {isPct(item.frequency) ? `${item.percentageRate ?? 0}%` : fmtUsd(item.amount)}
                      </td>
                      <td className="p-2 text-center">
                        <input
                          type="checkbox"
                          checked={item.isActive}
                          onChange={(e) => void toggleActive(item._id, e.target.checked)}
                          className="h-4 w-4 rounded border-[var(--input)] accent-[var(--primary)]"
                          disabled={busy}
                        />
                      </td>
                      <td className="p-2 text-right text-[var(--muted-foreground)]">
                        {monthlyHint(item.amount, item.frequency, item.percentageRate)}
                      </td>
                      <td className="p-2 text-right">
                        <div className="inline-flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => {
                              setEditingId(item._id);
                              setEditDraft({
                                name: item.name,
                                categoryId: item.categoryId as string,
                                frequency: item.frequency as Frequency,
                                amount: String(isPct(item.frequency) ? (item.percentageRate ?? 0) : item.amount),
                                isActive: item.isActive,
                              });
                              setAdding(false);
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void handleDelete(item._id, item.name)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-[var(--muted-foreground)]">
        Changes recompute the Monthly Close table and owner statement automatically — costs are derived
        from these active lines (monthly-equivalent: quarterly ÷3, annual ÷12, per-booking × bookings,
        % of revenue × gross). One-time lines are excluded from the monthly P&amp;L.
      </p>
    </div>
  );
}
