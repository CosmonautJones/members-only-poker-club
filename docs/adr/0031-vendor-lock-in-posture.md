# ADR-0031: Vendor lock-in posture

- **Status:** Accepted
- **Date:** 2026-05-04
- **Ratified:** 2026-05-08
- **Slice:** 4

## Context

Every SaaS we adopt is a future migration we may have to do. Wrapping every vendor in a perfect abstraction is wasted work; accepting deep lock-in everywhere is a hostage situation. The right posture is per-vendor.

## Decision

### Lock-in tier per vendor

| Vendor | Lock-in level | Rationale |
|---|---|---|
| **Vercel** | Low (could move to AWS/Cloudflare in days) | Next.js is portable; a few function syntax differences |
| **Supabase Postgres** | Moderate (the DB) | Standard Postgres; pg_dump → restore elsewhere works. RLS policies portable. Auth would migrate via export. |
| **Supabase Auth** | High | Migration means re-issuing every member's password reset. Wrapped via `lib/auth/`. |
| **Supabase Storage** | Low | S3-compatible API; rclone moves data. |
| **Stripe** | Very high | Subscription state, customer IDs, payment methods all live there. Migration means a customer-facing "re-add your card" flow. Accept this lock-in. |
| **Twilio** | Low | A2P 10DLC paperwork transfers to a new provider; phone number ports out. |
| **Resend** | Low | Templates portable; DNS records swap. |
| **Sentry** | Low | Open source self-hostable if needed; events not load-bearing. |
| **PostHog** | Low | Open source, self-hostable. |

### Wrappers

- `lib/payments/stripe.ts` — thin wrapper, but doesn't pretend to abstract Stripe. We just won't migrate Stripe.
- `lib/email/resend.ts` — abstract enough that swapping for SendGrid is a one-file change.
- `lib/sms/twilio.ts` — same posture.
- `lib/auth/` — wraps Supabase Auth methods so a future migration can be a one-module change.

### Anti-pattern: premature abstraction

- We don't build a "PaymentProvider" interface that pretends Stripe and Adyen are interchangeable. They're not. We commit to Stripe.
- We don't build a "CloudObjectStorage" abstraction over Supabase Storage. We commit.
- We do wrap Auth and SMS lightly because realistic migrations exist for those.

## Open questions (deferred)

- **Schema portability vs Postgres-specific features** — resolved: use Postgres-specific features (advisory locks, pg_cron, RLS) when they're load-bearing. Migration plan accepts a Postgres-to-Postgres move (Aurora, RDS, Crunchy Bridge); never assume migration to a non-Postgres DB.
- **Re-evaluate this ADR every 12 months** — calendar item: 2027-05-08 review (next slice-4 cadence).
