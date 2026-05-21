---
name: run
description: Lightweight slice orchestrator. Reads ADR + spec, plans via TodoWrite, decides serial vs background-parallel per task shape, runs sharp tools (gauntlet/ship/branch-guard), captures surprises to the learnings inbox. Replaces /conductor for everyday slices. Use when invoked via `/run <adr-number-or-slug>`.
---

# /run — lightweight slice orchestrator (v1)

You are the same Claude that talks to the user. You are NOT a separate "orchestrator" agent. Context is continuous; you do not serialize state to JSON between steps.

**Invocation:** `/run <NNNN>` (ADR number) — or `/run <free-form goal>` for ad-hoc work.

## Why this skill exists

`/conductor` was a 14-role, 5-phase, schema-marshalled framework that paid distributed-systems overhead to coordinate copies of one model that already shares all its weights. This skill replaces it with: **one Claude session, sharp tools, behavior-binding skills, hooks-driven learnings**.

Use `/run` for ~90% of slices. Use `/conductor` only on slices with genuine multi-wave parallelism AND high-risk surface (money + auth + idempotency simultaneously). When in doubt, `/run`.

## The seven-step ritual

Work through these in order. Use TodoWrite to track. Check each off as it completes.

### 1. Orient (≤ 2 min)

- Read `docs/adr/<NNNN>-*.md` (or, if `<NNNN>` is a free-form goal, skip).
- Read paired spec `docs/specs/<NNNN>-*.md` if it exists. If the ADR is `Status: Stub` or `Status: Proposed` and no spec exists, **STOP** — surface to user as `PING: ratification` and ask whether to draft spec inline or kick a separate ratification cycle. ADR drafting is not in `/run`'s scope.
- Read the spec's `acceptance_commands:` frontmatter. These are the gauntlet for this slice. If empty or absent, **STOP** — surface as `PING: spec-shape — acceptance_commands missing in <spec path>`.
- Read any `Linked KB topics` the spec names. Trust auto-loaded skills (rls-audit, money-audit, etc.) to cover their domains when triggers match.

### 2. Branch hygiene (≤ 30 sec)

- Run `bash scripts/run-tools/branch-guard.sh check` (or `--from-main feature/<adr-slug>` if currently on main).
- Tool reports: `{current_branch, started_from_main, action_taken}`. If on main, the tool creates `feature/<adr-slug>` and switches.
- If branch is something unexpected (not main, not the expected feature branch), surface as `PING: branch — currently on <X>, expected feature/<Y>; continue / switch / abort?`.

### 3. Plan (≤ 5 min)

- Write a TodoWrite plan covering the acceptance criteria. One task per AC or per logical bundle (don't over-decompose).
- For each task, judge: **serial or parallel?**
  - Default: serial. Most tasks share invariants, files, or context.
  - Parallel ONLY when ALL: (a) 3+ truly independent tasks, (b) disjoint touched-files, (c) each task is non-trivial (≥ 5 file edits or ≥ 100 LOC), (d) no shared schema/contract changes between them. Otherwise serialize — the dispatch tax is not worth it.
- If high-risk (`risk: high` in spec frontmatter, OR linked to one of: 0003 auth, 0004 money, 0005 idempotency, 0006 audit, 0009 identity, 0023 privacy/deletion): invoke `Skill(skill="premortem")` BEFORE planning the build. Pin the risks inline in your TodoWrite descriptions so they're in context during build.

### 4. Build

For each TodoWrite task:

- Mark `in_progress` BEFORE starting.
- If **serial** (default): grind in main session. Read inputs, write code, write tests, move on.
- If **parallel** (rare, see step 3 criteria): dispatch background subagents in ONE message with `run_in_background=true`. Brief each subagent: scope, files allowed, return shape (1-paragraph summary + files_touched list). Harvest results as they complete. Integrate.
- Mark `completed` ONLY when the task's slice of acceptance criteria is provably done. NOT when the worker said it was done — when you can point at the code AND the test that exercises it.
- After every meaningful task: run `pnpm format` on touched files. This is non-optional (recurrence lesson — see learnings inbox).

### 5. Gauntlet

- Run `bash scripts/run-tools/gauntlet.sh <spec-path>`.
- Tool runs: `pnpm typecheck`, `pnpm lint`, `pnpm test`, plus every `acceptance_commands:` from the spec frontmatter. Returns structured `{pass, failed_step, first_error_loc, diagnosis, fault_attribution, acceptance_commands_run, acceptance_commands_unrun}`.
- On `pass: false`: the structured `fault_attribution` field tells you which task to revisit. Re-open that TodoWrite item, fix, re-run gauntlet. Max 5 iters per task (track in your head, not in a status.json) — if exceeded, surface as `PING: stuck — task=<id> 5 iters on <failure>`.
- On `pass: true` with non-empty `acceptance_commands_unrun`: that's still a fail. The slice did not run-and-pass every command. Treat as fail and resolve.

### 6. Ship

Three subcommands invoked in order: **stage → commit → push**.

- **Stage:** `bash scripts/run-tools/ship.sh stage <spec-path>` — pre-flight checks (branch not main, gh auth matches origin owner, working tree has changes). Returns `{status: "ready", branch, files_pending}`.
- **Commit:** `bash scripts/run-tools/ship.sh commit <spec-path> <commit-msg-file> <file1> [<file2> ...]` — **explicit file list is REQUIRED** (v0.2 from digest 2026-05-21 — eliminates the `git add -A` footgun that captured a stray temp file on the first live test). The tool also refuses to stage anything matching `*.tmp|*.scratch|*.draft|*.wip|*~|*.bak|*.orig`. Commits with message from file. STOPS — does NOT push.
- **STOP and surface a `PING: ship — N commits ready, push?`** — pushing changes shared state (escalation guardrail #7). User authorizes.
- **Push:** `bash scripts/run-tools/ship.sh push <branch> <pr-title-file> <pr-body-file>` — re-verifies gh auth, pushes, opens PR. Refuses to push to protected branches. Refuses to `--force` anything. Refuses to amend pushed commits. If push fails with 403, re-checks auth before retrying.

**Temp-file discipline:** before invoking `ship.sh commit`, the orchestrator typically writes the commit message to a temp file like `.commit-msg.tmp`. Pass that temp file path as the second argument (commit-msg-file), but NOT in the staged-file list. The tool's pattern guard refuses to stage `*.tmp` files even if you forget. After the commit succeeds, delete the temp file before any subsequent ship invocation.

### 7. Journal + close

- Write the journal entry at `docs/journal/<YYYY-MM-DD>-NN-run-adr-<NNNN>-<slug>.md` following the frontmatter convention (`date`, `adrs`, `slice`, `type`, `status`). Use the existing entries as shape reference — minimum sections: Context, Changes, Tests, Lessons.
- Emit final sentinel: `GOAL-A: ADR-<NNNN> <slug> shipped — PR <url> — journal <path>`.
- Any surprises this run (unexpected failures, ambiguities, retries) are auto-captured to `learnings/inbox/` by hooks (see `.claude/settings.json`). You do not write to the inbox manually — that's hook territory. Trust it.

## Decision table: /run vs /conductor

| Slice shape | Use |
|---|---|
| Single-file fix, doc edit, simple feature | `/run` |
| Multi-file feature, one or two ACs | `/run` |
| 5-15 acceptance criteria, no parallel waves | `/run` |
| High-risk (money / auth / RLS) but linear | `/run` + relevant audit skill auto-loads |
| Genuine parallel waves (5+ independent tasks across disjoint files, all non-trivial) | `/conductor` (legacy) |
| ADR is Stub/Proposed and needs ratification | Out of scope — separate ratification cycle |

If `/run` hits genuine multi-wave parallelism mid-slice (rare), it can dispatch background subagents directly (step 4 above) without escalating to `/conductor`. The slash command is not the boundary; the dispatch pattern is.

## Sentinel contract (kept from v0.5 for `/goal` composability)

Every turn-ending response terminates with exactly ONE sentinel on the LAST LINE:

- `GOAL-A: ADR-NNNN <slug> shipped — PR <url> — journal <path>` — done
- `PING: <category> — <detail>` — blocked on human (`secrets` / `auth` / `money` / `ratification` / `spec-shape` / `branch` / `ship` / `stuck`)
- `GOAL-C: phase=<step> task=<id> resume=/run <NNNN>` — turn yield (work in flight, ScheduleWakeup set)

Most `/run` cycles emit `GOAL-A:` at the end of step 7 without ever needing `GOAL-C:` — turn-yield is only for genuine background-dispatch waves (step 4 parallel mode).

## Escalation policy (4 triggers + 1 stuck + 2 guardrails)

Pause and notify the user ONLY for:

1. API keys / secrets — needed but absent
2. Login / OAuth / MFA / browser auth
3. Money decisions (paid-tier upgrades, purchases, billing)
4. Done — end of step 7 (`GOAL-A:` sentinel)
5. Ratification approval — ADR is Stub/Proposed, escalate before any `docs/adr/` write
6. Stuck — 5 iters on a single failure, OR gauntlet fails with `fault_attribution: infrastructure`, OR tool returns `branch_drift`
7. Implicit guardrail: destructive ops (force-push, drop tables, branch deletes with unpushed work) always confirm
8. Push to remote — always confirm (step 6 STOP)

Do NOT escalate for: within-budget gauntlet failures, lint/format diffs (the worker fixes them), first-attempt PR creation hiccups (retry once), missing minor KB topics (proceed without).

## What lives where (so you know what to read and what's auto-loaded)

- **This skill** (`.claude/skills/run/SKILL.md`): the ritual. Read on every `/run` invocation.
- **Sharp tools** (`scripts/run-tools/*.sh`): runnable. Pure shell, no LLM. Read source if you need to debug; otherwise just call them.
- **Auto-loading skills** (e.g. `rls-audit`, `money-audit`, `migration-safe`, `pglite-gotchas`, `audit-log-invariants`): triggered by frontmatter `description` matches. Don't manually invoke unless a skill description names a trigger you see in the current task.
- **Learnings inbox** (`learnings/inbox/<date>-<auto>.md`): filled mechanically by hooks. You do not write here. `/digest` skill processes it weekly or on demand.
- **The journal** (`docs/journal/<date>-NN-run-adr-<NNNN>-<slug>.md`): one entry per slice. You write the final entry in step 7.

## The pragma about pragmas

Don't add new pragmas, new schemas, new state files. If a rule matters, encode it in a tool (mechanical), a test (mechanical), or a skill with a sharp trigger (loads in context). Prose pragmas in this SKILL.md are last-resort and should be deleted if they don't bind behavior.

## Source of truth

This skill replaces the 14-role conductor framework. If you find yourself reaching for `templates/worker.md` or `templates/validator.md` or anything under `.claude/skills/conductor/` — stop. That framework is in archive mode. Read `.claude/skills/conductor/SKILL.md` only if explicitly invoking `/conductor` for a genuine multi-wave parallel slice.
