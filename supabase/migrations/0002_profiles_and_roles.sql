-- ADR-0003: Authorization model — roles + Row-Level Security (Slice 1).
-- Spec: docs/specs/0003-authorization-rls-implementation.md (revision 2).
-- Acceptance criteria covered by this migration: AC1–AC7 (structural), with
-- AC8/AC9 verified by tests in tests/db/rls-profiles.test.ts and
-- tests/migrations/profiles-shape.test.ts respectively.
--
-- Scope: schema substrate only. NO application code, NO MFA middleware, NO
-- audit-log integration (deferred — see Out of scope in the spec for the
-- precise downstream owners: ADR-0002 cycle 3 [signup], ADR-0006 cycle 2
-- [audit log], ADR-0009 cycle 4 [id verification columns], ADR-0023 cycle 6
-- [soft-delete], ADR-0025 [SMS opt-in], ADR-0027 cycle 5 [staff routes]).
--
-- Service-role bypass predicate: this migration uses `auth.uid() IS NULL` per
-- the planner decision (.conductor/0003/dispatches/0005-planner.md, Open
-- Question §2 resolution). Cycle 3 (ADR-0002 auth) MUST re-verify this
-- predicate against current Supabase docs and ship a CREATE OR REPLACE
-- function migration if Supabase has migrated to JWT-claim or GUC-based
-- service-role detection.

-- 1. role_t enum (AC2)
--    Values are lowercase-only — auth.role_at_least() compares against
--    lowercase string literals. DO NOT capitalize; staff ladder collapses
--    silently if the casing drifts.
CREATE TYPE role_t AS ENUM ('member', 'cashier', 'manager', 'owner');

-- 2. profiles table (AC3)
CREATE TABLE profiles (
    -- ON DELETE CASCADE: deleting auth.users deletes profile; profile-side
    -- delete does NOT touch auth.users (out-of-band cleanup; see ADR-0023
    -- cycle 6 for soft-delete + auth-orphan reaping semantics).
    id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name   TEXT        NOT NULL,
    dob         DATE        NOT NULL,
    phone       TEXT        NULL,
    -- Email UNIQUE is case-sensitive at the DB layer. Case-insensitive
    -- collision prevention is enforced application-side at signup
    -- (ADR-0002 cycle 3 normalizes to lower(email) before insert). A future
    -- migration may add a unique functional index on lower(email)
    -- (profiles_email_lower_idx) — out of scope for Slice 1.
    email       TEXT        NOT NULL UNIQUE,
    role        role_t      NOT NULL DEFAULT 'member',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE profiles IS
    'Per ADR-0003. Keyed to auth.users(id); RLS-enabled; role enum gates staff surfaces.';
COMMENT ON COLUMN profiles.role IS
    'role_t enum. Changes are gated by profiles_protect_role_change trigger (manager+ or service-role).';
COMMENT ON COLUMN profiles.email IS
    'UNIQUE at DB layer is case-sensitive; signup-time lowercasing in cycle 3 (ADR-0002) prevents Alice@/alice@ collisions.';

-- 3. auth.role_at_least(text) helper (AC5)
--    Schema-qualified `auth.` is load-bearing — policies reference
--    auth.role_at_least(...). If this lands in `public` instead, every
--    policy errors at query time and profiles becomes unreadable. The role
--    sets are verbatim from ADR-0003: cashier ladder = (cashier, manager,
--    owner); manager ladder = (manager, owner); owner ladder = (owner).
CREATE OR REPLACE FUNCTION auth.role_at_least(target TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
    SELECT CASE
        WHEN target = 'member'  THEN TRUE
        WHEN target = 'cashier' THEN EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid()
              AND p.role IN ('cashier', 'manager', 'owner')
        )
        WHEN target = 'manager' THEN EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid()
              AND p.role IN ('manager', 'owner')
        )
        WHEN target = 'owner'   THEN EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid()
              AND p.role = 'owner'
        )
        ELSE FALSE
    END;
$$;

COMMENT ON FUNCTION auth.role_at_least(TEXT) IS
    'Per ADR-0003 role precedence ladder. SECURITY DEFINER so policies can read profiles.role even when the caller cannot. Lowercase string literals are load-bearing — match role_t enum values exactly.';

-- 4. RLS enable (AC6 prologue)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- FORCE: applies RLS even to the table-owner connection.
-- In production Supabase, the anon and authenticated roles are never the
-- table owner — this is a no-op for them. But the pglite WASM test substrate
-- runs as the owner by default, so without FORCE the RLS policies are bypassed
-- in tests. Adding FORCE makes the test substrate match production semantics
-- (defense-in-depth posture also recommended by Supabase docs).
ALTER TABLE profiles FORCE ROW LEVEL SECURITY;

-- 5. Four named policies (AC6)
--
--    profiles_select_self_or_staff — caller reads own row OR is cashier+.
--    USING clause uses OR (NOT AND) — AND would deny members reading their
--    own row (no member is cashier+).
CREATE POLICY profiles_select_self_or_staff ON profiles
    FOR SELECT
    USING (id = auth.uid() OR auth.role_at_least('cashier'));

--    profiles_update_self_or_manager — both USING and WITH CHECK clauses.
--    USING gates the pre-image (caller must own row or be manager+);
--    WITH CHECK gates the post-image (after the update, the row must still
--    satisfy the same predicate — prevents a member rewriting `id` to claim
--    another user's row). Both clauses MUST exist; without WITH CHECK,
--    Postgres falls back to USING for the post-image check, which is a
--    subtle privilege-escalation surface.
CREATE POLICY profiles_update_self_or_manager ON profiles
    FOR UPDATE
    USING (id = auth.uid() OR auth.role_at_least('manager'))
    WITH CHECK (id = auth.uid() OR auth.role_at_least('manager'));

--    profiles_delete_manager — only manager+ may delete. NOT cashier
--    (cashiers must not be able to wipe member rows during a redemption
--    flow). NOT owner-only (owners are also manager+, the ladder handles
--    it).
CREATE POLICY profiles_delete_manager ON profiles
    FOR DELETE
    USING (auth.role_at_least('manager'));

-- NO INSERT POLICY: signup runs through the service-role key in cycle 3
-- (ADR-0002). RLS denies inserts by default. DO NOT add an insert policy —
-- the absence is asserted by the migration shape test (AC9 regex tier) and
-- by the anon-INSERT-denial sub-case in the RLS test suite (AC8 sub-case 9).

-- 6. Trigger functions (AC4 + AC7)
--
--    set_updated_at — generic timestamp bumper. BEFORE UPDATE on profiles.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

--    profiles_protect_role_change — column-level guard on `role`. Allows
--    the change ONLY when (a) caller is manager+ via the role ladder, OR
--    (b) caller is the service-role bypass path (auth.uid() IS NULL).
--    Predicate uses OR — NOT AND. AND would require caller to be both
--    manager+ AND have no JWT, which is unreachable in production and
--    breaks ADR-0027's admin role-assignment UI.
--    Raises SQLSTATE 42501 (insufficient_privilege) on denial. Tests assert
--    error.code === '42501' — DO NOT match the message text.
CREATE OR REPLACE FUNCTION profiles_protect_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF auth.role_at_least('manager') OR auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'role change requires manager+'
        USING ERRCODE = '42501';
END;
$$;

-- 7. Triggers (AC4)
--
--    Trigger-name ordering invariant: Postgres fires multiple BEFORE
--    triggers on the same event in alphabetical order by trigger name.
--    'p' < 's', so profiles_protect_role_change fires BEFORE
--    set_updated_at. This ordering is load-bearing for the future
--    ADR-0006 audit-log integration (cycle 2): the protection trigger
--    must veto unauthorized role changes before any sibling trigger
--    has a chance to record a fictitious "successful" event.
--
-- DO NOT RENAME: alphabetical 'p' < 's' ensures protection fires first;
-- see AC4 + ADR-0006 audit integration in cycle 2.
CREATE TRIGGER profiles_protect_role_change
    BEFORE UPDATE OF role ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION profiles_protect_role_change();

-- DO NOT RENAME: alphabetical 'p' < 's' ensures protection fires first;
-- see AC4 + ADR-0006 audit integration in cycle 2.
CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
