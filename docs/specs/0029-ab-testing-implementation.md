---
adr: 0029
slice: 1
risk: low
acceptance_commands:
  - 'pnpm test tests/experiments/'
---

# Spec: A/B testing harness (ADR-0029 slice 1)

- **ADR:** [0029](../adr/0029-ab-testing-and-experimentation.md)
- **Status:** Draft
- **Date:** 2026-05-09

## Goal

Ship the variant-assignment primitives so call sites can wrap UI in a typed
`<Experiment>` component or call `assignVariant()` from any code path. The
PostHog experiment-analysis surface (results readout, statistical-significance
calculations) is deferred to the PostHog-init slice — slice 1 ships the
client-side decision tree only.

## Acceptance criteria

1. `lib/experiments/types.ts` defines `ExperimentDefinition` (name, variants
   array, weights array (defaults to equal), holdout percent (default 10),
   owner, hypothesis link) and `ExperimentContext` (profileId only — anonymous
   traffic can't be bucketed deterministically and falls into the control
   variant).
2. `lib/experiments/assign.ts` exports `assignVariant(def, ctx)`. Returns the
   variant name (string) for the profileId, or `'__holdout__'` when the
   profile lands in the holdout bucket. Allocation is deterministic on
   `(profileId, experimentName)` using the same djb2 bucketing as
   `lib/flags/`. Anonymous traffic returns the first variant (control).
3. Holdout: `holdoutPercent` (default 10) of profiles get `__holdout__` and
   are not exposed to any variant. The remaining (1 - holdoutPercent)% are
   distributed across variants per `weights`.
4. `lib/experiments/registry.ts` exports `EXPERIMENTS` as the in-code source
   of truth. Currently includes one example experiment (`hero-cta-v1`,
   variants: control + v1, equal weights, 10% holdout, "off" until launched).
5. `components/site/experiment.tsx` exports `<Experiment name="..." renderers={...}>`
   that calls `assignVariant`, renders the matching renderer (or null for
   holdout), and fires a `track({ name: 'experiment_exposed', props: {...} })`
   event so PostHog (or any future analytics driver) can correlate exposures
   with downstream funnel events. The `experiment_exposed` event is added to
   the analytics taxonomy in this PR.
6. `docs/experiments/_template.md` provides the experiment-doc template
   (hypothesis, design, expected impact, decision criteria, results section).
7. Vitest coverage at `tests/experiments/`: (a) `assignVariant` returns the
   same variant for the same (profile, experiment) pair across calls; (b)
   distribution across N profiles is close to weights; (c) holdout consumes
   the configured fraction; (d) anonymous traffic gets control; (e) the
   `<Experiment>` component renders the chosen renderer and skips on holdout.
8. `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check` all pass.

## Touched-files inventory

- Create: `lib/experiments/types.ts`
- Create: `lib/experiments/assign.ts`
- Create: `lib/experiments/registry.ts`
- Create: `lib/experiments/index.ts`
- Create: `components/site/experiment.tsx`
- Create: `tests/experiments/assign.test.ts`
- Create: `tests/experiments/component.test.tsx`
- Create: `docs/experiments/_template.md`
- Modify: `lib/analytics/events.ts` (add `experiment_exposed` event)
- Modify: `tests/analytics/events.test.ts` (assert new event in taxonomy)

## Out of scope

- PostHog feature-flags SDK integration (deferred to PostHog-init slice)
- Server-side variant resolution for pricing (per ADR-0029 open-question
  resolution: server-side path lands when the first money-touching
  experiment is proposed)
- Statistical-significance calculations (PostHog computes; we don't
  re-implement)

## Open questions

None at planning time.
