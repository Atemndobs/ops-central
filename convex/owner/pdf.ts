"use node";

// Server-rendered owner-statement PDF.
//
// Convex action (Node runtime) — pdfkit isn't isomorphic. Invoked by the
// `issueOwnerStatement` mutation via ctx.scheduler.runAfter(0, ...). Reads
// the issued statement, renders bytes with pdfkit, stores them, then runs
// `internal.owner.pdf.attachPdfToStatement` to patch the pdfStorageId.
//
// Template versioning: bump TEMPLATE_VERSION whenever the visual layout
// changes. Existing rows' pdfTemplateVersion freezes which template
// generated their bytes — supports re-render workflows on bug fixes.
//
// Spec §13b. Wave 3b follow-up.

import { Buffer } from "node:buffer";
import { v } from "convex/values";
import PDFDocument from "pdfkit";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { internalAction, type ActionCtx } from "../_generated/server";

const TEMPLATE_VERSION = 1;

type RenderResult = {
  storageId: Id<"_storage">;
  skipped: boolean;
};

// ─── Action: render + store + patch ────────────────────────────────────────
// Companion internalQuery + internalMutation live in pdfHelpers.ts (V8 runtime).
// Explicit Promise<RenderResult> return type breaks a circular-inference loop
// between api.d.ts and this action.

export const renderOwnerStatementPdf = internalAction({
  args: { statementId: v.id("ownerStatements") },
  handler: async (ctx: ActionCtx, args): Promise<RenderResult> => {
    const statement = await ctx.runQuery(
      internal.owner.pdfHelpers.getStatementForRender,
      { statementId: args.statementId },
    );
    if (!statement) {
      throw new Error(`Statement ${args.statementId} not found`);
    }
    if (statement.pdfStorageId) {
      // Already rendered. Idempotent: skip silently.
      return { storageId: statement.pdfStorageId, skipped: true };
    }

    const bytes = await renderPdfBytes(statement);
    const storageId = await ctx.storage.store(
      new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
    );

    await ctx.runMutation(internal.owner.pdfHelpers.attachPdfToStatement, {
      statementId: args.statementId,
      storageId,
      templateVersion: TEMPLATE_VERSION,
    });

    return { storageId, skipped: false };
  },
});

// ─── pdfkit rendering ───────────────────────────────────────────────────────

type RenderInput = {
  propertyName: string;
  propertyAddress: string;
  currency: string;
  periodStart: number;
  periodEnd: number;
  snapshotTotals: {
    grossRevenue: number;
    platformFees: number;
    netRevenue: number;
    costsByBucket: Array<{ bucket: string; amount: number }>;
    operatingCosts: number;
    noi: number;
    feeBase: string;
    feePct: number;
    mgmtFee: number;
    ownerPayout: number;
    capExMemo: number;
    perOwner: Array<{ stakePct: number; payout: number }>;
  };
  feeConfigSnapshot: {
    feePct: number;
    feeBase: string;
    effectiveFrom: number;
  };
  issuedAt?: number;
};

async function renderPdfBytes(input: RenderInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const fmt = formatter(input.currency);
    const periodLabel = `${ymd(input.periodStart)} – ${ymd(input.periodEnd - 1)}`;

    // Header
    doc.fontSize(20).text("Owner Statement", { align: "left" });
    doc
      .fontSize(11)
      .fillColor("#666")
      .text(input.propertyName, { align: "left" })
      .text(input.propertyAddress, { align: "left" })
      .text(`Period: ${periodLabel}`, { align: "left" });
    doc.moveDown();
    doc.fillColor("#000");

    // Revenue
    doc.fontSize(13).text("Revenue", { underline: true }).moveDown(0.25);
    row(doc, "Gross Revenue", fmt(input.snapshotTotals.grossRevenue));
    row(doc, "Platform Fees", fmt(-input.snapshotTotals.platformFees));
    row(doc, "Net Revenue", fmt(input.snapshotTotals.netRevenue), { bold: true });
    doc.moveDown();

    // Operating costs
    doc.fontSize(13).text("Operating Costs", { underline: true }).moveDown(0.25);
    for (const c of input.snapshotTotals.costsByBucket) {
      row(doc, bucketLabel(c.bucket), fmt(-c.amount));
    }
    row(doc, "Total Operating Costs", fmt(-input.snapshotTotals.operatingCosts), {
      bold: true,
    });
    doc.moveDown();

    // NOI + fee
    doc.fontSize(13).text("Profit & Management Fee", { underline: true }).moveDown(0.25);
    row(doc, "Net Operating Income (NOI)", fmt(input.snapshotTotals.noi), {
      bold: true,
    });
    row(
      doc,
      `Management Fee (${(input.feeConfigSnapshot.feePct * 100).toFixed(1)}% of ${input.feeConfigSnapshot.feeBase})`,
      fmt(-input.snapshotTotals.mgmtFee),
    );
    row(doc, "Owner Payout", fmt(input.snapshotTotals.ownerPayout), { bold: true });
    doc.moveDown();

    // Memo
    if (input.snapshotTotals.capExMemo > 0) {
      doc
        .fontSize(10)
        .fillColor("#666")
        .text(
          `Memo: Capital expenditures in period = ${fmt(input.snapshotTotals.capExMemo)}. ` +
            `Not subtracted from owner payout.`,
          { align: "left" },
        );
      doc.fillColor("#000");
      doc.moveDown();
    }

    // Per-owner split (if >1 owner)
    if (input.snapshotTotals.perOwner.length > 1) {
      doc
        .fontSize(13)
        .text("Per-Owner Split", { underline: true })
        .moveDown(0.25);
      for (const p of input.snapshotTotals.perOwner) {
        row(doc, `${(p.stakePct * 100).toFixed(1)}% stake`, fmt(p.payout));
      }
      doc.moveDown();
    }

    // Footer
    doc
      .fontSize(8)
      .fillColor("#888")
      .text(
        `Generated ${new Date(input.issuedAt ?? Date.now()).toISOString().slice(0, 10)} • ` +
          `Template v${TEMPLATE_VERSION} • J&A Business Solutions`,
        { align: "center" },
      );

    doc.end();
  });
}

function row(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  opts: { bold?: boolean } = {},
) {
  doc.fontSize(11);
  if (opts.bold) doc.font("Helvetica-Bold");
  else doc.font("Helvetica");
  const y = doc.y;
  doc.text(label, 48, y, { width: 320, continued: false });
  doc.text(value, 48 + 320, y, { width: 200, align: "right" });
  doc.font("Helvetica");
  doc.moveDown(0.2);
}

function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function formatter(currency: string): (n: number) => string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format;
  } catch {
    return (n) => `${currency} ${n.toFixed(2)}`;
  }
}

function bucketLabel(bucket: string): string {
  const labels: Record<string, string> = {
    lease: "Lease / Rent",
    cleaning: "Cleaning",
    supplies: "Supplies & Restocks",
    utilities: "Utilities",
    maintenance: "Maintenance & Repairs",
    lawnPoolOutdoor: "Lawn / Pool / Outdoor",
    platformFees: "Platform Fees",
    subscriptions: "Software & Subscriptions",
    labor: "Labor & Contractors",
    insurance: "Insurance",
    taxes: "Taxes",
    managementFee: "Management Fee",
    other: "Other / Adjustments",
  };
  return labels[bucket] ?? bucket;
}
