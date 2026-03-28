"use node";

import { Buffer } from "node:buffer";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import JSZip from "jszip";
import PDFDocument from "pdfkit";
import * as XLSX from "xlsx";

type DashboardPayload = {
  generatedAt: number;
  range: {
    preset: string;
    fromTs: number;
    toTs: number;
  };
  summary: {
    efficiency: {
      totalJobs: number;
      completedJobs: number;
      completionRate: number;
      onTimeRate: number;
      avgStartDelayMinutes: number;
      avgDurationMinutes: number;
    };
    quality: {
      qualityScorePct: number;
      validationPassRate: number;
      incidentRatePer100Jobs: number;
      totalIncidents: number;
    };
    readiness: {
      nextCheckins: number;
      readyCount: number;
      atRiskCount: number;
    };
  };
  trends: {
    daily: Array<{
      date: string;
      totalJobs: number;
      completedJobs: number;
      onTimeRate: number;
      incidents: number;
    }>;
  };
  teamRankings: Array<{
    name: string;
    completedJobs: number;
    onTimePct: number;
    qualityPct: number;
    normalizedVolumePct: number;
    compositeScore: number;
  }>;
  tables: {
    readiness: Array<{
      propertyName: string;
      checkInAt: number;
      status: "ready" | "at_risk";
    }>;
    incidents: Array<{
      title: string;
      incidentType: string;
      severity: string | null;
      status: string;
      createdAt: number;
      inSelectedJobWindow: boolean;
    }>;
  };
};

export const generateExport = internalAction({
  args: {
    exportId: v.id("reportExports"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const exportRow = await ctx.runQuery(internal.reports.queries.getExportById, {
      exportId: args.exportId,
    });
    if (!exportRow || exportRow.status !== "queued") {
      return { skipped: true };
    }

    await ctx.runMutation(internal.reports.mutations.markExportRunning, {
      exportId: args.exportId,
      startedAt: now,
    });

    try {
      const payload = await ctx.runQuery(internal.reports.queries.getExportPayload, {
        requesterId: exportRow.requestedBy,
        preset: exportRow.scope.preset,
        fromTs: exportRow.scope.fromTs,
        toTs: exportRow.scope.toTs,
        propertyIds: exportRow.scope.propertyIds,
      }) as DashboardPayload;

      const renderResult = await renderByFormat(exportRow.format, payload);
      const storageId = await ctx.storage.store(
        new Blob([new Uint8Array(renderResult.bytes)], { type: renderResult.mimeType }),
      );

      const finishedAt = Date.now();
      const expiresAt = finishedAt + 24 * 60 * 60 * 1000;
      const rowCount =
        payload.trends.daily.length +
        payload.teamRankings.length +
        payload.tables.readiness.length +
        payload.tables.incidents.length;

      await ctx.runMutation(internal.reports.mutations.markExportCompleted, {
        exportId: args.exportId,
        storageId,
        mimeType: renderResult.mimeType,
        fileName: renderResult.fileName,
        byteSize: renderResult.bytes.byteLength,
        rowCount,
        finishedAt,
        expiresAt,
      });

      return {
        exportId: args.exportId,
        status: "completed" as const,
      };
    } catch (error) {
      const finishedAt = Date.now();
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.reports.mutations.markExportFailed, {
        exportId: args.exportId,
        error: message,
        finishedAt,
      });
      throw error;
    }
  },
});

async function renderByFormat(
  format: "csv" | "xlsx" | "pdf",
  payload: DashboardPayload,
): Promise<{ bytes: Buffer; mimeType: string; fileName: string }> {
  const stamp = new Date(payload.generatedAt).toISOString().replace(/[:.]/g, "-");
  if (format === "csv") {
    const bytes = await renderCsvBundle(payload);
    return {
      bytes,
      mimeType: "application/zip",
      fileName: `reports-${stamp}.zip`,
    };
  }

  if (format === "xlsx") {
    const bytes = renderXlsx(payload);
    return {
      bytes,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileName: `reports-${stamp}.xlsx`,
    };
  }

  const bytes = await renderPdf(payload);
  return {
    bytes,
    mimeType: "application/pdf",
    fileName: `reports-${stamp}.pdf`,
  };
}

async function renderCsvBundle(payload: DashboardPayload): Promise<Buffer> {
  const zip = new JSZip();

  const summaryRows = [
    {
      generatedAt: new Date(payload.generatedAt).toISOString(),
      preset: payload.range.preset,
      fromTs: payload.range.fromTs,
      toTs: payload.range.toTs,
      totalJobs: payload.summary.efficiency.totalJobs,
      completedJobs: payload.summary.efficiency.completedJobs,
      completionRate: payload.summary.efficiency.completionRate,
      onTimeRate: payload.summary.efficiency.onTimeRate,
      avgStartDelayMinutes: payload.summary.efficiency.avgStartDelayMinutes,
      avgDurationMinutes: payload.summary.efficiency.avgDurationMinutes,
      qualityScorePct: payload.summary.quality.qualityScorePct,
      validationPassRate: payload.summary.quality.validationPassRate,
      incidentRatePer100Jobs: payload.summary.quality.incidentRatePer100Jobs,
      totalIncidents: payload.summary.quality.totalIncidents,
      nextCheckins: payload.summary.readiness.nextCheckins,
      readyCount: payload.summary.readiness.readyCount,
      atRiskCount: payload.summary.readiness.atRiskCount,
    },
  ];

  const readinessRows = payload.tables.readiness.map((row) => ({
    propertyName: row.propertyName,
    checkInAt: new Date(row.checkInAt).toISOString(),
    readinessStatus: row.status,
  }));

  const incidentRows = payload.tables.incidents.map((row) => ({
    title: row.title,
    incidentType: row.incidentType,
    severity: row.severity ?? "",
    status: row.status,
    createdAt: new Date(row.createdAt).toISOString(),
    inSelectedJobWindow: row.inSelectedJobWindow ? "yes" : "no",
  }));

  zip.file("summary.csv", toCsv(summaryRows));
  zip.file("daily_trend.csv", toCsv(payload.trends.daily));
  zip.file("team_rankings.csv", toCsv(payload.teamRankings));
  zip.file("property_readiness.csv", toCsv(readinessRows));
  zip.file("incidents.csv", toCsv(incidentRows));

  const arrayBuffer = await zip.generateAsync({ type: "arraybuffer" });
  return Buffer.from(arrayBuffer);
}

function renderXlsx(payload: DashboardPayload): Buffer {
  const workbook = XLSX.utils.book_new();

  const summaryRows = [
    {
      generatedAt: new Date(payload.generatedAt).toISOString(),
      preset: payload.range.preset,
      fromTs: payload.range.fromTs,
      toTs: payload.range.toTs,
      totalJobs: payload.summary.efficiency.totalJobs,
      completedJobs: payload.summary.efficiency.completedJobs,
      completionRate: payload.summary.efficiency.completionRate,
      onTimeRate: payload.summary.efficiency.onTimeRate,
      avgStartDelayMinutes: payload.summary.efficiency.avgStartDelayMinutes,
      avgDurationMinutes: payload.summary.efficiency.avgDurationMinutes,
      qualityScorePct: payload.summary.quality.qualityScorePct,
      validationPassRate: payload.summary.quality.validationPassRate,
      incidentRatePer100Jobs: payload.summary.quality.incidentRatePer100Jobs,
      totalIncidents: payload.summary.quality.totalIncidents,
      nextCheckins: payload.summary.readiness.nextCheckins,
      readyCount: payload.summary.readiness.readyCount,
      atRiskCount: payload.summary.readiness.atRiskCount,
    },
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), "Summary");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(payload.trends.daily), "DailyTrend");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(payload.teamRankings), "TeamRankings");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(payload.tables.readiness), "Readiness");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(payload.tables.incidents), "Incidents");

  const arrayBuffer = XLSX.write(workbook, {
    type: "array",
    bookType: "xlsx",
  }) as ArrayBuffer;
  return Buffer.from(arrayBuffer);
}

function renderPdf(payload: DashboardPayload): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 40,
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).text("OpsCentral Reports Export", { align: "left" });
    doc.moveDown(0.5);
    doc
      .fontSize(10)
      .text(`Generated: ${new Date(payload.generatedAt).toISOString()}`)
      .text(`Range preset: ${payload.range.preset}`)
      .text(`From: ${new Date(payload.range.fromTs).toISOString()}`)
      .text(`To: ${new Date(payload.range.toTs).toISOString()}`);

    doc.moveDown();
    doc.fontSize(14).text("Efficiency");
    doc
      .fontSize(11)
      .text(`Total jobs: ${payload.summary.efficiency.totalJobs}`)
      .text(`Completed jobs: ${payload.summary.efficiency.completedJobs}`)
      .text(`Completion rate: ${payload.summary.efficiency.completionRate}%`)
      .text(`On-time rate: ${payload.summary.efficiency.onTimeRate}%`)
      .text(`Avg start delay: ${payload.summary.efficiency.avgStartDelayMinutes} min`)
      .text(`Avg duration: ${payload.summary.efficiency.avgDurationMinutes} min`);

    doc.moveDown();
    doc.fontSize(14).text("Quality");
    doc
      .fontSize(11)
      .text(`Quality score: ${payload.summary.quality.qualityScorePct}%`)
      .text(`Validation pass rate: ${payload.summary.quality.validationPassRate}%`)
      .text(`Incident rate: ${payload.summary.quality.incidentRatePer100Jobs} per 100 jobs`)
      .text(`Total incidents: ${payload.summary.quality.totalIncidents}`);

    doc.moveDown();
    doc.fontSize(14).text("Property Readiness (next 24h)");
    doc
      .fontSize(11)
      .text(`Upcoming check-ins: ${payload.summary.readiness.nextCheckins}`)
      .text(`Ready: ${payload.summary.readiness.readyCount}`)
      .text(`At risk: ${payload.summary.readiness.atRiskCount}`);

    doc.moveDown();
    doc.fontSize(14).text("Top Team Rankings");
    payload.teamRankings.slice(0, 10).forEach((row, index) => {
      doc
        .fontSize(10)
        .text(
          `${index + 1}. ${row.name} | Composite ${row.compositeScore}% | On-time ${row.onTimePct}% | Quality ${row.qualityPct}% | Completed ${row.completedJobs}`,
        );
    });

    doc.end();
  });
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return "";
  }
  const columns = Object.keys(rows[0]);
  const header = columns.join(",");
  const body = rows.map((row) =>
    columns
      .map((column) => escapeCsvValue(row[column]))
      .join(","),
  );
  return [header, ...body].join("\n");
}

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}
