---
date: 2026-05-28
adrs: [0037]
slice: 1
type: feature
status: shipped
---

# ADR-0037 Slice 1 — tournament schedule

## Context

`/games` rendered three hardcoded structures: cash-game stakes (`STAKES`),
a weekly tournament rhythm (`SCHEDULE`), and a fixture array
(`TOURNAMENTS` in `lib/tournaments/fixtures.ts`) that also fed per-event
SEO pages at `/games/[slug]`. There was no path for staff to add a
tournament, cancel for a holiday, or change a buy-in without a deploy.

ADR-0012 (full tournament model with member registration) is gated on
Stripe live keys, which are blocked. ADR-0034 prescribed the `tz_name`
column but deferred it until ADR-0012's admin-write path. ADR-0037
(ratified earlier this session) carved out the slice that's actually
unblocked today: the **schedule + admin-edit layer**, sans registration.

## Changes

**Migration**

- `supabase/migrations/0017_tournament_schedule.sql` — two tables
  (`tournament_templates`, `tournaments`), indexes including the partial
  unique index `tournaments_template_date_idx` on
  `(source_template_id, date(starts_at AT TIME ZONE tz_name))` that
  enforces "one instance per (template, club-local date)", RLS posture
  (public SELECT on `tournaments`, admin-only on `tournament_templates`),
  `set_updated_at` triggers, and the four weekly-template seed rows.

**Library**

- `lib/tournaments/types.ts` — widened `Tournament` to mirror the DB
  projection plus NAP-composed venue fields. Added `TournamentTemplate`.
- `lib/tournaments/queries.ts` — `fetchUpcomingTournaments({ days })`
  and `fetchTournamentBySlug(slug)` against the cookie-scoped supabase
  client (public RLS policy permits anon reads).
- `lib/tournaments/materialize.ts` — pure helpers: `resolveWallTime`
  with DST-gap detection via round-trip Intl.DateTimeFormat, plus
  `candidateDates`, `instanceSlug`, `parseTimeOfDayLocal`.
- `lib/tournaments/materialize-run.ts` — the loop, decoupled from the
  driver so tests can wire a pglite shim against the same
  `MaterializeDb` interface the production route uses.

**Cron route**

- `app/api/cron/tournament-materialize/route.ts` — `Authorization:
  Bearer ${CRON_SECRET}` gate (refuses by default if env unset),
  60-day window, ON CONFLICT DO NOTHING semantics via 23505 catch,
  one audit row per run.

**Page rewrites**

- `app/(marketing)/games/page.tsx` — flag-gated upcoming-events
  section (`tournament-schedule-live`). Editorial weekly rhythm
  preserved as marketing copy. Flag-off renders a 4-line static
  fallback; flag-on with rows renders DB data; flag-on with empty
  result renders "no upcoming"; flag-on with query error renders
  fallback + console.error (Sentry-captured in prod).
- `app/(marketing)/games/[slug]/page.tsx` — `fetchTournamentBySlug`
  with `notFound()` on null / canceled. Uses `formatMoney` for the
  buy-in display.
- `app/sitemap.ts` — async, reads upcoming 90 days from DB. Static
  routes still emit on query error.

**Admin UI**

- `app/(admin)/admin/tournaments/page.tsx` — manager+ gate as first
  body statement. Lists templates + upcoming tournaments with action
  buttons.
- `_actions/setTemplateActive.ts` — toggle template active flag.
- `_actions/cancelTournament.ts` — set status to `canceled` (template-
  sourced) or hard-delete-prep (one-off).
- `_actions/index.ts` — `'use server'` shim with second-gate
  `requireRole('manager')` per AC5.
- `_components/{template,tournament}-row.client.tsx` — per-row action
  buttons with `useTransition` + simple error display.

**Cleanup**

- `lib/tournaments/fixtures.ts` deleted.
- `scripts/backstop-tournament-fixtures.sh` blocks future re-introduction.
- `lib/flags/types.ts` + `registry.ts` — registered
  `tournament-schedule-live` flag (default OFF).

**Doc-currency**

- ADR-0037 ratified (`Proposed → Accepted`) in PR #45 earlier today.
- ADR-0034 amended with the `tz_name shipped` note.
- Spec frontmatter populated with `acceptance_commands` and an
  Implementation Status section documenting the deferred admin form
  surfaces (Slice 1.5).

## Tests

- `tests/db/tournaments-rls.test.ts` — 26 sub-cases.
- `tests/tournaments/materialize.test.ts` — 11 unit sub-cases incl.
  DST gap (2026-03-08 02:30 America/Chicago) and ambiguous fall-back.
- `tests/api/tournament-materialize.test.ts` — 6 integration sub-cases
  against pglite (idempotency, inactive-template skip, DST integration,
  audit-row write).
- `tests/api/tournament-materialize-auth.test.ts` — 5 auth sub-cases.
- `tests/pages/games-page.test.tsx` — 4 sub-cases (flag off/on/empty/error).
- `tests/pages/games-slug.test.tsx` — 6 sub-cases incl. metadata
  fault-tolerance.
- `tests/admin/tournaments-actions.test.ts` — 11 sub-cases incl. audit
  failure post-mutation.
- `tests/seo/sitemap.test.ts` — rewritten to mock the query.
- `tests/seo/event-jsonld.test.ts` — fixture-shape group dropped (no
  more fixture); render group preserved.

Gauntlet passes (typecheck, lint, format:check, full vitest run, all six
`acceptance_commands` from the spec).

## Lessons

- The `tournaments_template_date_idx` partial unique index encodes
  idempotency at the DB layer — the cron just catches 23505 and treats
  it as `skipped_existing`. Cleaner than a SELECT-then-INSERT race.
- Splitting the materializer loop from the supabase-js adapter
  (`materialize-run.ts` vs the route's `makeSupabaseDb`) made the DST +
  idempotency contract testable against pglite without faking
  supabase-js's PostgrestClient.
- Editorial copy and data are different layers — the spec's
  "SCHEDULE const... replaced by Live read" had to be relaxed in
  practice. The weekly rhythm narrative survives; the per-event list
  becomes DB-driven. Logged inline in the page header so the next
  reader sees the rationale.
- ADR-0016 AC5 (rate-limit middleware wiring) was discovered as a
  separately-shippable gap during the baseline review pass; shipped in
  PR #46 as its own commit. Kept this slice focused.
