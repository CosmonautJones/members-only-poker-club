# Experiment: <slug>

- **Name:** <kebab-case experiment name; matches the registry entry>
- **Owner:** <name>
- **Status:** Draft | Live | Concluded
- **Started:** YYYY-MM-DD
- **Concluded:** YYYY-MM-DD (after readout)

## Hypothesis

We believe that <change> will cause <metric> to <move in direction> because
<reasoning grounded in user behavior or prior data>.

We will know this is true if <decision criterion> at <statistical-significance
threshold> after <expected-traffic threshold>.

## Design

- **Variants:** control vs <variant-1> [vs <variant-2>...]
- **Allocation:** <weights, e.g., 50/50 or 33/33/33>
- **Holdout:** <percent, default 10>
- **Primary metric:** <metric name + how it's measured>
- **Secondary metrics:** <list>
- **Guardrails:** <metrics that must not regress>

## Expected impact

- Best case: <metric move>
- Worst case: <metric move>
- Most likely: <metric move>

## Decision criteria

- **Ship:** primary metric moves by ≥ <threshold> with p < 0.05.
- **Kill:** primary metric drops by any amount, OR any guardrail
  regresses by > <threshold>.
- **Iterate:** primary metric moves but not enough to declare; refine
  hypothesis and re-run.

## Code surface

- Wrapped via `<Experiment name="<slug>" renderers={...}>` at <file path>.
- Allocation is deterministic on `profile_id`. Anonymous traffic gets
  control.

## Out of scope

- <list>

## Results (after readout)

<replace this section after the experiment concludes — summarize traffic,
significance, decision, and follow-up actions>
