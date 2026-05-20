#!/usr/bin/env bash
# inbox-write.sh — write a learning to learnings/inbox/<date>-<auto>.md
#
# Called by hooks (see .claude/settings.json). NEVER call this from the
# orchestrator's main flow — learnings are mechanical, not editorial.
#
# Usage:
#   bash scripts/run-tools/inbox-write.sh <kind> <one-line-summary> [<body-from-stdin>]
#
# kind is one of:
#   gauntlet-fail    — typecheck/lint/test/acceptance failed
#   tool-fail        — branch-guard/ship returned non-zero
#   correction       — user said "no", "don't", "stop doing X"
#   compact          — pre-compact flush of unresolved TODO items
#   manual           — orchestrator explicitly wrote (rare; prefer hooks)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
INBOX="$REPO_ROOT/learnings/inbox"
mkdir -p "$INBOX"

if [[ $# -lt 2 ]]; then
  echo "usage: inbox-write.sh <kind> <summary> [body from stdin]" >&2
  exit 64
fi

kind="$1"
summary="$2"

# Auto-numbered filename. Date + 4-digit ordinal within the day.
date_part="$(date +%Y-%m-%d)"
ordinal=1
while [[ -e "$INBOX/$date_part-$(printf '%04d' $ordinal)-$kind.md" ]]; do
  ordinal=$((ordinal + 1))
done
out="$INBOX/$date_part-$(printf '%04d' $ordinal)-$kind.md"

# Read body from stdin if available (heredoc-friendly).
body=""
if [[ ! -t 0 ]]; then
  body="$(cat)"
fi

git_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")"
git_sha="$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")"

{
  echo "---"
  echo "kind: $kind"
  echo "date: $date_part"
  echo "branch: $git_branch"
  echo "sha: $git_sha"
  echo "summary: $summary"
  echo "status: unprocessed"
  echo "---"
  echo ""
  echo "## Summary"
  echo ""
  echo "$summary"
  if [[ -n "$body" ]]; then
    echo ""
    echo "## Body"
    echo ""
    echo "$body"
  fi
} > "$out"

# Echo the path so the hook can include it in any downstream message.
echo "$out"
