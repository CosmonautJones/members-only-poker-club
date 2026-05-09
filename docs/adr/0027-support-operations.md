# ADR-0027: Support operations

- **Status:** Accepted
- **Date:** 2026-05-04
- **Ratified:** 2026-05-08
- **Slice:** 4

## Context

Members have questions, problems, and disputes. Staff need a tool to triage them, escalate when needed, and track resolution.

## Decision

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

## Open questions (deferred)

- **In-app messaging tool** — declined for v1. The shared inbox + SMS/email is sufficient at <1K members; overkill until support volume justifies a triaged ticket queue. Re-evaluate at the 1K-member scaling threshold (ADR-0032).
- **Stripe disputes UI in admin** — deferred. Stripe Dashboard handles disputes natively; building an in-app mirror is duplicate work until volume warrants it. Track in a future support-tooling ADR if owner ever wants disputes triaged in-app.
