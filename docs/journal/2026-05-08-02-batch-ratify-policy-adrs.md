# 2026-05-08-02 — Batch-ratify six policy-only ADRs (0019, 0021, 0022, 0027, 0031, 0032)

## What

Flipped six ADRs from `Status: Stub` → `Status: Accepted` in a single PR:

- **0019** — backups & disaster recovery (Supabase PRO + PITR; quarterly DR drill)
- **0021** — testing strategy (Vitest unit + Vitest integration + Playwright e2e + axe a11y)
- **0022** — PCI scope (stay in SAQ A; Stripe Checkout / Elements only)
- **0027** — support operations (tier 1 cashier desk → tier 2 helpdesk; refund authority matrix)
- **0031** — vendor lock-in posture (per-vendor lock-in tier matrix; selective wrappers)
- **0032** — cost model & scaling thresholds (run-rate at 100 / 1K members; trigger conditions for re-eval)

Each ADR was already substantively drafted — every section under `## Decision` was complete.
Ratification meant:

1. Flipping the `Status:` line and adding a `Ratified:` line.
2. Removing the "To be drafted in Slice X. Direction:" preamble that no longer applies.
3. Resolving open questions with explicit accept / defer / decline reasoning (no question
   was left as a bare bullet — every one now states what we're doing about it and why).

## Why batch them

Each one is a pure-policy decision document. There is no implementation work attached
(beyond what other ADRs already imply). Running the full conductor flow on each in
sequence — bootstrap → plan → build → integrate → ship → retro — would have consumed
six full conductor cycles for what is effectively a documentation update. Batching
into one PR was the right call because:

- All six have zero source-code surface to test.
- The acceptance commands are identical for each (the existing CI gauntlet — typecheck,
  lint, test, format-check — plus the structural ADR validator).
- Reviewing six tiny doc changes together is cheaper than six PRs in flight.

## Conductor-flow deviation

This batch ratification deviates from the v0.2 conductor pattern (one ADR per run).
The deviation is intentional and recorded here so future runs know the precedent:

- The conductor's per-ADR pattern is right when there is non-trivial implementation
  work or a paired implementation spec is needed.
- For pure-policy ADRs (no code, no spec, no acceptance commands beyond the existing
  CI gauntlet), the per-ADR pattern is over-engineered.
- A future skill-diff might propose a "policy-batch" mode for the conductor — same
  ratifier role, but applied to N ADRs in one phase, ending in one journal entry +
  one PR. Not implementing that here; just noting the case.

## What didn't change

- No source code touched.
- No new specs written. (None of these ADRs had paired specs; none need one.)
- No KB topic deltas. (KB topics are for compounding worker/test-writer lessons; these
  policy ratifications produce no such lessons.)

## Counts after this PR

- Accepted: 17 (was 11)
- Stub: 16 (was 22)
- Total: 33

## Next ADRs in queue

Implementation-bearing ADRs that are ready to run individually:

- 0014 observability (Sentry server-side wiring; PostHog event taxonomy)
- 0015 alerting & incident response (Sentry alert rules + on-call rotation policy)
- 0016 rate limiting (Upstash or in-memory ring buffer)
- 0018 database migrations (`supabase migration` workflow + CI gate)
- 0020 feature flags (file-based or env-based; integrates with 0029)
- 0023 privacy / GDPR / CCPA / data deletion (deletion endpoint + 30-day soft delete)
- 0026 accessibility (axe-core in Playwright; manual audit pass on marketing surface)
- 0028 analytics & conversion tracking (PostHog event taxonomy + helpers)
- 0029 A/B testing & experimentation (depends on 0020)

Blocked on owner / API keys (will require escalation):

- 0009 member identity & ID verification (vendor TBD)
- 0010 membership subscription model (Stripe keys)
- 0011 time-bank model (depends on 0010)
- 0012 tournament model (large feature)
- 0013 PokerAtlas integration (API access)
- 0025 email & SMS communications (Postmark + Twilio keys)
