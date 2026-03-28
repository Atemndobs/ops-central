import type { Doc, Id } from "../_generated/dataModel";

export type ReportPreset = "7d" | "30d" | "90d" | "custom";
export type ExportFormat = "csv" | "xlsx" | "pdf";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 365;

const QUALITY_RATED_STATUSES = new Set<Doc<"cleaningJobs">["status"]>([
  "completed",
  "awaiting_approval",
  "rework_required",
  "cancelled",
]);
const QUALITY_POSITIVE_STATUSES = new Set<Doc<"cleaningJobs">["status"]>([
  "completed",
  "awaiting_approval",
]);

export type TimeRange = {
  preset: ReportPreset;
  fromTs: number;
  toTs: number;
};

export type TeamRankingRow = {
  userId: Id<"users">;
  name: string;
  completedJobs: number;
  onTimePct: number;
  qualityPct: number;
  normalizedVolumePct: number;
  compositeScore: number;
};

export type ReadinessRow = {
  propertyId: Id<"properties">;
  propertyName: string;
  checkInAt: number;
  status: "ready" | "at_risk";
  sourceJobId: Id<"cleaningJobs"> | null;
};

export function resolveTimeRange(args: {
  preset?: ReportPreset;
  fromTs?: number;
  toTs?: number;
  now?: number;
}): TimeRange {
  const now = args.now ?? Date.now();
  const preset = args.preset ?? "30d";

  if (preset === "custom") {
    const rawFrom = args.fromTs ?? now - 30 * DAY_MS;
    const rawTo = args.toTs ?? now;
    const fromTs = Math.min(rawFrom, rawTo);
    const toTs = Math.max(rawFrom, rawTo);
    const maxWindowStart = now - MAX_RANGE_DAYS * DAY_MS;
    return {
      preset,
      fromTs: Math.max(fromTs, maxWindowStart),
      toTs,
    };
  }

  const days = preset === "7d" ? 7 : preset === "90d" ? 90 : 30;
  return {
    preset,
    fromTs: now - days * DAY_MS,
    toTs: now,
  };
}

export function toDateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function completionTimestamp(job: Doc<"cleaningJobs">): number | null {
  const ts = job.actualEndAt ?? job.approvedAt ?? job.rejectedAt ?? null;
  return typeof ts === "number" ? ts : null;
}

export function calculateEfficiencyMetrics(jobs: Doc<"cleaningJobs">[]) {
  const totalJobs = jobs.length;
  const completedJobs = jobs.filter((job) => job.status === "completed");
  const completedCount = completedJobs.length;
  const completionRate = totalJobs > 0 ? round1((completedCount / totalJobs) * 100) : 0;

  const onTimeEligible = jobs.filter((job) => {
    const completedAt = completionTimestamp(job);
    return typeof completedAt === "number" && typeof job.scheduledEndAt === "number";
  });
  const onTimeCount = onTimeEligible.filter((job) => {
    const completedAt = completionTimestamp(job);
    return typeof completedAt === "number" && completedAt <= job.scheduledEndAt;
  }).length;
  const onTimeRate = onTimeEligible.length > 0
    ? round1((onTimeCount / onTimeEligible.length) * 100)
    : 0;

  const startDelayJobs = jobs.filter(
    (job) => typeof job.actualStartAt === "number" && typeof job.scheduledStartAt === "number",
  );
  const avgStartDelayMinutes = startDelayJobs.length > 0
    ? Math.round(
        startDelayJobs.reduce(
          (sum, job) => sum + (job.actualStartAt! - job.scheduledStartAt),
          0,
        ) /
          startDelayJobs.length /
          (1000 * 60),
      )
    : 0;

  const durationJobs = jobs.filter(
    (job) =>
      typeof job.actualStartAt === "number" &&
      typeof job.actualEndAt === "number" &&
      job.actualEndAt >= job.actualStartAt,
  );
  const avgDurationMinutes = durationJobs.length > 0
    ? Math.round(
        durationJobs.reduce(
          (sum, job) => sum + (job.actualEndAt! - job.actualStartAt!),
          0,
        ) /
          durationJobs.length /
          (1000 * 60),
      )
    : 0;

  return {
    totalJobs,
    completedJobs: completedCount,
    completionRate,
    onTimeRate,
    avgStartDelayMinutes,
    avgDurationMinutes,
  };
}

export function calculateQualityMetrics(args: {
  jobs: Doc<"cleaningJobs">[];
  incidentCount: number;
  validationPassed: number;
  validationTotal: number;
}) {
  const qualityRatedJobs = args.jobs.filter((job) => QUALITY_RATED_STATUSES.has(job.status));
  const qualityPositiveJobs = qualityRatedJobs.filter((job) =>
    QUALITY_POSITIVE_STATUSES.has(job.status),
  );
  const qualityScorePct = qualityRatedJobs.length > 0
    ? round1((qualityPositiveJobs.length / qualityRatedJobs.length) * 100)
    : 0;
  const validationPassRate = args.validationTotal > 0
    ? round1((args.validationPassed / args.validationTotal) * 100)
    : 0;
  const incidentRatePer100Jobs = args.jobs.length > 0
    ? round1((args.incidentCount / args.jobs.length) * 100)
    : 0;

  return {
    qualityScorePct,
    validationPassRate,
    incidentRatePer100Jobs,
    totalIncidents: args.incidentCount,
  };
}

export function buildDailyTrend(args: {
  fromTs: number;
  toTs: number;
  jobs: Doc<"cleaningJobs">[];
  incidents: Doc<"incidents">[];
}) {
  const dayBuckets = new Map<string, {
    date: string;
    totalJobs: number;
    completedJobs: number;
    onTimeEligible: number;
    onTimeCount: number;
    incidents: number;
  }>();

  const startKey = toDateKey(args.fromTs);
  const endKey = toDateKey(args.toTs);
  let cursor = new Date(`${startKey}T00:00:00.000Z`).getTime();
  const endCursor = new Date(`${endKey}T00:00:00.000Z`).getTime();
  while (cursor <= endCursor) {
    const key = toDateKey(cursor);
    dayBuckets.set(key, {
      date: key,
      totalJobs: 0,
      completedJobs: 0,
      onTimeEligible: 0,
      onTimeCount: 0,
      incidents: 0,
    });
    cursor += DAY_MS;
  }

  for (const job of args.jobs) {
    const key = toDateKey(job.scheduledStartAt);
    const bucket = dayBuckets.get(key);
    if (!bucket) continue;

    bucket.totalJobs += 1;
    if (job.status === "completed") {
      bucket.completedJobs += 1;
    }

    const completedAt = completionTimestamp(job);
    if (typeof completedAt === "number" && typeof job.scheduledEndAt === "number") {
      bucket.onTimeEligible += 1;
      if (completedAt <= job.scheduledEndAt) {
        bucket.onTimeCount += 1;
      }
    }
  }

  for (const incident of args.incidents) {
    const key = toDateKey(incident.createdAt);
    const bucket = dayBuckets.get(key);
    if (!bucket) continue;
    bucket.incidents += 1;
  }

  return [...dayBuckets.values()].map((bucket) => ({
    date: bucket.date,
    totalJobs: bucket.totalJobs,
    completedJobs: bucket.completedJobs,
    onTimeRate: bucket.onTimeEligible > 0
      ? round1((bucket.onTimeCount / bucket.onTimeEligible) * 100)
      : 0,
    incidents: bucket.incidents,
  }));
}

export function calculateTeamRankings(args: {
  jobs: Doc<"cleaningJobs">[];
  usersById: Map<Id<"users">, { name?: string | null; email?: string | null }>;
}): TeamRankingRow[] {
  const perCleaner = new Map<Id<"users">, {
    completedJobs: number;
    qualityRated: number;
    qualityPositive: number;
    onTimeEligible: number;
    onTimeCount: number;
  }>();

  for (const job of args.jobs) {
    for (const cleanerId of job.assignedCleanerIds) {
      if (!perCleaner.has(cleanerId)) {
        perCleaner.set(cleanerId, {
          completedJobs: 0,
          qualityRated: 0,
          qualityPositive: 0,
          onTimeEligible: 0,
          onTimeCount: 0,
        });
      }
      const row = perCleaner.get(cleanerId)!;

      if (job.status === "completed") {
        row.completedJobs += 1;
      }
      if (QUALITY_RATED_STATUSES.has(job.status)) {
        row.qualityRated += 1;
      }
      if (QUALITY_POSITIVE_STATUSES.has(job.status)) {
        row.qualityPositive += 1;
      }

      const completedAt = completionTimestamp(job);
      if (typeof completedAt === "number" && typeof job.scheduledEndAt === "number") {
        row.onTimeEligible += 1;
        if (completedAt <= job.scheduledEndAt) {
          row.onTimeCount += 1;
        }
      }
    }
  }

  const volumeValues = [...perCleaner.values()]
    .map((row) => row.completedJobs)
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  const p90 = percentile(volumeValues, 0.9);

  const rankings: TeamRankingRow[] = [...perCleaner.entries()].map(([cleanerId, row]) => {
    const onTimePct = row.onTimeEligible > 0
      ? round1((row.onTimeCount / row.onTimeEligible) * 100)
      : 0;
    const qualityPct = row.qualityRated > 0
      ? round1((row.qualityPositive / row.qualityRated) * 100)
      : 0;
    const normalizedVolumePct = p90 > 0
      ? round1(Math.min(100, (row.completedJobs / p90) * 100))
      : 0;
    const compositeScore = round1(
      0.4 * onTimePct + 0.4 * qualityPct + 0.2 * normalizedVolumePct,
    );

    const user = args.usersById.get(cleanerId);
    const name = user?.name?.trim() || user?.email || "Unknown cleaner";
    return {
      userId: cleanerId,
      name,
      completedJobs: row.completedJobs,
      onTimePct,
      qualityPct,
      normalizedVolumePct,
      compositeScore,
    };
  });

  return rankings
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .slice(0, 50);
}

export function calculateReadiness(args: {
  stays: Doc<"stays">[];
  jobs: Doc<"cleaningJobs">[];
  propertiesById: Map<Id<"properties">, { name: string }>;
}) {
  const jobsByProperty = new Map<Id<"properties">, Doc<"cleaningJobs">[]>();
  for (const job of args.jobs) {
    if (!jobsByProperty.has(job.propertyId)) {
      jobsByProperty.set(job.propertyId, []);
    }
    jobsByProperty.get(job.propertyId)!.push(job);
  }

  for (const list of jobsByProperty.values()) {
    list.sort((a, b) => b.scheduledEndAt - a.scheduledEndAt);
  }

  const rows: ReadinessRow[] = args.stays.map((stay) => {
    const jobs = jobsByProperty.get(stay.propertyId) ?? [];
    const sourceJob =
      jobs.find(
        (job) =>
          job.scheduledEndAt <= stay.checkInAt &&
          job.status !== "cancelled",
      ) ?? null;
    const status = sourceJob && (sourceJob.status === "completed" || sourceJob.status === "awaiting_approval")
      ? "ready"
      : "at_risk";

    return {
      propertyId: stay.propertyId,
      propertyName: args.propertiesById.get(stay.propertyId)?.name ?? "Unknown property",
      checkInAt: stay.checkInAt,
      status,
      sourceJobId: sourceJob?._id ?? null,
    };
  });

  const readyCount = rows.filter((row) => row.status === "ready").length;
  const atRiskCount = rows.length - readyCount;

  return {
    nextCheckins: rows.length,
    readyCount,
    atRiskCount,
    rows,
  };
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];
  const idx = Math.floor((values.length - 1) * quantile);
  return values[idx] ?? 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
