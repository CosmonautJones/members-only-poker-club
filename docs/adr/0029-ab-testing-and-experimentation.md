# ADR-0029: A/B testing & experimentation

- **Status:** Accepted
- **Date:** 2026-05-04
- **Ratified:** 2026-05-08
- **Slice:** 4

## Context

Once traffic is meaningful, we'll want to test variants: pricing copy, hero CTA, tour length on the membership page, top-up tier ordering. We need a way to run experiments without building bespoke randomization each time.

## Decision

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

## Open questions (deferred)

- **Server-side vs client-side variant assignment** — resolved: client-side for marketing copy variants (PostHog `useFeatureFlagVariantKey`), server-side for pricing or anything money-touching (variant resolved in the server action so the rendered price and the charged price can never diverge).
- **Minimum traffic threshold before A/B testing is worthwhile** — resolved: ~5K weekly unique visits. v1 launches without active experiments; harness ships ready for Slice 4 or whenever traffic warrants. Tracked as a triggering condition, not a blocker for ratification.
