"use client";

import { useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { getErrorMessage } from "@/lib/errors";
import { formatLabel } from "@/lib/format";
import { buildRoomOptions } from "@/lib/rooms";

const INCIDENT_TYPES = [
  "missing_item",
  "damaged_item",
  "maintenance_needed",
  "guest_issue",
  "suggestion",
  "other",
] as const;

const SEVERITIES = ["low", "medium", "high", "critical"] as const;

const INCIDENT_CONTEXTS = [
  { value: "routine_check", label: "Routine Check" },
  { value: "maintenance", label: "Maintenance" },
  { value: "audit", label: "Audit" },
  { value: "other", label: "Other" },
] as const;

type IncidentContext = (typeof INCIDENT_CONTEXTS)[number]["value"];

type AssignedJob = {
  _id: Id<"cleaningJobs">;
  propertyId: Id<"properties">;
  property?: {
    name?: string | null;
  } | null;
};

type PropertyListItem = {
  _id: Id<"properties">;
  name: string;
  address?: string;
  bedrooms?: number | null;
  bathrooms?: number | null;
};

type InventoryItem = {
  _id: Id<"inventoryItems">;
  name: string;
  room?: string | null;
  quantityCurrent: number;
  status: "ok" | "low_stock" | "out_of_stock" | "reorder_pending";
};

type ReportMode = "job" | "standalone";

export function CleanerIncidentPageClient() {
  const { isAuthenticated, isLoading } = useConvexAuth();

  // --- mode selection ---
  const [reportMode, setReportMode] = useState<ReportMode>("job");

  // --- job-linked state ---
  const jobs = useQuery(
    api.cleaningJobs.queries.getMyAssigned,
    isAuthenticated ? { limit: 200 } : "skip",
  ) as AssignedJob[] | undefined;
  const [selectedJobId, setSelectedJobId] = useState<string>("");

  // --- standalone state ---
  const allProperties = useQuery(
    api.properties.queries.getAll,
    isAuthenticated && reportMode === "standalone" ? { limit: 500 } : "skip",
  ) as PropertyListItem[] | undefined;
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>("");
  const [incidentContext, setIncidentContext] = useState<IncidentContext>("routine_check");

  // --- mutations ---
  const createIncident = useMutation(api.incidents.mutations.createIncident);
  const generateUploadUrl = useMutation(api.files.mutations.generateUploadUrl);
  const uploadJobPhoto = useMutation(api.files.mutations.uploadJobPhoto);

  // --- shared form state ---
  const [incidentType, setIncidentType] = useState<(typeof INCIDENT_TYPES)[number]>("missing_item");
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>("medium");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [roomName, setRoomName] = useState("");
  const [inventorySearch, setInventorySearch] = useState("");
  const [selectedInventoryItemId, setSelectedInventoryItemId] = useState<string>("");
  const [useCustomItem, setUseCustomItem] = useState(false);
  const [customItemDescription, setCustomItemDescription] = useState("");
  const [quantityMissing, setQuantityMissing] = useState("1");
  const [files, setFiles] = useState<FileList | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // --- derived values ---
  const selectedJob = useMemo(
    () => (jobs ?? []).find((job) => job._id === selectedJobId) ?? null,
    [jobs, selectedJobId],
  );

  const resolvedPropertyId: Id<"properties"> | null = useMemo(() => {
    if (reportMode === "job") {
      return (selectedJob?.propertyId as Id<"properties">) ?? null;
    }
    return selectedPropertyId ? (selectedPropertyId as Id<"properties">) : null;
  }, [reportMode, selectedJob, selectedPropertyId]);

  const property = useQuery(
    api.properties.queries.getById,
    resolvedPropertyId ? { id: resolvedPropertyId } : "skip",
  ) as PropertyListItem | null | undefined;

  const inventoryItems = useQuery(
    api.inventory.queries.getAll,
    resolvedPropertyId ? { propertyId: resolvedPropertyId } : "skip",
  ) as InventoryItem[] | undefined;

  const roomOptions = useMemo(
    () => buildRoomOptions(property ?? null, inventoryItems ?? []),
    [property, inventoryItems],
  );

  const filteredInventoryItems = useMemo(() => {
    const query = inventorySearch.trim().toLowerCase();
    const roomFilter = roomName.trim().toLowerCase();
    const allItems = inventoryItems ?? [];

    return allItems
      .filter((item) => {
        if (roomFilter && item.room?.trim().toLowerCase() !== roomFilter) {
          return false;
        }
        if (!query) {
          return true;
        }
        return item.name.toLowerCase().includes(query);
      })
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, 12);
  }, [inventoryItems, inventorySearch, roomName]);

  const selectedInventoryItem = useMemo(
    () => (inventoryItems ?? []).find((item) => item._id === selectedInventoryItemId) ?? null,
    [inventoryItems, selectedInventoryItemId],
  );

  // --- helpers ---
  function resetFormFields() {
    setRoomName("");
    setInventorySearch("");
    setSelectedInventoryItemId("");
    setUseCustomItem(false);
    setCustomItemDescription("");
    setQuantityMissing("1");
  }

  function resetAll() {
    setTitle("");
    setDescription("");
    setFiles(null);
    resetFormFields();
  }

  async function uploadIncidentPhotos(jobId: Id<"cleaningJobs">): Promise<Id<"photos">[]> {
    if (!files || files.length === 0) {
      return [];
    }

    const uploadedPhotoIds: Id<"photos">[] = [];
    for (const file of Array.from(files)) {
      const uploadUrl = await generateUploadUrl({});
      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Photo upload failed (${uploadResponse.status}).`);
      }

      const payload = (await uploadResponse.json()) as { storageId?: Id<"_storage"> };
      if (!payload.storageId) {
        throw new Error("Upload response missing storageId.");
      }

      const photoId = await uploadJobPhoto({
        storageId: payload.storageId,
        jobId,
        roomName: roomName.trim() || "Incident",
        photoType: "incident",
        source: "app",
        notes: title.trim() || description.trim() || undefined,
      });

      uploadedPhotoIds.push(photoId);
    }

    return uploadedPhotoIds;
  }

  async function uploadStandalonePhotos(): Promise<string[]> {
    if (!files || files.length === 0) {
      return [];
    }

    const storageIds: string[] = [];
    for (const file of Array.from(files)) {
      const uploadUrl = await generateUploadUrl({});
      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Photo upload failed (${uploadResponse.status}).`);
      }

      const payload = (await uploadResponse.json()) as { storageId?: string };
      if (!payload.storageId) {
        throw new Error("Upload response missing storageId.");
      }

      storageIds.push(payload.storageId);
    }

    return storageIds;
  }

  if (isLoading || !isAuthenticated) {
    return (
      <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--muted-foreground)]">
        Loading incident form...
      </div>
    );
  }

  return (
    <form
      className="space-y-4 rounded-md border border-[var(--border)] bg-[var(--card)] p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        setSuccess(null);

        try {
          if (!resolvedPropertyId) {
            throw new Error(
              reportMode === "job"
                ? "Select a job before reporting an incident."
                : "Select a property before reporting an incident.",
            );
          }
          if (!roomName.trim()) {
            throw new Error("Select a room before saving the incident.");
          }

          const isMissingItem = incidentType === "missing_item";
          const isDamagedItem = incidentType === "damaged_item";
          if (isMissingItem && !useCustomItem && !selectedInventoryItem) {
            throw new Error("For missing item incidents, choose an inventory item or switch to custom item.");
          }
          if (isMissingItem && useCustomItem && !customItemDescription.trim()) {
            throw new Error("Describe the missing item when using custom item mode.");
          }
          if (isDamagedItem && (!files || files.length === 0)) {
            throw new Error("Damage incidents require at least one photo.");
          }

          let photoIds: Id<"photos">[] = [];
          let photoStorageIds: string[] = [];

          if (reportMode === "job" && selectedJob) {
            photoIds = await uploadIncidentPhotos(selectedJob._id as Id<"cleaningJobs">);
          } else {
            photoStorageIds = await uploadStandalonePhotos();
          }

          await createIncident({
            propertyId: resolvedPropertyId,
            cleaningJobId:
              reportMode === "job" && selectedJob
                ? (selectedJob._id as Id<"cleaningJobs">)
                : undefined,
            incidentType,
            severity,
            title: title.trim() || undefined,
            description: description.trim() || undefined,
            roomName: roomName.trim(),
            inventoryItemId:
              isMissingItem && !useCustomItem
                ? (selectedInventoryItem?._id as Id<"inventoryItems"> | undefined)
                : undefined,
            quantityMissing: isMissingItem
              ? Math.max(1, Number.parseInt(quantityMissing, 10) || 1)
              : undefined,
            customItemDescription:
              isMissingItem && useCustomItem
                ? customItemDescription.trim() || undefined
                : undefined,
            incidentContext: reportMode === "job" ? "in_job" : incidentContext,
            photoIds,
            ...(photoStorageIds.length > 0
              ? { photoStorageIds: photoStorageIds as Id<"_storage">[] }
              : {}),
          });

          setSuccess("Incident created.");
          resetAll();
        } catch (submitError) {
          setError(getErrorMessage(submitError, "Unable to create incident."));
        } finally {
          setPending(false);
        }
      }}
    >
      {/* Mode selector */}
      <div>
        <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Report Mode</label>
        <div className="grid grid-cols-2 gap-2">
          {(["job", "standalone"] as const).map((mode) => {
            const active = reportMode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setReportMode(mode);
                  setSelectedJobId("");
                  setSelectedPropertyId("");
                  resetFormFields();
                }}
                className={`rounded-md border px-3 py-2 text-sm ${
                  active
                    ? "border-[var(--primary)] bg-[var(--accent)] text-[var(--foreground)]"
                    : "border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)]"
                }`}
              >
                {mode === "job" ? "Linked to Job" : "Standalone Report"}
              </button>
            );
          })}
        </div>
      </div>

      {/* Job selector (job mode) */}
      {reportMode === "job" ? (
        <div>
          <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Job</label>
          <select
            value={selectedJobId}
            onChange={(event) => {
              setSelectedJobId(event.target.value);
              resetFormFields();
            }}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
          >
            <option value="">Select a job</option>
            {(jobs ?? []).map((job) => (
              <option key={job._id} value={job._id}>
                {job.property?.name ?? "Unknown property"} ({job._id.slice(-6)})
              </option>
            ))}
          </select>
        </div>
      ) : (
        /* Property selector (standalone mode) */
        <div>
          <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Property</label>
          <select
            value={selectedPropertyId}
            onChange={(event) => {
              setSelectedPropertyId(event.target.value);
              resetFormFields();
            }}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
          >
            <option value="">Select a property</option>
            {(allProperties ?? []).map((prop) => (
              <option key={prop._id} value={prop._id}>
                {prop.name}{prop.address ? ` — ${prop.address}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Incident type */}
      <div>
        <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Type</label>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {INCIDENT_TYPES.map((type) => {
            const active = incidentType === type;
            return (
              <button
                key={type}
                type="button"
                onClick={() => {
                  setIncidentType(type);
                  setSelectedInventoryItemId("");
                  setUseCustomItem(false);
                  setCustomItemDescription("");
                  setQuantityMissing("1");
                }}
                className={`rounded-md border px-3 py-2 text-sm text-left ${
                  active
                    ? "border-[var(--primary)] bg-[var(--accent)] text-[var(--foreground)]"
                    : "border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)]"
                }`}
              >
                {formatLabel(type)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Severity + Context row */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Severity</label>
          <select
            value={severity}
            onChange={(event) => setSeverity(event.target.value as (typeof SEVERITIES)[number])}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
          >
            {SEVERITIES.map((value) => (
              <option key={value} value={value}>
                {formatLabel(value)}
              </option>
            ))}
          </select>
        </div>

        {/* Context selector (standalone only) */}
        {reportMode === "standalone" ? (
          <div>
            <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Context</label>
            <select
              value={incidentContext}
              onChange={(event) => setIncidentContext(event.target.value as IncidentContext)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            >
              {INCIDENT_CONTEXTS.map((ctx) => (
                <option key={ctx.value} value={ctx.value}>
                  {ctx.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {/* Room */}
      <div>
        <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Room</label>
        <select
          value={roomName}
          onChange={(event) => {
            setRoomName(event.target.value);
            setSelectedInventoryItemId("");
          }}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
        >
          <option value="">Select room</option>
          {roomOptions.map((room) => (
            <option key={room} value={room}>
              {room}
            </option>
          ))}
        </select>
      </div>

      {/* Missing item details */}
      {incidentType === "missing_item" ? (
        <section className="space-y-3 rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
          <p className="text-xs font-semibold text-[var(--muted-foreground)]">Missing Item Details</p>

          {!useCustomItem ? (
            <>
              <input
                value={inventorySearch}
                onChange={(event) => setInventorySearch(event.target.value)}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                placeholder="Search inventory item"
                disabled={!resolvedPropertyId}
              />
              {selectedInventoryItem ? (
                <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-3 text-sm">
                  <p className="font-semibold">{selectedInventoryItem.name}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {selectedInventoryItem.room ?? "No room"} · Stock {selectedInventoryItem.quantityCurrent}
                  </p>
                  <button
                    type="button"
                    className="mt-2 text-xs text-[var(--destructive)]"
                    onClick={() => setSelectedInventoryItemId("")}
                  >
                    Remove selected item
                  </button>
                </div>
              ) : (
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--card)] p-2">
                  {filteredInventoryItems.length > 0 ? (
                    filteredInventoryItems.map((item) => (
                      <button
                        key={item._id}
                        type="button"
                        onClick={() => {
                          setSelectedInventoryItemId(item._id);
                          if (item.room) {
                            setRoomName(item.room);
                          }
                        }}
                        className="w-full rounded-md border border-transparent px-2 py-2 text-left text-sm hover:border-[var(--border)] hover:bg-[var(--background)]"
                      >
                        <p className="font-medium">{item.name}</p>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {item.room ?? "No room"} · Stock {item.quantityCurrent}
                        </p>
                      </button>
                    ))
                  ) : (
                    <p className="px-2 py-3 text-xs text-[var(--muted-foreground)]">
                      No matching inventory items.
                    </p>
                  )}
                </div>
              )}
              <button
                type="button"
                className="text-xs text-[var(--muted-foreground)] underline underline-offset-2"
                onClick={() => {
                  setUseCustomItem(true);
                  setSelectedInventoryItemId("");
                }}
              >
                Item not in list? Enter custom item
              </button>
            </>
          ) : (
            <>
              <textarea
                value={customItemDescription}
                onChange={(event) => setCustomItemDescription(event.target.value)}
                rows={2}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                placeholder="Describe missing item"
              />
              <button
                type="button"
                className="text-xs text-[var(--muted-foreground)] underline underline-offset-2"
                onClick={() => {
                  setUseCustomItem(false);
                  setCustomItemDescription("");
                }}
              >
                Back to inventory search
              </button>
            </>
          )}

          <div>
            <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Quantity missing</label>
            <input
              type="number"
              min={1}
              value={quantityMissing}
              onChange={(event) => setQuantityMissing(event.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
            />
          </div>
        </section>
      ) : null}

      {/* Title + description */}
      <div>
        <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Title (optional)</label>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
          placeholder="Broken lamp"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Additional notes</label>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
          placeholder="Add details"
        />
      </div>

      {/* Photos */}
      <div>
        <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
          Photos {incidentType === "damaged_item" ? "(required for damage)" : "(optional)"}
        </label>
        <input
          type="file"
          multiple
          accept="image/*"
          onChange={(event) => setFiles(event.target.files)}
          className="w-full text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={pending || (reportMode === "job" && jobs === undefined)}
        className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
      >
        {pending ? "Saving..." : "Save Issue"}
      </button>

      {error ? <p className="text-xs text-[var(--destructive)]">{error}</p> : null}
      {success ? <p className="text-xs text-emerald-300">{success}</p> : null}
    </form>
  );
}
