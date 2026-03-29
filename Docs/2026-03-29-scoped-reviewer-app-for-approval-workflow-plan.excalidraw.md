# Excalidraw Companion: Scoped Reviewer App for Approval Workflow

Use this board for stakeholder walkthroughs.

## Frames
1. Current state: shared `/jobs` + `/jobs/[id]/photos-review` reviewer path.
2. Target state: dedicated `/review` shell and route tree.
3. Reviewer decision flow:
   - queue -> detail -> photo review annotations -> approve/reject/reopen.
4. Backend contract boundary:
   - UI uses `getReviewQueue`, `getReviewJobDetail`, decision mutations, and `getMyNotifications`.

## Suggested elements
- Swimlanes: Reviewer UI, Convex, Data tables.
- Status color legend: awaiting_approval (indigo), rework_required (red), completed (green).
- Callouts for non-goals: no schema-breaking migration, no `/jobs` removal in v1.
