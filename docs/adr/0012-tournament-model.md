# ADR-0012: Tournament model

- **Status:** Stub
- **Date:** 2026-05-04
- **Slice:** 1 (read-only listing) → 3 (registration with Stripe entry fees)

## Context

Members register online for tournaments (e.g., Friday Bounty, Tuesday Bounty). The tournament listing is public; registration requires sign-in. Some tournaments charge a buy-in (entry fee paid via Stripe one-time PaymentIntent).

The tournament *runs* in TableCaptain — blind levels, eliminations, payouts are tracked there, not here. Our system handles only the lobby: name, date, time, capacity, buy-in, who's registered, who's waitlisted.

## Decision

To be drafted in Slice 1 (read-only) and Slice 3 (write-side). Direction:

- `tournaments` table with name, slug, starts_at, buy_in_cents, structure_md (markdown describing blind levels and rules), capacity, status enum (`scheduled | registering | live | complete | canceled`).
- `tournament_regs` join table with profile_id, status (`registered | waitlisted | canceled | no_show`), payment_id (nullable for free events).
- Public list view: `/games` shows scheduled and registering tournaments.
- Public detail view: `/games/[slug]` shows structure and registration count.
- Member registration flow: `/games/[slug]/register` → if buy-in > 0, redirect to Stripe Checkout; on success, create `tournament_regs` row.
- Capacity enforcement: registration count `< capacity` → `registered`; otherwise `waitlisted`.
- No-show penalty (if any): TBD with owner.
- Cancellation: members can cancel up to 1 hour before start; refund issued automatically (Stripe).
- Manager creates and edits tournaments via `/admin/tournaments`.

## Open questions

- Re-entry support? Most tournaments are single-entry, some allow re-buy. Out of v1 scope; manage in TableCaptain.
- House charge / club share of buy-in? In TX, the club cannot take a rake. Buy-in collection has to be 100% returned to players via the prize pool. Counsel to confirm — likely the club can charge a separate, fixed seat fee at the tournament.
- Tournament reminders via SMS (1hr before, T-15min, etc.) — Slice 3 if A2P 10DLC ready.
- Public leaderboard / past results — Slice 4+.

## Alternatives to consider

- Defer all tournament functionality to Phase 2 — owner explicitly requested in v1, so no.
- Accept registrations only at the door — loses online conversion, rejected.
