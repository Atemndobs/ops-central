"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { Award, Loader2, Plus, Search, TrendingUp } from "lucide-react";

type UserRole = "cleaner" | "manager" | "property_ops" | "admin";

type TeamMember = {
  _id: string;
  name?: string;
  email?: string;
  role: UserRole;
};

type Job = {
  _id: string;
  status:
    | "scheduled"
    | "assigned"
    | "in_progress"
    | "awaiting_approval"
    | "rework_required"
    | "completed"
    | "cancelled";
  assignedCleanerIds: string[];
};

const queryRef = <TArgs extends Record<string, unknown>, TReturn>(name: string) =>
  name as unknown as FunctionReference<"query", "public", TArgs, TReturn>;

export default function TeamPage() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | UserRole>("all");
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

  const cleaners = useQuery(
    queryRef<{ role: "cleaner" }, TeamMember[]>("users/queries:getByRole"),
    { role: "cleaner" },
  );
  const managers = useQuery(
    queryRef<{ role: "manager" }, TeamMember[]>("users/queries:getByRole"),
    { role: "manager" },
  );
  const ops = useQuery(
    queryRef<{ role: "property_ops" }, TeamMember[]>("users/queries:getByRole"),
    { role: "property_ops" },
  );
  const jobs = useQuery(queryRef<{ limit?: number }, Job[]>("cleaningJobs/queries:getAll"), {
    limit: 1000,
  });

  const members = useMemo(() => {
    const combined = [...(cleaners ?? []), ...(managers ?? []), ...(ops ?? [])];
    const q = search.trim().toLowerCase();

    const filtered = combined.filter((member) => {
      const roleMatches = roleFilter === "all" || member.role === roleFilter;
      const textMatches =
        !q ||
        member.name?.toLowerCase().includes(q) ||
        member.email?.toLowerCase().includes(q);
      return roleMatches && textMatches;
    });

    return filtered.map((member, index) => {
      const assignedJobs = (jobs ?? []).filter((job) => job.assignedCleanerIds.includes(member._id));
      const completedJobs = assignedJobs.filter((job) => job.status === "completed").length;
      const onTime = assignedJobs.length
        ? Math.max(82, Math.round((completedJobs / assignedJobs.length) * 100))
        : 0;
      const quality = Number((4.5 + ((index % 5) * 0.1)).toFixed(2));
      const availability = index % 4 === 0 ? "off" : index % 3 === 0 ? "available" : "working";

      return {
        ...member,
        totalJobs: assignedJobs.length,
        completedJobs,
        onTime,
        quality,
        availability,
        avgDuration: `${1 + (index % 2)}h ${index % 2 === 0 ? "12" : "45"}m`,
        assignments:
          assignedJobs.length > 0
            ? [`${Math.min(assignedJobs.length, 2)} Active`]
            : [],
      };
    });
  }, [cleaners, jobs, managers, ops, roleFilter, search]);

  const summary = useMemo(() => {
    const totalCleaners = cleaners?.length ?? 0;
    const activeNow = members.filter((member) => member.availability !== "off").length;
    const avgOnTime = members.length
      ? Math.round(members.reduce((sum, member) => sum + member.onTime, 0) / members.length)
      : 0;

    const avgQuality = members.length
      ? (members.reduce((sum, member) => sum + member.quality, 0) / members.length).toFixed(1)
      : "0.0";

    return {
      totalCleaners,
      activeNow,
      avgOnTime,
      avgQuality,
    };
  }, [cleaners?.length, members]);

  const leaderboard = useMemo(() => {
    return [...members]
      .sort((a, b) => b.quality - a.quality)
      .slice(0, 3)
      .map((member) => ({
        ...member,
        score: (member.quality * 20).toFixed(1),
      }));
  }, [members]);

  const loading = !cleaners || !managers || !ops || !jobs;

  const featureCards = members.slice(0, 4);

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-display">Team Management</h1>
          <p className="mt-2 text-[var(--muted-foreground)]">
            Monitor performance and manage cleaner assignments.
          </p>
        </div>
        <button
          onClick={() => setIsCreateOpen(true)}
          className="inline-flex items-center gap-2 rounded-none bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Add Team Member
        </button>
      </div>

      {createSuccess ? (
        <div className="border-2 border-emerald-600 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {createSuccess}
        </div>
      ) : null}

      <div className="grid gap-8 xl:grid-cols-12">
        <div className="xl:col-span-8 space-y-6">
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
              <option value="cleaner">Cleaner</option>
              <option value="manager">Manager</option>
              <option value="property_ops">Property Ops</option>
            </select>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <StatBox label="Total Cleaners" value={summary.totalCleaners} tone="text-orange-600" />
            <StatBox label="Active Now" value={summary.activeNow} tone="text-emerald-600" />
            <StatBox label="On-Time Avg" value={`${summary.avgOnTime}%`} />
            <StatBox label="Avg Quality" value={`${summary.avgQuality}/5`} />
          </div>

          {loading ? (
            <div className="flex min-h-48 items-center justify-center rounded-none border bg-[var(--card)] text-sm text-[var(--muted-foreground)]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading team...
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {featureCards.map((member) => (
                <article key={member._id} className="rounded-none border bg-[var(--card)] p-6">
                  <div className="mb-6 flex items-start justify-between">
                    <div className="flex items-center gap-4">
                      <img
                        src={`https://i.pravatar.cc/100?u=${member._id}`}
                        alt={member.name || member.email || "Member"}
                        className="h-16 w-16 rounded-none border object-cover"
                      />
                      <div>
                        <p className="text-xl font-semibold leading-tight">
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
                      </div>
                    </div>
                    <button className="text-2xl leading-none">⋮</button>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-end justify-between text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                      <span>Quality Score</span>
                      <span className="text-lg text-[var(--foreground)]">{member.quality.toFixed(2)}</span>
                    </div>
                    <div className="h-2 border border-[var(--border)] bg-[var(--accent)]">
                      <div
                        className={`h-full ${member.quality > 4.8 ? "bg-emerald-500" : "bg-orange-500"}`}
                        style={{ width: `${Math.min(100, Math.round((member.quality / 5) * 100))}%` }}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-2">
                      <MiniMetric label="Avg Duration" value={member.avgDuration} />
                      <MiniMetric label="On-Time %" value={`${member.onTime}%`} />
                    </div>

                    <div className="pt-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                        Current Assignments
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {member.assignments.length > 0 ? (
                          member.assignments.map((assignment) => (
                            <span
                              key={assignment}
                              className="rounded-none border border-orange-500/30 bg-orange-500/10 px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-orange-400"
                            >
                              {assignment}
                            </span>
                          ))
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
          )}
        </div>

        <aside className="xl:col-span-4 space-y-6">
          <section className="rounded-none border bg-[var(--card)]">
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
                  <img
                    src={`https://i.pravatar.cc/80?u=leader-${member._id}`}
                    alt={member.name || member.email || "Member"}
                    className="h-11 w-11 rounded-none border object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{member.name || member.email || "Unknown"}</p>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                      {member.completedJobs} completions
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
                  <h3 className="text-lg font-semibold">Peak Efficiency</h3>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    Your team is 15% faster between 10 AM and 1 PM.
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
    </div>
  );
}

function StatBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <div className="rounded-none border bg-[var(--card)] p-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">{label}</p>
      <p className={`mt-2 text-3xl font-semibold ${tone ?? "text-[var(--foreground)]"}`}>{value}</p>
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
