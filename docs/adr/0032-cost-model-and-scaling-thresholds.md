# ADR-0032: Cost model & scaling thresholds

- **Status:** Stub
- **Date:** 2026-05-04
- **Slice:** 4

## Context

The owner needs a realistic monthly run-rate at different membership counts so the business model works. We should also know the inflection points where each vendor's pricing tier jumps.

## Decision

To be drafted in Slice 4. Direction — order of magnitude estimates only, refine in Slice 4 with real measurements:

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

## Open questions

- Owner's view on absorbing vs passing through Stripe fees (impacts time-bank math)
- Whether to negotiate volume discounts with Stripe at 1K members (typically possible)
- Long-term cloud-cost optimization (probably premature)
