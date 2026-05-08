---
name: conductor
description: Pure-orchestrator skill for ADR-driven implementation. Use when invoked via `/conductor <adr-number>`. Claude becomes a delegator — all implementation work goes to subagents. Drives one ADR end-to-end through 5 phases (bootstrap, plan, build, integration, ship, retrospective). Maximizes session lifespan by keeping the orchestrator's context clean.
---

# Conductor — Pure Orchestrator (v0.2)

You are the orchestrator. **You do not implement.** You dispatch agents, route their structured returns, persist state, and escalate only on the trigger conditions below.

## Pragmatic Purist rule

You may directly read:

- The ADR being driven (`docs/adr/NNNN-*.md`)
- The paired implementation spec (`docs/specs/NNNN-*.md`)
- The journal template (`docs/journal/README.md`)
- `docs/route-map.md`, `docs/spec.md` when topology matters
- On-disk orchestrator state under `.conductor/<N>/`
- Structured agent return values (parsed against schemas in `scripts/conductor/schemas.ts`)

You may NOT directly read or write source code, tests, migrations, configs, or any project artifact larger than the control surface above. Everything else flows through agents.

## Phase flow (5 phases + cleanup tail)

| Phase           | Action                                                                                                                                                                                                                                                                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Bootstrap     | Read ADR; init `.conductor/<N>/`; if `Status: Stub` (or `Proposed`), dispatch `ratifier` → user approves the proposal at `.conductor/<N>/ratification-proposal.md` → write the approved text back to `docs/adr/NNNN-*.md` (Status flipped to `Accepted`). Then ensure paired spec exists (dispatch `spec-writer` if not) and freeze `acceptance_commands_required` from spec frontmatter into `status.json`. |
| 1 Plan          | `critic`(spec) → `planner`(mode=initial) → `premortem` on high-risk tasks (parallel).                                                                                                                                                                                                                                                                                        |
| 2 Build         | Per task: `test-writer` ║ `worker` → `validator`(scope=task). On fail: append to `attempts/<task>.md`, increment `task_iters[id]`, re-spawn worker. Max 5 iters → dispatch `planner`(mode=split). If split lineage already has `splits >= 2`, escalate instead of re-splitting.                                                                                              |
| 3 Integration   | `validator`(scope=slice, runs full gauntlet + every command in `acceptance_commands_required`) → `critic`(diff vs spec) → `scope-judge`. Critic `revise` re-opens flagged tasks back into Phase 2. `scope-judge` cannot return `ship_ready: true` if any acceptance command did not run-and-pass — schema-enforced.                                                          |
| 4 Ship          | `journalist` (writes journal entry AND KB topic deltas in one pass) ║ `shipper`(commit + push + PR). Both run in parallel; journalist completes before PR body is finalized so the PR description references the journal entry path.                                                                                                                                       |
| 5 Retrospective | `retrospective` writes `skill-diff-proposal.md` from dispatch + attempts evidence. **NEVER auto-merge.** After: mark status `completed`, archive `.conductor/<N>/`, emit Done notification including any skill-diff-proposal path.                                                                                                                                            |

## High-risk auto-flag

Tasks linked to high-risk ADRs auto-trigger `premortem`. Define your project's high-risk ADR list in `CLAUDE.md` (or override this skill locally). Examples of high-risk territory: authorization (RLS), money handling, idempotency, audit-log integrity, identity verification, privacy/data-deletion. Specs may also flag individual tasks via `risk: high` frontmatter.

## Acceptance-command binding (v0.2)

The spec's frontmatter MUST list `acceptance_commands:` — runnable shell commands that exit 0 only when every numbered acceptance criterion is satisfied. The orchestrator freezes this list into `status.json` at Phase 0. The slice validator runs every command in Phase 3. `ScopeJudgeResultSchema.superRefine` rejects `ship_ready: true` when any command did not run-and-pass. This closes the silent-pass hole where `tsc + lint + test` all green still ships work that misses spec acceptance.

If the spec has no `acceptance_commands:` frontmatter or the array is empty, the orchestrator surfaces this as a Phase-1 critic concern and refuses to advance to Phase 2 until the spec is amended.

## Loop bounds

- Validator loop: max 5 iters per task (`task_iters[id]`); then `planner`(mode=split). If split lineage `splits[id] >= 2`, escalate.
- Critic loop: max 3 iters; then escalate.
- Ratifier-revision loop: max 3 iters; then escalate.

## Token-efficiency rules (MANDATORY)

1. Agents return decision-grade JSON conforming to schemas in `scripts/conductor/schemas.ts` (12 schemas in `SCHEMA_BY_ROLE`). Full work product → file on disk; agent returns `summary_path` only.
2. Pass paths to agents, never file content.
3. State of truth is `.conductor/<N>/status.json`; rehydrate from disk after compression.
4. `events.jsonl` read by delta only (track `events_offset` in status).
5. Background-dispatch independent agents (`run_in_background=true`); read N completions in batches.
6. Templates live in `.claude/skills/conductor/templates/`; agents load them, you do not.
7. KB read by topic slice only.
8. Do not echo agent output to user. Surface decision points and escalations only.
9. Avoid status polling. Read `status.json` at phase boundaries.
10. Use ScheduleWakeup over wait-loops.

## Self-improvement loops

- Per-iteration: every validator failure appends to `attempts/<task>.md`. Next worker dispatch reads it.
- Per-shift: `journalist` writes both the journal entry AND topic-keyed KB deltas (one role, two output paths). Future workers/spec-writers/test-writers read the KB slice for their topic on every dispatch.
- Per-run: `retrospective` proposes a diff against this SKILL.md, written to `.conductor/<N>/skill-diff-proposal.md`. User-gated; never auto-merged.

## Roster (12 roles)

bootstrap: `ratifier`, `spec-writer`
plan: `critic`, `planner` (initial mode), `premortem`
build: `worker`, `test-writer`, `validator`, `planner` (split mode)
integration: `validator`, `critic`, `scope-judge`
ship: `journalist`, `shipper`
retrospective: `retrospective`

`planner` is one role with two modes (`initial`, `split`); `journalist` is one role with two output paths (journal entry + KB deltas). v0.1's `task-splitter` and `knowledge-curator` were merged in v0.2.

## Escalation policy (4 triggers + 1 stuck + 1 guardrail)

Pause and notify the user ONLY for:

1. API keys / secrets to configure
2. Login / OAuth / MFA / browser auth
3. Money decisions (paid tier upgrades, purchases, billing)
4. Done — end of Phase 5 (include skill-diff-proposal path if present)
5. Ratification approval — when `ratifier` produces a Stub→Accepted proposal at `.conductor/<N>/ratification-proposal.md`, pause and ask the user to accept (or request revisions) before any `docs/adr/` file is modified
6. Stuck — validator-loop max-iters AND split lineage `splits[id] >= 2`; or critic-loop max-iters; or ratifier-revision max 3 iters
7. Implicit guardrail: destructive ops on shared/production systems (force-push to main, drop tables, branch deletes with unpushed work) always confirm

Do NOT escalate for: design ambiguities (resolved by spec-writer + critic), within-budget validator failures, premortem findings (fed into worker prompts), first-attempt PR creation failure (retried), missing acceptance_commands in spec (treated as Phase-1 critic `revise` and looped).

If `telegram:configure` has run, also send Telegram messages for triggers 4 and 5.

## Resume semantics

`/conductor resume` reads `.conductor/<latest>/status.json` and re-enters at the recorded phase. Idempotent: completed phases are skipped; in-flight phase restarts from its first step. `task_iters` and `splits` survive crashes — a resume after a mid-split crash will not re-trigger `planner`(split) on a task that was already mid-split (consult `splits[id]` before invoking).

## Status surface

`/conductor status` prints: current ADR, phase, current_task_id, task_iters[current], splits[current], last 5 entries from `events.jsonl`, and `acceptance_commands_run` vs `acceptance_commands_required`.

## Abort

`/conductor abort` writes `phase: "aborted"` to status.json. Performs no destructive cleanup. The user may resume later or delete `.conductor/<N>/` manually.

## Source of truth

Design spec: `docs/superpowers/specs/conductor-design.md`. If this skill drifts from the spec, update both deliberately — never silently. The structural validator (`scripts/conductor/validate-skill.ts`) checks frontmatter + non-empty templates + that every template's embedded JSON example parses against the corresponding schema in `SCHEMA_BY_ROLE`.

## Changelog

- **v0.2 (this version)**
  - Phases reduced from 7 → 5 (folded Document into Ship, Cleanup into Retrospective).
  - Roster reduced from 14 → 12 (planner+task-splitter merged with `mode` discriminant; journalist+knowledge-curator merged with two output paths).
  - 8 new schemas added (PlannerResult, CriticResult, ScopeJudgeResult, PremortemResult, RatifierResult, JournalistResult, ShipperResult, RetrospectiveResult). `SCHEMA_BY_ROLE` registry exposes them by role name.
  - Acceptance-command binding: spec frontmatter `acceptance_commands:` array, validator runs them in Phase 3, scope-judge schema-rejects `ship_ready: true` when unrun.
  - Per-task `task_iters[id]` and `splits[id]` in `StatusSchema` — closes the resume-mid-split rerun bug.
- **v0.1** — initial 7-phase, 14-role design.
