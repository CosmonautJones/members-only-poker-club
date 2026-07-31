# ADR-0037 Implementation Spec — Tournament schedule

- **ADR:** [0037](../adr/0037-tournament-schedule.md)
- **Date:** 2026-05-23
- **Slice:** 1
- **Status:** Draft
- **Feature flag:** `TOURNAMENT_SCHEDULE_LIVE` (off in prod until verified; permanent kill-switch)
- **Implements:** [ADR-0012](../adr/0012-tournament-model.md) schedule + admin-edit layer; ships [ADR-0034](../adr/0034-timestamp-and-timezone-policy.md) deferred `tz_name` column.

## Scope

Slice 1: **tournament schedule** (weekly recurring templates + materialized instances + admin editor + live `/games` rendering). Cash-game live state (ADR-0038) and private events (ADR-0039) are out of scope. `tournament_regs` (member registration) is ADR-0012's Slice 3 work, deferred until Stripe live keys unblock.

## Existing code being replaced

| Surface | What it does today | Replaced by |
|---|---|---|
| `lib/tournaments/fixtures.ts` | Hardcoded `TOURNAMENTS` array (2 entries) feeding `/games/[slug]` | `tournaments` table |
| `app/(marketing)/games/page.tsx` `SCHEDULE` const | Hardcoded weekly tournament rhythm (5 entries) | Live read from `tournaments` |
| `app/(marketing)/games/[slug]/page.tsx` `findTournamentBySlug` | Lookup from fixtures | Query `tournaments` by slug |
| `lib/tournaments/types.ts` `Tournament` interface | Shared type | Stays; widened to match new schema |

The `STAKES` constant in `/games/page.tsx` is **out of scope** (cash-game content, future slice).

`lib/tournaments/fixtures.ts` and the `SCHEDULE` constant are deleted in this slice. A small 4-line fallback array stays in `/games/page.tsx` purely as the flag-off branch (visible only when `TOURNAMENT_SCHEDULE_LIVE` is `false`).

## Database schema

### `tournament_templates`

```sql
create table tournament_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug_prefix text not null,                       -- 'tuesday-bounty' → instance slug 'tuesday-bounty-2026-06-09'
  day_of_week int not null check (day_of_week between 0 and 6),  -- 0=Sunday, ISO style
  time_of_day_local time not null,                  -- e.g. '19:00:00'
  tz_name text not null default 'America/Chicago',  -- IANA zone the time_of_day_local is expressed in
  buy_in_cents integer not null check (buy_in_cents >= 0),
  capacity integer not null check (capacity > 0),
  game_type text not null check (game_type in ('nlhe','plo','mixed','other')),
  structure_md text,                                -- markdown describing blind levels and rules (per ADR-0012)
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tournament_templates_active_idx on tournament_templates(active) where active;
create unique index tournament_templates_slug_prefix_idx on tournament_templates(slug_prefix);
```

### `tournaments`

Per ADR-0012, plus `tz_name` (ADR-0034) and `source_template_id` (ADR-0037).

```sql
create table tournaments (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  starts_at timestamptz not null,                    -- wall-clock-intent (per ADR-0034 §category split)
  tz_name text not null default 'America/Chicago',   -- IANA zone in which starts_at was scheduled (ADR-0034)
  buy_in_cents integer not null check (buy_in_cents >= 0),
  capacity integer not null check (capacity > 0),
  game_type text not null check (game_type in ('nlhe','plo','mixed','other')),
  structure_md text,
  status text not null default 'scheduled'
    check (status in ('scheduled','registering','live','complete','canceled')),
  source_template_id uuid references tournament_templates(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index tournaments_slug_idx on tournaments(slug);
create index tournaments_starts_at_idx on tournaments(starts_at);
create index tournaments_scheduled_starts_at_idx on tournaments(starts_at) where status = 'scheduled';
-- Idempotency: one instance per (template, club-local date). Materializer relies on this.
create unique index tournaments_template_date_idx
  on tournaments(source_template_id, (date(starts_at at time zone tz_name)))
  where source_template_id is not null;
```

Slice 1 uses only `scheduled | canceled | complete`. `registering` and `live` activate when ADR-0012 Slice 3 ships.

### `updated_at` triggers

Both tables use the existing `set_updated_at()` trigger pattern from ADR-0018.

### RLS policies (per ADR-0003)

```sql
-- tournaments
alter table tournaments enable row level security;
alter table tournaments force row level security;

create policy "tournaments_select_public" on tournaments
  for select using (true);

create policy "tournaments_write_admin" on tournaments
  for all using (role_at_least('admin'))
  with check (role_at_least('admin'));

-- tournament_templates
alter table tournament_templates enable row level security;
alter table tournament_templates force row level security;

create policy "tournament_templates_admin_only" on tournament_templates
  for all using (role_at_least('admin'))
  with check (role_at_least('admin'));
```

The cron generator uses the service-role key, which bypasses RLS by design.

## Materializer

**Route:** `app/api/cron/tournament-materialize/route.ts` (Vercel Cron, nightly 03:00 America/Chicago).

**Algorithm:**

```
for each template where active = true:
  for d in range(today, today + 60 days):
    if d.day_of_week != template.day_of_week: continue
    try:
      local = combine(d, template.time_of_day_local)        // ZonedDateTime in template.tz_name
      utc   = local.toUtc()                                 // throws on non-existent local (spring-forward gap)
      // Round-trip check to detect DST-gap: if utcToZoned(utc) != local, the local time didn't exist.
    catch NonExistentLocalTime | round_trip_mismatch:
      log({event: 'tournament_materialize_skip', template_id, date: d, reason: 'dst_spring_forward'})
      continue
    insert into tournaments
      (slug, name, starts_at, tz_name, buy_in_cents, capacity, game_type, structure_md, source_template_id)
      values
      (template.slug_prefix || '-' || iso(d), template.name, utc, template.tz_name,
       template.buy_in_cents, template.capacity, template.game_type, template.structure_md, template.id)
      on conflict (source_template_id, date(starts_at at time zone tz_name)) do nothing
audit one row: {action: 'tournament.materialize_run', summary: {created: N, skipped: M, errors: K, templates_processed: T}}
```

**Library:** `date-fns-tz` (already in the dep graph from ADR-0034 work). Use `zonedTimeToUtc(local, tz_name)`. Detect DST-gap by round-tripping: if `utcToZonedTime(zonedTimeToUtc(local, zone), zone)` doesn't match the original `local`, the local time was in a DST spring-forward gap — skip.

**Idempotency:** the partial unique index `tournaments_template_date_idx` enforces "one instance per (template, club-local date)". Re-running is a no-op for already-materialized rows.

**Authorization:** Vercel Cron header `Authorization: Bearer ${CRON_SECRET}` verified in the route handler (per ADR-0007 secrets management).

**Monitoring:** structured log on every run (`event: 'tournament_materialize_run'`); ADR-0015 alert rule fires if no successful run in 36h.

## Admin UI — `/admin/tournaments`

Sibling route under the ADR-0035 admin console IA. `manager+` role gate via `requireRole('manager')` in the page RSC (defense in depth on top of middleware).

**Tabs:**

1. **Templates** — list + form. Columns: name, day_of_week, time_of_day_local, tz_name, buy_in, capacity, active. Actions: create, edit, deactivate (no hard delete; admins set `active = false`). Form validation: `buy_in_cents` ≥ 0, `capacity` > 0, `day_of_week` 0–6, `time_of_day_local` HH:MM, `slug_prefix` matches `[a-z0-9-]+` and is unique.
2. **Next 30 days** — calendar-grouped list of instances. Each row: date, name, time (rendered club-local + UTC per ADR-0034), buy-in, status, edit / cancel / delete. Admins can hard-delete one-off instances (`source_template_id is null`); template-sourced instances must be cancelled (`status = 'canceled'`), not deleted — preserves audit trail and prevents the materializer from immediately re-creating the row on next run.

**Server actions** (`app/admin/tournaments/actions.ts`):

- `createTemplate(input)`
- `updateTemplate(id, input)`
- `deactivateTemplate(id)` — sets `active = false`, audits
- `createOneOffTournament(input)` — direct insert with `source_template_id = null`
- `updateTournament(id, input)`
- `cancelTournament(id)` — sets `status = 'canceled'`
- `deleteTournament(id)` — only allowed where `source_template_id is null`; returns error otherwise

Every action wraps `withAudit` (ADR-0006). Every write that affects /games calls `revalidatePath('/games')`.

## `/games` rendering

```tsx
// app/(marketing)/games/page.tsx
export const revalidate = 600;

export default async function GamesPage() {
  const flag = await isFlagEnabled('TOURNAMENT_SCHEDULE_LIVE');
  const tournaments = flag
    ? await fetchUpcomingTournaments({ days: 30 }).catch((err) => {
        captureException(err);
        return null;
      })
    : null;
  // tournaments === null  → render fallback message (flag off OR query error with flag on)
  // tournaments === []    → render "no tournaments scheduled in the next 30 days"
  // tournaments.length > 0 → render real schedule
  return <GamesPageView tournaments={tournaments} />;
}
```

`fetchUpcomingTournaments({ days })` queries `tournaments where starts_at between now() and now() + interval days and status = 'scheduled' order by starts_at`. Returns `Tournament[]` with computed `starts_at_club_local` derived per-row via `formatInZone(starts_at, tz_name)` (ADR-0034 helper).

**Fallback view** (when `tournaments === null`):

> "Our live schedule is loading from the new system. Refresh in a moment, or call the floor at `{NAP.telephone}` for tonight's lineup."

Phone sourced from `lib/content/nap.ts` (single source of truth). No silent stale data. No copy-pasted hardcoded schedule.

## `/games/[slug]` rendering

```tsx
const tournament = await fetchTournamentBySlug(slug);
if (!tournament || tournament.status === 'canceled') notFound();
```

`fetchTournamentBySlug` is the only entry point to a tournament's SEO page. Canceled instances 404 — they should not appear in search results. JSON-LD `Event` schema rendered with `starts_at` + `tz_name` per ADR-0034's wall-clock-intent rules.

## Migration

Single migration file: `supabase/migrations/<ts>_tournament_schedule.sql`. Contents:

1. Create `tournament_templates` and `tournaments` tables (DDL above)
2. Create indexes
3. Enable + force RLS, install policies
4. Install `set_updated_at` trigger on both tables
5. Seed initial templates from the values currently in `lib/tournaments/fixtures.ts` + the `SCHEDULE` constant in `/games/page.tsx` — 4 rows: **Tuesday Bounty** ($150, 7:00 PM, capacity 40, slug_prefix `tuesday-bounty`), **Thursday Ladies Night** ($125, 7:00 PM, capacity 40, slug_prefix `thursday-ladies-night`), **Friday Nightly** ($250, 7:30 PM, capacity 120, slug_prefix `friday-nightly`), **Saturday Deepstack** ($400, 3:00 PM, capacity 60, slug_prefix `saturday-deepstack`). *No Sunday template — Sunday is cash-only per existing copy.* Buy-ins stored in cents. All templates use `tz_name = 'America/Chicago'`.

The migration does **not** materialize instances — the first cron run does that. The cron route should be hit manually post-deploy to seed the first 60 days before flipping the flag on (see Feature flag procedure below).

## Feature flag

`TOURNAMENT_SCHEDULE_LIVE` registered in the `feature_flags` table (ADR-0020). Default value `false` in all environments at migration time.

**Flip-on procedure:**
1. Deploy slice.
2. Run materializer manually: `curl -H "Authorization: Bearer $CRON_SECRET" $HOST/api/cron/tournament-materialize`.
3. Verify: `select count(*) from tournaments where status = 'scheduled' and starts_at > now()` returns ≥1 row per active template.
4. Flip flag to `true` in staging via `/admin/flags`. Confirm `/games` renders DB data.
5. Flip flag in prod.

**Kill-switch:** flip flag to `false` at any time — `/games` immediately reverts to the static fallback array. Confirmed by `tests/pages/games-page.test.tsx`.

## Audit (per ADR-0006)

Standard `withAudit` wrapper on every admin server action. Actions:
- `tournament_template.create | update | deactivate`
- `tournament.create_oneoff | update | cancel | delete`
- `tournament.materialize_run` (one row per cron execution; per-row is not audited to avoid log flood)

`target_id` is the `tournaments.id` or `tournament_templates.id`. `before` / `after` are JSON snapshots of the row.

## Tests (acceptance contract)

**RLS:**
- `tests/db/tournaments-rls.test.ts` — anon SELECT works; anon write blocked; admin writes succeed; templates admin-only on read AND write.

**Materializer:**
- `tests/api/tournament-materialize.test.ts` — idempotent re-run produces zero new rows; respects `active = false`; respects `source_template_id + date` unique constraint.
- `tests/api/tournament-materialize-dst.test.ts` — spring-forward instance (e.g., 2026-03-08 02:30 America/Chicago) is skipped with structured log; fall-back instance materializes correctly (no double-creation on the repeated hour).
- `tests/api/tournament-materialize-auth.test.ts` — cron route rejects requests without `Authorization: Bearer ${CRON_SECRET}`.

**`/games`:**
- `tests/pages/games-page.test.tsx` — flag off renders static fallback; flag on with rows renders DB data; flag on with empty result renders "no upcoming"; flag on with query error renders fallback message + emits Sentry capture.

**`/games/[slug]`:**
- `tests/pages/games-slug.test.tsx` — known slug renders tournament; unknown slug 404s; canceled status 404s.

**Admin UI:**
- `tests/admin/tournaments.test.tsx` — template CRUD round-trip; instance edit/cancel; delete-one-off allowed; delete-template-sourced rejected; audit row written per mutation.

**Audit:**
- `tests/db/tournaments-audit.test.ts` — server actions emit correct audit rows; materializer emits exactly one audit row per run.

**Backstop grep** (per existing CI gate):
- After deletion, no source file outside the migration imports from `lib/tournaments/fixtures` (the file itself is deleted, but the backstop also catches stale references).

## Build sequence

| Step | What | Verifier |
|---|---|---|
| 1 | Migration: tables + indexes + RLS + triggers + seed templates | `pnpm db:test`; `tests/db/tournaments-rls.test.ts` |
| 2 | `lib/tournaments/queries.ts`: `fetchUpcomingTournaments`, `fetchTournamentBySlug` | unit tests |
| 3 | Cron route + materializer logic + auth | `tests/api/tournament-materialize*.test.ts` |
| 4 | `/games` flag-aware rewrite + `/games/[slug]` rewrite + fallback UI | `tests/pages/games*.test.tsx`; Lighthouse |
| 5 | `/admin/tournaments` page + server actions + form components | `tests/admin/tournaments.test.tsx` |
| 6 | Register `TOURNAMENT_SCHEDULE_LIVE` flag; delete `lib/tournaments/fixtures.ts` and `SCHEDULE` const | backstop grep test |
| 7 | E2E: admin creates template → manual materialize hit → `/games` shows new tournament → admin cancels → `/games` no longer shows it | Playwright |

Each step is independently shippable in a sub-slice if needed; steps 1–6 are ordered by data dependency.

## Out of scope (not built in slice 1)

- `tournament_regs` member registration (deferred to ADR-0012 Slice 3, gated on Stripe live keys)
- `/games/[slug]/register` flow (same)
- Cash-game live state (deferred to ADR-0038)
- Private events (deferred to ADR-0039)
- Tournament results / completed-tournament archive
- Calendar export (.ics)
- Leaderboard / season points
- Bulk template-to-instance sync action ("apply this template change to all unedited future instances")
- Auto-completion (instance status flipping to `'complete'` post-event)
- PokerAtlas data-source integration (separate brainstorm; this work is its fallback layer)
