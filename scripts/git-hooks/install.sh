#!/usr/bin/env bash
#
# Install git hooks for this repo.
#
# Idempotent: re-run any time. Uses symlinks so hook updates flow through
# the next time you pull.
#
# Usage:
#   bash scripts/git-hooks/install.sh

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_SRC="$REPO_ROOT/scripts/git-hooks"
HOOKS_DST="$REPO_ROOT/.git/hooks"

install_hook() {
  local name="$1"
  local src="$HOOKS_SRC/$name"
  local dst="$HOOKS_DST/$name"

  if [ ! -f "$src" ]; then
    echo "skip: $name (no source file)"
    return
  fi

  chmod +x "$src"
  ln -sf "../../scripts/git-hooks/$name" "$dst"
  echo "installed: $name → $(readlink "$dst")"
}

install_hook pre-push

echo ""
echo "Done. To bypass a hook in an emergency:"
echo "  git push --no-verify"
echo ""
echo "For an extra-strict deep mobile typecheck on pre-push:"
echo "  export CSOI_DEEP_PREPUSH=1"
