# ADR-0011: Time-bank model

- **Status:** Stub
- **Date:** 2026-05-04
- **Slice:** 3

## Context

Members pay $12/hour to play, deducted from a prepaid stored-value wallet. Top-up tiers are $50, $100, **$200 (gets $300 of credit — $100 promo bonus)**, $500. The cashier redeems time when a member sits at a table; the meter pauses when they step away.

Stored-value raises a regulatory question: **TX unclaimed-property law** (Texas Property Code Chapter 72) may treat dormant balances as escheatable property after 3 years. Per the Texas Comptroller, gift cards are exempt if they have no expiration; stored-value time credit may or may not qualify. CPA review required before launch.

## Decision

To be drafted in Slice 3. Direction:

- Wallet balance stored as `time_wallets.balance_minutes` (integer minutes).
- All credits and debits go through `time_ledger` (append-only).
- Top-up Stripe checkout (one-time PaymentIntent) → on `payment_intent.succeeded`, write a `purchase` ledger entry with the gross minutes; if the tier qualifies for a promo, write a separate `promo_bonus` entry with the bonus minutes (audit clarity).
- Redemption via `redeemTimeAction` server action with required idempotency key (ADR-005).
- Refunds: a `refund` ledger entry that brings the wallet down by the refunded minutes; if balance goes negative, the member owes (rare but possible if they redeemed before the refund processed).
- Expiration policy (TBD with CPA): proposed default = no expiration on purchased credit, 18-month expiration on promo-bonus credit.
- Dormancy: after 18 months of zero activity, send 30-day notice. After 36 months, balance converts to non-refundable promo credit (minimizes escheatment exposure). All transitions audit-logged.
- Members can request refund of unused balance at any time, minus a 5% restocking fee (covers Stripe processing). Refund check signed by manager+.

## Open questions

- CPA opinion on TX escheatment posture
- Counsel on whether the membership agreement can disclaim escheatment (probably can disclaim *expiration* but not *escheatment* statutorily)
- Refund-on-cancellation policy: do canceled members get their unused time refunded automatically, or do they have a window?
- Bonus minutes vs purchased minutes — different expiration, but should they be debited in any priority order? Proposal: FIFO on purchase date, with bonus minutes consumed first to minimize expiration risk.

## Alternatives to consider

- Voucher model (no balance, just a one-time $300 credit) — sidesteps escheatment but loses flexibility
- Time stored as cents at a fixed $12/hr rate, computed at purchase — same math, different schema
