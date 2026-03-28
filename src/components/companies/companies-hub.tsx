"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
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

  const companies = useQuery(api.admin.queries.getCompanies);
  const properties = useQuery(api.properties.queries.getAll, { limit: 500 });

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
  const [isCreatingCompany, setIsCreatingCompany] = useState(false);

  const createCleaningCompany = useMutation(api.admin.mutations.createCleaningCompany);
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
    selectedCompanyId ? { id: selectedCompanyId } : "skip",
  );

  const assignmentsPayload = useQuery(api.admin.queries.listCompanyPropertyAssignments, {
    companyId: undefined,
    city: cityFilter.trim() ? cityFilter.trim() : undefined,
    includeUnassigned: true,
    limit: 400,
  });

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
      });

      setCompanyName("");
      setContactEmail("");
      setContactPhone("");
      setIsCreateOpen(false);
      setSelectedCompanyId(result.companyId);
      showToast("Cleaning company created.");
    } catch (error) {
      showToast(getErrorMessage(error, "Unable to create company."), "error");
    } finally {
      setIsCreatingCompany(false);
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

  if (!companies || !properties || !assignmentsPayload) {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)]">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
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
      </header>

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
                  <p className="text-sm font-semibold">{company.name}</p>
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
                        {allCompanies.map((company) => (
                          <option key={company._id} value={company._id}>
                            {company.name}
                          </option>
                        ))}
                      </select>
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
