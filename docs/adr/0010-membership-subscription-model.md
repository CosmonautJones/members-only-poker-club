# ADR-0010: Membership subscription model

- **Status:** Stub
- **Date:** 2026-05-04
- **Slice:** 2

## Context

Two billing modes:

- **Autopay** — $25/month, charged automatically via Stripe (recurring card)
- **Invoice** — $30/month, member receives a Stripe-hosted invoice email and pays manually

Members can switch between modes mid-cycle. Members can cancel and resume. Past-due members lose portal access (and door access, in Slice 5) until they catch up.

## Decision

To be drafted in Slice 2. Direction:

- Two Stripe Products (or one Product with two Prices): `membership_autopay_monthly` ($25) and `membership_invoice_monthly` ($30).
- A Stripe `Subscription` per member, with `collection_method = 'charge_automatically'` (autopay) or `'send_invoice'` (invoice).
- `memberships.status` mirrors Stripe's `subscription.status` — sync via webhook.
- Switching billing kind = update the subscription's `default_payment_method` and `collection_method`. No proration on the monthly cadence; switch takes effect next cycle.
- Cancel = `cancel_at_period_end = true` (member keeps access until paid period ends, then lapses).
- Resume = un-cancel before period_end, or start a new subscription if past period_end.
- Past-due dunning: 3 retry attempts over 7 days (Stripe Smart Retries), email reminders at days 1/3/5/7. After day 7, status → `canceled`.

## Open questions

- Do we offer annual prepay with a discount (e.g., 11 months for the price of 12)?
- Do we offer pause-the-membership for members who travel? (Stripe supports `pause_collection`.)
- Founding-member pricing: does the owner want a charter rate for the first 100 members?
- Family / "spousal" memberships?

## Alternatives to consider

- Single Subscription with discount coupon for autopay vs full price
- Pre-paid annual with no monthly option
