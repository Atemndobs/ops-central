// V8-runtime helpers for the PDF action. Live separately from pdf.ts because
// pdf.ts has `"use node"` (pdfkit needs Node), and `"use node"` files can
// only define actions — not queries or mutations.

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

/** Loads everything the PDF renderer needs in one trip, joined with property name. */
export const getStatementForRender = internalQuery({
  args: { statementId: v.id("ownerStatements") },
  handler: async (ctx, args) => {
    const s = await ctx.db.get(args.statementId);
    if (!s) return null;
    const property = await ctx.db.get(s.propertyId);
    return {
      _id: s._id,
      propertyId: s.propertyId,
      propertyName: property?.name ?? "(property)",
      propertyAddress: property?.address ?? "",
      currency: property?.currency ?? "USD",
      periodStart: s.periodStart,
      periodEnd: s.periodEnd,
      snapshotTotals: s.snapshotTotals,
      feeConfigSnapshot: s.feeConfigSnapshot,
      issuedAt: s.issuedAt,
      pdfStorageId: s.pdfStorageId,
    };
  },
});

/**
 * ONLY allowed writer of pdfStorageId on ownerStatements. Documented exception
 * to the "no patching issued statements" rule — PDF fields are post-issue
 * metadata, NOT part of the immutable snapshotTotals.
 */
export const attachPdfToStatement = internalMutation({
  args: {
    statementId: v.id("ownerStatements"),
    storageId: v.id("_storage"),
    templateVersion: v.number(),
  },
  handler: async (ctx, args) => {
    const s = await ctx.db.get(args.statementId);
    if (!s) throw new Error(`Statement ${args.statementId} not found`);
    if (s.status !== "issued") {
      throw new Error(
        `Cannot attach PDF to non-issued statement (status=${s.status})`,
      );
    }
    await ctx.db.patch(args.statementId, {
      pdfStorageId: args.storageId,
      pdfTemplateVersion: args.templateVersion,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});
