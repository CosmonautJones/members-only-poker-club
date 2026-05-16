-- ADR-0034: Timestamp storage in UTC; presentation in club-local time (Slice 1).
-- Spec: docs/specs/0034-timestamp-and-timezone-policy-implementation.md (revision 2).
-- Acceptance criteria covered by this migration: AC5 (statements + order),
-- AC10 (purely additive — `pnpm migrate:check` clean). AC6 (regex + AST shape
-- assertions) and AC7 (pglite round-trip) are verified by sibling tests in
-- tests/migrations/timestamp-policy-shape.test.ts and
-- tests/db/clubs-and-display-tz.test.ts respectively.
--
-- Scope: schema substrate only. NO application code, NO render helpers, NO
-- audit-viewer JSX, NO admin schedule UI. The lib/time/ TypeScript helpers
-- (nowUtc, formatInZone, formatAuditRowDualZone, the four category brands)
-- ship in this same slice but in a separate task; the ESLint
-- no-restricted-syntax rule and the SQL day-bucket lint script likewise.
-- Downstream consumers per the spec's "Out of scope" section:
--   * Audit-log viewer UI       → ADR-0006 Slice 4 (consumes formatAuditRowDualZone)
--   * tournaments.starts_at + tz_name → ADR-0012 Slice 3 (admin schedule write path)
--   * In-app member-override UI → ADR-0023 cycle 6 or dedicated profile cycle
--   * ADR-0018 template amendment → ADR-0018 cycle (this migration leads by example
--                                  using timestamptz defaults, but does not edit the template)
--   * ADR-0008 deployment-hygiene checklist → ADR-0008 cycle (Stripe TZ = UTC,
--                                  Postgres tzdata pinning, session-TZ = UTC verification)
--
-- This migration is purely additive: CREATE TABLE on a fresh table + INSERT a
-- single configuration row + ALTER TABLE ADD COLUMN (nullable, no default) on
-- an existing table. No DROPs, no ALTER COLUMN, no destructive operations —
-- `pnpm migrate:check` passes without acknowledgement comments.

-- 1. clubs table (AC5.1)
--
-- v1 is single-row. Multi-club expansion (ADR-0002 Slice-4 trigger) adds
-- rows, not columns. The `id` is uuid so the schema is shape-stable across
-- the single-club → multi-club transition; the application's read path
-- still reads a single row in v1 (see ADR-0034 §"Negative consequences"
-- premortem-risk-1 — column-backed expansion path, not full multi-tenant).
--
-- INVARIANT (ADR-0034): clubs.display_tz CHECK constraint is non-empty
-- string only. DO NOT add an IANA-zone allowlist CHECK at the DB layer —
-- the IANA tzdata is the Postgres image's concern (owned by ADR-0008's
-- deployment-hygiene checklist via tzdata version pinning). A DB CHECK
-- that enumerates valid zones would re-introduce the multi-runtime
-- tzdata-divergence problem ADR-0034 explicitly rejects (premortem-risk-10).
-- Application-side validation lives in lib/time/zones.ts via
-- isValidIanaZone() — that's the single source of truth for "is this a
-- recognized zone."
CREATE TABLE clubs (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Stable URL/config handle. v1 default row uses 'default'.
    slug        TEXT        NOT NULL UNIQUE,
    -- Per ADR-0034 §"Schema additions". v1 default is America/Chicago;
    -- multi-club expansion writes per-club rows with their own zones.
    display_tz  TEXT        NOT NULL DEFAULT 'America/Chicago'
                            CHECK (length(display_tz) > 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. RLS enable + force (AC5.3 prologue).
--    Same defense-in-depth posture as cycle 1's profiles and cycle 2's
--    audit_log. FORCE applies RLS to the table-owner connection so the
--    pglite WASM test substrate (which runs as owner by default) sees the
--    same policy enforcement as production Supabase. NO production role is
--    ever the table owner, so FORCE is a no-op there.
ALTER TABLE clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE clubs FORCE ROW LEVEL SECURITY;

-- 3. Policies (AC5.3) — exactly TWO: SELECT (anyone) and UPDATE (manager+).
--
-- INVARIANT (ADR-0034): NO INSERT POLICY and NO DELETE POLICY on clubs.
-- DO NOT add CREATE POLICY ... FOR INSERT or FOR DELETE in any future
-- migration without explicit ADR coverage. Rationale:
--   * INSERT: the v1 single-row seed below runs under service-role (the
--     migration runner has BYPASSRLS). Future multi-club provisioning
--     (ADR-0002 Slice-4 trigger) goes through a server-action gated on
--     manager+ that writes via the service-role key — the policy layer is
--     not the right gate for that flow. Adding an INSERT policy now would
--     pretend the gate lives here and silently permit a member-with-RLS-
--     bypass-bug to seed a rogue club.
--   * DELETE: deleting a club is a destructive operation. The v1 row is
--     never deleted. If product surfaces a "decommission a club" flow,
--     it needs its own ADR for the cascade semantics (what happens to the
--     club's tournaments, audit rows, time-bank balances, etc.) — RLS
--     policy here would short-circuit that conversation.
-- The migration shape test (AC6 regex tier) asserts the absence of
-- `for insert` and `for delete` on clubs as a regression guard.
CREATE POLICY clubs_select_anyone ON clubs
    FOR SELECT
    USING (true);

CREATE POLICY clubs_update_manager ON clubs
    FOR UPDATE
    USING (auth.role_at_least('manager'))
    WITH CHECK (auth.role_at_least('manager'));

-- 4. Single-row seed (AC5.4).
--    Seeding inside the migration is acceptable here because (a) the data
--    is configuration, not tenant-state, and (b) ADR-0008's environment
--    promotion runs the same migrations against every environment, so the
--    row exists identically everywhere. The INSERT runs under the
--    migration runner's service-role (BYPASSRLS), so the absent INSERT
--    policy does not block it.
INSERT INTO clubs (slug, display_tz) VALUES ('default', 'America/Chicago');

-- 5. profiles.display_tz column (AC5.5).
--
-- INVARIANT (ADR-0034 + ADR-0023): profiles.display_tz is NULLABLE with NO
-- DEFAULT and NO CHECK. NULL means "inherit clubs.display_tz" per ADR-0034
-- §"Schema additions" — the v1 surface-by-surface policy reads the club
-- zone unless the member has explicitly set an override. DO NOT add NOT
-- NULL or a DEFAULT or an IANA allowlist CHECK in any future migration:
--   * NOT NULL would force every profile row to carry a redundant copy of
--     the club zone, defeating the "no auto-detection" rule.
--   * A DEFAULT would silently set every new profile to America/Chicago
--     and obscure the "the member has not chosen" signal that the render
--     layer relies on.
--   * A CHECK against an IANA allowlist re-introduces the tzdata-
--     divergence problem (see INVARIANT on clubs.display_tz above).
-- ADR-0023's anonymization (cycle 6) will set this column to NULL via the
-- del:<hash> profile-anonymization scheme; NOT NULL would constraint-fail
-- that operation. The migration shape test (AC6 regex + AST tiers) asserts
-- the absence of NOT NULL on this ALTER ADD COLUMN as a regression guard.
--
-- Adding the column in a separate migration (rather than amending cycle 1's
-- 0002_profiles_and_roles.sql) preserves the cycle-1 spec's "no other
-- columns are added in this migration" invariant.
ALTER TABLE profiles ADD COLUMN display_tz TEXT NULL;

-- 6. Column comments (AC5.6) — point future maintainers at ADR-0034 and the
-- lib/time/ helper module. The lib/time/ module is the single source of
-- truth for "how to read and format these columns" — comments here surface
-- that contract to anyone who introspects the schema via `\d+` or a BI tool.
COMMENT ON COLUMN clubs.display_tz IS
    'ADR-0034 display timezone — see lib/time/';
COMMENT ON COLUMN profiles.display_tz IS
    'ADR-0034 per-member override; NULL = inherit clubs.display_tz — see lib/time/';

-- Note: this migration ships no additional indexes. The clubs table is
-- single-row in v1 — an explicit index on slug would never be used; the
-- UNIQUE constraint already gives Postgres a btree for the (eventual multi-
-- row) slug lookup. This migration also ships no triggers — no
-- set_updated_at on clubs in v1; updated_at is currently aspirational and a
-- future ADR that operationally mutates clubs rows can add the trigger in
-- the same change. AC6's regex tier asserts the structural absence of
-- additional statements beyond the six declared above.
