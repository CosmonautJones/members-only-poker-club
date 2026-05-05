# ADR-0022: PCI scope

- **Status:** Stub
- **Date:** 2026-05-04
- **Slice:** 2

## Context

Accepting card payments triggers PCI-DSS compliance obligations. The scope of those obligations depends on whether we ever see, store, or transmit cardholder data ourselves.

## Decision

To be drafted in Slice 2. Direction: **stay in PCI SAQ A scope** — the minimum tier — by ensuring we never touch card data.

- All card collection happens via Stripe Checkout (hosted) or Stripe Elements (iframed). The card form is rendered by Stripe's domain; the card number never touches our HTML/JS.
- We store only Stripe IDs (customer, payment_method, payment_intent, subscription) — never PAN, CVV, or expiry.
- Member-facing card management goes through Stripe's Billing Portal (hosted). We don't build a custom card-edit UI.
- Webhooks receive Stripe event IDs and metadata; never raw card data.
- No "remember my card for next time" feature implemented by us — Stripe Customer holds payment methods, we just reference them.

### PCI SAQ A annual attestation

- Owner signs once per year.
- Vendor (Stripe) attestation kept on file.
- We document the technical posture in this ADR for the auditor.

## Open questions

- TX-specific surcharge or minimum-purchase-fee rules (these are state-law, not PCI)
- 3DS / SCA requirements for our typical transaction sizes (Stripe handles automatically)
