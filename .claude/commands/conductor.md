---
description: Drive an ADR end-to-end through the conductor orchestrator. Usage: /conductor <adr-number> | resume | status | abort
argument-hint: "<adr-number> | resume | status | abort"
---

Invoke the conductor skill with the user's argument(s).

Argument forms:
- `/conductor <NNNN>` — start: drive ADR-NNNN through phases 0–7
- `/conductor resume` — read `.conductor/<latest-active>/status.json` and re-enter at the recorded phase
- `/conductor status` — print current ADR, phase, current_task_id, iter_count, last 5 entries from `events.jsonl`
- `/conductor abort` — write `phase: "aborted"` to status.json; no destructive cleanup

Read the conductor skill's SKILL.md and follow it strictly. The Pragmatic Purist constraint applies for the duration of the conductor run only — outside this command, you operate normally.

User's argument(s): $ARGUMENTS
