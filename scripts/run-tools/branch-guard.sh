#!/usr/bin/env bash
# branch-guard.sh — branch hygiene for the /run orchestrator.
#
# Usage:
#   bash scripts/run-tools/branch-guard.sh check
#       Print current branch + whether it's main/protected. Exits 0 always.
#       JSON shape: {"current_branch": "...", "is_main": bool, "is_feature": bool, "action_taken": "none"}
#
#   bash scripts/run-tools/branch-guard.sh --from-main <feature-branch-name>
#       If currently on main, create+switch to <feature-branch-name>.
#       If already on <feature-branch-name>, no-op.
#       If on some OTHER branch, exits 2 with action_taken: "blocked" — orchestrator escalates.
#
#   bash scripts/run-tools/branch-guard.sh verify <expected-feature-branch>
#       Verify current branch matches <expected>. Exits 0 if match, 2 otherwise.
#       Used at ship time to catch branch drift mid-slice.
#
# Output: single JSON object on stdout. Errors go to stderr.

set -euo pipefail

PROTECTED_BRANCHES=("main" "master" "production" "release")

current_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "DETACHED")"

is_protected() {
  local b="$1"
  for p in "${PROTECTED_BRANCHES[@]}"; do
    [[ "$b" == "$p" ]] && return 0
  done
  return 1
}

emit_json() {
  # $1 = action_taken, $2 = current_branch, $3 = optional extra k:v pairs (already comma-prefixed)
  local action="$1" branch="$2" extra="${3:-}"
  local is_main is_feature
  if is_protected "$branch"; then is_main="true"; is_feature="false"; else is_main="false"; is_feature="true"; fi
  printf '{"current_branch":"%s","is_main":%s,"is_feature":%s,"action_taken":"%s"%s}\n' \
    "$branch" "$is_main" "$is_feature" "$action" "$extra"
}

if [[ $# -lt 1 ]]; then
  echo "usage: branch-guard.sh {check | --from-main <name> | verify <expected>}" >&2
  exit 64
fi

cmd="$1"
shift || true

case "$cmd" in
  check)
    emit_json "none" "$current_branch"
    ;;

  --from-main)
    if [[ $# -lt 1 ]]; then
      echo "usage: branch-guard.sh --from-main <feature-branch-name>" >&2
      exit 64
    fi
    target="$1"

    if [[ "$current_branch" == "$target" ]]; then
      emit_json "already-on-target" "$current_branch"
      exit 0
    fi

    if is_protected "$current_branch"; then
      # Refuse to create branch over uncommitted changes; let the user resolve
      if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
        emit_json "blocked-dirty-tree" "$current_branch" ",\"reason\":\"working tree has uncommitted changes; resolve before branching off $current_branch\""
        exit 2
      fi
      git checkout -b "$target" >&2
      emit_json "created-and-switched" "$target" ",\"from\":\"$current_branch\""
      exit 0
    fi

    # On some other (non-protected, non-target) branch. Refuse to silently switch.
    emit_json "blocked-unexpected-branch" "$current_branch" ",\"expected\":\"$target\",\"hint\":\"orchestrator should PING user — switch / continue / abort\""
    exit 2
    ;;

  verify)
    if [[ $# -lt 1 ]]; then
      echo "usage: branch-guard.sh verify <expected-feature-branch>" >&2
      exit 64
    fi
    expected="$1"
    if [[ "$current_branch" == "$expected" ]]; then
      emit_json "verified" "$current_branch"
      exit 0
    fi
    emit_json "drift-detected" "$current_branch" ",\"expected\":\"$expected\""
    exit 2
    ;;

  *)
    echo "unknown command: $cmd" >&2
    echo "usage: branch-guard.sh {check | --from-main <name> | verify <expected>}" >&2
    exit 64
    ;;
esac
