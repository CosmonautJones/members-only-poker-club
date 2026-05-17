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

A single JSON object matching `RetrospectiveResultSchema`. The `proposed_diffs[]` field is REQUIRED (v0.5) — an empty array is the valid "no improvements identified" output, but the field must be present so the `/conductor learn` merger can iterate uniformly across cycles.

```json
{
  "status": "ok",
  "proposal_path": "{{proposal_path}}",
  "patterns_found": 3,
  "diffs_proposed": 1,
  "summary_path": "{{summary_path}}",
  "proposed_diffs": [
    {
      "target_file": ".claude/skills/conductor/SKILL.md",
      "patch_or_diff": "(unified-diff hunk OR a path to a .patch file under .conductor/<N>/)",
      "rationale": "one-paragraph why; cite events.jsonl / dispatches / attempts evidence",
      "source_evidence": ".conductor/<N>/events.jsonl:<line>",
      "strength": "strong"
    }
  ]
}
```

`proposed_diffs[].strength` is one of `"strong" | "medium" | "discipline"` matching the recommendation ladder in prior proposals (see `.conductor/0035/skill-diff-proposal.md` for the exemplar format).

If no patterns warrant a change, return `patterns_found: 0`, `diffs_proposed: 0`, `proposed_diffs: []`.
