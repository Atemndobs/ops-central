# User Role And Assignment Permissions Matrix

Date: 2026-04-08
Project: `opscentral-admin`

## Summary

The schedule quick-assign warning:

`Your account needs an active cleaning-company manager membership before assigning cleaners.`

applies only to users whose app role is `manager`.

It does not apply to `property_ops` or `admin` users.

## App Roles

The current app-level roles are:

- `cleaner`
- `manager`
- `property_ops`
- `admin`

Source:

- `convex/schema.ts`

## Core Rule

Cleaner assignment and switching are guarded in two layers:

1. The user must have a privileged app role: `admin`, `property_ops`, or `manager`.
2. If the user is a `manager`, they must also have an active `companyMembers` membership with role `manager` or `owner`, and the target property must be assigned to that same cleaning company.

This means:

- `property_ops` can assign or switch cleaners without a cleaning-company membership.
- `admin` can assign or switch cleaners without a cleaning-company membership.
- `manager` can assign or switch cleaners only within their own active company membership scope.

## Permission Matrix

| Capability | `admin` | `property_ops` | `manager` | `cleaner` |
|---|---|---|---|---|
| Open privileged ops actions | Yes | Yes | Yes | No |
| View reports | Yes | Yes | Yes | No |
| View ops dashboard | Yes | Yes | No | No |
| Assign or switch cleaners | Yes | Yes | Yes, conditionally | No |
| Assign property to cleaning company | Yes | Yes | No | No |
| Create or update users | Yes | No | No | No |

## Assignment Rules By Role

| Role | Can assign/switch cleaners | Conditions |
|---|---|---|
| `admin` | Yes | No company-membership restriction in dispatch flow |
| `property_ops` | Yes | No company-membership restriction in dispatch flow |
| `manager` | Yes | Must have an active `companyMembers` row with role `manager` or `owner`, and the property must belong to that same company |
| `cleaner` | No | Not a privileged role |

## Why The Warning Appears

The quick-assign availability query sets a blocked reason only when the actor is effectively treated as a manager and lacks an active manager membership, or when the property is linked to a different company than the manager's membership.

Operationally, if a user is believed to be an ops user but sees this warning, the most likely cause is:

- their `users.role` is `manager`, not `property_ops`

Secondary causes for a real manager:

- no active `companyMembers` row exists
- the active membership is not `manager` or `owner`
- the property is assigned to a different cleaning company
- the property has no active cleaning company assignment

## Verification Checklist For A Specific User

To verify one user who sees this message, check:

1. `users.role`
2. active `companyMembers` rows for that user
3. the active `companyProperties` row for the property being assigned

## Source References

- App roles: `convex/schema.ts`
- Quick-assign blocked reason: `convex/cleaningJobs/queries.ts`
- Dispatch mutation guard: `convex/cleaningJobs/mutations.ts`
- Reports access: `convex/reports/queries.ts`
- Ops dashboard access: `convex/users/queries.ts`
- Property/company assignment permissions: `convex/admin/mutations.ts`
- User management permissions: `convex/admin/mutations.ts`

## Relevant Code Pointers

- `convex/schema.ts:18`
- `convex/cleaningJobs/queries.ts:454`
- `convex/cleaningJobs/mutations.ts:1040`
- `convex/cleaningJobs/mutations.ts:1055`
- `convex/reports/queries.ts:29`
- `convex/users/queries.ts:231`
- `convex/users/queries.ts:279`
- `convex/admin/mutations.ts:61`
- `convex/admin/mutations.ts:234`
- `convex/admin/mutations.ts:492`
