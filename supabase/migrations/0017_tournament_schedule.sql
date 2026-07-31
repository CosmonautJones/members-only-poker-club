-- ADR-0037: Tournament schedule — admin-edited live data on /games (Slice 1).
-- Spec: docs/specs/0037-tournament-schedule-implementation.md.
-- Implements: ADR-0012 schedule + admin-edit layer; ships ADR-0034's
-- deferred `tz_name` column on tournament instances.
--
-- Scope: schema substrate only — two tables (tournament_templates, tournaments),
-- indexes, RLS posture (enable + force + policies), updated_at triggers, and a
-- seed of the four current weekly templates from `lib/tournaments/fixtures.ts`
-- + the `SCHEDULE` constant in `app/(marketing)/games/page.tsx`.
--
-- migration-review: blocking-index-approved
-- Justification: tournament_templates AND tournaments are CREATEd EMPTY in
-- this same migration. CREATE INDEX on empty, newly-created tables acquires
-- the lock for microseconds and has no production traffic to block.
-- CONCURRENTLY is not an option because Supabase wraps each migration file in
-- a single transaction and CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction. Same posture as 0003, 0005, 0008.
--
-- Why `auth.role_at_least(...)` (not `public.role_at_least(...)`): in-repo
-- convention, see 0005_privacy_requests.sql, 0006_feature_flags_rls.sql,
-- 0016_payments_rls.sql. Hosted prod has a `public.role_at_least` variant —
-- known drift per `memory/project_supabase_hosted_drift.md`.

-- =============================================================================
-- 1. tournament_templates — recurring weekly tournament rules
-- =============================================================================

CREATE TABLE tournament_templates (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT         NOT NULL,
    slug_prefix         TEXT         NOT NULL,
    day_of_week         INTEGER      NOT NULL,                  -- 0=Sunday..6=Saturday
    time_of_day_local   TIME         NOT NULL,                  -- e.g. '19:00:00'
    tz_name             TEXT         NOT NULL DEFAULT 'America/Chicago',
    buy_in_cents        INTEGER      NOT NULL,
    capacity            INTEGER      NOT NULL,
    game_type           TEXT         NOT NULL,
    structure_md        TEXT         NULL,
    active              BOOLEAN      NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT tournament_templates_day_of_week_range
        CHECK (day_of_week BETWEEN 0 AND 6),
    CONSTRAINT tournament_templates_buy_in_nonneg
        CHECK (buy_in_cents >= 0),
    CONSTRAINT tournament_templates_capacity_positive
        CHECK (capacity > 0),
    CONSTRAINT tournament_templates_game_type_values
        CHECK (game_type IN ('nlhe', 'plo', 'mixed', 'other')),
    CONSTRAINT tournament_templates_slug_prefix_format
        CHECK (slug_prefix ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

COMMENT ON TABLE tournament_templates IS
    'Per ADR-0037. Recurring weekly tournament rules. Materializer reads active=true '
    'rows nightly and inserts tournaments rows for the next 60 days idempotently. '
    'Template edits only affect instances materialized AFTER the edit — existing '
    'instances are immutable from the template''s perspective.';

COMMENT ON COLUMN tournament_templates.slug_prefix IS
    'kebab-case prefix; materializer composes "<slug_prefix>-<YYYY-MM-DD>" as the '
    'per-instance slug. Unique across templates.';
COMMENT ON COLUMN tournament_templates.tz_name IS
    'IANA zone in which time_of_day_local is expressed. ADR-0034 wall-clock-intent: '
    'storing tz_name alongside the time means DST transitions and zone moves stay '
    'lossless (rather than degrading to a stale fixed offset).';
COMMENT ON COLUMN tournament_templates.active IS
    'Soft-delete switch. Admins flip this to false to retire a template without '
    'losing audit history. The materializer skips inactive templates.';

CREATE INDEX tournament_templates_active_idx
    ON tournament_templates (active)
    WHERE active;

CREATE UNIQUE INDEX tournament_templates_slug_prefix_idx
    ON tournament_templates (slug_prefix);

-- =============================================================================
-- 2. tournaments — per-instance schedule (materialized + one-off)
-- =============================================================================

CREATE TABLE tournaments (
    id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                 TEXT         NOT NULL,
    name                 TEXT         NOT NULL,
    starts_at            TIMESTAMPTZ  NOT NULL,                              -- wall-clock-intent (ADR-0034 §category split)
    tz_name              TEXT         NOT NULL DEFAULT 'America/Chicago',    -- IANA zone in which starts_at was scheduled
    buy_in_cents         INTEGER      NOT NULL,
    capacity             INTEGER      NOT NULL,
    game_type            TEXT         NOT NULL,
    structure_md         TEXT         NULL,
    status               TEXT         NOT NULL DEFAULT 'scheduled',
    source_template_id   UUID         NULL REFERENCES tournament_templates(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT tournaments_buy_in_nonneg
        CHECK (buy_in_cents >= 0),
    CONSTRAINT tournaments_capacity_positive
        CHECK (capacity > 0),
    CONSTRAINT tournaments_game_type_values
        CHECK (game_type IN ('nlhe', 'plo', 'mixed', 'other')),
    CONSTRAINT tournaments_status_values
        CHECK (status IN ('scheduled', 'registering', 'live', 'complete', 'canceled')),
    CONSTRAINT tournaments_slug_format
        CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

COMMENT ON TABLE tournaments IS
    'Per ADR-0012 + ADR-0037. Per-event tournament instances — materialized from '
    'tournament_templates by the nightly cron, or inserted directly as one-off events '
    'with source_template_id = NULL. Slice 1 uses scheduled|canceled|complete only; '
    'registering|live activate when ADR-0012 Slice 3 (registration) ships.';

COMMENT ON COLUMN tournaments.starts_at IS
    'UTC instant. Per ADR-0034, this is a wall-clock-intent timestamp: it was '
    'scheduled FOR a specific local time in tz_name. If the club moves zones or '
    'IANA reissues the zone definition, tz_name preserves the original intent.';
COMMENT ON COLUMN tournaments.tz_name IS
    'IANA zone in which starts_at was scheduled. ADR-0034 deferred this column to '
    'ADR-0012''s admin-write path; ADR-0037 ships it.';
COMMENT ON COLUMN tournaments.source_template_id IS
    'NULL for one-off tournaments; UUID for materialized instances. ON DELETE SET '
    'NULL preserves the instance row when its source template is hard-deleted '
    '(admins should soft-delete via active=false instead).';

CREATE UNIQUE INDEX tournaments_slug_idx
    ON tournaments (slug);

CREATE INDEX tournaments_starts_at_idx
    ON tournaments (starts_at);

CREATE INDEX tournaments_scheduled_starts_at_idx
    ON tournaments (starts_at)
    WHERE status = 'scheduled';

-- Idempotency anchor for the materializer (premortem-style invariant):
-- one instance per (template, club-local date). Partial — applies only to
-- template-sourced rows; one-off tournaments are exempt.
--
-- The expression `date(starts_at AT TIME ZONE tz_name)` projects the UTC
-- instant into the tournament's own zone, then truncates to date. Re-running
-- the materializer on the same template/date pair triggers SQLSTATE 23505 on
-- the second INSERT, which the route handler swallows via ON CONFLICT DO
-- NOTHING. See tests/api/tournament-materialize.test.ts for the contract.
CREATE UNIQUE INDEX tournaments_template_date_idx
    ON tournaments (source_template_id, (date(starts_at AT TIME ZONE tz_name)))
    WHERE source_template_id IS NOT NULL;

-- =============================================================================
-- 3. updated_at triggers — reuse set_updated_at() from 0002_profiles_and_roles
-- =============================================================================

CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON tournament_templates
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON tournaments
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 4. RLS posture — enable + force + policies
-- =============================================================================

-- tournaments: anyone (including anon) can SELECT — /games is a marketing
-- page rendered without an authenticated session. Writes are admin-only.
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments FORCE  ROW LEVEL SECURITY;

CREATE POLICY tournaments_select_public ON tournaments
    FOR SELECT
    USING (true);

CREATE POLICY tournaments_write_admin ON tournaments
    FOR ALL
    USING (auth.role_at_least('manager'))
    WITH CHECK (auth.role_at_least('manager'));

COMMENT ON POLICY tournaments_select_public ON tournaments IS
    'Tournament schedule is public per ADR-0037 (/games is a marketing surface). '
    'Anonymous traffic must see scheduled tournaments — there is no member-gate.';

COMMENT ON POLICY tournaments_write_admin ON tournaments IS
    'Manager+ owns the schedule editor. ADR-0035 admin console IA. The FOR ALL '
    'policy gates INSERT/UPDATE/DELETE; the SELECT policy above is independent '
    'and public, so admins inherit read access through the public SELECT.';

-- tournament_templates: admin-only across the board (no public read — templates
-- are an internal scheduling primitive, not a customer-facing surface).
ALTER TABLE tournament_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_templates FORCE  ROW LEVEL SECURITY;

CREATE POLICY tournament_templates_admin_only ON tournament_templates
    FOR ALL
    USING (auth.role_at_least('manager'))
    WITH CHECK (auth.role_at_least('manager'));

COMMENT ON POLICY tournament_templates_admin_only ON tournament_templates IS
    'Templates are admin-only on read AND write — they are not a customer-facing '
    'surface. The materializer cron uses the service-role key (BYPASSRLS) to read '
    'active templates and write tournaments rows.';

-- =============================================================================
-- 5. Seed initial templates (per ADR-0037 spec §Migration)
-- =============================================================================
--
-- Mirrors the SCHEDULE constant in app/(marketing)/games/page.tsx + the
-- TOURNAMENTS fixture in lib/tournaments/fixtures.ts. Sunday is omitted —
-- existing copy is cash-only on Sundays. All templates use America/Chicago.
-- Buy-ins in cents per ADR-0004 integer-cents convention.

INSERT INTO tournament_templates
    (name, slug_prefix, day_of_week, time_of_day_local, tz_name,
     buy_in_cents, capacity, game_type, active)
VALUES
    ('Tuesday Bounty',           'tuesday-bounty',         2, '19:00:00', 'America/Chicago',
     15000, 40, 'nlhe', true),
    ('Thursday Ladies Night',    'thursday-ladies-night',  4, '19:00:00', 'America/Chicago',
     12500, 40, 'nlhe', true),
    ('Friday Nightly',           'friday-nightly',         5, '19:30:00', 'America/Chicago',
     25000, 120, 'nlhe', true),
    ('Saturday Deepstack',       'saturday-deepstack',     6, '15:00:00', 'America/Chicago',
     40000, 60, 'nlhe', true);

-- =============================================================================
-- INVARIANTS (load-bearing absences — do NOT add these in a future migration
-- without re-engaging ADR-0037):
--
--   - NO INSERT policy on `tournament_templates` for non-admin roles. Templates
--     are an internal scheduling primitive.
--   - NO DELETE policy on `tournaments` distinct from the FOR ALL write policy.
--     Hard-delete is reserved for one-off tournaments; admins cancel
--     template-sourced instances (status='canceled') to preserve audit history
--     and prevent the materializer from immediately re-creating the row.
--   - NO trigger that auto-flips status from 'scheduled' to 'complete' post-
--     start. That belongs to ADR-0012 Slice 3 (with the registration flow that
--     ratifies what "complete" means operationally).
-- =============================================================================
