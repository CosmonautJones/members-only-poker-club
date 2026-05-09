---
description: Drive an ADR end-to-end through the conductor orchestrator. Usage: /conductor <adr-number> | resume | status | abort
argument-hint: "<adr-number> | resume | status | abort"
---

Invoke the conductor skill with the user's argument(s).

Argument forms:
- `/conductor <NNNN>` — start: drive ADR-NNNN through phases 0–5
- `/conductor resume` — read `.conductor/<latest-active>/status.json`, run the v0.3 staleness check (recompute canonical hashes for every path in `input_hashes`; on mismatch dispatch `critic`(mode=delta) before re-entering), then re-enter at the recorded phase
- `/conductor status` — print current ADR, phase, current_task_id, task_iters[current], splits[current], last 5 entries from `events.jsonl`, and `acceptance_commands_run` vs `acceptance_commands_required`
- `/conductor abort` — write `phase: "aborted"` to status.json; no destructive cleanup

Read the conductor skill's SKILL.md and follow it strictly. The Pragmatic Purist constraint applies for the duration of the conductor run only — outside this command, you operate normally.

User's argument(s): $ARGUMENTS
