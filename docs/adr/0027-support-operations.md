# ADR-0027: Support operations

- **Status:** Stub
- **Date:** 2026-05-04
- **Slice:** 4

## Context

Members have questions, problems, and disputes. Staff need a tool to triage them, escalate when needed, and track resolution.

## Decision

To be drafted in Slice 4. Direction:

### Tier 1 — at the desk

- Cashier handles common asks: "I lost my card", "redeem my time", "what's my balance".
- Cashier console (`/cashier`) supports: lookup, basic adjustments, generate temporary access pass.
- Out of cashier authority: refunds, role changes, accepting ID re-verification.

### Tier 2 — manager / owner

- Helpdesk inbox: `members@membersonlypokerclub.com` → routed to manager. (Tool TBD: Help Scout, Front, or just a shared Gmail with the discipline of a ticketing system.)
- Manager actions: refunds (with audit), role changes, dispute responses, override membership state, escalate to owner.

### Refund authority matrix

| Action | Cashier | Manager | Owner |
|---|---|---|---|
| Manual time credit ≤ $25 | ✓ | ✓ | ✓ |
| Manual time credit $25–$200 | — | ✓ | ✓ |
| Manual time credit > $200 | — | — | ✓ |
| Membership refund (current month) | — | ✓ | ✓ |
| Membership refund (previous months) | — | — | ✓ |
| Role change | — | — | ✓ |

All actions audit-logged regardless of authority level.

### Common runbooks (`docs/runbooks/`)

- `runbook-refund-flow.md`
- `runbook-payment-dispute.md`
- `runbook-lost-email-access.md`
- `runbook-suspected-fraud.md`
- `runbook-member-data-export-request.md`
- `runbook-member-deletion-request.md`

### SLA targets

- Tier 1 in-room: immediate
- Tier 2 helpdesk: 1 business day for non-urgent, 4 hours for payment-related

## Open questions

- Whether to build an in-app messaging tool (probably overkill v1)
- Whether to integrate Stripe disputes UI directly into admin
