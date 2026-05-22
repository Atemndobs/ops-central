// Owner-portal notification fan-out (Wave 3c).
//
// Inserts `notifications` rows + schedules push send via the existing
// `internal.notifications.actions.sendPushForNotificationInternal` path.
// Honors `ownerNotificationPrefs` per-event toggle on the `push` channel.
//
// Email/SMS dispatch deferred to Wave 3d (no Resend client wired yet). The
// in-app inbox + push covers the immediate UX gap.

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";

type OwnerEvent = "owner_statement_issued" | "owner_approval_request" | "owner_incident_reported";

const EVENT_PREF_FIELD: Record<OwnerEvent, keyof Pick<
  Doc<"ownerNotificationPrefs">,
  "statementIssued" | "approvalRequest" | "incidentReport"
>> = {
  owner_statement_issued: "statementIssued",
  owner_approval_request: "approvalRequest",
  owner_incident_reported: "incidentReport",
};

/** Returns the userIds of all currently-active owners on a property. */
async function activeOwnerUserIds(
  ctx: MutationCtx,
  propertyId: Id<"properties">,
): Promise<Id<"users">[]> {
  const rows = await ctx.db
    .query("propertyOwners")
    .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
    .collect();
  return rows
    .filter((r) => r.effectiveTo === undefined)
    .map((r) => r.userId);
}

/** Returns true iff the user opted in to receiving this event on the push channel. */
async function pushEnabled(
  ctx: MutationCtx,
  userId: Id<"users">,
  event: OwnerEvent,
): Promise<boolean> {
  const pref = await ctx.db
    .query("ownerNotificationPrefs")
    .withIndex("by_user_and_channel", (q) =>
      q.eq("userId", userId).eq("channel", "push"),
    )
    .first();
  if (!pref) return true; // default-ON: no row means "not yet configured" → fan out
  return pref[EVENT_PREF_FIELD[event]];
}

/**
 * Insert a notification row for each recipient and (if push prefs allow)
 * schedule the existing push-send action. Helper used by both
 * `notifyStatementIssued` and `notifyApprovalRequest`.
 */
async function fanOut(
  ctx: MutationCtx,
  recipients: Id<"users">[],
  payload: {
    type: OwnerEvent;
    title: string;
    message: string;
    data?: Record<string, unknown>;
  },
): Promise<Id<"notifications">[]> {
  const ids: Id<"notifications">[] = [];
  const now = Date.now();
  for (const userId of recipients) {
    const notificationId = await ctx.db.insert("notifications", {
      userId,
      type: payload.type,
      title: payload.title,
      message: payload.message,
      data: payload.data,
      pushSent: false,
      createdAt: now,
    });
    ids.push(notificationId);

    if (await pushEnabled(ctx, userId, payload.type)) {
      await ctx.scheduler.runAfter(
        0,
        internal.notifications.actions.sendPushForNotificationInternal,
        { notificationId },
      );
    }
  }
  return ids;
}

// ─── Public fan-out helpers ────────────────────────────────────────────────

/** Called from `issueOwnerStatement`. Notifies all active owners on the property. */
export async function notifyStatementIssued(
  ctx: MutationCtx,
  args: {
    statementId: Id<"ownerStatements">;
    propertyId: Id<"properties">;
    month: string;
    propertyName: string;
    ownerPayout: number;
    currency: string;
  },
): Promise<{ notified: number }> {
  const recipients = await activeOwnerUserIds(ctx, args.propertyId);
  if (recipients.length === 0) return { notified: 0 };

  const payoutLabel = `${args.currency} ${args.ownerPayout.toFixed(2)}`;
  await fanOut(ctx, recipients, {
    type: "owner_statement_issued",
    title: `Statement ready for ${args.propertyName}`,
    message: `Your ${args.month} statement is ready. Owner payout: ${payoutLabel}.`,
    data: {
      statementId: args.statementId,
      propertyId: args.propertyId,
      month: args.month,
      // For in-app deep-link routing on the cleaners/web side:
      href: `/owner/properties/${args.propertyId}/statements/${args.statementId}`,
    },
  });
  return { notified: recipients.length };
}

/** Called from `createMaintenanceApprovalRequest`. Notifies the primary approver. */
export async function notifyApprovalRequest(
  ctx: MutationCtx,
  args: {
    requestId: Id<"maintenanceApprovalRequests">;
    propertyId: Id<"properties">;
    propertyName: string;
    proposedCost: number;
    currency: string;
    description: string;
  },
): Promise<{ notified: number }> {
  // Primary approver only (per spec §7.1). Co-owners get notified on the
  // decision, not the request.
  const owners = await ctx.db
    .query("propertyOwners")
    .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
    .collect();
  const primary = owners.find(
    (o) => o.effectiveTo === undefined && o.isPrimaryApprover,
  );
  if (!primary) return { notified: 0 };

  const costLabel = `${args.currency} ${args.proposedCost.toFixed(2)}`;
  const shortDesc =
    args.description.length > 80
      ? args.description.slice(0, 77) + "…"
      : args.description;

  await fanOut(ctx, [primary.userId], {
    type: "owner_approval_request",
    title: `Approval needed: ${args.propertyName}`,
    message: `${costLabel} maintenance request — ${shortDesc}`,
    data: {
      requestId: args.requestId,
      propertyId: args.propertyId,
      proposedCost: args.proposedCost,
      href: `/owner/properties/${args.propertyId}/approvals/${args.requestId}`,
    },
  });
  return { notified: 1 };
}

/**
 * Called from `decideMaintenanceApprovalRequest`. Notifies co-owners (active
 * owners other than the decider) so they have an audit trail of who decided
 * what. Per spec §11.
 */
export async function notifyApprovalDecided(
  ctx: MutationCtx,
  args: {
    requestId: Id<"maintenanceApprovalRequests">;
    propertyId: Id<"properties">;
    propertyName: string;
    deciderUserId: Id<"users">;
    decision: "approved" | "declined" | "auto_approved";
    proposedCost: number;
    currency: string;
  },
): Promise<{ notified: number }> {
  const recipients = (await activeOwnerUserIds(ctx, args.propertyId)).filter(
    (id) => id !== args.deciderUserId,
  );
  if (recipients.length === 0) return { notified: 0 };

  const costLabel = `${args.currency} ${args.proposedCost.toFixed(2)}`;
  const verb =
    args.decision === "approved"
      ? "approved"
      : args.decision === "auto_approved"
        ? "auto-approved (SLA)"
        : "declined";

  await fanOut(ctx, recipients, {
    type: "owner_approval_request",
    title: `Decision: ${args.propertyName}`,
    message: `${costLabel} maintenance request was ${verb}.`,
    data: {
      requestId: args.requestId,
      propertyId: args.propertyId,
      decision: args.decision,
    },
  });
  return { notified: recipients.length };
}
