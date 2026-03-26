"use client";

import { useEffect, useRef } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";

type UserRole = "cleaner" | "manager" | "property_ops" | "admin";

function parseRole(value: unknown): UserRole | undefined {
  if (
    value === "cleaner" ||
    value === "manager" ||
    value === "property_ops" ||
    value === "admin"
  ) {
    return value;
  }
  return undefined;
}

export function ClerkUserSync() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { isAuthenticated: isConvexAuthenticated, isLoading: isConvexAuthLoading } =
    useConvexAuth();
  const ensureUser = useMutation(api.users.mutations.ensureUser);
  const lastSyncedKey = useRef<string | null>(null);
  const inFlightKey = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) {
      return;
    }
    if (isConvexAuthLoading || !isConvexAuthenticated) {
      return;
    }

    const email = user.primaryEmailAddress?.emailAddress?.trim();
    if (!email) {
      return;
    }

    const name =
      user.fullName?.trim() ||
      user.firstName?.trim() ||
      email.split("@")[0] ||
      "User";
    const metadata = user.publicMetadata as Record<string, unknown> | undefined;
    const role = parseRole(metadata?.role);
    const avatarUrl = user.imageUrl?.trim() || undefined;

    const syncKey = `${user.id}:${email}:${name}:${role ?? ""}:${avatarUrl ?? ""}`;
    if (lastSyncedKey.current === syncKey || inFlightKey.current === syncKey) {
      return;
    }
    inFlightKey.current = syncKey;

    void ensureUser({ name, email, role, avatarUrl })
      .then(() => {
        lastSyncedKey.current = syncKey;
      })
      .catch((error) => {
        // This can still happen transiently during token refreshes.
        console.warn("[ClerkUserSync] User sync skipped", error);
      })
      .finally(() => {
        if (inFlightKey.current === syncKey) {
          inFlightKey.current = null;
        }
      });
  }, [
    ensureUser,
    isConvexAuthenticated,
    isConvexAuthLoading,
    isLoaded,
    isSignedIn,
    user,
  ]);

  return null;
}
