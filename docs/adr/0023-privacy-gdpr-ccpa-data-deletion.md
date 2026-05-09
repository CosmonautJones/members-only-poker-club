# ADR-0023: Privacy, GDPR/CCPA, data deletion

- **Status:** Accepted
- **Date:** 2026-05-04
- **Ratified:** 2026-05-08
- **Slice:** 4

## Context

Even though we serve a primarily Texas customer base, GDPR (EU) and CCPA/CPRA (California) requests can come in from members who travel, move, or visit. Plus, simple "delete my account" is table-stakes UX.

## Decision

### Categories of data

- **PII collected at signup:** name, dob, email, phone, ID document
- **Behavioral:** session logs, page views, conversion events
- **Financial:** Stripe customer/payment_intent IDs, ledger entries
- **Communications:** SMS/email delivery records

### Member-initiated rights

- **Access (export):** member can download a JSON of all their data via Profile → Privacy → "Download my data". Generated server-side, link emailed (signed URL, 24hr TTL).
- **Rectification:** members edit profile fields directly; corrections to immutable fields (dob, member_number) require a manager.
- **Deletion:** "Delete my account" anonymizes the member: name, email, phone, ID doc replaced with `del:<hash>` tokens; profile soft-deleted; auth row deleted. Audit log keeps the actor token. Ledger/payments retain financial history for tax + dispute purposes (legal exception per CCPA).
- **Opt-out of sale of data:** we don't sell data; the toggle is a no-op but present per CCPA.

### Retention schedule

| Data | Retention | Why |
|---|---|---|
| ID document image | 30 days post-verification | Minimize PII surface |
| Audit log | Forever | Compliance, dispute resolution |
| Ledger entries | Forever | Financial record |
| Payment records | 7 years | Tax / IRS |
| Sentry errors | 90 days | Sentry default |
| PostHog events | 1 year | Product analytics |
| Sessions | 30 days | Security forensics |
| Marketing email contacts | Until unsubscribed |

### Cookie banner

See ADR-024.

### Privacy policy

Plain-language version on `/privacy`. Updated whenever data practices change. Versioned in `content_blocks`.

## Open questions (deferred)

- **Data Protection Officer registration** — declined for v1. Not required at our scale (single establishment, no large-scale systematic monitoring of EU residents). Re-evaluate if member base grows to include sustained non-US residency.
- **CMP (Osano) vs roll-our-own** — resolved: rolling our own per ADR-0024 (already shipped). The first-party banner satisfies GDPR/CCPA requirements at our scope and avoids a third-party dependency in the consent path.
