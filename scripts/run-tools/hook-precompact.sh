#!/usr/bin/env bash
# hook-precompact.sh — PreCompact hook. Flushes the orchestrator's current
# TODO list state to the inbox so any unresolved items survive context
# compaction.
#
# Stdin: JSON event from Claude Code (we don't strictly need its contents).
# Exit 0 always.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Read & discard stdin
cat >/dev/null 2>&1 || true

# Best-effort snapshot — TaskList isn't accessible from a shell hook, so we
# just write a placeholder marker. The /digest skill or a future audit can
# correlate this with the actual conversation transcript.
summary="pre-compact checkpoint — review surrounding conversation for unresolved tasks"

{
  printf 'Pre-compact hook fired at %s on branch %s (sha %s).\n\nReview the conversation transcript immediately preceding this entry for any in-flight tasks, half-finished diffs, or stuck loops that may not have been finalized before the compact.\n' \
    "$(date -Iseconds)" \
    "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)" \
    "$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
} | bash "$SCRIPT_DIR/inbox-write.sh" compact "$summary" >/dev/null 2>&1 || true

exit 0
