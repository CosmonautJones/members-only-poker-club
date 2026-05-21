---
description: Process the learnings inbox — cluster, propose binding artifacts (skills/tests/tools/KB/drop), apply on user approval.
argument-hint: "(no arguments)"
---

Invoke the `digest` skill.

The digest skill reads `learnings/inbox/*.md` (entries with `status: unprocessed`), clusters them by topic, and proposes each cluster as ONE OF:
- **new-skill** with sharp trigger frontmatter
- **new-test** in the gauntlet
- **new-tool** function
- **kb-archive** entry
- **drop** (false positive)

User approves each cluster's outcome. Approved artifacts BIND BEHAVIOR — skills auto-load, tests fail mechanically, tools enforce contracts.

Run between slices, not during. Wait until inbox has ~10+ entries before invoking.

User's argument(s): $ARGUMENTS
