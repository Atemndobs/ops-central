"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { Loader2, Plus, Search } from "lucide-react";
import {
  JOB_STATUSES,
  STATUS_CLASSNAMES,
  STATUS_LABELS,
  type JobStatus,
} from "@/components/jobs/job-status";
import { CreateJobModal } from "@/components/jobs/create-job-modal";

type JobWithRelations = {
  _id: string;
  notesForCleaner?: string;
  status: JobStatus;
  scheduledStartAt?: number;
  scheduledEndAt?: number;
  propertyId: string;
  assignedCleanerIds?: string[];
  property?: { _id: string; name?: string | null } | null;
  cleaners?: Array<{ _id: string; name?: string | null }>;
};

type Option = {
  id: string;
  name: string;
};

const workflowStatuses: JobStatus[] = [
  "scheduled",
  "assigned",
  "in_progress",
  "completed",
];

const queryRef = <TArgs extends Record<string, unknown>, TReturn>(name: string) =>
  name as unknown as FunctionReference<"query", "public", TArgs, TReturn>;

export function JobsPageClient() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<JobStatus | "all">("all");
  const [propertyId, setPropertyId] = useState("all");
  const [cleanerId, setCleanerId] = useState("all");
  const [selectedDate, setSelectedDate] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);

  const jobs = useQuery(
    queryRef<
      {
        status?: JobStatus;
        propertyId?: string;
        limit?: number;
      },
      JobWithRelations[]
    >("cleaningJobs/queries:getAll"),
    {
      status: status === "all" ? undefined : status,
      propertyId: propertyId === "all" ? undefined : propertyId,
      limit: 1000,
    },
  );

  const allJobs = useQuery(
    queryRef<{ limit?: number }, JobWithRelations[]>("cleaningJobs/queries:getAll"),
    { limit: 1000 },
  );

  const cleanerOptionsFromUsers = useQuery(
    queryRef<{ role: "cleaner" }, Array<{ _id: string; name?: string | null }>>(
      "users/queries:getByRole",
    ),
    { role: "cleaner" },
  );

  const propertiesForCreate = useQuery(
    queryRef<{ limit?: number }, Array<{ _id: string; name: string }>>(
      "properties/queries:getAll",
    ),
    { limit: 500 },
  );

  const propertyOptionsFromJobs = useMemo(() => {
    const optionMap = new Map<string, string>();
    (allJobs ?? []).forEach((job) => {
      const name = job.property?.name || `Property ${job.propertyId.slice(-6)}`;
      optionMap.set(job.propertyId, name);
    });
    return Array.from(optionMap.entries()).map(([id, name]) => ({ id, name }));
  }, [allJobs]);

  const propertyOptions = useMemo(() => {
    const map = new Map<string, string>();
    (propertiesForCreate ?? []).forEach((property) => {
      map.set(property._id, property.name);
    });
    propertyOptionsFromJobs.forEach((property) => {
      map.set(property.id, property.name);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [propertiesForCreate, propertyOptionsFromJobs]);

  const cleanerOptionsFromJobs = useMemo(() => {
    const optionMap = new Map<string, string>();
    (allJobs ?? []).forEach((job) => {
      const cleaner = job.cleaners?.[0];
      if (!cleaner?._id) {
        return;
      }
      const name = cleaner.name || `Cleaner ${cleaner._id.slice(-6)}`;
      optionMap.set(cleaner._id, name);
    });
    return Array.from(optionMap.entries()).map(([id, name]) => ({ id, name }));
  }, [allJobs]);

  const cleanerOptions = useMemo(() => {
    const map = new Map<string, string>();
    (cleanerOptionsFromUsers ?? []).forEach((cleaner) => {
      map.set(cleaner._id, cleaner.name?.trim() || `Cleaner ${cleaner._id.slice(-6)}`);
    });
    cleanerOptionsFromJobs.forEach((cleaner) => {
      map.set(cleaner.id, cleaner.name);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [cleanerOptionsFromJobs, cleanerOptionsFromUsers]);

  const counts = useMemo(() => {
    const all = allJobs ?? [];
    const values: Record<string, number> = { all: all.length };
    JOB_STATUSES.forEach((itemStatus) => {
      values[itemStatus] = all.filter((job) => job.status === itemStatus).length;
    });
    return values;
  }, [allJobs]);

  const isLoading = jobs === undefined || allJobs === undefined;

  const jobRows = useMemo(() => {
    let list = jobs ?? [];
    const searchValue = search.trim().toLowerCase();

    if (searchValue) {
      list = list.filter((job) => {
        const inId = job._id.toLowerCase().includes(searchValue);
        const inProperty = (job.property?.name ?? "").toLowerCase().includes(searchValue);
        const inCleaner = (job.cleaners?.[0]?.name ?? "").toLowerCase().includes(searchValue);
        const inNotes = (job.notesForCleaner ?? "").toLowerCase().includes(searchValue);
        return inId || inProperty || inCleaner || inNotes;
      });
    }

    if (cleanerId !== "all") {
      list = list.filter((job) => (job.assignedCleanerIds ?? []).includes(cleanerId));
    }

    if (!selectedDate) {
      return list;
    }

    const start = new Date(selectedDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    return list.filter((job) => {
      const when = job.scheduledStartAt ?? 0;
      return when >= start.getTime() && when < end.getTime();
    });
  }, [jobs, selectedDate, search, cleanerId]);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-display">Jobs</h1>
          <p className="mt-2 text-[var(--muted-foreground)]">
            Manage active and upcoming cleaning jobs.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-none border bg-[var(--card)] px-3 py-1.5">
            <Search className="h-4 w-4 text-[var(--muted-foreground)]" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by job, property, cleaner"
              className="w-56 bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
            />
          </div>

          <select
            value={propertyId}
            onChange={(event) => setPropertyId(event.target.value)}
            className="rounded-none border bg-[var(--card)] px-3 py-1.5 text-sm"
          >
            <option value="all">All Properties</option>
            {propertyOptions.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
              </option>
            ))}
          </select>

          <select
            value={cleanerId}
            onChange={(event) => setCleanerId(event.target.value)}
            className="rounded-none border bg-[var(--card)] px-3 py-1.5 text-sm"
          >
            <option value="all">All Cleaners</option>
            {cleanerOptions.map((cleaner) => (
              <option key={cleaner.id} value={cleaner.id}>
                {cleaner.name}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            className="rounded-none border bg-[var(--card)] px-3 py-1.5 text-sm"
            aria-label="Filter by date"
          />
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 rounded-none bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          New Job
        </button>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b">
        {["all", ...JOB_STATUSES].map((itemStatus) => {
          const typedStatus = itemStatus as JobStatus | "all";
          const active = status === typedStatus;
          return (
            <button
              key={itemStatus}
              onClick={() => setStatus(typedStatus)}
              className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm ${
                active
                  ? "border-[var(--primary)] text-[var(--foreground)] font-bold"
                  : "border-transparent text-[var(--muted-foreground)]"
              }`}
            >
              {itemStatus === "all" ? "All" : STATUS_LABELS[itemStatus as JobStatus]}{" "}
              <span className="ml-1 text-xs opacity-70">{counts[itemStatus] ?? 0}</span>
            </button>
          );
        })}
      </div>

      <div className="no-line-card overflow-x-auto border">
        {isLoading ? (
          <div className="flex min-h-40 items-center justify-center p-6 text-sm text-[var(--muted-foreground)]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading jobs...
          </div>
        ) : null}
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
            <tr>
              <th className="px-4 py-3">Job</th>
              <th className="px-4 py-3">Property</th>
              <th className="px-4 py-3">Cleaner</th>
              <th className="px-4 py-3">Scheduled</th>
              <th className="px-4 py-3">Workflow</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobRows.map((job) => (
              <tr key={job._id} className="border-b border-[var(--border)] last:border-b-0">
                <td className="px-4 py-3">
                  <p className="font-medium">{job.notesForCleaner?.split("\n")[0] || "Cleaning Job"}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">{job._id}</p>
                </td>
                <td className="px-4 py-3">{job.property?.name ?? "Unknown property"}</td>
                <td className="px-4 py-3">{job.cleaners?.[0]?.name ?? "Unassigned"}</td>
                <td className="px-4 py-3">{new Date(job.scheduledStartAt ?? 0).toLocaleString()}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    {workflowStatuses.map((stepStatus, index) => {
                      const active = workflowIndex(job.status) >= index;
                      return (
                        <span
                          key={stepStatus}
                          className={`h-2 w-2 rounded-full ${
                            active ? "bg-[var(--primary)]" : "bg-[var(--border)]"
                          }`}
                          title={STATUS_LABELS[stepStatus]}
                        />
                      );
                    })}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_CLASSNAMES[job.status]}`}
                  >
                    {STATUS_LABELS[job.status]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/jobs/${job._id}`}
                    className="text-[var(--primary)] hover:underline"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!isLoading && !jobRows.length ? (
          <div className="px-4 py-12 text-center text-sm text-[var(--muted-foreground)]">
            No jobs found for current filters.
          </div>
        ) : null}
      </div>

      <CreateJobModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        propertyOptions={propertyOptions}
        cleanerOptions={cleanerOptions}
      />
    </div>
  );
}

function workflowIndex(status: JobStatus) {
  const index = workflowStatuses.indexOf(status);
  if (index === -1) {
    return 0;
  }
  return index;
}
