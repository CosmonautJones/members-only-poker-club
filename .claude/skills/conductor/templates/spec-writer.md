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
