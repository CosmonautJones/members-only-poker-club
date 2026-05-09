# ADR-0032: Cost model & scaling thresholds

- **Status:** Accepted
- **Date:** 2026-05-04
- **Ratified:** 2026-05-08
- **Slice:** 4

## Context

The owner needs a realistic monthly run-rate at different membership counts so the business model works. We should also know the inflection points where each vendor's pricing tier jumps.

## Decision

Order-of-magnitude estimates ratified below. Refine in Slice 4 once we have real measurements (member growth, SMS volume, function exec, bandwidth).

### At 100 members

| Vendor | Monthly cost | Notes |
|---|---|---|
| Vercel | $20 (Pro) | Required for password-protected previews + commercial use |
| Supabase | $25 (Pro) | Required for daily backups + PITR |
| Stripe | ~2.9% + $0.30 per transaction | Fee passed implicitly into pricing |
| Twilio | $1/mo number + $10 A2P brand + ~$0.0079/SMS × ~10 SMS/member/mo | ~$25/mo |
| Resend | $0 (free tier) | <3K emails/mo |
| Sentry | $0 (free tier) | <5K events/mo |
| PostHog | $0 (free tier) | <1M events/mo |
| Domain | ~$1/mo | |
| **Total** | **~$70–100/mo + Stripe fees** | |

### At 1,000 members

| Vendor | Monthly cost | Notes |
|---|---|---|
| Vercel | $20–50 | Bandwidth/function exec scaled |
| Supabase | $25–50 | Bumping to higher compute or extra storage |
| Twilio | ~$100 | More SMS volume |
| Resend | ~$20 | Marketing emails |
| Sentry | $26 (Team) | Above free quota |
| PostHog | $0–50 | Approaching event quota |
| **Total** | **~$200–300/mo + Stripe fees** | |

### At 10,000 members

This is well past the current scope and likely implies a multi-location chain. Re-do the model when we get there.

### Stripe fee model

- Membership at $25–30/mo: ~$1 in fees. Net to club ~$24–29.
- Top-up at $200: ~$6 in fees. Net to club $194 — but the $200 isn't club revenue, it's player credit. The fee comes out of the credit before the bonus is added (member pays $200, gets $194 of purchased credit + $100 of promo bonus = $294 effective). **Owner to confirm pricing reflects fee** — alternative is club absorbs fee from membership margin.

### Triggers for re-evaluation

- Adding a second location
- Crossing 1,000 active members
- Adding any feature that materially changes per-event SMS/email volume

## Open questions (deferred)

- **Stripe fees: absorb vs pass-through** — owner decision pending; tracks with ADR-0011 (time-bank). Default for ratification: time-bank top-up examples in ADR-0011 assume the player pays the fee out of the credit (i.e., $200 in → $194 of usable credit + bonus). Owner can override by re-pricing or absorbing fees from membership margin.
- **Volume discount negotiation with Stripe at 1K members** — calendar item: trigger when MRR sustains $25K+. Action: contact Stripe sales for custom-rate proposal.
- **Long-term cloud-cost optimization** — declined as premature at <1K members. Re-evaluate at the 1K-member scaling threshold defined above.
