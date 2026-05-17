# Conductor + `/goal` integration — sentinel contract

Linked ADR(s): conductor harness itself (Slice 1 infra); applies to every ADR driven through it under `/goal`.

The `/goal` primitive (Claude Code v2.1.139+) evaluates each turn's final transcript line via a Haiku model. For `/conductor` to compose cleanly with `/goal`, every turn the orchestrator emits MUST terminate with exactly one sentinel as the LAST LINE. Conductor v0.5 codifies this.

## The three sentinels

| Sentinel                                                                    | Meaning                  | Cache strategy                            |
| --------------------------------------------------------------------------- | ------------------------ | ----------------------------------------- |
| `GOAL-A: ADR-NNNN <slug> shipped — PR <url> — retrospective <path>`         | Success                  | Final turn; cache fate doesn't matter     |
| `PING: <category> — <detail>`                                               | Blocked on human action  | User-gap; cache miss accepted             |
| `GOAL-C: phase=<P> task=<id> background=<N> resume=/conductor resume`       | Turn yield, work in flight | ScheduleWakeup at 60–270s keeps cache warm |

## PING categories

One-word tag immediately after `PING:` — the Haiku evaluator pattern-matches on this:

- `secrets` — env var / API key needed (escalation trigger 1)
- `auth` — OAuth / MFA / browser login (trigger 2)
- `money` — paid tier / billing decision (trigger 3)
- `ratification` — user approves stub→accepted proposal (trigger 5)
- `stuck` — loop overrun: validator / critic / ratifier max-iters, or splits>=2 (trigger 6)
- `destructive` — confirm op on shared/production target (implicit guardrail)
- `learn` — proposal-merge confirmation from `/conductor learn`

## Phase-by-phase emission map

| Phase | Normal path | Block path |
| --- | --- | --- |
| 0 Bootstrap | `GOAL-C: phase=0 task=ratify background=1 resume=/conductor resume` while ratifier runs | `PING: ratification — review .conductor/<N>/ratification-proposal.md` after proposal lands |
| 1 Plan | `GOAL-C: phase=1 task=plan background=<N> resume=/conductor resume` while critic + planner + premortems run | `PING: stuck — critic exceeded 3 revisions` on max-iter |
| 2 Build | `GOAL-C: phase=2 task=t<id> iter=<n> awaiting=validator` per task iter | `PING: stuck — task=<id> exceeded 2 splits` on lineage cap |
| 3 Integration | `GOAL-C: phase=3 task=integration background=<N>` while validator/critic/scope-judge run | (rare) `PING: destructive — confirm <op>` if scope-judge surfaces a destructive op |
| 4 Ship | `GOAL-C: phase=4 task=ship background=2` while journalist + shipper run in parallel | `PING: stuck — shipper PR create retry budget exhausted` (rare) |
| 5 Retrospective | `GOAL-A: ADR-NNNN <slug> shipped — PR <url> — retrospective <path>` on completion | (no block path; retrospective always completes) |

## Why this contract works under `/goal`

- The Haiku evaluator runs **between turns**, not inside. A long-running turn with sync internal loops is invisible to it. Turn-boundary discipline (§Loop bounds in SKILL.md) plus the sentinel make each iter parseable.
- `GOAL-A:` triggers `/goal` to exit cleanly with the success condition met.
- `PING:` signals a human action is needed — `/goal` surfaces it and waits.
- `GOAL-C:` says "I'm not done, but my turn is" — `/goal` continues without ending the session.

## Verification

The repo carries `tests/skills/conductor-sentinels.test.ts` (v0.5) that source-greps SKILL.md to assert:

1. Every of the 6 escalation triggers + the guardrail has a corresponding `PING:` sentinel mapping.
2. `GOAL-A:` is emitted ONLY at end of Phase 5.
3. `GOAL-C:` is emitted at every phase boundary that issues a background dispatch.

If SKILL.md drifts from this contract, the test fails and CI catches it before a `/conductor` run wedges under `/goal`.

## Related KB

- `docs/kb/conductor-loop.md` — the broader conductor harness lessons; see 2026-05-17 entries for the v0.5 turn-boundary rationale.
- ADR-0035 retrospective at `.conductor/0035/skill-diff-proposal.md` — exemplar of the structured `proposed_diffs[]` format the `/conductor learn` sub-command consumes.
