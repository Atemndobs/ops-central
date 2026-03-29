"use client";

import { useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { getErrorMessage } from "@/lib/errors";

const INCIDENT_TYPES = [
  "missing_item",
  "damaged_item",
  "maintenance_needed",
  "guest_issue",
  "suggestion",
  "other",
] as const;

const SEVERITIES = ["low", "medium", "high", "critical"] as const;

export function CleanerIncidentPageClient() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const jobs = useQuery(api.cleaningJobs.queries.getMyAssigned, isAuthenticated ? { limit: 200 } : "skip") as
    | Array<{
        _id: string;
        propertyId: string;
        property?: { name?: string | null } | null;
      }>
    | undefined;

  const createIncident = useMutation(api.incidents.mutations.createIncident);
  const generateUploadUrl = useMutation(api.files.mutations.generateUploadUrl);
  const uploadJobPhoto = useMutation(api.files.mutations.uploadJobPhoto);

  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [incidentType, setIncidentType] = useState<(typeof INCIDENT_TYPES)[number]>("other");
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>("medium");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [roomName, setRoomName] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedJob = useMemo(() => {
    return (jobs ?? []).find((job) => job._id === selectedJobId) ?? null;
  }, [jobs, selectedJobId]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--muted-foreground)]">
        Loading incident form...
      </div>
    );
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

  return (
    <form
      className="space-y-4 rounded-md border border-[var(--border)] bg-[var(--card)] p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        setSuccess(null);

        try {
          if (!selectedJob) {
            throw new Error("Select a job before reporting an incident.");
          }

          const photoIds = await uploadIncidentPhotos(selectedJob._id as Id<"cleaningJobs">);

          await createIncident({
            propertyId: selectedJob.propertyId as Id<"properties">,
            cleaningJobId: selectedJob._id as Id<"cleaningJobs">,
            incidentType,
            severity,
            title: title.trim() || undefined,
            description: description.trim() || undefined,
            roomName: roomName.trim() || undefined,
            photoIds,
          });

          setSuccess("Incident created.");
          setTitle("");
          setDescription("");
          setRoomName("");
          setFiles(null);
        } catch (submitError) {
          setError(getErrorMessage(submitError, "Unable to create incident."));
        } finally {
          setPending(false);
        }
      }}
    >
      <div>
        <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Job</label>
        <select
          value={selectedJobId}
          onChange={(event) => setSelectedJobId(event.target.value)}
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

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Type</label>
          <select
            value={incidentType}
            onChange={(event) => setIncidentType(event.target.value as (typeof INCIDENT_TYPES)[number])}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
          >
            {INCIDENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Severity</label>
          <select
            value={severity}
            onChange={(event) => setSeverity(event.target.value as (typeof SEVERITIES)[number])}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
          >
            {SEVERITIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Title</label>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
          placeholder="Broken lamp"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Room</label>
        <input
          value={roomName}
          onChange={(event) => setRoomName(event.target.value)}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
          placeholder="Bedroom"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Description</label>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
          placeholder="Add details"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Photos (optional)</label>
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
        disabled={pending || jobs === undefined}
        className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
      >
        {pending ? "Saving..." : "Create Incident"}
      </button>

      {error ? <p className="text-xs text-[var(--destructive)]">{error}</p> : null}
      {success ? <p className="text-xs text-emerald-300">{success}</p> : null}
    </form>
  );
}
