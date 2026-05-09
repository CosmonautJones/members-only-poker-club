# ADR-0034: Timestamp storage in UTC; presentation in club-local time

- **Status:** Stub
- **Date:** 2026-05-09
- **Slice:** 1

## Context

Timestamps cross many boundaries in this app:

- **Auth (ADR-0002):** session issued/expires_at, last login.
- **Money (ADR-0004):** subscription period start/end, charge timestamps from Stripe.
- **Audit (ADR-0006):** `created_at` on every audit_log row — relied on for "who-did-what-when" reconstruction during disputes.
- **Time-bank (ADR-0011):** deposits, redemptions, expirations driven by absolute moments.
- **Tournament (ADR-0012):** scheduled start times displayed to members in their local context.

Texas operates on America/Chicago. The club's physical sessions, tournament starts, alcohol-service windows (ADR-0033 BYOB), and "today's redemptions" reports are all club-local concepts. Members may travel; their browser may report any timezone.

There is currently no written policy on:
1. What timezone gets persisted to Postgres.
2. How displayed timestamps are localized.
3. How audit log entries are reconstructed across DST transitions (Texas observes DST; the audit log spans those transitions).

The risk: ad-hoc handling drifts. One feature stores `now()` in club-local; another in UTC; an aggregation joins them and silently loses an hour twice a year.

## Direction

Persist all timestamps as `timestamptz` with values stored in UTC. The `timestamptz` type stores UTC internally regardless of the session timezone, so this is enforced by Postgres. The presentation layer (server components, API responses, emails, audit log viewer) converts to America/Chicago for display unless a member-specific override applies. The audit log displays both UTC and America/Chicago side-by-side to make DST transitions unambiguous during incident reconstruction.

## Consequences

To be drafted in Slice 1.

## Alternatives considered

To be drafted in Slice 1.
