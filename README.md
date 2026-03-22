# OpsCentral Admin

OpsCentral is the internal operations dashboard for managing properties, cleaning jobs, and day-to-day team workflows.

## Tech Stack

- Next.js 16 (App Router)
- Clerk (authentication + role metadata)
- Convex (database + realtime queries/mutations)
- Tailwind CSS 4

## Features

- Protected dashboard routes with Clerk auth + role-based access checks
- Property management (create, update, archive, photo upload)
- Job management (create, assign cleaner, status workflow progression)
- Live dashboard widgets backed by Convex subscriptions
- Global in-app toast notifications and improved empty/loading/error states

## Prerequisites

- Node.js 20+
- npm 10+
- A Convex deployment
- A Clerk application
- Optional: Cloudinary unsigned upload preset for property image uploads

## Environment Variables

Create `.env.local` from `.env.local.example`.

### Convex

- `NEXT_PUBLIC_CONVEX_URL`
- `CONVEX_DEPLOYMENT`

### Clerk

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL`
- `NEXT_PUBLIC_CLERK_SIGN_UP_URL`
- `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL`
- `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL`

### Cloudinary (optional but required for photo uploads)

- `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_UPLOAD_PRESET`

## Local Development

```bash
npm install
npm run dev
```

## Quality Checks

```bash
npm run lint
npm run build
```

## Convex Notes

- Schema lives in `convex/schema.ts`
- Job, property, and dashboard functions are in:
  - `convex/jobs/*`
  - `convex/properties/*`
  - `convex/dashboard/*`

When schema/query changes are made, regenerate Convex artifacts if needed in your deployment workflow.
