---
date: 2026-05-05
adrs: []
slice: 1
type: infra
status: complete
---

# Conductor amendment — ratifier role for Stub ADRs

## Context

The conductor harness shipped earlier today (entry 05). First real `/conductor 30` against ADR-0030 (SEO) was refused at Phase 0 because the ADR is `Status: Stub` and the skill's Phase 0 rule explicitly refused Stubs. Triage of all 24 Stub ADRs found 9 near-ready, 13 half-fleshed, 2 bare placeholders. Manual sweep estimated at ~3-4 hours, just for slice-1.

## Changes

- New role: `ratifier` — agent at `.claude/skills/conductor/templates/ratifier.md`. Reads a Stub ADR + cross-refs, drafts Consequences + Alternatives, flips Status to Accepted. Output is a proposal at `.conductor/<N>/ratification-proposal.md`; never modifies the live ADR file.
- SKILL.md Phase 0: changed from "refuse on Stub" to "dispatch ratifier on Stub or Proposed → user approves → write back".
- SKILL.md Escalation policy: added trigger #5 "Ratification approval"; renumbered Stuck → 6, Guardrail → 7.
- spec-writer.md: dropped the `if Stub return blocked` rule; ratifier now precedes spec-writer in the pipeline.
- validate-skill.ts REQUIRED_TEMPLATES: 13 → 14 entries.
- design spec `2026-05-05-conductor-design.md`: amended §4.1, §5, §10, §15; appended §17 Amendments table.

## Decisions

- **Pause-and-approve over auto-accept.** The ratifier never auto-modifies an ADR file. ADRs are permanent project record; user-gated approval is the right tradeoff even if it adds one mid-flow pause per Stub-driven run. Auto-accept on truly low-risk ADRs is a future-work item recorded in §15.
- **5th escalation trigger.** Adding a 5th trigger is a deliberate departure from the original 4-trigger policy. Triggers are about user-gated decisions; a Stub→Accepted flip qualifies because it permanently shapes the project's design history.
- **Design spec amended in place, not superseded.** Added an Amendments table at the bottom (§17). The retrospective agent reads this file as authoritative source-of-truth, so amendments must be visible there, not just in the journal.

## Tests

- `corepack pnpm validate:conductor` → 12 tests passing.
- Validator's `REQUIRED_TEMPLATES` constant grew to 14; `ratifier.md` confirmed present.

## Next

- Run `/conductor 30` against ADR-0030 to exercise the new ratifier flow end-to-end. If the proposal looks good, accept and let conductor proceed to Phase 1+. If the proposal needs revisions, exercise the ratifier-revision loop. Either way, this is the first real test of the harness as a whole.
- Slice-1 Stubs queued for sequential conductor runs after 0030 (per the approved plan): 0017 → 0018 → 0024 → 0028 → 0026 → 0016 → 0012 → 0014 → 0021.

## Notes for future me

- The ratifier is the new front door to the harness for any work on a Stub ADR. If you find yourself manually editing an ADR's Status field outside a `/conductor` run, you're going around the harness — that's fine occasionally but watch for the pattern.
- Trigger #5 is subtle: the orchestrator pauses, surfaces the proposal path, waits for user accept-or-revise, and only then writes back to docs/adr/. Don't auto-write on accept; use the shipper agent to keep git ops consistent with the rest of the harness.
- Open question §15 (auto-accept on low-risk ADRs) is a real future tightening once we see how many runs actually need user input. Track interruption frequency via the dispatch log.
