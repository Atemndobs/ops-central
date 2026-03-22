"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Building2, Edit3, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import { PropertyFormModal } from "@/components/properties/property-form-modal";
import { PropertyFormValues, PropertyRecord, PropertyStatus } from "@/types/property";

const statusStyles: Record<PropertyStatus, string> = {
  ready: "bg-emerald-500/10 text-emerald-500",
  dirty: "bg-red-500/10 text-red-500",
  in_progress: "bg-amber-500/10 text-amber-500",
  vacant: "bg-slate-500/10 text-slate-500",
};

const statusLabels: Record<PropertyStatus, string> = {
  ready: "Ready",
  dirty: "Dirty",
  in_progress: "In Progress",
  vacant: "Vacant",
};

function formatDate(value?: number) {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleDateString();
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

export default function PropertiesPage() {
  const [search, setSearch] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<PropertyStatus | "all">("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingProperty, setEditingProperty] = useState<PropertyRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const properties = useQuery(
    search.trim().length > 0 ? api.properties.queries.search : api.properties.queries.list,
    search.trim().length > 0
      ? {
          query: search,
          status: selectedStatus === "all" ? undefined : selectedStatus,
        }
      : {
          status: selectedStatus === "all" ? undefined : selectedStatus,
        },
  ) as PropertyRecord[] | undefined;

  const createProperty = useMutation(api.properties.mutations.create);
  const updateProperty = useMutation(api.properties.mutations.update);
  const softDeleteProperty = useMutation(api.properties.mutations.softDelete);

  const cards = useMemo(() => properties ?? [], [properties]);

  const handleCreate = async (values: PropertyFormValues) => {
    setIsSaving(true);

    try {
      await createProperty(toMutationInput(values));
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdate = async (values: PropertyFormValues) => {
    if (!editingProperty) {
      return;
    }

    setIsSaving(true);

    try {
      await updateProperty({
        id: editingProperty._id as never,
        ...toMutationInput(values),
      });
      setEditingProperty(null);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const confirmed = window.confirm("Archive this property?");
    if (!confirmed) {
      return;
    }

    await softDeleteProperty({ id: id as never });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-1.5">
            <Search className="h-4 w-4 text-[var(--muted-foreground)]" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search properties..."
              className="bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
            />
          </div>

          <select
            value={selectedStatus}
            onChange={(event) =>
              setSelectedStatus(event.target.value as PropertyStatus | "all")
            }
            className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm outline-none"
          >
            <option value="all">All statuses</option>
            <option value="ready">Ready</option>
            <option value="dirty">Dirty</option>
            <option value="in_progress">In Progress</option>
            <option value="vacant">Vacant</option>
          </select>
        </div>

        <button
          className="flex items-center gap-2 rounded-md bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          onClick={() => setIsCreateOpen(true)}
        >
          <Plus className="h-4 w-4" />
          Add Property
        </button>
      </div>

      {!properties ? (
        <div className="flex min-h-40 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)]">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cards.length === 0 ? (
            <div className="col-span-full flex items-center justify-center rounded-lg border border-dashed border-[var(--border)] py-24">
              <div className="text-center">
                <Building2 className="mx-auto mb-2 h-8 w-8 text-[var(--muted-foreground)] opacity-40" />
                <p className="text-sm text-[var(--muted-foreground)]">No properties found</p>
              </div>
            </div>
          ) : (
            cards.map((property) => (
              <div
                key={property._id}
                className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]"
              >
                <div className="relative h-40 w-full bg-[var(--accent)]">
                  {property.primaryPhotoUrl ? (
                    <Image
                      src={property.primaryPhotoUrl}
                      alt={property.name}
                      fill
                      sizes="(max-width: 1280px) 50vw, 33vw"
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Building2 className="h-8 w-8 text-[var(--muted-foreground)]" />
                    </div>
                  )}

                  <span
                    className={`absolute right-2 top-2 rounded-full px-2 py-1 text-xs font-medium ${statusStyles[property.status]}`}
                  >
                    {statusLabels[property.status]}
                  </span>
                </div>

                <div className="space-y-3 p-4">
                  <div>
                    <Link
                      href={`/properties/${property._id}`}
                      className="text-base font-semibold hover:text-[var(--primary)]"
                    >
                      {property.name}
                    </Link>
                    <p className="text-sm text-[var(--muted-foreground)]">{property.address}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs text-[var(--muted-foreground)]">
                    <p>Check-in: {formatDate(property.nextCheckInAt)}</p>
                    <p>Check-out: {formatDate(property.nextCheckOutAt)}</p>
                    <p>
                      Cleaner: <span className="text-[var(--foreground)]">{property.assignedCleanerName || "—"}</span>
                    </p>
                    <p>
                      Beds/Baths: {property.bedrooms ?? "—"}/{property.bathrooms ?? "—"}
                    </p>
                  </div>

                  <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] pt-3">
                    <button
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--accent)]"
                      onClick={() => setEditingProperty(property)}
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      Edit
                    </button>
                    <button
                      className="inline-flex items-center gap-1 rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-500 hover:bg-red-500/10"
                      onClick={() => handleDelete(property._id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Archive
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <PropertyFormModal
        open={isCreateOpen}
        title="Add Property"
        submitLabel={isSaving ? "Saving..." : "Create Property"}
        onClose={() => setIsCreateOpen(false)}
        onSubmit={handleCreate}
      />

      <PropertyFormModal
        open={Boolean(editingProperty)}
        title="Edit Property"
        submitLabel={isSaving ? "Saving..." : "Update Property"}
        initialValues={
          editingProperty
            ? {
                name: editingProperty.name,
                address: editingProperty.address,
                city: editingProperty.city,
                state: editingProperty.state,
                postalCode: editingProperty.postalCode,
                country: editingProperty.country,
                status: editingProperty.status,
                propertyType: editingProperty.propertyType,
                bedrooms: editingProperty.bedrooms,
                bathrooms: editingProperty.bathrooms,
                estimatedCleaningMinutes: editingProperty.estimatedCleaningMinutes,
                accessNotes: editingProperty.accessNotes,
                tag: editingProperty.tag,
                primaryPhotoUrl: editingProperty.primaryPhotoUrl,
                photoUrls: editingProperty.photoUrls,
                assignedCleanerName: editingProperty.assignedCleanerName,
              }
            : undefined
        }
        onClose={() => setEditingProperty(null)}
        onSubmit={handleUpdate}
      />
    </div>
  );
}
