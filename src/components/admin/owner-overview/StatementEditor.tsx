"use client";

// Admin Owner Overview — RIGHT-column editor (Phase 4).
// Exclude bookings + costs, override buckets, set notes, mark ready / issue.
// Consumes the same `getPropertyPreview` data the read-only view used in
// Phase 3 — this component just adds controls + persistence via upsertDraft,
// markReady, issueStatement.

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Loader2, Save, Send, CheckCircle2 } from "lucide-react";

type EditorBooking = {
  _id: Id<"stays">;
  guestName: string;
  checkInAt: number;
  checkOutAt: number;
  grossAmount: number;
  cancelledAt: number | undefined;
  excluded: boolean;
};

type EditorCostItem = {
  _id: Id<"propertyCostItems">;
  name: string;
  amount: number;
  frequency: string;
  bucket: string | undefined;
  excluded: boolean;
  overriddenBucket: string | null;
};

type OverridesShape = {
  show_mortgage?: boolean;
  show_mgmt_fee?: boolean;
  show_payout?: boolean;
  show_cost_line_items?: boolean;
};

const OVERRIDE_KEYS: Array<{ key: keyof OverridesShape; label: string }> = [
  { key: "show_mortgage", label: "Show mortgage" },
  { key: "show_mgmt_fee", label: "Show mgmt fee" },
  { key: "show_payout", label: "Show owner payout" },
  { key: "show_cost_line_items", label: "Show cost line items" },
];

// Bucket choices match the engine's BUCKETS list — keep in sync with
// convex/owner/constants.ts if you add buckets there.
const BUCKETS = [
  "platform_fees",
  "cleaning",
  "supplies",
  "utilities",
  "maintenance",
  "marketing",
  "mortgage",
  "insurance",
  "tax",
  "other",
];

function formatCurrency(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function StatementEditor({
  propertyId,
  period,
  currency,
  draftId,
  initialBookings,
  initialCostItems,
  initialOverrides,
  initialNotes,
  status,
}: {
  propertyId: Id<"properties">;
  period: string;
  currency: string;
  draftId: Id<"ownerStatements"> | null;
  initialBookings: EditorBooking[];
  initialCostItems: EditorCostItem[];
  initialOverrides: OverridesShape;
  initialNotes: string;
  status: "draft" | "ready" | "issued" | "sent" | "recalled" | null;
}) {
  // Local edit state, seeded from server. Reseeded when period/propertyId
  // changes (keyed by `${propertyId}:${period}` to force fresh state).
  const [excludedStayIds, setExcludedStayIds] = useState<Set<Id<"stays">>>(
    () =>
      new Set(initialBookings.filter((b) => b.excluded).map((b) => b._id)),
  );
  const [excludedCostItemIds, setExcludedCostItemIds] = useState<
    Set<Id<"propertyCostItems">>
  >(
    () =>
      new Set(initialCostItems.filter((c) => c.excluded).map((c) => c._id)),
  );
  const [bucketOverrides, setBucketOverrides] = useState<
    Map<Id<"propertyCostItems">, string>
  >(
    () =>
      new Map(
        initialCostItems
          .filter((c) => c.overriddenBucket)
          .map((c) => [c._id, c.overriddenBucket!]),
      ),
  );
  const [overrides, setOverrides] =
    useState<OverridesShape>(initialOverrides);
  const [notes, setNotes] = useState(initialNotes);

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upsertDraft = useMutation(api.admin.ownerOverview.upsertDraft);
  const markReady = useMutation(api.admin.ownerOverview.markReady);
  const issueStatement = useMutation(api.admin.ownerOverview.issueStatement);

  // Dirty = any local change diverges from server-seeded initial.
  const dirty = useMemo(() => {
    const initialExclStays = new Set(
      initialBookings.filter((b) => b.excluded).map((b) => b._id),
    );
    const initialExclCosts = new Set(
      initialCostItems.filter((c) => c.excluded).map((c) => c._id),
    );
    if (setsDiffer(excludedStayIds, initialExclStays)) return true;
    if (setsDiffer(excludedCostItemIds, initialExclCosts)) return true;
    if (notes !== initialNotes) return true;
    if (JSON.stringify(overrides) !== JSON.stringify(initialOverrides))
      return true;
    const initBuckets = new Map(
      initialCostItems
        .filter((c) => c.overriddenBucket)
        .map((c) => [c._id, c.overriddenBucket!]),
    );
    if (mapsDiffer(bucketOverrides, initBuckets)) return true;
    return false;
  }, [
    excludedStayIds,
    excludedCostItemIds,
    bucketOverrides,
    overrides,
    notes,
    initialBookings,
    initialCostItems,
    initialOverrides,
    initialNotes,
  ]);

  // Auto-clear the "saved" pill after 2s.
  useEffect(() => {
    if (savedAt === null) return;
    const t = setTimeout(() => setSavedAt(null), 2000);
    return () => clearTimeout(t);
  }, [savedAt]);

  const locked = status === "issued" || status === "sent";

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await upsertDraft({
        propertyId,
        period,
        patch: {
          overrides: stripUndefined(overrides),
          excludedStayIds: Array.from(excludedStayIds),
          excludedCostItemIds: Array.from(excludedCostItemIds),
          costBucketOverrides: Array.from(bucketOverrides.entries()).map(
            ([costItemId, bucket]) => ({ costItemId, bucket }),
          ),
          notes: notes || undefined,
        },
      });
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkReady() {
    if (!draftId) {
      setError("Save the draft first");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await markReady({ statementId: draftId });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleIssue() {
    if (!draftId) {
      setError("Save the draft first");
      return;
    }
    if (
      !confirm(
        "Issue this statement? The owner will be notified and a PDF will be generated. This is irreversible (use Recall in Phase 5).",
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await issueStatement({ statementId: draftId });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Status panel */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Status
            </div>
            <div className="mt-0.5 font-medium">
              {status ?? "No draft yet"}
              {dirty && (
                <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">
                  • unsaved changes
                </span>
              )}
              {savedAt !== null && (
                <span className="ml-2 inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" /> saved
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || locked || !dirty}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted/40 disabled:opacity-40"
            >
              {saving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}
              Save draft
            </button>
            <button
              type="button"
              onClick={handleMarkReady}
              disabled={saving || locked || status !== "draft" || dirty}
              className="inline-flex items-center gap-1 rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-1.5 text-xs text-blue-700 hover:bg-blue-500/20 disabled:opacity-40 dark:text-blue-300"
            >
              Mark ready
            </button>
            <button
              type="button"
              onClick={handleIssue}
              disabled={saving || locked || !draftId || dirty}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-700 hover:bg-emerald-500/20 disabled:opacity-40 dark:text-emerald-300"
            >
              <Send className="h-3 w-3" />
              Issue statement
            </button>
          </div>
        </div>
        {error && (
          <div className="mt-2 rounded-md border border-red-500/40 bg-red-500/5 px-2 py-1 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
        {locked && (
          <p className="mt-2 text-xs text-muted-foreground">
            This statement is {status} — immutable. Use Recall in a later
            phase to amend.
          </p>
        )}
      </div>

      {/* Visibility overrides */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Owner visibility (override global defaults)
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {OVERRIDE_KEYS.map(({ key, label }) => {
            const val = overrides[key];
            const isSet = val !== undefined;
            return (
              <label
                key={key}
                className="flex items-center justify-between rounded-md border border-border bg-muted/10 px-3 py-2 text-sm"
              >
                <span>
                  {label}{" "}
                  <span className="text-xs text-muted-foreground">
                    ({isSet ? "override" : "default"})
                  </span>
                </span>
                <select
                  className="rounded border border-border bg-background px-2 py-0.5 text-xs"
                  value={val === undefined ? "" : val ? "show" : "hide"}
                  onChange={(e) => {
                    const v = e.target.value;
                    setOverrides((prev) => {
                      const next = { ...prev };
                      if (v === "") delete next[key];
                      else next[key] = v === "show";
                      return next;
                    });
                  }}
                  disabled={locked}
                >
                  <option value="">default</option>
                  <option value="show">show</option>
                  <option value="hide">hide</option>
                </select>
              </label>
            );
          })}
        </div>
      </div>

      {/* Bookings editor */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Bookings ({initialBookings.length})
          </span>
          <span className="text-[10px] text-muted-foreground">
            Unchecked rows are excluded from gross
          </span>
        </div>
        {initialBookings.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            No bookings in this period.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="w-10 px-2 py-2 text-center font-medium">✓</th>
                <th className="px-3 py-2 text-left font-medium">Guest</th>
                <th className="px-3 py-2 text-left font-medium">Stay</th>
                <th className="px-3 py-2 text-right font-medium">Gross</th>
              </tr>
            </thead>
            <tbody>
              {initialBookings.map((s) => {
                const included = !excludedStayIds.has(s._id);
                return (
                  <tr
                    key={s._id}
                    className={`border-b border-border last:border-b-0 ${included ? "" : "opacity-50"}`}
                  >
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={included}
                        disabled={locked}
                        onChange={(e) =>
                          setExcludedStayIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.delete(s._id);
                            else next.add(s._id);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      {s.guestName}
                      {s.cancelledAt && (
                        <span className="ml-2 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] text-red-600 dark:text-red-400">
                          cancelled
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {formatDate(s.checkInAt)} → {formatDate(s.checkOutAt)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(s.grossAmount, currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Costs editor */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Cost items ({initialCostItems.length})
          </span>
          <span className="text-[10px] text-muted-foreground">
            Recategorize via the bucket dropdown
          </span>
        </div>
        {initialCostItems.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            No active cost items on this property.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="w-10 px-2 py-2 text-center font-medium">✓</th>
                <th className="px-3 py-2 text-left font-medium">Item</th>
                <th className="px-3 py-2 text-left font-medium">Bucket</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {initialCostItems.map((c) => {
                const included = !excludedCostItemIds.has(c._id);
                const overrideBucket = bucketOverrides.get(c._id);
                const effectiveBucket = overrideBucket ?? c.bucket ?? "";
                return (
                  <tr
                    key={c._id}
                    className={`border-b border-border last:border-b-0 ${included ? "" : "opacity-50"}`}
                  >
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={included}
                        disabled={locked}
                        onChange={(e) =>
                          setExcludedCostItemIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.delete(c._id);
                            else next.add(c._id);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className="px-3 py-2">{c.name}</td>
                    <td className="px-3 py-2">
                      <select
                        className="rounded border border-border bg-background px-2 py-0.5 text-xs"
                        value={effectiveBucket}
                        disabled={locked}
                        onChange={(e) => {
                          const v = e.target.value;
                          setBucketOverrides((prev) => {
                            const next = new Map(prev);
                            if (v === c.bucket || v === "") next.delete(c._id);
                            else next.set(c._id, v);
                            return next;
                          });
                        }}
                      >
                        {!effectiveBucket && <option value="">—</option>}
                        {BUCKETS.map((b) => (
                          <option key={b} value={b}>
                            {b}
                            {b === c.bucket ? " (default)" : ""}
                          </option>
                        ))}
                      </select>
                      {overrideBucket && (
                        <span className="ml-2 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-600 dark:text-blue-400">
                          override
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(c.amount, currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Notes */}
      <div className="rounded-lg border border-border bg-card p-4">
        <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Notes to owner (rendered in the PDF)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={locked}
          rows={4}
          placeholder="Optional. Markdown supported."
          className="mt-2 w-full rounded-md border border-border bg-background p-2 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/30"
        />
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function setsDiffer<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return true;
  for (const x of a) if (!b.has(x)) return true;
  return false;
}

function mapsDiffer<K, V>(a: Map<K, V>, b: Map<K, V>): boolean {
  if (a.size !== b.size) return true;
  for (const [k, v] of a) if (b.get(k) !== v) return true;
  return false;
}

function stripUndefined<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const k in o) if (o[k] !== undefined) out[k] = o[k];
  return out as T;
}
