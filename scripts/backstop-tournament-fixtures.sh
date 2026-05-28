#!/usr/bin/env bash
# backstop-tournament-fixtures.sh — ADR-0037 cleanup guard.
#
# Asserts that no source file imports from `@/lib/tournaments/fixtures` after
# the slice deleted that module. Belt-and-suspenders: the file is gone, so an
# import would fail TypeScript anyway — this script catches stale references
# in markdown / CI configs / other non-TS files too.
#
# Exits 0 if clean, 1 if any reference is found.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

# Grep across app/, lib/, tests/, components/, supabase/. Exclude node_modules,
# .next, .git, and the docs/ tree (where references to the historical fixture
# in journal entries / ADR memory are expected).
# shellcheck disable=SC2046
matches=$(grep -rln \
  --include='*.ts' \
  --include='*.tsx' \
  --include='*.js' \
  --include='*.jsx' \
  --include='*.json' \
  --include='*.mjs' \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  --exclude-dir=.git \
  --exclude-dir=docs \
  -e "lib/tournaments/fixtures" \
  app/ lib/ tests/ components/ supabase/ scripts/ 2>/dev/null \
  || true)

if [[ -n "$matches" ]]; then
  echo "backstop-tournament-fixtures: found stale references to lib/tournaments/fixtures:"
  echo "$matches"
  exit 1
fi

echo "backstop-tournament-fixtures: clean"
exit 0
