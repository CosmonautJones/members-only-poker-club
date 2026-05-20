#!/usr/bin/env bash
# gauntlet.sh — run the slice's acceptance gauntlet, return structured pass/fail.
#
# Replaces the /conductor validator role (no LLM, no schema dispatch, just commands).
#
# Usage:
#   bash scripts/run-tools/gauntlet.sh <spec-path>
#       Run the standard gauntlet (typecheck + lint + test) PLUS every command
#       in the spec frontmatter's acceptance_commands: array. Stops at first fail.
#
#   bash scripts/run-tools/gauntlet.sh --quick
#       Just typecheck + lint + test. Skip per-spec acceptance commands.
#       Used inside the build loop for fast feedback.
#
# Output: single JSON object on stdout, full command output to a log file.
# Exit codes: 0 pass, 1 fail (test/lint/typecheck), 2 fail (acceptance command),
#             64 usage error.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$REPO_ROOT/learnings/gauntlet-logs"
mkdir -p "$LOG_DIR"

ts="$(date +%Y-%m-%dT%H-%M-%S)"
LOG_FILE="$LOG_DIR/gauntlet-$ts.log"

# JSON-safe escape: replace " with \" and newlines with \n
json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' ' | sed 's/  */ /g'
}

emit_pass() {
  local cmds_run="$1"
  printf '{"pass":true,"acceptance_commands_run":%s,"acceptance_commands_unrun":[],"log":"%s"}\n' \
    "$cmds_run" "$LOG_FILE"
}

emit_fail() {
  local failed_step="$1" first_error="$2" diagnosis="$3" fault="$4" cmds_run="$5" cmds_unrun="$6"
  printf '{"pass":false,"failed_step":"%s","first_error_loc":"%s","diagnosis":"%s","fault_attribution":"%s","acceptance_commands_run":%s,"acceptance_commands_unrun":%s,"log":"%s"}\n' \
    "$(json_escape "$failed_step")" \
    "$(json_escape "$first_error")" \
    "$(json_escape "$diagnosis")" \
    "$(json_escape "$fault")" \
    "$cmds_run" "$cmds_unrun" "$LOG_FILE"
}

# Run a single command, append output to log, return its exit code.
run_step() {
  local label="$1"
  shift
  echo "" >>"$LOG_FILE"
  echo "==== $label: $* ====" >>"$LOG_FILE"
  if "$@" >>"$LOG_FILE" 2>&1; then
    return 0
  else
    return $?
  fi
}

# Extract first failing test/error location from log (best-effort).
first_error_loc() {
  # Try vitest pattern: "FAIL ... > tests/<file>"
  local loc
  loc="$(grep -E "FAIL|Error:|error TS|error  " "$LOG_FILE" 2>/dev/null | head -3 | tr '\n' '|' || true)"
  if [[ -z "$loc" ]]; then loc="(see log)"; fi
  printf '%s' "$loc"
}

# Parse acceptance_commands: array out of a markdown spec's YAML frontmatter.
# Returns one command per line. Stops at first non-acceptance line.
parse_acceptance_commands() {
  local spec="$1"
  awk '
    /^---$/ { fm++; if (fm == 2) exit; next }
    fm == 1 && /^acceptance_commands:/ { in_acc = 1; next }
    fm == 1 && in_acc && /^  - / {
      line = $0
      sub(/^  - /, "", line)
      sub(/^'\''/, "", line)
      sub(/'\''$/, "", line)
      sub(/^"/, "", line)
      sub(/"$/, "", line)
      print line
      next
    }
    fm == 1 && in_acc && !/^  / { in_acc = 0 }
  ' "$spec"
}

# ----- main -----

if [[ $# -lt 1 ]]; then
  echo "usage: gauntlet.sh <spec-path> | --quick" >&2
  exit 64
fi

cmds_run="[]"
cmds_unrun="[]"

run_standard() {
  # Step 1: typecheck
  if ! run_step "typecheck" corepack pnpm typecheck; then
    emit_fail "typecheck" "$(first_error_loc)" "TypeScript compilation failed — see log for first TS error code + location. Most common: unresolved symbol, type mismatch on recently-changed contract." "unknown" "$cmds_run" "$cmds_unrun"
    return 1
  fi
  # Step 2: lint
  if ! run_step "lint" corepack pnpm lint; then
    emit_fail "lint" "$(first_error_loc)" "ESLint failed. If 'no-restricted-syntax' on new Date() — use nowUtc() from lib/time/ per ADR-0034. If 'prettier' — run 'corepack pnpm format' and re-stage." "unknown" "$cmds_run" "$cmds_unrun"
    return 1
  fi
  # Step 3: test
  if ! run_step "test" corepack pnpm test; then
    emit_fail "test" "$(first_error_loc)" "Vitest run failed. Check log for FAIL lines + first error file:line. Common causes: stale mocks, missing fixtures, RLS USING-filter expecting 42501 (returns rowCount=0)." "unknown" "$cmds_run" "$cmds_unrun"
    return 1
  fi
  return 0
}

case "${1:-}" in
  --quick)
    if ! run_standard; then exit 1; fi
    emit_pass "$cmds_run"
    exit 0
    ;;
esac

SPEC="$1"
if [[ ! -f "$SPEC" ]]; then
  echo "spec not found: $SPEC" >&2
  exit 64
fi

# Run the standard gauntlet first.
if ! run_standard; then exit 1; fi

# Then run every acceptance command from the spec's frontmatter.
ACCEPTANCE_COMMANDS=()
while IFS= read -r line; do
  [[ -n "$line" ]] && ACCEPTANCE_COMMANDS+=("$line")
done < <(parse_acceptance_commands "$SPEC")

if [[ ${#ACCEPTANCE_COMMANDS[@]} -eq 0 ]]; then
  emit_fail "spec-shape" "$SPEC" "Spec has no acceptance_commands: in frontmatter — orchestrator must escalate as PING: spec-shape before /run can validate ship-readiness." "spec-writer" "$cmds_run" "$cmds_unrun"
  exit 2
fi

run_array="["
unrun_array="["
first=1
for cmd in "${ACCEPTANCE_COMMANDS[@]}"; do
  # Skip standard commands we already ran via run_standard (avoid double-execution)
  case "$cmd" in
    "pnpm typecheck"|"pnpm lint"|"pnpm test")
      if [[ $first -eq 0 ]]; then run_array+=","; fi
      run_array+="\"$(json_escape "$cmd")\""
      first=0
      continue
      ;;
  esac

  if ! run_step "acceptance: $cmd" bash -c "$cmd"; then
    # Add to unrun all commands that come after this one
    unrun_first=1
    found_self=0
    for c2 in "${ACCEPTANCE_COMMANDS[@]}"; do
      if [[ "$c2" == "$cmd" ]]; then found_self=1; continue; fi
      if [[ $found_self -eq 1 ]]; then
        case "$c2" in "pnpm typecheck"|"pnpm lint"|"pnpm test") continue;; esac
        if [[ $unrun_first -eq 0 ]]; then unrun_array+=","; fi
        unrun_array+="\"$(json_escape "$c2")\""
        unrun_first=0
      fi
    done
    run_array+="]"
    unrun_array+="]"
    emit_fail "acceptance: $cmd" "$(first_error_loc)" "Acceptance command exited non-zero. Check log for the command's own output. This is the spec author's contract for ship-readiness — every command must exit 0 before scope-judge is satisfied." "unknown" "$run_array" "$unrun_array"
    exit 2
  fi
  if [[ $first -eq 0 ]]; then run_array+=","; fi
  run_array+="\"$(json_escape "$cmd")\""
  first=0
done
run_array+="]"
unrun_array+="]"

emit_pass "$run_array"
exit 0
