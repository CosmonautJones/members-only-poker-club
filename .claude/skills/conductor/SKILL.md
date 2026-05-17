---
name: conductor
description: Pure-orchestrator skill for ADR-driven implementation. Use when invoked via `/conductor <adr-number>`. Claude becomes a delegator — all implementation work goes to subagents. Drives one ADR end-to-end through 5 phases (bootstrap, plan, build, integration, ship, retrospective). Maximizes session lifespan by keeping the orchestrator's context clean.
---

# Conductor — Pure Orchestrator (v0.5)

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
| 0 Bootstrap     | Read ADR; init `.conductor/<N>/`. If `Status: Stub` (or `Proposed`): dispatch `triage` → record `triage_depth` in status.json. If `triage_depth=full`, dispatch `falsifier` ║ `premortem`(mode=direction) **in parallel** before ratification. Then dispatch `ratifier` (passing falsifier + direction-premortem outputs when full) → when `triage_depth=full`, dispatch `critic`(mode=proposal) against the proposal with the falsifier and direction-premortem summary paths attached; if `verdict=revise`, loop back to ratifier (existing 3-iter ratifier max applies; once exceeded, escalate as a stuck condition) → user approves the proposal at `.conductor/<N>/ratification-proposal.md` → orchestrator computes canonical signature, replaces the `PENDING` sentinel in the proposal with `<sha256[:12]>`, writes the approved text back to `docs/adr/NNNN-*.md`, and stores the full sha256 in `status.input_hashes[adr_path]`. Then ensure paired spec exists (dispatch `spec-writer` if not), hash the spec into `status.input_hashes[spec_path]`, snapshot canonical texts to `.conductor/<N>/snapshots/` for later delta comparison, and freeze `acceptance_commands_required` from spec frontmatter. |
| 1 Plan          | `critic`(spec) → `planner`(mode=initial) → `premortem`(mode=task) on high-risk tasks (parallel).                                                                                                                                                                                                                                                                             |
| 2 Build         | Per task: `test-writer` ║ `worker` → `validator`(scope=task). On fail: append to `attempts/<task>.md`, increment `task_iters[id]`, re-spawn worker. Max 5 iters → dispatch `planner`(mode=split). If split lineage already has `splits >= 2`, escalate instead of re-splitting.                                                                                              |
| 3 Integration   | `validator`(scope=slice, runs full gauntlet + every command in `acceptance_commands_required`) → `critic`(mode=diff) → `scope-judge`. Critic `revise` re-opens flagged tasks back into Phase 2. `scope-judge` cannot return `ship_ready: true` if any acceptance command did not run-and-pass — schema-enforced. **Finisher fold-in (v0.5):** when ≥3 tasks at wave-tail have small completion gaps (missing test file, single action wiring, source-grep gap) AND no behavioral changes are needed, the orchestrator MAY dispatch a single `worker`(role="finisher") that completes the gaps AND runs the slice validator gauntlet in the same dispatch. The finisher's summary MUST enumerate sub-tasks (`Sub-task 1: tN — …`) and report the full acceptance-command table. Schema-wise still a `worker` return with `files_touched[]` covering every touched path. |
| 4 Ship          | `journalist` (writes journal entry AND KB topic deltas in one pass) ║ `shipper`(commit + push + PR). Both run in parallel; journalist completes before PR body is finalized so the PR description references the journal entry path.                                                                                                                                       |
| 5 Retrospective | `retrospective` writes `skill-diff-proposal.md` from dispatch + attempts evidence. **NEVER auto-merge.** After: mark status `completed`, archive `.conductor/<N>/`, emit Done notification including any skill-diff-proposal path.                                                                                                                                            |

## Pre-ratification debate (v0.3, Phase 0)

A `triage` dispatch sits between ADR-read and ratification. Triage classifies the ADR as `light` (ratifier alone — v0.2 behavior) or `full` (debate fan-out before ratification) using a deterministic signal rule documented in `templates/triage.md`. The verdict and signals land in `events.jsonl` and `status.triage_depth`.

When `triage_depth=full`:
1. Dispatch `falsifier` and `premortem`(mode=direction) **in parallel** (both read the Stub, neither depends on the other).
2. Wait for both to return.
3. Dispatch `ratifier` with `falsifier_summary_path` and `direction_premortem_summary_path` populated. Ratifier MUST address each falsifier claim and each direction-level risk by name in Consequences — its template enforces this.
4. **(v0.4)** Dispatch `critic`(mode=proposal) with the proposal path, falsifier summary path, and direction-premortem summary path. The critic returns structured `falsifier_coverage[]` (one entry per claim) and `direction_risk_coverage[]` (one entry per risk). The orchestrator MUST verify array lengths equal upstream lengths — a result whose `falsifier_coverage.length !== falsifier.claims.length` is rejected as malformed and the critic is re-dispatched. If `verdict=revise`, loop back to ratifier with the critic's `concerns[]` and any unaddressed coverage indices. Existing 3-iter ratifier max applies; on overrun, escalate as stuck.

When `triage_depth=light`: skip falsifier, direction-premortem, AND proposal-mode critic. Dispatch `ratifier` directly. The proposal-mode critic does not run because there are no falsifier/risk obligations to verify.

The contract gets stress-tested *before* it's signed, AND the contract's adherence to the stress test is mechanically verified before the user is asked to sign. Phase 1's `premortem`(mode=task) is unchanged — it still runs against tasks after planning.

## Content-signature staleness detection (v0.3)

At Phase 0 close, the orchestrator hashes the canonical text of the ADR and the spec via `scripts/conductor/canonical-hash.ts` and stores both digests in `status.input_hashes`. A 12-char prefix is also stamped into the live ADR's frontmatter (`content_signature: <hex12>`) so the user can see it.

Canonicalization strips frontmatter except `Status` and `Slice`, normalizes whitespace, then SHA-256s the result. Frontmatter timestamp churn (e.g. someone editing `Ratified:`) does NOT trigger staleness. Substantive prose changes (Context, Decision, Consequences, Alternatives) DO trigger.

**On `/conductor resume`:** recompute signatures. If any differ, dispatch `critic`(mode=delta) with the snapshotted old text and the live new text. Critic returns `{additions, modifications, removals, severity, recommendation}`. The orchestrator chooses path by **schema-enforced rules, not user discretion**:

- Pure additions targeting unstarted tasks (severity `minor`) → `patch_forward` permitted: orchestrator injects new tasks into plan.json and resumes the build.
- Any modification or removal touching unstarted/in-flight work (severity `major`) → forced **rebootstrap**. Surface as escalation; mention "amendment" — the user may want a new ADR.
- Modification or removal touching a *completed* task's contract, or any change to Direction itself (severity `breaking`) → forced **rebootstrap**.
- `recommendation: abort` → escalate.

The `CriticDeltaSchema.superRefine` rejects `patch_forward` when modifications/removals are non-empty or severity is breaking. The orchestrator cannot offer the user an override on this.

**In-flight dispatch binding:** every dispatch envelope includes `input_signature` captured at dispatch time. When a result returns, the orchestrator compares the envelope's signature against the current `status.input_hashes` for the relevant ADR. Mismatch → reject the result as `stale_dispatch`, surface to user. This prevents background work from silently completing against a superseded ADR.

## High-risk auto-flag

Tasks linked to high-risk ADRs auto-trigger `premortem`(mode=task) in Phase 1. Define your project's high-risk ADR list in `CLAUDE.md` (or override this skill locally). Examples of high-risk territory: authorization (RLS), money handling, idempotency, audit-log integrity, identity verification, privacy/data-deletion. Specs may also flag individual tasks via `risk: high` frontmatter.

## Acceptance-command binding (v0.2)

The spec's frontmatter MUST list `acceptance_commands:` — runnable shell commands that exit 0 only when every numbered acceptance criterion is satisfied. The orchestrator freezes this list into `status.json` at Phase 0. The slice validator runs every command in Phase 3. `ScopeJudgeResultSchema.superRefine` rejects `ship_ready: true` when any command did not run-and-pass. This closes the silent-pass hole where `tsc + lint + test` all green still ships work that misses spec acceptance.

If the spec has no `acceptance_commands:` frontmatter or the array is empty, the orchestrator surfaces this as a Phase-1 critic concern and refuses to advance to Phase 2 until the spec is amended.

## Loop bounds (turn-boundary form, v0.5)

Each retry iteration is **its own turn**. The orchestrator dispatches in background, emits a sentinel (`GOAL-C:` for in-flight, `PING:` for stuck), calls `ScheduleWakeup`, and ends the turn. The next turn checks `TaskList` for completion and routes results. The orchestrator NEVER sits in a `while` loop inside a single turn — that pattern is invisible to `/goal`'s per-turn Haiku evaluator and balloons orchestrator context with worker output.

- **Validator loop** — max 5 iters per task (`task_iters[id]`); each iter is one turn. Pattern per iter: dispatch `validator`(run_in_background=true) → emit `GOAL-C: phase=2 task=t<id> iter=<n> awaiting=validator` → `ScheduleWakeup(60, "validator t<id> iter <n>")`. On resume: `TaskList` → if complete, route result; if fail, dispatch `worker` (background) → emit `GOAL-C` again. After 5 iters → dispatch `planner`(mode=split). If split lineage `splits[id] >= 2`, emit `PING: stuck — task=<id> exceeded 2 splits`.
- **Critic loop** — max 3 iters, same turn-per-iter pattern. After 3 iters → emit `PING: stuck — critic exceeded 3 revisions`.
- **Ratifier-revision loop** — max 3 iters, same pattern. After 3 iters → emit `PING: stuck — ratifier exceeded 3 revisions`.
- **Ratification approval wait** — when `ratifier` produces a proposal, emit `PING: ratification — review .conductor/<N>/ratification-proposal.md` and end the turn. `ScheduleWakeup(1200)` as a heartbeat; resume primarily on user re-engage.

**Cache-TTL guidance:** the 60s ScheduleWakeup delay for validator/critic loops keeps the prompt cache warm; the 1200s ratification heartbeat accepts the cache miss since the user-action gap is intrinsic and not worth burning cache 12× per hour for.

## Mid-flight worker failure recovery

A worker dispatch that ends WITHOUT a structured return (network socket killed, runner crash, context exhausted before final JSON) leaves files partially written and no `files_touched[]` manifest. On detection (dispatch timeout OR missing summary file at expected path), the orchestrator:

1. Increments `task_iters[id]` (counts as one attempt).
2. Re-dispatches the worker with `prior_state: "partial"` and an explicit "state on disk" briefing: list the paths the prior attempt was contracted to touch (from spec task scope), and instruct the worker to **Read each one first and reuse if compliant** (mark as `EXISTED / KEPT` in summary) instead of re-creating from scratch.
3. If the second attempt also fails without a structured return, escalate as `stuck` (emit `PING: stuck — worker mid-flight failure on task=<id>`); the cause is infrastructural, not work-quality.

Applied from ADR-0035 retrospective Diff 2 — the t17 socket-recovery pattern this codifies was previously manual.

## Token-efficiency rules (MANDATORY)

1. Agents return decision-grade JSON conforming to schemas in `scripts/conductor/schemas.ts` (14 schemas in `SCHEMA_BY_ROLE`). Full work product → file on disk; agent returns `summary_path` only.
2. Pass paths to agents, never file content.
3. State of truth is `.conductor/<N>/status.json`; rehydrate from disk after compression.
4. `events.jsonl` read by delta only (track `events_offset` in status).
5. Background-dispatch independent agents (`run_in_background=true`); read N completions in batches.
6. Templates live in `.claude/skills/conductor/templates/`; agents load them, you do not.
7. KB read by topic slice only.
8. Do not echo agent output to user. Surface decision points and escalations only.
9. Avoid status polling. Read `status.json` at phase boundaries.
10. Use ScheduleWakeup over wait-loops.

## Goal Integration (v0.5)

Every turn-ending response from the orchestrator MUST terminate with exactly ONE sentinel as the LAST LINE of the transcript. The `/goal` Haiku evaluator running between turns parses this line to decide success / block / continue. User-facing prose ABOVE the sentinel is unaffected — the sentinel is the parseable terminator, not the message.

| Sentinel                                                                                | Meaning                  | When                                                       |
| --------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------- |
| `GOAL-A: ADR-NNNN <slug> shipped — PR <url> — retrospective <path>`                     | Success                  | End of Phase 5 (escalation trigger 4)                      |
| `PING: <category> — <detail>`                                                           | Blocked on human action  | Escalation triggers 1, 2, 3, 5, 6, guardrail               |
| `GOAL-C: phase=<P> task=<id> background=<N> resume=/conductor resume`                   | Turn yield (work in flight) | Between waves; whenever `ScheduleWakeup` is set            |

`PING` categories (one-word tag immediately after `PING:`):

- `secrets` — env var / API key needed
- `auth` — OAuth / MFA / browser login
- `money` — paid tier / billing decision
- `ratification` — user approves stub→accepted proposal
- `stuck` — loop overrun (validator / critic / ratifier max-iters or splits>=2)
- `destructive` — confirm op on shared/production target
- `learn` — proposal-merge confirmation (see `/conductor learn` below)

Canonical mapping reference: `docs/kb/conductor-goal-integration.md` (project KB).

## Self-improvement loops

- Per-iteration: every validator failure appends to `attempts/<task>.md`. Next worker dispatch reads it.
- Per-shift: `journalist` writes both the journal entry AND topic-keyed KB deltas (one role, two output paths). Future workers/spec-writers/test-writers read the KB slice for their topic on every dispatch.
- Per-run: `retrospective` proposes a diff against this SKILL.md, written to `.conductor/<N>/skill-diff-proposal.md`. The proposal MUST populate a structured `proposed_diffs[]` field (per `RetrospectiveResultSchema`); an empty array is the valid "no improvements identified" output.
- **Per-merge (v0.5):** `/conductor learn [<adr>]` walks completed `.conductor/<N>/skill-diff-proposal.md` files, presents diffs against the live `SKILL.md` (or named KB topics) as a single review batch, and on user confirm (`PING: learn — apply <N> proposals?`) applies the diffs to both:
  - In-project: `.claude/skills/conductor/SKILL.md` (this file) and any named templates
  - Staging: `Downloads/conductor-harness/.claude/skills/conductor/SKILL.md` and matching templates

  Each applied diff is logged to the `Skill changelog (auto-learn)` section below with `(source: .conductor/<N>/skill-diff-proposal.md)`. **NEVER auto-merge; always user-gated.**

### Skill changelog (auto-learn)

(populated by `/conductor learn` runs — entries follow `<date> | <source-adr> | <one-line-summary>`)

- 2026-05-17 | manual-bootstrap | v0.5 bundles ADR-0035 retrospective Diffs 1, 2, 4 (finisher fold-in, mid-flight recovery, RLS contract notes) — first application of the learning loop, done manually since `/conductor learn` was not yet implemented.

## Roster (14 roles)

bootstrap: `triage`, `falsifier` (full debate only), `premortem` (mode=direction, full debate only), `ratifier`, `critic` (mode=proposal, full debate only — v0.4), `spec-writer`
plan: `critic` (mode=spec), `planner` (mode=initial), `premortem` (mode=task)
build: `worker`, `test-writer`, `validator`, `planner` (mode=split)
integration: `validator`, `critic` (mode=diff), `scope-judge`
ship: `journalist`, `shipper`
retrospective: `retrospective`
resume-staleness (cross-cutting): `critic` (mode=delta)

Multi-mode roles: `planner` (`initial`, `split`); `critic` (`spec`, `diff`, `delta`, `proposal`); `premortem` (`task`, `direction`); `journalist` writes journal + KB deltas in one pass. Roles added in v0.3: `triage`, `falsifier`. v0.1's `task-splitter` and `knowledge-curator` were merged in v0.2. Roster size unchanged at 14 — v0.4 adds a critic mode, not a new role.

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

**Before re-entering** (v0.3): recompute canonical signatures for every path in `status.input_hashes`. If any differ, dispatch `critic`(mode=delta) and follow the rule table in "Content-signature staleness detection" above before resuming any phase work. This check runs every resume regardless of phase, so an ADR amendment between sessions cannot silently affect an in-progress build. `triage_depth` carries forward — resume does NOT re-triage, since triage is part of Phase 0's first pass and a resumed run keeps the original depth verdict.

## Status surface

`/conductor status` prints: current ADR, phase, current_task_id, task_iters[current], splits[current], last 5 entries from `events.jsonl`, and `acceptance_commands_run` vs `acceptance_commands_required`.

## Abort

`/conductor abort` writes `phase: "aborted"` to status.json. Performs no destructive cleanup. The user may resume later or delete `.conductor/<N>/` manually.

## Source of truth

Design spec: `docs/superpowers/specs/2026-05-05-conductor-design.md`. If this skill drifts from the spec, update both deliberately — never silently. The structural validator (`scripts/conductor/validate-skill.ts`) checks frontmatter + non-empty templates + that every template's embedded JSON example parses against the corresponding schema in `SCHEMA_BY_ROLE`.

## Changelog

- **v0.5 (this version)**
  - **Goal Integration** — every turn-ending response terminates with exactly one of three sentinels (`GOAL-A:` success, `PING:` blocked-on-human, `GOAL-C:` turn-yield) so the Claude Code `/goal` Haiku evaluator composes cleanly with `/conductor`. Sentinel mapping table in §Goal Integration; canonical reference at `docs/kb/conductor-goal-integration.md`.
  - **Turn-boundary discipline** — §Loop bounds rewritten so each retry iteration is its own turn (background dispatch + `ScheduleWakeup` + `GOAL-C`), not a sync `while` inside a single turn. Cache-TTL-aware delays (60s tight loops, 1200s ratification heartbeat).
  - **`/conductor learn` sub-command** — applies the previously-unconsumed `skill-diff-proposal.md` files from completed cycles. `RetrospectiveResultSchema` gains required `proposed_diffs[]` field; new `Skill changelog (auto-learn)` section logs applied proposals.
  - **Finisher fold-in** — Phase 3 may dispatch a single `worker`(role="finisher") instead of N separate workers + a slice validator when ≥3 wave-tail tasks have small completion gaps. Applied from ADR-0035 retrospective Diff 1.
  - **Mid-flight failure recovery** — new section codifying the socket/timeout/context-exhaust recovery pattern. Applied from ADR-0035 retrospective Diff 2.
  - **Worker template** — adds optional `prior_state` field (`clean` | `partial`) and a "pre-existing failure disclaimer discipline" note (sibling contamination check). Applied from ADR-0035 retrospective Diffs 2 + 3.
  - **Spec-writer template** — adds "RLS contract authoring — known fidelity gaps" note distinguishing INSERT WITH CHECK (42501 throw) from UPDATE/DELETE/SELECT USING (silent rowCount=0). Applied from ADR-0035 retrospective Diff 4.
  - Roster size unchanged at 14. No new roles. No new modes. The `learn` sub-command is an orchestrator surface, not an agent role.

- **v0.4 (superseded)**
  - Critic gains `mode: "proposal"` for ratification review (Phase 0, only when `triage_depth: full`). Runs after ratifier produces a proposal, before user approval. Returns structured `falsifier_coverage[]` and `direction_risk_coverage[]` arrays so v0.3 obligations are mechanically verified, not prompt-stretched onto `mode: spec`.
  - `CriticProposalSchema.superRefine` rejects `verdict: ship` when any coverage entry has `addressed: false`. Orchestrator additionally enforces array-length equality with upstream falsifier and direction-mode premortem outputs.
  - Roster size unchanged (14). Roles added: zero. Modes added: one. SKILL.md flow change is the Phase-0 "Pre-ratification debate" section (a new step 4).
  - When `triage_depth: light`, proposal-mode critic does not run (nothing to verify).

- **v0.3**
  - Pre-ratification debate: `triage` decides depth (`light` | `full`); when `full`, `falsifier` and `premortem`(mode=direction) fan out before ratifier. Ratifier MUST address each falsifier and direction-risk by name in Consequences. Roster grows 12 → 14.
  - Content-signature staleness: canonical hash of ADR + spec stored in `status.input_hashes`; re-checked on `/conductor resume`. Substantive prose changes trigger `critic`(mode=delta) before re-entering. `patch_forward` is schema-restricted to additions on unstarted tasks; modifications, removals, or breaking severity force rebootstrap.
  - In-flight dispatch binding: every dispatch envelope carries `input_signature` so background work cannot silently complete against a since-amended ADR.
  - Schemas added: `TriageResultSchema`, `FalsifierResultSchema`, `DispatchEnvelopeSchema`. Modified: `CriticResultSchema` (delta mode + `CriticDeltaSchema.superRefine`), `PremortemResultSchema` (mode discriminator, default `"task"` for back-compat), `RatifierResultSchema` (`content_signature`), `StatusSchema` (`input_hashes`, `triage_depth`).
- **v0.2**
  - Phases reduced from 7 → 5 (folded Document into Ship, Cleanup into Retrospective).
  - Roster reduced from 14 → 12 (planner+task-splitter merged with `mode` discriminant; journalist+knowledge-curator merged with two output paths).
  - 8 new schemas added (PlannerResult, CriticResult, ScopeJudgeResult, PremortemResult, RatifierResult, JournalistResult, ShipperResult, RetrospectiveResult). `SCHEMA_BY_ROLE` registry exposes them by role name.
  - Acceptance-command binding: spec frontmatter `acceptance_commands:` array, validator runs them in Phase 3, scope-judge schema-rejects `ship_ready: true` when unrun.
  - Per-task `task_iters[id]` and `splits[id]` in `StatusSchema` — closes the resume-mid-split rerun bug.
- **v0.1** — initial 7-phase, 14-role design.
