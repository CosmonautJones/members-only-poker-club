#!/usr/bin/env bash
# hook-bash-fail.sh — PostToolUse(Bash) hook. Logs gauntlet/test/lint/typecheck
# failures to the learnings inbox. Silent on success and on commands that don't
# look like the gauntlet.
#
# Stdin: JSON event from Claude Code hook system with shape (approximate):
#   { "tool_input": { "command": "..." },
#     "tool_response": { "exit_code": N, "stdout": "...", "stderr": "..." } }
# The exact fields depend on Claude Code version; the script is lenient.
#
# Exit 0 always — a hook must never break the orchestrator's flow.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Read stdin (the hook payload).
payload="$(cat 2>/dev/null || echo '{}')"

# Best-effort extract — use jq if available, otherwise grep.
extract() {
  local key="$1"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$payload" | jq -r "$key // empty" 2>/dev/null || true
  else
    # naive fallback — works for top-level string fields, exit codes
    printf '%s' "$payload" | grep -oE "\"$(printf '%s' "$key" | sed 's|^\.||' | tr -d ' \"')\"[[:space:]]*:[[:space:]]*[^,}]*" | head -1 | sed "s/.*: *//" | tr -d '"' || true
  fi
}

# If jq available we get a richer extraction.
if command -v jq >/dev/null 2>&1; then
  cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null || echo "")"
  exit_code="$(printf '%s' "$payload" | jq -r '.tool_response.exit_code // .tool_response.exitCode // empty' 2>/dev/null || echo "")"
  stderr_tail="$(printf '%s' "$payload" | jq -r '.tool_response.stderr // .tool_response.stdout // empty' 2>/dev/null | tail -20 || echo "")"
else
  cmd="$(extract '.tool_input.command')"
  exit_code="$(extract '.tool_response.exit_code')"
  stderr_tail=""
fi

# Filter: only log if exit code is non-zero AND looks like a gauntlet/build command.
if [[ -z "$exit_code" || "$exit_code" == "0" ]]; then exit 0; fi

case "$cmd" in
  *"pnpm test"*|*"pnpm typecheck"*|*"pnpm lint"*|*"pnpm format"*|*"scripts/run-tools/gauntlet.sh"*|*"pnpm migrate:check"*|*"pnpm validate:conductor"*|*"corepack pnpm"*)
    : # match — proceed
    ;;
  *)
    exit 0 # non-gauntlet command; ignore
    ;;
esac

# Trim command to one-line summary
cmd_summary="$(printf '%s' "$cmd" | tr '\n' ' ' | cut -c1-120)"

summary="bash failure (exit $exit_code): $cmd_summary"

# Body: cmd + last 20 lines of stderr
{
  printf 'Command:\n```\n%s\n```\n\nExit code: %s\n\nLast stderr lines:\n```\n%s\n```\n' \
    "$cmd" "$exit_code" "$stderr_tail"
} | bash "$SCRIPT_DIR/inbox-write.sh" gauntlet-fail "$summary" >/dev/null 2>&1 || true

exit 0
