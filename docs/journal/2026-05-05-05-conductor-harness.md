---
date: 2026-05-05
adrs: []
slice: 1
type: infra
status: complete
---

# Conductor harness — pure-orchestrator skill scaffolding

## Context

Travis's vision: turn Claude into a pure orchestrator that delegates ALL implementation work to subagents, preserving the orchestrator's context window so a single 250k session can drive 10–15 ADRs end-to-end. The harness reads paired implementation specs (one per ADR), runs a 7-phase flow per ADR, and self-improves via three feedback loops (per-iteration attempt logs, per-shift KB updates, per-run skill-diff proposals).

## Changes

- New skill at `.claude/skills/conductor/` — SKILL.md (workflow rules) + 13 role templates
- Slash command `.claude/commands/conductor.md` with `<adr-number> | resume | status | abort` forms
- Zod schemas for status/plan/validator-result/role-summary in `scripts/conductor/schemas.ts`
- Structural skill validator at `scripts/conductor/validate-skill.ts`
- `pnpm validate:conductor` script (vitest run scripts/conductor)
- Topic-keyed KB seeded at `docs/kb/` (rls, money-handling, idempotency, audit-log, auth, pii)
- Spec template + README at `docs/specs/`
- `.gitignore` adds `.conductor/` (working memory, never committed)

## Decisions

- **Pragmatic Purist over Hard Purist:** orchestrator may directly read the small control surface (ADR, spec, journal template, status.json) but no source/tests/migrations. Hard purist would have cost extra agent hops for trivial reads with no real benefit.
- **Paired-spec model over ADR-as-contract:** ADRs stay sharp one-pagers; implementation detail lives in `docs/specs/NNNN-*.md` which iterates freely. Matches the existing ADR/journal split philosophy.
- **Project-local skill, not user-global:** baked in this project's conventions (journal template, ADR numbering, slice phasing). If it earns its keep, a portable v2 is future work.
- **Self-improvement is user-gated:** the retrospective agent proposes skill-diffs but never auto-merges. Travis reviews and accepts. Kill-switch preserved.
- **Escalation is narrow:** only 4 triggers (API keys, login, money, done) plus stuck and the system-level destructive guardrail. Everything else: autonomous grind.

## Tests

- `pnpm validate:conductor` passes (zod schemas + structural validator).
- Smoke test (real `/conductor` run on an ADR) is deferred to next shift; this shift only ships the harness.

## Next

- Run `/conductor <N>` against ADR-0030 (SEO & content strategy, slice 1, low-risk) as the first real exercise. Shake out any harness defects before pointing it at high-risk ADRs.
- The retrospective from that first run will likely propose its first SKILL.md diff — review and accept/reject.

## Notes for future me

- The orchestrator's biggest risk is silently drifting from the design spec under self-improvement pressure. The retrospective is sandboxed against `docs/superpowers/specs/2026-05-05-conductor-design.md` for exactly this reason — but watch it.
- If you find yourself opening `Read` on a source file *during* a `/conductor` run, you broke Pragmatic Purist. Stop, dispatch an agent, audit the SKILL.md.
- The `.conductor/` working memory pattern doubles as durable session state. `/conductor resume` is the cross-session handoff — use it instead of trying to keep one session alive.
