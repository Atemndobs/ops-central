"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Loader2, Pencil } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { PropertyFormModal } from "@/components/properties/property-form-modal";
import { useToast } from "@/components/ui/toast-provider";
import { getErrorMessage } from "@/lib/errors";
import { PropertyFormValues, PropertyRecord } from "@/types/property";

const tabs = ["Overview", "Jobs", "Checklists", "Inventory", "Settings"] as const;

function formatDateTime(timestamp?: number) {
  if (!timestamp) {
    return "—";
  }

  return new Date(timestamp).toLocaleString();
}

function toMutationInput(values: PropertyFormValues) {
  return {
    name: values.name,
    address: values.address,
    city: values.city || undefined,
    state: values.state || undefined,
    postalCode: values.postalCode || undefined,
    country: values.country || undefined,
    status: values.status,
    propertyType: values.propertyType || undefined,
    bedrooms: values.bedrooms,
    bathrooms: values.bathrooms,
    estimatedCleaningMinutes: values.estimatedCleaningMinutes,
    accessNotes: values.accessNotes || undefined,
    tag: values.tag || undefined,
    primaryPhotoUrl: values.primaryPhotoUrl || undefined,
    photoUrls:
      values.photoUrls && values.photoUrls.length > 0 ? values.photoUrls : undefined,
    assignedCleanerName: values.assignedCleanerName || undefined,
  };
}

export function PropertyDetail({ id }: { id: string }) {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("Overview");
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { showToast } = useToast();

  const property = useQuery(api.properties.queries.getById, {
    id: id as never,
  }) as PropertyRecord | null | undefined;

  const updateProperty = useMutation(api.properties.mutations.update);

  const stats = useMemo(() => {
    if (!property) {
      return [];
    }

    return [
      { label: "Bedrooms", value: property.bedrooms ?? "—" },
      { label: "Bathrooms", value: property.bathrooms ?? "—" },
      {
        label: "Cleaning Duration",
        value: property.estimatedCleaningMinutes
          ? `${property.estimatedCleaningMinutes} min`
          : "—",
      },
      { label: "Next Check-in", value: formatDateTime(property.nextCheckInAt) },
      { label: "Next Check-out", value: formatDateTime(property.nextCheckOutAt) },
      { label: "Assigned Cleaner", value: property.assignedCleanerName ?? "—" },
    ];
  }, [property]);

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

  if (property === undefined) {
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

      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
        <div className="relative h-56 w-full bg-[var(--accent)]">
          {property.primaryPhotoUrl ? (
            <Image
              src={property.primaryPhotoUrl}
              alt={property.name}
              fill
              sizes="100vw"
              className="object-cover"
            />
          ) : null}
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4 p-4">
          <div>
            <h2 className="text-2xl font-bold">{property.name}</h2>
            <p className="text-sm text-[var(--muted-foreground)]">{property.address}</p>
          </div>
          <button
            onClick={() => setIsEditOpen(true)}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--accent)]"
          >
            <Pencil className="h-4 w-4" />
            Edit Property
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-[var(--border)]">
        {tabs.map((tab) => (
          <button
            key={tab}
            className={`border-b-2 px-4 py-2 text-sm ${
              activeTab === tab
                ? "border-[var(--primary)] text-[var(--foreground)]"
                : "border-transparent text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)]"
            }`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {actionError ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {actionError}
        </div>
      ) : null}

      {activeTab === "Overview" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {stats.map((item) => (
            <div key={item.label} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">{item.label}</p>
              <p className="mt-1 text-lg font-semibold">{item.value}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6 text-sm text-[var(--muted-foreground)]">
          {activeTab} content layout is ready for data integration.
        </div>
      )}

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
    </div>
  );
}
