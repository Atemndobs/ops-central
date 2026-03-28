import { v } from "convex/values";
import { internalQuery, query, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireRole } from "../lib/auth";
import {
  buildDailyTrend,
  calculateEfficiencyMetrics,
  calculateQualityMetrics,
  calculateReadiness,
  calculateTeamRankings,
  resolveTimeRange,
  type ReportPreset,
} from "./lib";

const reportPresetValidator = v.union(
  v.literal("7d"),
  v.literal("30d"),
  v.literal("90d"),
  v.literal("custom"),
);

const dashboardArgsValidator = {
  preset: v.optional(reportPresetValidator),
  fromTs: v.optional(v.number()),
  toTs: v.optional(v.number()),
  propertyIds: v.optional(v.array(v.id("properties"))),
};

const roleAllowedForReports: Doc<"users">["role"][] = ["admin", "property_ops", "manager"];

type DashboardArgs = {
  preset?: ReportPreset;
  fromTs?: number;
  toTs?: number;
  propertyIds?: Id<"properties">[];
};

export const getDashboard = query({
  args: dashboardArgsValidator,
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, roleAllowedForReports);
    return await buildDashboardData(ctx, user, args);
  },
});

export const listExports = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, roleAllowedForReports);
    const now = Date.now();
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit ?? 20)));

    const rows = await ctx.db
      .query("reportExports")
      .withIndex("by_requested_by_and_created_at", (q) => q.eq("requestedBy", user._id))
      .order("desc")
      .take(limit);

    const entries = await Promise.all(
      rows.map(async (row) => {
        const isActiveDownload = row.status === "completed" && typeof row.expiresAt === "number" && row.expiresAt > now;
        const downloadUrl =
          isActiveDownload && row.storageId
            ? await ctx.storage.getUrl(row.storageId)
            : null;

        return {
          _id: row._id,
          status: row.status,
          format: row.format,
          fileName: row.fileName ?? null,
          byteSize: row.byteSize ?? null,
          rowCount: row.rowCount ?? null,
          error: row.error ?? null,
          createdAt: row.createdAt,
          startedAt: row.startedAt ?? null,
          finishedAt: row.finishedAt ?? null,
          expiresAt: row.expiresAt ?? null,
          downloadUrl,
        };
      }),
    );

    return {
      generatedAt: now,
      entries,
    };
  },
});

export const getExportPayload = internalQuery({
  args: {
    requesterId: v.id("users"),
    preset: reportPresetValidator,
    fromTs: v.optional(v.number()),
    toTs: v.optional(v.number()),
    propertyIds: v.optional(v.array(v.id("properties"))),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.requesterId);
    if (!user) {
      throw new Error("Requester not found for export generation.");
    }
    if (!roleAllowedForReports.includes(user.role)) {
      throw new Error("Requester is not authorized for report exports.");
    }

    return await buildDashboardData(ctx, user, args);
  },
});

export const getExportById = internalQuery({
  args: {
    exportId: v.id("reportExports"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.exportId);
  },
});

async function buildDashboardData(
  ctx: QueryCtx,
  user: Doc<"users">,
  args: DashboardArgs,
) {
  const range = resolveTimeRange({
    preset: args.preset,
    fromTs: args.fromTs,
    toTs: args.toTs,
  });
  const now = Date.now();

  const authorizedPropertyIds = await getAuthorizedPropertyIds(ctx, user);
  const selectedPropertyIds = intersectPropertyScope(authorizedPropertyIds, args.propertyIds);
  const selectedPropertySet = new Set(selectedPropertyIds);

  const availableProperties = await Promise.all(
    authorizedPropertyIds.map((propertyId) => ctx.db.get(propertyId)),
  );
  const availablePropertyRows = availableProperties
    .filter((property): property is NonNullable<typeof property> => property !== null)
    .map((property) => ({ _id: property._id, name: property.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (selectedPropertyIds.length === 0) {
    return {
      generatedAt: now,
      range,
      scope: {
        availableProperties: availablePropertyRows,
        selectedPropertyIds: [] as Id<"properties">[],
      },
      summary: {
        efficiency: {
          totalJobs: 0,
          completedJobs: 0,
          completionRate: 0,
          onTimeRate: 0,
          avgStartDelayMinutes: 0,
          avgDurationMinutes: 0,
        },
        quality: {
          qualityScorePct: 0,
          validationPassRate: 0,
          incidentRatePer100Jobs: 0,
          totalIncidents: 0,
        },
        readiness: {
          nextCheckins: 0,
          readyCount: 0,
          atRiskCount: 0,
        },
      },
      trends: {
        daily: [],
      },
      teamRankings: [],
      tables: {
        readiness: [],
        incidents: [],
      },
    };
  }

  const jobsInWindow = await ctx.db
    .query("cleaningJobs")
    .withIndex("by_scheduled", (q) =>
      q.gte("scheduledStartAt", range.fromTs).lt("scheduledStartAt", range.toTs),
    )
    .collect();
  const jobs = jobsInWindow.filter((job) => selectedPropertySet.has(job.propertyId));
  const jobIds = new Set(jobs.map((job) => job._id));

  const incidentsInWindow = await ctx.db
    .query("incidents")
    .withIndex("by_created_at", (q) => q.gte("createdAt", range.fromTs).lt("createdAt", range.toTs))
    .collect();
  const incidents = incidentsInWindow.filter((incident) => selectedPropertySet.has(incident.propertyId));

  const upcomingStays = await ctx.db
    .query("stays")
    .withIndex("by_checkin", (q) => q.gte("checkInAt", now).lt("checkInAt", now + 24 * 60 * 60 * 1000))
    .collect();
  const stays = upcomingStays.filter((stay) => selectedPropertySet.has(stay.propertyId));

  const propertyDocs = await Promise.all(
    selectedPropertyIds.map((propertyId) => ctx.db.get(propertyId)),
  );
  const propertiesById = new Map(
    propertyDocs
      .filter((property): property is NonNullable<typeof property> => property !== null)
      .map((property) => [property._id, { name: property.name }] as const),
  );

  const latestSubmissionIds = [...new Set(jobs.map((job) => job.latestSubmissionId).filter(Boolean))] as Id<"jobSubmissions">[];
  const latestSubmissions = await Promise.all(
    latestSubmissionIds.map((submissionId) => ctx.db.get(submissionId)),
  );
  const submissionById = new Map(
    latestSubmissions
      .filter((submission): submission is NonNullable<typeof submission> => submission !== null)
      .map((submission) => [submission._id, submission] as const),
  );

  const validationRows = jobs
    .map((job) => (job.latestSubmissionId ? submissionById.get(job.latestSubmissionId) ?? null : null))
    .filter((submission): submission is NonNullable<typeof submission> => submission !== null);
  const validationPassed = validationRows.filter((row) => row.validationResult.pass).length;
  const validationTotal = validationRows.length;

  const cleanerIds = [...new Set(jobs.flatMap((job) => job.assignedCleanerIds))];
  const cleanerDocs = await Promise.all(cleanerIds.map((userId) => ctx.db.get(userId)));
  const usersById = new Map(
    cleanerDocs
      .filter((cleaner): cleaner is NonNullable<typeof cleaner> => cleaner !== null)
      .map((cleaner) => [cleaner._id, { name: cleaner.name, email: cleaner.email }] as const),
  );

  const efficiency = calculateEfficiencyMetrics(jobs);
  const quality = calculateQualityMetrics({
    jobs,
    incidentCount: incidents.length,
    validationPassed,
    validationTotal,
  });
  const readiness = calculateReadiness({
    stays,
    jobs,
    propertiesById,
  });
  const daily = buildDailyTrend({
    fromTs: range.fromTs,
    toTs: range.toTs,
    jobs,
    incidents,
  });
  const teamRankings = calculateTeamRankings({
    jobs,
    usersById,
  });

  return {
    generatedAt: now,
    range,
    scope: {
      availableProperties: availablePropertyRows,
      selectedPropertyIds,
    },
    summary: {
      efficiency,
      quality,
      readiness: {
        nextCheckins: readiness.nextCheckins,
        readyCount: readiness.readyCount,
        atRiskCount: readiness.atRiskCount,
      },
    },
    trends: {
      daily,
    },
    teamRankings,
    tables: {
      readiness: readiness.rows,
      incidents: incidents.map((incident) => ({
        incidentId: incident._id,
        propertyId: incident.propertyId,
        title: incident.title,
        incidentType: incident.incidentType,
        severity: incident.severity ?? null,
        status: incident.status,
        createdAt: incident.createdAt,
        cleaningJobId: incident.cleaningJobId ?? null,
        inSelectedJobWindow: incident.cleaningJobId
          ? jobIds.has(incident.cleaningJobId)
          : false,
      })),
    },
  };
}

async function getAuthorizedPropertyIds(
  ctx: QueryCtx,
  user: Doc<"users">,
): Promise<Id<"properties">[]> {
  if (user.role === "admin") {
    const properties = await ctx.db
      .query("properties")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();
    return properties.map((property) => property._id);
  }

  const memberships = await ctx.db
    .query("companyMembers")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .collect();
  const activeMemberships = memberships.filter(
    (membership) => membership.isActive && membership.leftAt === undefined,
  );
  const companyIds = [...new Set(activeMemberships.map((membership) => membership.companyId))];
  if (companyIds.length === 0) {
    return [];
  }

  const companyAssignments = await Promise.all(
    companyIds.map((companyId) =>
      ctx.db
        .query("companyProperties")
        .withIndex("by_company", (q) => q.eq("companyId", companyId))
        .collect(),
    ),
  );
  const propertyIds = companyAssignments
    .flat()
    .filter((assignment) => assignment.isActive !== false && assignment.unassignedAt === undefined)
    .map((assignment) => assignment.propertyId);

  return [...new Set(propertyIds)];
}

function intersectPropertyScope(
  authorized: Id<"properties">[],
  requested: Id<"properties">[] | undefined,
): Id<"properties">[] {
  if (!requested || requested.length === 0) {
    return authorized;
  }
  const authorizedSet = new Set(authorized);
  return requested.filter((propertyId) => authorizedSet.has(propertyId));
}
