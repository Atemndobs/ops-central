/**
 * Convex usage adapter.
 *
 * State of play (2026-04-26): Convex's team-usage API
 * (`/api/dashboard/teams/{teamId}/usage/team_usage_state`) requires a
 * member-level access token. Service-account / team-scoped tokens get
 * `UsageAccessDenied`. We've confirmed this against api.convex.dev. So:
 *
 *   1. We try the team_usage_state endpoint anyway — if Convex relaxes
 *      the scope or the user provides a member-level token, we'll
 *      automatically pick up the real "Approaching/Exceeded/Disabled"
 *      signal and convert it to a percentage band.
 *   2. On failure, we fall back to **manual configuration**: the user
 *      sets `CONVEX_PLAN_FUNCTION_CALLS_LIMIT` and we render a bar
 *      against `CONVEX_OBSERVED_FUNCTION_CALLS` (set from the Convex
 *      dashboard reading manually, or by a future scrape).
 *
 *   3. If neither the API nor the manual override is configured, we
 *      throw — the action layer logs it as auth_error and the UI shows
 *      "last error" so the operator knows to wire it up.
 */

import type { QuotaSnapshot } from "./types";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function startOfMonthUtcMs(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

function startOfNextMonthUtcMs(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

type DeploymentInfo = { teamId: number; team: string };

async function fetchTeamId(
  token: string,
  deployment: string,
): Promise<DeploymentInfo | null> {
  try {
    const res = await fetch(
      `https://api.convex.dev/api/deployment/${deployment}/team_and_project`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Convex-Client": "opscentral-usage-adapter-1",
        },
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      team?: string;
      teamId?: number;
    };
    if (typeof data.teamId !== "number" || typeof data.team !== "string") {
      return null;
    }
    return { teamId: data.teamId, team: data.team };
  } catch {
    return null;
  }
}

/**
 * Try Convex's team_usage_state endpoint. Returns the qualitative state
 * if the token has scope, otherwise null. The state strings come from
 * the Convex CLI source of truth.
 */
async function fetchTeamUsageState(
  token: string,
  teamId: number,
): Promise<"OK" | "Approaching" | "Exceeded" | "Disabled" | "Paused" | null> {
  try {
    const res = await fetch(
      `https://api.convex.dev/api/dashboard/teams/${teamId}/usage/team_usage_state`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Convex-Client": "opscentral-usage-adapter-1",
        },
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { usageState?: string };
    const state = data.usageState;
    if (
      state === "OK" ||
      state === "Approaching" ||
      state === "Exceeded" ||
      state === "Disabled" ||
      state === "Paused"
    ) {
      return state;
    }
    return null;
  } catch {
    return null;
  }
}

/** Convert a qualitative state to a representative percentage. */
function stateToPct(
  state: "OK" | "Approaching" | "Exceeded" | "Disabled" | "Paused",
): number {
  switch (state) {
    case "OK":
      return 30; // arbitrary "well under" reading
    case "Approaching":
      return 85; // matches our >=80% warning band
    case "Exceeded":
      return 100;
    case "Disabled":
    case "Paused":
      return 110; // shows as red, capped to 100 by clamp on render
  }
}

export async function fetchConvexQuotas(): Promise<QuotaSnapshot[]> {
  const token = process.env.CONVEX_TEAM_TOKEN;
  const deployment =
    process.env.CONVEX_DEPLOYMENT_NAME ?? "usable-anaconda-394";

  const fetchedAt = Date.now();
  const windowStart = startOfMonthUtcMs(fetchedAt);
  const windowEnd = startOfNextMonthUtcMs(fetchedAt);
  const snapshots: QuotaSnapshot[] = [];

  // Path 1: try the team_usage_state API. Works only if the token has
  // member-level scope; service accounts get UsageAccessDenied.
  if (token) {
    const info = await fetchTeamId(token, deployment);
    if (info) {
      const state = await fetchTeamUsageState(token, info.teamId);
      if (state) {
        const pct = stateToPct(state);
        snapshots.push({
          serviceKey: "convex",
          quotaKey: "plan_usage_state",
          used: pct,
          limit: 100,
          unit: "calls", // qualitative — the % IS the value
          windowStart,
          windowEnd,
          fetchedAt,
        });
      }
    }
  }

  // Path 2: manual override. Useful right now because Convex's usage API
  // is service-account-restricted. Set these env vars from the Convex
  // dashboard reading and update them when you check.
  const limitFns = Number(
    process.env.CONVEX_PLAN_FUNCTION_CALLS_LIMIT ?? "0",
  );
  const usedFns = Number(
    process.env.CONVEX_OBSERVED_FUNCTION_CALLS ?? "0",
  );
  if (limitFns > 0) {
    snapshots.push({
      serviceKey: "convex",
      quotaKey: "function_calls_monthly",
      used: usedFns,
      limit: limitFns,
      unit: "calls",
      windowStart,
      windowEnd,
      fetchedAt,
    });
  }

  const limitBwGb = Number(
    process.env.CONVEX_PLAN_BANDWIDTH_GB_LIMIT ?? "0",
  );
  const usedBwGb = Number(process.env.CONVEX_OBSERVED_BANDWIDTH_GB ?? "0");
  if (limitBwGb > 0) {
    snapshots.push({
      serviceKey: "convex",
      quotaKey: "bandwidth_monthly",
      used: usedBwGb * 1024 ** 3,
      limit: limitBwGb * 1024 ** 3,
      unit: "bytes",
      windowStart,
      windowEnd,
      fetchedAt,
    });
  }

  if (snapshots.length === 0) {
    throw new Error(
      "Convex usage unavailable: team-usage API denied access for the supplied token, " +
        "and no CONVEX_PLAN_FUNCTION_CALLS_LIMIT manual override is set. " +
        "See docs/service-usage-monitoring/provider-apis.md for setup.",
    );
  }

  // Reference unused vars to keep the linter happy when the API path
  // is the only one populated.
  void DAY_MS;

  return snapshots;
}
