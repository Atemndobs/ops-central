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
NC='\033[0m' # No Color

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

declare -A REQUIRED_FUNCTIONS
REQUIRED_FUNCTIONS=(
  # Photo upload functions (used by photoUploadService.ts)
  ["files/mutations.ts:generateUploadUrl"]="photo uploads"
  ["files/mutations.ts:uploadJobPhoto"]="photo uploads"
  ["files/queries.ts:getFileUrl"]="photo URL resolution"
  ["files/queries.ts:getPhotoUrl"]="photo URL resolution"
  ["files/queries.ts:getPhotoAccessUrl"]="photo access URLs"
  # Job functions (used by useConvexJobs.ts)
  ["cleaningJobs/queries.ts:getJobById"]="job loading"
  ["cleaningJobs/queries.ts:getJobPhotos"]="photo display"
  ["cleaningJobs/mutations.ts:startJob"]="starting a job"
  ["cleaningJobs/mutations.ts:completeJob"]="completing a job"
  # Incident functions
  ["incidents/mutations.ts:createIncident"]="incident reporting"
  # Job checks
  ["jobChecks/queries.ts:getJobChecks"]="critical/refill checks"
  ["jobChecks/mutations.ts:saveCheckpointResult"]="saving check results"
  ["jobChecks/mutations.ts:saveRefillResult"]="saving refill results"
)

for key in "${!REQUIRED_FUNCTIONS[@]}"; do
  FILE="${key%%:*}"
  FUNC="${key##*:}"
  PURPOSE="${REQUIRED_FUNCTIONS[$key]}"
  FULL_PATH="$BACKEND_DIR/convex/$FILE"

  if [ ! -f "$FULL_PATH" ]; then
    echo -e "  ${RED}FAIL${NC} $FILE — file missing (needed for $PURPOSE)"
    ERRORS=$((ERRORS + 1))
  elif ! grep -q "export const $FUNC" "$FULL_PATH"; then
    echo -e "  ${RED}FAIL${NC} $FILE:$FUNC — function not found (needed for $PURPOSE)"
    ERRORS=$((ERRORS + 1))
  else
    echo -e "  ${GREEN}OK${NC}   $FILE:$FUNC"
  fi
done

echo ""

# --- Check 2: Verify the mobile app's generated API types are in sync ---
echo "--- Check 2: Generated API types freshness ---"

MOBILE_API="$MOBILE_DIR/convex/_generated/api.d.ts"
BACKEND_API="$BACKEND_DIR/convex/_generated/api.d.ts"

if [ ! -f "$MOBILE_API" ]; then
  echo -e "  ${RED}FAIL${NC} Mobile app has no generated API types at convex/_generated/api.d.ts"
  ERRORS=$((ERRORS + 1))
elif [ ! -f "$BACKEND_API" ]; then
  echo -e "  ${YELLOW}WARN${NC} Backend has no generated API types (run npx convex dev first)"
  WARNINGS=$((WARNINGS + 1))
else
  # Check if the mobile app's API types reference modules that don't exist in backend
  MOBILE_MODULES=$(grep "import type" "$MOBILE_API" | sed 's/.*from "\.\.\///' | sed 's/\.js";$//' | sort)
  MISSING_MODULES=0

  for MODULE in $MOBILE_MODULES; do
    MODULE_PATH="$BACKEND_DIR/convex/$MODULE.ts"
    if [ ! -f "$MODULE_PATH" ]; then
      echo -e "  ${RED}FAIL${NC} Mobile expects module '$MODULE' but $MODULE.ts not found in backend"
      ERRORS=$((ERRORS + 1))
      MISSING_MODULES=$((MISSING_MODULES + 1))
    fi
  done

  if [ $MISSING_MODULES -eq 0 ]; then
    echo -e "  ${GREEN}OK${NC}   All mobile API modules exist in backend"
  fi
fi

echo ""

# --- Check 3: Schema table check ---
echo "--- Check 3: Schema tables used by mobile ---"

SCHEMA_FILE="$BACKEND_DIR/convex/schema.ts"
REQUIRED_TABLES=("cleaningJobs" "photos" "users" "properties" "incidents" "propertyCriticalCheckpoints" "jobCheckpointResults" "propertyRefillItems" "jobRefillResults")

if [ ! -f "$SCHEMA_FILE" ]; then
  echo -e "  ${RED}FAIL${NC} No schema.ts found"
  ERRORS=$((ERRORS + 1))
else
  for TABLE in "${REQUIRED_TABLES[@]}"; do
    if grep -q "\"$TABLE\"" "$SCHEMA_FILE" || grep -q "$TABLE:" "$SCHEMA_FILE"; then
      echo -e "  ${GREEN}OK${NC}   Table '$TABLE' defined"
    else
      echo -e "  ${RED}FAIL${NC} Table '$TABLE' not found in schema (mobile app depends on it)"
      ERRORS=$((ERRORS + 1))
    fi
  done
fi

echo ""

# --- Check 4: Auth config ---
echo "--- Check 4: Auth configuration ---"

AUTH_CONFIG="$BACKEND_DIR/convex/auth.config.ts"
AUTH_CONFIG_JS="$BACKEND_DIR/convex/auth.config.js"

if [ -f "$AUTH_CONFIG" ] || [ -f "$AUTH_CONFIG_JS" ]; then
  echo -e "  ${GREEN}OK${NC}   Auth config exists"
else
  echo -e "  ${YELLOW}WARN${NC} No auth.config.ts found — mobile app uses Clerk auth"
  WARNINGS=$((WARNINGS + 1))
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
