import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";

type AppRole = "cleaner" | "manager" | "property_ops" | "admin";

type NormalizedTeammate = {
  sourceId?: string;
  fullName: string;
  email: string;
  phone?: string;
  companyName?: string;
  roles: string[];
  appRole: AppRole;
};

type ImportSummary = {
  sourceCount: number;
  uniqueByEmail: number;
  skippedMissingEmail: number;
  processed: number;
  createdInClerk: number;
  updatedInClerk: number;
  createdInConvex: number;
  updatedInConvex: number;
  errors: string[];
  endpointUsed?: string;
};

const DEFAULT_HOSPITABLE_BASE_URL = "https://public.api.hospitable.com/v2";
const TEAMMATE_ENDPOINT_CANDIDATES = [
  "/teammates",
  "/users?include=roles",
  "/users",
];

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getArrayFromApiPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = asRecord(payload);
  if (!record) {
    return [];
  }

  const data = record.data;
  if (Array.isArray(data)) {
    return data;
  }

  const results = record.results;
  if (Array.isArray(results)) {
    return results;
  }

  const teammates = record.teammates;
  if (Array.isArray(teammates)) {
    return teammates;
  }

  const users = record.users;
  if (Array.isArray(users)) {
    return users;
  }

  return [];
}

function extractRoles(raw: Record<string, unknown>): string[] {
  const roles = new Set<string>();

  const pushRole = (value: unknown) => {
    const role = normalizeString(typeof value === "string" ? value : undefined);
    if (role) {
      roles.add(role.toLowerCase());
    }
  };

  pushRole(raw.role);

  for (const roleEntry of asArray(raw.roles)) {
    if (typeof roleEntry === "string") {
      pushRole(roleEntry);
      continue;
    }
    const roleRecord = asRecord(roleEntry);
    if (!roleRecord) {
      continue;
    }
    pushRole(roleRecord.name);
    pushRole(roleRecord.slug);
    pushRole(roleRecord.key);
    pushRole(roleRecord.type);
    pushRole(roleRecord.title);
  }

  return Array.from(roles);
}

function mapToAppRole(roles: string[]): AppRole {
  const normalized = roles.map((role) => role.toLowerCase());

  if (
    normalized.some((role) =>
      role.includes("property_ops") ||
      role.includes("property ops") ||
      role.includes("operations") ||
      role.includes("ops")
    )
  ) {
    return "property_ops";
  }

  if (
    normalized.some((role) =>
      role.includes("manager") ||
      role.includes("owner") ||
      role.includes("admin")
    )
  ) {
    return "manager";
  }

  return "cleaner";
}

function resolveFullName(raw: Record<string, unknown>, email: string): string {
  const fullName =
    normalizeString(raw.full_name) ??
    normalizeString(raw.name) ??
    normalizeString(raw.display_name);

  if (fullName) {
    return fullName;
  }

  const firstName =
    normalizeString(raw.first_name) ??
    normalizeString(raw.firstName);
  const lastName =
    normalizeString(raw.last_name) ??
    normalizeString(raw.lastName);
  const combined = [firstName, lastName].filter(Boolean).join(" ").trim();
  if (combined.length > 0) {
    return combined;
  }

  return email.split("@")[0] || "Team Member";
}

function normalizeTeammate(rawValue: unknown): NormalizedTeammate | null {
  const raw = asRecord(rawValue);
  if (!raw) {
    return null;
  }

  const contact = asRecord(raw.contact);
  const user = asRecord(raw.user);
  const company = asRecord(raw.company);

  const email =
    normalizeString(raw.email) ??
    normalizeString(contact?.email) ??
    normalizeString(user?.email);

  if (!email) {
    return null;
  }

  const normalizedEmail = normalizeEmail(email);
  const roles = extractRoles(raw);

  return {
    sourceId: normalizeString(raw.id),
    fullName: resolveFullName(raw, normalizedEmail),
    email: normalizedEmail,
    phone:
      normalizeString(raw.phone) ??
      normalizeString(contact?.phone) ??
      normalizeString(user?.phone),
    companyName:
      normalizeString(raw.company_name) ??
      normalizeString(company?.name) ??
      (typeof raw.company === "string" ? normalizeString(raw.company) : undefined),
    roles,
    appRole: mapToAppRole(roles),
  };
}

function mergeByEmail(teammates: NormalizedTeammate[]): NormalizedTeammate[] {
  const merged = new Map<string, NormalizedTeammate>();

  for (const teammate of teammates) {
    const existing = merged.get(teammate.email);
    if (!existing) {
      merged.set(teammate.email, teammate);
      continue;
    }

    const roleSet = new Set([...existing.roles, ...teammate.roles]);
    const roles = Array.from(roleSet);
    merged.set(teammate.email, {
      ...existing,
      sourceId: existing.sourceId ?? teammate.sourceId,
      fullName:
        existing.fullName.length >= teammate.fullName.length
          ? existing.fullName
          : teammate.fullName,
      phone: existing.phone ?? teammate.phone,
      companyName: existing.companyName ?? teammate.companyName,
      roles,
      appRole: mapToAppRole(roles),
    });
  }

  return Array.from(merged.values());
}

function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) {
    return { firstName: parts[0] || fullName.trim(), lastName: "" };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function generateTempPassword(): string {
  return `Tmp!${Math.random().toString(36).slice(2, 10)}A1`;
}

async function fetchTeammatesFromHospitable(
  apiKey: string,
): Promise<{ endpointUsed: string; teammates: NormalizedTeammate[]; sourceCount: number; skippedMissingEmail: number }> {
  const baseUrl = (process.env.HOSPITABLE_API_URL ?? DEFAULT_HOSPITABLE_BASE_URL).replace(/\/$/, "");

  const configuredCandidates = process.env.HOSPITABLE_TEAMMATES_ENDPOINTS
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const candidates =
    configuredCandidates && configuredCandidates.length > 0
      ? configuredCandidates
      : TEAMMATE_ENDPOINT_CANDIDATES;

  const errors: string[] = [];

  for (const candidate of candidates) {
    const endpoint = candidate.startsWith("http")
      ? candidate
      : `${baseUrl}${candidate.startsWith("/") ? candidate : `/${candidate}`}`;

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      errors.push(`${endpoint} -> ${response.status} ${body.slice(0, 200)}`);
      continue;
    }

    const payload = await response.json();
    const rawRows = getArrayFromApiPayload(payload);
    const normalizedRows = rawRows.map(normalizeTeammate).filter((row): row is NormalizedTeammate => row !== null);
    const skippedMissingEmail = Math.max(0, rawRows.length - normalizedRows.length);
    return {
      endpointUsed: endpoint,
      teammates: mergeByEmail(normalizedRows),
      sourceCount: rawRows.length,
      skippedMissingEmail,
    };
  }

  throw new Error(
    `Unable to fetch Hospitable teammates. Tried: ${errors.join(" | ") || "no endpoints"}`,
  );
}

export async function POST() {
  const { userId, sessionClaims, getToken } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roleFromClaims =
    (sessionClaims?.role as string | undefined) ??
    (sessionClaims?.metadata as { role?: string } | undefined)?.role ??
    (sessionClaims?.publicMetadata as { role?: string } | undefined)?.role;

  if (process.env.NODE_ENV !== "development" && roleFromClaims !== "admin") {
    return NextResponse.json(
      { error: "Only admins can import team members from Hospitable." },
      { status: 403 },
    );
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return NextResponse.json(
      { error: "Missing NEXT_PUBLIC_CONVEX_URL." },
      { status: 500 },
    );
  }

  try {
    const convex = new ConvexHttpClient(convexUrl);
    const convexToken =
      (await getToken({ template: "convex" }).catch(() => null)) ??
      (await getToken());
    if (!convexToken) {
      return NextResponse.json(
        { error: "Unable to authenticate with Convex." },
        { status: 401 },
      );
    }
    convex.setAuth(convexToken);

    const hospitableApiKey =
      process.env.HOSPITABLE_API_KEY ?? process.env.HOSPITABLE_API_TOKEN;
    const { teammates, endpointUsed, sourceCount, skippedMissingEmail } =
      hospitableApiKey
        ? await fetchTeammatesFromHospitable(hospitableApiKey)
        : await convex.action(api.hospitable.actions.listTeammatesForImport, {});

    if (teammates.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No importable teammates were found in Hospitable.",
        summary: {
          sourceCount,
          uniqueByEmail: 0,
          skippedMissingEmail,
          processed: 0,
          createdInClerk: 0,
          updatedInClerk: 0,
          createdInConvex: 0,
          updatedInConvex: 0,
          errors: [],
          endpointUsed,
        } satisfies ImportSummary,
      });
    }

    const clerk = await clerkClient();
    const summary: ImportSummary = {
      sourceCount,
      uniqueByEmail: teammates.length,
      skippedMissingEmail,
      processed: 0,
      createdInClerk: 0,
      updatedInClerk: 0,
      createdInConvex: 0,
      updatedInConvex: 0,
      errors: [],
      endpointUsed,
    };

    for (const teammate of teammates) {
      try {
        const { firstName, lastName } = splitFullName(teammate.fullName);
        const existingUsers = await clerk.users.getUserList({
          emailAddress: [teammate.email],
          limit: 1,
        });

        let clerkUser = existingUsers.data[0];
        if (clerkUser) {
          clerkUser = await clerk.users.updateUser(clerkUser.id, {
            firstName,
            lastName: lastName || undefined,
            publicMetadata: {
              ...(clerkUser.publicMetadata ?? {}),
              role: teammate.appRole,
            },
          });
          summary.updatedInClerk += 1;
        } else {
          try {
            clerkUser = await clerk.users.createUser({
              emailAddress: [teammate.email],
              firstName,
              lastName: lastName || undefined,
              skipPasswordRequirement: true,
              skipPasswordChecks: true,
              publicMetadata: { role: teammate.appRole },
            });
          } catch {
            clerkUser = await clerk.users.createUser({
              emailAddress: [teammate.email],
              firstName,
              lastName: lastName || undefined,
              password: generateTempPassword(),
              skipPasswordChecks: true,
              publicMetadata: { role: teammate.appRole },
            });
          }
          summary.createdInClerk += 1;
        }

        const convexResult = await convex.mutation(
          api.admin.mutations.upsertUserFromDirectory,
          {
            clerkId: clerkUser.id,
            email: teammate.email,
            name: teammate.fullName,
            phone: teammate.phone,
            role: teammate.appRole,
          },
        );

        if (convexResult.created) {
          summary.createdInConvex += 1;
        } else {
          summary.updatedInConvex += 1;
        }

        summary.processed += 1;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown import error.";
        summary.errors.push(`${teammate.email}: ${message}`);
      }
    }

    return NextResponse.json({
      success: summary.errors.length === 0,
      summary,
      message:
        summary.errors.length === 0
          ? `Imported ${summary.processed} teammates.`
          : `Imported ${summary.processed} teammates with ${summary.errors.length} errors.`,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to import teammates from Hospitable.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
