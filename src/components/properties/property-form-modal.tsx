"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Loader2, Upload, X } from "lucide-react";
import { getErrorMessage } from "@/lib/errors";
import { PropertyFormValues, PropertyStatus } from "@/types/property";

interface PropertyFormModalProps {
  open: boolean;
  title: string;
  submitLabel: string;
  initialValues?: Partial<PropertyFormValues>;
  onClose: () => void;
  onSubmit: (values: PropertyFormValues) => Promise<void>;
}

const statusOptions: Array<{ label: string; value: PropertyStatus }> = [
  { label: "Ready", value: "ready" },
  { label: "Dirty", value: "dirty" },
  { label: "In Progress", value: "in_progress" },
  { label: "Vacant", value: "vacant" },
];

const defaultValues: PropertyFormValues = {
  name: "",
  address: "",
  city: "",
  state: "",
  postalCode: "",
  country: "",
  status: "vacant",
  propertyType: "",
  bedrooms: undefined,
  bathrooms: undefined,
  estimatedCleaningMinutes: undefined,
  accessNotes: "",
  tag: "",
  primaryPhotoUrl: "",
  photoUrls: [],
  assignedCleanerName: "",
};

function parseNumberValue(value: string) {
  if (!value.trim()) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function PropertyFormModal({
  open,
  title,
  submitLabel,
  initialValues,
  onClose,
  onSubmit,
}: PropertyFormModalProps) {
  const computedInitialValues = useMemo(
    () => ({ ...defaultValues, ...initialValues }),
    [initialValues],
  );

  const [formValues, setFormValues] = useState<PropertyFormValues>(computedInitialValues);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFormValues(computedInitialValues);
      setErrorMessage(null);
    }
  }, [computedInitialValues, open]);

  if (!open) {
    return null;
  }

  const handleUpload = async (file: File) => {
    setIsUploading(true);
    setErrorMessage(null);

    try {
      const uploadForm = new FormData();
      uploadForm.append("file", file);

      const response = await fetch("/api/cloudinary/upload", {
        method: "POST",
        body: uploadForm,
      });

      const payload = await response.json();

      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error ?? "Failed to upload image");
      }

      setFormValues((current) => {
        const nextPhotoUrls = [...(current.photoUrls ?? []), payload.url];

        return {
          ...current,
          primaryPhotoUrl: current.primaryPhotoUrl || payload.url,
          photoUrls: nextPhotoUrls,
        };
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!formValues.name.trim() || !formValues.address.trim()) {
      setErrorMessage("Name and address are required.");
      return;
    }

    if (formValues.bedrooms !== undefined && formValues.bedrooms < 0) {
      setErrorMessage("Bedrooms must be 0 or more.");
      return;
    }

    if (formValues.bathrooms !== undefined && formValues.bathrooms < 0) {
      setErrorMessage("Bathrooms must be 0 or more.");
      return;
    }

    if (
      formValues.estimatedCleaningMinutes !== undefined &&
      formValues.estimatedCleaningMinutes < 0
    ) {
      setErrorMessage("Cleaning minutes must be 0 or more.");
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      await onSubmit({
        ...formValues,
        name: formValues.name.trim(),
        address: formValues.address.trim(),
      });
      onClose();
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "Failed to save property"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-lg border border-[var(--border)] bg-[var(--card)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] p-4">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm">Name</span>
              <input
                required
                value={formValues.name}
                onChange={(event) =>
                  setFormValues((current) => ({ ...current, name: event.target.value }))
                }
                className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
              />
            </label>

            <label className="space-y-1">
              <span className="text-sm">Status</span>
              <select
                value={formValues.status}
                onChange={(event) =>
                  setFormValues((current) => ({
                    ...current,
                    status: event.target.value as PropertyStatus,
                  }))
                }
                className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
              >
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value} className="bg-[var(--card)]">
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="space-y-1">
            <span className="text-sm">Address</span>
            <input
              required
              value={formValues.address}
              onChange={(event) =>
                setFormValues((current) => ({ ...current, address: event.target.value }))
              }
              className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-1">
              <span className="text-sm">City</span>
              <input
                value={formValues.city ?? ""}
                onChange={(event) =>
                  setFormValues((current) => ({ ...current, city: event.target.value }))
                }
                className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
              />
            </label>

            <label className="space-y-1">
              <span className="text-sm">State</span>
              <input
                value={formValues.state ?? ""}
                onChange={(event) =>
                  setFormValues((current) => ({ ...current, state: event.target.value }))
                }
                className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
              />
            </label>

            <label className="space-y-1">
              <span className="text-sm">Zip</span>
              <input
                value={formValues.postalCode ?? ""}
                onChange={(event) =>
                  setFormValues((current) => ({ ...current, postalCode: event.target.value }))
                }
                className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-1">
              <span className="text-sm">Bedrooms</span>
              <input
                type="number"
                min={0}
                value={formValues.bedrooms ?? ""}
                onChange={(event) =>
                  setFormValues((current) => ({
                    ...current,
                    bedrooms: parseNumberValue(event.target.value),
                  }))
                }
                className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
              />
            </label>

            <label className="space-y-1">
              <span className="text-sm">Bathrooms</span>
              <input
                type="number"
                min={0}
                step="0.5"
                value={formValues.bathrooms ?? ""}
                onChange={(event) =>
                  setFormValues((current) => ({
                    ...current,
                    bathrooms: parseNumberValue(event.target.value),
                  }))
                }
                className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
              />
            </label>

            <label className="space-y-1">
              <span className="text-sm">Cleaning Minutes</span>
              <input
                type="number"
                min={0}
                value={formValues.estimatedCleaningMinutes ?? ""}
                onChange={(event) =>
                  setFormValues((current) => ({
                    ...current,
                    estimatedCleaningMinutes: parseNumberValue(event.target.value),
                  }))
                }
                className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
              />
            </label>
          </div>

          <label className="space-y-1">
            <span className="text-sm">Access Notes</span>
            <textarea
              rows={3}
              value={formValues.accessNotes ?? ""}
              onChange={(event) =>
                setFormValues((current) => ({ ...current, accessNotes: event.target.value }))
              }
              className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
            />
          </label>

          <div className="space-y-2">
            <span className="text-sm">Photos</span>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-[var(--border)] px-3 py-2 text-sm text-[var(--muted-foreground)] hover:bg-[var(--accent)]">
              {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Upload photo to Cloudinary
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const selected = event.target.files?.[0];
                  if (selected) {
                    void handleUpload(selected);
                  }
                  event.target.value = "";
                }}
                disabled={isUploading}
              />
            </label>
            {formValues.primaryPhotoUrl ? (
              <div className="relative h-28 w-full overflow-hidden rounded-md">
                <Image
                  src={formValues.primaryPhotoUrl}
                  alt="Property preview"
                  fill
                  sizes="100vw"
                  className="object-cover"
                />
              </div>
            ) : null}
          </div>

          {errorMessage ? <p className="text-sm text-red-500">{errorMessage}</p> : null}

          <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--accent)]"
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
              disabled={isSaving || isUploading}
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
