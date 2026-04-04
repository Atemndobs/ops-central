# Mobile App Photo Upload Architecture

## Scope

This document maps the sibling Expo cleaner mobile app at:

- `/Users/atem/sites/jnabusiness_solutions/apps-ja/jna-cleaners-app`

It is separate from the PWA and should be documented separately because it has its own capture stack, upload service abstraction, and rollout path toward external object storage.

## Upload Surface Inventory

| Surface | Entry point | Upload abstraction | Persistence |
| --- | --- | --- | --- |
| Active job before/after photos | `app/(cleaner)/active/[id].tsx` | `useJobPhotoUpload()` -> `photoUploadService` | `photos` table |
| Active job incident photos | `app/(cleaner)/active/[id].tsx` | `useJobPhotoUpload()` -> `photoUploadService` | `photos` table then incident photo IDs |
| Standalone incident report | `app/(cleaner)/report-incident.tsx` | direct `generateUploadUrl()` | raw `_storage` IDs in incident |
| Generic upload utilities | `hooks/useConvexFileUpload.ts`, `utils/fileUpload.ts` | same shared service | depends on chosen mode |

## Architecture Overview

```mermaid
flowchart TD
    subgraph MobileUI["Expo mobile UI"]
        A["PhotoCapture component"]
        B["Active job screen"]
        C["Standalone report-incident screen"]
    end

    subgraph UploadAbstraction["Upload abstraction"]
        D["useConvexFileUpload hook"]
        E["photoUploadService"]
        F["utils/fileUpload helpers"]
    end

    subgraph Backend["Shared Convex backend"]
        G["files.generateUploadUrl()"]
        H["files.uploadJobPhoto()"]
        I["files.getExternalUploadUrl()"]
        J["files.completeExternalUpload()"]
        K["photos table"]
        L["incidents.createIncident()"]
    end

    subgraph Storage["Storage targets"]
        M["Convex _storage"]
        N["External object store (B2/R2-style signed PUT)"]
    end

    A --> B --> D --> E
    B --> F --> E
    C --> G
    E --> G --> M --> H --> K
    E -. external mode .-> I --> N --> J --> K
    B --> L
    C --> L
```

## Capture Layer

The mobile app has a capture stack that the PWA does not have:

- `components/PhotoCapture.tsx`
  - uses `expo-image-picker`
  - supports camera and photo library
  - stamps a timestamp by rendering an off-screen view and capturing it with `react-native-view-shot`
- `utils/fileUpload.ts`
  - compresses images with `expo-image-manipulator`
  - exposes helpers for single, multiple, before/after pair, and incident uploads

```mermaid
sequenceDiagram
    participant User
    participant Capture as PhotoCapture
    participant Picker as Expo ImagePicker
    participant Stamp as react-native-view-shot
    participant Hook as useJobPhotoUpload
    participant Service as photoUploadService

    User->>Capture: take photo / choose from library
    Capture->>Picker: launchCameraAsync or launchImageLibraryAsync
    Picker-->>Capture: local file URI
    Capture->>Stamp: render off-screen image + timestamp overlay
    Stamp-->>Capture: stamped URI
    Capture->>Hook: uploadPhoto(jobId, uri, type, room)
    Hook->>Service: uploadPhoto(...)
```

## Upload Strategy Modes

The mobile app already has an explicit upload strategy abstraction:

- `legacy`
  - `files.generateUploadUrl()`
  - upload bytes to Convex `_storage`
  - `files.uploadJobPhoto()`
- `external`
  - `files.getExternalUploadUrl()`
  - upload bytes directly to signed external URL
  - `files.completeExternalUpload()`
- `auto`
  - try external first
  - fallback to legacy on failure

```mermaid
flowchart TD
    Start["photoUploadService.uploadPhoto()"]
    Mode{"mode"}

    Start --> Mode
    Mode -->|legacy| Legacy["uploadLegacyPhoto()"]
    Mode -->|external| External["uploadExternalPhoto()"]
    Mode -->|auto| TryExternal["try uploadExternalPhoto()"]
    TryExternal -->|success| Done["return photoId + url + storageTier"]
    TryExternal -->|failure| Fallback["fallback to uploadLegacyPhoto()"]

    Legacy --> Convex1["generateUploadUrl() -> POST -> uploadJobPhoto()"]
    External --> Convex2["getExternalUploadUrl() -> PUT -> completeExternalUpload()"]
    Fallback --> Convex1

    Convex1 --> Done
    Convex2 --> Done
```

## Active Job Flow

```mermaid
sequenceDiagram
    participant Screen as active/[id].tsx
    participant Queue as local upload queue
    participant Hook as useJobPhotoUpload
    participant Service as photoUploadService
    participant Convex as files mutations
    participant DB as photos table

    Screen->>Queue: add pending upload item
    Screen->>Screen: drainUploadQueue()
    Screen->>Hook: uploadPhoto(jobId, uri, type, room)
    Hook->>Service: uploadPhoto(...)

    alt legacy path
        Service->>Convex: generateUploadUrl()
        Service->>Convex: uploadJobPhoto()
    else external path
        Service->>Convex: getExternalUploadUrl()
        Service->>Convex: completeExternalUpload()
    end

    Convex->>DB: insert photos row
    DB-->>Screen: photoId
    Screen->>Queue: mark success
```

## Standalone Incident Flow

This path is still legacy and separate.

```mermaid
sequenceDiagram
    participant Screen as report-incident.tsx
    participant Convex as files.generateUploadUrl()
    participant Storage as Convex _storage upload URL
    participant Incident as incidents.createIncident()
    participant DB as incidents table

    Screen->>Convex: generateUploadUrl()
    Convex-->>Screen: signed upload URL
    Screen->>Storage: POST image blob
    Storage-->>Screen: storageId
    Screen->>Incident: createIncident(photoStorageIds=[storageId])
    Incident->>DB: insert incident
```

## Why Mobile Needs A Separate Document

```mermaid
flowchart LR
    PWA["Cleaner PWA"]
    Mobile["Expo mobile app"]

    PWA --> PWA1["Browser File API"]
    PWA --> PWA2["IndexedDB queue"]
    PWA --> PWA3["No strategy toggle"]

    Mobile --> M1["Expo camera/library"]
    Mobile --> M2["URI + compression pipeline"]
    Mobile --> M3["legacy/external/auto modes"]

    PWA1 -. different .- M1
    PWA2 -. different .- M2
    PWA3 -. different .- M3
```

## Shared Back-End Contracts With Mobile

```mermaid
flowchart TD
    A["Mobile service"]
    B["files.generateUploadUrl"]
    C["files.uploadJobPhoto"]
    D["files.getExternalUploadUrl"]
    E["files.completeExternalUpload"]
    F["files.getPhotoUrl / getPhotoAccessUrl"]
    G["resolvePhotoAccessUrl"]
    H["photos table"]

    A --> B --> C --> H
    A --> D --> E --> H
    H --> G --> F
```

## Key Findings

- Mobile and PWA share the same Convex data model but not the same client architecture.
- Mobile is already built around an upload service boundary. That is a real architectural seam we do not have in the PWA.
- Mobile already anticipates external object storage, while the PWA still uses the simpler legacy Convex storage path.
- The standalone incident screen in mobile is still a special-case legacy path and should stay documented separately until it is normalized.
