# ADR-0010: Membership subscription model

- **Status:** Accepted
- **Date:** 2026-05-04
- **Ratified:** 2026-05-08
- **Slice:** 2

## Context

Two billing modes:

- **Autopay** — $25/month, charged automatically via Stripe (recurring card)
- **Invoice** — $30/month, member receives a Stripe-hosted invoice email and pays manually

Members can switch between modes mid-cycle. Members can cancel and resume. Past-due members lose portal access (and door access, in Slice 5) until they catch up.

## Decision

- Two Stripe Products (or one Product with two Prices): `membership_autopay_monthly` ($25) and `membership_invoice_monthly` ($30).
- A Stripe `Subscription` per member, with `collection_method = 'charge_automatically'` (autopay) or `'send_invoice'` (invoice).
- `memberships.status` mirrors Stripe's `subscription.status` — sync via webhook.
- Switching billing kind = update the subscription's `default_payment_method` and `collection_method`. No proration on the monthly cadence; switch takes effect next cycle.
- Cancel = `cancel_at_period_end = true` (member keeps access until paid period ends, then lapses).
- Resume = un-cancel before period_end, or start a new subscription if past period_end.
- Past-due dunning: 3 retry attempts over 7 days (Stripe Smart Retries), email reminders at days 1/3/5/7. After day 7, status → `canceled`.

## Open questions (deferred — owner-pricing decisions)

- **Annual prepay discount** — deferred. Default v1 ships monthly only. If owner approves an 11-for-12 annual SKU, add a third Stripe Price (`membership_autopay_annual`) and route through the same Subscription mechanic (interval=year). Tracked for owner review at Slice 2 launch.
- **Pause-the-membership** — deferred. Stripe `pause_collection` is supported but adds dunning complexity. v1 = cancel-and-resume only; pause feature can be added in Slice 4 without schema changes.
- **Founding-member charter pricing** — owner decision. Track as a coupon (Stripe `Coupon` with first-N applies) so the rate is auditable in Stripe and time-bounded. Default v1 ships without; owner can enable from Stripe dashboard.
- **Family / "spousal" memberships** — deferred to post-launch. Schema-prepared via `memberships.tier` enum but no UI. Re-evaluate based on demand.

## Alternatives considered (not chosen)

- **Single Subscription with discount coupon for autopay vs full price** — rejected. Two Prices keeps the "method-of-billing" attribute on the Price (where it belongs in Stripe semantics) instead of layering coupon math on top, and simplifies the dunning flow.
- **Pre-paid annual with no monthly option** — rejected for v1. Most members prefer monthly; annual is additive (Open Question above).
