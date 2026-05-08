---
adr: NNNN
slice: N
risk: low | medium | high
# Acceptance commands MUST be runnable shell commands that exit 0 only when
# every numbered acceptance criterion is satisfied. The validator runs each
# one in order during the slice/integration pass; scope-judge refuses to
# return ship_ready=true if any was not run-and-passed. Bare `pnpm test`
# does NOT count — list the specific e2e/integration commands that bind
# the spec's acceptance language to runnable behavior.
acceptance_commands:
  - 'pnpm test:e2e:<feature>'
  # - 'pnpm test:integration:<feature>'
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
