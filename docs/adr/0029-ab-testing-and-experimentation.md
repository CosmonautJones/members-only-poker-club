# ADR-0029: A/B testing & experimentation

- **Status:** Stub
- **Date:** 2026-05-04
- **Slice:** 4

## Context

Once traffic is meaningful, we'll want to test variants: pricing copy, hero CTA, tour length on the membership page, top-up tier ordering. We need a way to run experiments without building bespoke randomization each time.

## Decision

To be drafted in Slice 4. Direction:

- **Tool:** PostHog feature flags + experiment analysis.
- **Setup:**
  - Define experiment in PostHog: variant names, traffic split, primary metric, secondary metrics.
  - Wrap variant code in `<Experiment name="hero-cta-v1" variants={['control', 'v1']}>` component.
  - Allocation deterministic on `posthog_distinct_id` (anonymous) or `profile_id` (authenticated).
- **Stat power:** PostHog computes confidence intervals; we wait for 95% before declaring a winner.
- **Holdout:** 10% holdout group on every experiment (no variants applied) — establishes baseline drift.
- **Documentation:**
  - Every experiment has a `docs/experiments/YYYY-MM-DD-slug.md` doc with hypothesis, design, expected impact, decision criteria.
  - Results documented in the same file post-readout.

### Anti-patterns to avoid

- HiPPO ("highest paid person's opinion") shortcuts — owner doesn't override stats.
- Peeking — don't watch results mid-experiment and end early.
- Multiple comparisons — only one primary metric per experiment.

## Open questions

- Whether to use server-side or client-side variant assignment (probably client for marketing copy, server for pricing)
- Minimum traffic threshold before running A/B tests is even worth it (~5,000 weekly visits; we'll likely defer until then)
