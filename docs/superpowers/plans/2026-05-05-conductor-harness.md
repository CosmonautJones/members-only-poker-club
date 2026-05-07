# Conductor Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `conductor` pure-orchestrator skill, slash command, prompt templates, schemas, validation harness, KB seed, and journal entry — so `/conductor <N>` becomes operable on subsequent ADR work.

**Architecture:** Project-local skill at `.claude/skills/conductor/` with minimal `SKILL.md`, role-specific prompt templates in `templates/`, zod schemas under `scripts/conductor/`. Slash command at `.claude/commands/conductor.md`. Working state at gitignored `.conductor/`. Validation via vitest + a structural skill-validator script. Knowledge base seeded at `docs/kb/`.

**Tech Stack:** Markdown skills, zod for schemas, vitest for tests, pnpm scripts, Node 20+, TypeScript.

**Source spec:** `docs/superpowers/specs/2026-05-05-conductor-design.md`

---

## File Structure

**Created:**

```
.claude/
  skills/
    conductor/
      SKILL.md
      templates/
        worker.md
        test-writer.md
        validator.md
        critic.md
        scope-judge.md
        premortem.md
        spec-writer.md
        planner.md
        task-splitter.md
        shipper.md
        journalist.md
        knowledge-curator.md
        retrospective.md
      schemas/
        README.md             # points to scripts/conductor/schemas.ts
  commands/
    conductor.md

scripts/conductor/
  schemas.ts                  # zod definitions (status, plan, validator-result, role-summary)
  schemas.test.ts             # fixture-based round-trip tests
  validate-skill.ts           # structural validator
  validate-skill.test.ts      # vitest harness
  fixtures/
    status.valid.json
    status.invalid-missing-phase.json
    plan.valid.json
    validator-result.valid.json

docs/
  specs/
    _template.md              # template for paired implementation specs
  kb/
    README.md
    rls.md                    # ADR-0003
    money-handling.md         # ADR-0004
    idempotency.md            # ADR-0005
    audit-log.md              # ADR-0006
    auth.md                   # ADR-0002
    pii.md                    # ADR-0009 / 0023
  journal/
    2026-05-05-05-conductor-harness.md
```

**Modified:**

- `.gitignore` (add `.conductor/`)
- `package.json` (add `validate:conductor` script)

---

## Task 1: Scaffold directories, .gitignore, package script

**Files:**
- Modify: `.gitignore`
- Modify: `package.json:10-30`

- [ ] **Step 1: Create the directory structure**

```bash
mkdir -p .claude/skills/conductor/templates
mkdir -p .claude/skills/conductor/schemas
mkdir -p .claude/commands
mkdir -p scripts/conductor/fixtures
mkdir -p docs/specs
mkdir -p docs/kb
```

- [ ] **Step 2: Add `.conductor/` to `.gitignore`**

Append to end of `.gitignore`:

```gitignore

# Conductor orchestrator working memory (never committed)
.conductor/
```

- [ ] **Step 3: Add `validate:conductor` to package.json scripts**

In `package.json`, inside `"scripts": { ... }`, add after `"typecheck"`:

```json
    "validate:conductor": "vitest run scripts/conductor"
```

- [ ] **Step 4: Verify pnpm picks up the script**

Run: `pnpm run`
Expected: output lists `validate:conductor` among available scripts.

- [ ] **Step 5: Commit**

```bash
git add .gitignore package.json
git commit -m "chore(conductor): scaffold dirs + validate:conductor script"
```

---

## Task 2: Zod schemas with TDD

Defines the four JSON contracts the orchestrator and agents speak: `status`, `plan`, `validator-result`, `role-summary`. Each is a typed zod schema; agents return JSON conforming to one of these and the orchestrator parses with `.parse()` (throws on shape mismatch).

**Files:**
- Create: `scripts/conductor/schemas.ts`
- Create: `scripts/conductor/schemas.test.ts`
- Create: `scripts/conductor/fixtures/status.valid.json`
- Create: `scripts/conductor/fixtures/status.invalid-missing-phase.json`
- Create: `scripts/conductor/fixtures/plan.valid.json`
- Create: `scripts/conductor/fixtures/validator-result.valid.json`

- [ ] **Step 1: Write the failing tests**

Create `scripts/conductor/schemas.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  StatusSchema,
  PlanSchema,
  ValidatorResultSchema,
  RoleSummarySchema,
} from "./schemas";

const fx = (name: string) =>
  JSON.parse(readFileSync(resolve(__dirname, "fixtures", name), "utf8"));

describe("StatusSchema", () => {
  it("parses a valid status", () => {
    expect(() => StatusSchema.parse(fx("status.valid.json"))).not.toThrow();
  });
  it("rejects status missing `phase`", () => {
    expect(() =>
      StatusSchema.parse(fx("status.invalid-missing-phase.json")),
    ).toThrow();
  });
});

describe("PlanSchema", () => {
  it("parses a valid plan", () => {
    expect(() => PlanSchema.parse(fx("plan.valid.json"))).not.toThrow();
  });
  it("rejects a plan whose blockedBy points at a non-existent task", () => {
    const bad = { ...fx("plan.valid.json") };
    bad.tasks = [
      { id: "t1", title: "x", blockedBy: ["does-not-exist"], risk: "low" },
    ];
    expect(() => PlanSchema.parse(bad)).toThrow();
  });
});

describe("ValidatorResultSchema", () => {
  it("parses a valid validator result", () => {
    expect(() =>
      ValidatorResultSchema.parse(fx("validator-result.valid.json")),
    ).not.toThrow();
  });
  it("requires failure fields when pass=false", () => {
    expect(() =>
      ValidatorResultSchema.parse({ pass: false }),
    ).toThrow();
  });
});

describe("RoleSummarySchema", () => {
  it("requires a summary_path", () => {
    expect(() =>
      RoleSummarySchema.parse({ status: "ok" }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Write the fixtures**

Create `scripts/conductor/fixtures/status.valid.json`:

```json
{
  "adr": "0011",
  "phase": "build",
  "started_at": "2026-05-05T10:00:00Z",
  "current_task_id": "t3",
  "iter_count": 1,
  "events_offset": 142,
  "spec_path": "docs/specs/0011-time-bank-implementation.md"
}
```

Create `scripts/conductor/fixtures/status.invalid-missing-phase.json`:

```json
{
  "adr": "0011",
  "started_at": "2026-05-05T10:00:00Z",
  "iter_count": 0,
  "events_offset": 0
}
```

Create `scripts/conductor/fixtures/plan.valid.json`:

```json
{
  "spec_path": "docs/specs/0011-time-bank-implementation.md",
  "tasks": [
    { "id": "t1", "title": "Schema migration", "blockedBy": [], "risk": "high", "linked_adrs": ["0004", "0011"] },
    { "id": "t2", "title": "Server action: deposit", "blockedBy": ["t1"], "risk": "high", "linked_adrs": ["0004", "0005"] },
    { "id": "t3", "title": "UI form", "blockedBy": ["t2"], "risk": "low", "linked_adrs": ["0011"] }
  ]
}
```

Create `scripts/conductor/fixtures/validator-result.valid.json`:

```json
{
  "pass": false,
  "failed_step": "tsc",
  "first_error_loc": "src/lib/time-bank.ts:42",
  "summary_path": ".conductor/0011/dispatches/0014-validator.md"
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm validate:conductor`
Expected: tests fail with "Cannot find module './schemas'".

- [ ] **Step 4: Write the schemas**

Create `scripts/conductor/schemas.ts`:

```typescript
import { z } from "zod";

export const PHASES = [
  "bootstrap",
  "plan",
  "build",
  "integration",
  "document",
  "ship",
  "retrospective",
  "cleanup",
  "completed",
  "aborted",
  "escalated",
] as const;

export const StatusSchema = z.object({
  adr: z.string().regex(/^\d{4}$/),
  phase: z.enum(PHASES),
  started_at: z.string().datetime(),
  current_task_id: z.string().optional(),
  iter_count: z.number().int().nonnegative(),
  events_offset: z.number().int().nonnegative(),
  spec_path: z.string().optional(),
  escalation_reason: z.string().optional(),
});

export type Status = z.infer<typeof StatusSchema>;

const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  blockedBy: z.array(z.string()).default([]),
  risk: z.enum(["low", "medium", "high"]),
  linked_adrs: z.array(z.string().regex(/^\d{4}$/)).default([]),
});

export const PlanSchema = z
  .object({
    spec_path: z.string(),
    tasks: z.array(TaskSchema).min(1),
  })
  .superRefine((plan, ctx) => {
    const ids = new Set(plan.tasks.map((t) => t.id));
    for (const task of plan.tasks) {
      for (const dep of task.blockedBy) {
        if (!ids.has(dep)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `task ${task.id} blockedBy references unknown task ${dep}`,
          });
        }
      }
    }
  });

export type Plan = z.infer<typeof PlanSchema>;

export const ValidatorResultSchema = z.discriminatedUnion("pass", [
  z.object({
    pass: z.literal(true),
    summary_path: z.string(),
  }),
  z.object({
    pass: z.literal(false),
    failed_step: z.string(),
    first_error_loc: z.string(),
    summary_path: z.string(),
  }),
]);

export type ValidatorResult = z.infer<typeof ValidatorResultSchema>;

export const RoleSummarySchema = z.object({
  status: z.enum(["ok", "blocked", "context_exhausted", "failed"]),
  summary_path: z.string(),
  notes: z.string().optional(),
  files_touched: z.array(z.string()).default([]),
});

export type RoleSummary = z.infer<typeof RoleSummarySchema>;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm validate:conductor`
Expected: all 7 tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/conductor/
git commit -m "feat(conductor): zod schemas for status, plan, validator-result, role-summary"
```

---

## Task 3: Skill structural validator (TDD)

A standalone validator that confirms the built skill has all required files, frontmatter, and templates. This runs as part of `pnpm validate:conductor`.

**Files:**
- Create: `scripts/conductor/validate-skill.ts`
- Create: `scripts/conductor/validate-skill.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/conductor/validate-skill.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateConductorSkill } from "./validate-skill";

describe("validateConductorSkill", () => {
  it("returns no errors when the skill is well-formed", () => {
    const result = validateConductorSkill();
    expect(result.errors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm validate:conductor`
Expected: fail with "Cannot find module './validate-skill'".

- [ ] **Step 3: Write the validator**

Create `scripts/conductor/validate-skill.ts`:

```typescript
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const SKILL_DIR = join(REPO_ROOT, ".claude", "skills", "conductor");
const TEMPLATES_DIR = join(SKILL_DIR, "templates");
const COMMAND_FILE = join(REPO_ROOT, ".claude", "commands", "conductor.md");

const REQUIRED_TEMPLATES = [
  "worker.md",
  "test-writer.md",
  "validator.md",
  "critic.md",
  "scope-judge.md",
  "premortem.md",
  "spec-writer.md",
  "planner.md",
  "task-splitter.md",
  "shipper.md",
  "journalist.md",
  "knowledge-curator.md",
  "retrospective.md",
];

const FRONTMATTER_NAME = /^name:\s*conductor\s*$/m;
const FRONTMATTER_DESC = /^description:\s*.+\S.*$/m;

export function validateConductorSkill(): { errors: string[] } {
  const errors: string[] = [];

  if (!existsSync(SKILL_DIR)) {
    errors.push(`missing dir: ${SKILL_DIR}`);
    return { errors };
  }

  const skillMd = join(SKILL_DIR, "SKILL.md");
  if (!existsSync(skillMd)) {
    errors.push(`missing file: ${skillMd}`);
  } else {
    const body = readFileSync(skillMd, "utf8");
    if (!body.startsWith("---")) errors.push("SKILL.md missing frontmatter");
    if (!FRONTMATTER_NAME.test(body))
      errors.push("SKILL.md frontmatter missing or wrong `name: conductor`");
    if (!FRONTMATTER_DESC.test(body))
      errors.push("SKILL.md frontmatter missing `description`");
  }

  if (!existsSync(TEMPLATES_DIR)) {
    errors.push(`missing dir: ${TEMPLATES_DIR}`);
  } else {
    const present = new Set(readdirSync(TEMPLATES_DIR));
    for (const t of REQUIRED_TEMPLATES) {
      if (!present.has(t)) errors.push(`missing template: ${t}`);
    }
  }

  if (!existsSync(COMMAND_FILE)) {
    errors.push(`missing slash command: ${COMMAND_FILE}`);
  }

  return { errors };
}
```

- [ ] **Step 4: Run the test (it should still fail — no skill yet)**

Run: `pnpm validate:conductor`
Expected: schema tests pass; `validate-skill.test.ts` fails with errors listing missing SKILL.md, missing templates, missing command file.

This is the GOAL state: subsequent tasks fill in the missing pieces, and this test goes green when the skill is complete.

- [ ] **Step 5: Commit**

```bash
git add scripts/conductor/validate-skill.ts scripts/conductor/validate-skill.test.ts
git commit -m "feat(conductor): structural validator for skill artifacts (failing as expected)"
```

---

## Task 4: Write SKILL.md

The minimal workflow rules. Templates live elsewhere; this file is what Claude loads when invoking the skill.

**Files:**
- Create: `.claude/skills/conductor/SKILL.md`

- [ ] **Step 1: Write the SKILL.md**

```markdown
---
name: conductor
description: Pure-orchestrator skill for ADR-driven implementation. Use when invoked via `/conductor <adr-number>`. Claude becomes a delegator — all implementation work goes to subagents. Drives one ADR end-to-end through 7 phases (bootstrap, plan, build, integration, document, ship, retrospective). Maximizes session lifespan by keeping the orchestrator's context clean.
---

# Conductor — Pure Orchestrator

You are the orchestrator. **You do not implement.** You dispatch agents, route their structured returns, persist state, and escalate only on the four trigger conditions.

## Pragmatic Purist rule

You may directly read:
- The ADR being driven (`docs/adr/NNNN-*.md`)
- The paired implementation spec (`docs/specs/NNNN-*.md`)
- The journal template (`docs/journal/README.md`)
- `docs/route-map.md`, `docs/spec.md` when topology matters
- On-disk orchestrator state under `.conductor/<N>/`
- Structured agent return values

You may NOT directly read or write source code, tests, migrations, configs, or any project artifact larger than the control surface above. Everything else flows through agents.

## Phase flow

| Phase | Action |
|---|---|
| 0 Bootstrap | Read ADR (refuse if `Status: Stub`); init `.conductor/<N>/`; ensure paired spec exists (dispatch `spec-writer` if not). |
| 1 Plan | `critic`(spec) → `planner` → `premortem` on high-risk tasks (parallel). |
| 2 Build | Per task: `test-writer` ║ `worker` → `validator`. On fail: append to `attempts/<task>.md`, re-spawn worker. Max 5 iters → dispatch `task-splitter`, restart loop. |
| 3 Integration | `validator`(full slice) → `critic`(diff vs spec) → `scope-judge`. Critic `revise` re-opens flagged tasks back into Phase 2. |
| 4 Document | `journalist` ║ `knowledge-curator` (parallel). |
| 5 Ship | `shipper`: commit + push + PR. |
| 6 Retrospective | `retrospective` writes `skill-diff-proposal.md`. **NEVER auto-merge.** |
| 7 Cleanup | Mark status `completed`; archive `.conductor/<N>/`; emit Done notification including any skill-diff-proposal path. |

## High-risk auto-flag

Tasks linked to ADRs **0003, 0004, 0005, 0006, 0009, 0023** auto-trigger `premortem`. Specs may flag additional tasks via `risk: high` frontmatter.

## Loop bounds

- Validator loop: max 5 iters per task; then `task-splitter`. If split-and-retry also fails, escalate.
- Critic loop: max 3 iters; then escalate.

## Token-efficiency rules (MANDATORY)

1. Agents return decision-grade JSON conforming to schemas in `scripts/conductor/schemas.ts`. Full work product → file on disk; agent returns `summary_path` only.
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
- Per-shift: `knowledge-curator` writes topic-keyed KB deltas. Future workers/spec-writers/test-writers read the KB slice for their topic on every dispatch.
- Per-run: `retrospective` proposes a diff against this SKILL.md, written to `.conductor/<N>/skill-diff-proposal.md`. User-gated; never auto-merged.

## Escalation policy (4 triggers + 1 stuck + 1 guardrail)

Pause and notify the user ONLY for:
1. API keys / secrets to configure
2. Login / OAuth / MFA / browser auth
3. Money decisions (paid tier upgrades, purchases, billing)
4. Done — end of Phase 7 (include skill-diff-proposal path if present)
5. Stuck — validator-loop max-iters AND auto-decompose also failed; or critic-loop max-iters
6. Implicit guardrail: destructive ops on shared/production systems (force-push to main, drop tables, branch deletes with unpushed work) always confirm

Do NOT escalate for: design ambiguities (resolved by spec-writer + critic), within-budget validator failures, premortem findings (fed into worker prompts), first-attempt PR creation failure (retried).

If `telegram:configure` has run, also send Telegram messages for triggers 4 and 5.

## Resume semantics

`/conductor resume` reads `.conductor/<latest>/status.json` and re-enters at the recorded phase. Idempotent: completed phases are skipped; in-flight phase restarts from its first step.

## Status surface

`/conductor status` prints: current ADR, phase, current_task_id, iter_count, last 5 entries from `events.jsonl`.

## Abort

`/conductor abort` writes `phase: "aborted"` to status.json. Performs no destructive cleanup. The user may resume later or delete `.conductor/<N>/` manually.

## Source of truth

Design spec: `docs/superpowers/specs/2026-05-05-conductor-design.md`. If this skill drifts from that spec, update both deliberately — never silently.
```

- [ ] **Step 2: Re-run validator**

Run: `pnpm validate:conductor`
Expected: SKILL.md errors gone; templates and command file errors remain.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/conductor/SKILL.md
git commit -m "feat(conductor): SKILL.md workflow rules"
```

---

## Task 5: Core role templates (worker, test-writer, validator)

Each template is a prompt the orchestrator passes to `Agent({ prompt: <template-rendered>, ... })`. The orchestrator interpolates `{{...}}` placeholders before dispatching.

**Files:**
- Create: `.claude/skills/conductor/templates/worker.md`
- Create: `.claude/skills/conductor/templates/test-writer.md`
- Create: `.claude/skills/conductor/templates/validator.md`

- [ ] **Step 1: Write `worker.md`**

```markdown
# Role: worker

You implement ONE task from the spec. You are the only agent that writes implementation source code for this task.

## Inputs

- **Spec:** `{{spec_path}}` — focus on Task `{{task_id}}` only
- **ADR:** `{{adr_path}}` — context only, do not re-derive decisions
- **Linked KB topics:** {{kb_paths}} — read these before coding; surface unknown gotchas
- **Prior attempts:** {{attempts_path}} — empty file means this is attempt 1; otherwise read all entries before proposing your approach
- **Premortem findings (if high-risk):** {{premortem_path}}
- **Repo root:** `{{repo_root}}`

## What to do

1. Read inputs above. If anything is missing or contradictory, return `status: "blocked"` with `notes` describing the conflict.
2. Make the minimal code change that satisfies Task `{{task_id}}`'s acceptance criteria.
3. Commit nothing. Just write files. The shipper handles git.
4. Write a brief work summary to `{{summary_path}}` covering: what you changed, why, what you considered and rejected, what you flagged for the test-writer.

## What you MUST return

A single JSON object matching `RoleSummarySchema`:

```json
{
  "status": "ok" | "blocked" | "context_exhausted" | "failed",
  "summary_path": "{{summary_path}}",
  "files_touched": ["src/...", "..."],
  "notes": "one-line headline"
}
```

Return ONLY the JSON. No prose, no commentary, no markdown fences.

## Constraints

- Do not modify files outside this task's scope (per spec).
- Do not run `git`, `pnpm test`, or `pnpm validate:conductor` — that is the validator's job.
- If you ran low on context, return `status: "context_exhausted"` with `notes` describing what's left. The orchestrator will decompose and retry.
- If your approach matches a prior failed attempt, pivot — do not repeat.
```

- [ ] **Step 2: Write `test-writer.md`**

```markdown
# Role: test-writer

You write tests for ONE task. You do not implement source code.

## Inputs

- **Spec:** `{{spec_path}}` — Task `{{task_id}}`
- **Worker's summary (if already run):** `{{worker_summary_path}}` — may be empty if you run in parallel
- **Linked KB topics:** {{kb_paths}}
- **Repo conventions:** vitest + @testing-library/react; e2e with playwright. Test files mirror source paths under `tests/` or co-located `.test.ts`.

## What to do

1. Identify each acceptance criterion in Task `{{task_id}}`.
2. Write one or more tests per criterion. Prefer behavior tests over implementation-detail tests.
3. Tests must be runnable with `pnpm test` or `pnpm test:e2e` as appropriate.
4. Write a coverage summary to `{{summary_path}}`: which criteria each test maps to, and any uncovered criteria with reasons.

## Return

JSON `RoleSummarySchema`. `files_touched` lists the test files. `notes` lists any criteria you could not test and why.
```

- [ ] **Step 3: Write `validator.md`**

```markdown
# Role: validator

You run the gauntlet and report structured pass/fail. You do not fix anything.

## Inputs

- **Repo root:** `{{repo_root}}`
- **Scope:** {{scope}} — either `task:<id>` (run only changed files' relevant checks) or `slice` (full)
- **Spec acceptance commands (optional):** {{acceptance_commands}}

## What to do

Run, in order, stopping at the first failure unless told otherwise:

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm test`
4. Each command in `acceptance_commands` (if any).

Capture full output of the failing step (or all if all pass) to `{{summary_path}}`.

## Return

JSON conforming to `ValidatorResultSchema`:

- pass=true: `{ "pass": true, "summary_path": "..." }`
- pass=false: `{ "pass": false, "failed_step": "tsc"|"lint"|"test"|"<acceptance>", "first_error_loc": "<file:line>", "summary_path": "..." }`

Return ONLY the JSON.
```

- [ ] **Step 4: Re-run validator**

Run: `pnpm validate:conductor`
Expected: 3 fewer template errors.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/conductor/templates/worker.md .claude/skills/conductor/templates/test-writer.md .claude/skills/conductor/templates/validator.md
git commit -m "feat(conductor): core role templates (worker, test-writer, validator)"
```

---

## Task 6: Critic-tier templates (critic, scope-judge, premortem)

**Files:**
- Create: `.claude/skills/conductor/templates/critic.md`
- Create: `.claude/skills/conductor/templates/scope-judge.md`
- Create: `.claude/skills/conductor/templates/premortem.md`

- [ ] **Step 1: Write `critic.md`**

```markdown
# Role: critic

You read with intent. You catch semantic drift the validator can't.

## Inputs

- **Mode:** {{mode}} — `spec` (review the spec itself) or `diff` (review code diff against spec)
- **Spec:** `{{spec_path}}`
- **Diff (if mode=diff):** `{{diff_path}}` (output of `git diff` for the slice)
- **Validator report (if mode=diff):** `{{validator_summary_path}}`

## What to do

If mode=spec: ask "is this spec implementable as written? Are acceptance criteria testable? Is anything ambiguous, contradictory, or under-specified?"
If mode=diff: ask "did this code actually solve what the spec asked for, beyond compiling and passing tests? Are there shortcuts, missed edge cases, or work that addresses the letter but not the intent?"

Write a verdict to `{{summary_path}}` with reasoning.

## Return

```json
{
  "verdict": "ship" | "revise",
  "concerns": ["concern 1", "concern 2"],
  "summary_path": "{{summary_path}}"
}
```

If `verdict: "ship"`, `concerns` may be empty. Return ONLY the JSON.
```

- [ ] **Step 2: Write `scope-judge.md`**

```markdown
# Role: scope-judge

You decide whether the slice is ship-ready against the spec's acceptance criteria.

## Inputs

- **Spec:** `{{spec_path}}`
- **Plan:** `{{plan_path}}`
- **Per-task validator reports:** {{validator_report_paths}}
- **Full diff:** `{{diff_path}}`

## What to do

For each acceptance criterion in the spec, decide if it is satisfied by the diff and validators. List any unsatisfied criteria as `missing[]` with the criterion text and why it's unmet.

Write the full reasoning to `{{summary_path}}`.

## Return

```json
{
  "ship_ready": true | false,
  "missing": [{ "criterion": "...", "reason": "..." }],
  "summary_path": "{{summary_path}}"
}
```

If `ship_ready: true`, `missing` is `[]`. Return ONLY the JSON.
```

- [ ] **Step 3: Write `premortem.md`**

```markdown
# Role: premortem

Assume this task ships and breaks 6 months from now. Walk backward and surface the failure modes.

## Inputs

- **Task:** Task `{{task_id}}` from `{{spec_path}}`
- **Linked ADRs:** {{linked_adrs}} — read ADR text for each
- **KB topics:** {{kb_paths}}

## What to do

For the task, enumerate plausible failure modes. For each, state:
- **Trigger:** what causes it
- **Blast radius:** money, PII, auth, audit, availability — which axis hurts
- **Mitigation:** concrete code-level or test-level guard the worker should add

Write the full analysis to `{{summary_path}}`.

## Return

```json
{
  "risks": [
    { "trigger": "...", "blast_radius": "money|pii|auth|audit|availability", "mitigation": "..." }
  ],
  "summary_path": "{{summary_path}}"
}
```

Return ONLY the JSON.
```

- [ ] **Step 4: Re-run validator**

Run: `pnpm validate:conductor`
Expected: 6 fewer template errors than start of Task 5.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/conductor/templates/critic.md .claude/skills/conductor/templates/scope-judge.md .claude/skills/conductor/templates/premortem.md
git commit -m "feat(conductor): critic-tier templates (critic, scope-judge, premortem)"
```

---

## Task 7: Supporting templates (spec-writer, planner, task-splitter, shipper)

**Files:**
- Create: `.claude/skills/conductor/templates/spec-writer.md`
- Create: `.claude/skills/conductor/templates/planner.md`
- Create: `.claude/skills/conductor/templates/task-splitter.md`
- Create: `.claude/skills/conductor/templates/shipper.md`

- [ ] **Step 1: Write `spec-writer.md`**

```markdown
# Role: spec-writer

You produce one paired implementation spec for an ADR.

## Inputs

- **ADR:** `{{adr_path}}` (Status must be Accepted or Proposed; if Stub, return `status: "blocked"`)
- **Slice context:** `{{route_map_path}}`, `{{top_spec_path}}` (read for topology only)
- **Spec template:** `docs/specs/_template.md`
- **Critic concerns (if iterating):** `{{critic_concerns_path}}` (may be empty)

## What to do

Produce `docs/specs/{{adr_number}}-{{slug}}-implementation.md` matching the template. Required sections:

- frontmatter (`adr`, `slice`, `risk`)
- Goal
- Acceptance criteria (testable, numbered)
- Task decomposition hints (rough cuts; planner refines)
- Touched-files inventory (best estimate)
- Risk flags (auto-flag if linked ADR ∈ {0003, 0004, 0005, 0006, 0009, 0023})
- Out of scope

If iterating from critic concerns, address each concern explicitly.

## Return

```json
{
  "status": "ok" | "blocked",
  "spec_path": "docs/specs/0011-time-bank-implementation.md",
  "summary_path": "{{summary_path}}",
  "notes": "..."
}
```
```

- [ ] **Step 2: Write `planner.md`**

```markdown
# Role: planner

You break the spec into a task graph.

## Inputs

- **Spec:** `{{spec_path}}`
- **Repo conventions:** Next.js 14 App Router, Supabase, RLS. Tasks should map to one server action / one route / one component / one migration where possible.

## What to do

Produce `{{plan_path}}` matching `PlanSchema`. Each task:
- has a stable id (`t1`, `t2`, ...)
- declares `blockedBy` deps explicitly
- declares `linked_adrs` (used for premortem auto-flag)
- declares `risk: low|medium|high` (high if any linked ADR ∈ the auto-flag set, OR spec marks it)

Tasks should be **2–8 hours of human work** each. If a task is bigger, split it.

## Return

```json
{
  "status": "ok",
  "plan_path": "{{plan_path}}",
  "summary_path": "{{summary_path}}",
  "task_count": 7
}
```
```

- [ ] **Step 3: Write `task-splitter.md`**

```markdown
# Role: task-splitter

You split a stuck task into smaller subtasks.

## Inputs

- **Original task:** Task `{{task_id}}` in `{{plan_path}}`
- **Spec:** `{{spec_path}}`
- **Attempts log:** `{{attempts_path}}` — each prior worker attempt and why it failed
- **Validator reports:** {{validator_summary_paths}}

## What to do

Read why prior attempts failed. Decompose the original task into **2–4 subtasks** that are each smaller and orthogonal. Update `{{plan_path}}` in place: remove the original task, insert subtasks, fix `blockedBy` references that pointed at the original.

## Return

```json
{
  "status": "ok",
  "removed_task_id": "{{task_id}}",
  "added_task_ids": ["t6a", "t6b"],
  "summary_path": "{{summary_path}}"
}
```

If the task cannot be sensibly split (it's already atomic), return `status: "blocked"` with reasoning. The orchestrator will escalate.
```

- [ ] **Step 4: Write `shipper.md`**

```markdown
# Role: shipper

You handle git: commit the slice, push, open the PR.

## Inputs

- **Repo root:** `{{repo_root}}`
- **Branch (current):** `{{branch}}`
- **Spec:** `{{spec_path}}`
- **Journal entry:** `{{journal_entry_path}}`
- **Diff scope:** all uncommitted + staged changes belonging to this slice

## What to do

1. `git status` — confirm the working tree contains only this slice's changes (no foreign edits).
2. Stage explicit files (not `git add -A`).
3. Commit with message body derived from spec Goal + journal entry Changes section.
4. `git push -u origin {{branch}}` (the branch already exists; do not create a new one).
5. `gh pr create` with title from spec Goal, body from journal entry's Context + Changes + Tests sections.
6. Never force-push. Never amend a pushed commit. If the push fails, return `status: "blocked"`.

## Return

```json
{
  "status": "ok" | "blocked",
  "commit_sha": "abc123",
  "pr_url": "https://github.com/...",
  "summary_path": "{{summary_path}}"
}
```
```

- [ ] **Step 5: Re-run validator**

Run: `pnpm validate:conductor`
Expected: 4 fewer template errors.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/conductor/templates/spec-writer.md .claude/skills/conductor/templates/planner.md .claude/skills/conductor/templates/task-splitter.md .claude/skills/conductor/templates/shipper.md
git commit -m "feat(conductor): supporting templates (spec-writer, planner, task-splitter, shipper)"
```

---

## Task 8: Meta templates (journalist, knowledge-curator, retrospective)

**Files:**
- Create: `.claude/skills/conductor/templates/journalist.md`
- Create: `.claude/skills/conductor/templates/knowledge-curator.md`
- Create: `.claude/skills/conductor/templates/retrospective.md`

- [ ] **Step 1: Write `journalist.md`**

```markdown
# Role: journalist

You write the journal entry for the shift.

## Inputs

- **Journal template:** `docs/journal/README.md`
- **ADR:** `{{adr_path}}`
- **Spec:** `{{spec_path}}`
- **Plan:** `{{plan_path}}`
- **Validator reports:** {{validator_summary_paths}}
- **Worker summaries:** {{worker_summary_paths}}
- **Repo state:** `git log --oneline {{base_branch}}..HEAD`

## What to do

Produce `docs/journal/{{date}}-{{nn}}-{{slug}}.md` matching the template's frontmatter and section structure exactly:
- Context, Changes, Decisions, Tests, Next, Notes for future me

Be **descriptive**, not prescriptive — what we did and why, not what we will do.

## Return

```json
{
  "status": "ok",
  "entry_path": "docs/journal/2026-05-05-NN-slug.md",
  "summary_path": "{{summary_path}}"
}
```
```

- [ ] **Step 2: Write `knowledge-curator.md`**

```markdown
# Role: knowledge-curator

You extract durable lessons into the topic-keyed KB.

## Inputs

- **All attempts logs:** `{{attempts_dir}}`
- **All dispatch records:** `{{dispatches_dir}}`
- **Validator failures (full):** {{failed_validator_paths}}
- **Existing KB index:** `docs/kb/README.md`
- **Existing KB topics:** files in `docs/kb/`

## What to do

For each non-trivial lesson — gotcha, surprise, "next time avoid X" — pick the right topic file (or propose a new one) and append a dated bullet.

Format per bullet:

```markdown
- **2026-05-05** — short lesson. *Context:* what we were doing. *Why it matters:* why future-you cares.
```

If you propose a new topic file, also update `docs/kb/README.md` index.

## Return

```json
{
  "status": "ok",
  "topics_modified": ["rls.md", "money-handling.md"],
  "topics_created": [],
  "summary_path": "{{summary_path}}"
}
```
```

- [ ] **Step 3: Write `retrospective.md`**

```markdown
# Role: retrospective

You propose a diff against `.claude/skills/conductor/SKILL.md` based on the run's evidence.

## Inputs

- **All dispatches:** `{{dispatches_dir}}`
- **All attempts logs:** `{{attempts_dir}}`
- **Journal entry:** `{{journal_entry_path}}`
- **Skill source:** `.claude/skills/conductor/SKILL.md`
- **Skill design spec:** `docs/superpowers/specs/2026-05-05-conductor-design.md`

## What to do

Look for patterns across this run:
- Repeated agent failures of the same kind
- Roles that returned `status: "blocked"` more than once
- Phases where iter_count crept toward bounds
- Loops where a different role would have helped sooner

For each pattern, propose a CONCRETE diff to SKILL.md (or to one of the templates). Stay within the design spec — do not propose changes that conflict with `2026-05-05-conductor-design.md`. If you'd violate the design spec, propose a design-spec amendment instead.

Write proposed diffs as unified diff hunks to `{{proposal_path}}`.

## Return

```json
{
  "status": "ok",
  "proposal_path": "{{proposal_path}}",
  "patterns_found": 3,
  "diffs_proposed": 2,
  "summary_path": "{{summary_path}}"
}
```

If no patterns warrant a change, return `patterns_found: 0`, `diffs_proposed: 0`.
```

- [ ] **Step 4: Re-run validator**

Run: `pnpm validate:conductor`
Expected: 3 fewer template errors. All 13 templates now present; only the slash command remains missing.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/conductor/templates/journalist.md .claude/skills/conductor/templates/knowledge-curator.md .claude/skills/conductor/templates/retrospective.md
git commit -m "feat(conductor): meta templates (journalist, knowledge-curator, retrospective)"
```

---

## Task 9: Slash command

**Files:**
- Create: `.claude/commands/conductor.md`

- [ ] **Step 1: Write `conductor.md`**

```markdown
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
```

- [ ] **Step 2: Re-run validator**

Run: `pnpm validate:conductor`
Expected: ALL tests pass. Validator returns `errors: []`.

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/conductor.md
git commit -m "feat(conductor): slash command entry point"
```

---

## Task 10: KB seed files

Six topic files seeded with frontmatter and a "no entries yet" placeholder. The knowledge-curator appends to these on each run.

**Files:**
- Create: `docs/kb/README.md`
- Create: `docs/kb/rls.md`
- Create: `docs/kb/money-handling.md`
- Create: `docs/kb/idempotency.md`
- Create: `docs/kb/audit-log.md`
- Create: `docs/kb/auth.md`
- Create: `docs/kb/pii.md`

- [ ] **Step 1: Write `docs/kb/README.md`**

```markdown
# Knowledge base

Topic-keyed lessons accumulated across conductor runs. Each file holds dated bullets — gotchas, surprises, "next time avoid X" — written by the `knowledge-curator` agent at the end of each shift.

Workers, test-writers, and spec-writers read the relevant topic slice on every dispatch, so the KB compounds over time.

## Topics

| File | ADR(s) |
|---|---|
| [rls.md](rls.md) | 0003 |
| [money-handling.md](money-handling.md) | 0004 |
| [idempotency.md](idempotency.md) | 0005 |
| [audit-log.md](audit-log.md) | 0006 |
| [auth.md](auth.md) | 0002 |
| [pii.md](pii.md) | 0009, 0023 |

New topics: append a row above and create the file. Curator may propose new topics that don't fit existing ones.

## Bullet format

```markdown
- **YYYY-MM-DD** — short lesson. *Context:* what we were doing. *Why it matters:* why future-you cares.
```
```

- [ ] **Step 2: Write the six topic files**

Each file uses this exact body (substitute `<TOPIC>` and `<ADR>`):

```markdown
# <TOPIC>

Linked ADR(s): <ADR>.

## Lessons

_No entries yet — curator will populate as runs accumulate._
```

Specifically:
- `docs/kb/rls.md`: TOPIC=Row-Level Security, ADR=0003
- `docs/kb/money-handling.md`: TOPIC=Money handling, ADR=0004
- `docs/kb/idempotency.md`: TOPIC=Idempotency & exactly-once, ADR=0005
- `docs/kb/audit-log.md`: TOPIC=Audit log, ADR=0006
- `docs/kb/auth.md`: TOPIC=Authentication & sessions, ADR=0002
- `docs/kb/pii.md`: TOPIC=PII & privacy, ADR=0009, 0023

- [ ] **Step 3: Commit**

```bash
git add docs/kb/
git commit -m "docs(kb): seed topic-keyed knowledge base for conductor"
```

---

## Task 11: Spec template at docs/specs/_template.md

**Files:**
- Create: `docs/specs/_template.md`
- Create: `docs/specs/README.md`

- [ ] **Step 1: Write `docs/specs/_template.md`**

```markdown
---
adr: NNNN
slice: N
risk: low | medium | high
---

# Spec: <title>

- **ADR:** [NNNN](../adr/NNNN-<slug>.md)
- **Status:** Draft | Approved | Implemented
- **Date:** YYYY-MM-DD

## Goal

One sentence: what does this slice ship.

## Acceptance criteria

Numbered, testable statements. Each must be verifiable by `pnpm test`, `pnpm test:e2e`, or a named acceptance command.

1. ...
2. ...

## Task decomposition hints

Rough cuts; the planner refines into `plan.json`.

- ...

## Touched-files inventory

Best estimate of files created or modified. Workers may exceed if needed.

- Create: ...
- Modify: ...

## Risk flags

Linked ADRs and why each is risky in this slice.

- **0004 (money):** ... → premortem mandatory

## Out of scope

What this slice deliberately does not do.

- ...

## Open questions

Resolved during planning.

- ...
```

- [ ] **Step 2: Write `docs/specs/README.md`**

```markdown
# Implementation specs

Each spec is the **paired implementation companion** to one ADR. ADRs are decisions (one page); specs are how-tos (longer, more detail, iterates freely).

## Filename

`NNNN-<adr-slug>-implementation.md` — same number as the parent ADR.

## Workflow

1. Conductor's `spec-writer` agent produces a draft from the ADR + the route-map.
2. The `critic` agent reviews; spec-writer iterates if needed.
3. The `planner` agent decomposes into `plan.json`.
4. Workers + test-writer + validator run per task.
5. The spec's Status moves Draft → Approved → Implemented as the run advances.

## Template

See [_template.md](_template.md).
```

- [ ] **Step 3: Commit**

```bash
git add docs/specs/
git commit -m "docs(specs): paired-spec template + README"
```

---

## Task 12: Journal entry + final validation

**Files:**
- Create: `docs/journal/2026-05-05-05-conductor-harness.md`
- Modify: `docs/journal/README.md` (add index row)

- [ ] **Step 1: Write the journal entry**

Path: `docs/journal/2026-05-05-05-conductor-harness.md`

```markdown
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
```

- [ ] **Step 2: Update `docs/journal/README.md` index**

Append a new row to the Index table at the bottom of `docs/journal/README.md` (after the existing `04` row):

```markdown
| 2026-05-05 | [05 — Conductor harness scaffolding](2026-05-05-05-conductor-harness.md) | — | infra |
```

- [ ] **Step 3: Final full validation**

Run: `pnpm validate:conductor`
Expected: ALL tests pass with zero errors. Output should resemble:

```
 ✓ scripts/conductor/schemas.test.ts (7)
 ✓ scripts/conductor/validate-skill.test.ts (1)

 Test Files  2 passed (2)
      Tests  8 passed (8)
```

- [ ] **Step 4: Sanity-check skill loadability**

Run: `git status`
Expected: clean working tree (everything committed across Tasks 1–12).

- [ ] **Step 5: Commit**

```bash
git add docs/journal/
git commit -m "docs(journal): conductor harness shift entry"
```

---

## Self-Review

Spec coverage check:

- §2 Pragmatic Purist → SKILL.md "Pragmatic Purist rule" section ✓
- §3 Paired-spec model → spec template (Task 11), spec-writer template (Task 7) ✓
- §4 Agent roster (13 roles) → 13 templates (Tasks 5–8) ✓
- §4.2 High-risk ADR auto-flag → SKILL.md + planner template (Task 7) ✓
- §5 7-phase flow → SKILL.md phase table ✓
- §6 Loop semantics (validator/critic/scope-judge) → SKILL.md "Loop bounds" + each loop in templates ✓
- §7 On-disk state layout → SKILL.md, status.json schema (Task 2), .gitignore (Task 1) ✓
- §8 Token-efficiency rules (10 items) → SKILL.md "Token-efficiency rules" ✓
- §9 Three self-improvement loops → SKILL.md "Self-improvement loops" ✓
- §10 Escalation policy (4+1+1 triggers) → SKILL.md "Escalation policy" ✓
- §11 Invocation forms → slash command (Task 9) ✓
- §12 File layout → all created in Tasks 1–11 ✓
- §15 Open questions → noted in spec; acceptable to defer ✓
- §16 Done criteria → harness shipped; first real `/conductor` run is next-shift work, called out in journal "Next" section ✓

Placeholder scan: clean — no TBD, TODO, or vague directives.

Type consistency: `RoleSummarySchema` referenced in worker.md, test-writer.md, validator.md (via `ValidatorResultSchema`), and others — all consistent with `scripts/conductor/schemas.ts`. Phase enum in SKILL.md table matches `PHASES` constant in schemas.ts. `linked_adrs` field used consistently across planner, premortem, plan fixture.

Plan complete and saved to `docs/superpowers/plans/2026-05-05-conductor-harness.md`.
