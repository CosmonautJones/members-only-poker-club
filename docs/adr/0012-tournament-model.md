# ADR-0012: Tournament model

- **Status:** Accepted
- **Date:** 2026-05-04
- **Ratified:** 2026-05-08
- **Slice:** 1 (read-only listing) → 3 (registration with Stripe entry fees)
- **Schedule + admin-edit layer:** implemented by [ADR-0037](0037-tournament-schedule.md) (Proposed 2026-05-23). ADR-0037 ships the `tournaments` table, the admin schedule editor at `/admin/tournaments`, and pulls forward the `tz_name` column from ADR-0034's deferred set. `tournament_regs` (registration) remains Slice 3 work, gated on Stripe live keys.

## Context

Members register online for tournaments (e.g., Friday Bounty, Tuesday Bounty). The tournament listing is public; registration requires sign-in. Some tournaments charge a buy-in (entry fee paid via Stripe one-time PaymentIntent).

The tournament *runs* in TableCaptain — blind levels, eliminations, payouts are tracked there, not here. Our system handles only the lobby: name, date, time, capacity, buy-in, who's registered, who's waitlisted.

## Decision

- `tournaments` table with name, slug, starts_at, buy_in_cents, structure_md (markdown describing blind levels and rules), capacity, status enum (`scheduled | registering | live | complete | canceled`).
- `tournament_regs` join table with profile_id, status (`registered | waitlisted | canceled | no_show`), payment_id (nullable for free events).
- Public list view: `/games` shows scheduled and registering tournaments.
- Public detail view: `/games/[slug]` shows structure and registration count.
- Member registration flow: `/games/[slug]/register` → if buy-in > 0, redirect to Stripe Checkout; on success, create `tournament_regs` row.
- Capacity enforcement: registration count `< capacity` → `registered`; otherwise `waitlisted`.
- No-show penalty (if any): TBD with owner.
- Cancellation: members can cancel up to 1 hour before start; refund issued automatically (Stripe).
- Manager creates and edits tournaments via `/admin/tournaments`.

## Open questions (deferred — owner / counsel)

- **Re-entry support** — out of v1 scope; managed in TableCaptain. v1 schema supports a single registration per profile per tournament.
- **House charge / club share of buy-in** — counsel-pending (TX rake prohibition). Default v1: buy-in 100% to prize pool; separate `seat_fee_cents` column on `tournaments` for the legal seat fee. Counsel to confirm the structure pre-launch.
- **Tournament SMS reminders (1hr / T-15min)** — Slice 3 if A2P 10DLC registration completes in time. Tracked as a follow-up; ADR-0025 holds the SMS infrastructure decisions.
- **Public leaderboard / past results** — Slice 4+. Tracked for post-launch backlog; not load-bearing for ratification.

## Alternatives considered (not chosen)

- **Defer all tournament functionality to Phase 2** — rejected. Owner explicitly requested in v1.
- **Accept registrations only at the door** — rejected. Loses online conversion and complicates capacity tracking.
