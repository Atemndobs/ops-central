"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useAuth } from "@clerk/nextjs";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useToast } from "@/components/ui/toast-provider";
import { getRoleFromSessionClaims } from "@/lib/auth";
import {
  Award,
  LayoutGrid,
  List,
  Loader2,
  Plus,
  Search,
  TrendingUp,
} from "lucide-react";

type UserRole = "cleaner" | "manager" | "property_ops" | "admin";
type CompanyMemberRole = "cleaner" | "manager" | "owner";
type AvailabilityFilter = "all" | "active" | "working" | "available" | "off";

type MemberActionTarget = {
  userId: Id<"users">;
  name?: string;
  email?: string;
  role: UserRole;
  companyId: Id<"cleaningCompanies"> | null;
  companyMemberRole: CompanyMemberRole | null;
};

export default function TeamPage() {
  const { showToast } = useToast();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | UserRole>("all");
  const [availabilityFilter, setAvailabilityFilter] =
    useState<AvailabilityFilter>("all");
  const [viewMode, setViewMode] = useState<"card" | "list">("card");
  const [openMenuForUserId, setOpenMenuForUserId] = useState<Id<"users"> | null>(
    null,
  );

  const [roleEditor, setRoleEditor] = useState<MemberActionTarget | null>(null);
  const [roleDraft, setRoleDraft] = useState<UserRole>("cleaner");
  const [isUpdatingRole, setIsUpdatingRole] = useState(false);

  const [companyEditor, setCompanyEditor] = useState<MemberActionTarget | null>(
    null,
  );
  const [companyDraft, setCompanyDraft] = useState<Id<"cleaningCompanies"> | "">(
    "",
  );
  const [companyRoleDraft, setCompanyRoleDraft] = useState<CompanyMemberRole>(
    "cleaner",
  );
  const [isUpdatingCompany, setIsUpdatingCompany] = useState(false);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [newMember, setNewMember] = useState({
    fullName: "",
    email: "",
    role: "cleaner" as UserRole,
    phone: "",
  });

  const { isLoaded: isClerkLoaded, isSignedIn, sessionClaims } = useAuth();
  const currentRole = getRoleFromSessionClaims(
    (sessionClaims as Record<string, unknown> | null | undefined) ?? null,
  );
  const canManageTeam = currentRole === "admin";
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const teamMetrics = useQuery(
    api.admin.queries.getTeamMetrics,
    isAuthenticated ? {} : "skip",
  );
  const companies = useQuery(
    api.admin.queries.getCompanies,
    isAuthenticated ? {} : "skip",
  );
  const assignUserCompanyMembership = useMutation(
    api.admin.mutations.assignUserCompanyMembership,
  );

  useEffect(() => {
    if (!openMenuForUserId) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-team-member-menu]")) {
        return;
      }
      setOpenMenuForUserId(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [openMenuForUserId]);

  const members = useMemo(() => {
    const combined = [...(teamMetrics?.members ?? [])];
    const q = search.trim().toLowerCase();

    const filtered = combined.filter((member) => {
      const roleMatches = roleFilter === "all" || member.role === roleFilter;
      const availabilityMatches =
        availabilityFilter === "all" ||
        (availabilityFilter === "active" && member.availability !== "off") ||
        member.availability === availabilityFilter;
      const textMatches =
        !q ||
        member.name?.toLowerCase().includes(q) ||
        member.email?.toLowerCase().includes(q);
      return roleMatches && availabilityMatches && textMatches;
    });

    return filtered;
  }, [availabilityFilter, roleFilter, search, teamMetrics]);

  const summary = useMemo(() => {
    const totalCleaners = (teamMetrics?.members ?? []).filter(
      (member) => member.role === "cleaner",
    ).length;
    const activeNow = members.filter((member) => member.availability !== "off").length;
    const onTimeValues = members
      .map((member) => member.onTimePct)
      .filter((value): value is number => typeof value === "number");
    const avgOnTime =
      onTimeValues.length > 0
        ? Math.round(
            onTimeValues.reduce((sum, value) => sum + value, 0) / onTimeValues.length,
          )
        : null;

    const qualityValues = members
      .map((member) => member.qualityScore)
      .filter((value): value is number => typeof value === "number");
    const avgQuality =
      qualityValues.length > 0
        ? (
            qualityValues.reduce((sum, value) => sum + value, 0) /
            qualityValues.length
          ).toFixed(1)
        : null;

    return {
      totalCleaners,
      activeNow,
      avgOnTime,
      avgQuality,
    };
  }, [members, teamMetrics]);

  const leaderboard = useMemo(() => {
    return [...members]
      .filter((member) => typeof member.qualityScore === "number")
      .sort(
        (a, b) =>
          (b.qualityScore ?? Number.NEGATIVE_INFINITY) -
          (a.qualityScore ?? Number.NEGATIVE_INFINITY),
      )
      .slice(0, 3)
      .map((member) => ({
        ...member,
        score: ((member.qualityScore ?? 0) * 20).toFixed(1),
      }));
  }, [members]);

  const totalActiveAssignments = useMemo(
    () =>
      members.reduce(
        (total, member) => total + member.activeAssignmentsCount,
        0,
      ),
    [members],
  );

  const loading =
    !isClerkLoaded ||
    isAuthLoading ||
    (isAuthenticated && (!teamMetrics || !companies));

  if (isClerkLoaded && !isSignedIn) {
    return (
      <div className="rounded-none border bg-[var(--card)] p-6 text-sm text-[var(--muted-foreground)]">
        Sign in to view and manage team members.
      </div>
    );
  }

  if (isClerkLoaded && isSignedIn && !isAuthenticated) {
    return (
      <div className="rounded-none border bg-[var(--card)] p-6 text-sm text-[var(--muted-foreground)]">
        Connected to Clerk. Waiting for backend auth token...
      </div>
    );
  }

  function openRoleEditor(member: MemberActionTarget) {
    setRoleEditor(member);
    setRoleDraft(member.role);
    setOpenMenuForUserId(null);
  }

  function openCompanyEditor(member: MemberActionTarget) {
    setCompanyEditor(member);
    setCompanyDraft(member.companyId ?? "");
    setCompanyRoleDraft(
      member.companyMemberRole ??
        (member.role === "manager" ? "manager" : "cleaner"),
    );
    setOpenMenuForUserId(null);
  }

  async function handleRoleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!roleEditor) {
      return;
    }
    if (!roleEditor.email) {
      showToast("User email is required to update role.", "error");
      return;
    }

    setIsUpdatingRole(true);
    try {
      const suggestedName =
        roleEditor.name?.trim() ||
        roleEditor.email.split("@")[0] ||
        "Team Member";
      const fullName =
        suggestedName.length >= 2 ? suggestedName : `${suggestedName} User`;

      const response = await fetch("/api/team-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          email: roleEditor.email,
          role: roleDraft,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
      };

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to update role.");
      }

      showToast("Role updated successfully.");
      setRoleEditor(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update role.";
      showToast(message, "error");
    } finally {
      setIsUpdatingRole(false);
    }
  }

  async function handleCompanyAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!companyEditor) {
      return;
    }

    setIsUpdatingCompany(true);
    try {
      await assignUserCompanyMembership({
        userId: companyEditor.userId,
        companyId: companyDraft === "" ? null : companyDraft,
        memberRole: companyDraft === "" ? undefined : companyRoleDraft,
      });

      showToast(
        companyDraft === ""
          ? "Company assignment cleared."
          : "Company assignment updated.",
      );
      setCompanyEditor(null);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to update company assignment.";
      showToast(message, "error");
    } finally {
      setIsUpdatingCompany(false);
    }
  }

  function scrollToSection(sectionId: string) {
    if (typeof window === "undefined") {
      return;
    }
    window.requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function drillToMembers(next: {
    role?: "all" | UserRole;
    availability?: AvailabilityFilter;
  }) {
    if (next.role) {
      setRoleFilter(next.role);
    }
    if (next.availability) {
      setAvailabilityFilter(next.availability);
    }
    setViewMode("list");
    scrollToSection("team-members-section");
  }

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-display">Team Management</h1>
          <p className="mt-2 text-[var(--muted-foreground)]">
            Monitor performance and manage cleaner assignments.
          </p>
        </div>
        {canManageTeam ? (
          <button
            onClick={() => setIsCreateOpen(true)}
            className="inline-flex items-center gap-2 rounded-none bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Add Team Member
          </button>
        ) : null}
      </div>

      {createSuccess ? (
        <div className="border-2 border-emerald-600 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {createSuccess}
        </div>
      ) : null}

      <div className="grid gap-8 xl:grid-cols-12">
        <div className="xl:col-span-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 rounded-none border bg-[var(--card)] px-3 py-1.5">
                <Search className="h-4 w-4 text-[var(--muted-foreground)]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search team"
                  className="w-44 bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
                />
              </div>
              <select
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value as typeof roleFilter)}
                className="rounded-none border bg-[var(--card)] px-3 py-1.5 text-sm outline-none"
              >
                <option value="all">All Roles</option>
                <option value="admin">Admin</option>
                <option value="cleaner">Cleaner</option>
                <option value="manager">Manager</option>
                <option value="property_ops">Property Ops</option>
              </select>
              <select
                value={availabilityFilter}
                onChange={(event) =>
                  setAvailabilityFilter(event.target.value as AvailabilityFilter)
                }
                className="rounded-none border bg-[var(--card)] px-3 py-1.5 text-sm outline-none"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active Now</option>
                <option value="working">Working</option>
                <option value="available">Available</option>
                <option value="off">Off</option>
              </select>
            </div>
            <div className="inline-flex overflow-hidden rounded-none border bg-[var(--card)]">
              <button
                type="button"
                onClick={() => setViewMode("card")}
                className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm ${
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
                onClick={() => setViewMode("list")}
                className={`inline-flex items-center gap-2 border-l px-3 py-1.5 text-sm ${
                  viewMode === "list"
                    ? "bg-[var(--accent)] text-[var(--foreground)]"
                    : "text-[var(--muted-foreground)]"
                }`}
              >
                <List className="h-4 w-4" />
                List
              </button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <StatBox
              label="Total Cleaners"
              value={summary.totalCleaners}
              tone="text-orange-600"
              onClick={() =>
                drillToMembers({ role: "cleaner", availability: "all" })
              }
            />
            <StatBox
              label="Active Now"
              value={summary.activeNow}
              tone="text-emerald-600"
              onClick={() =>
                drillToMembers({ role: "all", availability: "active" })
              }
            />
            <StatBox
              label="On-Time Avg"
              value={
                summary.avgOnTime === null ? "—" : `${summary.avgOnTime}%`
              }
              onClick={() =>
                drillToMembers({ role: "cleaner", availability: "all" })
              }
            />
            <StatBox
              label="Avg Quality"
              value={summary.avgQuality === null ? "—" : `${summary.avgQuality}/5`}
              onClick={() => scrollToSection("team-leaderboard-section")}
            />
          </div>

          <div id="team-members-section">
            {loading ? (
            <div className="flex min-h-48 items-center justify-center rounded-none border bg-[var(--card)] text-sm text-[var(--muted-foreground)]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading team...
            </div>
          ) : members.length === 0 ? (
            <div className="rounded-none border bg-[var(--card)] p-6 text-sm text-[var(--muted-foreground)]">
              No team members match your filters.
            </div>
          ) : viewMode === "card" ? (
            <div className="grid gap-6 md:grid-cols-2">
              {members.map((member) => (
                <article key={member._id} className="rounded-none border bg-[var(--card)] p-6">
                  <div className="mb-6 flex items-start justify-between">
                    <div className="flex min-w-0 items-center gap-4">
                      <ProfileImage
                        avatarUrl={member.avatarUrl}
                        label={member.name || member.email || "Member"}
                        className="h-16 w-16"
                      />
                      <div className="min-w-0">
                        <p className="overflow-hidden text-xl font-semibold leading-tight text-ellipsis whitespace-nowrap">
                          {member.name || member.email || "Unknown"}
                        </p>
                        <p
                          className={`mt-1 text-xs font-semibold uppercase tracking-wider ${
                            member.availability === "working"
                              ? "text-emerald-600"
                              : member.availability === "available"
                                ? "text-orange-600"
                                : "text-slate-500"
                          }`}
                        >
                          {member.availability}
                        </p>
                        <p className="mt-1 text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">
                          {formatRoleLabel(member.role)}
                        </p>
                        <p className="mt-1 truncate text-xs text-[var(--muted-foreground)]">
                          {member.companyName
                            ? `${member.companyName}${
                                member.companyMemberRole
                                  ? ` · ${formatCompanyRoleLabel(member.companyMemberRole)}`
                                  : ""
                              }`
                            : "No company assigned"}
                        </p>
                      </div>
                    </div>
                    {canManageTeam ? (
                      <div className="relative" data-team-member-menu>
                        <button
                          className="text-2xl leading-none"
                          onClick={() =>
                            setOpenMenuForUserId((current) =>
                              current === member._id ? null : member._id,
                            )
                          }
                          aria-haspopup="menu"
                          aria-expanded={openMenuForUserId === member._id}
                        >
                          ⋮
                        </button>
                        {openMenuForUserId === member._id ? (
                          <div className="absolute right-0 top-8 z-20 w-44 rounded-none border bg-[var(--card)] py-1 shadow-lg">
                            <button
                              type="button"
                              className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--accent)]"
                              onClick={() =>
                                openRoleEditor({
                                  userId: member._id,
                                  name: member.name,
                                  email: member.email,
                                  role: member.role,
                                  companyId: member.companyId,
                                  companyMemberRole: member.companyMemberRole,
                                })
                              }
                            >
                              Assign Role
                            </button>
                            <button
                              type="button"
                              className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--accent)]"
                              onClick={() =>
                                openCompanyEditor({
                                  userId: member._id,
                                  name: member.name,
                                  email: member.email,
                                  role: member.role,
                                  companyId: member.companyId,
                                  companyMemberRole: member.companyMemberRole,
                                })
                              }
                            >
                              Assign Company
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-end justify-between text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                      <span>Quality Score</span>
                      <span className="text-lg text-[var(--foreground)]">
                        {formatQualityScore(member.qualityScore)}
                      </span>
                    </div>
                    <div className="h-2 border border-[var(--border)] bg-[var(--accent)]">
                      <div
                        className={`h-full ${
                          typeof member.qualityScore === "number" && member.qualityScore >= 4.8
                            ? "bg-emerald-500"
                            : "bg-orange-500"
                        }`}
                        style={{
                          width: `${qualityProgressWidth(member.qualityScore)}%`,
                        }}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-2">
                      <MiniMetric
                        label="Avg Duration"
                        value={formatDurationMinutes(member.avgDurationMinutes)}
                      />
                      <MiniMetric
                        label="On-Time %"
                        value={formatPercent(member.onTimePct)}
                      />
                    </div>

                    <div className="pt-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                        Current Assignments
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {member.activeAssignmentsCount > 0 ? (
                          <span className="rounded-none border border-orange-500/30 bg-orange-500/10 px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-orange-400">
                            {member.activeAssignmentsCount} Active
                          </span>
                        ) : (
                          <span className="text-sm italic text-[var(--muted-foreground)]">
                            No active properties
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-none border bg-[var(--card)]">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-[var(--accent)] text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Member</th>
                    <th className="px-4 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Quality</th>
                    <th className="px-4 py-3 font-medium">On-Time</th>
                    <th className="px-4 py-3 font-medium">Assignments</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member._id} className="border-t">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <ProfileImage
                            avatarUrl={member.avatarUrl}
                            label={member.name || member.email || "Member"}
                            className="h-10 w-10"
                          />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-[var(--foreground)]">
                              {member.name || member.email || "Unknown"}
                            </p>
                            <p className="truncate text-xs text-[var(--muted-foreground)]">{member.email || "—"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[var(--muted-foreground)]">
                        {formatRoleLabel(member.role)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs font-semibold uppercase tracking-wider ${
                            member.availability === "working"
                              ? "text-emerald-600"
                              : member.availability === "available"
                                ? "text-orange-600"
                                : "text-slate-500"
                          }`}
                        >
                          {member.availability}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold">
                        {formatQualityScore(member.qualityScore)}
                      </td>
                      <td className="px-4 py-3">{formatPercent(member.onTimePct)}</td>
                      <td className="px-4 py-3">
                        {member.activeAssignmentsCount > 0 ? (
                          <span className="rounded-none border border-orange-500/30 bg-orange-500/10 px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-orange-400">
                            {member.activeAssignmentsCount} Active
                          </span>
                        ) : (
                          <span className="text-[var(--muted-foreground)]">None</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </div>
        </div>

        <aside className="xl:col-span-4 space-y-6">
          <section id="team-leaderboard-section" className="rounded-none border bg-[var(--card)]">
            <div className="border-b border-[var(--border)] p-6">
              <div className="flex items-center gap-3">
                <Award className="h-6 w-6 text-orange-500" />
                <div>
                  <h2 className="text-base font-semibold leading-none tracking-tight">Cleaner Leaderboard</h2>
                  <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">This Month</p>
                </div>
              </div>
            </div>
            <div className="space-y-4 p-6">
              {leaderboard.map((member, index) => (
                <div key={member._id} className="flex items-center gap-3">
                  <span className="w-5 text-xl font-black text-orange-500">{index + 1}</span>
                  <ProfileImage
                    avatarUrl={member.avatarUrl}
                    label={member.name || member.email || "Member"}
                    className="h-11 w-11"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{member.name || member.email || "Unknown"}</p>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                      {member.completedJobsCount} completions
                    </p>
                  </div>
                  <span className="text-2xl font-semibold text-emerald-500">{member.score}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold uppercase tracking-tight">Shift Intelligence</h2>
            <div className="rounded-none border bg-[var(--card)] p-6">
              <div className="flex gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-none border border-orange-500/30 bg-orange-500/10">
                  <TrendingUp className="h-5 w-5 text-orange-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">Operational Snapshot</h3>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    {members.length} team members tracked ·{" "}
                    {summary.avgOnTime === null ? "—" : `${summary.avgOnTime}%`} on-time
                    average · {totalActiveAssignments} active assignments.
                  </p>
                </div>
              </div>
            </div>
          </section>
        </aside>
      </div>

      {isCreateOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border bg-[var(--card)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Add Team Member</h2>
              <button
                className="rounded-md px-2 py-1 text-sm text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
                onClick={() => {
                  setIsCreateOpen(false);
                  setCreateError(null);
                }}
                disabled={isCreating}
              >
                Close
              </button>
            </div>

            <form
              className="space-y-3"
              onSubmit={async (event) => {
                event.preventDefault();
                setIsCreating(true);
                setCreateError(null);
                setCreateSuccess(null);

                try {
                  const response = await fetch("/api/team-members", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(newMember),
                  });

                  const data = (await response.json()) as {
                    success?: boolean;
                    error?: string;
                  };

                  if (!response.ok || !data.success) {
                    throw new Error(data.error || "Failed to create team member.");
                  }

                  setCreateSuccess(
                    `${newMember.fullName} was added successfully in Clerk and Convex.`,
                  );
                  setNewMember({
                    fullName: "",
                    email: "",
                    role: "cleaner",
                    phone: "",
                  });
                  setIsCreateOpen(false);
                } catch (error) {
                  setCreateError(
                    error instanceof Error
                      ? error.message
                      : "Failed to create team member.",
                  );
                } finally {
                  setIsCreating(false);
                }
              }}
            >
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--muted-foreground)]">Full name</span>
                <input
                  required
                  value={newMember.fullName}
                  onChange={(event) =>
                    setNewMember((prev) => ({ ...prev, fullName: event.target.value }))
                  }
                  className="w-full rounded-md border bg-transparent px-3 py-2"
                />
              </label>

              <label className="block text-sm">
                <span className="mb-1 block text-[var(--muted-foreground)]">Email</span>
                <input
                  required
                  type="email"
                  value={newMember.email}
                  onChange={(event) =>
                    setNewMember((prev) => ({ ...prev, email: event.target.value }))
                  }
                  className="w-full rounded-md border bg-transparent px-3 py-2"
                />
              </label>

              <label className="block text-sm">
                <span className="mb-1 block text-[var(--muted-foreground)]">Role</span>
                <select
                  value={newMember.role}
                  onChange={(event) =>
                    setNewMember((prev) => ({
                      ...prev,
                      role: event.target.value as UserRole,
                    }))
                  }
                  className="w-full rounded-md border bg-transparent px-3 py-2"
                >
                  <option value="cleaner">Cleaner</option>
                  <option value="manager">Manager</option>
                  <option value="property_ops">Property Ops</option>
                  <option value="admin">Admin</option>
                </select>
              </label>

              <label className="block text-sm">
                <span className="mb-1 block text-[var(--muted-foreground)]">Phone (optional)</span>
                <input
                  value={newMember.phone}
                  onChange={(event) =>
                    setNewMember((prev) => ({ ...prev, phone: event.target.value }))
                  }
                  className="w-full rounded-md border bg-transparent px-3 py-2"
                />
              </label>

              {createError ? (
                <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {createError}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={isCreating}
                className="w-full rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-black disabled:opacity-60"
              >
                {isCreating ? "Creating..." : "Create Member"}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {roleEditor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border bg-[var(--card)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Assign Role</h2>
              <button
                className="rounded-md px-2 py-1 text-sm text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
                onClick={() => setRoleEditor(null)}
                disabled={isUpdatingRole}
              >
                Close
              </button>
            </div>

            <p className="mb-3 text-sm text-[var(--muted-foreground)]">
              {roleEditor.name || roleEditor.email || "Selected user"}
            </p>

            <form className="space-y-3" onSubmit={handleRoleUpdate}>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--muted-foreground)]">Role</span>
                <select
                  value={roleDraft}
                  onChange={(event) => setRoleDraft(event.target.value as UserRole)}
                  className="w-full rounded-md border bg-transparent px-3 py-2"
                >
                  <option value="cleaner">Cleaner</option>
                  <option value="manager">Manager</option>
                  <option value="property_ops">Property Ops</option>
                  <option value="admin">Admin</option>
                </select>
              </label>

              <button
                type="submit"
                disabled={isUpdatingRole}
                className="w-full rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-black disabled:opacity-60"
              >
                {isUpdatingRole ? "Saving..." : "Save Role"}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {companyEditor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border bg-[var(--card)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Assign Company</h2>
              <button
                className="rounded-md px-2 py-1 text-sm text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
                onClick={() => setCompanyEditor(null)}
                disabled={isUpdatingCompany}
              >
                Close
              </button>
            </div>

            <p className="mb-3 text-sm text-[var(--muted-foreground)]">
              {companyEditor.name || companyEditor.email || "Selected user"}
            </p>

            <form className="space-y-3" onSubmit={handleCompanyAssignment}>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--muted-foreground)]">Company</span>
                <select
                  value={companyDraft}
                  onChange={(event) =>
                    setCompanyDraft(event.target.value as Id<"cleaningCompanies"> | "")
                  }
                  className="w-full rounded-md border bg-transparent px-3 py-2"
                >
                  <option value="">No Company</option>
                  {(companies ?? []).map((company) => (
                    <option key={company._id} value={company._id}>
                      {company.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm">
                <span className="mb-1 block text-[var(--muted-foreground)]">Company role</span>
                <select
                  value={companyRoleDraft}
                  onChange={(event) =>
                    setCompanyRoleDraft(event.target.value as CompanyMemberRole)
                  }
                  className="w-full rounded-md border bg-transparent px-3 py-2"
                  disabled={companyDraft === ""}
                >
                  <option value="cleaner">Cleaner</option>
                  <option value="manager">Manager</option>
                  <option value="owner">Owner</option>
                </select>
              </label>

              <button
                type="submit"
                disabled={isUpdatingCompany}
                className="w-full rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-black disabled:opacity-60"
              >
                {isUpdatingCompany ? "Saving..." : "Save Company Assignment"}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatBox({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: string | number;
  tone?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">{label}</p>
      <p className={`mt-2 text-3xl font-semibold ${tone ?? "text-[var(--foreground)]"}`}>{value}</p>
      {onClick ? (
        <p className="mt-3 text-xs font-semibold text-[var(--primary)] opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
          View details
        </p>
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="group rounded-none border bg-[var(--card)] p-4 text-left transition hover:border-[var(--primary)]/40 hover:bg-[var(--accent)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="rounded-none border bg-[var(--card)] p-4">
      {content}
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-none border bg-[var(--accent)] p-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function formatQualityScore(value: number | null): string {
  if (typeof value !== "number") {
    return "—";
  }
  return value.toFixed(2);
}

function qualityProgressWidth(value: number | null): number {
  if (typeof value !== "number") {
    return 0;
  }
  return Math.min(100, Math.round((value / 5) * 100));
}

function formatPercent(value: number | null): string {
  if (typeof value !== "number") {
    return "—";
  }
  return `${value}%`;
}

function formatDurationMinutes(value: number | null): string {
  if (typeof value !== "number" || value <= 0) {
    return "—";
  }

  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (hours === 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
}

function ProfileImage({
  avatarUrl,
  label,
  className,
}: {
  avatarUrl?: string;
  label: string;
  className: string;
}) {
  const initial = label.trim().charAt(0).toUpperCase() || "U";

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={label}
        className={`${className} rounded-none border object-cover`}
      />
    );
  }

  return (
    <div
      aria-label={label}
      className={`${className} flex items-center justify-center rounded-none border bg-[var(--accent)] text-lg font-bold text-[var(--muted-foreground)]`}
    >
      {initial}
    </div>
  );
}

function formatRoleLabel(role: UserRole): string {
  switch (role) {
    case "property_ops":
      return "Property Ops";
    case "admin":
      return "Admin";
    case "manager":
      return "Manager";
    case "cleaner":
    default:
      return "Cleaner";
  }
}

function formatCompanyRoleLabel(role: CompanyMemberRole): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "manager":
      return "Manager";
    case "cleaner":
    default:
      return "Cleaner";
  }
}
