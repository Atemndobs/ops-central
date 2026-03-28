# Reports Metrics + Exporter v1 Architecture Plan

## Summary
- Replace the placeholder `/reports` page with a Convex-backed operational reporting dashboard (efficiency, quality, team rankings).
- Do not reuse `admin.getAnalytics`; use a dedicated `reports` backend module.
- Implement async export generation in Convex with full-bundle output for `CSV + XLSX + PDF`.
- Enforce backend data scope as `role + company/property assignment` (admin global, non-admin scoped).

## Architecture Decisions
- Keep Next.js as a thin UI layer; metrics, filtering, authorization, and export generation live in Convex.
- Use compute-on-read metrics for v1 with bounded date windows (`7d`, `30d`, `90d`, `custom`).
- Use an async export job lifecycle (`queued -> running -> completed/failed/expired`).
- `Export Data` generates a full report bundle for selected filters.
- Deliver exports in an in-app Download Center.

## Implementation Changes
- Add `reportExports` table in Convex schema with status, scope, artifact metadata, expiry, and audit timestamps.
- Add bounded-query indexes for report workloads (including incident time-based indexes).
- Add Convex reports module:
- `convex/reports/queries.ts` for dashboard metrics and export listing.
- `convex/reports/mutations.ts` for export requests and lifecycle updates.
- `convex/reports/actions.ts` (`"use node"`) for artifact rendering and storage writes.
- Add shared metrics helpers in `convex/reports/lib.ts`.
- Metrics contract:
- Efficiency: completion rate, on-time rate, avg start delay, avg duration, daily trend.
- Quality: status/submission proxy quality score, validation pass rate, incident rate.
- Team rankings: `0.4 * onTime + 0.4 * quality + 0.2 * normalizedVolume`.
- Property readiness: derived from stay + job state (not `properties.status`).
- Scope logic:
- Admin sees all active properties.
- `property_ops` and `manager` are restricted to active company/property assignments.
- Requested property filters are intersected with authorized scope.
- Export renderers:
- CSV bundle as ZIP (multiple section files).
- XLSX workbook with one sheet per section.
- PDF summary report with KPI and table snapshots.
- Export retention:
- Artifact links expire after 24 hours.
- Metadata/audit retained for 30 days via scheduled cleanup.
- UI replacement for `/reports`:
- Live KPI cards, trends, rankings, readiness, incident feed.
- Filter bar (`7d/30d/90d/custom` + property multi-select).
- Export trigger and Download Center with status/errors/download links.

## Public APIs / Interfaces
- `api.reports.queries.getDashboard({ preset, fromTs?, toTs?, propertyIds? })`
- `api.reports.queries.listExports({ limit? })`
- `api.reports.mutations.requestExport({ format, preset, fromTs?, toTs?, propertyIds? })`
- `internal.reports.queries.getExportPayload({ requesterId, preset, fromTs?, toTs?, propertyIds? })`
- `internal.reports.actions.generateExport({ exportId })`
- `internal.reports.mutations.expireExports({ now? })`

## Test Plan
1. Authorization scope checks for admin vs non-admin role visibility.
2. Metric correctness checks (on-time, duration, quality proxy, readiness, ranking composite).
3. Export lifecycle checks (`queued -> running -> completed/failed/expired`).
4. Artifact integrity checks for CSV ZIP, XLSX workbook, and PDF generation.
5. UI flow checks for filters, export submission, status visibility, and download links.

## Defaults
- Goal: Ops Command Center.
- Scope: Ops core bundle.
- Export model: async Convex export jobs.
- Formats: CSV + XLSX + PDF.
- Time filters: `7d/30d/90d/custom`.
- Access: role + company/property scope.
- Delivery: in-app Download Center.
