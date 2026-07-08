"use client";

import { useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { CalendarX, Plus } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { fmtDate } from "./owner-format";

/**
 * Owner date-blocks — cross-property view of all dates the owner has
 * blocked for personal use. Mutation re-checks stay overlap inside the
 * transaction (TOCTOU-safe per spec §7.2). v1 form-only — no calendar UI.
 */
export function OwnerBlocksClient() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const properties = useQuery(
    api.owner.queries.listOwnedProperties,
    isAuthenticated ? {} : "skip",
  );

  if (isLoading || properties === undefined) {
    return <div className="h-96 animate-pulse rounded-2xl bg-[var(--cleaner-surface)]" />;
  }

  return (
    <div className="space-y-6">
      <div>
        {/* Inline back link removed — OwnerShell renders the universal
            back button above the page chrome. */}
        <h1
          className="text-3xl tracking-tight"
          style={{ fontFamily: "var(--font-cleaner-display)", fontWeight: 700 }}
        >
          Date blocks
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--cleaner-muted)" }}>
          Reserve dates for personal use at one of your properties. We&apos;ll
          reject overlap with existing stays automatically.
        </p>
      </div>

      <div className="space-y-8">
        {properties.map((p) => (
          <PropertyBlocks key={p._id} property={p} />
        ))}
      </div>
    </div>
  );
}

function PropertyBlocks({
  property,
}: {
  property: {
    _id: Id<"properties">;
    name: string;
    city: string | null;
  };
}) {
  const blocks = useQuery(api.owner.queries.listOwnerDateBlocks, {
    propertyId: property._id,
  });
  const createBlock = useMutation(api.owner.mutations.createOwnerDateBlock);
  const [showForm, setShowForm] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedBlocks = useMemo(
    () => [...(blocks ?? [])].sort((a, b) => a.startDate - b.startDate),
    [blocks],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!start || !end) {
      setError("Both dates are required");
      return;
    }
    const startMs = new Date(start + "T00:00:00Z").getTime();
    const endMs = new Date(end + "T00:00:00Z").getTime();
    if (endMs <= startMs) {
      setError("End date must be after start date");
      return;
    }
    setSubmitting(true);
    try {
      await createBlock({
        propertyId: property._id,
        startDate: startMs,
        endDate: endMs,
        note: note || undefined,
      });
      setStart("");
      setEnd("");
      setNote("");
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      className="rounded-2xl border border-black/[0.06] p-6"
      style={{ background: "var(--cleaner-surface)" }}
    >
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h2
            className="text-lg"
            style={{ fontFamily: "var(--font-cleaner-display)", fontWeight: 700 }}
          >
            {property.name}
          </h2>
          {property.city && (
            <p className="text-xs" style={{ color: "var(--cleaner-muted)" }}>
              {property.city}
            </p>
          )}
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-white"
          style={{ background: "var(--cleaner-primary)" }}
        >
          <Plus size={12} /> {showForm ? "Cancel" : "New block"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={submit}
          className="mb-5 rounded-xl border border-black/[0.06] p-4"
          style={{ background: "var(--cleaner-bg)" }}
        >
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs">
              <span className="mb-1 block" style={{ color: "var(--cleaner-muted)" }}>
                Start (inclusive)
              </span>
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                required
                className="w-full rounded-md border border-black/[0.06] bg-[var(--cleaner-surface)] px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block" style={{ color: "var(--cleaner-muted)" }}>
                End (exclusive)
              </span>
              <input
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                required
                className="w-full rounded-md border border-black/[0.06] bg-[var(--cleaner-surface)] px-2 py-1.5 text-sm"
              />
            </label>
          </div>
          <label className="mt-3 block text-xs">
            <span className="mb-1 block" style={{ color: "var(--cleaner-muted)" }}>
              Note (optional)
            </span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Family visit, repairs, etc."
              className="w-full rounded-md border border-black/[0.06] bg-[var(--cleaner-surface)] px-2 py-1.5 text-sm"
            />
          </label>
          {error && (
            <p className="mt-3 rounded-md bg-red-50 p-2 text-xs text-red-900">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="mt-3 inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
            style={{ background: "var(--cleaner-primary)" }}
          >
            {submitting ? "Saving…" : "Block these dates"}
          </button>
        </form>
      )}

      {sortedBlocks.length === 0 ? (
        <div
          className="rounded-xl border border-dashed border-black/[0.06] p-6 text-center text-sm"
          style={{ color: "var(--cleaner-muted)" }}
        >
          <CalendarX size={20} className="mx-auto mb-2 opacity-50" />
          No blocked dates.
        </div>
      ) : (
        <ul className="space-y-2">
          {sortedBlocks.map((b) => (
            <li
              key={b._id}
              className="flex items-center justify-between rounded-lg border border-black/[0.06] px-3 py-2 text-sm"
            >
              <div>
                <span className="font-medium">
                  {fmtDate(b.startDate)} – {fmtDate(b.endDate - 1)}
                </span>
                {b.note && (
                  <span
                    className="ml-2 text-xs"
                    style={{ color: "var(--cleaner-muted)" }}
                  >
                    · {b.note}
                  </span>
                )}
              </div>
              {b.syncedToChannelsAt ? (
                <span className="text-[10px]" style={{ color: "var(--cleaner-muted)" }}>
                  synced to channels
                </span>
              ) : (
                <span className="text-[10px]" style={{ color: "var(--cleaner-muted)" }}>
                  ops will sync to Airbnb/VRBO
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
