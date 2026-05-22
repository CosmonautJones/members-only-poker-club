---
date: 2026-05-21
adrs: []
slice: livetest-2
type: tooling
status: shipped
---

# /run live test 2 — `digest-health.mjs` (closes validator WARN #4)

## Context

Second live test of `/run` after the doc-only first test at PR #40. This one is a code-changing slice — the shape the doc-only test couldn't validate. Target: build a mechanical health-metric tool for `/digest` that replaces the "eyeball the ratio" prose claim in `.claude/skills/digest/SKILL.md` §Health metric.

Why this target: it was the last open WARN from the validator's original sweep over the /run system (PR #39), it's small enough to fit in one cycle, has clear acceptance criteria, and exercises the full /run ritual on real code (vs PR #40 which was a 29-line doc edit).

Free-form mode invoked per the new step-3 amendment from PR #42 — explicit acceptance criteria authored upfront:

1. Script exists, executable, callable from repo root
2. Reads inbox + accepts `--dir` flag
3. Seven-category classification with text-position priority
4. JSON output shape per spec
5. Test file passes via vitest
6. /digest skill step amended to invoke the tool

All 6 met before commit.

## Changes

- **`scripts/run-tools/digest-health.mjs`** (187 lines) — Node ESM tool. Reads `learnings/inbox/*.md`, parses YAML frontmatter, classifies each `status: processed` entry by its `processed_into:` content, computes `(new-test + new-tool) / (total_processed - drop - surface)` ratio, outputs JSON. Exports `parseFrontmatter`, `classify`, `computeHealth` for testing.
- **`tests/skills/digest-health.test.ts`** (196 lines, 19 tests) — sandboxed per-test fixture directories under `tests/skills/.digest-health-sandbox/`. Covers all 7 categories, text-position priority, drop/surface overrides, empty inbox, unprocessed filter, healthy=true case, healthy=null when denominator 0.
- **`.claude/skills/digest/SKILL.md`** — §Health metric rewritten. The prose threshold "should be >50%" is preserved verbatim; the eyeballing is replaced with `node scripts/run-tools/digest-health.mjs` invocation + JSON shape documentation + denominator-excludes-drop-surface rationale.

## Tests

`pnpm test tests/skills/digest-health.test.ts` → **19/19 PASS** in 73ms (test runtime; total including transform/collect/env is ~5s).

Live smoke test on the actual inbox (3 processed entries from /digest 2026-05-21):

```json
{
  "total_processed": 3,
  "by_category": { "new-test": 1, "new-tool": 1, "surface": 1, ... },
  "binding_numerator": 2,
  "binding_denominator": 2,
  "binding_ratio": 1,
  "healthy": true
}
```

Mechanically confirms the "100% binding-ratio" eyeball claim from #42's `/digest` sentinel.

## Lessons

**One real bug caught mid-build, by smoke-testing against real data before writing tests.** The first version of `classify()` checked `.claude/skills/` before `scripts/` in a simple top-to-bottom priority order. On the live inbox, entry 1 (PR #42's ship.sh tightening) classified as `new-skill` instead of `new-tool` because its `processed_into:` mentions both `scripts/run-tools/ship.sh` AND `.claude/skills/run/SKILL.md` — and the first hit won.

Fixed by switching to **text-position priority**: whichever pattern appears EARLIEST in the `processed_into:` text wins, regardless of priority order in the patterns array. Rationale: /digest's `processed_into:` convention puts the PRIMARY artifact first; supporting amendments come after. This matches how I'd naturally describe a digest outcome ("we shipped the script + amended the skill doc as a follow-up").

The lesson is procedural: **smoke-test against real data BEFORE writing isolated unit tests**. The unit tests would have happily passed against the wrong-but-plausible classification rules. The live data showed the rule was wrong. This applies broadly — classifiers and routers are particularly prone to "the rule that seems right" failing on actual messy input.

## Live-test process observations

1. **New tightened `ship.sh commit <spec> <msg> <files...>` signature worked perfectly.** The `.tmp` pattern guard didn't even need to fire — being forced to pass an explicit file list made me think about file scope upfront, which is the entire point. The footgun from PR #40 is mechanically eliminated.
2. **`ship.sh push <branch> <title-file> <body-file>` worked first try.** The three-subcommand split (stage → commit → push with STOP between commit and push) gave clean checkpoints. User authorization gate between commit and push fired correctly.
3. **No real bugs in the /run system surfaced this cycle.** Live-test 1 (PR #40) found 2 bugs in /run + 1 in hooks. Live-test 2 found 1 classifier bug in the SLICE itself, not in /run. The /run system is stabilizing.
4. **Free-form acceptance criteria discipline (the new step-3 from PR #42) worked as intended.** Writing 6 explicit ACs upfront kept the scope tight and made it impossible to declare "done" prematurely.

## Cycle timing

Net cycle time: ~35 minutes for a 3-file, 380-line code-changing slice. Breakdown:
- Step 1 orient (free-form, skipped): 0
- Step 2 branch hygiene: 30 sec
- Step 3 plan (author 6 ACs): ~2 min
- Step 4 build (write script, smoke-test, fix classifier bug, write 19 tests, amend /digest SKILL.md): ~22 min
- Step 5 gauntlet --quick: ~30 sec
- Step 6 ship (format → stage → commit → push → PR): ~5 min
- Step 7 journal: ~5 min

Roughly 2× the doc-only PR #40 time, on 13× the line count and with real test infrastructure. Consistent with "doc-only is the easy case" — code-changing scaled sublinearly.

## Pointers

- PR #43 — this slice
- PR #42 — created the free-form acceptance-criteria amendment to /run step 3
- PR #39 — original /run system shipped
- `tests/skills/digest-health.test.ts` — test file
- `scripts/run-tools/digest-health.mjs` — tool

## Verdict on /run after two live tests

Doc-only slice (#40): 15 min for 29 lines. ~4-8× speedup over /conductor baseline.
Code-changing slice (#43): 35 min for 380 lines + 19 tests. Estimated /conductor would have taken 3-4× that on this shape.

`/run` is the right default. Use `/conductor` only for genuine multi-wave parallelism + high-risk simultaneously. The next test is a slice that DOES have that shape — but none are queued unblocked right now, so it can wait for organic real work.
