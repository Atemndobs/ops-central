# Cleaning Execution Contracts and Data Model

## Canonical Contract Principles
- Convex is the single business-logic authority shared by admin and mobile.
- Durable job detail and live presence are queried separately.
- Evidence is sealed at submission time and never overwritten in place.
- Server timestamps are authoritative for workflow transitions.

## Mutation Contracts

### `cleaningJobs.mutations.start`
Purpose: cleaner-authoritative start with optional offline provenance.

Request:
```ts
{
  jobId: Id<"cleaningJobs">;
  startedAtDevice?: number;
  offlineStartToken?: string;
}
```

Response:
```ts
{
  jobId: Id<"cleaningJobs">;
  revision: number;
  startedAtServer: number;
  alreadyStarted: boolean;
}
```

Behavior:
- Creates or refreshes a `jobExecutionSessions` row for `(jobId, cleanerId, revision)`.
- Moves job to `in_progress` when allowed.
- Sets `actualStartAt` only if not already set.

### `cleaningJobs.mutations.pingActiveSession`
Purpose: heartbeat for live presence.

Request:
```ts
{ jobId: Id<"cleaningJobs"> }
```

Response:
```ts
{
  jobId: Id<"cleaningJobs">;
  revision: number;
  lastHeartbeatAt: number;
  status: "started" | "submitted" | "excused";
}
```

### `cleaningJobs.mutations.submitForApproval`
Purpose: transition from execution to manager review with sealed evidence.

Request:
```ts
{
  jobId: Id<"cleaningJobs">;
  notes?: string;
  guestReady?: boolean;
  submittedAtDevice?: number;
  qaMode?: "standard" | "quick";
  quickMinimumBefore?: number;
  quickMinimumAfter?: number;
  requiredRooms?: string[];
  skippedRooms?: Array<{ roomName: string; reason: string }>;
  force?: boolean;
}
```

Response:
```ts
{
  ok: boolean;
  gatePassed: boolean;
  jobId: Id<"cleaningJobs">;
  revision: number;
  unresolvedCleanerIds: Id<"users">[];
  submissionId?: Id<"jobSubmissions">;
  validationResult?: {
    mode: "standard" | "quick";
    pass: boolean;
    warnings: string[];
    errors: string[];
    summary: {
      beforeCount: number;
      afterCount: number;
      incidentCount: number;
      missingBeforeRooms: string[];
      missingAfterRooms: string[];
    };
  };
}
```

Behavior:
- Marks actor cleaner session as `submitted` if actor is cleaner.
- Enforces multi-cleaner gate before state transition.
- Runs server-side evidence policy validation.
- Seals immutable submission snapshot and moves job to `awaiting_approval`.

### `cleaningJobs.mutations.complete`
Purpose: temporary compatibility alias during migration.

Behavior:
- Internally routes to `submitForApproval` logic.
- Throws when gate fails.
- Scheduled for removal after both apps migrate.

### `cleaningJobs.approve.approveCompletion`
Purpose: manager/admin finalization.

Request:
```ts
{ jobId: Id<"cleaningJobs">; approvalNotes?: string }
```

Behavior:
- Allowed from `awaiting_approval` only.
- Moves job to `completed`.
- Stores approver identity and timestamp.

### `cleaningJobs.approve.rejectCompletion`
Purpose: reject submission back to rework path.

Request:
```ts
{ jobId: Id<"cleaningJobs">; rejectionReason?: string }
```

Behavior:
- Routes to revisioned reopen logic.
- Increments revision and returns job to `rework_required`.

### `cleaningJobs.approve.reopenCompleted`
Purpose: reopen previously completed work for rework.

Request:
```ts
{ jobId: Id<"cleaningJobs">; reason?: string }
```

Behavior:
- Increments revision.
- Preserves snapshot history; new work occurs on new revision.

## Query Contracts

### `cleaningJobs.queries.getJobDetail` (Durable)
Purpose: low-churn canonical detail for job status, evidence chain, and revisioned history.

Response includes:
- Job + property + cleaner assignments.
- Current revision and timing summary.
- Current evidence grouped by type and room.
- Latest sealed submission evidence snapshot.
- Submission history summaries per revision.

### `cleaningJobs.queries.getJobLivePresence` (Live)
Purpose: high-churn session and heartbeat recency.

Response includes:
- Current revision and stale threshold.
- Session list with `isStale` and heartbeat age.
- Pending cleaner IDs and gate summary counts.

## Data Model Additions

### `cleaningJobs` additions
- `currentRevision?: number`
- `latestSubmissionId?: Id<"jobSubmissions">`

### `jobExecutionSessions`
Fields:
- `jobId`, `revision`, `cleanerId`
- `status`: `started | submitted | excused`
- `startedAtServer`, `startedAtDevice?`
- `submittedAtServer?`, `submittedAtDevice?`
- `lastHeartbeatAt?`
- `offlineStartToken?`
- `metadata?`, `createdAt`, `updatedAt?`

Indexes:
- `by_job_and_revision`
- `by_job_and_cleaner_and_revision`
- `by_job_and_status`

Invariants:
- Session identity is unique per `(jobId, cleanerId, revision)`.
- First valid start establishes server start for that session.
- Session state only advances from started to submitted/excused within revision.

### `jobSubmissions`
Fields:
- `jobId`, `revision`
- `submittedBy?`, `submittedAtServer`, `submittedAtDevice?`
- `status`: `sealed | superseded`
- `photoSnapshot[]`, `checklistSnapshot?`, `incidentSnapshot[]`
- `validationResult`
- `sealedHash`
- `supersededAt?`, `createdAt`

Indexes:
- `by_job`
- `by_job_and_revision`
- `by_job_and_created`

Invariants:
- Snapshot payload is immutable after insert.
- New revision does not overwrite previous revision snapshot.
- `sealedHash` signs snapshot payload integrity for audit and forensics.

## Offline Time Authority and Idempotency Rules
- Authority model:
  - `startedAtServer` and `submittedAtServer` are canonical for SLA and workflow.
  - Device times are audit context only (`startedAtDevice`, `submittedAtDevice`).
- Offline start idempotency:
  - Replayed starts for same `(job, cleaner, revision)` return existing session.
  - Optional `offlineStartToken` can be used by clients for deterministic replay correlation.
- Conflict handling:
  - If device time differs from server time, preserve both values.
  - Admin timelines display server-authoritative values by default.
