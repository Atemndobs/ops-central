# Phase 2: User Preference Model — Completion Summary

## Overview
Phase 2 establishes the backend infrastructure for user locale preferences, enabling persistent, role-based locale management with Clerk integration.

## What Was Completed

### 1. Database Schema Extension ✅
- **File**: `convex/schema.ts`
- **Change**: Added `preferredLocale?: "en" | "es"` field to users table
- **Purpose**: Store each user's explicit locale preference

### 2. Convex API Layer ✅

#### Query
- **File**: `convex/users/queries.ts`
- **Function**: `getLocalePreference`
- **Returns**: User's saved locale, role, and last update timestamp
- **Usage**: Read current locale preference from backend

#### Mutations
- **File**: `convex/users/mutations.ts`
- **Functions**:
  - `setLocalePreference(locale)`: Updates user's locale and syncs to Clerk
  - `ensureUser()`: Modified to assign role-based default locale on user creation

### 3. Clerk Integration ✅

#### Backfill Sync
- **File**: `src/app/api/webhooks/clerk/backfill/route.ts`
- **Changes**: 
  - Reads `locale` from Clerk publicMetadata
  - Passes locale to Convex sync mutation
  - Enables importing user locale preferences from Clerk

#### Clerk Sync Mutation
- **File**: `convex/admin/userSync.ts`
- **Changes**:
  - Accepts `locale` parameter in directory users
  - Updates user's `preferredLocale` if Clerk has new value
  - Applies role-based defaults when creating new users

#### Clerk Write Action
- **File**: `convex/clerk/actions.ts`
- **Function**: `syncLocalePreferenceToClerk`
- **Purpose**: Sync locale changes back to Clerk publicMetadata
- **Called by**: `setLocalePreference` mutation via scheduler

### 4. Role-Based Locale Defaults ✅
- **Cleaner** → Spanish (es)
- **Admin, property_ops, manager** → English (en)
- **Applied in**:
  - `ensureUser()` mutation when creating new users
  - `reconcileWithClerk()` when syncing from Clerk
  - Can be overridden by explicit Clerk locale value

### 5. Locale Resolver with Preference Precedence ✅
- **File**: `src/i18n.ts`
- **Precedence** (highest to lowest):
  1. **Saved user preference** (from Convex database)
  2. **Cookie preference** (NEXT_LOCALE)
  3. **Role-based default** (from user's role)
  4. **App default** (English)

**Implementation**:
- Uses Clerk auth context to identify user
- Fetches saved preference from Convex in server component
- Falls back gracefully if Convex fetch fails
- Respects unauthenticated users (uses cookie only)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                        │
│  i18n.ts (getRequestConfig)                                 │
│  ├─ Check: Saved preference (Convex query)                 │
│  ├─ Check: Cookie (NEXT_LOCALE)                            │
│  ├─ Check: Role-based default                              │
│  └─ Check: App default (en)                                │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              Convex Backend (Shared)                         │
│                                                              │
│  Users Table                                                │
│  ├─ preferredLocale (en | es | null)                       │
│  └─ clerkId (links to Clerk)                               │
│                                                              │
│  Queries                                                    │
│  └─ getLocalePreference() → { locale, role }              │
│                                                              │
│  Mutations                                                  │
│  ├─ setLocalePreference(locale) → sync to Clerk            │
│  ├─ ensureUser() → role-based defaults                     │
│  └─ reconcileWithClerk() → read from Clerk                 │
│                                                              │
│  Actions                                                    │
│  └─ syncLocalePreferenceToClerk() → write to Clerk API    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│            Clerk Auth & Metadata                             │
│  publicMetadata.locale (en | es | null)                    │
│  ├─ Read by backfill sync                                  │
│  └─ Updated by Convex actions                              │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow Examples

### User Creates Account
1. Clerk creates user with role (from publicMetadata.role)
2. `ensureUser` mutation runs
3. User gets role-based default locale
4. Locale saved to Convex users.preferredLocale
5. If Clerk has locale in publicMetadata, it's synced

### User Changes Locale Preference
1. Frontend calls `setLocalePreference(newLocale)` mutation
2. Mutation updates Convex database
3. Mutation schedules background action
4. Action calls Clerk API to update publicMetadata.locale
5. Cookie updated on frontend (for future sessions)
6. Next request uses new locale

### Next App Load
1. `getRequestConfig()` runs on server
2. Gets user's Clerk ID from auth()
3. Fetches saved preference via `getLocalePreference` query
4. If saved preference exists → use it
5. Else if cookie exists → use it
6. Else use role-based default
7. Else use app default (English)

## Files Modified/Created

### New Files
- `convex/clerk/actions.ts` — Clerk sync action
- `PHASE2_TEST_PLAN.md` — Testing guide
- `PHASE2_COMPLETION_SUMMARY.md` — This file

### Modified Files
- `convex/schema.ts` — Added preferredLocale field
- `convex/users/queries.ts` — Added getLocalePreference query
- `convex/users/mutations.ts` — Added setLocalePreference, updated ensureUser
- `convex/admin/userSync.ts` — Added locale sync logic
- `src/app/api/webhooks/clerk/backfill/route.ts` — Added locale reading
- `src/i18n.ts` — Enhanced locale resolver with preference precedence

## Testing Checklist

- ✅ TypeScript compilation passes (no type errors)
- ✅ Next.js build succeeds
- ✅ Convex codegen completes without errors
- ✅ Schema includes preferredLocale field
- ✅ getLocalePreference query exists in API
- ✅ setLocalePreference mutation exists in API
- ✅ Role-based defaults implemented
- ✅ Clerk sync action created
- ✅ Locale resolver updated with precedence logic

## Ready for Next Phase

Phase 2 foundation is complete. The system can now:
- Store and retrieve user locale preferences
- Sync preferences with Clerk
- Apply role-based defaults
- Resolve locale in correct precedence order

**Next Phase (Phase 3)**: Cleaner-first UI localization will build on this foundation to localize the cleaner-facing UI surfaces.

## Notes for Developers

1. **Clerk Sync**: Always run Clerk backfill webhook after schema changes
2. **Precedence**: Locale resolution runs on every request (server-side)
3. **Clerk API**: `CLERK_SECRET_KEY` env var required for sync action
4. **Fallbacks**: System gracefully handles Convex fetch failures
5. **Unauthenticated**: Non-authenticated users can still use cookie preference
