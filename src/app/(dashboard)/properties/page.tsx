"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  Building2,
  Edit3,
  LayoutGrid,
  List,
  Loader2,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { PropertyFormModal } from "@/components/properties/property-form-modal";
import { useToast } from "@/components/ui/toast-provider";
import { getErrorMessage } from "@/lib/errors";
import { PropertyFormValues, PropertyRecord, PropertyStatus } from "@/types/property";

type PropertyListItem = PropertyRecord & {
  imageUrl?: string;
  picture?: string;
};

type PropertyViewMode = "card" | "list";

const PROPERTY_VIEW_MODE_STORAGE_KEY = "opscentral.properties.defaultViewMode";

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

function formatBedsAndBaths(property: Pick<PropertyRecord, "bedrooms" | "bathrooms">) {
  return `${property.bedrooms ?? "—"}/${property.bathrooms ?? "—"}`;
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
    accessNotes: values.accessNotes || undefined,
    keyLocation: values.keyLocation || undefined,
    parkingNotes: values.parkingNotes || undefined,
    urgentNotes: values.urgentNotes || undefined,
  };
}

function parseStatusParam(value: string | null): PropertyStatus | "all" {
  if (!value) {
    return "all";
  }
  return value in statusLabels ? (value as PropertyStatus) : "all";
}

function PropertiesPageContent() {
  const { isAuthenticated } = useConvexAuth();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<PropertyStatus | "all">("all");
  const [viewMode, setViewMode] = useState<PropertyViewMode>("list");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingProperty, setEditingProperty] = useState<PropertyRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { showToast } = useToast();

  const properties = useQuery(
    api.properties.queries.getAll,
    isAuthenticated ? { limit: 500 } : "skip",
  );
  const propertyAssignments = useQuery(
    api.admin.queries.listCompanyPropertyAssignments,
    isAuthenticated
      ? { includeUnassigned: true, limit: 500 }
      : "skip",
  );

  const createProperty = useMutation(
    api.properties.mutations.create,
  );
  const updateProperty = useMutation(
    api.properties.mutations.update,
  );
  const softDeleteProperty = useMutation(
    api.properties.mutations.softDelete,
  );

  const statusFromQuery = parseStatusParam(searchParams.get("status"));
  useEffect(() => {
    setSelectedStatus(statusFromQuery);
  }, [statusFromQuery]);

  const activeCompanyByPropertyId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const row of propertyAssignments?.rows ?? []) {
      map.set(row.propertyId, row.activeAssignment?.companyName ?? null);
    }
    return map;
  }, [propertyAssignments]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const storedViewMode = window.localStorage.getItem(
      PROPERTY_VIEW_MODE_STORAGE_KEY,
    ) as PropertyViewMode | null;
    if (storedViewMode === "card" || storedViewMode === "list") {
      setViewMode(storedViewMode);
      return;
    }
    const mobileDefault: PropertyViewMode = window.matchMedia("(max-width: 767px)")
      .matches
      ? "list"
      : "card";
    setViewMode(mobileDefault);
  }, []);

  function setViewPreference(nextMode: PropertyViewMode) {
    setViewMode(nextMode);
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(PROPERTY_VIEW_MODE_STORAGE_KEY, nextMode);
  }

  const filteredProperties = useMemo(() => {
    const all = (properties ?? []) as PropertyListItem[];
    const searchValue = search.trim().toLowerCase();
    return all
      .map((property) => ({
        property,
        status: property.status ?? "vacant",
        imageUrl: property.primaryPhotoUrl || property.imageUrl || property.picture,
        companyName: activeCompanyByPropertyId.get(property._id) ?? "Unassigned",
      }))
      .filter(({ property, status }) => {
        const matchesSearch =
          !searchValue ||
          property.name.toLowerCase().includes(searchValue) ||
          property.address.toLowerCase().includes(searchValue);
        const matchesStatus = selectedStatus === "all" || status === selectedStatus;
        return matchesSearch && matchesStatus;
      });
  }, [activeCompanyByPropertyId, properties, search, selectedStatus]);

  const handleCreate = async (values: PropertyFormValues) => {
    setIsSaving(true);
    setActionError(null);

    try {
      await createProperty(toMutationInput(values));
      showToast("Property created successfully.");
    } catch (error) {
      const message = getErrorMessage(error, "Failed to create property.");
      setActionError(message);
      showToast(message, "error");
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdate = async (values: PropertyFormValues) => {
    if (!editingProperty) {
      return;
    }

    setIsSaving(true);
    setActionError(null);

    try {
      await updateProperty({
        id: editingProperty._id as never,
        ...toMutationInput(values),
      });
      setEditingProperty(null);
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

  const handleDelete = async (id: string) => {
    const confirmed = window.confirm("Archive this property?");
    if (!confirmed) {
      return;
    }

    setActionError(null);

    try {
      await softDeleteProperty({ id: id as never });
      showToast("Property archived.");
    } catch (error) {
      const message = getErrorMessage(error, "Failed to archive property.");
      setActionError(message);
      showToast(message, "error");
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-display">Properties</h1>
          <p className="mt-2 text-[var(--muted-foreground)]">
            Manage portfolio health and property readiness.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-none border bg-[var(--card)] px-3 py-1.5">
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
            className="rounded-none border bg-[var(--card)] px-3 py-1.5 text-sm outline-none"
          >
            <option value="all">All statuses</option>
            <option value="ready">Ready</option>
            <option value="dirty">Dirty</option>
            <option value="in_progress">In Progress</option>
            <option value="vacant">Vacant</option>
          </select>
        </div>

        <div className="flex w-full flex-wrap items-center justify-end gap-3 sm:w-auto">
          <div className="inline-flex w-full overflow-hidden rounded-none border bg-[var(--card)] sm:w-auto">
            <button
              type="button"
              onClick={() => setViewPreference("card")}
              className={`inline-flex flex-1 items-center justify-center gap-2 px-3 py-1.5 text-sm sm:flex-none ${
                viewMode === "card"
                  ? "bg-[var(--accent)] text-[var(--foreground)]"
                  : "text-[var(--muted-foreground)]"
              }`}
            >
              <LayoutGrid className="h-4 w-4" />
              Card
            </button>
            <button
              type="button"
              onClick={() => setViewPreference("list")}
              className={`inline-flex flex-1 items-center justify-center gap-2 border-l px-3 py-1.5 text-sm sm:flex-none ${
                viewMode === "list"
                  ? "bg-[var(--accent)] text-[var(--foreground)]"
                  : "text-[var(--muted-foreground)]"
              }`}
            >
              <List className="h-4 w-4" />
              List
            </button>
          </div>

          <button
            className="flex items-center gap-2 rounded-none bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90"
            onClick={() => setIsCreateOpen(true)}
          >
            <Plus className="h-4 w-4" />
            Add Property
          </button>
        </div>
      </div>

      {actionError ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {actionError}
        </div>
      ) : null}

      {!properties || !propertyAssignments ? (
        <div className="flex min-h-40 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)]">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
        </div>
      ) : filteredProperties.length === 0 ? (
        <div className="flex items-center justify-center border border-dashed py-24">
          <div className="text-center">
            <Building2 className="mx-auto mb-2 h-8 w-8 text-[var(--muted-foreground)] opacity-40" />
            <p className="text-sm text-[var(--muted-foreground)]">No properties found</p>
          </div>
        </div>
      ) : viewMode === "card" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filteredProperties.map(({ property, status, imageUrl, companyName }) => (
            <div
              key={property._id}
              className="overflow-hidden border bg-[var(--card)]"
            >
              <div className="relative h-40 w-full bg-[var(--accent)]">
                {imageUrl ? (
                  <Image
                    src={imageUrl}
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
                  className={`absolute right-2 top-2 rounded-none px-2 py-1 text-xs font-medium ${statusStyles[status]}`}
                >
                  {statusLabels[status]}
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
                    Cleaner:{" "}
                    <span className="text-[var(--foreground)]">
                      {property.assignedCleanerName || "—"}
                    </span>
                  </p>
                  <p>
                    Company:{" "}
                    <span className="text-[var(--foreground)]">{companyName}</span>
                  </p>
                  <p>Beds/Baths: {formatBedsAndBaths(property)}</p>
                </div>

                <p className="text-xs text-[var(--muted-foreground)]">
                  Manage company assignment in{" "}
                  <Link href="/companies" className="text-[var(--primary)] hover:underline">
                    Companies Hub
                  </Link>
                  .
                </p>

                <div className="flex items-center justify-end gap-2 border-t pt-3">
                  <button
                    className="inline-flex items-center gap-1 rounded-none border px-2 py-1 text-xs hover:bg-[var(--accent)]"
                    onClick={() => setEditingProperty(property)}
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  <button
                    className="inline-flex items-center gap-1 rounded-none border border-red-500/40 px-2 py-1 text-xs text-red-500 hover:bg-red-500/10"
                    onClick={() => handleDelete(property._id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Archive
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-none border bg-[var(--card)]">
          <div className="divide-y md:hidden">
            {filteredProperties.map(({ property, status, imageUrl, companyName }) => (
              <article key={property._id} className="space-y-3 p-4">
                <div className="flex items-start gap-3">
                  <div className="relative h-16 w-20 shrink-0 overflow-hidden border bg-[var(--accent)]">
                    {imageUrl ? (
                      <Image
                        src={imageUrl}
                        alt={property.name}
                        fill
                        sizes="80px"
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Building2 className="h-5 w-5 text-[var(--muted-foreground)]" />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link
                          href={`/properties/${property._id}`}
                          className="block truncate text-sm font-semibold hover:text-[var(--primary)]"
                        >
                          {property.name}
                        </Link>
                        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                          {property.address}
                        </p>
                      </div>

                      <span
                        className={`shrink-0 rounded-none px-2 py-1 text-[11px] font-medium ${statusStyles[status]}`}
                      >
                        {statusLabels[status]}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs text-[var(--muted-foreground)]">
                  <p>Check-in: {formatDate(property.nextCheckInAt)}</p>
                  <p>Check-out: {formatDate(property.nextCheckOutAt)}</p>
                  <p>Cleaner: {property.assignedCleanerName || "—"}</p>
                  <p>Company: {companyName}</p>
                  <p>Beds/Baths: {formatBedsAndBaths(property)}</p>
                </div>

                <p className="text-xs text-[var(--muted-foreground)]">
                  Manage company assignment in{" "}
                  <Link href="/companies" className="text-[var(--primary)] hover:underline">
                    Companies Hub
                  </Link>
                  .
                </p>

                <div className="flex items-center justify-end gap-2 border-t pt-3">
                  <button
                    className="inline-flex items-center gap-1 rounded-none border px-2 py-1 text-xs hover:bg-[var(--accent)]"
                    onClick={() => setEditingProperty(property)}
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  <button
                    className="inline-flex items-center gap-1 rounded-none border border-red-500/40 px-2 py-1 text-xs text-red-500 hover:bg-red-500/10"
                    onClick={() => handleDelete(property._id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Archive
                  </button>
                </div>
              </article>
            ))}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-[var(--accent)] text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
                <tr>
                  <th className="px-4 py-3 font-medium">Property</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Check-in</th>
                  <th className="px-4 py-3 font-medium">Check-out</th>
                  <th className="px-4 py-3 font-medium">Cleaner</th>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Beds/Baths</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProperties.map(({ property, status, imageUrl, companyName }) => (
                  <tr key={property._id} className="border-t">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="relative h-12 w-16 shrink-0 overflow-hidden border bg-[var(--accent)]">
                          {imageUrl ? (
                            <Image
                              src={imageUrl}
                              alt={property.name}
                              fill
                              sizes="64px"
                              className="object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <Building2 className="h-4 w-4 text-[var(--muted-foreground)]" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <Link
                            href={`/properties/${property._id}`}
                            className="block truncate font-semibold hover:text-[var(--primary)]"
                          >
                            {property.name}
                          </Link>
                          <p className="truncate text-xs text-[var(--muted-foreground)]">
                            {property.address}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-none px-2 py-1 text-xs font-medium ${statusStyles[status]}`}
                      >
                        {statusLabels[status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--muted-foreground)]">
                      {formatDate(property.nextCheckInAt)}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted-foreground)]">
                      {formatDate(property.nextCheckOutAt)}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted-foreground)]">
                      {property.assignedCleanerName || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <p className="text-[var(--foreground)]">{companyName}</p>
                        <Link
                          href="/companies"
                          className="text-xs text-[var(--primary)] hover:underline"
                        >
                          Companies Hub
                        </Link>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[var(--muted-foreground)]">
                      {formatBedsAndBaths(property)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          className="inline-flex items-center gap-1 rounded-none border px-2 py-1 text-xs hover:bg-[var(--accent)]"
                          onClick={() => setEditingProperty(property)}
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          Edit
                        </button>
                        <button
                          className="inline-flex items-center gap-1 rounded-none border border-red-500/40 px-2 py-1 text-xs text-red-500 hover:bg-red-500/10"
                          onClick={() => handleDelete(property._id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Archive
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                keyLocation: editingProperty.keyLocation,
                parkingNotes: editingProperty.parkingNotes,
                urgentNotes: editingProperty.urgentNotes,
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

export default function PropertiesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-40 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)]">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
        </div>
      }
    >
      <PropertiesPageContent />
    </Suspense>
  );
}
