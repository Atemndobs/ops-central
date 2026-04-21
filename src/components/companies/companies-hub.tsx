"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Building2, Loader2, Plus, RefreshCcw, ShieldCheck, Users } from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";
import { getErrorMessage } from "@/lib/errors";

type DraftAssignments = Record<string, string>;

function formatDateTime(value?: number | null) {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString();
}

function isActiveAssignment(assignment: {
  isActive?: boolean;
  unassignedAt?: number;
}) {
  return assignment.isActive !== false && assignment.unassignedAt === undefined;
}

function companyNameKey(name: string) {
  return name.trim().toLowerCase();
}

export function CompaniesHub() {
  const { showToast } = useToast();
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();

  const companies = useQuery(
    api.admin.queries.getCompanies,
    isAuthenticated ? {} : "skip",
  );
  const properties = useQuery(
    api.properties.queries.getAll,
    isAuthenticated ? { limit: 500 } : "skip",
  );

  const [selectedCompanyId, setSelectedCompanyId] = useState<Id<"cleaningCompanies"> | null>(
    null,
  );
  const [cityFilter, setCityFilter] = useState("");
  const [draftAssignments, setDraftAssignments] = useState<DraftAssignments>({});
  const [busyPropertyId, setBusyPropertyId] = useState<string | null>(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [companyCity, setCompanyCity] = useState("");
  const [isCreatingCompany, setIsCreatingCompany] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editContactEmail, setEditContactEmail] = useState("");
  const [editContactPhone, setEditContactPhone] = useState("");
  const [editLogoUrl, setEditLogoUrl] = useState("");
  const [editCity, setEditCity] = useState("");
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isUpdatingCompany, setIsUpdatingCompany] = useState(false);
  const [isArchivingCompany, setIsArchivingCompany] = useState(false);
  const [isArchiveConfirmOpen, setIsArchiveConfirmOpen] = useState(false);

  const createCleaningCompany = useMutation(api.admin.mutations.createCleaningCompany);
  const updateCleaningCompany = useMutation(api.admin.mutations.updateCleaningCompany);
  const archiveCleaningCompany = useMutation(api.admin.mutations.archiveCleaningCompany);
  const assignPropertyToCompany = useMutation(api.admin.mutations.assignPropertyToCompany);
  const removePropertyCompanyAssignment = useMutation(
    api.admin.mutations.removePropertyCompanyAssignment,
  );

  const allCompanies = useMemo(() => {
    const newestByName = new Map<string, NonNullable<typeof companies>[number]>();
    for (const company of companies ?? []) {
      if (!company.isActive) {
        continue;
      }
      const key = companyNameKey(company.name);
      const existing = newestByName.get(key);
      if (!existing) {
        newestByName.set(key, company);
        continue;
      }
      const existingTimestamp = existing.updatedAt ?? existing.createdAt ?? 0;
      const currentTimestamp = company.updatedAt ?? company.createdAt ?? 0;
      if (currentTimestamp > existingTimestamp) {
        newestByName.set(key, company);
      }
    }

    return [...newestByName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [companies]);

  useEffect(() => {
    if (allCompanies.length === 0) {
      return;
    }

    if (!selectedCompanyId) {
      setSelectedCompanyId(allCompanies[0]._id);
      return;
    }

    if (!allCompanies.some((company) => company._id === selectedCompanyId)) {
      setSelectedCompanyId(allCompanies[0]._id);
    }
  }, [allCompanies, selectedCompanyId]);

  const selectedCompany = useMemo(
    () => allCompanies.find((company) => company._id === selectedCompanyId) ?? null,
    [allCompanies, selectedCompanyId],
  );

  const companyDetail = useQuery(
    api.admin.queries.getCompanyById,
    isAuthenticated && selectedCompanyId
      ? { id: selectedCompanyId }
      : "skip",
  );

  const assignmentsPayload = useQuery(
    api.admin.queries.listCompanyPropertyAssignments,
    isAuthenticated
      ? {
          companyId: undefined,
          city: cityFilter.trim() ? cityFilter.trim() : undefined,
          includeUnassigned: true,
          limit: 400,
        }
      : "skip",
  );

  const assignmentRows = assignmentsPayload?.rows ?? [];
  const allProperties = properties ?? [];

  const activeMemberCount = useMemo(
    () =>
      (companyDetail?.members ?? []).filter(
        (member) => member.isActive && member.leftAt === undefined,
      ).length,
    [companyDetail],
  );

  const activePropertyAssignments = useMemo(
    () =>
      (companyDetail?.properties ?? [])
        .filter((property) => isActiveAssignment(property))
        .sort((a, b) => b.assignedAt - a.assignedAt),
    [companyDetail],
  );
  const selectedCompanyActivePropertyCount = activePropertyAssignments.length;

  const propertyAssignmentHistory = useMemo(
    () =>
      (companyDetail?.properties ?? [])
        .slice()
        .sort((a, b) => b.assignedAt - a.assignedAt)
        .slice(0, 12),
    [companyDetail],
  );

  const getDraftCompanyValue = (row: (typeof assignmentRows)[number]) => {
    const cached = draftAssignments[row.propertyId];
    if (cached !== undefined) {
      return cached;
    }
    return row.activeAssignment?.companyId ?? "";
  };

  async function handleCreateCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!companyName.trim()) {
      showToast("Company name is required.", "error");
      return;
    }

    setIsCreatingCompany(true);
    try {
      const result = await createCleaningCompany({
        name: companyName.trim(),
        contactEmail: contactEmail.trim() || undefined,
        contactPhone: contactPhone.trim() || undefined,
        city: companyCity.trim() || undefined,
      });

      setCompanyName("");
      setContactEmail("");
      setContactPhone("");
      setCompanyCity("");
      setIsCreateOpen(false);
      setSelectedCompanyId(result.companyId);
      showToast("Cleaning company created.");
    } catch (error) {
      showToast(getErrorMessage(error, "Unable to create company."), "error");
    } finally {
      setIsCreatingCompany(false);
    }
  }

  function openEditCompany() {
    if (!selectedCompany) {
      return;
    }
    setEditName(selectedCompany.name);
    setEditContactEmail(selectedCompany.contactEmail ?? "");
    setEditContactPhone(selectedCompany.contactPhone ?? "");
    setEditLogoUrl(selectedCompany.logoUrl ?? "");
    setEditCity(selectedCompany.city ?? "");
    setIsEditOpen(true);
  }

  async function handleEditCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCompany) {
      return;
    }

    setIsUpdatingCompany(true);
    try {
      await updateCleaningCompany({
        companyId: selectedCompany._id,
        name: editName,
        contactEmail: editContactEmail.trim() || undefined,
        contactPhone: editContactPhone.trim() || undefined,
        logoUrl: editLogoUrl.trim() || undefined,
        city: editCity.trim() || undefined,
      });
      setIsEditOpen(false);
      showToast("Company updated.");
    } catch (error) {
      showToast(getErrorMessage(error, "Unable to update company."), "error");
    } finally {
      setIsUpdatingCompany(false);
    }
  }

  async function handleArchiveCompany() {
    if (!selectedCompany) {
      return;
    }
    if (selectedCompanyActivePropertyCount > 0) {
      showToast(
        `Unassign ${selectedCompanyActivePropertyCount} active propert${
          selectedCompanyActivePropertyCount === 1 ? "y" : "ies"
        } before archiving this company.`,
        "error",
      );
      return;
    }

    setIsArchivingCompany(true);
    try {
      await archiveCleaningCompany({
        companyId: selectedCompany._id,
      });
      showToast("Company archived.");
      setSelectedCompanyId(null);
      setIsEditOpen(false);
      setIsArchiveConfirmOpen(false);
    } catch (error) {
      showToast(getErrorMessage(error, "Unable to archive company."), "error");
    } finally {
      setIsArchivingCompany(false);
    }
  }

  async function handleAssign(row: (typeof assignmentRows)[number]) {
    const nextCompanyId = getDraftCompanyValue(row);
    if (!nextCompanyId) {
      showToast("Select a company first.", "error");
      return;
    }

    setBusyPropertyId(row.propertyId);
    try {
      await assignPropertyToCompany({
        propertyId: row.propertyId as Id<"properties">,
        companyId: nextCompanyId as Id<"cleaningCompanies">,
        reason: "Updated in Companies Hub",
      });
      setDraftAssignments((current) => ({
        ...current,
        [row.propertyId]: nextCompanyId,
      }));
      showToast("Property assignment updated.");
    } catch (error) {
      showToast(getErrorMessage(error, "Unable to assign company."), "error");
    } finally {
      setBusyPropertyId(null);
    }
  }

  async function handleRemove(row: (typeof assignmentRows)[number]) {
    setBusyPropertyId(row.propertyId);
    try {
      await removePropertyCompanyAssignment({
        propertyId: row.propertyId as Id<"properties">,
        reason: "Removed in Companies Hub",
      });
      setDraftAssignments((current) => ({
        ...current,
        [row.propertyId]: "",
      }));
      showToast("Property assignment removed.");
    } catch (error) {
      showToast(getErrorMessage(error, "Unable to remove assignment."), "error");
    } finally {
      setBusyPropertyId(null);
    }
  }

  async function handleUnassignActiveAssignment(
    assignment: (typeof activePropertyAssignments)[number],
  ) {
    const propertyId = assignment.propertyId as Id<"properties">;
    setBusyPropertyId(propertyId);
    try {
      await removePropertyCompanyAssignment({
        propertyId,
        reason: "Removed from selected company in Companies Hub",
      });
      setDraftAssignments((current) => ({
        ...current,
        [propertyId]: "",
      }));
      showToast("Property unassigned.");
    } catch (error) {
      showToast(getErrorMessage(error, "Unable to unassign property."), "error");
    } finally {
      setBusyPropertyId(null);
    }
  }

  if (isAuthLoading || (isAuthenticated && (!companies || !properties || !assignmentsPayload))) {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)]">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--muted-foreground)]">
        Connected to Clerk. Waiting for backend auth token...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border bg-[var(--card)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-display">Companies Hub</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Assign properties to cleaning companies, monitor members, and review assignment
              history.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selectedCompany ? (
              <>
                <button
                  type="button"
                  onClick={openEditCompany}
                  className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-[var(--accent)]"
                >
                  Edit Company
                </button>
                <button
                  type="button"
                  onClick={() => setIsArchiveConfirmOpen(true)}
                  disabled={isArchivingCompany || selectedCompanyActivePropertyCount > 0}
                  className="inline-flex items-center gap-2 rounded-md border border-red-500/40 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-60"
                >
                  {isArchivingCompany ? "Archiving..." : "Archive Company"}
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => setIsCreateOpen((previous) => !previous)}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-[var(--accent)]"
            >
              <Plus className="h-4 w-4" />
              New Company
            </button>
          </div>
        </div>

        {selectedCompany && selectedCompanyActivePropertyCount > 0 ? (
          <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
            Unassign {selectedCompanyActivePropertyCount} active propert
            {selectedCompanyActivePropertyCount === 1 ? "y" : "ies"} from{" "}
            {selectedCompany.name} before archiving.
          </p>
        ) : null}

        {isCreateOpen ? (
          <form onSubmit={handleCreateCompany} className="mt-4 grid gap-3 rounded-xl border p-4 md:grid-cols-4">
            <label className="space-y-1 text-sm md:col-span-2">
              <span className="text-[var(--muted-foreground)]">Company Name</span>
              <input
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                className="w-full rounded-md border bg-[var(--background)] px-3 py-2"
                placeholder="Dallas Cleaning Group"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-[var(--muted-foreground)]">Contact Email</span>
              <input
                type="email"
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
                className="w-full rounded-md border bg-[var(--background)] px-3 py-2"
                placeholder="dispatch@company.com"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-[var(--muted-foreground)]">Contact Phone</span>
              <input
                value={contactPhone}
                onChange={(event) => setContactPhone(event.target.value)}
                className="w-full rounded-md border bg-[var(--background)] px-3 py-2"
                placeholder="+1 ..."
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-[var(--muted-foreground)]">Service City</span>
              <input
                value={companyCity}
                onChange={(event) => setCompanyCity(event.target.value)}
                className="w-full rounded-md border bg-[var(--background)] px-3 py-2"
                placeholder="Dallas"
              />
              <span className="block text-xs text-[var(--muted-foreground)]">
                Company will only be shown when assigning properties in this city.
              </span>
            </label>
            <div className="md:col-span-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="rounded-md border px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isCreatingCompany}
                className="rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-60"
              >
                {isCreatingCompany ? "Creating..." : "Create Company"}
              </button>
            </div>
          </form>
        ) : null}

        {isEditOpen ? (
          <form onSubmit={handleEditCompany} className="mt-4 grid gap-3 rounded-xl border p-4 md:grid-cols-4">
            <label className="space-y-1 text-sm md:col-span-2">
              <span className="text-[var(--muted-foreground)]">Company Name</span>
              <input
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                className="w-full rounded-md border bg-[var(--background)] px-3 py-2"
                placeholder="Company name"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-[var(--muted-foreground)]">Contact Email</span>
              <input
                type="email"
                value={editContactEmail}
                onChange={(event) => setEditContactEmail(event.target.value)}
                className="w-full rounded-md border bg-[var(--background)] px-3 py-2"
                placeholder="dispatch@company.com"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-[var(--muted-foreground)]">Contact Phone</span>
              <input
                value={editContactPhone}
                onChange={(event) => setEditContactPhone(event.target.value)}
                className="w-full rounded-md border bg-[var(--background)] px-3 py-2"
                placeholder="+1 ..."
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-[var(--muted-foreground)]">Service City</span>
              <input
                value={editCity}
                onChange={(event) => setEditCity(event.target.value)}
                className="w-full rounded-md border bg-[var(--background)] px-3 py-2"
                placeholder="Dallas"
              />
              <span className="block text-xs text-[var(--muted-foreground)]">
                Only shown when assigning properties in this city.
              </span>
            </label>
            <div className="space-y-1 text-sm md:col-span-4">
              <span className="text-[var(--muted-foreground)]">Logo</span>
              <div className="flex items-center gap-3">
                {editLogoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={editLogoUrl} alt="Logo" className="h-10 w-10 rounded-lg border bg-white object-contain shrink-0" />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-[var(--accent)] text-xs font-bold text-[var(--muted-foreground)]">
                    {editName.slice(0, 2).toUpperCase() || "CO"}
                  </div>
                )}
                <label className="cursor-pointer">
                  <span className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-[var(--accent)] ${isUploadingLogo ? "opacity-60 pointer-events-none" : ""}`}>
                    {isUploadingLogo ? "Uploading..." : editLogoUrl ? "Change logo" : "Upload logo"}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    disabled={isUploadingLogo}
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      setIsUploadingLogo(true);
                      try {
                        const form = new FormData();
                        form.append("file", file);
                        const res = await fetch("/api/cloudinary/upload", { method: "POST", body: form });
                        const data = await res.json() as { url?: string; error?: string };
                        if (!res.ok || !data.url) throw new Error(data.error ?? "Upload failed");
                        setEditLogoUrl(data.url);
                      } catch (err) {
                        showToast(err instanceof Error ? err.message : "Upload failed", "error");
                      } finally {
                        setIsUploadingLogo(false);
                      }
                    }}
                  />
                </label>
                {editLogoUrl ? (
                  <button type="button" onClick={() => setEditLogoUrl("")} className="text-xs text-[var(--muted-foreground)] hover:text-[var(--destructive)]">
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
            <div className="md:col-span-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsEditOpen(false)}
                className="rounded-md border px-3 py-2 text-sm"
                disabled={isUpdatingCompany}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isUpdatingCompany}
                className="rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-60"
              >
                {isUpdatingCompany ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        ) : null}
      </header>

      {isArchiveConfirmOpen && selectedCompany ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border bg-[var(--card)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Archive Company</h2>
              <button
                className="rounded-md px-2 py-1 text-sm text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
                onClick={() => setIsArchiveConfirmOpen(false)}
                disabled={isArchivingCompany}
              >
                Close
              </button>
            </div>
            <p className="text-sm text-[var(--muted-foreground)]">
              Archive &quot;{selectedCompany.name}&quot;?
            </p>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              This does not delete properties, jobs, or history. It only marks the company
              inactive and removes it from active assignment lists.
            </p>

            {selectedCompanyActivePropertyCount > 0 ? (
              <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="text-sm font-medium text-amber-700">
                  Unassign active properties first ({selectedCompanyActivePropertyCount})
                </p>
                <div className="mt-2 max-h-40 space-y-2 overflow-y-auto pr-1">
                  {activePropertyAssignments.map((assignment) => {
                    const propertyId = assignment.propertyId;
                    const isBusy = busyPropertyId === propertyId;
                    return (
                      <div
                        key={assignment._id}
                        className="flex items-center justify-between gap-2 rounded-md border bg-[var(--card)] px-2 py-1.5"
                      >
                        <p className="truncate text-xs font-medium">
                          {assignment.property?.name ?? "Unknown property"}
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            void handleUnassignActiveAssignment(assignment)
                          }
                          disabled={isBusy}
                          className="rounded-md border border-red-500/40 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-60"
                        >
                          {isBusy ? "..." : "Unassign"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
                No active property assignments. You can archive this company now.
              </p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsArchiveConfirmOpen(false)}
                className="rounded-md border px-3 py-2 text-sm"
                disabled={isArchivingCompany}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleArchiveCompany()}
                disabled={isArchivingCompany || selectedCompanyActivePropertyCount > 0}
                className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-500/20 disabled:opacity-60"
              >
                {isArchivingCompany ? "Archiving..." : "Confirm Archive"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-3 rounded-2xl border bg-[var(--card)] p-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
              Cleaning Companies
            </p>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {allCompanies.length} total
            </p>
          </div>
          <div className="space-y-2">
            {allCompanies.map((company) => {
              const selected = company._id === selectedCompanyId;
              return (
                <button
                  key={company._id}
                  type="button"
                  onClick={() => setSelectedCompanyId(company._id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                    selected
                      ? "border-[var(--primary)] bg-[var(--primary)]/10"
                      : "hover:bg-[var(--accent)]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {company.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={company.logoUrl} alt="" className="h-6 w-6 rounded object-contain border bg-white shrink-0" />
                    ) : (
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[var(--accent)] text-[10px] font-bold text-[var(--muted-foreground)]">
                        {company.name.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <p className="truncate text-sm font-semibold">{company.name}</p>
                  </div>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {company.isActive ? "Active" : "Inactive"}
                  </p>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border bg-[var(--card)] p-4">
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Selected Company</p>
              <p className="mt-2 text-lg font-bold">{selectedCompany?.name ?? "—"}</p>
            </div>
            <div className="rounded-2xl border bg-[var(--card)] p-4">
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Active Members</p>
              <p className="mt-2 text-lg font-bold">{activeMemberCount}</p>
            </div>
            <div className="rounded-2xl border bg-[var(--card)] p-4">
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Active Properties</p>
              <p className="mt-2 text-lg font-bold">{activePropertyAssignments.length}</p>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-2xl border bg-[var(--card)]">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-[var(--muted-foreground)]" />
                  <h2 className="text-sm font-bold uppercase tracking-wide">Members</h2>
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto px-4 py-3">
                {companyDetail?.members?.length ? (
                  <div className="space-y-2">
                    {companyDetail.members
                      .slice()
                      .sort((a, b) => b.joinedAt - a.joinedAt)
                      .map((member) => (
                        <div key={member._id} className="rounded-lg border px-3 py-2 text-sm">
                          <p className="font-semibold">
                            {member.user?.name ?? member.user?.email ?? "Unknown user"}
                          </p>
                          <p className="text-xs text-[var(--muted-foreground)]">
                            {member.role} · {member.isActive ? "active" : "inactive"}
                          </p>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--muted-foreground)]">No members assigned yet.</p>
                )}
              </div>
            </section>

            <section className="rounded-2xl border bg-[var(--card)]">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-[var(--muted-foreground)]" />
                  <h2 className="text-sm font-bold uppercase tracking-wide">Assignment History</h2>
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto px-4 py-3">
                {propertyAssignmentHistory.length ? (
                  <div className="space-y-2">
                    {propertyAssignmentHistory.map((assignment) => (
                      <div key={assignment._id} className="rounded-lg border px-3 py-2 text-sm">
                        <p className="font-semibold">
                          {assignment.property?.name ?? "Unknown property"}
                        </p>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {isActiveAssignment(assignment) ? "active" : "inactive"} ·{" "}
                          {formatDateTime(assignment.assignedAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--muted-foreground)]">No assignments yet.</p>
                )}
              </div>
            </section>
          </div>

          <section className="rounded-2xl border bg-[var(--card)]">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-[var(--muted-foreground)]" />
                <h2 className="text-sm font-bold uppercase tracking-wide">
                  Active Properties ({activePropertyAssignments.length})
                </h2>
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto px-4 py-3">
              {activePropertyAssignments.length ? (
                <div className="space-y-2">
                  {activePropertyAssignments.map((assignment) => {
                    const propertyId = assignment.propertyId;
                    const isBusy = busyPropertyId === propertyId;
                    return (
                      <div
                        key={assignment._id}
                        className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-semibold">
                            {assignment.property?.name ?? "Unknown property"}
                          </p>
                          <p className="text-xs text-[var(--muted-foreground)]">
                            Assigned {formatDateTime(assignment.assignedAt)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            void handleUnassignActiveAssignment(assignment)
                          }
                          disabled={isBusy}
                          className="rounded-md border border-red-500/40 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-60"
                        >
                          {isBusy ? "..." : "Unassign"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-[var(--muted-foreground)]">
                  No active properties assigned.
                </p>
              )}
            </div>
          </section>
        </div>
      </section>

      <section className="rounded-2xl border bg-[var(--card)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide">Property Assignments</h2>
            <p className="text-xs text-[var(--muted-foreground)]">
              {assignmentRows.length} rows · {allProperties.length} active properties
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-[var(--muted-foreground)]">Filter city</span>
            <input
              value={cityFilter}
              onChange={(event) => setCityFilter(event.target.value)}
              className="rounded-md border bg-[var(--background)] px-3 py-1.5"
              placeholder="Dallas"
            />
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[940px]">
            <thead className="bg-[var(--accent)]/50 text-left text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
              <tr>
                <th className="px-4 py-3">Property</th>
                <th className="px-4 py-3">Current Company</th>
                <th className="px-4 py-3">Assigned</th>
                <th className="px-4 py-3">Assign To</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {assignmentRows.map((row) => {
                const draftCompany = getDraftCompanyValue(row);
                const isBusy = busyPropertyId === row.propertyId;
                const propertyCityKey = (row.city ?? "").trim().toLowerCase();
                const cityScopedCompanies = propertyCityKey
                  ? allCompanies.filter(
                      (c) => (c.city ?? "").trim().toLowerCase() === propertyCityKey,
                    )
                  : allCompanies;
                // If strict filter yields nothing, fall back to the full list
                // so an admin is never locked out (common while backfilling
                // city data across existing companies).
                const eligibleCompanies =
                  cityScopedCompanies.length > 0 ? cityScopedCompanies : allCompanies;
                const usingFallback =
                  propertyCityKey &&
                  cityScopedCompanies.length === 0 &&
                  allCompanies.length > 0;
                return (
                  <tr key={row.propertyId} className="border-t">
                    <td className="px-4 py-3">
                      <p className="text-sm font-semibold">{row.propertyName}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {row.address}
                        {row.city || row.state ? ` · ${[row.city, row.state].filter(Boolean).join(", ")}` : ""}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {row.activeAssignment ? (
                        <div className="space-y-1">
                          <p className="text-sm font-semibold">{row.activeAssignment.companyName}</p>
                          <p className="text-xs text-[var(--muted-foreground)]">
                            by {row.activeAssignment.assignedByName ?? "Unknown"} ·{" "}
                            {formatDateTime(row.activeAssignment.assignedAt)}
                          </p>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-500">
                          <ShieldCheck className="h-3 w-3" />
                          Unassigned
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--muted-foreground)]">
                      {row.assignmentsCount} record(s)
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={draftCompany}
                        onChange={(event) =>
                          setDraftAssignments((current) => ({
                            ...current,
                            [row.propertyId]: event.target.value,
                          }))
                        }
                        className="w-full rounded-md border bg-[var(--background)] px-3 py-2 text-sm"
                        disabled={isBusy}
                      >
                        <option value="">No company</option>
                        {eligibleCompanies.map((company) => (
                          <option key={company._id} value={company._id}>
                            {company.name}
                            {company.city ? ` · ${company.city}` : ""}
                          </option>
                        ))}
                      </select>
                      {usingFallback ? (
                        <p className="mt-1 text-[11px] text-amber-500">
                          No companies set for {row.city}. Showing all — set a
                          Service City on each company to tighten this list.
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleAssign(row)}
                          disabled={isBusy || !draftCompany}
                          className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--accent)] disabled:opacity-60"
                        >
                          {isBusy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCcw className="h-3.5 w-3.5" />
                          )}
                          Assign
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRemove(row)}
                          disabled={isBusy || !row.activeAssignment}
                          className="rounded-md border border-red-500/40 px-2.5 py-1.5 text-xs font-medium text-red-500 hover:bg-red-500/10 disabled:opacity-60"
                        >
                          Unassign
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
