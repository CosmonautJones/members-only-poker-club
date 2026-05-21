#!/usr/bin/env bash
# hook-user-correction.sh — UserPromptSubmit hook. Detects when the user
# corrects, contradicts, or stops the assistant — these are high-signal
# learning opportunities (something the assistant did that the user didn't
# want).
#
# Stdin: JSON event from Claude Code with the user's prompt text.
# Exit 0 always.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

payload="$(cat 2>/dev/null || echo '{}')"

# Extract prompt via node (Windows often lacks jq). Fallback: treat the raw
# stdin as the prompt if JSON parse fails.
prompt="$(printf '%s' "$payload" | node -e '
  let s = "";
  process.stdin.on("data", c => s += c);
  process.stdin.on("end", () => {
    try {
      const p = JSON.parse(s || "{}");
      const v = p.prompt || p.user_prompt || p.message || "";
      process.stdout.write(String(v));
    } catch (e) {
      // Not JSON; treat raw input as the prompt.
      process.stdout.write(s);
    }
  });
' 2>/dev/null || echo "$payload")"

if [[ -z "$prompt" ]]; then exit 0; fi

# Lowercase for matching.
lower="$(printf '%s' "$prompt" | tr '[:upper:]' '[:lower:]')"

# Correction patterns — these are short, high-signal phrases that indicate
# the assistant deviated from intent. We match on word-boundary patterns to
# avoid false positives on "don't worry about it" or "no problem."
matched=""
case "$lower" in
  *"don't do that"*|*"dont do that"*)         matched="don't do that" ;;
  *"don't "*"that"*)                          matched="don't ... that" ;;
  *"stop doing"*)                              matched="stop doing" ;;
  *"stop "*"that"*)                            matched="stop ... that" ;;
  *"that's wrong"*|*"thats wrong"*)            matched="that's wrong" ;;
  *"you broke"*)                               matched="you broke" ;;
  *"that broke"*)                              matched="that broke" ;;
  *"revert"*)                                  matched="revert" ;;
  *"undo "*)                                   matched="undo" ;;
  *"why did you"*)                             matched="why did you" ;;
  *"that's not what i"*|*"thats not what i"*)  matched="not what I asked" ;;
  *"wrong approach"*)                          matched="wrong approach" ;;
  *"this is wrong"*)                           matched="this is wrong" ;;
  *)
    exit 0 # no correction pattern matched
    ;;
esac

# Trim prompt to ~500 chars to keep inbox entries scannable.
prompt_snippet="$(printf '%s' "$prompt" | head -c 500)"
summary="user correction signal: '$matched'"

{
  printf 'Pattern matched: %s\n\nUser prompt (first 500 chars):\n```\n%s\n```\n\nFor /digest review: was the assistant doing something wrong? If yes, this is signal for a new skill, test, or guardrail. If false-positive (user using the phrase casually), mark as such during digest.\n' \
    "$matched" "$prompt_snippet"
} | bash "$SCRIPT_DIR/inbox-write.sh" correction "$summary" >/dev/null 2>&1 || true

exit 0
