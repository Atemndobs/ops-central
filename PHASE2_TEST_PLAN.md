# Phase 2 Testing Plan

## User Preference Model Testing

### Test 1: Verify Schema Extension
- ✅ users table has `preferredLocale` field added
- ✅ preferredLocale is optional Union<"en", "es">

### Test 2: Test Convex Queries and Mutations
- Run: `npx convex dev`
- Test query: `getLocalePreference` returns user's locale and role
- Test mutation: `setLocalePreference` updates preferredLocale and syncs to Clerk

### Test 3: Verify Clerk Sync (Backfill)
- Test that `reconcileWithClerk` reads locale from Clerk publicMetadata
- Test that new users created from Clerk sync get role-based defaults:
  - Cleaners → "es"
  - Admin/property_ops/manager → "en"

### Test 4: Verify Role-Based Defaults
- When creating a new user:
  - Via `ensureUser` mutation: applies role-based default
  - Via Clerk sync: applies role-based default
  - Explicit locale from Clerk: uses provided locale

### Test 5: Test Locale Resolver Precedence
- Load root layout and verify locale resolution works:
  1. Saved preference (from Convex) ← highest priority
  2. Cookie preference
  3. Role-based default
  4. App default (English) ← lowest priority

### Test 6: Test Locale Sync Back to Clerk
- Call `setLocalePreference` mutation
- Verify Clerk publicMetadata.locale gets updated via the scheduled action
- Check Clerk dashboard to confirm metadata update

## Test Execution Steps

### Manual Testing
1. Start dev environment: `npm run dev`
2. Create test user or log in as existing user
3. Call `getLocalePreference` query via Convex console
4. Call `setLocalePreference` mutation with new locale
5. Verify locale is persisted in Convex
6. Check Clerk webhook logs for sync confirmation

### Automated Testing
- [ ] Unit tests for locale helpers (formatDate, statusLabels, etc.)
- [ ] Integration test for preference persistence
- [ ] E2E test for complete flow with Clerk sync

## Success Criteria
- ✅ Phase 2 foundation complete
- [ ] All queries and mutations work correctly
- [ ] Clerk sync reads and writes locale metadata
- [ ] Locale resolver respects precedence order
- [ ] No TypeScript errors in build
- [ ] Locale preference persists across sessions
