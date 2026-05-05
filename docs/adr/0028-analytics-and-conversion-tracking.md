# ADR-0028: Analytics & conversion tracking

- **Status:** Stub
- **Date:** 2026-05-04
- **Slice:** 1

## Context

We need to know: how many visitors land on the homepage, how many click "apply", how many start signup, how many complete it, how many enroll in autopay, how many top up time. Without this we're guessing.

## Decision

To be drafted in Slice 1. Direction:

### Tool

- **PostHog** for product analytics (event-first, funnel-friendly).
- **Vercel Analytics** for traffic/perf (lightweight, free with Vercel).
- **No Google Analytics 4** — privacy posture, cookie banner overhead, less useful for our funnel.

### Event taxonomy

```
landing_page_viewed
membership_page_viewed
signup_started
signup_email_submitted
signup_id_uploaded
signup_agreement_signed
signup_payment_completed
signup_completed                  # final success
membership_billing_kind_switched
membership_canceled
time_topup_page_viewed
time_topup_tier_selected          { tier: '50' | '100' | '200' | '500' }
time_topup_completed              { tier, gross_cents, bonus_cents }
tournament_page_viewed
tournament_register_started       { tournament_slug }
tournament_register_completed     { tournament_slug, paid_cents }
cashier_redeem_completed          { minutes }
```

### Properties on every event

- Member ID (if authenticated)
- Anonymous ID (cookie-based; merged on auth)
- Path
- Referrer
- UTM parameters (preserved across signup flow)

### Funnels (built in PostHog)

1. **Acquisition:** landing → membership_page → signup_started
2. **Activation:** signup_started → signup_completed
3. **Monetization:** signup_completed → membership_billing_kind_switched(autopay) | time_topup_completed
4. **Retention:** week-over-week active members (any login + any redeem)

### Cookie consent

Analytics events buffered until consent is granted (ADR-024). On consent, buffered events flush.

## Open questions

- Whether to send conversion events to Stripe Sigma for revenue attribution (Slice 4)
- Server-side event tracking (PostHog supports it) for offline cashier redemptions
