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

type ClaimsLike = Record<string, unknown> | null | undefined;

function parseRoleFromMetadata(metadata: unknown): UserRole | undefined {
  if (!metadata || typeof metadata !== "object") {
    return undefined;
  }
  return parseRole((metadata as Record<string, unknown>).role);
}

function parseRoleFromSessionClaims(claims: ClaimsLike): UserRole | undefined {
  if (!claims) {
    return undefined;
  }

  const directRole = parseRole(claims.role);
  if (directRole) {
    return directRole;
  }

  const metadataRole = parseRoleFromMetadata(claims.metadata);
  if (metadataRole) {
    return metadataRole;
  }

  const publicMetadataRole = parseRoleFromMetadata(claims.publicMetadata);
  if (publicMetadataRole) {
    return publicMetadataRole;
  }

  const publicMetadataSnakeRole = parseRoleFromMetadata(
    claims.public_metadata,
  );
  if (publicMetadataSnakeRole) {
    return publicMetadataSnakeRole;
  }

  const unsafeMetadataRole = parseRoleFromMetadata(claims.unsafeMetadata);
  if (unsafeMetadataRole) {
    return unsafeMetadataRole;
  }

  const unsafeMetadataSnakeRole = parseRoleFromMetadata(
    claims.unsafe_metadata,
  );
  if (unsafeMetadataSnakeRole) {
    return unsafeMetadataSnakeRole;
  }

  return undefined;
}

export function ClerkUserSync() {
  const { isLoaded, isSignedIn, sessionClaims } = useAuth();
  const { user } = useUser();
  const { isAuthenticated: isConvexAuthenticated, isLoading: isConvexAuthLoading } =
    useConvexAuth();
  const ensureUser = useMutation(api.users.mutations.ensureUser);
  const ensureUserRef = useRef(ensureUser);
  ensureUserRef.current = ensureUser;
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
    const publicMetadata = user.publicMetadata as
      | Record<string, unknown>
      | undefined;
    const unsafeMetadata = (user as { unsafeMetadata?: Record<string, unknown> })
      .unsafeMetadata;
    const role =
      parseRoleFromSessionClaims(
        sessionClaims as Record<string, unknown> | null | undefined,
      ) ??
      parseRole(publicMetadata?.role) ??
      parseRole(unsafeMetadata?.role);
    const avatarUrl = user.imageUrl?.trim() || undefined;

    const syncKey = `${user.id}:${email}:${name}:${role ?? ""}:${avatarUrl ?? ""}`;
    if (lastSyncedKey.current === syncKey || inFlightKey.current === syncKey) {
      return;
    }
    inFlightKey.current = syncKey;

    void ensureUserRef.current({ name, email, role, avatarUrl })
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
    isConvexAuthenticated,
    isConvexAuthLoading,
    isLoaded,
    isSignedIn,
    user,
    sessionClaims,
  ]);

  return null;
}
