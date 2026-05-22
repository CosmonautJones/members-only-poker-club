#!/usr/bin/env bash
# ship.sh — commit + (await user) + push + PR for the /run orchestrator.
#
# Replaces the /conductor shipper role.
#
# Usage:
#   bash scripts/run-tools/ship.sh stage <spec-path>
#       Pre-flight: check gh auth account matches origin, check branch is not main,
#       check working tree is clean (only slice changes). Outputs JSON; orchestrator
#       calls 'commit' next.
#
#   bash scripts/run-tools/ship.sh commit <spec-path> <commit-message-file>
#       Stage the files listed in slice scope, commit with body from message file.
#       STOPS — does NOT push. Orchestrator surfaces a PING: ship — N commits ready.
#
#   bash scripts/run-tools/ship.sh push <branch> <pr-title-file> <pr-body-file>
#       After user authorizes, push to origin and open PR.
#
# Exit codes: 0 success, 1 blocker (auth mismatch, branch=main, dirty tree),
#             2 git/gh operational failure, 64 usage error.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' '
}

emit() {
  # $1 status, $2 reason, $3 extra (already comma-prefixed)
  printf '{"status":"%s","reason":"%s"%s}\n' "$1" "$(json_escape "$2")" "${3:-}"
}

# Parse the spec's adr + slice for context.
spec_field() {
  local spec="$1" field="$2"
  awk -v f="$field" '
    /^---$/ { fm++; if (fm == 2) exit; next }
    fm == 1 && $1 ~ "^"f":" { sub("^"f": *", ""); print; exit }
  ' "$spec"
}

# Get the active gh user (or "anonymous" if not logged in).
gh_user() {
  gh api user --jq .login 2>/dev/null || echo "anonymous"
}

# Get the origin repo owner from the remote URL.
origin_owner() {
  local url
  url="$(git remote get-url origin 2>/dev/null || echo "")"
  # Handle both https://github.com/<owner>/<repo> and git@github.com:<owner>/<repo>
  echo "$url" | sed -E 's|.*github.com[:/]([^/]+)/.*|\1|'
}

# Check user has org membership for the repo owner.
gh_user_in_org() {
  local owner="$1" user="$2"
  [[ "$owner" == "$user" ]] && return 0
  gh api "user/orgs" --jq '.[].login' 2>/dev/null | grep -qx "$owner"
}

# ----- stage: pre-flight checks -----
cmd_stage() {
  if [[ $# -lt 1 ]]; then
    echo "usage: ship.sh stage <spec-path>" >&2; exit 64
  fi
  local spec="$1"

  # 1. Branch hygiene
  local branch
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "DETACHED")"
  case "$branch" in
    main|master|production|release)
      emit "blocked" "current branch is protected: $branch — never commit directly to main; orchestrator must create feature branch first via branch-guard.sh" ",\"branch\":\"$branch\""
      exit 1
      ;;
    DETACHED)
      emit "blocked" "HEAD is detached — orchestrator must check out a feature branch first" ""
      exit 1
      ;;
  esac

  # 2. gh auth account check
  local user owner
  user="$(gh_user)"
  owner="$(origin_owner)"
  if [[ "$user" == "anonymous" ]]; then
    emit "blocked" "gh CLI not authenticated — run 'gh auth login' (PING: auth)" ",\"branch\":\"$branch\",\"origin_owner\":\"$owner\""
    exit 1
  fi
  if ! gh_user_in_org "$owner" "$user"; then
    emit "blocked" "gh account mismatch: active=$user, origin owner=$owner; run 'gh auth switch --user $owner' before retrying (PING: auth)" ",\"branch\":\"$branch\",\"origin_owner\":\"$owner\",\"active_gh_user\":\"$user\""
    exit 1
  fi

  # 3. Working tree status
  local dirty_files
  dirty_files="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  if [[ "$dirty_files" == "0" ]]; then
    emit "blocked" "working tree is clean — nothing to commit" ",\"branch\":\"$branch\""
    exit 1
  fi

  emit "ready" "pre-flight passed: $dirty_files files to commit on $branch" ",\"branch\":\"$branch\",\"origin_owner\":\"$owner\",\"active_gh_user\":\"$user\",\"files_pending\":$dirty_files"
}

# ----- commit: stage + commit, STOP -----
cmd_commit() {
  if [[ $# -lt 3 ]]; then
    echo "usage: ship.sh commit <spec-path> <commit-message-file> <file1> [<file2> ...]" >&2
    echo "  Note: explicit file list is REQUIRED (eliminates the git add -A footgun)." >&2
    exit 64
  fi
  local spec="$1" msg_file="$2"
  shift 2
  # Remaining positional args are the file list to stage.

  if [[ ! -f "$msg_file" ]]; then
    emit "blocked" "commit message file not found: $msg_file" ""
    exit 64
  fi

  # Refuse to stage anything that looks like a scratch/temp/draft file.
  # Belt-and-suspenders alongside the explicit file list — if the
  # orchestrator passes a temp file in the list, refuse loudly.
  for f in "$@"; do
    case "$f" in
      *.tmp|*.scratch|*.draft|*.wip|*~|*.bak|*.orig)
        emit "blocked" "refusing to stage scratch/temp file: $f — clean these up before invoking ship.sh commit" ",\"file\":\"$f\""
        exit 1
        ;;
    esac
  done

  # Stage explicit files only (v0.2 from digest 2026-05-21 entry 1 — eliminates
  # the git add -A footgun that captured .run-commit-msg.tmp on first live test).
  git add -- "$@" >&2
  if [[ $? -ne 0 ]]; then
    emit "failed" "git add failed for one or more files — see stderr" ""
    exit 2
  fi

  if ! git commit -F "$msg_file" >&2; then
    emit "failed" "git commit failed — see stderr (pre-commit hook?)" ""
    exit 2
  fi

  local sha
  sha="$(git rev-parse --short HEAD 2>/dev/null)"
  emit "committed" "commit created — orchestrator must PING user before push" ",\"sha\":\"$sha\""
}

# ----- push: push + open PR (after user authorizes) -----
cmd_push() {
  if [[ $# -lt 3 ]]; then
    echo "usage: ship.sh push <branch> <pr-title-file> <pr-body-file>" >&2; exit 64
  fi
  local branch="$1" title_file="$2" body_file="$3"

  case "$branch" in
    main|master|production|release)
      emit "blocked" "refusing to push to protected branch: $branch" ""
      exit 1
      ;;
  esac

  # Re-verify gh auth right before push (account could have switched).
  local user owner
  user="$(gh_user)"
  owner="$(origin_owner)"
  if ! gh_user_in_org "$owner" "$user"; then
    emit "blocked" "gh account drift just before push: active=$user, owner=$owner — run 'gh auth switch --user $owner'" ",\"active_gh_user\":\"$user\",\"origin_owner\":\"$owner\""
    exit 1
  fi

  if ! git push -u origin "$branch" >&2; then
    emit "failed" "git push failed — if 403, re-check gh auth; otherwise see stderr" ""
    exit 2
  fi

  if [[ ! -f "$title_file" || ! -f "$body_file" ]]; then
    emit "pushed-no-pr" "push succeeded but pr-title or pr-body file missing; PR not opened" ",\"branch\":\"$branch\""
    exit 0
  fi

  local title
  title="$(head -1 "$title_file")"
  local pr_url
  if ! pr_url="$(gh pr create --title "$title" --body-file "$body_file" 2>&1)"; then
    emit "failed" "gh pr create failed: $pr_url" ""
    exit 2
  fi

  emit "shipped" "push + PR open: $pr_url" ",\"pr_url\":\"$pr_url\",\"branch\":\"$branch\""
}

# ----- main -----
if [[ $# -lt 1 ]]; then
  echo "usage: ship.sh {stage <spec> | commit <spec> <msg-file> <file1> [<file2> ...] | push <branch> <title-file> <body-file>}" >&2
  exit 64
fi

sub="$1"
shift
case "$sub" in
  stage) cmd_stage "$@" ;;
  commit) cmd_commit "$@" ;;
  push) cmd_push "$@" ;;
  *) echo "unknown subcommand: $sub" >&2; exit 64 ;;
esac
