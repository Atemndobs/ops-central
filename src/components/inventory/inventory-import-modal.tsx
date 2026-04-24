"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import Papa from "papaparse";
import { AlertTriangle, CheckCircle2, Download, Loader2, Upload, X } from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";
import { getErrorMessage } from "@/lib/errors";

type CanonicalField =
  | "name"
  | "category"
  | "room"
  | "locationDetail"
  | "quantityPurchased"
  | "vendor"
  | "url"
  | "unitPrice"
  | "orderStatus"
  | "notes";

const CANONICAL_FIELDS: { key: CanonicalField; label: string; required: boolean }[] = [
  { key: "name", label: "Item Name", required: true },
  { key: "category", label: "Category", required: false },
  { key: "room", label: "Room", required: false },
  { key: "locationDetail", label: "Location Detail", required: false },
  { key: "quantityPurchased", label: "Quantity Purchased", required: true },
  { key: "vendor", label: "Vendor", required: false },
  { key: "url", label: "Product URL", required: false },
  { key: "unitPrice", label: "Unit Price", required: false },
  { key: "orderStatus", label: "Order Status", required: false },
  { key: "notes", label: "Notes", required: false },
];

const AUTO_MATCH_HINTS: Record<CanonicalField, string[]> = {
  name: ["item name", "item", "product", "name"],
  category: ["category", "inventory", "type"],
  room: ["room", "area"],
  locationDetail: ["location detail", "location - detail", "location", "detail"],
  quantityPurchased: ["quantity purchased", "quantity", "qty", "count"],
  vendor: ["vendor", "supplier", "store"],
  url: ["url", "link", "product url", "product link"],
  unitPrice: ["unit price", "sales_price", "sales price", "price"],
  orderStatus: ["order status", "status"],
  notes: ["notes", "note", "item", "comment"],
};

type ParsedRow = Record<string, string>;
type Step = "upload" | "map" | "preview" | "done";

type Mapping = Partial<Record<CanonicalField, string>>;

type PreviewItem =
  | { kind: "new" | "update"; name: string; category: string | null; room: string | null; quantityPurchased: number }
  | { kind: "skip" | "error"; name: string; reason: string };

type PreviewResult = {
  summary: { toInsert: number; toUpdate: number; skipped: number; errors: number };
  preview: PreviewItem[];
};

type CommitResult = {
  summary: { inserted: number; updated: number; skipped: number; errors: number };
  errors: Array<{ name: string; reason: string }>;
};

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function autoMap(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const normalizedHeaders = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) }));

  for (const { key } of CANONICAL_FIELDS) {
    const hints = AUTO_MATCH_HINTS[key];
    const found = normalizedHeaders.find((h) => hints.some((hint) => h.norm === hint))
      ?? normalizedHeaders.find((h) => hints.some((hint) => h.norm.includes(hint)));
    if (found) mapping[key] = found.raw;
  }

  return mapping;
}

function parsePrice(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!cleaned) return undefined;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function parseQuantity(raw: string | undefined): number {
  if (!raw) return 1;
  const cleaned = raw.replace(/[^0-9]/g, "");
  if (!cleaned) return 1;
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

function mapRows(
  rows: ParsedRow[],
  mapping: Mapping,
): Array<{
  name: string;
  category?: string;
  room?: string;
  locationDetail?: string;
  quantityPurchased: number;
  vendor?: string;
  url?: string;
  unitPrice?: number;
  orderStatus?: string;
  notes?: string;
}> {
  const get = (row: ParsedRow, field: CanonicalField) => {
    const col = mapping[field];
    if (!col) return undefined;
    const val = row[col];
    return typeof val === "string" ? val.trim() : undefined;
  };

  return rows
    .filter((row) => {
      const name = get(row, "name");
      return name && name.length > 0;
    })
    .map((row) => ({
      name: get(row, "name")!,
      category: get(row, "category") || undefined,
      room: get(row, "room") || undefined,
      locationDetail: get(row, "locationDetail") || undefined,
      quantityPurchased: parseQuantity(get(row, "quantityPurchased")),
      vendor: get(row, "vendor") || undefined,
      url: get(row, "url") || undefined,
      unitPrice: parsePrice(get(row, "unitPrice")),
      orderStatus: get(row, "orderStatus") || undefined,
      notes: get(row, "notes") || undefined,
    }));
}

export function InventoryImportModal({
  open,
  propertyId,
  propertyName,
  onClose,
}: {
  open: boolean;
  propertyId: Id<"properties">;
  propertyName: string;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [mode, setMode] = useState<"merge" | "replace" | "append">("merge");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const importItems = useMutation(api.inventory.import.importItems);
  const { showToast } = useToast();

  const reset = () => {
    setStep("upload");
    setFileName(null);
    setHeaders([]);
    setRows([]);
    setMapping({});
    setMode("merge");
    setPreview(null);
    setResult(null);
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFile = (file: File) => {
    setError(null);
    setFileName(file.name);
    Papa.parse<ParsedRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsedHeaders = results.meta.fields ?? [];
        const parsedRows = (results.data as ParsedRow[]).filter(
          (r) => Object.values(r).some((v) => typeof v === "string" && v.trim().length > 0),
        );
        setHeaders(parsedHeaders);
        setRows(parsedRows);
        setMapping(autoMap(parsedHeaders));
        setStep("map");
      },
      error: (err) => {
        setError(`Failed to parse CSV: ${err.message}`);
      },
    });
  };

  const missingRequired = useMemo(
    () => CANONICAL_FIELDS.filter((f) => f.required && !mapping[f.key]),
    [mapping],
  );

  const handlePreview = async () => {
    if (missingRequired.length > 0) {
      setError(
        `Missing required fields: ${missingRequired.map((f) => f.label).join(", ")}`,
      );
      return;
    }
    setError(null);
    setCommitting(true);
    try {
      const mapped = mapRows(rows, mapping);
      const res = (await importItems({
        propertyId,
        rows: mapped,
        mode,
        dryRun: true,
      })) as PreviewResult;
      setPreview(res);
      setStep("preview");
    } catch (err) {
      setError(getErrorMessage(err, "Failed to generate preview."));
    } finally {
      setCommitting(false);
    }
  };

  const handleCommit = async () => {
    setError(null);
    setCommitting(true);
    try {
      const mapped = mapRows(rows, mapping);
      const res = (await importItems({
        propertyId,
        rows: mapped,
        mode,
        dryRun: false,
      })) as CommitResult;
      setResult(res);
      setStep("done");
      showToast(
        `Imported ${res.summary.inserted} new, updated ${res.summary.updated}.`,
      );
    } catch (err) {
      setError(getErrorMessage(err, "Failed to import inventory."));
    } finally {
      setCommitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border bg-[var(--card)] shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-base font-bold">Import Inventory</h2>
            <p className="text-xs text-[var(--muted-foreground)]">{propertyName}</p>
          </div>
          <button
            onClick={handleClose}
            className="rounded-md p-1 hover:bg-[var(--accent)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b px-5 py-2 text-xs">
          {(["upload", "map", "preview", "done"] as const).map((s, idx) => (
            <div key={s} className="flex items-center gap-2">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                  step === s
                    ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                    : "bg-[var(--secondary)] text-[var(--muted-foreground)]"
                }`}
              >
                {idx + 1}
              </span>
              <span className="capitalize">{s}</span>
              {idx < 3 ? <span className="text-[var(--muted-foreground)]">›</span> : null}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <div className="mb-3 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {step === "upload" ? (
            <div className="space-y-4">
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file) handleFile(file);
                }}
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[var(--border)] px-6 py-10 text-center hover:bg-[var(--accent)]"
              >
                <Upload className="h-6 w-6 text-[var(--muted-foreground)]" />
                <p className="text-sm font-semibold">Drop a CSV file or click to upload</p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Any column layout works — map fields in the next step.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                  }}
                />
              </div>
              <a
                href="/inventory-template.csv"
                download
                className="inline-flex items-center gap-2 text-xs text-[var(--primary)] hover:underline"
              >
                <Download className="h-3.5 w-3.5" />
                Download blank template
              </a>
            </div>
          ) : null}

          {step === "map" ? (
            <div className="space-y-4">
              <p className="text-xs text-[var(--muted-foreground)]">
                Map your spreadsheet columns ({fileName}, {rows.length} rows) to inventory fields.
                Auto-matched where possible.
              </p>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--secondary)] text-left text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                    <tr>
                      <th className="px-3 py-2">Inventory Field</th>
                      <th className="px-3 py-2">Your Column</th>
                      <th className="px-3 py-2">Required</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CANONICAL_FIELDS.map((f) => (
                      <tr key={f.key} className="border-t">
                        <td className="px-3 py-2 font-medium">{f.label}</td>
                        <td className="px-3 py-2">
                          <select
                            className="w-full rounded border bg-[var(--background)] px-2 py-1 text-sm"
                            value={mapping[f.key] ?? ""}
                            onChange={(e) =>
                              setMapping((m) => ({
                                ...m,
                                [f.key]: e.target.value || undefined,
                              }))
                            }
                          >
                            <option value="">— none —</option>
                            {headers.map((h) => (
                              <option key={h} value={h}>
                                {h}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-xs text-[var(--muted-foreground)]">
                          {f.required ? "Yes" : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Import mode
                </p>
                <div className="flex gap-2">
                  {(["merge", "replace", "append"] as const).map((m) => (
                    <label
                      key={m}
                      className={`cursor-pointer rounded-md border px-3 py-2 text-sm ${
                        mode === m ? "border-[var(--primary)] bg-[var(--accent)]" : ""
                      }`}
                    >
                      <input
                        type="radio"
                        className="mr-2"
                        checked={mode === m}
                        onChange={() => setMode(m)}
                      />
                      <span className="capitalize font-semibold">{m}</span>
                      <span className="ml-1 text-xs text-[var(--muted-foreground)]">
                        {m === "merge"
                          ? "update matches, insert new"
                          : m === "replace"
                            ? "delete all then insert"
                            : "insert only, skip duplicates"}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {step === "preview" && preview ? (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-2 text-center">
                <StatCard label="New" value={preview.summary.toInsert} tone="success" />
                <StatCard label="Update" value={preview.summary.toUpdate} tone="info" />
                <StatCard label="Skip" value={preview.summary.skipped} tone="muted" />
                <StatCard label="Errors" value={preview.summary.errors} tone="danger" />
              </div>
              <div className="max-h-80 overflow-y-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[var(--secondary)] text-left text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                    <tr>
                      <th className="px-3 py-2">Action</th>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2">Category</th>
                      <th className="px-3 py-2">Room</th>
                      <th className="px-3 py-2">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview.map((p, i) => {
                      const badgeClass =
                        p.kind === "new"
                          ? "bg-emerald-100 text-emerald-700"
                          : p.kind === "update"
                            ? "bg-blue-100 text-blue-700"
                            : p.kind === "skip"
                              ? "bg-slate-100 text-slate-700"
                              : "bg-rose-100 text-rose-700";
                      const isWrite = p.kind === "new" || p.kind === "update";
                      return (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-2">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${badgeClass}`}
                            >
                              {p.kind}
                            </span>
                          </td>
                          <td className="px-3 py-2">{p.name}</td>
                          {isWrite ? (
                            <>
                              <td className="px-3 py-2 text-xs">
                                {(p as Extract<PreviewItem, { kind: "new" | "update" }>).category ?? "—"}
                              </td>
                              <td className="px-3 py-2 text-xs">
                                {(p as Extract<PreviewItem, { kind: "new" | "update" }>).room ?? "—"}
                              </td>
                              <td className="px-3 py-2 text-xs">
                                {(p as Extract<PreviewItem, { kind: "new" | "update" }>).quantityPurchased}
                              </td>
                            </>
                          ) : (
                            <td className="px-3 py-2 text-xs text-[var(--muted-foreground)]" colSpan={3}>
                              {(p as Extract<PreviewItem, { kind: "skip" | "error" }>).reason}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {step === "done" && result ? (
            <div className="space-y-4 py-4 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
              <h3 className="text-lg font-bold">Import complete</h3>
              <p className="text-sm text-[var(--muted-foreground)]">
                {result.summary.inserted} inserted, {result.summary.updated} updated,
                {" "}{result.summary.skipped} skipped, {result.summary.errors} errors.
              </p>
              {result.errors.length > 0 ? (
                <div className="mx-auto max-w-md rounded-md border border-rose-200 bg-rose-50 p-3 text-left text-xs text-rose-700">
                  <p className="font-bold">Errors:</p>
                  <ul className="mt-1 list-disc pl-4">
                    {result.errors.slice(0, 10).map((e, i) => (
                      <li key={i}>
                        <strong>{e.name}:</strong> {e.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t px-5 py-3">
          <button
            onClick={handleClose}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-[var(--accent)]"
          >
            {step === "done" ? "Close" : "Cancel"}
          </button>

          <div className="flex gap-2">
            {step === "map" ? (
              <button
                onClick={handlePreview}
                disabled={committing || missingRequired.length > 0}
                className="inline-flex items-center gap-2 rounded-md bg-[var(--primary)] px-3 py-1.5 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
              >
                {committing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Preview
              </button>
            ) : null}
            {step === "preview" ? (
              <>
                <button
                  onClick={() => setStep("map")}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-[var(--accent)]"
                >
                  Back
                </button>
                <button
                  onClick={handleCommit}
                  disabled={committing}
                  className="inline-flex items-center gap-2 rounded-md bg-[var(--primary)] px-3 py-1.5 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
                >
                  {committing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Import{" "}
                  {(preview?.summary.toInsert ?? 0) + (preview?.summary.toUpdate ?? 0)}
                  {" "}items
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "info" | "muted" | "danger";
}) {
  const tones = {
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    info: "bg-blue-50 text-blue-700 border-blue-200",
    muted: "bg-slate-50 text-slate-700 border-slate-200",
    danger: "bg-rose-50 text-rose-700 border-rose-200",
  };
  return (
    <div className={`rounded-md border px-3 py-2 ${tones[tone]}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}
