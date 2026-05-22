---
name: digest
description: Process the learnings inbox. Cluster `learnings/inbox/*.md` by topic, propose each cluster as ONE OF — new skill (with trigger frontmatter), new gauntlet test, new tool function, KB archive only, or false-positive drop. User approves each. Approved artifacts BIND BEHAVIOR (skills auto-load, tests fail mechanically, tools enforce contracts). Use when invoked via `/digest`.
---

# /digest — convert inbox to behavior-binding artifacts

You are converting raw learning signals into things that *change next run's behavior*. Prose suggestions don't bind. Skills, tests, and tools do.

**Invocation:** `/digest` — no arguments. Processes whatever's in `learnings/inbox/` with `status: unprocessed`.

## The contract

For every inbox entry, you produce ONE of these outcomes (and *only* one):

| Outcome | When | What it produces |
|---|---|---|
| **new-skill** | Pattern repeats across cycles OR concept needs to load in context when a specific situation arises | `.claude/skills/<name>/SKILL.md` with sharp frontmatter trigger |
| **new-test** | Failure can be mechanically caught by a deterministic check | New test file or new assertion in existing test |
| **new-tool** | Rule is a callable function (validation, transformation, lookup) | New shell/TS module under `scripts/run-tools/` or `lib/` |
| **kb-archive** | Useful context but not behavior-binding (history, anecdote, one-off) | Append to relevant `docs/kb/<topic>.md` |
| **drop** | False positive, duplicate of existing artifact, or no action warranted | Mark as processed with reason |

Each inbox entry's verdict is the ONE thing it produces. Don't dilute by making three artifacts per entry.

## The seven-step digest ritual

### 1. Survey

Run: `ls -la learnings/inbox/`. Count entries with `status: unprocessed` (read frontmatter). If zero, emit `GOAL-A: digest — inbox empty` and stop.

### 2. Cluster

Read every unprocessed entry. Group them by topic. A topic is a recognizable theme — e.g., "format-check failures", "branch-drift mid-run", "user said 'don't do X' about Y pattern". A cluster can be a single entry; don't force grouping.

For each cluster, write a one-line theme summary in your head (don't create a file yet).

### 3. Propose

For each cluster, decide the outcome via this decision tree:

```
Did this happen 2+ times across distinct cycles or files?
├─ YES → it's recurring → almost certainly needs binding
│   │
│   Is the rule a deterministic check (can be tested)?
│   ├─ YES → new-test (preferred — mechanical, no LLM judgment)
│   └─ NO → Is the rule a callable function (input → output)?
│       ├─ YES → new-tool
│       └─ NO → Does it need to load in context only when a trigger fires?
│           ├─ YES → new-skill with sharp trigger
│           └─ NO → kb-archive
│
└─ NO → single occurrence
    │
    Is it a clear bug or contradiction in current behavior?
    ├─ YES → fix the bug in code, no artifact; mark drop with reason "fixed at <commit>"
    └─ NO → kb-archive (one occurrence is anecdote, not pattern)
```

Sharp triggers in skill frontmatter MATTER. A skill with `description: "general Postgres tips"` loads on every database mention and pollutes context. A skill with `description: "Use when writing RLS policies with USING + WITH CHECK clauses — INSERT-deny throws 42501, UPDATE/DELETE-deny returns rowCount=0 silently"` loads only when relevant. **Aim for triggers that fire <5% of conversations.**

### 4. Surface to user

For each cluster, present:

- **Theme:** one-line summary
- **Source:** N inbox entries (paths)
- **Proposed outcome:** new-skill / new-test / new-tool / kb-archive / drop
- **Artifact preview:** the file path + first 10 lines if creating, OR a one-line "drop: <reason>" if dropping
- **User decision:** Approve / Edit / Defer / Drop

Use AskUserQuestion with multiSelect for batches of similar verdicts; otherwise per-cluster.

### 5. Apply approved outcomes

For each approved cluster:

- **new-skill:** write `.claude/skills/<name>/SKILL.md` with frontmatter (`name`, `description`) and body. Verify it appears in the available-skills list after writing.
- **new-test:** edit the relevant test file or create new one under `tests/` or `scripts/conductor/`. Run the test (it should fail until the rule is implemented elsewhere — that's expected if the rule is also new code).
- **new-tool:** write the script/module under `scripts/run-tools/<name>.sh` (or `lib/<topic>/<name>.ts` for application code). Make executable. Smoke test it.
- **kb-archive:** append a dated bullet to `docs/kb/<topic>.md` under the appropriate section.

### 6. Mark inbox entries processed

For each entry that contributed to an applied outcome OR was dropped: change its frontmatter `status: unprocessed` → `status: processed` and add `processed_at:` + `processed_into:` (the artifact path or "drop: <reason>").

DO NOT delete inbox entries. The historical record is part of the system's memory.

### 7. Summary + sentinel

Emit a one-screen summary: N entries processed, M artifacts created (broken down by kind), K dropped (with reasons).

End with `GOAL-A: digest — N entries processed, M artifacts created`.

## When NOT to use /digest

- **Mid-slice.** Run /digest between slices, not during. Don't let a digest run interrupt a /run cycle.
- **After every cycle.** That's too aggressive — single-occurrence signal is too noisy. Wait until inbox has 10+ entries OR you notice a recurring pattern explicitly.
- **For housekeeping.** /digest is for binding lessons, not for archiving stale entries. If inbox is full of false-positives (the user correction hook is matching too liberally), the fix is the hook's matcher, not draining the inbox.

## Output discipline

You write artifacts that BIND BEHAVIOR. You do NOT write SKILL.md amendments to the /run skill or to the digest skill itself. If you discover the /run skill needs to change, surface that as a separate proposal — don't sneak edits into a digest run.

You do NOT modify settings.json from inside /digest. Hook changes are explicit user actions via the `update-config` skill, not implicit during inbox processing.

## Health metric (mechanical as of digest 2026-05-21)

At the end of every digest run, invoke:

```bash
node scripts/run-tools/digest-health.mjs
```

This reads `learnings/inbox/*.md`, classifies each `status: processed` entry by its `processed_into:` content (using text-position priority when multiple categories match), and reports JSON:

```json
{
  "total_processed": 6,
  "by_category": {
    "new-test": 1, "new-tool": 1, "new-skill": 1,
    "kb-archive": 1, "drop": 1, "surface": 1, "unknown": 0
  },
  "binding_numerator": 2,
  "binding_denominator": 4,
  "binding_ratio": 0.5,
  "healthy": false,
  "threshold": 0.5
}
```

- **`binding_numerator`** = `new-test + new-tool` (the strongest-binding categories)
- **`binding_denominator`** = `total_processed - drop - surface` (drop/surface produce no artifact, so they don't count against the ratio)
- **`healthy`** = `binding_ratio > 0.5` (strict greater-than per /digest's "should be >50%" threshold)
- **`healthy: null`** = no applied artifacts at all (denominator 0) — no opinion

Surface the result to the user in the step-7 summary verbatim. If `healthy: false`, add the meta-observation: "Most applied outcomes were new-skill or kb-archive — consider whether more of these should be tests instead."

The pure-function exports (`parseFrontmatter`, `classify`, `computeHealth`) are tested in `tests/skills/digest-health.test.ts` (19 tests) — the classification rules are pinned mechanically so a future drift in `processed_into:` conventions fails CI before it pollutes the health metric.

## Sentinel contract

End every digest run with one of:
- `GOAL-A: digest — N entries processed, M artifacts created` — done
- `PING: <category> — <detail>` — blocked (e.g., user-decision stalled)
- `GOAL-C: digest — N entries reviewed, awaiting user decision on cluster <id>` — turn yield mid-review
