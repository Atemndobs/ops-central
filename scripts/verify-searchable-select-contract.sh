#!/usr/bin/env bash
# Verify the SearchableSelect contract is in sync between web and mobile.
# Fails (exit 1) if the two files have drifted.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

WEB="$REPO_ROOT/src/components/ui/searchable-select/contract.ts"
MOBILE="$REPO_ROOT/../jna-cleaners-app/components/ui/searchable-select/contract.ts"

if [[ ! -f "$WEB" ]]; then
  echo "error: missing $WEB" >&2
  exit 1
fi
if [[ ! -f "$MOBILE" ]]; then
  echo "error: missing $MOBILE" >&2
  exit 1
fi

if ! diff -u "$WEB" "$MOBILE"; then
  echo "" >&2
  echo "error: SearchableSelect contract has drifted between apps." >&2
  echo "  Web:    $WEB" >&2
  echo "  Mobile: $MOBILE" >&2
  echo "Copy one over the other, or update both in the same commit." >&2
  exit 1
fi

echo "SearchableSelect contract in sync."
