"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useAuth, useUser } from "@clerk/nextjs";
import { Plus, Settings2, Trash2, UserCheck, Users } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  getRoleFromMetadata,
  getRoleFromSessionClaimsOrNull,
  type UserRole,
} from "@/lib/auth";

// Ownership + fee config is admin/property_ops-only data. The backing query
// (getPropertyOwnership) is auth-gated to these roles server-side.
const OWNER_CARD_ROLES: readonly UserRole[] = ["admin", "property_ops"];

/**
 * Admin-side card for assigning owners + setting fee config on a property.
 * Inserted into /properties/[id]. Two stacked sections:
 *   1. Owners — table of active ownership rows + "Edit Owners" modal
 *   2. Fee Config — current contract terms + "Edit" modal
 *
 * Both modals hit existing append-only mutations (upsertPropertyOwners
 * + upsertPropertyFeeConfig) that are auth-gated to admin/property_ops.
 *
 * Managers can still reach /properties/[id], but must NOT fire the
 * admin-only ownership query — doing so throws a server error that crashes
 * the whole page. We resolve the viewer's role client-side and skip both
 * the query and the render for anyone outside admin/property_ops. The
 * server-side requireRole check remains the real security boundary.
 */
export function PropertyOwnersCard({ propertyId }: { propertyId: Id<"properties"> }) {
  const { isLoaded, isSignedIn, userId, sessionClaims } = useAuth();
  const { user } = useUser();

  const convexUser = useQuery(
    api.users.queries.getByClerkId,
    isLoaded && isSignedIn && userId ? { clerkId: userId } : "skip",
  );
  const role: UserRole | null =
    getRoleFromSessionClaimsOrNull(sessionClaims as Record<string, unknown> | null) ??
    getRoleFromMetadata(user?.publicMetadata) ??
    (convexUser?.role as UserRole | undefined) ??
    null;
  const canViewOwners = role !== null && OWNER_CARD_ROLES.includes(role);

  const data = useQuery(
    api.admin.ownerAssignment.getPropertyOwnership,
    canViewOwners ? { propertyId } : "skip",
  );
  const [editingOwners, setEditingOwners] = useState(false);
  const [editingFees, setEditingFees] = useState(false);

  // Not authorized (e.g. manager) — render nothing rather than crashing the page.
  if (!canViewOwners) {
    return null;
  }

  if (data === undefined) {
    return (
      <section className="rounded-2xl border bg-[var(--card)] p-5">
        <div className="h-32 animate-pulse rounded bg-[var(--secondary)]" />
      </section>
    );
  }

  return (
    <section className="rounded-2xl border bg-[var(--card)]">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
          <Users size={14} /> Owners &amp; Fees
        </h2>
        <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
          {data.historyCount.owners > data.owners.length && (
            <span>
              {data.historyCount.owners - data.owners.length} closed owner row
              {data.historyCount.owners - data.owners.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      {/* Owners */}
      <div className="border-b px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Active owners
          </h3>
          <button
            onClick={() => setEditingOwners(true)}
            className="inline-flex items-center gap-1 rounded-md border bg-transparent px-2.5 py-1 text-xs hover:bg-[var(--secondary)]"
          >
            <Settings2 size={12} /> Edit
          </button>
        </div>

        {data.owners.length === 0 ? (
          <div className="rounded border border-dashed p-6 text-center text-xs text-[var(--muted-foreground)]">
            No owners assigned. This property won&apos;t appear in any owner&apos;s portal.
          </div>
        ) : (
          <ul className="space-y-1">
            {data.owners.map((o) => (
              <li
                key={o._id}
                className="flex items-center justify-between rounded border px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  <span className="font-medium">{o.user?.name ?? o.user?.email ?? "(unknown user)"}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {o.user?.email}
                  </span>
                  <span className="rounded bg-[var(--secondary)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
                    {o.role}
                  </span>
                  {o.isPrimaryApprover && (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-emerald-900">
                      <UserCheck size={10} /> primary
                    </span>
                  )}
                  {o.user?.role !== "owner" && (
                    <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-red-900">
                      role ≠ owner
                    </span>
                  )}
                </span>
                <span className="font-mono tabular-nums text-sm">
                  {(o.stakePct * 100).toFixed(1)}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Fee config */}
      <div className="px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Active fee configuration
          </h3>
          <button
            onClick={() => setEditingFees(true)}
            className="inline-flex items-center gap-1 rounded-md border bg-transparent px-2.5 py-1 text-xs hover:bg-[var(--secondary)]"
          >
            <Settings2 size={12} /> Edit
          </button>
        </div>

        {!data.feeConfig ? (
          <div className="rounded border border-dashed p-6 text-center text-xs text-[var(--muted-foreground)]">
            No fee config. Owners can&apos;t see their statement draft until this is set.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 rounded border bg-[var(--secondary)]/30 p-3 text-sm md:grid-cols-4">
            <StatBox label="Fee %" value={`${(data.feeConfig.feePct * 100).toFixed(1)}%`} />
            <StatBox label="Fee base" value={data.feeConfig.feeBase} mono />
            <StatBox
              label="Approval threshold"
              value={fmtMoney(data.feeConfig.approvalThreshold, data.property.currency)}
              mono
            />
            <StatBox
              label="Auto-approve"
              value={
                data.feeConfig.autoApproveAfterDays
                  ? `${data.feeConfig.autoApproveAfterDays}d`
                  : "off"
              }
              mono
            />
          </div>
        )}
      </div>

      {editingOwners && (
        <EditOwnersModal
          propertyId={propertyId}
          currentOwners={data.owners}
          onClose={() => setEditingOwners(false)}
        />
      )}
      {editingFees && (
        <EditFeeConfigModal
          propertyId={propertyId}
          currency={data.property.currency}
          current={data.feeConfig}
          onClose={() => setEditingFees(false)}
        />
      )}
    </section>
  );
}

function StatBox({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
        {label}
      </div>
      <div
        className="mt-0.5 font-medium"
        style={{
          fontFamily: mono ? "var(--font-geist-mono, monospace)" : undefined,
          fontVariantNumeric: mono ? "tabular-nums" : undefined,
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ─── Edit Owners modal ─────────────────────────────────────────────────────

type OwnerRow = {
  userId: Id<"users">;
  stakePct: number;
  role: "landlord" | "investor";
  isPrimaryApprover: boolean;
};

function EditOwnersModal({
  propertyId,
  currentOwners,
  onClose,
}: {
  propertyId: Id<"properties">;
  currentOwners: Array<{
    userId: Id<"users">;
    stakePct: number;
    role: "landlord" | "investor";
    isPrimaryApprover: boolean;
    user: { name: string | null; email: string } | null;
  }>;
  onClose: () => void;
}) {
  const ownerUsers = useQuery(api.admin.ownerAssignment.listOwnerUsers);
  const upsert = useMutation(api.owner.mutations.upsertPropertyOwners);

  const [rows, setRows] = useState<OwnerRow[]>(
    currentOwners.length > 0
      ? currentOwners.map((o) => ({
          userId: o.userId,
          stakePct: o.stakePct,
          role: o.role,
          isPrimaryApprover: o.isPrimaryApprover,
        }))
      : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const stakeSum = rows.reduce((s, r) => s + r.stakePct, 0);
  const primaryCount = rows.filter((r) => r.isPrimaryApprover).length;

  function addRow(userId: Id<"users">) {
    if (rows.some((r) => r.userId === userId)) return;
    setRows((prev) => [
      ...prev,
      {
        userId,
        stakePct: prev.length === 0 ? 1.0 : 0,
        role: "landlord",
        isPrimaryApprover: prev.length === 0,
      },
    ]);
  }

  function updateRow(i: number, patch: Partial<OwnerRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function submit() {
    setError(null);
    if (Math.abs(stakeSum - 1.0) > 0.0001) {
      setError(`Stake must sum to 1.0 (currently ${stakeSum.toFixed(4)})`);
      return;
    }
    if (primaryCount !== 1) {
      setError(`Exactly one Primary Approver required (currently ${primaryCount})`);
      return;
    }
    setSubmitting(true);
    try {
      await upsert({ propertyId, owners: rows });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const userById = new Map((ownerUsers ?? []).map((u) => [u._id, u]));

  return (
    <ModalShell title="Edit property owners" onClose={onClose}>
      <p className="mb-4 text-xs text-[var(--muted-foreground)]">
        Stake must sum to 1.0 and exactly one owner must be the Primary Approver.
        Saving closes the current active ownership rows and inserts new ones
        (append-only audit trail).
      </p>

      {rows.length > 0 && (
        <div className="mb-4 space-y-2">
          {rows.map((r, i) => {
            const u = userById.get(r.userId) ?? currentOwners.find((c) => c.userId === r.userId)?.user;
            return (
              <div key={r.userId} className="flex items-center gap-2 rounded border p-2 text-sm">
                <span className="flex-1 truncate">
                  <span className="font-medium">{u?.name ?? u?.email ?? r.userId}</span>
                  {u && "email" in u && <span className="ml-2 text-xs text-[var(--muted-foreground)]">{u.email}</span>}
                </span>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  max={1}
                  value={r.stakePct}
                  onChange={(e) => updateRow(i, { stakePct: parseFloat(e.target.value) || 0 })}
                  className="w-20 rounded border bg-transparent px-2 py-1 text-right text-xs tabular-nums"
                />
                <select
                  value={r.role}
                  onChange={(e) => updateRow(i, { role: e.target.value as "landlord" | "investor" })}
                  className="rounded border bg-transparent px-2 py-1 text-xs"
                >
                  <option value="landlord">Landlord</option>
                  <option value="investor">Investor</option>
                </select>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="radio"
                    name="primary"
                    checked={r.isPrimaryApprover}
                    onChange={() => setRows((prev) => prev.map((rr, idx) => ({ ...rr, isPrimaryApprover: idx === i })))}
                  />
                  Primary
                </label>
                <button
                  onClick={() => removeRow(i)}
                  className="rounded p-1 text-[var(--muted-foreground)] hover:bg-red-50 hover:text-red-900"
                  aria-label="Remove"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
          <div className="flex justify-end gap-3 px-2 text-xs">
            <span>
              Stake sum:{" "}
              <span
                className={
                  Math.abs(stakeSum - 1.0) > 0.0001
                    ? "font-mono font-bold text-red-700"
                    : "font-mono font-bold text-emerald-700"
                }
              >
                {stakeSum.toFixed(4)}
              </span>
            </span>
            <span>
              Primary:{" "}
              <span
                className={
                  primaryCount === 1 ? "font-bold text-emerald-700" : "font-bold text-red-700"
                }
              >
                {primaryCount}
              </span>
            </span>
          </div>
        </div>
      )}

      {/* Add-user picker */}
      <div className="mb-4">
        <label className="mb-1 block text-xs font-medium">Add owner</label>
        <select
          onChange={(e) => {
            if (e.target.value) addRow(e.target.value as Id<"users">);
            e.currentTarget.selectedIndex = 0;
          }}
          className="w-full rounded border bg-transparent px-2 py-1.5 text-sm"
          defaultValue=""
        >
          <option value="" disabled>
            {ownerUsers === undefined ? "Loading…" : "Pick a user with role=owner…"}
          </option>
          {(ownerUsers ?? [])
            .filter((u) => !rows.some((r) => r.userId === u._id))
            .map((u) => (
              <option key={u._id} value={u._id}>
                {u.name ? `${u.name} (${u.email})` : u.email}
              </option>
            ))}
        </select>
        <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
          Only users with role &quot;owner&quot; appear. Set role on the Team page first.
        </p>
      </div>

      {error && (
        <p className="mb-3 rounded bg-red-50 p-2 text-xs text-red-900">{error}</p>
      )}

      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-md border bg-transparent px-3 py-1.5 text-sm hover:bg-[var(--secondary)]"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={submitting || rows.length === 0}
          className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Save owners"}
        </button>
      </div>
    </ModalShell>
  );
}

// ─── Edit Fee Config modal ─────────────────────────────────────────────────

function EditFeeConfigModal({
  propertyId,
  currency,
  current,
  onClose,
}: {
  propertyId: Id<"properties">;
  currency: string;
  current: {
    feePct: number;
    feeBase: string;
    approvalThreshold: number;
    autoApproveAfterDays: number | null;
  } | null;
  onClose: () => void;
}) {
  const upsert = useMutation(api.owner.mutations.upsertPropertyFeeConfig);
  const [feePct, setFeePct] = useState((current?.feePct ?? 0.2) * 100);
  const [feeBase, setFeeBase] = useState<"grossRevenue" | "netRevenue" | "netOperatingProfit">(
    (current?.feeBase as "grossRevenue" | "netRevenue" | "netOperatingProfit") ?? "netRevenue",
  );
  const [approvalThreshold, setApprovalThreshold] = useState(current?.approvalThreshold ?? 500);
  const [autoApprove, setAutoApprove] = useState(
    current?.autoApproveAfterDays != null ? String(current.autoApproveAfterDays) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setError(null);
    if (feePct < 0 || feePct > 100) {
      setError("Fee % must be between 0 and 100");
      return;
    }
    setSubmitting(true);
    try {
      await upsert({
        propertyId,
        feePct: feePct / 100,
        feeBase,
        approvalThreshold,
        autoApproveAfterDays: autoApprove ? parseInt(autoApprove, 10) : undefined,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="Edit fee configuration" onClose={onClose}>
      <p className="mb-4 text-xs text-[var(--muted-foreground)]">
        Append-only: saving closes the current active fee config and inserts a
        new one (so historical statements always know which rate was in force).
      </p>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium">Fee %</label>
          <input
            type="number"
            step="0.1"
            min={0}
            max={100}
            value={feePct}
            onChange={(e) => setFeePct(parseFloat(e.target.value) || 0)}
            className="w-full rounded border bg-transparent px-2 py-1.5 text-sm tabular-nums"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Fee base</label>
          <select
            value={feeBase}
            onChange={(e) =>
              setFeeBase(e.target.value as "grossRevenue" | "netRevenue" | "netOperatingProfit")
            }
            className="w-full rounded border bg-transparent px-2 py-1.5 text-sm"
          >
            <option value="grossRevenue">Gross revenue</option>
            <option value="netRevenue">Net revenue (gross − platform fees)</option>
            <option value="netOperatingProfit">Net operating profit (after costs)</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">
            Approval threshold ({currency})
          </label>
          <input
            type="number"
            min={0}
            value={approvalThreshold}
            onChange={(e) => setApprovalThreshold(parseFloat(e.target.value) || 0)}
            className="w-full rounded border bg-transparent px-2 py-1.5 text-sm tabular-nums"
          />
          <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
            Maintenance requests over this cost require owner approval.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">
            Auto-approve after (days, optional)
          </label>
          <input
            type="number"
            min={1}
            value={autoApprove}
            onChange={(e) => setAutoApprove(e.target.value)}
            placeholder="leave blank to disable"
            className="w-full rounded border bg-transparent px-2 py-1.5 text-sm tabular-nums"
          />
          <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
            If owner doesn&apos;t decide within N days, request auto-approves.
            Default OFF.
          </p>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded bg-red-50 p-2 text-xs text-red-900">{error}</p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-md border bg-transparent px-3 py-1.5 text-sm hover:bg-[var(--secondary)]"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={submitting}
          className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Save fee config"}
        </button>
      </div>
    </ModalShell>
  );
}

// ─── Shared modal shell ─────────────────────────────────────────────────────

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-y-auto rounded-2xl border bg-[var(--card)] p-5 shadow-xl"
        style={{ maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between border-b pb-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--secondary)]"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function fmtMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
