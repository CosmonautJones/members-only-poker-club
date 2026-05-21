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
#
# Parser: uses node (guaranteed available in this Node project) instead of jq
# (which is missing by default on Windows/msys2). Fallback to silent no-op if
# parsing fails — better to lose one entry than to break the orchestrator.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Read stdin (the hook payload).
payload="$(cat 2>/dev/null || echo '{}')"

# Extract via node (JSON-aware, nested-safe). If node is missing or JSON is
# malformed, parsed-fields will be empty and the hook exits silently.
parsed="$(printf '%s' "$payload" | node -e '
  let s = "";
  process.stdin.on("data", c => s += c);
  process.stdin.on("end", () => {
    try {
      const p = JSON.parse(s || "{}");
      const cmd = (p.tool_input && p.tool_input.command) || "";
      const tr = p.tool_response || {};
      const exit_code = tr.exit_code ?? tr.exitCode ?? "";
      const stderr_tail = String(tr.stderr || tr.stdout || "").split("\n").slice(-20).join("\n");
      // Newline-delimited for easy bash parsing.
      // Field 1: exit_code, Field 2: cmd (one line), Field 3-N: stderr tail.
      process.stdout.write(`${exit_code}\n${cmd.replace(/\n/g, " ")}\n${stderr_tail}\n`);
    } catch (e) {
      process.stdout.write("\n\n\n");
    }
  });
' 2>/dev/null)"

exit_code="$(printf '%s' "$parsed" | sed -n '1p')"
cmd="$(printf '%s' "$parsed" | sed -n '2p')"
stderr_tail="$(printf '%s' "$parsed" | tail -n +3)"

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
