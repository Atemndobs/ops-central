# Cleaner PWA Photo Upload Architecture

## Scope

This document covers every upload touch point inside the cleaner PWA:

- before photos
- after photos
- in-job incident photos
- standalone incident photos
- cleaner profile avatar

This is the most complex upload path in the repo because it mixes browser capture, offline queueing, Convex storage, and two different incident persistence strategies.

## Upload Surface Inventory

| Surface | Entry point | Queue/offline | Final persistence |
| --- | --- | --- | --- |
| Before photos in active job | `src/components/cleaner/cleaner-active-job-client.tsx` | Yes, IndexedDB queue | `photos` table via `files.uploadJobPhoto` |
| After photos in active job | `src/components/cleaner/cleaner-active-job-client.tsx` | Yes, IndexedDB queue | `photos` table via `files.uploadJobPhoto` |
| In-job incident photos | `src/components/cleaner/cleaner-active-job-client.tsx` | Yes, same queue | `photos` table first, then `incidents.photoIds` |
| Standalone incident screen, linked to a job | `src/components/cleaner/cleaner-incident-page-client.tsx` | No | `photos` table first, then `incidents.photoIds` |
| Standalone incident screen, property-only | `src/components/cleaner/cleaner-incident-page-client.tsx` | No | `_storage` IDs directly in `incidents.photoIds` |
| Cleaner avatar in settings | `src/components/cleaner/cleaner-settings-client.tsx` | No | `users.avatarUrl` string |

## Architecture Overview

```mermaid
flowchart TD
    subgraph PWA["Cleaner PWA browser"]
        A["Active job wizard"]
        B["Standalone incident form"]
        C["Cleaner settings avatar"]
        D["IndexedDB pendingUploads"]
        E["Canvas timestamp stamping"]
    end

    subgraph Convex["Shared Convex backend"]
        G["files.generateUploadUrl()"]
        H["files.uploadJobPhoto()"]
        I["incidents.createIncident()"]
        J["photos table"]
        K["incidents table"]
        L["users.updateMyProfile()"]
    end

    subgraph BrowserStorage["Browser APIs"]
        F["File / Blob / FileReader"]
    end

    A --> F --> E --> D
    D --> G --> H --> J
    A --> I --> K
    B --> G
    B --> H
    B --> I
    C --> E
    C --> L
```

## Detailed Flow: Active Job Before/After Photos

```mermaid
sequenceDiagram
    participant User
    participant UI as cleaner-active-job-client
    participant Blob as fileToDataUrl + dataUrlToBlob
    participant Stamp as stampImageWithTimestamp
    participant IDB as IndexedDB pendingUploads
    participant Convex as files.generateUploadUrl
    participant Upload as Convex upload URL
    participant Meta as files.uploadJobPhoto
    participant DB as photos table

    User->>UI: choose image file
    UI->>Blob: read File as data URL
    Blob->>Stamp: stamp timestamp into pixels
    Stamp-->>UI: stamped data URL
    UI->>IDB: upsert pending upload
    UI->>UI: enqueue in React state

    alt browser is online
        UI->>Convex: generateUploadUrl()
        Convex-->>UI: signed upload URL
        UI->>Upload: POST blob bytes
        Upload-->>UI: { storageId }
        UI->>Meta: uploadJobPhoto(storageId, jobId, roomName, type)
        Meta->>DB: insert photo record
        DB-->>UI: photoId
        UI->>IDB: delete pending upload
    else browser is offline
        UI->>IDB: keep pending upload for later drain
    end
```

## Queue Model

```mermaid
flowchart LR
    F["File input"]
    R["fileToDataUrl()"]
    S["stampImageWithTimestamp()"]
    Q["PendingUpload record"]
    IDB["IndexedDB pendingUploads store"]
    DR["drainQueue()"]
    ST["status: pending -> syncing -> failed/success"]

    F --> R --> S --> Q --> IDB --> DR --> ST
```

## In-Job Incident Photos

```mermaid
flowchart TD
    A["Incident photo added inside active job"]
    B["Queued as PendingUpload with type=incident"]
    C["drainQueue uploads bytes"]
    D["files.uploadJobPhoto inserts photos row"]
    E["localPhotoIds rewritten from temp upload ID to photoId"]
    F["submitForApproval flow calls incidents.createIncident(photoIds)"]
    G["incidents table stores photoIds"]

    A --> B --> C --> D --> E --> F --> G
```

## Standalone Incident Flows

```mermaid
flowchart TD
    Start["CleanerIncidentPageClient submitIncident()"]
    Mode{"reportMode"}

    Start --> Mode

    Mode -->|job-linked| JobUpload["uploadIncidentPhotos()"]
    JobUpload --> Gen1["files.generateUploadUrl()"]
    Gen1 --> Post1["POST file bytes"]
    Post1 --> Meta1["files.uploadJobPhoto()"]
    Meta1 --> PhotoIds["photoIds[]"]
    PhotoIds --> Incident1["incidents.createIncident(photoIds)"]

    Mode -->|standalone property| StandaloneUpload["uploadStandalonePhotos()"]
    StandaloneUpload --> Gen2["files.generateUploadUrl()"]
    Gen2 --> Post2["POST file bytes"]
    Post2 --> StorageIds["photoStorageIds[]"]
    StorageIds --> Incident2["incidents.createIncident(photoStorageIds)"]
```

## Critical Distinction: Job-Linked vs Standalone Incident

```mermaid
flowchart LR
    A["Job-linked incident"] --> B["Creates photos records"]
    B --> C["Incident references photoIds"]

    D["Standalone incident"] --> E["Does not create photos records"]
    E --> F["Incident references raw _storage IDs"]
```

That distinction matters because:

- job-linked incident photos participate in the normal `photos` read path
- standalone incident photos skip the `photos` table entirely
- review and evidence tooling are therefore more consistent for job-linked incidents than for standalone incidents

## Read-Side Touch Points

```mermaid
flowchart TD
    P["photos table"]
    U["resolvePhotoAccessUrl()"]
    Q1["cleaningJobs/queries.getJobDetail"]
    Q2["files/queries.getPhotoUrl / getPhotoAccessUrl"]
    V1["Cleaner job detail / active job"]
    V2["Admin job detail / photo review"]
    V3["Submission snapshots"]

    P --> U --> Q1 --> V1
    P --> U --> Q2 --> V2
    P --> U --> Q1 --> V3
```

## Cleaner Avatar Path

```mermaid
sequenceDiagram
    participant User
    participant Settings as cleaner-settings-client
    participant Helper as uploadImageFile()
    participant Canvas
    participant Convex as users.updateMyProfile
    participant DB as users table

    User->>Settings: choose avatar file
    Settings->>Helper: uploadImageFile(file)
    Helper->>Canvas: resize to <= 512px and encode JPEG data URL
    Canvas-->>Settings: data URL
    User->>Settings: save profile
    Settings->>Convex: updateMyProfile({ avatarUrl })
    Convex->>DB: patch users.avatarUrl
```

## Touch Points By File

```mermaid
flowchart TD
    A["src/components/cleaner/cleaner-active-job-client.tsx"]
    B["src/components/cleaner/cleaner-incident-page-client.tsx"]
    C["src/components/cleaner/cleaner-settings-client.tsx"]
    D["src/features/cleaner/offline/indexeddb.ts"]
    E["src/features/cleaner/offline/blob.ts"]
    F["convex/files/mutations.ts"]
    G["convex/files/queries.ts"]
    H["convex/incidents/mutations.ts"]
    I["convex/cleaningJobs/queries.ts"]
    J["convex/lib/photoUrls.ts"]

    A --> D
    A --> E
    A --> F
    A --> H
    B --> F
    B --> H
    C --> F
    F --> J --> G
    F --> I
```

## Key Findings

- The active-job wizard is the canonical PWA evidence pipeline.
- The PWA has a real offline queue, but only for the active-job flow.
- The standalone incident screen bypasses the queue entirely.
- Standalone incidents are still hybrid and can store raw `_storage` IDs instead of `photoId`s.
- Cleaner avatars are an unrelated URL-string flow and do not share the evidence pipeline.
