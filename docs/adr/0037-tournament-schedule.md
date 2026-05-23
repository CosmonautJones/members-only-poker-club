# ADR-0037: Tournament schedule — admin-edited live data on /games

- **Status:** Proposed
- **Date:** 2026-05-23
- **Slice:** 1
- **Implements:** the schedule + admin-edit layer of [ADR-0012](0012-tournament-model.md); pulls forward the `tz_name` column from [ADR-0034](0034-timestamp-and-timezone-policy.md)'s deferral.
- **Defers:** `tournament_regs` (member registration with Stripe entry fees) to ADR-0012's Slice 3, gated on Stripe live keys.

> Replace the hardcoded `lib/tournaments/fixtures` + `SCHEDULE` constant on `/games` with an admin-edited tournament schedule stored in Supabase. Implements the `tournaments` table from ADR-0012 plus a new `tournament_templates` table for recurring rules. Feature-flagged kill-switch (`TOURNAMENT_SCHEDULE_LIVE`) preserves the static board path until the live system is verified.

## Context

The `/games` marketing page currently renders three hardcoded structures: cash-game stakes (`STAKES`), a weekly tournament rhythm (`SCHEDULE`), and a fixture list (`TOURNAMENTS` from `lib/tournaments/fixtures.ts`) that also feeds per-event SEO pages at `/games/[slug]`. There is no path for staff to add a new tournament, cancel for a holiday, or change a buy-in without a code change and deploy.

ADR-0012 (Tournament model) ratified the canonical schema — `tournaments` table + `tournament_regs` join table + `/admin/tournaments` UI — but is gated on Stripe live keys (for entry-fee charging) and on the PokerAtlas TableCaptain integration (ADR-0013) for live tournament state. Neither unblocker is owner-actioned today.

ADR-0034 (Timestamp policy) classified `tournaments.starts_at` as **wall-clock-intent** and prescribed a companion `tz_name` column landing alongside ADR-0012's admin write path. ADR-0034 explicitly states: *"the admin schedule UI does not ship before that column"*. ADR-0037 ships that column.

The pragmatic path is to implement ADR-0012's **read + schedule + admin-edit layer** now, deferring `tournament_regs` (registration) to a future slice when Stripe live keys unblock. Adding the recurring-template machinery (`tournament_templates`) is the small extension that lets staff manage the weekly rhythm without re-entering each Tuesday tournament every week.

## Decision

**We will implement ADR-0012's `tournaments` table + `/admin/tournaments` schedule editor, add a new `tournament_templates` table for weekly recurrence, ship the `tournaments.tz_name` column from ADR-0034's deferred set, and feature-flag the live-data path on `/games` with `TOURNAMENT_SCHEDULE_LIVE`.**

Schema:
- `tournaments` (per ADR-0012, plus `tz_name` per ADR-0034, plus `source_template_id` referencing `tournament_templates`)
- `tournament_templates` (new; recurring weekly rules)

`/api/cron/tournament-materialize` runs nightly, materializing the next 60 days of instances from active templates idempotently. DST spring-forward gap (non-existent local time) is detected and skipped with a structured log; admin resolves via the override UI.

Admin edits and cancels individual instance rows. **Template edits only affect instances materialized *after* the edit** — existing instances are immutable from the template's perspective. One-off tournaments are inserted directly into `tournaments` with `source_template_id = null`.

`/games` reads from `tournaments` when the flag is on; otherwise renders the existing static board (preserved as a flag-off branch). On query error with flag on, renders an explicit "schedule loading" fallback + Sentry capture. **No silent fallback to stale data.** Per-instance `slug` keeps `/games/[slug]` permalinks stable. Caching: `revalidate: 600` + `revalidatePath('/games')` on every admin write.

Admin UI lives at `/admin/tournaments` (per ADR-0012's IA), gated `manager+` per the role ladder. Two tabs: **Templates** (CRUD recurring rules) and **Next 30 days** (CRUD instances). Every write audited via `withAudit` (ADR-0006). Materializer audits one row per run, not per instance.

`tournament_regs` (member registration) and the `/games/[slug]/register` flow are explicitly **deferred** to ADR-0012's Slice 3, gated on Stripe live keys.

This ADR scopes **tournaments only**. Cash-game live state (ADR-0038, not yet written) and private events (ADR-0039, not yet written) are deliberately deferred until tournaments are in production and we know what we actually need.

## Consequences

**Gain:**
- Staff edit the tournament schedule without a deploy.
- `/games` shows real upcoming dates, not "every Tuesday" copy.
- ADR-0012's `tournaments` table exists in production; Slice 3 registration work plugs into it directly when Stripe unblocks.
- ADR-0034's `tz_name` column lands; future timestamp work no longer blocked by its absence.
- Per-instance audit trail on every cancellation, buy-in change, and rename.

**Accept:**
- New cron job (materializer) becomes a SPOF for `/games` content. Mitigation: feature flag is the kill-switch; static board path stays in `/games/page.tsx` as flag-off branch; structured log per run + ADR-0015 alert if no successful run in 36h.
- DST seam edge case: spring-forward creates a non-existent club-local time. Materializer skips that single instance with structured log; admin resolves via override UI. Documented; not silently corrupted.
- Concurrent admin edits use last-write-wins. Solo-admin reality makes this acceptable; documented as a constraint.
- `lib/tournaments/fixtures.ts` and the hardcoded `SCHEDULE` constant are deleted in this same PR — the feature flag, not the file, is the fallback path. Avoids two stale files.
- The full `tournaments.status` enum from ADR-0012 (`scheduled | registering | live | complete | canceled`) is created at schema time; only `scheduled | canceled | complete` are used in slice 1. The remaining values activate when ADR-0012 Slice 3 ships.

## Alternatives considered

- **Rules + exceptions storage (computed on demand).** Tournament dates computed at query time from active templates minus skip exceptions plus replace overrides. Rejected: more elegant on paper, but admin and query mental models both have to reason about "what does this date look like after applying exceptions" — harder to debug and to audit per-instance.
- **All three event types in one ADR/slice.** Tournaments, cash-game live state, and private events ship together. Rejected: couples three different UI patterns and update cadences in one PR.
- **Scrape PokerAtlas now.** Brainstorm exists (2026-05-22) but is blocked on owner-actions and ToS review. Even if unblocked, produces the same data shape as this ADR — this work is the natural fallback layer of that eventual integration.
- **Defer until ADR-0012 fully ratifies (with Stripe + TableCaptain).** Indefinite wait on external unblocks. Rejected.
- **Build the schedule editor without the `tz_name` column.** Violates ADR-0034's explicit prescription. Rejected.

## Successor / related ADRs

- ADR-0012 (Accepted): Full tournament model. ADR-0037 implements its schedule + admin-edit layer; registration (`tournament_regs`) and the `/games/[slug]/register` flow remain ADR-0012 Slice 3, gated on Stripe live keys.
- ADR-0034 (Accepted): Timestamp policy. ADR-0037 ships the deferred `tz_name` column on `tournaments`.
- ADR-0035 (Accepted): Admin Operations Console. `/admin/tournaments` is a sibling route under that console's IA.
- ADR-0038 (planned): Cash-game live state — the "what's running right now" panel on `/games`.
- ADR-0039 (planned): Private events — member-portal listing for member-only games.

## Spec

Implementation detail: [`docs/specs/0037-tournament-schedule-implementation.md`](../specs/0037-tournament-schedule-implementation.md).
