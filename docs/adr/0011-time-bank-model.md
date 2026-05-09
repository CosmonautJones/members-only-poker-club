# ADR-0011: Time-bank model

- **Status:** Accepted
- **Date:** 2026-05-04
- **Ratified:** 2026-05-08
- **Slice:** 3

## Context

Members pay $12/hour to play, deducted from a prepaid stored-value wallet. Top-up tiers are $50, $100, **$200 (gets $300 of credit — $100 promo bonus)**, $500. The cashier redeems time when a member sits at a table; the meter pauses when they step away.

Stored-value raises a regulatory question: **TX unclaimed-property law** (Texas Property Code Chapter 72) may treat dormant balances as escheatable property after 3 years. Per the Texas Comptroller, gift cards are exempt if they have no expiration; stored-value time credit may or may not qualify. CPA review required before launch.

## Decision

- Wallet balance stored as `time_wallets.balance_minutes` (integer minutes).
- All credits and debits go through `time_ledger` (append-only).
- Top-up Stripe checkout (one-time PaymentIntent) → on `payment_intent.succeeded`, write a `purchase` ledger entry with the gross minutes; if the tier qualifies for a promo, write a separate `promo_bonus` entry with the bonus minutes (audit clarity).
- Redemption via `redeemTimeAction` server action with required idempotency key (ADR-005).
- Refunds: a `refund` ledger entry that brings the wallet down by the refunded minutes; if balance goes negative, the member owes (rare but possible if they redeemed before the refund processed).
- Expiration policy (TBD with CPA): proposed default = no expiration on purchased credit, 18-month expiration on promo-bonus credit.
- Dormancy: after 18 months of zero activity, send 30-day notice. After 36 months, balance converts to non-refundable promo credit (minimizes escheatment exposure). All transitions audit-logged.
- Members can request refund of unused balance at any time, minus a 5% restocking fee (covers Stripe processing). Refund check signed by manager+.

## Open questions (deferred — owner/counsel-pending)

- **CPA opinion on TX escheatment posture** — required pre-Slice-3-launch. Default policy until reviewed: 18-month expiration on bonus credit, no expiration on purchased credit, dormancy notice at 18 months, conversion to non-refundable promo credit at 36 months (per ADR body). CPA may require a different escheatment posture; ledger schema supports either via `expires_at` on each ledger row.
- **Counsel on disclaim-of-escheatment in member agreement** — required pre-launch. Default: agreement disclaims *expiration* (per CPA-pending policy) but does not disclaim *escheatment* (statutorily not disclaimable in TX).
- **Refund-on-cancellation policy** — owner decision. Default v1: members may *request* a refund (5% restocking fee), no automatic refund on cancellation. Codified as `lib/timebank/refund.ts` policy constant.
- **Bonus minutes priority order** — resolved: FIFO on purchase date, bonus consumed first within tier (per ADR body, codified as `lib/timebank/redemption-order.ts`).

## Alternatives considered (not chosen)

- **Voucher model (one-time $300 credit, no balance)** — rejected. Sidesteps escheatment but loses redemption flexibility (a voucher can't be partially redeemed across multiple sessions). Members value the wallet UX.
- **Time stored as cents at fixed $12/hr rate** — rejected. The math is identical, but minutes-as-the-unit is closer to how the cashier and members think about the resource. Cents-storage would force a UI conversion every read.
