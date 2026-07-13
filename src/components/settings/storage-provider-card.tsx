"use client";

/**
 * StorageProviderCard — admin picker for the active object-storage backend.
 *
 * New photo/video uploads are written to (and served from) the selected
 * backend. Existing objects are unaffected: the read path signs each object
 * against its own stored `photos.provider`, so B2 history keeps resolving
 * against B2 after a switch.
 *
 * Mirrors AIProviderCard. Save is admin-only on the backend, and the mutation
 * refuses a backend whose env vars aren't configured on the deployment.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, Check, HardDrive, Loader2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/components/ui/toast-provider";

type StorageProviderKey = "b2" | "minio";

function formatRelativeTime(timestamp: number): string {
  const diffMin = Math.round((Date.now() - timestamp) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.round(diffHr / 24)}d ago`;
}

export function StorageProviderCard() {
  const { showToast } = useToast();

  const data = useQuery(api.appSettings.listStorageProviders, {});
  const currentSetting = useQuery(api.appSettings.getStorageProvider, {});
  const setProvider = useMutation(api.appSettings.setStorageProvider);

  const [selected, setSelected] = useState<StorageProviderKey | null>(null);
  const [saving, setSaving] = useState(false);

  // Sync local selection with the server's active backend on load / remote change.
  useEffect(() => {
    if (data?.activeKey && selected === null) {
      setSelected(data.activeKey);
    }
  }, [data?.activeKey, selected]);

  const isLoading = data === undefined || currentSetting === undefined;

  if (isLoading) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
        <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      </div>
    );
  }

  const activeKey = data.activeKey;
  const dirty = selected !== null && selected !== activeKey;
  const switchingToMinio = selected === "minio" && activeKey !== "minio";

  const handleSave = async () => {
    if (!selected || !dirty) return;
    setSaving(true);
    try {
      await setProvider({ provider: selected });
      showToast(`Storage backend switched to ${selected.toUpperCase()}.`, "success");
    } catch (error) {
      showToast(getErrorMessage(error, "Could not switch storage backend"), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-[var(--primary)]/10 p-2 text-[var(--primary)]">
          <HardDrive className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-medium text-[var(--foreground)]">
            Active storage backend
          </h3>
          <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
            New uploads go here. Existing photos keep loading from wherever they
            were originally stored.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {data.providers.map((provider) => {
          const isActive = provider.key === activeKey;
          const isSelected = provider.key === selected;
          const unavailable = !provider.isConfigured && !isActive;
          return (
            <label
              key={provider.key}
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
                isSelected
                  ? "border-[var(--primary)] bg-[var(--primary)]/5"
                  : "border-[var(--border)] hover:border-[var(--muted-foreground)]"
              } ${unavailable ? "opacity-60" : ""}`}
            >
              <input
                type="radio"
                name="storage-provider"
                value={provider.key}
                checked={isSelected}
                onChange={() => setSelected(provider.key)}
                disabled={unavailable || saving}
                className="mt-1"
              />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-[var(--foreground)]">
                    {provider.label}
                  </span>
                  <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs font-mono text-[var(--muted-foreground)]">
                    {provider.costLabel}
                  </span>
                  {isActive ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-600">
                      <Check className="h-3 w-3" />
                      Active
                    </span>
                  ) : null}
                  {!provider.isConfigured ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/15 px-2 py-0.5 text-xs font-medium text-yellow-600">
                      <AlertTriangle className="h-3 w-3" />
                      Not configured
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  {provider.description}
                </p>
                <p className="mt-1 text-xs font-mono text-[var(--muted-foreground)]/70">
                  {provider.envVar}
                </p>
              </div>
            </label>
          );
        })}
      </div>

      {switchingToMinio ? (
        <div className="flex items-start gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs text-yellow-700 dark:text-yellow-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            MinIO presigned URLs point at your homelab host. Cleaners&apos; phones
            on cellular can only load them if MinIO is publicly reachable
            (Cloudflare Tunnel / reverse proxy / Tailscale Funnel). Don&apos;t
            switch until that&apos;s in place, or field photos will break.
          </span>
        </div>
      ) : null}

      <div className="flex items-center justify-between pt-1">
        <div className="text-xs text-[var(--muted-foreground)]">
          {currentSetting.updatedAt
            ? `Last changed ${formatRelativeTime(currentSetting.updatedAt)}`
            : "Using default (B2)"}
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            "Save"
          )}
        </button>
      </div>
    </div>
  );
}
