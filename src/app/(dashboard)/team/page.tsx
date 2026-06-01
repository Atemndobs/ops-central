"use client";

import { type ChangeEvent, type FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useAuth, useUser } from "@clerk/nextjs";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import Image from "next/image";
import { useToast } from "@/components/ui/toast-provider";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { TeamDetailDrawer, type DrawerMember } from "@/components/team/team-detail-drawer";
import { uploadImageFile } from "@/lib/upload-image";
import {
  getRoleFromMetadata,
  getRoleFromSessionClaimsOrNull,
} from "@/lib/auth";
import {
  Award,
  Download,
  Filter,
  LayoutGrid,
  List,
  Loader2,
  Plus,
  Search,
  TrendingUp,
  Users,
} from "lucide-react";

type UserRole = "cleaner" | "manager" | "property_ops" | "admin" | "owner";
type CompanyMemberRole = "cleaner" | "manager" | "owner";
type AvailabilityFilter = "all" | "active" | "working" | "available" | "off";
type TeamViewMode = "card" | "list";
type MobileFilterPanel = "search" | "role" | "status" | null;

// Items for the role-assignment SearchableSelect (Add Member + Edit Member).
// Order mirrors the legacy <select> for muscle memory: cleaner → owner.
const ROLE_ASSIGN_ITEMS: { id: UserRole; label: string }[] = [
  { id: "cleaner", label: "Cleaner" },
  { id: "manager", label: "Manager" },
  { id: "property_ops", label: "Property Ops" },
  { id: "admin", label: "Admin" },
  { id: "owner", label: "Owner" },
];

// Items for the role-filter SearchableSelect (mobile + desktop). The "all"
// affordance is the SearchableSelect's `clearable` clear button — when the
// selection is cleared, we map back to "all" in onChange.
const ROLE_FILTER_ITEMS: { id: UserRole; label: string }[] = [
  { id: "admin", label: "Admin" },
  { id: "cleaner", label: "Cleaner" },
  { id: "manager", label: "Manager" },
  { id: "property_ops", label: "Property Ops" },
  { id: "owner", label: "Owner" },
];

const TEAM_VIEW_MODE_STORAGE_KEY = "opscentral.team.defaultViewMode";
const TEAM_DENSITY_STORAGE_KEY = "opscentral.team.density";
const TEAM_GROUP_BY_STORAGE_KEY = "opscentral.team.groupBy";
const TEAM_FILTER_CHIP_KEY = "opscentral.team.filterChip";
type FilterChip = "none" | "unassignedRole" | "unassignedCompany" | "inactive30d";
const TEAM_RAIL_OPEN_STORAGE_KEY = "opscentral.team.railOpen";

type TeamDensity = "comfortable" | "compact";
type TeamGroupBy = "none" | "company";

type MemberActionTarget = {
  userId: Id<"users">;
  name?: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
  role: UserRole;
  companyId: Id<"cleaningCompanies"> | null;
  companyName?: string | null;
  companyMemberRole: CompanyMemberRole | null;
};

export default function TeamPage() {
  const { showToast } = useToast();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | UserRole>("all");
  const [availabilityFilter, setAvailabilityFilter] =
    useState<AvailabilityFilter>("all");
  const [viewMode, setViewMode] = useState<TeamViewMode>("list");
  const [density, setDensity] = useState<TeamDensity>("compact");
  const [groupBy, setGroupBy] = useState<TeamGroupBy>("none");
  const [railOpen, setRailOpen] = useState<boolean>(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [filterChip, setFilterChip] = useState<FilterChip>("none");
  const [mobileFilterPanel, setMobileFilterPanel] = useState<MobileFilterPanel>(null);
  const [openMenuForUserId, setOpenMenuForUserId] = useState<Id<"users"> | null>(
    null,
  );

  const [roleEditor, setRoleEditor] = useState<MemberActionTarget | null>(null);
  const [roleDraft, setRoleDraft] = useState<UserRole>("cleaner");
  const [isUpdatingRole, setIsUpdatingRole] = useState(false);
  const [profileEditor, setProfileEditor] = useState<MemberActionTarget | null>(null);
  const [profileDraft, setProfileDraft] = useState({
    name: "",
    phone: "",
    avatarUrl: "",
  });
  const [isUploadingProfileAvatar, setIsUploadingProfileAvatar] = useState(false);
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

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
  const [memberActionSheet, setMemberActionSheet] = useState<MemberActionTarget | null>(
    null,
  );
  const [jobEditor, setJobEditor] = useState<MemberActionTarget | null>(null);
  const [jobDraft, setJobDraft] = useState<Id<"cleaningJobs"> | "">("");
  const [isAssigningJob, setIsAssigningJob] = useState(false);
  const [propertyEditor, setPropertyEditor] = useState<MemberActionTarget | null>(null);
  const [propertyDraft, setPropertyDraft] = useState<Id<"properties"> | "">("");
  const [isAssigningProperty, setIsAssigningProperty] = useState(false);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isImportingHospitable, setIsImportingHospitable] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [newMember, setNewMember] = useState({
    fullName: "",
    email: "",
    role: "cleaner" as UserRole,
    phone: "",
    companyId: "" as string,
  });

  const { isLoaded: isClerkLoaded, isSignedIn, sessionClaims, userId } = useAuth();
  const { user } = useUser();
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const convexUser = useQuery(
    api.users.queries.getByClerkId,
    isAuthenticated && isClerkLoaded && isSignedIn && userId
      ? { clerkId: userId }
      : "skip",
  );
  const roleFromClaims = getRoleFromSessionClaimsOrNull(
    (sessionClaims as Record<string, unknown> | null | undefined) ?? null,
  );
  const roleFromMetadata = getRoleFromMetadata(user?.publicMetadata);
  const currentRole = roleFromClaims ?? roleFromMetadata ?? convexUser?.role ?? "manager";
  const canManageTeam = currentRole === "admin";
  const canDispatchCleaners =
    currentRole === "admin" ||
    currentRole === "property_ops" ||
    currentRole === "manager";
  const teamMetrics = useQuery(
    api.admin.queries.getTeamMetrics,
    isAuthenticated ? {} : "skip",
  );
  const companies = useQuery(
    api.admin.queries.getCompanies,
    isAuthenticated ? {} : "skip",
  );
  const allProperties = useQuery(
    api.properties.queries.getAll,
    isAuthenticated ? { limit: 500 } : "skip",
  );
  // Wave 3.b — only active-status jobs are ever rendered (assign-job
  // dropdown filters on these four statuses). Use the thin `getAssignable`
  // query instead of `getAll({ limit: 1000 })` to skip enrichment for
  // terminal-state jobs the UI never shows.
  const allJobs = useQuery(
    api.cleaningJobs.queries.getAssignable,
    isAuthenticated ? {} : "skip",
  );
  const assignUserCompanyMembership = useMutation(
    api.admin.mutations.assignUserCompanyMembership,
  );
  const updateUser = useMutation(api.admin.mutations.updateUser);
  const assignCleanerToJob = useMutation(api.cleaningJobs.mutations.assign);
  const assignPropertyToCompany = useMutation(api.admin.mutations.assignPropertyToCompany);

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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const storedViewMode = window.localStorage.getItem(
      TEAM_VIEW_MODE_STORAGE_KEY,
    ) as TeamViewMode | null;
    if (storedViewMode === "card" || storedViewMode === "list") {
      setViewMode(storedViewMode);
      return;
    }
    const mobileDefault: TeamViewMode = window.matchMedia("(max-width: 767px)").matches
      ? "list"
      : "card";
    setViewMode(mobileDefault);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const d = window.localStorage.getItem(TEAM_DENSITY_STORAGE_KEY) as TeamDensity | null;
    if (d === "compact" || d === "comfortable") setDensity(d);
    const g = window.localStorage.getItem(TEAM_GROUP_BY_STORAGE_KEY) as TeamGroupBy | null;
    if (g === "company" || g === "none") setGroupBy(g);
    const r = window.localStorage.getItem(TEAM_RAIL_OPEN_STORAGE_KEY);
    if (r === "true") setRailOpen(true);
    const f = window.localStorage.getItem(TEAM_FILTER_CHIP_KEY) as FilterChip | null;
    if (
      f === "unassignedRole" ||
      f === "unassignedCompany" ||
      f === "inactive30d" ||
      f === "none"
    )
      setFilterChip(f);
  }, []);

  function setFilterChipPreference(next: FilterChip) {
    setFilterChip(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TEAM_FILTER_CHIP_KEY, next);
    }
  }

  function setViewPreference(nextMode: TeamViewMode) {
    setViewMode(nextMode);
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(TEAM_VIEW_MODE_STORAGE_KEY, nextMode);
  }

  function setDensityPreference(next: TeamDensity) {
    setDensity(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TEAM_DENSITY_STORAGE_KEY, next);
    }
  }

  function setGroupByPreference(next: TeamGroupBy) {
    setGroupBy(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TEAM_GROUP_BY_STORAGE_KEY, next);
    }
  }

  function toggleRail() {
    setRailOpen((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(TEAM_RAIL_OPEN_STORAGE_KEY, String(next));
      }
      return next;
    });
  }

  function toggleGroupCollapsed(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const members = useMemo(() => {
    const combined = [...(teamMetrics?.members ?? [])];
    const q = search.trim().toLowerCase();

    const inactiveCutoff = Date.now() - 30 * 86_400_000;
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
      const chipMatches = (() => {
        if (filterChip === "none") return true;
        if (filterChip === "unassignedRole")
          return !member.role || (member.role as string) === "unassigned";
        if (filterChip === "unassignedCompany") return !member.companyId;
        if (filterChip === "inactive30d") {
          const last = (member as { lastActiveAt?: number }).lastActiveAt;
          return !last || last < inactiveCutoff;
        }
        return true;
      })();
      return roleMatches && availabilityMatches && textMatches && chipMatches;
    });

    return filtered;
  }, [availabilityFilter, roleFilter, search, teamMetrics, filterChip]);

  const chipCounts = useMemo(() => {
    const all = teamMetrics?.members ?? [];
    const inactiveCutoff = Date.now() - 30 * 86_400_000;
    return {
      unassignedRole: all.filter(
        (m) => !m.role || (m.role as string) === "unassigned",
      ).length,
      unassignedCompany: all.filter((m) => !m.companyId).length,
      inactive30d: all.filter((m) => {
        const last = (m as { lastActiveAt?: number }).lastActiveAt;
        return !last || last < inactiveCutoff;
      }).length,
    };
  }, [teamMetrics]);

  const groupedMembers = useMemo(() => {
    if (groupBy !== "company") return null;
    const groups = new Map<
      string,
      { key: string; label: string; companyId: string | null; rows: typeof members }
    >();
    for (const m of members) {
      const cid = (m.companyId as string | null | undefined) ?? null;
      const key = cid ?? "__unassigned__";
      const label =
        m.companyName ?? (cid ? "Unknown company" : "Unassigned");
      const existing = groups.get(key);
      if (existing) {
        existing.rows.push(m);
      } else {
        groups.set(key, { key, label, companyId: cid, rows: [m] });
      }
    }
    // Sort: Unassigned first, then alphabetical
    return Array.from(groups.values()).sort((a, b) => {
      if (a.key === "__unassigned__") return -1;
      if (b.key === "__unassigned__") return 1;
      return a.label.localeCompare(b.label);
    });
  }, [groupBy, members]);

  const assignableJobs = useMemo(
    () =>
      (allJobs ?? [])
        .filter((job) =>
          ["scheduled", "assigned", "in_progress", "rework_required"].includes(
            job.status,
          ),
        )
        .sort((a, b) => (a.scheduledStartAt ?? 0) - (b.scheduledStartAt ?? 0)),
    [allJobs],
  );

  function toMemberActionTarget(member: (typeof members)[number]): MemberActionTarget {
    return {
      userId: member._id,
      name: member.name,
      email: member.email,
      phone: member.phone,
      avatarUrl: member.avatarUrl,
      role: member.role,
      companyId: member.companyId,
      companyName: member.companyName,
      companyMemberRole: member.companyMemberRole,
    };
  }

  function canDispatchMember(member: { role: UserRole }) {
    return canDispatchCleaners && (member.role === "cleaner" || member.role === "manager");
  }

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

  const companyMembershipRows = useMemo(() => {
    return [...(teamMetrics?.members ?? [])]
      .filter((member) => member.role === "cleaner" || member.role === "manager")
      .sort((a, b) => {
        const companyRank =
          Number(Boolean(a.companyId)) - Number(Boolean(b.companyId));
        if (companyRank !== 0) {
          return companyRank;
        }
        const nameA = (a.name?.trim() || a.email || "").toLowerCase();
        const nameB = (b.name?.trim() || b.email || "").toLowerCase();
        return nameA.localeCompare(nameB);
      });
  }, [teamMetrics]);

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
    setMemberActionSheet(null);
    setOpenMenuForUserId(null);
  }

  function openProfileEditor(member: MemberActionTarget) {
    setProfileEditor(member);
    setProfileDraft({
      name: member.name ?? "",
      phone: member.phone ?? "",
      avatarUrl: member.avatarUrl ?? "",
    });
    setMemberActionSheet(null);
    setOpenMenuForUserId(null);
  }

  function openCompanyEditor(member: MemberActionTarget) {
    setCompanyEditor(member);
    setCompanyDraft(member.companyId ?? "");
    setCompanyRoleDraft(
      member.companyMemberRole ??
        (member.role === "manager" ? "manager" : "cleaner"),
    );
    setMemberActionSheet(null);
    setOpenMenuForUserId(null);
  }

  function openJobEditor(member: MemberActionTarget) {
    setJobEditor(member);
    setJobDraft("");
    setMemberActionSheet(null);
    setOpenMenuForUserId(null);
  }

  function openPropertyEditor(member: MemberActionTarget) {
    setPropertyEditor(member);
    setPropertyDraft("");
    setMemberActionSheet(null);
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

  async function handleProfileAvatarSelected(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    setIsUploadingProfileAvatar(true);
    try {
      const avatarUrl = await uploadImageFile(file);
      setProfileDraft((current) => ({ ...current, avatarUrl }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to upload profile photo.";
      showToast(message, "error");
    } finally {
      setIsUploadingProfileAvatar(false);
    }
  }

  async function handleProfileUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profileEditor) {
      return;
    }

    const normalizedName = profileDraft.name.trim();
    if (normalizedName.length < 2) {
      showToast("Enter a valid name before saving.", "error");
      return;
    }

    setIsUpdatingProfile(true);
    try {
      await updateUser({
        id: profileEditor.userId,
        name: normalizedName,
        phone: profileDraft.phone,
        avatarUrl: profileDraft.avatarUrl || undefined,
      });
      showToast("Profile updated successfully.");
      setProfileEditor(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update profile.";
      showToast(message, "error");
    } finally {
      setIsUpdatingProfile(false);
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

  async function handleJobAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!jobEditor) {
      return;
    }
    if (!jobDraft) {
      showToast("Select a job to assign.", "error");
      return;
    }

    setIsAssigningJob(true);
    try {
      await assignCleanerToJob({
        jobId: jobDraft,
        cleanerIds: [jobEditor.userId],
        notifyCleaners: false,
      });
      showToast("User assigned to job.");
      setJobEditor(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to assign user to job.";
      showToast(message, "error");
    } finally {
      setIsAssigningJob(false);
    }
  }

  async function handlePropertyAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!propertyEditor) {
      return;
    }
    if (!propertyEditor.companyId) {
      showToast("Assign a company to this user first.", "error");
      return;
    }
    if (!propertyDraft) {
      showToast("Select a property to assign.", "error");
      return;
    }

    setIsAssigningProperty(true);
    try {
      await assignPropertyToCompany({
        propertyId: propertyDraft,
        companyId: propertyEditor.companyId,
        reason: "Assigned from team list view.",
      });
      showToast("Property assigned to member company.");
      setPropertyEditor(null);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to assign property to member company.";
      showToast(message, "error");
    } finally {
      setIsAssigningProperty(false);
    }
  }

  async function handleHospitableImport() {
    setCreateError(null);
    setCreateSuccess(null);
    setIsImportingHospitable(true);
    try {
      const response = await fetch("/api/team-members/hospitable-import", {
        method: "POST",
      });
      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        message?: string;
        summary?: {
          processed: number;
          createdInClerk: number;
          updatedInClerk: number;
          createdInConvex: number;
          updatedInConvex: number;
          skippedMissingEmail: number;
          errors: string[];
        };
      };

      if (!response.ok) {
        throw new Error(data.error || "Failed to import teammates from Hospitable.");
      }

      const summary = data.summary;
      if (!summary) {
        showToast(data.message || "Import completed.");
        return;
      }

      const hasErrors = summary.errors.length > 0;
      const outcome = hasErrors ? "partial" : "success";
      const message =
        `Hospitable import ${outcome}: ${summary.processed} processed, ` +
        `${summary.createdInClerk} new Clerk, ${summary.updatedInClerk} existing Clerk, ` +
        `${summary.createdInConvex} new app users, ${summary.updatedInConvex} updated app users.` +
        (summary.skippedMissingEmail > 0
          ? ` Skipped ${summary.skippedMissingEmail} without email.`
          : "");

      setCreateSuccess(message);
      showToast(message, hasErrors ? "error" : "success");
      if (hasErrors) {
        setCreateError(
          `Some teammates could not be imported (${summary.errors.length}). Check server logs for full details.`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to import teammates from Hospitable.";
      setCreateError(message);
      showToast(message, "error");
    } finally {
      setIsImportingHospitable(false);
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
    <div className="min-w-0 space-y-4 overflow-x-hidden md:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight text-[var(--foreground)] md:text-display">
            Team Management
          </h1>
          <p className="mt-2 hidden text-[var(--muted-foreground)] md:block">
            Monitor performance and manage cleaner assignments.
          </p>
        </div>
        {canManageTeam ? (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <button
              onClick={handleHospitableImport}
              disabled={isImportingHospitable}
              className="inline-flex w-full items-center justify-center gap-2 rounded-none border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--accent)] disabled:opacity-60 sm:w-auto sm:px-4"
            >
              {isImportingHospitable ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Import from Hospitable
            </button>
            <button
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-none bg-[var(--primary)] px-3 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 sm:w-auto sm:px-4"
            >
              <Plus className="h-4 w-4" />
              Add Team Member
            </button>
          </div>
        ) : null}
      </div>

      {createSuccess ? (
        <div className="border-2 border-emerald-600 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {createSuccess}
        </div>
      ) : null}

      <div className="grid gap-8 xl:grid-cols-12">
        <div className="xl:col-span-8 space-y-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="space-y-2 md:hidden">
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  className={`inline-flex items-center justify-center rounded-none border p-2 ${
                    mobileFilterPanel === "search"
                      ? "bg-[var(--accent)] text-[var(--foreground)]"
                      : "bg-[var(--card)] text-[var(--muted-foreground)]"
                  }`}
                  onClick={() =>
                    setMobileFilterPanel((current) =>
                      current === "search" ? null : "search",
                    )
                  }
                  aria-label="Open search"
                >
                  <Search className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className={`inline-flex items-center justify-center rounded-none border p-2 ${
                    mobileFilterPanel === "role"
                      ? "bg-[var(--accent)] text-[var(--foreground)]"
                      : "bg-[var(--card)] text-[var(--muted-foreground)]"
                  }`}
                  onClick={() =>
                    setMobileFilterPanel((current) =>
                      current === "role" ? null : "role",
                    )
                  }
                  aria-label="Open role filter"
                >
                  <Users className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className={`inline-flex items-center justify-center rounded-none border p-2 ${
                    mobileFilterPanel === "status"
                      ? "bg-[var(--accent)] text-[var(--foreground)]"
                      : "bg-[var(--card)] text-[var(--muted-foreground)]"
                  }`}
                  onClick={() =>
                    setMobileFilterPanel((current) =>
                      current === "status" ? null : "status",
                    )
                  }
                  aria-label="Open status filter"
                >
                  <Filter className="h-4 w-4" />
                </button>
              </div>
              {mobileFilterPanel === "search" ? (
                <div className="flex items-center gap-2 rounded-none border bg-[var(--card)] px-3 py-1.5">
                  <Search className="h-4 w-4 text-[var(--muted-foreground)]" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search team"
                    autoFocus
                    className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
                  />
                </div>
              ) : null}
              {mobileFilterPanel === "role" ? (
                <SearchableSelect
                  value={roleFilter === "all" ? null : roleFilter}
                  onChange={(id) => {
                    setRoleFilter((id ?? "all") as typeof roleFilter);
                    setMobileFilterPanel(null);
                  }}
                  items={ROLE_FILTER_ITEMS}
                  placeholder="All Roles"
                  searchPlaceholder="Search roles…"
                  aria-label="Filter team by role"
                  clearable
                />
              ) : null}
              {mobileFilterPanel === "status" ? (
                <select
                  value={availabilityFilter}
                  onChange={(event) => {
                    setAvailabilityFilter(event.target.value as AvailabilityFilter);
                    setMobileFilterPanel(null);
                  }}
                  className="w-full min-w-0 rounded-none border bg-[var(--card)] px-3 py-1.5 text-sm outline-none"
                >
                  <option value="all">All Statuses</option>
                  <option value="active">Active Now</option>
                  <option value="working">Working</option>
                  <option value="available">Available</option>
                  <option value="off">Off</option>
                </select>
              ) : null}
            </div>
            <div className="hidden min-w-0 grid-cols-1 gap-2 md:flex md:flex-wrap md:items-center">
              <div className="flex items-center gap-2 rounded-none border bg-[var(--card)] px-3 py-1.5">
                <Search className="h-4 w-4 text-[var(--muted-foreground)]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search team"
                  className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)] md:w-44"
                />
              </div>
              <div className="w-full min-w-0 md:w-44">
                <SearchableSelect
                  value={roleFilter === "all" ? null : roleFilter}
                  onChange={(id) =>
                    setRoleFilter((id ?? "all") as typeof roleFilter)
                  }
                  items={ROLE_FILTER_ITEMS}
                  placeholder="All Roles"
                  searchPlaceholder="Search roles…"
                  aria-label="Filter team by role"
                  clearable
                />
              </div>
              <select
                value={availabilityFilter}
                onChange={(event) =>
                  setAvailabilityFilter(event.target.value as AvailabilityFilter)
                }
                className="w-full min-w-0 rounded-none border bg-[var(--card)] px-3 py-1.5 text-sm outline-none md:w-auto"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active Now</option>
                <option value="working">Working</option>
                <option value="available">Available</option>
                <option value="off">Off</option>
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
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
              {viewMode === "list" ? (
                <div className="inline-flex overflow-hidden rounded-none border bg-[var(--card)]">
                  <button
                    type="button"
                    onClick={() => setDensityPreference("comfortable")}
                    className={`px-3 py-1.5 text-xs ${
                      density === "comfortable"
                        ? "bg-[var(--accent)] text-[var(--foreground)]"
                        : "text-[var(--muted-foreground)]"
                    }`}
                    aria-pressed={density === "comfortable"}
                    title="Comfortable rows"
                  >
                    Comfortable
                  </button>
                  <button
                    type="button"
                    onClick={() => setDensityPreference("compact")}
                    className={`border-l px-3 py-1.5 text-xs ${
                      density === "compact"
                        ? "bg-[var(--accent)] text-[var(--foreground)]"
                        : "text-[var(--muted-foreground)]"
                    }`}
                    aria-pressed={density === "compact"}
                    title="Compact rows"
                  >
                    Compact
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                onClick={() =>
                  setGroupByPreference(groupBy === "company" ? "none" : "company")
                }
                className={`inline-flex items-center gap-1 rounded-none border px-3 py-1.5 text-xs ${
                  groupBy === "company"
                    ? "bg-[var(--accent)] text-[var(--foreground)]"
                    : "bg-[var(--card)] text-[var(--muted-foreground)]"
                }`}
                aria-pressed={groupBy === "company"}
                title="Group by company"
              >
                Group: {groupBy === "company" ? "Company" : "None"}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 px-3 py-2">
            {(
              [
                { id: "unassignedRole" as const, label: "Unassigned role", count: chipCounts.unassignedRole },
                { id: "unassignedCompany" as const, label: "No company", count: chipCounts.unassignedCompany },
                { id: "inactive30d" as const, label: "Inactive 30d", count: chipCounts.inactive30d },
              ]
            ).map((chip) => {
              const active = filterChip === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setFilterChipPreference(active ? "none" : chip.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
                    active
                      ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]"
                      : "bg-[var(--card)] text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
                  }`}
                  aria-pressed={active}
                >
                  {chip.label}
                  <span className="rounded-full bg-[var(--accent)] px-1.5 text-[10px] font-semibold">
                    {chip.count}
                  </span>
                </button>
              );
            })}
            {filterChip !== "none" ? (
              <button
                type="button"
                onClick={() => setFilterChipPreference("none")}
                className="text-xs text-[var(--muted-foreground)] underline underline-offset-2 hover:text-[var(--foreground)]"
              >
                Clear filter
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-y border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm">
            <StatChip
              label="Cleaners"
              value={summary.totalCleaners}
              tone="text-orange-600"
              onClick={() =>
                drillToMembers({ role: "cleaner", availability: "all" })
              }
            />
            <span className="text-[var(--border)]">·</span>
            <StatChip
              label="Active"
              value={summary.activeNow}
              tone="text-emerald-600"
              onClick={() =>
                drillToMembers({ role: "all", availability: "active" })
              }
            />
            <span className="text-[var(--border)]">·</span>
            <StatChip
              label="On-time"
              value={
                summary.avgOnTime === null ? "—" : `${summary.avgOnTime}%`
              }
              onClick={() =>
                drillToMembers({ role: "cleaner", availability: "all" })
              }
            />
            <span className="text-[var(--border)]">·</span>
            <StatChip
              label="Quality"
              value={summary.avgQuality === null ? "—" : `${summary.avgQuality}/5`}
              onClick={() => scrollToSection("team-leaderboard-section")}
            />
          </div>

          {/* Company Membership management moved to /companies → click a company → Members section. */}

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
                    {canManageTeam || canDispatchMember(member) ? (
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
                            {canManageTeam ? (
                              <>
                                <button
                                  type="button"
                                  className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--accent)]"
                                  onClick={() => openProfileEditor(toMemberActionTarget(member))}
                                >
                                  Edit Profile
                                </button>
                                <button
                                  type="button"
                                  className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--accent)]"
                                  onClick={() => openRoleEditor(toMemberActionTarget(member))}
                                >
                                  Assign Role
                                </button>
                                <button
                                  type="button"
                                  className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--accent)]"
                                  onClick={() => openCompanyEditor(toMemberActionTarget(member))}
                                >
                                  Assign Company
                                </button>
                              </>
                            ) : null}
                            {canDispatchMember(member) ? (
                              <button
                                type="button"
                                className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--accent)]"
                                onClick={() => openJobEditor(toMemberActionTarget(member))}
                              >
                                Dispatch to Job
                              </button>
                            ) : null}
                            {canManageTeam ? (
                              <button
                                type="button"
                                className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--accent)]"
                                onClick={() => openPropertyEditor(toMemberActionTarget(member))}
                              >
                                Assign Property
                              </button>
                            ) : null}
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
            <div className="rounded-none border bg-[var(--card)]">
              <div className="divide-y md:hidden">
                {members.map((member) => (
                  <article key={member._id} className="relative p-3">
                    <div className="flex items-start gap-3">
                      <ProfileImage
                        avatarUrl={member.avatarUrl}
                        label={member.name || member.email || "Member"}
                        className="h-10 w-10"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                          {member.name || member.email || "Unknown"}
                        </p>
                        <p className="mt-0.5 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                          {formatRoleLabel(member.role)} · {member.availability}
                        </p>
                      </div>
                      <div className="relative" data-team-member-menu>
                        <button
                          type="button"
                          className="rounded-md border px-2 py-1 text-sm leading-none"
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
                          <div className="absolute right-0 top-9 z-20 w-64 rounded-none border bg-[var(--card)] p-2 shadow-lg">
                            <div className="space-y-1 border-b pb-2 text-xs text-[var(--muted-foreground)]">
                              <p className="truncate">{member.email || "—"}</p>
                              <p className="truncate">
                                {member.companyName
                                  ? `${member.companyName}${
                                      member.companyMemberRole
                                        ? ` · ${formatCompanyRoleLabel(member.companyMemberRole)}`
                                        : ""
                                    }`
                                  : "No company assigned"}
                              </p>
                              <p>Quality: {formatQualityScore(member.qualityScore)}</p>
                              <p>On-Time: {formatPercent(member.onTimePct)}</p>
                              <p>Assignments: {member.activeAssignmentsCount}</p>
                            </div>
                            {canManageTeam || canDispatchMember(member) ? (
                              <div className="mt-2 grid gap-1">
                                {canManageTeam ? (
                                  <>
                                    <button
                                      type="button"
                                      className="w-full rounded-md border px-2 py-1.5 text-left text-xs hover:bg-[var(--accent)]"
                                      onClick={() => openProfileEditor(toMemberActionTarget(member))}
                                    >
                                      Edit Profile
                                    </button>
                                    <button
                                      type="button"
                                      className="w-full rounded-md border px-2 py-1.5 text-left text-xs hover:bg-[var(--accent)]"
                                      onClick={() => openRoleEditor(toMemberActionTarget(member))}
                                    >
                                      Assign Role
                                    </button>
                                    <button
                                      type="button"
                                      className="w-full rounded-md border px-2 py-1.5 text-left text-xs hover:bg-[var(--accent)]"
                                      onClick={() => openCompanyEditor(toMemberActionTarget(member))}
                                    >
                                      Assign Company
                                    </button>
                                  </>
                                ) : null}
                                {canDispatchMember(member) ? (
                                  <button
                                    type="button"
                                    className="w-full rounded-md border px-2 py-1.5 text-left text-xs hover:bg-[var(--accent)]"
                                    onClick={() => openJobEditor(toMemberActionTarget(member))}
                                  >
                                    Dispatch to Job
                                  </button>
                                ) : null}
                                {canManageTeam ? (
                                  <button
                                    type="button"
                                    className="w-full rounded-md border px-2 py-1.5 text-left text-xs hover:bg-[var(--accent)]"
                                    onClick={() => openPropertyEditor(toMemberActionTarget(member))}
                                  >
                                    Assign Property
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
                {(() => {
                  const isCompact = density === "compact";
                  const cellPad = isCompact ? "px-3 py-1.5" : "px-4 py-3";
                  const headPad = isCompact ? "px-3 py-2" : "px-4 py-3";
                  const avatarCls = isCompact ? "h-7 w-7" : "h-10 w-10";

                  const renderMemberRow = (member: (typeof members)[number]) => (
                    <tr key={member._id} className="border-t hover:bg-[var(--accent)]/40">
                      <td className={cellPad}>
                        {canManageTeam || canDispatchMember(member) ? (
                          <button
                            type="button"
                            onClick={() => setMemberActionSheet(toMemberActionTarget(member))}
                            className="w-full rounded-md p-1 text-left transition hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40"
                          >
                            <div className="flex items-center gap-3">
                              <ProfileImage
                                avatarUrl={member.avatarUrl}
                                label={member.name || member.email || "Member"}
                                className={avatarCls}
                              />
                              <div className="min-w-0">
                                <p className="truncate font-semibold text-[var(--foreground)]">
                                  {member.name || member.email || "Unknown"}
                                </p>
                                {isCompact ? null : (
                                  <p className="truncate text-xs text-[var(--muted-foreground)]">
                                    {member.email || "—"}
                                  </p>
                                )}
                                {isCompact ? null : (
                                  <p className="text-[10px] uppercase tracking-wider text-[var(--primary)]">
                                    {canManageTeam ? "Click to edit or dispatch" : "Click to dispatch"}
                                  </p>
                                )}
                              </div>
                            </div>
                          </button>
                        ) : (
                          <div className="flex items-center gap-3">
                            <ProfileImage
                              avatarUrl={member.avatarUrl}
                              label={member.name || member.email || "Member"}
                              className={avatarCls}
                            />
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-[var(--foreground)]">
                                {member.name || member.email || "Unknown"}
                              </p>
                              {isCompact ? null : (
                                <p className="truncate text-xs text-[var(--muted-foreground)]">
                                  {member.email || "—"}
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                      {isCompact ? (
                        <td className={`${cellPad} truncate text-xs text-[var(--muted-foreground)]`}>
                          {member.email || "—"}
                        </td>
                      ) : null}
                      <td className={`${cellPad} text-[var(--muted-foreground)]`}>
                        {formatRoleLabel(member.role)}
                      </td>
                      {groupBy !== "company" ? (
                        <td className={`${cellPad} truncate text-xs text-[var(--muted-foreground)]`}>
                          {member.companyName ?? "—"}
                        </td>
                      ) : null}
                      <td className={cellPad}>
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
                      <td className={`${cellPad} font-semibold`}>
                        {formatQualityScore(member.qualityScore)}
                      </td>
                      <td className={cellPad}>{formatPercent(member.onTimePct)}</td>
                      <td className={cellPad}>
                        {member.activeAssignmentsCount > 0 ? (
                          <span className="rounded-none border border-orange-500/30 bg-orange-500/10 px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-orange-400">
                            {member.activeAssignmentsCount} Active
                          </span>
                        ) : (
                          <span className="text-[var(--muted-foreground)]">None</span>
                        )}
                      </td>
                    </tr>
                  );

                  const columnsCount =
                    1 /* Member */ +
                    (isCompact ? 1 : 0) /* Email */ +
                    1 /* Role */ +
                    (groupBy !== "company" ? 1 : 0) /* Company */ +
                    1 /* Status */ +
                    1 /* Quality */ +
                    1 /* On-Time */ +
                    1; /* Assignments */

                  return (
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className="bg-[var(--accent)] text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
                        <tr>
                          <th className={`${headPad} font-medium`}>Member</th>
                          {isCompact ? (
                            <th className={`${headPad} font-medium`}>Email</th>
                          ) : null}
                          <th className={`${headPad} font-medium`}>Role</th>
                          {groupBy !== "company" ? (
                            <th className={`${headPad} font-medium`}>Company</th>
                          ) : null}
                          <th className={`${headPad} font-medium`}>Status</th>
                          <th className={`${headPad} font-medium`}>Quality</th>
                          <th className={`${headPad} font-medium`}>On-Time</th>
                          <th className={`${headPad} font-medium`}>Assignments</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupedMembers ? (
                          groupedMembers.map((group) => {
                            const collapsed = collapsedGroups.has(group.key);
                            const isUnassigned = group.key === "__unassigned__";
                            return (
                              <Fragment key={group.key}>
                                <tr className="bg-[var(--accent)]/60">
                                  <td
                                    colSpan={columnsCount}
                                    className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider"
                                  >
                                    <button
                                      type="button"
                                      onClick={() => toggleGroupCollapsed(group.key)}
                                      className="inline-flex items-center gap-2 hover:underline"
                                      aria-expanded={!collapsed}
                                    >
                                      <span className="inline-block w-3 text-center">
                                        {collapsed ? "▸" : "▾"}
                                      </span>
                                      <span
                                        className={
                                          isUnassigned
                                            ? "text-amber-600"
                                            : "text-[var(--foreground)]"
                                        }
                                      >
                                        {group.label}
                                      </span>
                                      <span className="text-[var(--muted-foreground)]">
                                        ({group.rows.length})
                                      </span>
                                    </button>
                                  </td>
                                </tr>
                                {collapsed ? null : group.rows.map(renderMemberRow)}
                              </Fragment>
                            );
                          })
                        ) : (
                          members.map(renderMemberRow)
                        )}
                      </tbody>
                    </table>
                  );
                })()}
              </div>
            </div>
          )}
          </div>
        </div>

        <aside
          className={`xl:col-span-4 ${railOpen ? "space-y-6" : "space-y-2"}`}
        >
          <button
            type="button"
            onClick={toggleRail}
            className="flex w-full items-center justify-between rounded-none border bg-[var(--card)] px-3 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
            aria-expanded={railOpen}
          >
            <span>Insights & Leaderboard</span>
            <span aria-hidden>{railOpen ? "▾" : "▸"}</span>
          </button>
          {railOpen ? (
          <>
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
          </>
          ) : null}
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
                    companyId: "",
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
                <SearchableSelect
                  value={newMember.role}
                  onChange={(id) => {
                    if (!id) return;
                    setNewMember((prev) => ({
                      ...prev,
                      role: id as UserRole,
                    }));
                  }}
                  items={ROLE_ASSIGN_ITEMS}
                  placeholder="Select role"
                  searchPlaceholder="Search roles…"
                  aria-label="Member role"
                />
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

              {newMember.role === "cleaner" || newMember.role === "manager" ? (
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--muted-foreground)]">
                    Attach to company (optional)
                  </span>
                  <SearchableSelect
                    value={newMember.companyId || null}
                    onChange={(id) =>
                      setNewMember((prev) => ({ ...prev, companyId: id ?? "" }))
                    }
                    items={[
                      { id: "", label: "— Skip (assign later) —" },
                      ...(companies ?? []).map((c) => ({ id: c._id, label: c.name })),
                    ]}
                    placeholder="Skip (assign later)"
                    searchPlaceholder="Search companies…"
                    aria-label="Company"
                  />
                </label>
              ) : null}

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

      <TeamDetailDrawer
        member={
          memberActionSheet
            ? ({
                userId: memberActionSheet.userId,
                name: memberActionSheet.name,
                email: memberActionSheet.email,
                avatarUrl: memberActionSheet.avatarUrl,
                role: memberActionSheet.role,
                companyId: memberActionSheet.companyId,
                companyName: memberActionSheet.companyName ?? null,
                companyMemberRole: memberActionSheet.companyMemberRole,
              } satisfies DrawerMember)
            : null
        }
        open={!!memberActionSheet}
        onClose={() => setMemberActionSheet(null)}
        canManageTeam={canManageTeam}
        canDispatch={memberActionSheet ? canDispatchMember(memberActionSheet) : false}
        onEditProfile={() => memberActionSheet && openProfileEditor(memberActionSheet)}
        onEditRole={() => memberActionSheet && openRoleEditor(memberActionSheet)}
        onEditCompany={() => memberActionSheet && openCompanyEditor(memberActionSheet)}
        onDispatchJob={() => memberActionSheet && openJobEditor(memberActionSheet)}
        onAssignProperty={() => memberActionSheet && openPropertyEditor(memberActionSheet)}
        formatRoleLabel={(r) => formatRoleLabel((r as UserRole) ?? "cleaner")}
        formatCompanyRoleLabel={(r) =>
          r ? formatCompanyRoleLabel(r as CompanyMemberRole) : "Not visible to any manager"
        }
      />

      {profileEditor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border bg-[var(--card)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">Edit Profile</h2>
                <p className="text-sm text-[var(--muted-foreground)]">
                  {profileEditor.email || "Selected user"}
                </p>
              </div>
              <button
                className="rounded-md px-2 py-1 text-sm text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
                onClick={() => setProfileEditor(null)}
                disabled={isUpdatingProfile || isUploadingProfileAvatar}
              >
                Close
              </button>
            </div>

            <form className="space-y-4" onSubmit={handleProfileUpdate}>
              <div className="flex items-center gap-4">
                <ProfileImage
                  avatarUrl={profileDraft.avatarUrl || undefined}
                  label={profileDraft.name || profileEditor.email || "Member"}
                  className="h-16 w-16"
                />
                <div className="space-y-2">
                  <label className="inline-flex cursor-pointer rounded-md border px-3 py-2 text-sm">
                    {isUploadingProfileAvatar ? "Uploading..." : "Change Photo"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={isUploadingProfileAvatar}
                      onChange={(event) => {
                        void handleProfileAvatarSelected(event);
                      }}
                    />
                  </label>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Upload a new profile photo for this team member.
                  </p>
                </div>
              </div>

              <label className="block text-sm">
                <span className="mb-1 block text-[var(--muted-foreground)]">Name</span>
                <input
                  value={profileDraft.name}
                  onChange={(event) =>
                    setProfileDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  className="w-full rounded-md border bg-transparent px-3 py-2"
                />
              </label>

              <label className="block text-sm">
                <span className="mb-1 block text-[var(--muted-foreground)]">Phone</span>
                <input
                  value={profileDraft.phone}
                  onChange={(event) =>
                    setProfileDraft((current) => ({
                      ...current,
                      phone: event.target.value,
                    }))
                  }
                  className="w-full rounded-md border bg-transparent px-3 py-2"
                  placeholder="Phone number"
                />
              </label>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-md border px-3 py-2 text-sm"
                  onClick={() => setProfileEditor(null)}
                  disabled={isUpdatingProfile || isUploadingProfileAvatar}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-60"
                  disabled={isUpdatingProfile || isUploadingProfileAvatar}
                >
                  {isUpdatingProfile ? "Saving..." : "Save Profile"}
                </button>
              </div>
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
                <SearchableSelect
                  value={roleDraft}
                  onChange={(id) => {
                    if (id) setRoleDraft(id as UserRole);
                  }}
                  items={ROLE_ASSIGN_ITEMS}
                  placeholder="Select role"
                  searchPlaceholder="Search roles…"
                  aria-label="Role"
                />
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

      {jobEditor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border bg-[var(--card)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Assign to Job</h2>
              <button
                className="rounded-md px-2 py-1 text-sm text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
                onClick={() => setJobEditor(null)}
                disabled={isAssigningJob}
              >
                Close
              </button>
            </div>

            <p className="mb-3 text-sm text-[var(--muted-foreground)]">
              {jobEditor.name || jobEditor.email || "Selected user"}
            </p>

            <form className="space-y-3" onSubmit={handleJobAssignment}>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--muted-foreground)]">Job</span>
                <SearchableSelect
                  value={jobDraft || null}
                  onChange={(id) =>
                    setJobDraft((id as Id<"cleaningJobs"> | null) ?? "")
                  }
                  placeholder="Select Job"
                  searchPlaceholder="Search jobs…"
                  aria-label="Job"
                  items={assignableJobs.map((job) => ({
                    id: job._id,
                    label:
                      (job.property?.name ?? "Unknown property") +
                      " · " +
                      formatRoleDate(job.scheduledStartAt) +
                      " · " +
                      job.status.replace("_", " "),
                  }))}
                />
              </label>

              <button
                type="submit"
                disabled={isAssigningJob}
                className="w-full rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-black disabled:opacity-60"
              >
                {isAssigningJob ? "Assigning..." : "Assign Job"}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {companyEditor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border bg-[var(--card)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Attach to Cleaning Company</h2>
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
                <SearchableSelect
                  value={companyDraft || null}
                  onChange={(id) =>
                    setCompanyDraft((id as Id<"cleaningCompanies"> | null) ?? "")
                  }
                  placeholder="No Company"
                  searchPlaceholder="Search companies…"
                  aria-label="Company"
                  items={(companies ?? []).map((c) => ({ id: c._id, label: c.name }))}
                />
              </label>

              <label className="block text-sm">
                <span className="mb-1 block text-[var(--muted-foreground)]">Membership role</span>
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
                {isUpdatingCompany ? "Saving..." : "Save Membership"}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {propertyEditor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border bg-[var(--card)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Assign to Property</h2>
              <button
                className="rounded-md px-2 py-1 text-sm text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
                onClick={() => setPropertyEditor(null)}
                disabled={isAssigningProperty}
              >
                Close
              </button>
            </div>

            <p className="mb-3 text-sm text-[var(--muted-foreground)]">
              {propertyEditor.name || propertyEditor.email || "Selected user"}
            </p>

            {!propertyEditor.companyId ? (
              <p className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                This member has no company assigned. Assign a company first.
              </p>
            ) : null}

            <form className="space-y-3" onSubmit={handlePropertyAssignment}>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--muted-foreground)]">Property</span>
                <SearchableSelect
                  value={propertyDraft || null}
                  onChange={(id) =>
                    setPropertyDraft((id as Id<"properties"> | null) ?? "")
                  }
                  placeholder="Select Property"
                  searchPlaceholder="Search properties…"
                  aria-label="Property"
                  items={(allProperties ?? []).map((p) => ({
                    id: p._id,
                    label: p.name,
                    hint: p.address ?? undefined,
                  }))}
                />
              </label>

              <button
                type="submit"
                disabled={isAssigningProperty || !propertyEditor.companyId}
                className="w-full rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-black disabled:opacity-60"
              >
                {isAssigningProperty ? "Assigning..." : "Assign Property"}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatChip({
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
  const inner = (
    <>
      <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
        {label}
      </span>
      <span className={`text-sm font-semibold ${tone ?? "text-[var(--foreground)]"}`}>
        {value}
      </span>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1.5 rounded-none px-1 py-0.5 hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40"
      >
        {inner}
      </button>
    );
  }
  return <span className="inline-flex items-center gap-1.5">{inner}</span>;
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

function formatRoleDate(value?: number | null): string {
  if (!value) {
    return "Unscheduled";
  }
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
      <div className={`${className} relative overflow-hidden rounded-none border`}>
        <Image
          src={avatarUrl}
          alt={label}
          fill
          unoptimized
          className="object-cover"
          sizes="64px"
        />
      </div>
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
    case "owner":
      return "Owner";
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
