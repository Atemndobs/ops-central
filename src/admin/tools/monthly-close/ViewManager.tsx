"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Loader2, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";
import { Button, Input, Label, Select, Checkbox, Modal, ModalTitle, ModalFooter } from "./ui";

const OWNER_NONE = "";
const OWNER_CUSTOM = "__custom__";

interface ViewManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The currently active view id, or null for "All properties" */
  activeViewId: string | null;
  onViewSaved: (id: string) => void;
  onViewDeleted: () => void;
}

export function ViewManager({
  open,
  onOpenChange,
  activeViewId,
  onViewSaved,
  onViewDeleted,
}: ViewManagerProps) {
  const { showToast } = useToast();

  const views = useQuery(api.strCosts.views.listViews, {});
  const allProps = useQuery(api.strCosts.queries.getProperties, {});
  // Owners we manage (from propertyOwners) — the "Client / company" options.
  const owners = useQuery(api.strCosts.views.listStatementClients, {});

  const saveView = useMutation(api.strCosts.views.saveView);
  const deleteView = useMutation(api.strCosts.views.deleteView);

  const activeView = views?.find((v) => v._id === activeViewId) ?? null;

  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (activeView) {
      setName(activeView.name);
      setClientName(activeView.clientName ?? "");
      setOwnerUserId((activeView.ownerUserId as string | undefined) ?? null);
      setCheckedIds(new Set(activeView.propertyIds as string[]));
    } else {
      setName("");
      setClientName("");
      setOwnerUserId(null);
      setCheckedIds(new Set((allProps ?? []).map((p) => p._id as string)));
    }
  }, [open, activeView, allProps]);

  function toggleProp(id: string) {
    if (ownerUserId !== null) {
      // Editing the property list contradicts "follow the owner" — unbind so
      // the view is explicitly manual instead of silently diverging.
      setOwnerUserId(null);
      showToast("View unlinked from owner — property list is now manual.", "success");
    }
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Picking an owner BINDS the view: client + properties follow their
  // ownership records live. "None"/custom leaves the view manual.
  function handleOwnerChange(value: string) {
    if (value === OWNER_NONE) {
      setOwnerUserId(null);
      setClientName("");
      return;
    }
    if (value === OWNER_CUSTOM) {
      setOwnerUserId(null); // keep clientName as a free-form label
      return;
    }
    const owner = owners?.find((o) => o.userId === value);
    if (!owner) return;
    setOwnerUserId(owner.userId);
    setClientName(owner.client);
    if (owner.propertyIds.length > 0) setCheckedIds(new Set(owner.propertyIds));
  }

  async function handleSave(asNew: boolean) {
    const trimmed = name.trim();
    if (!trimmed) {
      showToast("Please enter a view name.", "error");
      return;
    }
    if (checkedIds.size === 0) {
      showToast("Select at least one property.", "error");
      return;
    }

    const propertyIds = [...checkedIds] as Id<"properties">[];
    setSaving(true);
    try {
      const id = await saveView({
        id: asNew || !activeViewId ? undefined : (activeViewId as Id<"portfolioViews">),
        name: trimmed,
        // Bound views: the server derives clientName from the owner profile.
        clientName: ownerUserId !== null ? undefined : clientName.trim() || undefined,
        propertyIds,
        ownerUserId: ownerUserId !== null ? (ownerUserId as Id<"users">) : undefined,
      });
      onViewSaved(id as string);
      showToast(`"${trimmed}" saved.`, "success");
      onOpenChange(false);
    } catch (err) {
      showToast(`Save failed: ${String(err)}`, "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!activeViewId) return;
    setDeleting(true);
    try {
      await deleteView({ id: activeViewId as Id<"portfolioViews"> });
      onViewDeleted();
      showToast("View deleted", "success");
      onOpenChange(false);
    } catch (err) {
      showToast(`Delete failed: ${String(err)}`, "error");
    } finally {
      setDeleting(false);
    }
  }

  const isEditing = !!activeViewId;
  const isLoading = views === undefined || allProps === undefined;

  return (
    <Modal open={open} onClose={() => onOpenChange(false)} labelledBy="view-mgr-title" className="max-w-md">
      <ModalTitle id="view-mgr-title">{isEditing ? "Edit view" : "New view"}</ModalTitle>

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <div className="space-y-1">
            <Label htmlFor="view-name">View name</Label>
            <Input
              id="view-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Texas Properties"
              autoFocus
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="view-client-name">Client / company (for statements)</Label>
            <Select
              id="view-client-name"
              value={ownerUserId ?? (clientName ? OWNER_CUSTOM : OWNER_NONE)}
              onChange={(e) => handleOwnerChange(e.target.value)}
              className="w-full"
            >
              <option value={OWNER_NONE}>— None —</option>
              {/* Preserve a custom label saved before owner-binding existed */}
              {ownerUserId === null && clientName && (
                <option value={OWNER_CUSTOM}>{clientName} (custom)</option>
              )}
              {(owners ?? []).map((o) => (
                <option key={o.userId} value={o.userId}>
                  {/* Statement uses `client` (company if set, else name); show the rep
                      in parens when a company is set so the picker stays unambiguous. */}
                  {o.client}
                  {o.company ? ` (${o.name})` : ""}
                  {o.propertyIds.length > 0
                    ? ` · ${o.propertyIds.length} ${o.propertyIds.length === 1 ? "property" : "properties"}`
                    : ""}
                </option>
              ))}
            </Select>
            {ownerUserId !== null ? (
              <p className="text-xs text-[var(--muted-foreground)]">
                Linked to this owner — the statement client and property list
                follow their ownership records automatically. Editing the
                checkboxes below unlinks the view.
              </p>
            ) : (
              <p className="text-xs text-[var(--muted-foreground)]">
                Owners come from the properties you manage; the statement shows
                their company (or name if none). Selecting one links the view to
                that owner.
              </p>
            )}
            {activeView?.ownerLinkBroken ? (
              <p className="text-xs font-medium text-amber-600">
                The linked owner currently has no active properties — showing the
                saved list instead.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col space-y-1">
            <Label>Properties</Label>
            <div className="max-h-64 flex-1 space-y-1 overflow-y-auto rounded-md border border-[var(--border)] p-2">
              {allProps!.length === 0 ? (
                <p className="py-2 text-sm text-[var(--muted-foreground)]">No properties found.</p>
              ) : (
                allProps!.map((prop) => {
                  const id = prop._id as string;
                  return (
                    <label
                      key={id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-[var(--muted)]"
                    >
                      <Checkbox checked={checkedIds.has(id)} onCheckedChange={() => toggleProp(id)} id={`prop-${id}`} />
                      <span>{prop.name}</span>
                    </label>
                  );
                })
              )}
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">
              {checkedIds.size} of {allProps!.length} selected
            </p>
          </div>
        </div>
      )}

      <ModalFooter className="flex-wrap">
        {isEditing && (
          <Button
            variant="destructive"
            size="sm"
            disabled={deleting || saving}
            onClick={handleDelete}
            className="mr-auto"
          >
            {deleting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Trash2 className="mr-1 h-3 w-3" />}
            Delete
          </Button>
        )}

        <Button variant="outline" size="sm" disabled={isLoading || saving || deleting} onClick={() => handleSave(true)}>
          {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
          Save as new
        </Button>

        <Button size="sm" disabled={isLoading || saving || deleting} onClick={() => handleSave(false)}>
          {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
          {isEditing ? "Save" : "Create"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
