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
