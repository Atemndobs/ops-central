"use client";

import { useEffect } from "react";
import Image from "next/image";
import { X } from "lucide-react";

function Avatar({
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
        <Image src={avatarUrl} alt={label} fill unoptimized className="object-cover" sizes="64px" />
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

export type DrawerMember = {
  userId: string;
  name?: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
  role?: string;
  companyId?: string | null;
  companyName?: string | null;
  companyMemberRole?: string | null;
};

type Props = {
  member: DrawerMember | null;
  open: boolean;
  onClose: () => void;
  canManageTeam: boolean;
  canDispatch: boolean;
  onEditProfile: () => void;
  onEditRole: () => void;
  onEditCompany: () => void;
  onDispatchJob: () => void;
  onAssignProperty: () => void;
  formatRoleLabel: (role?: string) => string;
  formatCompanyRoleLabel: (role?: string | null) => string;
};

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
      {children}
    </h3>
  );
}

function ActionButton({
  onClick,
  children,
  variant = "default",
}: {
  onClick: () => void;
  children: React.ReactNode;
  variant?: "default" | "primary";
}) {
  const base =
    "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--accent)]";
  const variantClass =
    variant === "primary"
      ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]"
      : "";
  return (
    <button type="button" className={`${base} ${variantClass}`} onClick={onClick}>
      {children}
    </button>
  );
}

export function TeamDetailDrawer({
  member,
  open,
  onClose,
  canManageTeam,
  canDispatch,
  onEditProfile,
  onEditRole,
  onEditCompany,
  onDispatchJob,
  onAssignProperty,
  formatRoleLabel,
  formatCompanyRoleLabel,
}: Props) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open || !member) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <aside
        className="relative h-full w-full max-w-xl overflow-y-auto border-l bg-[var(--card)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b bg-[var(--card)] p-4">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar
              avatarUrl={member.avatarUrl}
              label={member.name || member.email || "Member"}
              className="h-12 w-12"
            />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold">
                {member.name || member.email || "Unknown"}
              </p>
              <p className="truncate text-xs text-[var(--muted-foreground)]">
                {member.email || "No email"} · {formatRoleLabel(member.role)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-6 p-4">
          {/* Identity */}
          <section className="space-y-2">
            <SectionHeader>Identity</SectionHeader>
            <div className="grid gap-2">
              {canManageTeam ? (
                <>
                  <ActionButton onClick={onEditProfile}>Edit profile</ActionButton>
                  <ActionButton onClick={onEditRole}>
                    Change role — currently {formatRoleLabel(member.role)}
                  </ActionButton>
                </>
              ) : (
                <p className="text-sm text-[var(--muted-foreground)]">
                  Role: {formatRoleLabel(member.role)}
                </p>
              )}
            </div>
          </section>

          {/* Company */}
          {canManageTeam ? (
            <section className="space-y-2">
              <SectionHeader>Company membership</SectionHeader>
              {member.companyId ? (
                <div className="rounded-md border p-3">
                  <p className="text-sm font-medium">{member.companyName}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {formatCompanyRoleLabel(member.companyMemberRole)}
                  </p>
                </div>
              ) : (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                    No company assigned
                  </p>
                  <p className="text-xs text-amber-700/80 dark:text-amber-300/80">
                    Not visible to any manager.
                  </p>
                </div>
              )}
              <ActionButton onClick={onEditCompany} variant="primary">
                {member.companyId ? "Change company" : "Attach to company"}
              </ActionButton>
            </section>
          ) : null}

          {/* Dispatch */}
          {canDispatch || canManageTeam ? (
            <section className="space-y-2">
              <SectionHeader>Assignments</SectionHeader>
              <div className="grid gap-2">
                {canDispatch ? (
                  <ActionButton onClick={onDispatchJob}>Dispatch to a job</ActionButton>
                ) : null}
                {canManageTeam ? (
                  <ActionButton onClick={onAssignProperty}>
                    Assign to a property
                  </ActionButton>
                ) : null}
              </div>
            </section>
          ) : null}

          {/* Activity placeholder */}
          <section className="space-y-2">
            <SectionHeader>Activity</SectionHeader>
            <p className="text-sm text-[var(--muted-foreground)]">
              Recent jobs and quality scores will appear here.
            </p>
          </section>
        </div>
      </aside>
    </div>
  );
}
