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
  title: string;
  status: JobStatus;
  scheduledFor: number;
  propertyId: string;
  cleanerId?: string;
  property?: { _id: string; name?: string | null } | null;
  cleaner?: { _id: string; name?: string | null } | null;
};

type Option = {
  id: string;
  name: string;
};

const queryRef = <TArgs extends Record<string, unknown>, TReturn>(name: string) =>
  name as unknown as FunctionReference<"query", "public", TArgs, TReturn>;

export function JobsPageClient() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<JobStatus | "all">("all");
  const [propertyId, setPropertyId] = useState("all");
  const [cleanerId, setCleanerId] = useState("all");
  const [showCreateModal, setShowCreateModal] = useState(false);

  const jobs = useQuery(
    queryRef<
      {
        search?: string;
        status?: JobStatus;
        propertyId?: string;
        cleanerId?: string;
      },
      JobWithRelations[]
    >("jobs/queries:list"),
    {
    search: search || undefined,
    status: status === "all" ? undefined : status,
    propertyId: propertyId === "all" ? undefined : propertyId,
    cleanerId: cleanerId === "all" ? undefined : cleanerId,
    },
  );

  const allJobs = useQuery(
    queryRef<Record<string, never>, JobWithRelations[]>("jobs/queries:list"),
    {},
  );

  const cleanerOptionsFromUsers = useQuery(
    queryRef<Record<string, never>, Option[]>("jobs/queries:listCleanerOptions"),
    {},
  );

  const propertiesForCreate = useQuery(
    queryRef<{ includeInactive?: boolean }, Array<{ _id: string; name: string }>>(
      "properties/queries:list",
    ),
    { includeInactive: false },
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
      if (!job.cleanerId) {
        return;
      }
      const name = job.cleaner?.name || `Cleaner ${job.cleanerId.slice(-6)}`;
      optionMap.set(job.cleanerId, name);
    });
    return Array.from(optionMap.entries()).map(([id, name]) => ({ id, name }));
  }, [allJobs]);

  const cleanerOptions = useMemo(() => {
    const map = new Map<string, string>();
    (cleanerOptionsFromUsers ?? []).forEach((cleaner) => {
      map.set(cleaner.id, cleaner.name);
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
  const jobRows = jobs ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-1.5">
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
            className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm"
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
            className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm"
          >
            <option value="all">All Cleaners</option>
            {cleanerOptions.map((cleaner) => (
              <option key={cleaner.id} value={cleaner.id}>
                {cleaner.name}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 rounded-md bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          New Job
        </button>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-[var(--border)]">
        {["all", ...JOB_STATUSES].map((itemStatus) => {
          const typedStatus = itemStatus as JobStatus | "all";
          const active = status === typedStatus;
          return (
            <button
              key={itemStatus}
              onClick={() => setStatus(typedStatus)}
              className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm ${
                active
                  ? "border-[var(--primary)] text-[var(--foreground)]"
                  : "border-transparent text-[var(--muted-foreground)]"
              }`}
            >
              {itemStatus === "all" ? "All" : STATUS_LABELS[itemStatus as JobStatus]}{" "}
              <span className="ml-1 text-xs opacity-70">{counts[itemStatus] ?? 0}</span>
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--card)]">
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
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobRows.map((job) => (
              <tr key={job._id} className="border-b border-[var(--border)] last:border-b-0">
                <td className="px-4 py-3">
                  <p className="font-medium">{job.title}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">{job._id}</p>
                </td>
                <td className="px-4 py-3">{job.property?.name ?? "Unknown property"}</td>
                <td className="px-4 py-3">{job.cleaner?.name ?? "Unassigned"}</td>
                <td className="px-4 py-3">
                  {new Date(job.scheduledFor).toLocaleString()}
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
