#!/bin/bash
# verify-mobile-api-compat.sh
#
# Pre-deploy check: verifies that all Convex functions expected by the mobile app
# (jna-cleaners-app) still exist in the backend (opscentral-admin).
#
# Run this BEFORE deploying Convex to catch breaking changes.
#
# Usage: bash scripts/verify-mobile-api-compat.sh

set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MOBILE_DIR="$(cd "$BACKEND_DIR/../jna-cleaners-app" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=========================================="
echo " Convex Mobile API Compatibility Check"
echo "=========================================="
echo ""
echo "Backend:  $BACKEND_DIR/convex/"
echo "Mobile:   $MOBILE_DIR/"
echo ""

ERRORS=0
WARNINGS=0

# --- Check 1: Verify critical exported functions exist ---
echo "--- Check 1: Critical function exports ---"

check_fn() {
  local FILE="$1"
  local FUNC="$2"
  local PURPOSE="$3"
  local FULL_PATH="$BACKEND_DIR/convex/$FILE"

  if [ ! -f "$FULL_PATH" ]; then
    echo -e "  ${RED}FAIL${NC} $FILE — file missing (needed for $PURPOSE)"
    ERRORS=$((ERRORS + 1))
  elif ! grep -q "export const $FUNC" "$FULL_PATH"; then
    echo -e "  ${RED}FAIL${NC} $FILE → $FUNC — not found (needed for $PURPOSE)"
    ERRORS=$((ERRORS + 1))
  else
    echo -e "  ${GREEN}OK${NC}   $FILE → $FUNC"
  fi
}

# Photo upload pipeline (photoUploadService.ts)
check_fn "files/mutations.ts" "generateUploadUrl" "photo upload URL generation"
check_fn "files/mutations.ts" "uploadJobPhoto" "saving photo record after upload"
check_fn "files/mutations.ts" "deleteJobPhoto" "deleting photos"
check_fn "files/queries.ts" "getFileUrl" "resolving storage file URLs"
check_fn "files/queries.ts" "getPhotoUrl" "resolving photo URLs"
check_fn "files/queries.ts" "getPhotoAccessUrl" "resolving signed photo URLs"

# External upload (optional but used in auto mode)
check_fn "files/mutations.ts" "getExternalUploadUrl" "external storage upload"
check_fn "files/mutations.ts" "completeExternalUpload" "external upload completion"

# Job queries (useConvexJobs.ts)
check_fn "cleaningJobs/queries.ts" "getById" "loading single job"
check_fn "cleaningJobs/queries.ts" "getAll" "listing all jobs"
check_fn "cleaningJobs/queries.ts" "getForCleaner" "cleaner's assigned jobs"

# Job mutations (useConvexJobs.ts)
check_fn "cleaningJobs/mutations.ts" "start" "starting a job"
check_fn "cleaningJobs/mutations.ts" "complete" "completing a job"
check_fn "cleaningJobs/mutations.ts" "submitForApproval" "submitting job for approval"

# Job approval (useConvexJobs.ts)
check_fn "cleaningJobs/approve.ts" "approveCompletion" "approving completed jobs"

# Incidents (active/[id].tsx)
check_fn "incidents/mutations.ts" "createIncident" "reporting incidents"

# Job checks (active/[id].tsx)
check_fn "jobChecks/queries.ts" "getForJob" "loading critical/refill checks"
check_fn "jobChecks/mutations.ts" "recordCheckpointResult" "saving checkpoint results"

echo ""

# --- Check 2: Verify mobile API modules exist in backend ---
echo "--- Check 2: Mobile API module references ---"

MOBILE_API="$MOBILE_DIR/convex/_generated/api.d.ts"

if [ ! -f "$MOBILE_API" ]; then
  echo -e "  ${RED}FAIL${NC} Mobile app has no generated API types"
  ERRORS=$((ERRORS + 1))
else
  # Extract module paths from import statements like: import type * as foo_bar from "../foo/bar.js";
  MISSING=0
  while IFS= read -r line; do
    # Extract the path after "../" and before ".js"
    MODULE=$(echo "$line" | sed -n 's/.*from "\.\.\///p' | sed 's/\.js".*$//')
    [ -z "$MODULE" ] && continue

    if [ ! -f "$BACKEND_DIR/convex/$MODULE.ts" ]; then
      echo -e "  ${RED}FAIL${NC} Mobile expects '$MODULE' but not found in backend"
      ERRORS=$((ERRORS + 1))
      MISSING=$((MISSING + 1))
    fi
  done < <(grep 'import type.*from "\.\.' "$MOBILE_API")

  if [ $MISSING -eq 0 ]; then
    echo -e "  ${GREEN}OK${NC}   All mobile API modules exist in backend"
  fi
fi

echo ""

# --- Check 3: Schema table check ---
echo "--- Check 3: Required schema tables ---"

SCHEMA_FILE="$BACKEND_DIR/convex/schema.ts"
REQUIRED_TABLES=(
  "cleaningJobs"
  "photos"
  "users"
  "properties"
  "incidents"
  "propertyCriticalCheckpoints"
)

if [ ! -f "$SCHEMA_FILE" ]; then
  echo -e "  ${RED}FAIL${NC} No schema.ts found"
  ERRORS=$((ERRORS + 1))
else
  for TABLE in "${REQUIRED_TABLES[@]}"; do
    if grep -qE "(defineTable|\"$TABLE\"|$TABLE:)" "$SCHEMA_FILE" && grep -q "$TABLE" "$SCHEMA_FILE"; then
      echo -e "  ${GREEN}OK${NC}   Table '$TABLE'"
    else
      echo -e "  ${RED}FAIL${NC} Table '$TABLE' not in schema (mobile depends on it)"
      ERRORS=$((ERRORS + 1))
    fi
  done
fi

echo ""

# --- Check 4: Auth configuration ---
echo "--- Check 4: Auth configuration ---"

if [ -f "$BACKEND_DIR/convex/auth.config.ts" ] || [ -f "$BACKEND_DIR/convex/auth.config.js" ]; then
  echo -e "  ${GREEN}OK${NC}   Auth config exists"
else
  echo -e "  ${YELLOW}WARN${NC} No auth.config found — mobile app uses Clerk auth"
  WARNINGS=$((WARNINGS + 1))
fi

# Check Clerk domain consistency
MOBILE_CLERK_KEY=$(grep "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY" "$MOBILE_DIR/app.json" 2>/dev/null || true)
if [ -z "$MOBILE_CLERK_KEY" ]; then
  # Check eas.json instead
  MOBILE_CLERK_KEY=$(grep "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY" "$MOBILE_DIR/../../apps-ja/jna-cleaners-app/eas.json" 2>/dev/null | head -1 || true)
fi

AUTH_CONFIG_FILE=""
[ -f "$BACKEND_DIR/convex/auth.config.ts" ] && AUTH_CONFIG_FILE="$BACKEND_DIR/convex/auth.config.ts"
[ -f "$BACKEND_DIR/convex/auth.config.js" ] && AUTH_CONFIG_FILE="$BACKEND_DIR/convex/auth.config.js"

if [ -n "$AUTH_CONFIG_FILE" ]; then
  if grep -q "clerk" "$AUTH_CONFIG_FILE"; then
    echo -e "  ${GREEN}OK${NC}   Auth config references Clerk"
  else
    echo -e "  ${YELLOW}WARN${NC} Auth config doesn't mention Clerk — mobile uses Clerk"
    WARNINGS=$((WARNINGS + 1))
  fi
fi

echo ""
echo "=========================================="

if [ $ERRORS -gt 0 ]; then
  echo -e "  ${RED}BLOCKED${NC}: $ERRORS error(s), $WARNINGS warning(s)"
  echo ""
  echo "  DO NOT deploy until errors are fixed."
  echo "  The mobile app will break if these functions/tables are missing."
  echo "=========================================="
  exit 1
elif [ $WARNINGS -gt 0 ]; then
  echo -e "  ${YELLOW}PASSED WITH WARNINGS${NC}: $WARNINGS warning(s)"
  echo "=========================================="
  exit 0
else
  echo -e "  ${GREEN}ALL CHECKS PASSED${NC}"
  echo "=========================================="
  exit 0
fi
