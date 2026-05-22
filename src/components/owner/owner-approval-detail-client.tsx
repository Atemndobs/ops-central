"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { fmtDate, fmtMoney } from "./owner-format";

export function OwnerApprovalDetailClient({
  propertyId,
  requestId,
}: {
  propertyId: Id<"properties">;
  requestId: Id<"maintenanceApprovalRequests">;
}) {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const req = useQuery(
    api.owner.queries.getMaintenanceApprovalRequest,
    isAuthenticated ? { requestId } : "skip",
  );
  const property = useQuery(
    api.owner.queries.getOwnerProperty,
    isAuthenticated ? { propertyId } : "skip",
  );
  const decide = useMutation(api.owner.mutations.decideMaintenanceApprovalRequest);

  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState<"approved" | "declined" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (isLoading || req === undefined || property === undefined) {
    return <div className="h-96 animate-pulse rounded-2xl bg-white" />;
  }

  const currency = property.property.currency ?? "USD";
  const isPending = req.status === "pending";

  async function handle(decision: "approved" | "declined") {
    if (!isPending) return;
    setSubmitting(decision);
    setError(null);
    try {
      await decide({ requestId, decision, note: note || undefined });
      router.push(`/owner/properties/${propertyId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href={`/owner/properties/${propertyId}`}
          className="inline-flex items-center gap-1 text-xs text-[#999] hover:text-[#1a1a1a]"
        >
          <ArrowLeft size={12} /> {property.property.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Maintenance approval
        </h1>
      </div>

      <section className="rounded-2xl border border-[#e8e6e0] bg-white p-6">
        <div className="mb-4 flex items-baseline justify-between">
          <div className="text-xs uppercase tracking-wide text-[#999]">
            Proposed cost
          </div>
          <div className="font-mono text-3xl font-bold tabular-nums text-[#1a237e]">
            {fmtMoney(req.proposedCost, currency)}
          </div>
        </div>
        <p className="whitespace-pre-wrap text-sm text-[#1a1a1a]">
          {req.description}
        </p>
        <p className="mt-4 text-xs text-[#999]">
          Submitted {fmtDate(req.createdAt)}
        </p>
      </section>

      {req.status !== "pending" && (
        <section
          className={`rounded-2xl p-5 ${
            req.status === "approved" || req.status === "auto_approved"
              ? "border border-emerald-200 bg-emerald-50"
              : "border border-red-200 bg-red-50"
          }`}
        >
          <div
            className={`flex items-center gap-2 font-medium ${
              req.status === "approved" || req.status === "auto_approved"
                ? "text-emerald-900"
                : "text-red-900"
            }`}
          >
            {req.status === "approved" || req.status === "auto_approved" ? (
              <CheckCircle2 size={18} />
            ) : (
              <XCircle size={18} />
            )}
            {req.status === "auto_approved"
              ? "Auto-approved (SLA elapsed)"
              : req.status === "approved"
                ? "Approved"
                : "Declined"}{" "}
            on {req.decidedAt ? fmtDate(req.decidedAt) : "—"}
          </div>
          {req.decidedNote && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-[#444]">
              {req.decidedNote}
            </p>
          )}
        </section>
      )}

      {isPending && property.ownership.isPrimaryApprover && (
        <section className="rounded-2xl border border-[#e8e6e0] bg-white p-6">
          <label className="mb-2 block text-sm font-medium">Note (optional)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add context for J&A Ops about your decision…"
            className="mb-4 w-full rounded-lg border border-[#e8e6e0] bg-[#fafaf7] p-3 text-sm focus:border-[#1a237e] focus:outline-none"
            rows={3}
            disabled={submitting !== null}
          />
          {error && (
            <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-900">{error}</p>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => handle("approved")}
              disabled={submitting !== null}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-3 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              <CheckCircle2 size={16} />
              {submitting === "approved" ? "Approving…" : "Approve"}
            </button>
            <button
              onClick={() => handle("declined")}
              disabled={submitting !== null}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border-2 border-red-300 bg-white px-4 py-3 text-sm font-medium text-red-900 hover:bg-red-50 disabled:opacity-60"
            >
              <XCircle size={16} />
              {submitting === "declined" ? "Declining…" : "Decline"}
            </button>
          </div>
          <p className="mt-3 text-xs text-[#999]">
            Approving books this as a maintenance cost on your next statement. Declining means it will not be booked.
          </p>
        </section>
      )}

      {isPending && !property.ownership.isPrimaryApprover && (
        <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
          This decision is reserved for the primary approver on this property.
        </p>
      )}
    </div>
  );
}
