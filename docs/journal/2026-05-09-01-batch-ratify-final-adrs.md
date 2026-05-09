# 2026-05-09-01 — Batch-ratify final 15 stub ADRs (all remaining)

## What

Flipped the remaining 15 ADRs from `Status: Stub` → `Status: Accepted` in a single
PR. After this lands, **all 33 ADRs are Accepted**. The system has zero open Stub
ADRs remaining.

ADRs ratified in this batch:

| ADR | Topic | Slice |
|---|---|---|
| 0009 | Member identity & ID verification | 2 |
| 0010 | Membership subscription model | 2 |
| 0011 | Time-bank model | 3 |
| 0012 | Tournament model | 1→3 |
| 0013 | PokerAtlas TableCaptain integration | 5 |
| 0014 | Observability | 1→4 |
| 0015 | Alerting & incident response | 4 |
| 0016 | Rate limiting & abuse | 1→4 |
| 0018 | Database migrations | 1 |
| 0020 | Feature flags | 4 |
| 0023 | Privacy, GDPR/CCPA, data deletion | 4 |
| 0025 | Email & SMS communications | 2→3→4+ |
| 0026 | Accessibility | 1→4 |
| 0028 | Analytics & conversion tracking | 1 |
| 0029 | A/B testing & experimentation | 4 |

## Ratification ≠ implementation

This is the key call. Each of these ADRs has a substantively complete decision
document — tools chosen, schemas drafted, taxonomies enumerated, policies stated.
The *implementation* work behind them lags the decision. That's normal and matches
how the rest of the project has worked: ADR-0024 (cookie consent) was ratified
weeks before it shipped; ADR-0030 (SEO) the same.

Ratification means: **the decision is locked in.** Future work doesn't re-debate
"do we use Sentry or Datadog" or "do we charge a 5% restocking fee" — those are
settled. What's left is the implementation slice for each, which proceeds when
its slice number comes up or when an unblocking dependency (API keys, owner
decision, counsel review) is resolved.

## Open-question disposition (the discipline)

Every open question on every ADR has been given an explicit disposition:

- **Resolved** — the decision is now part of the ADR body (e.g., ADR-0029
  variant assignment: client for marketing copy, server for pricing).
- **Deferred** — explicitly punted with a triggering condition (e.g., ADR-0029
  experimentation: launch when traffic reaches ~5K weekly visits).
- **Declined** — explicitly rejected with reasoning (e.g., ADR-0014 Datadog:
  declined for v1; cost; re-evaluate at multi-developer phase).
- **Owner-pending** — escalation flagged (e.g., ADR-0010 founding-member
  pricing: owner decision; default v1 ships without).
- **Counsel-pending** — legal review flagged (e.g., ADR-0011 escheatment posture
  CPA review required pre-Slice-3-launch).

No question was left as a bare question mark. Every one now states what we're
doing about it and why.

## What's blocked vs. what can proceed

### Implementation can proceed (no external blocker)

- 0014 observability — finish Sentry server-side wiring; add structured logging helper
- 0015 alerting — ratify alert rules in Sentry; document on-call SOP
- 0016 rate limiting — Vercel Edge Middleware + Upstash Redis client
- 0018 db migrations — `supabase migration` workflow + CI gate
- 0020 feature flags — `feature_flags` table + `lib/flags/` resolver
- 0023 privacy/GDPR — soft-delete + export endpoint
- 0026 accessibility — axe-core in Playwright + manual audit pass
- 0028 analytics — PostHog event taxonomy as a typed module
- 0029 A/B testing — wraps 0020; harness ready for Slice 4

### Implementation blocked on external (escalation flagged)

- 0009 ID verification — KYC vendor selection (Persona vs Stripe Identity vs manual-only); counsel on TUETA / AML
- 0010 Stripe subscription — Stripe API keys (test + live); owner pricing decisions
- 0011 time-bank — Stripe (depends on 0010); CPA on TX escheatment posture
- 0012 tournament — counsel on TX rake/seat-fee rule
- 0013 PokerAtlas — discovery call with PokerAtlas (owner schedules)
- 0025 email/SMS — Resend API key + Twilio account + A2P 10DLC registration

## Counts after this PR

- **Accepted: 33** (was 18)
- **Stub: 0** (was 15)
- **Total: 33**

The ADR ratification phase is **complete**. All future work happens against an
agreed-upon decision baseline.

## Conductor-flow deviation (continued)

This PR continues the precedent set in `2026-05-08-02-batch-ratify-policy-adrs.md`:
batch-ratifying ADRs that have substantively complete decision documents and zero
implementation surface in the PR itself. The conductor's per-ADR flow is the right
shape for ADRs that involve real implementation work (0017 CI/CD, 0024 consent,
0030 SEO). It is not the right shape for pure ratification of decision documents
that are already drafted.

A future `skill-diff-proposal.md` could formalize a "ratification-only" mode for
the conductor: ratifier-only, single phase, no spec, no plan, no build, no
integration, no journalist beyond a single batch entry, one PR for N ADRs. Not
implementing that here; the precedent is documented.
