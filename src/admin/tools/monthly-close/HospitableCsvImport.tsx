"use client";

import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Upload, FileText, Check, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";
import { Button, Select } from "./ui";
import {
  parseHospitableCSV,
  type HospitableMonthlyData,
} from "./lib/hospitableParser";

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Naive name match: prefer exact (case-insensitive), else substring either way. */
function suggestMatch(
  externalName: string,
  props: Array<{ _id: string; name: string }>,
): string | null {
  const lc = externalName.trim().toLowerCase();
  const exact = props.find((p) => p.name.trim().toLowerCase() === lc);
  if (exact) return exact._id;
  const partial = props.find(
    (p) => p.name.toLowerCase().includes(lc) || lc.includes(p.name.toLowerCase()),
  );
  return partial?._id ?? null;
}

export function HospitableCsvImport({
  onImportComplete,
  onClose,
}: {
  onImportComplete: () => void;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const properties = useQuery(api.strCosts.queries.getProperties, {});
  const saveItems = useMutation(api.strCosts.mutations.saveHospitableImportItems);

  const [parsed, setParsed] = useState<HospitableMonthlyData[] | null>(null);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const availableProps = useMemo(
    () => (properties ?? []).map((p) => ({ _id: p._id as string, name: p.name })),
    [properties],
  );

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".csv")) {
        showToast("Please upload a .csv file.", "error");
        return;
      }
      const text = await file.text();
      const result = parseHospitableCSV(text);
      if (!result.success || result.data.length === 0) {
        showToast(result.errors[0] ?? "Could not parse CSV.", "error");
        return;
      }
      setParsed(result.data);
      // Seed mappings with naive name suggestions
      const seeded: Record<string, string> = {};
      for (const row of result.data) {
        if (seeded[row.externalPropertyId] !== undefined) continue;
        seeded[row.externalPropertyId] = suggestMatch(row.propertyName, availableProps) ?? "";
      }
      setMappings(seeded);
      showToast(
        `Found ${result.summary.totalReservations} reservations across ${result.summary.propertiesFound} properties.`,
        "success",
      );
    },
    [availableProps, showToast],
  );

  async function handleSave() {
    if (!parsed) return;
    const items = parsed
      .map((d) => ({
        externalPropertyId: d.externalPropertyId,
        internalPropertyId: mappings[d.externalPropertyId] || "",
        month: d.month,
        year: d.year,
        totalRevenue: d.totalRevenue,
        bookedNights: d.bookedNights,
        reservationCount: d.reservationCount,
      }))
      .filter((i) => i.internalPropertyId);

    if (items.length === 0) {
      showToast("Map at least one property before saving.", "error");
      return;
    }

    setIsSaving(true);
    try {
      const res = await saveItems({ items });
      if (!res.success) {
        showToast(res.errors?.join("; ") ?? "Save failed.", "error");
        return;
      }
      showToast(`Saved ${res.savedCount} entries. ${res.skippedCount} skipped.`, "success");
      onImportComplete();
    } catch (err) {
      showToast(`Save failed: ${String(err)}`, "error");
    } finally {
      setIsSaving(false);
    }
  }

  // Group parsed rows by external property for the mapping UI
  const grouped = useMemo(() => {
    const acc: Record<string, { name: string; months: HospitableMonthlyData[] }> = {};
    for (const row of parsed ?? []) {
      if (!acc[row.externalPropertyId]) acc[row.externalPropertyId] = { name: row.propertyName, months: [] };
      acc[row.externalPropertyId].months.push(row);
    }
    return acc;
  }, [parsed]);

  const mappedCount = Object.values(mappings).filter(Boolean).length;
  const totalExternal = Object.keys(grouped).length;

  return (
    <div className="flex max-h-[80vh] flex-col">
      <div className="mb-3 flex items-center gap-2">
        <Upload className="h-5 w-5 text-primary" />
        <div>
          <h2 className="text-base font-semibold text-foreground">Import from Hospitable</h2>
          <p className="text-sm text-muted-foreground">
            Upload your Hospitable reservations export CSV to import revenue and booking data.
          </p>
        </div>
      </div>

      {!parsed ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            const f = e.dataTransfer.files[0];
            if (f) void handleFile(f);
          }}
          className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
            isDragOver ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/50"
          }`}
        >
          <input
            type="file"
            accept=".csv"
            id="mc-csv-upload"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
          <label htmlFor="mc-csv-upload" className="flex cursor-pointer flex-col items-center gap-2">
            <FileText className="h-10 w-10 text-muted-foreground" />
            <span className="text-muted-foreground">
              Drag &amp; drop your Hospitable CSV here, or{" "}
              <span className="text-primary underline">browse</span>
            </span>
            <span className="text-xs text-muted-foreground">Hospitable → Reservations → Export</span>
          </label>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-4 overflow-hidden">
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="bg-muted/40 px-4 py-2 text-sm font-medium">
              Property mapping ({mappedCount}/{totalExternal} mapped)
            </div>
            <div className="max-h-80 divide-y divide-border overflow-y-auto">
              {Object.entries(grouped).map(([externalId, data]) => (
                <div key={externalId} className="flex items-start justify-between gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{data.name}</div>
                    <div className="text-xs text-muted-foreground">ID: {externalId}</div>
                    <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                      {data.months.map((m) => (
                        <span key={`${m.month}-${m.year}`}>
                          {MONTH_NAMES[m.month]} {m.year}: {currency.format(m.totalRevenue)} | {m.bookedNights} nights |{" "}
                          {m.reservationCount} res.
                        </span>
                      ))}
                    </div>
                  </div>
                  <Select
                    value={mappings[externalId] ?? ""}
                    onChange={(e) => setMappings((prev) => ({ ...prev, [externalId]: e.target.value }))}
                    className="w-52 shrink-0"
                  >
                    <option value="">— Select property —</option>
                    {availableProps.map((p) => (
                      <option key={p._id} value={p._id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => setParsed(null)}>
              Upload different file
            </Button>
            <Button disabled={isSaving || mappedCount === 0} onClick={() => void handleSave()}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save import ({mappedCount})
            </Button>
          </div>
        </div>
      )}

      {!parsed && (
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
