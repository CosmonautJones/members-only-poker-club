---
description: Drive an ADR end-to-end through the conductor orchestrator. Usage: /conductor <adr-number> | resume | status | abort | learn [<adr>]
argument-hint: "<adr-number> | resume | status | abort | learn [<adr>]"
---

Invoke the conductor skill with the user's argument(s).

Argument forms:
- `/conductor <NNNN>` — start: drive ADR-NNNN through phases 0–5
- `/conductor resume` — read `.conductor/<latest-active>/status.json`, run the v0.3 staleness check (recompute canonical hashes for every path in `input_hashes`; on mismatch dispatch `critic`(mode=delta) before re-entering), then re-enter at the recorded phase
- `/conductor status` — print current ADR, phase, current_task_id, task_iters[current], splits[current], last 5 entries from `events.jsonl`, and `acceptance_commands_run` vs `acceptance_commands_required`
- `/conductor abort` — write `phase: "aborted"` to status.json; no destructive cleanup
- `/conductor learn [<NNNN>]` — (v0.5) walk completed cycles' `.conductor/<N>/skill-diff-proposal.md` files, present diffs against the live `SKILL.md` (and named templates / KB topics) as a single review batch, and on user confirm apply the diffs to both the in-project skill AND the staging copy at `Downloads/conductor-harness/.claude/skills/conductor/SKILL.md`. With `<NNNN>` argument, only that cycle's proposals are reviewed. Without, every unmerged proposal across all completed cycles. NEVER auto-merge; always user-gated. Each applied diff is appended to the `Skill changelog (auto-learn)` section of SKILL.md citing the source cycle.

Read the conductor skill's SKILL.md and follow it strictly. The Pragmatic Purist constraint applies for the duration of the conductor run only — outside this command, you operate normally.

Every turn the orchestrator runs MUST terminate with one of three sentinels (`GOAL-A:`, `PING:`, `GOAL-C:`) — see §Goal Integration in SKILL.md for the mapping.

User's argument(s): $ARGUMENTS
