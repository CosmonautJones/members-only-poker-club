# Design: `conductor` — pure-orchestrator skill

- **Date:** 2026-05-05 (v0.1) · Amended 2026-05-08 (v0.2) · Amended 2026-05-09 (v0.4)
- **Author:** Travis Jones (with Claude)
- **Status:** Implemented (v0.4 changes below; v0.3 was wired only into `.claude/skills/conductor/SKILL.md` and not mirrored here — see SKILL.md changelog for that ground)
- **Consumer:** the `superpowers:writing-plans` skill, immediately after approval

---

## v0.4 changes (2026-05-09)

Closes Issue #21. v0.3's pre-ratification debate (`triage` → `falsifier` ║ `premortem`(direction) → `ratifier`) shipped in PR #20 with the obligation that ratifier address every falsifier claim and direction-risk by name in Consequences. Live testing on ADR-0034 surfaced that the obligation was being verified by stretching `mode: "spec"` of the critic — useful but not mechanical, since `mode: "spec"`'s schema only carries `concerns: string[]`.

v0.4 adds a fourth critic mode dedicated to ratification-proposal review:

### Critic `mode: "proposal"`

Position in flow: **Phase 0**, after `ratifier` produces a proposal at `.conductor/<N>/ratification-proposal.md`, before the orchestrator escalates for user approval. Only fires when `triage_depth: full` — light proposals have no falsifier or direction-premortem outputs to verify.

Inputs: the proposal path, the falsifier summary path, and the direction-mode premortem summary path. The critic reads the proposal in full and emits one coverage entry per upstream claim/risk.

Returned schema (`CriticProposalSchema`):

```typescript
{
  mode: 'proposal',
  verdict: 'ship' | 'revise',
  falsifier_coverage: Array<{
    claim_index: number,        // index into upstream falsifier.claims
    addressed: boolean,
    where?: string,              // section heading where engaged
  }>,
  direction_risk_coverage: Array<{
    risk_index: number,          // index into upstream premortem.risks
    addressed: boolean,
    where?: string,
  }>,
  concerns: string[],            // free-form fallthrough for non-coverage issues
  summary_path: string,
}
```

Schema enforcement (`superRefine`):

- `verdict: ship` is rejected if ANY entry in `falsifier_coverage` has `addressed: false`.
- `verdict: ship` is rejected if ANY entry in `direction_risk_coverage` has `addressed: false`.

Orchestrator-boundary enforcement (not schema):

- `falsifier_coverage.length` MUST equal the upstream falsifier dispatch's `claims.length`.
- `direction_risk_coverage.length` MUST equal the upstream direction-mode premortem dispatch's `risks.length`.
- Mismatch → reject the result as malformed and re-dispatch the critic. Do NOT fall back to scoring coverage from the orchestrator.

Loop bound: if `verdict: revise`, loop back to ratifier with the critic's `concerns[]` and the indices of unaddressed coverage entries. Existing 3-iter ratifier max applies; on overrun, escalate as stuck.

### Why a new mode and not a stretched `mode: spec`

`mode: spec` was designed for Phase-1 implementation specs. A ratification proposal is a different artifact: it is the *contract being signed*. v0.3 obligations (every falsifier claim engaged, every direction risk addressed) are content-shaped, not spec-shaped. The live test of v0.3 (PR #20, ADR-0034 fixture) demonstrated that `mode: spec` produced useful concerns, but only because the prompt told the critic to apply v0.3 lenses; the schema couldn't enforce structured output beyond `concerns: string[]`. v0.4 makes coverage a first-class field so dropping a falsifier is mechanically detectable.

### Roster impact

Unchanged at 14 roles. Critic gains a 4th mode (`spec`, `diff`, `delta`, `proposal`). `SCHEMA_BY_ROLE.critic` continues to point at `CriticResultSchema = z.union([CriticSpecOrDiffSchema, CriticDeltaSchema, CriticProposalSchema])`.

---

## v0.2 amendments (2026-05-08)

After three independent reviews of v0.1 (code-quality, architectural, devil's-advocate), the following changes landed:

1. **Schema coverage extended.** v0.1 had Zod schemas for 4 of ~12 agent return shapes; v0.2 adds the missing 8 (PlannerResult, CriticResult, ScopeJudgeResult, PremortemResult, RatifierResult, JournalistResult, ShipperResult, RetrospectiveResult) and a `SCHEMA_BY_ROLE` registry the structural validator uses to parse each template's example block.
2. **Acceptance-command binding.** Spec frontmatter now requires an `acceptance_commands:` array. The slice-scope validator runs every command; `ScopeJudgeResultSchema.superRefine` schema-rejects `ship_ready: true` when any command did not run-and-pass. Closes the silent-pass hole where green `tsc + lint + test` shipped work that missed prose acceptance criteria.
3. **Per-task iter + split tracking.** `StatusSchema` gained `task_iters: Record<task_id, number>` and `splits: Record<task_id, number>`. Resume after a mid-split crash no longer re-triggers `task-splitter` on a task that was already mid-split. Hard cap of 2 chained splits before escalation.
4. **Roster reduction 14 → 12.** `task-splitter` merged into `planner` (one role with `mode: "initial" | "split"` discriminant). `knowledge-curator` merged into `journalist` (one role, two output paths: journal entry + KB topic deltas).
5. **Phase reduction 7 → 5.** Old Phase 4 (Document) folded into Phase 4 Ship (journalist runs in parallel with shipper). Old Phase 7 (Cleanup) folded into Phase 5 Retrospective tail. The pre-v0.2 phase numbers no longer correspond.
6. **Validator script teeth.** v0.1's `validate-skill.ts` only checked file existence + frontmatter regex (would pass on empty templates). v0.2 also requires: `# Role: <name>` heading, ≥50 chars body, every template's first `\`\`\`json` block parses against its `SCHEMA_BY_ROLE` schema after `{{placeholder}}` substitution. Catches typed-out enum unions (`"a" | "b"`) and stale removed-template files.

The 7-phase / 14-role description below is preserved for historical context. **The implementation reflects the 5-phase / 12-role v0.2 layout** — see `.claude/skills/conductor/SKILL.md` for the canonical current behavior.

---

## 1. Goal

Build a Claude Code skill — `conductor` — that turns Claude into a **pure orchestrator** for ADR-driven implementation work in this repo. Claude does no implementation work itself: every task is dispatched to a subagent. The orchestrator's only jobs are decomposing work, dispatching, routing results between agents, escalating to the user when policy requires it, and persisting state so runs can pause and resume.

The motivation is **lifespan-per-session**: by paying only for prompt-out and summary-back (not the full work product), one 250k-token session can drive **10–15 ADRs end-to-end** instead of 2–3.

## 2. Core principle: Pragmatic Purist

Claude (the orchestrator) **does not call** Read/Edit/Write/Bash/Grep on implementation files: source, tests, migrations, configs, or any project artifact larger than a control surface.

Claude **may directly read** a small, named control surface:

- The ADR being driven (`docs/adr/NNNN-*.md`)
- The paired implementation spec (`docs/specs/NNNN-*.md`)
- The journal template (`docs/journal/README.md`)
- The route-map and top-level spec (`docs/route-map.md`, `docs/spec.md`) when topology matters
- The on-disk orchestrator state (`.conductor/<N>/status.json`, `events.jsonl`)
- Structured agent return values

Everything else flows through agents.

## 3. Scope: paired-spec model

ADRs in this repo are decision records — Context/Decision/Consequences/Alternatives, ≤1 page each. They are **not** implementation specs.

The orchestrator consumes a **paired implementation spec** at `docs/specs/NNNN-<adr-slug>-implementation.md`. If one does not exist, Phase 0 dispatches a `spec-writer` agent to draft one from the ADR. The spec contains:

- Acceptance criteria (testable statements)
- Task decomposition hints
- Touched-files inventory
- Risk flags (auto-derived from linked ADRs)

ADRs remain immutable once Accepted. Specs iterate freely.

## 4. Architecture

### 4.1 Agent roster

| Tier | Role | Lifecycle | Returns |
|---|---|---|---|
| **Core** | `worker` | one task | diff path + status |
| | `test-writer` | one task | test paths + coverage notes |
| | `validator` | one run | `{pass: bool, failed_step, first_error_loc, summary_path}` |
| | `journalist` | one shift | journal-entry path |
| | `knowledge-curator` | one shift | KB-delta path |
| **Supporting** | `spec-writer` | one spec | spec path |
| | `planner` | one spec | `plan.json` + TaskCreate calls |
| | `task-splitter` | one stuck task | replacement subtasks for `plan.json` |
| | `ratifier` | one Stub ADR | proposal path + open_questions_count |
| | `shipper` | one PR | branch/PR URL |
| **Critic-tier** | `critic` | post-spec & post-impl | `{verdict, concerns[]}` |
| | `scope-judge` | end of slice | `{ship_ready: bool, missing[]}` |
| **Risk-tier** | `premortem` | high-risk task | `{risks[], mitigations[]}` |
| **Meta-tier** | `retrospective` | end of run | proposed skill diff path |

### 4.2 High-risk auto-flag

Tasks linked to these ADRs auto-trigger `premortem`:

- **0003** Authorization model — RLS
- **0004** Money handling — integer cents
- **0005** Idempotency / exactly-once
- **0006** Audit log — append-only
- **0009** Member identity & ID verification
- **0023** Privacy / GDPR / data deletion

Additional ADRs may be flagged in the paired spec via `risk: high` frontmatter.

## 5. Phase flow

```
/conductor <N>
    ↓
Phase 0  Bootstrap         read ADR; init .conductor/<N>/; if Status: Stub or Proposed → ratifier → user approves → write back to docs/adr/; ensure spec exists
Phase 1  Plan              critic(spec) → planner → premortem(high-risk, parallel)
Phase 2  Build             per task: test-writer ║ worker → validator
                           on fail: append attempt, re-spawn worker w/ history
                           max 5 iters → auto-decompose task → retry
                           only escalate if decomposition also fails
Phase 3  Integration       validator(full) → critic(diff vs spec) → scope-judge
Phase 4  Document          journalist ║ knowledge-curator
Phase 5  Ship              shipper: commit + push + PR
Phase 6  Retrospective     proposes skill diff, queues for user review (NEVER auto-merges)
Phase 7  Cleanup           archive .conductor/<N>/
```

Every phase transition is an atomic write to `.conductor/<N>/status.json`. `/conductor resume` reads `status.json` and re-enters at the recorded phase.

## 6. Loop semantics

### 6.1 Validator loop (Phase 2 per-task)

```
worker(task, attempt_log) → diff
validator(task, diff) → {pass, failure}
  if pass:                  task complete, advance
  if fail and iters < 5:    append failure to attempts/<task>.md, re-spawn worker
  if fail and iters == 5:   spawn task-splitter to decompose into smaller subtasks,
                            replace original task in plan.json, restart loop
  if decomposition fails:   escalate to user (Telegram + chat)
```

### 6.2 Critic loop (Phase 1 spec critique, Phase 3 diff critique)

```
critic(input) → {verdict: ship|revise, concerns[]}
  if ship:                  advance
  if revise and iters < 3:  re-spawn the producer (spec-writer or worker) w/ concerns
  if revise and iters == 3: escalate
```

A Phase 3 critic `revise` verdict re-opens the affected tasks back into the Phase 2 worker loop with the concerns list as additional context. Tasks that were not flagged stay complete.

### 6.3 Scope-judge (Phase 3 terminal)

```
scope-judge(spec, all_diffs, all_validator_reports) → {ship_ready: bool, missing[]}
  if ship_ready:    advance to Phase 4
  if not:           re-enter Phase 2 with `missing[]` as new tasks
```

## 7. State on disk

```
.conductor/                       # gitignored
  <adr-number>/
    status.json                   # {phase, current_task_id, iter_count, started_at, ...}
    spec.md                       # symlink or copy of docs/specs/<n>-*.md
    plan.json                     # task graph (also reflected in TaskCreate state)
    events.jsonl                  # append-only event log
    attempts/
      <task-id>.md                # per-task failure trail
    dispatches/
      0001-spec-writer.md         # full prompt-out + summary-back per dispatch
      0002-planner.md
      ...
    journal-draft.md              # WIP, promoted to docs/journal/ at Phase 5
    kb-deltas.md                  # WIP, promoted to KB at Phase 5
    skill-diff-proposal.md        # retrospective output, awaits user review
  _archive/                       # completed runs
    <adr-number>/...
```

`.conductor/` is **gitignored**. The journal entry and KB additions are *promoted* into the repo by the shipper at Phase 5; the orchestrator's working memory is not committed.

## 8. Token-efficiency techniques (orchestrator-side)

These are mandatory for the orchestrator's prompts and result handling:

1. **Agents return decision-grade structured output.** Validators return `{pass, failed_step, first_error_loc, summary_path}` not prose. Workers return `{status, diff_path, files_touched, summary_path}`. Full work product written to disk; orchestrator reads only the decision data.
2. **Pass paths, not content.** Dispatch prompts give agents file paths to read for themselves. The orchestrator never embeds spec text in a prompt.
3. **Disk as memory.** After each phase transition, working set drops to the next-action pointer. State is rehydrated from `status.json` after auto-compression.
4. **Append-only event log with offset tracking.** `events.jsonl` is read by delta, not in full.
5. **Background dispatch + batched checkpoints.** Independent agents run via `run_in_background=true`; completions are read in batches.
6. **SKILL.md is minimal.** Templates and prompt fragments live in `.claude/skills/conductor/templates/` and are loaded by agents, not the orchestrator.
7. **KB keyed by topic.** Workers read the slice relevant to their task only.
8. **No echo.** Orchestrator does not paraphrase agent output back to the user; it surfaces only decision points and escalations.
9. **No status polling.** TaskList/file rereads are avoided in favor of `status.json` reads at phase boundaries.
10. **ScheduleWakeup over wait-loops** for long agent runs.

## 9. Self-improvement loops

Three independent loops reinforce each other:

1. **Per-iteration learning** — every validator failure appends a one-liner to `attempts/<task>.md`. The next worker dispatch reads this. Prevents repeating the same failed approach.
2. **Per-shift KB feedback** — `knowledge-curator` writes topic-keyed lessons to a persistent KB at `docs/kb/`. Every future `worker`/`test-writer`/`spec-writer` dispatch begins by reading the KB slice for its topic. Lessons compound across shifts.
3. **Per-run skill evolution** — `retrospective` reads the entire run's dispatch log, attempt logs, and journal entry. It proposes a diff against `.claude/skills/conductor/SKILL.md` itself. The diff is written to `skill-diff-proposal.md` and surfaced to the user for explicit accept/reject. **Never auto-merged.**

## 10. Escalation policy

The orchestrator pauses and pings the user **only** for these triggers:

1. **API keys / secrets** must be configured by the user
2. **Login / OAuth / MFA / browser auth** required
3. **Money decisions** — paid tier upgrades, purchases, billing
4. **Done** — final completion notification at end of Phase 7. If a `skill-diff-proposal.md` was produced by the retrospective, the Done message includes the path and a one-line summary so the user can review.
5. **Ratification approval** — when `ratifier` produces a Stub→Accepted proposal at `.conductor/<N>/ratification-proposal.md`, pause and ask the user to accept (or request revisions) before any `docs/adr/` file is modified
6. **Stuck** — validator-loop max-iters exceeded *and* auto-decomposition also failed; or critic-loop max-iters exceeded; or ratifier-revision loop max 3 iters
7. **Implicit guardrail (system-level)** — destructive ops on shared/production systems (force-push to main, drop tables, delete branches with unpushed work, etc.) always confirm

Notifications go to chat. If a Telegram channel is configured (`telegram:configure`), notifications also go there for trigger 4 and trigger 5 specifically (so the user can be away from the terminal).

The orchestrator does **not** ping for: design ambiguities (resolved by spec-writer + critic), validation failures within budget, premortem findings (fed into worker prompts), failed PR creation on first attempt (retried).

## 11. Invocation

```
/conductor <adr-number>          # start: drive ADR-NNNN to merge
/conductor resume                # pick up at recorded phase from status.json
/conductor status                # print current phase + last 5 events
/conductor abort                 # mark status as aborted, no destructive cleanup
```

The slash command is implemented at `.claude/commands/conductor.md`. It dispatches the skill with arguments. Outside `/conductor`, Claude works normally — the Pragmatic Purist constraint applies *only* inside an active conductor run.

## 12. File layout

```
.claude/
  skills/
    conductor/
      SKILL.md                    # workflow rules only, minimal
      templates/
        spec-writer-prompt.md     # prompt fragment for each agent role
        worker-prompt.md
        validator-prompt.md
        critic-prompt.md
        scope-judge-prompt.md
        premortem-prompt.md
        journalist-prompt.md
        knowledge-curator-prompt.md
        planner-prompt.md
        retrospective-prompt.md
      schemas/
        validator-result.json     # JSONSchema for structured returns
        plan.json                 # JSONSchema for task graph
        status.json               # JSONSchema for phase state
  commands/
    conductor.md                  # slash command entry point

docs/
  specs/                          # paired implementation specs (new dir)
    NNNN-<adr-slug>-implementation.md
  kb/                             # topic-keyed knowledge base (new dir)
    rls.md
    money-handling.md
    auth.md
    ...
  superpowers/
    specs/
      2026-05-05-conductor-design.md   # this file

.conductor/                       # gitignored, working memory only
```

`.gitignore` adds `.conductor/` as part of skill installation.

## 13. Estimated session economics

With all techniques in §8 applied:

- One ADR end-to-end (spec → plan → 8–12 tasks built+validated → integration → docs → ship → retro): **~15–25k orchestrator tokens**
- One 250k-token session: **10–15 ADRs**, or **1–2 full slices**, before `/conductor resume` handoff is needed

Without these techniques: ~80–120k orchestrator tokens per ADR, 2–3 ADRs per session.

## 14. Out of scope

- Multi-ADR parallel orchestration in a single run (sequential only; user runs multiple `/conductor` instances if desired)
- Cross-project portability (this build is poker-club-tuned; portable v2 is future work)
- Auto-merging skill-diff proposals (always user-gated)
- Replacing existing `team:shipper`, `team:documentor`, `superpowers:requesting-code-review` agents — the conductor invokes them where they fit
- Spec-format standardization across other projects (this project's conventions only)

## 15. Open questions for the implementation plan

These are not blockers for the design but need resolution during planning:

- **Telegram trigger format** — message templates for triggers 4 and 5
- **KB topic taxonomy** — initial set of `docs/kb/` files seeded from existing ADRs
- **Spec template** — exact frontmatter and section structure for `docs/specs/NNNN-*.md`
- **Validator command set** — which commands constitute "the gauntlet" for this project (likely `pnpm typecheck`, `pnpm test`, `pnpm lint`, plus spec-defined acceptance commands)
- **Skill-diff dry-run** — should the retrospective also produce a *test* of its proposed diff (e.g., simulate the run with the new skill), or is human review the only safety net? (Default: human review only, dry-run is future work.)
- **Ratifier auto-accept policy** — currently the ratifier always pauses for user approval (escalation trigger #5). Future amendment could allow auto-accept on truly low-risk ADRs (single-paragraph, no cross-refs) to reduce interruptions. Defer until interruption-frequency data is available.

## 16. Done criteria

The skill is shipped when:

- `/conductor <N>` drives ADR-0011 (time-bank model, currently Stub) end-to-end on a feature branch with a real PR
- `/conductor resume` successfully recovers from a force-quit mid-Phase 2
- The retrospective produces at least one skill-diff proposal that the user reviews
- One full slice (Slice 1: marketing + auth skeleton) is shippable via repeated `/conductor` invocations within a single 250k session

## 17. Amendments

| Date | Section(s) | Change | Reason |
|---|---|---|---|
| 2026-05-05 | §4.1, §5, §10, §15 | Added `ratifier` role; Phase 0 dispatches ratifier on Stub/Proposed status instead of refusing; new escalation trigger #5 (ratification approval). | First real `/conductor` run (against ADR-0030, Stub) refused at Phase 0. Manual ratification of all slice-1 Stubs would have been ~3-4 hours of one-off work; folding ratification into the conductor pipeline is reusable across all 24 Stubs and matches Travis's stated philosophy of agent-driven work. |
