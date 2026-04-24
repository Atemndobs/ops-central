"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { ArrowLeft, Loader2, MapPin, Pencil, Upload } from "lucide-react";
import { PropertyFormModal } from "@/components/properties/property-form-modal";
import { STATUS_LABELS } from "@/components/jobs/job-status";
import { useToast } from "@/components/ui/toast-provider";
import { getErrorMessage } from "@/lib/errors";
import { PropertyFormValues, PropertyRecord } from "@/types/property";
import { PropertyCriticalCheckpointsPanel } from "@/components/properties/property-critical-checkpoints-panel";
import { PropertyRefillTrackingPanel } from "@/components/properties/property-refill-tracking-panel";
import { PropertyInstructionsPanel } from "@/components/properties/property-instructions-panel";
import { PropertyRoomsPanel } from "@/components/properties/property-rooms-panel";
import { InventoryImportModal } from "@/components/inventory/inventory-import-modal";
import type { Id } from "@convex/_generated/dataModel";

function formatDateTime(timestamp?: number) {
  if (!timestamp) {
    return "-";
  }

  return new Date(timestamp).toLocaleString();
}

function toMutationInput(values: PropertyFormValues) {
  return {
    name: values.name,
    address: values.address,
    city: values.city || undefined,
    state: values.state || undefined,
    zipCode: values.postalCode || undefined,
    country: values.country || undefined,
    propertyType: values.propertyType || undefined,
    bedrooms: values.bedrooms,
    bathrooms: values.bathrooms,
    imageUrl: values.primaryPhotoUrl || undefined,
  };
}

export function PropertyDetail({ id }: { id: string }) {
  const { isAuthenticated } = useConvexAuth();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { showToast } = useToast();

  const property = useQuery(
    api.properties.queries.getById,
    isAuthenticated ? { id: id as never } : "skip",
  ) as PropertyRecord | null | undefined;

  const jobs = useQuery(
    api.cleaningJobs.queries.getAll,
    isAuthenticated ? { propertyId: id as never, limit: 30 } : "skip",
  );
  const propertyCompanyAssignment = useQuery(
    api.admin.queries.getPropertyCompanyAssignment,
    isAuthenticated ? { propertyId: id as never } : "skip",
  );

  const updateProperty = useMutation(
    api.properties.mutations.update,
  );

  const recentJobs = useMemo(() => {
    return (jobs ?? []).slice().sort((a, b) => (b.scheduledStartAt ?? 0) - (a.scheduledStartAt ?? 0));
  }, [jobs]);

  const overviewStats = useMemo(() => {
    if (!property) {
      return [];
    }

    return [
      {
        label: "Configuration",
        value: `${property.bedrooms ?? "-"} Beds · ${property.bathrooms ?? "-"} Baths`,
      },
      {
        label: "Property Status",
        value: property.status.replace("_", " "),
      },
      {
        label: "Next Check-In",
        value: formatDateTime(property.nextCheckInAt),
      },
      {
        label: "Primary Cleaner",
        value: property.assignedCleanerName ?? "Unassigned",
      },
      {
        label: "Cleaning Company",
        value: propertyCompanyAssignment?.activeAssignment?.companyName ?? "Unassigned",
      },
    ];
  }, [property, propertyCompanyAssignment?.activeAssignment?.companyName]);

  const handleUpdate = async (values: PropertyFormValues) => {
    setIsSaving(true);
    setActionError(null);

    try {
      await updateProperty({ id: id as never, ...toMutationInput(values) });
      setIsEditOpen(false);
      showToast("Property updated successfully.");
    } catch (error) {
      const message = getErrorMessage(error, "Failed to update property.");
      setActionError(message);
      showToast(message, "error");
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  if (property === undefined || jobs === undefined || propertyCompanyAssignment === undefined) {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)]">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  if (property === null) {
    return (
      <div className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
        <p className="text-sm text-[var(--muted-foreground)]">Property not found.</p>
        <Link href="/properties" className="text-sm text-[var(--primary)] hover:underline">
          Back to properties
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href="/properties"
        className="inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to properties
      </Link>

      <section className="rounded-2xl border bg-[var(--card)] p-5">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">{property.name}</h1>
            <p className="mt-1 flex items-center gap-1 text-sm text-[var(--muted-foreground)]">
              <MapPin className="h-3.5 w-3.5" />
              {property.address}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setIsImportOpen(true)}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold hover:bg-[var(--accent)]"
            >
              <Upload className="h-4 w-4" />
              Import Inventory
            </button>
            <button
              onClick={() => setIsEditOpen(true)}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold hover:bg-[var(--accent)]"
            >
              <Pencil className="h-4 w-4" />
              Edit Property
            </button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="overflow-hidden rounded-xl border">
            <div className="relative h-64 w-full bg-[var(--secondary)]">
              {property.primaryPhotoUrl ? (
                <Image
                  src={property.primaryPhotoUrl}
                  alt={property.name}
                  fill
                  sizes="(min-width: 1024px) 66vw, 100vw"
                  className="object-cover"
                />
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border bg-[var(--card)]">
            <div className="grid grid-cols-1 divide-y">
              {overviewStats.map((item) => (
                <div key={item.label} className="px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                    {item.label}
                  </p>
                  <p className="mt-1 text-sm font-semibold capitalize">{item.value}</p>
                </div>
              ))}
            </div>
            <div className="border-t px-4 py-3 text-xs text-[var(--muted-foreground)]">
              Manage assignments in{" "}
              <Link href="/companies" className="text-[var(--primary)] hover:underline">
                Companies Hub
              </Link>
              .
            </div>
          </div>
        </div>
      </section>

      {actionError ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {actionError}
        </div>
      ) : null}

      <PropertyInstructionsPanel
        propertyId={id}
        accessNotes={property.accessNotes ?? null}
        keyLocation={property.keyLocation ?? null}
        parkingNotes={property.parkingNotes ?? null}
        urgentNotes={property.urgentNotes ?? null}
        instructions={property.instructions ?? null}
      />

      <PropertyRoomsPanel
        propertyId={id}
        rooms={property.rooms ?? []}
        hasHospitableId={Boolean(property.hospitableId)}
      />

      <PropertyCriticalCheckpointsPanel propertyId={id} propertyRooms={property.rooms ?? []} />

      <PropertyRefillTrackingPanel propertyId={id} />

      <section className="rounded-2xl border bg-[var(--card)]">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Job History</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead className="bg-[var(--secondary)]">
              <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Assigned Staff</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Duration</th>
              </tr>
            </thead>
            <tbody>
              {recentJobs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
                    No jobs found for this property.
                  </td>
                </tr>
              ) : (
                recentJobs.map((job) => {
                  const start = job.scheduledStartAt ?? 0;
                  const end = job.scheduledEndAt ?? start;
                  const minutes = Math.max(0, Math.round((end - start) / 60000));

                  return (
                    <tr key={job._id} className="border-t">
                      <td className="px-4 py-3 text-sm font-semibold">{formatDateTime(job.scheduledStartAt)}</td>
                      <td className="px-4 py-3 text-sm">
                        {job.cleaners?.[0]?.name || "Unassigned"}
                      </td>
                      <td className="px-4 py-3 text-sm">{STATUS_LABELS[job.status]}</td>
                      <td className="px-4 py-3 text-sm text-[var(--muted-foreground)]">
                        {minutes ? `${minutes} min` : "-"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <PropertyFormModal
        open={isEditOpen}
        title="Edit Property"
        submitLabel={isSaving ? "Saving..." : "Update Property"}
        initialValues={{
          name: property.name,
          address: property.address,
          city: property.city,
          state: property.state,
          postalCode: property.postalCode,
          country: property.country,
          status: property.status,
          propertyType: property.propertyType,
          bedrooms: property.bedrooms,
          bathrooms: property.bathrooms,
          estimatedCleaningMinutes: property.estimatedCleaningMinutes,
          accessNotes: property.accessNotes,
          tag: property.tag,
          primaryPhotoUrl: property.primaryPhotoUrl,
          photoUrls: property.photoUrls,
          assignedCleanerName: property.assignedCleanerName,
        }}
        onClose={() => setIsEditOpen(false)}
        onSubmit={handleUpdate}
      />

      <InventoryImportModal
        open={isImportOpen}
        propertyId={id as Id<"properties">}
        propertyName={property.name}
        onClose={() => setIsImportOpen(false)}
      />
    </div>
  );
}
