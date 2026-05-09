# Conductor v0.4 — Critic Proposal Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `mode: "proposal"` to the conductor's critic role with structured `falsifier_coverage` and `direction_risk_coverage` arrays, so v0.3's pre-ratification debate obligations are mechanically verified by schema instead of prompt-stretched onto `mode: spec`. The orchestrator gates `verdict: ship` on full coverage.

**Architecture:** Pure schema + template + SKILL.md addition. No orchestrator runtime code (the orchestrator is Claude reading SKILL.md). New `CriticProposalSchema` joins the existing `CriticResultSchema = z.union(...)` as a third variant alongside `CriticSpecOrDiffSchema` and `CriticDeltaSchema`. Phase 0 in SKILL.md inserts a critic-proposal dispatch between ratifier-output and user-approval, only when `triage_depth: full`. Schema's `superRefine` rejects `verdict: ship` when any coverage entry has `addressed: false`. The "every claim/risk has a coverage entry" invariant is enforced at the orchestrator dispatch boundary by comparing array lengths against the actual falsifier/premortem outputs already on disk.

**Tech Stack:** TypeScript, Zod schemas, Vitest, markdown templates. Same as v0.3.

**Source artifacts:**

- Issue #21 — original proposal (precise spec — `CriticProposalSchema` shape is given verbatim)
- v0.3 critic schema lives in `scripts/conductor/schemas.ts:198-232` (the `CriticResultSchema = z.union(...)` block)
- v0.3 critic template at `.claude/skills/conductor/templates/critic.md`
- v0.3 SKILL.md flow at `.claude/skills/conductor/SKILL.md` Phase 0 row
- Validate-skill checks in `scripts/conductor/validate-skill.ts` (loads each template and parses its embedded JSON examples against `SCHEMA_BY_ROLE`)

**Out of scope:**

- Live test on a fresh Stub ADR (Issue #21 calls for this; deferred to a separate post-merge session — same pattern as v0.3 was live-tested on ADR-0034)
- New escalation paths for `verdict: revise` from the proposal critic (same loop bound as today: max 3 ratifier iters; covered by existing escalation policy)
- Auto-merging the SKILL.md changes — retrospective ALWAYS proposes, user accepts

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `scripts/conductor/schemas.ts` | Modify | Add `CriticProposalSchema` (with `superRefine` rejecting `verdict: ship` on unaddressed coverage). Extend `CriticResultSchema = z.union([...])` to include it. |
| `scripts/conductor/schemas.test.ts` | Modify | Add 5 test cases for proposal mode (parse valid ship, parse valid revise, reject ship-with-unaddressed-falsifier, reject ship-with-unaddressed-risk, accept revise-with-unaddressed). |
| `scripts/conductor/fixtures/critic-proposal.valid.json` | Create | Canonical valid proposal-mode example for fixture-based tests. |
| `.claude/skills/conductor/templates/critic.md` | Modify | Document `mode: proposal` (4th mode). Inputs: ratifier proposal path, falsifier summary path, direction-premortem summary path. Add return JSON example matching `CriticProposalSchema`. |
| `.claude/skills/conductor/SKILL.md` | Modify | Phase 0 cell: insert "critic(mode=proposal)" between ratifier and user-approval, gated on `triage_depth: full`. Update roster legend. Add v0.4 changelog entry. |
| `docs/superpowers/specs/conductor-design.md` | Modify | Source-of-truth design spec — must keep SKILL.md and design spec in sync (per SKILL.md § "Source of truth"). Add a v0.4 section. |

`scripts/conductor/validate-skill.ts` itself does NOT need code changes — it iterates ALL JSON blocks in each template and passes if any one matches the role's schema. After we add a 4th JSON block to `critic.md`, the spec and diff blocks still parse against `CriticSpecOrDiffSchema`, the delta block against `CriticDeltaSchema`, and the new proposal block against the new `CriticProposalSchema`. Each block matches at least one variant of the union, so all blocks pass.

---

## Task 1: Define `CriticProposalSchema` in schemas.ts

**Files:**

- Modify: `scripts/conductor/schemas.ts` — insert new schema in the Critic section (around line 232, between `CriticDeltaSchema` and the union definition)
- Test: `scripts/conductor/schemas.test.ts` — add new `describe('CriticResultSchema (proposal mode, v0.4)')` block

- [ ] **Step 1: Write the failing tests for `CriticProposalSchema` (via the union)**

Add this `describe` block at the end of the existing `describe('CriticResultSchema', ...)` block in `scripts/conductor/schemas.test.ts` (after the existing delta-mode tests, before the closing `});` of CriticResultSchema):

```typescript
  // v0.4 — proposal mode for ratification-proposal review.
  it('parses proposal mode with verdict=ship and all coverage addressed', () => {
    expect(() =>
      CriticResultSchema.parse({
        mode: 'proposal',
        verdict: 'ship',
        falsifier_coverage: [
          { claim_index: 0, addressed: true, where: 'Consequences › Negative' },
          { claim_index: 1, addressed: true, where: 'Alternatives considered' },
        ],
        direction_risk_coverage: [
          { risk_index: 0, addressed: true, where: 'Consequences › Negative' },
        ],
        concerns: [],
        summary_path: '.conductor/0035/dispatches/0005-critic-proposal.md',
      }),
    ).not.toThrow();
  });
  it('parses proposal mode with verdict=revise and unaddressed coverage entries', () => {
    expect(() =>
      CriticResultSchema.parse({
        mode: 'proposal',
        verdict: 'revise',
        falsifier_coverage: [
          { claim_index: 0, addressed: true, where: 'Consequences › Negative' },
          { claim_index: 1, addressed: false },
        ],
        direction_risk_coverage: [{ risk_index: 0, addressed: false }],
        concerns: ['falsifier-2 silently dropped from Consequences'],
        summary_path: '.conductor/0035/dispatches/0005-critic-proposal.md',
      }),
    ).not.toThrow();
  });
  it('rejects verdict=ship when a falsifier_coverage entry is unaddressed', () => {
    expect(() =>
      CriticResultSchema.parse({
        mode: 'proposal',
        verdict: 'ship',
        falsifier_coverage: [
          { claim_index: 0, addressed: true, where: 'Consequences › Negative' },
          { claim_index: 1, addressed: false },
        ],
        direction_risk_coverage: [
          { risk_index: 0, addressed: true, where: 'Consequences › Negative' },
        ],
        concerns: [],
        summary_path: '.conductor/0035/dispatches/0005-critic-proposal.md',
      }),
    ).toThrow();
  });
  it('rejects verdict=ship when a direction_risk_coverage entry is unaddressed', () => {
    expect(() =>
      CriticResultSchema.parse({
        mode: 'proposal',
        verdict: 'ship',
        falsifier_coverage: [
          { claim_index: 0, addressed: true, where: 'Consequences › Negative' },
        ],
        direction_risk_coverage: [{ risk_index: 0, addressed: false }],
        concerns: [],
        summary_path: '.conductor/0035/dispatches/0005-critic-proposal.md',
      }),
    ).toThrow();
  });
  it('parses proposal mode with empty coverage arrays (no falsifiers / risks)', () => {
    // Edge case: triage_depth=light should never reach proposal-mode critic,
    // but the schema must not reject empty coverage arrays — that path is
    // guarded by orchestrator policy, not schema.
    expect(() =>
      CriticResultSchema.parse({
        mode: 'proposal',
        verdict: 'ship',
        falsifier_coverage: [],
        direction_risk_coverage: [],
        concerns: [],
        summary_path: '.conductor/0035/dispatches/0005-critic-proposal.md',
      }),
    ).not.toThrow();
  });
  it('defaults concerns to [] when omitted in proposal mode', () => {
    const parsed = CriticResultSchema.parse({
      mode: 'proposal',
      verdict: 'ship',
      falsifier_coverage: [{ claim_index: 0, addressed: true, where: 'Consequences' }],
      direction_risk_coverage: [{ risk_index: 0, addressed: true, where: 'Consequences' }],
      summary_path: '.conductor/0035/dispatches/0005-critic-proposal.md',
    });
    if ('mode' in parsed && parsed.mode === 'proposal') {
      expect(parsed.concerns).toEqual([]);
    } else {
      throw new Error('expected proposal mode parse');
    }
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `pnpm test scripts/conductor/schemas.test.ts -t "proposal mode" 2>&1 | tail -30`

Expected: 6 failures — `CriticResultSchema.parse({mode: 'proposal', ...})` throws because no variant in the union accepts `mode: 'proposal'`. All 6 should fail at parse time, not at the `.toThrow()` assertion.

- [ ] **Step 3: Add `CriticProposalSchema` to `scripts/conductor/schemas.ts`**

Insert this block in `scripts/conductor/schemas.ts` immediately AFTER the closing `})` of `CriticDeltaSchema` (around line 232) and BEFORE the existing `export const CriticResultSchema = z.union(...)` line:

```typescript
const CoverageEntrySchema = z.object({
  // For falsifier coverage, this is the index into the falsifier dispatch's
  // `claims` array. For direction-risk coverage, it is the index into the
  // direction-mode premortem's `risks` array. Orchestrator validates the
  // length of each coverage array against the upstream dispatch length —
  // this is checked at the orchestrator boundary, not by the schema, since
  // the schema does not see the upstream artifacts.
  claim_index: z.number().int().nonnegative().optional(),
  risk_index: z.number().int().nonnegative().optional(),
  addressed: z.boolean(),
  // Section heading or paragraph anchor where the claim/risk is engaged.
  // Optional because verdict=revise legitimately may have addressed=false
  // entries with no `where`.
  where: z.string().optional(),
});

const CriticFalsifierCoverageSchema = CoverageEntrySchema.extend({
  claim_index: z.number().int().nonnegative(),
}).omit({ risk_index: true });

const CriticRiskCoverageSchema = CoverageEntrySchema.extend({
  risk_index: z.number().int().nonnegative(),
}).omit({ claim_index: true });

const CriticProposalSchema = z
  .object({
    mode: z.literal('proposal'),
    verdict: z.enum(['ship', 'revise']),
    // One entry per falsifier claim returned by the falsifier dispatch.
    // Length-equality with the upstream falsifier output is enforced at the
    // orchestrator boundary — schema only checks per-entry consistency.
    falsifier_coverage: z.array(CriticFalsifierCoverageSchema),
    // One entry per risk returned by direction-mode premortem.
    direction_risk_coverage: z.array(CriticRiskCoverageSchema),
    // Free-form concerns same as spec/diff modes — used for issues that fall
    // outside the structured coverage check (e.g., the proposal contradicts
    // a cross-referenced ADR, or "deferred decisions disguised as decisions").
    concerns: z.array(z.string()).default([]),
    summary_path: z.string(),
  })
  .superRefine((r, ctx) => {
    if (r.verdict === 'ship') {
      const unaddressedFalsifiers = r.falsifier_coverage
        .filter((c) => !c.addressed)
        .map((c) => c.claim_index);
      const unaddressedRisks = r.direction_risk_coverage
        .filter((c) => !c.addressed)
        .map((c) => c.risk_index);
      if (unaddressedFalsifiers.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `verdict=ship is incompatible with unaddressed falsifier_coverage entries [${unaddressedFalsifiers.join(', ')}]: every claim must be engaged in the proposal before ratification`,
        });
      }
      if (unaddressedRisks.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `verdict=ship is incompatible with unaddressed direction_risk_coverage entries [${unaddressedRisks.join(', ')}]: every direction-level risk must be addressed in the proposal before ratification`,
        });
      }
    }
  });
```

Then change the existing union line:

Old:
```typescript
export const CriticResultSchema = z.union([CriticSpecOrDiffSchema, CriticDeltaSchema]);
```

New:
```typescript
export const CriticResultSchema = z.union([
  CriticSpecOrDiffSchema,
  CriticDeltaSchema,
  CriticProposalSchema,
]);
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `pnpm test scripts/conductor/schemas.test.ts -t "proposal mode" 2>&1 | tail -15`

Expected: All 6 proposal-mode tests pass. Also re-run the full file to confirm no regression on existing critic tests:

Run: `pnpm test scripts/conductor/schemas.test.ts 2>&1 | tail -10`

Expected: All tests in the file pass (existing CriticResultSchema spec/diff/delta tests still pass).

- [ ] **Step 5: Commit**

```bash
git add scripts/conductor/schemas.ts scripts/conductor/schemas.test.ts
git commit -m "feat(conductor): v0.4 — CriticProposalSchema with coverage gating

Adds mode: 'proposal' as the third variant of CriticResultSchema. Schema
rejects verdict: ship when any falsifier_coverage or direction_risk_coverage
entry has addressed: false — mechanically enforces v0.3 obligations that
were prompt-stretched onto mode: spec.

Refs #21"
```

---

## Task 2: Add proposal-mode fixture

**Files:**

- Create: `scripts/conductor/fixtures/critic-proposal.valid.json`
- Test: `scripts/conductor/schemas.test.ts` — add fixture-loading test

- [ ] **Step 1: Write the failing fixture test**

Add this test inside the existing `describe('CriticResultSchema', ...)` block (after the proposal-mode tests added in Task 1):

```typescript
  it('parses the canonical proposal-mode fixture', () => {
    expect(() => CriticResultSchema.parse(fx('critic-proposal.valid.json'))).not.toThrow();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test scripts/conductor/schemas.test.ts -t "canonical proposal-mode fixture" 2>&1 | tail -10`

Expected: FAIL with `ENOENT: no such file or directory ... critic-proposal.valid.json`.

- [ ] **Step 3: Create the fixture**

Create `scripts/conductor/fixtures/critic-proposal.valid.json`:

```json
{
  "mode": "proposal",
  "verdict": "ship",
  "falsifier_coverage": [
    {
      "claim_index": 0,
      "addressed": true,
      "where": "Consequences › Negative — Stripe SCA cross-border risk"
    },
    {
      "claim_index": 1,
      "addressed": true,
      "where": "Alternatives considered — sub-cent precision"
    }
  ],
  "direction_risk_coverage": [
    {
      "risk_index": 0,
      "addressed": true,
      "where": "Consequences › Negative — vendor lock-in"
    }
  ],
  "concerns": [],
  "summary_path": ".conductor/0035/dispatches/0005-critic-proposal.md"
}
```

- [ ] **Step 4: Run to verify the fixture test passes**

Run: `pnpm test scripts/conductor/schemas.test.ts -t "canonical proposal-mode fixture" 2>&1 | tail -8`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/conductor/fixtures/critic-proposal.valid.json scripts/conductor/schemas.test.ts
git commit -m "test(conductor): add canonical critic-proposal.valid.json fixture

Refs #21"
```

---

## Task 3: Update critic.md template with proposal mode

**Files:**

- Modify: `.claude/skills/conductor/templates/critic.md`
- Test: `scripts/conductor/validate-skill.test.ts` (existing — should still pass without changes)

- [ ] **Step 1: Update critic.md to document the 4th mode**

Replace the entire current contents of `.claude/skills/conductor/templates/critic.md` with:

````markdown
# Role: critic

You read with intent. You catch semantic drift the validator can't.

In v0.4, critic runs in four modes:

- **`mode: "spec"` (Phase 1)** — review the spec itself before planning.
- **`mode: "diff"` (Phase 3)** — review the slice diff against the spec.
- **`mode: "delta"` (resume staleness check)** — review the delta between the ADR/spec text observed at Phase 0 close and the text on disk now. Decide whether the orchestrator can patch forward, must re-bootstrap, or must abort.
- **`mode: "proposal"` (Phase 0, after ratifier, when `triage_depth: full`)** — review the ratification proposal against the v0.3 obligations: every falsifier claim must be engaged in Consequences or converted to an Alternatives entry; every direction-mode premortem risk must be addressed in Consequences. Output is structured `falsifier_coverage[]` and `direction_risk_coverage[]` arrays so the orchestrator can mechanically verify coverage rather than re-reading the proposal.

## Inputs

- **Mode:** {{mode}} — `spec`, `diff`, `delta`, or `proposal`
- **(spec/diff) Spec:** `{{spec_path}}`
- **(diff only) Diff:** `{{diff_path}}` (output of `git diff` for the slice)
- **(diff only) Validator report:** `{{validator_summary_path}}`
- **(delta only) Old canonical text:** `{{old_canonical_path}}` — the canonical text snapshotted at Phase 0 close (the orchestrator rehydrates this from `.conductor/<N>/snapshots/`)
- **(delta only) New canonical text:** `{{new_canonical_path}}` — the canonical text of the live file on disk now
- **(delta only) Plan:** `{{plan_path}}` — task list with current statuses; needed to classify changes against task boundaries
- **(proposal only) Ratification proposal:** `{{proposal_path}}` — the full proposed ADR text written by ratifier (read every section)
- **(proposal only) Falsifier summary:** `{{falsifier_summary_path}}` — the upstream falsifier output. Read it to enumerate every claim by index.
- **(proposal only) Direction-mode premortem summary:** `{{direction_premortem_summary_path}}` — the upstream direction-mode premortem output. Read it to enumerate every risk by index.

## What to do

**spec mode:** ask "is this spec implementable as written? Are acceptance criteria testable? Is anything ambiguous, contradictory, or under-specified?"

**diff mode:** ask "did this code actually solve what the spec asked for, beyond compiling and passing tests? Are there shortcuts, missed edge cases, or work that addresses the letter but not the intent?"

**delta mode:** classify every difference between old and new into one of three buckets:

- **additions** — net-new content (a new acceptance criterion, a new task, a new constraint). Target the affected task id, or `<frontmatter>` / `<context>` for ADR-level changes.
- **modifications** — existing content changed (a constraint tightened, a Direction sentence rewritten, a task's contract altered). Target the affected task id (or section).
- **removals** — content deleted.

Then assign overall `severity`:

- **`minor`** — only additions, none touch task contracts already in flight
- **`major`** — modifications or removals that touch unstarted or in-flight tasks; or additions that change ordering of completed work
- **`breaking`** — modifications or removals that touch a *completed* task's contract, or any change to the Direction itself

Then choose `recommendation`:

- **`patch_forward`** — ONLY legal when modifications and removals are both empty AND severity is `minor` AND every addition targets an unstarted task. The orchestrator will inject the new tasks into plan.json and resume the build.
- **`rebootstrap`** — required when severity is `major` or `breaking`, OR when any modification or removal exists. The schema rejects `patch_forward` in these cases. Use the word "amendment" in your prose: the user may want a new ADR rather than re-running this one.
- **`abort`** — when the delta is so large the entire run no longer makes sense (e.g., the ADR was rewritten end-to-end).

Write a verdict to `{{summary_path}}` with reasoning. For delta mode, include the bucketed change list and the verdict rule that fired.

**proposal mode:** the v0.3 ratifier MUST address every falsifier and every direction-risk by name in Consequences (or convert a falsifier into an Alternatives entry). Your job is to verify, mechanically, that this happened.

For each falsifier claim in the upstream falsifier summary (in order):

- Read the proposal end to end. Is this claim engaged anywhere — refuted, accepted as residual risk with mitigation, or moved to Alternatives?
- Record `{claim_index: i, addressed: true|false, where: "<section › subsection>"}`. Use the section heading where the engagement appears (e.g. `"Consequences › Negative"`, `"Alternatives considered"`). When `addressed: false`, omit `where`.

For each risk in the upstream direction-mode premortem summary (in order):

- Same check: is the risk addressed in Negative Consequences (or elsewhere)?
- Record `{risk_index: i, addressed: true|false, where: "..."}`.

Surface non-coverage concerns in the free-form `concerns[]` array — examples:

- "Decision section says 'we will adopt X' but Consequences acknowledges X has no concrete migration path → deferred decision disguised as a decision"
- "Proposal contradicts ADR-0004 (money-handling) at line N"
- "open_questions_count says 0 but the Decision section contains a `> Open question:` blockquote"

Set `verdict: ship` ONLY if every coverage entry has `addressed: true` AND no fatal concerns block ratification. Set `verdict: revise` otherwise. The schema (`CriticProposalSchema.superRefine`) rejects `verdict: ship` when any coverage entry is `addressed: false` — you cannot smuggle through unaddressed claims by asserting `ship`.

If the proposal genuinely needs revision but the obligations are met (e.g. a typo, a section reorder request), use `verdict: revise` with all coverage entries `addressed: true` and the issue in `concerns[]`. The orchestrator loops back to ratifier; the loop bound is the existing 3-iter ratifier max.

## Constraints

- Read the ratification proposal in full before scoring coverage. Do not score from headings alone.
- `claim_index` and `risk_index` are integers ≥ 0 referring to the position in the upstream artifact's array.
- Length-equality with upstream is enforced at the orchestrator boundary, not in the prose. If the falsifier returned 4 claims, your `falsifier_coverage` MUST have exactly 4 entries (one per index 0..3). The orchestrator will reject a result whose array length does not match the upstream dispatch.
- Empty `falsifier_coverage` and `direction_risk_coverage` are valid only for the edge case where the upstream artifacts had zero entries — proposal mode should not be dispatched at all when `triage_depth: light`, so this edge is informational only.

## Return (spec or diff mode)

```json
{
  "verdict": "revise",
  "mode": "diff",
  "concerns": ["concern 1", "concern 2"],
  "summary_path": "{{summary_path}}"
}
```

`verdict` is one of `"ship" | "revise"`; `mode` is one of `"spec" | "diff"`. If `verdict: "ship"`, `concerns` may be empty.

## Return (delta mode)

```json
{
  "mode": "delta",
  "severity": "major",
  "additions": [
    { "target": "t7", "description": "new task: enforce idempotency on POST /deposit" }
  ],
  "modifications": [
    {
      "target": "t4",
      "description": "acceptance criterion 3 tightened: now requires SELECT FOR UPDATE, not SELECT"
    }
  ],
  "removals": [],
  "recommendation": "rebootstrap",
  "summary_path": "{{summary_path}}"
}
```

`mode` is the literal `"delta"`. `severity` is one of `"minor" | "major" | "breaking"`. `recommendation` is one of `"patch_forward" | "rebootstrap" | "abort"`. The schema (`CriticDeltaSchema.superRefine`) rejects `patch_forward` when modifications or removals are non-empty, or when severity is `breaking`.

## Return (proposal mode, v0.4)

```json
{
  "mode": "proposal",
  "verdict": "ship",
  "falsifier_coverage": [
    { "claim_index": 0, "addressed": true, "where": "Consequences › Negative" },
    { "claim_index": 1, "addressed": true, "where": "Alternatives considered" }
  ],
  "direction_risk_coverage": [
    { "risk_index": 0, "addressed": true, "where": "Consequences › Negative" }
  ],
  "concerns": [],
  "summary_path": "{{summary_path}}"
}
```

`mode` is the literal `"proposal"`. `verdict` is `"ship" | "revise"`. The schema (`CriticProposalSchema.superRefine`) rejects `verdict: "ship"` when any `falsifier_coverage[i].addressed === false` or any `direction_risk_coverage[i].addressed === false`.

Return ONLY the JSON.
````

- [ ] **Step 2: Run validate-skill to confirm the new template parses**

Run: `pnpm test scripts/conductor/validate-skill.test.ts 2>&1 | tail -15`

Expected: PASS. The validator already loads each template and tries every embedded JSON block against `SCHEMA_BY_ROLE.critic`; the proposal-mode block parses against the new union variant.

- [ ] **Step 3: Run full conductor test suite to confirm nothing else broke**

Run: `pnpm test scripts/conductor/ 2>&1 | tail -10`

Expected: all conductor tests pass.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/conductor/templates/critic.md
git commit -m "feat(conductor): v0.4 — critic.md documents proposal mode

Phase 0, when triage_depth=full, after ratifier and before user approval.
Critic mechanically verifies falsifier and direction-risk coverage with
structured arrays; schema rejects verdict=ship on any addressed=false.

Refs #21"
```

---

## Task 4: Update SKILL.md Phase 0 flow + roster + changelog

**Files:**

- Modify: `.claude/skills/conductor/SKILL.md`

- [ ] **Step 1: Update Phase 0 row in the phase-flow table**

In `.claude/skills/conductor/SKILL.md`, replace the `0 Bootstrap` row's Action cell. Find the existing text (around line 27, the cell ending in "freeze `acceptance_commands_required` from spec frontmatter."). Replace its full content with the version below — the change is the **single inserted clause** between "passing falsifier + direction-premortem outputs when full" and "→ user approves the proposal":

> `→ when triage_depth=full, dispatch critic(mode=proposal) against the proposal at .conductor/<N>/ratification-proposal.md with the falsifier and direction-premortem summary paths attached; if verdict=revise, loop back to ratifier (existing 3-iter ratifier max applies; once exceeded, escalate as a stuck condition) → user approves the proposal`

The full updated cell text becomes (this is the verbatim replacement; insert into the markdown table):

```
Read ADR; init `.conductor/<N>/`. If `Status: Stub` (or `Proposed`): dispatch `triage` → record `triage_depth` in status.json. If `triage_depth=full`, dispatch `falsifier` ║ `premortem`(mode=direction) **in parallel** before ratification. Then dispatch `ratifier` (passing falsifier + direction-premortem outputs when full) → when `triage_depth=full`, dispatch `critic`(mode=proposal) against the proposal with the falsifier and direction-premortem summary paths attached; if `verdict=revise`, loop back to ratifier (existing 3-iter ratifier max applies; once exceeded, escalate as a stuck condition) → user approves the proposal at `.conductor/<N>/ratification-proposal.md` → orchestrator computes canonical signature, replaces the `PENDING` sentinel in the proposal with `<sha256[:12]>`, writes the approved text back to `docs/adr/NNNN-*.md`, and stores the full sha256 in `status.input_hashes[adr_path]`. Then ensure paired spec exists (dispatch `spec-writer` if not), hash the spec into `status.input_hashes[spec_path]`, snapshot canonical texts to `.conductor/<N>/snapshots/` for later delta comparison, and freeze `acceptance_commands_required` from spec frontmatter.
```

Use Edit with `old_string` = the original Phase-0 cell text and `new_string` = the updated version above. Match the entire single-line cell exactly (the table row is one long line in the source).

- [ ] **Step 2: Update the "Pre-ratification debate" section**

Find the section beginning with `## Pre-ratification debate (v0.3, Phase 0)` and ending before `## Content-signature staleness detection (v0.3)`. Replace the section body to add a `When triage_depth=full:` step 4 about the proposal-mode critic. Use Edit:

`old_string` (the existing section after the heading):

```
A `triage` dispatch sits between ADR-read and ratification. Triage classifies the ADR as `light` (ratifier alone — v0.2 behavior) or `full` (debate fan-out before ratification) using a deterministic signal rule documented in `templates/triage.md`. The verdict and signals land in `events.jsonl` and `status.triage_depth`.

When `triage_depth=full`:
1. Dispatch `falsifier` and `premortem`(mode=direction) **in parallel** (both read the Stub, neither depends on the other).
2. Wait for both to return.
3. Dispatch `ratifier` with `falsifier_summary_path` and `direction_premortem_summary_path` populated. Ratifier MUST address each falsifier claim and each direction-level risk by name in Consequences — its template enforces this.

When `triage_depth=light`: skip falsifier and direction-premortem. Dispatch `ratifier` directly.

The contract gets stress-tested *before* it's signed. Phase 1's `premortem`(mode=task) is unchanged — it still runs against tasks after planning.
```

`new_string`:

```
A `triage` dispatch sits between ADR-read and ratification. Triage classifies the ADR as `light` (ratifier alone — v0.2 behavior) or `full` (debate fan-out before ratification) using a deterministic signal rule documented in `templates/triage.md`. The verdict and signals land in `events.jsonl` and `status.triage_depth`.

When `triage_depth=full`:
1. Dispatch `falsifier` and `premortem`(mode=direction) **in parallel** (both read the Stub, neither depends on the other).
2. Wait for both to return.
3. Dispatch `ratifier` with `falsifier_summary_path` and `direction_premortem_summary_path` populated. Ratifier MUST address each falsifier claim and each direction-level risk by name in Consequences — its template enforces this.
4. **(v0.4)** Dispatch `critic`(mode=proposal) with the proposal path, falsifier summary path, and direction-premortem summary path. The critic returns structured `falsifier_coverage[]` (one entry per claim) and `direction_risk_coverage[]` (one entry per risk). The orchestrator MUST verify array lengths equal upstream lengths — a result whose `falsifier_coverage.length !== falsifier.claims.length` is rejected as malformed and the critic is re-dispatched. If `verdict=revise`, loop back to ratifier with the critic's `concerns[]` and any unaddressed coverage indices. Existing 3-iter ratifier max applies; on overrun, escalate as stuck.

When `triage_depth=light`: skip falsifier, direction-premortem, AND proposal-mode critic. Dispatch `ratifier` directly. The proposal-mode critic does not run because there are no falsifier/risk obligations to verify.

The contract gets stress-tested *before* it's signed, AND the contract's adherence to the stress test is mechanically verified before the user is asked to sign. Phase 1's `premortem`(mode=task) is unchanged — it still runs against tasks after planning.
```

- [ ] **Step 3: Update the Roster legend**

Find the line beginning `bootstrap: ` (around line 101). Replace:

`old_string`:

```
bootstrap: `triage`, `falsifier` (full debate only), `premortem` (mode=direction, full debate only), `ratifier`, `spec-writer`
plan: `critic` (mode=spec), `planner` (mode=initial), `premortem` (mode=task)
build: `worker`, `test-writer`, `validator`, `planner` (mode=split)
integration: `validator`, `critic` (mode=diff), `scope-judge`
ship: `journalist`, `shipper`
retrospective: `retrospective`
resume-staleness (cross-cutting): `critic` (mode=delta)

Multi-mode roles: `planner` (`initial`, `split`); `critic` (`spec`, `diff`, `delta`); `premortem` (`task`, `direction`); `journalist` writes journal + KB deltas in one pass. Roles added in v0.3: `triage`, `falsifier`. v0.1's `task-splitter` and `knowledge-curator` were merged in v0.2.
```

`new_string`:

```
bootstrap: `triage`, `falsifier` (full debate only), `premortem` (mode=direction, full debate only), `ratifier`, `critic` (mode=proposal, full debate only — v0.4), `spec-writer`
plan: `critic` (mode=spec), `planner` (mode=initial), `premortem` (mode=task)
build: `worker`, `test-writer`, `validator`, `planner` (mode=split)
integration: `validator`, `critic` (mode=diff), `scope-judge`
ship: `journalist`, `shipper`
retrospective: `retrospective`
resume-staleness (cross-cutting): `critic` (mode=delta)

Multi-mode roles: `planner` (`initial`, `split`); `critic` (`spec`, `diff`, `delta`, `proposal`); `premortem` (`task`, `direction`); `journalist` writes journal + KB deltas in one pass. Roles added in v0.3: `triage`, `falsifier`. v0.1's `task-splitter` and `knowledge-curator` were merged in v0.2. Roster size unchanged at 14 — v0.4 adds a critic mode, not a new role.
```

- [ ] **Step 4: Update the Roster heading**

Find `## Roster (14 roles)` and leave it as-is — count unchanged. Confirm via re-read.

- [ ] **Step 5: Add v0.4 changelog entry**

Find the `## Changelog` section. Insert a new top-level entry above the `- **v0.3 (this version)**` entry. Use Edit:

`old_string`:

```
## Changelog

- **v0.3 (this version)**
```

`new_string`:

```
## Changelog

- **v0.4 (this version)**
  - Critic gains `mode: "proposal"` for ratification review (Phase 0, only when `triage_depth: full`). Runs after ratifier produces a proposal, before user approval. Returns structured `falsifier_coverage[]` and `direction_risk_coverage[]` arrays so v0.3 obligations are mechanically verified, not prompt-stretched onto `mode: spec`.
  - `CriticProposalSchema.superRefine` rejects `verdict: ship` when any coverage entry has `addressed: false`. Orchestrator additionally enforces array-length equality with upstream falsifier and direction-mode premortem outputs.
  - Roster size unchanged (14). Roles added: zero. Modes added: one. SKILL.md flow change is the Phase-0 "Pre-ratification debate" section (a new step 4).
  - When `triage_depth: light`, proposal-mode critic does not run (nothing to verify).

- **v0.3**
```

- [ ] **Step 6: Run validate-skill.test to confirm SKILL.md still parses**

Run: `pnpm test scripts/conductor/validate-skill.test.ts 2>&1 | tail -10`

Expected: PASS. SKILL.md changes don't affect template structure or schema parsing.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/conductor/SKILL.md
git commit -m "feat(conductor): v0.4 — SKILL.md wires proposal-mode critic into Phase 0

Pre-ratification debate gains step 4: critic(mode=proposal) verifies that
ratifier engaged every falsifier claim and every direction-level risk
before the user is asked to approve. Roster size unchanged (14); critic
gains a 4th mode.

Refs #21"
```

---

## Task 5: Update the conductor design spec (source of truth)

**Files:**

- Modify: `docs/superpowers/specs/conductor-design.md`

- [ ] **Step 1: Read current state of the design spec**

Read `docs/superpowers/specs/conductor-design.md` to understand its structure. The SKILL.md `## Source of truth` section says: "Design spec: `docs/superpowers/specs/conductor-design.md`. If this skill drifts from the spec, update both deliberately — never silently."

- [ ] **Step 2: Add v0.4 section to the design spec**

Append a new top-level section to `docs/superpowers/specs/conductor-design.md`. The exact location: append at the end of the file. The content:

```markdown

## v0.4 changes

### Critic `mode: "proposal"`

Adds a fourth mode to the critic role for ratification-proposal review. Only fires when `triage_depth: full` — light proposals have no falsifier or direction-premortem outputs to verify.

**Position in the flow:** Phase 0, after ratifier produces a proposal at `.conductor/<N>/ratification-proposal.md`, before the orchestrator escalates for user approval.

**Inputs:** the proposal path, the falsifier summary path, and the direction-mode premortem summary path. The critic reads the proposal in full and emits one coverage entry per upstream claim/risk.

**Returned schema (`CriticProposalSchema`):**

```typescript
{
  mode: 'proposal',
  verdict: 'ship' | 'revise',
  falsifier_coverage: Array<{
    claim_index: number,
    addressed: boolean,
    where?: string,  // section heading or anchor
  }>,
  direction_risk_coverage: Array<{
    risk_index: number,
    addressed: boolean,
    where?: string,
  }>,
  concerns: string[],  // free-form fallthrough for non-coverage issues
  summary_path: string,
}
```

**Schema enforcement (superRefine):**

- `verdict: ship` is rejected if ANY entry in `falsifier_coverage` has `addressed: false`.
- `verdict: ship` is rejected if ANY entry in `direction_risk_coverage` has `addressed: false`.

**Orchestrator-boundary enforcement (not schema):**

- `falsifier_coverage.length` MUST equal the upstream falsifier dispatch's `claims.length`.
- `direction_risk_coverage.length` MUST equal the upstream direction-mode premortem dispatch's `risks.length`.
- Mismatch → reject the result as malformed and re-dispatch the critic. Do NOT fall back to scoring coverage from the orchestrator.

**Loop:** if `verdict: revise`, loop back to ratifier with the critic's `concerns[]` and the indices of unaddressed coverage entries. Existing 3-iter ratifier max applies; on overrun, escalate as stuck.

### Why a new mode and not a stretched `mode: spec`

`mode: spec` was designed for Phase-1 implementation specs. A ratification proposal is a different artifact: it is the *contract being signed*. v0.3 obligations (every falsifier claim engaged, every direction risk addressed) are content-shaped, not spec-shaped. The live test of v0.3 (PR #20, ADR-0034 fixture) demonstrated that `mode: spec` produced useful concerns, but only because the prompt told the critic to apply v0.3 lenses; the schema couldn't enforce structured output beyond `concerns: string[]`. v0.4 makes coverage a first-class field so dropping a falsifier is mechanically detectable.

### Roster impact

Unchanged at 14 roles. Critic gains a 4th mode (`spec`, `diff`, `delta`, `proposal`). `SCHEMA_BY_ROLE.critic` continues to point at `CriticResultSchema = z.union([CriticSpecOrDiffSchema, CriticDeltaSchema, CriticProposalSchema])`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/conductor-design.md
git commit -m "docs(conductor): mirror v0.4 critic-proposal mode into design spec

Source of truth required to stay in lock-step with SKILL.md per the
'Source of truth' invariant.

Refs #21"
```

---

## Task 6: Run the full gauntlet

**Files:** None modified. Verification only.

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck 2>&1 | tail -5`

Expected: 0 errors. The new schemas use existing zod patterns.

- [ ] **Step 2: Run lint**

Run: `pnpm lint 2>&1 | tail -5`

Expected: PASS.

- [ ] **Step 3: Run format check**

Run: `pnpm format:check 2>&1 | tail -5`

Expected: All files use Prettier code style. If failures appear, run `pnpm exec prettier --write <files>` and re-stage with a new commit (do NOT amend, per repo policy).

- [ ] **Step 4: Run full test suite**

Run: `pnpm test 2>&1 | tail -15`

Expected: 353+6 = 359 passed (or thereabouts). 1 skipped (existing). 0 failures. The 6 new tests are in CriticResultSchema describe block.

- [ ] **Step 5: Confirm validate-skill passes**

Run: `pnpm test scripts/conductor/validate-skill.test.ts 2>&1 | tail -5`

Expected: PASS — every template parses and every embedded JSON block matches at least one variant of its role's schema. The 4th JSON block in critic.md (proposal mode) parses against `CriticProposalSchema`.

---

## Task 7: Open PR

**Files:** None modified. Branch + PR creation.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feature/conductor-v0.4-critic-proposal
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(conductor): v0.4 — critic mode=proposal with structured coverage" --body "$(cat <<'EOF'
## Summary

Closes #21. Adds `mode: "proposal"` to the conductor's critic role with structured `falsifier_coverage[]` and `direction_risk_coverage[]` arrays. Phase 0, after ratifier, before user approval, only when `triage_depth: full`.

`CriticProposalSchema.superRefine` rejects `verdict: ship` when any coverage entry has `addressed: false`, so v0.3 obligations (every falsifier claim engaged, every direction risk addressed) are mechanically verified instead of prompt-stretched onto `mode: spec`. Orchestrator enforces array-length equality with upstream falsifier/direction-premortem outputs.

Roster size unchanged at 14. SKILL.md gains a step in the pre-ratification debate flow; `docs/superpowers/specs/conductor-design.md` mirrors the change per the source-of-truth invariant.

## What's in this PR

- `scripts/conductor/schemas.ts` — `CriticProposalSchema` + extended union
- `scripts/conductor/schemas.test.ts` — 6 new test cases (parse ship, parse revise, reject ship-with-unaddressed-falsifier, reject ship-with-unaddressed-risk, accept empty arrays, default concerns to [])
- `scripts/conductor/fixtures/critic-proposal.valid.json` — canonical fixture
- `.claude/skills/conductor/templates/critic.md` — 4th mode documented + return JSON
- `.claude/skills/conductor/SKILL.md` — Phase 0 flow + roster legend + v0.4 changelog
- `docs/superpowers/specs/conductor-design.md` — v0.4 section

## Test plan

- [ ] CI green (typecheck, lint, format, unit + integration tests, validate-skill)
- [ ] Manual: spot-check that `pnpm test scripts/conductor/schemas.test.ts -t "proposal mode"` runs the 6 new tests
- [ ] Manual: run validate-skill against the updated critic.md to confirm all 4 JSON blocks pass
- [ ] Live test (deferred to a separate session): drive a fresh Stub ADR through `/conductor` with `triage_depth: full`; verify the proposal-mode critic dispatch returns coverage arrays whose lengths equal the falsifier/premortem outputs and that orchestrator gates on `addressed: false`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Watch CI**

Run: `gh pr checks --watch 2>&1 | tail -20`

Expected: All checks green. Auto-merge fires when CI completes.

---

## Self-Review Checklist

After saving this plan, verify against Issue #21:

1. **Spec coverage:**
    - ✓ `mode: "proposal"` added to `CriticResultSchema` (Task 1)
    - ✓ Structured `falsifier_coverage` and `direction_risk_coverage` with `claim_index` / `risk_index` / `addressed` / optional `where` (Task 1)
    - ✓ Free-form `concerns: string[]` default `[]` (Task 1)
    - ✓ `summary_path` (Task 1)
    - ✓ Schema rejects `verdict: ship` if any `addressed: false` (Task 1, superRefine)
    - ✓ Roster grows 14 → 14 (no new role, just a mode) (Task 4 — roster legend)
    - ✓ `SCHEMA_BY_ROLE.critic` unchanged (Task 1 — union variant added)
    - ✓ Phase 0, after ratifier, before user-approval (Task 4 — Phase 0 cell + Pre-ratification debate section)
    - ✓ Optional gate (only when `triage_depth: full`) (Task 4 — light path explicitly skips)
    - ✓ Out-of-scope: not a replacement for user approval (Task 4 — flow keeps user-approval step)
    - ✓ Out-of-scope: same loop bound (3 ratifier iters) (Task 4 — explicit reference to existing bound)
    - ✓ New test fixtures for `CriticProposalSchema` (Task 1, Task 2)
    - ✗ Live test on a fresh Stub ADR — deferred to a separate post-merge session (called out in PR body Task 7)

2. **Placeholder scan:** No "TBD"/"TODO"/"implement later" patterns. Every step contains the actual code or command.

3. **Type consistency:** `claim_index` is consistent across schema, tests, fixture, template, design spec. `risk_index` likewise. `addressed` is consistent. `where` is optional in all places. `verdict: 'ship' | 'revise'` (same as existing spec/diff modes).

The deferred live test is intentional — same pattern as v0.3 (which shipped its core in PR #20 then was live-tested on ADR-0034 in the same session). Calling it out in the PR body keeps it visible without blocking the schema+template merge.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-09-conductor-v0.4-critic-proposal-mode.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Each task is small (single concept) and the verification commands are deterministic, so subagent dispatch is low risk.
2. **Inline Execution** — Execute tasks in this session. The plan's 7 tasks fit cleanly into a single uncompressed session if PR #20 has merged by the time we start (so I can branch from updated main).

Either path: branch `feature/conductor-v0.4-critic-proposal` from updated main once PR #20 lands.
