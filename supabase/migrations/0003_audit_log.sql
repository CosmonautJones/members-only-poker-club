-- ADR-0006: Audit log — append-only forensic record-of-record (Slice 1).
-- Spec: docs/specs/0006-audit-log-implementation.md.
-- Acceptance criteria covered by this migration: AC1 (table shape), AC2
-- (nullability), AC3 (indices), AC4 (RLS + policies), AC5 (trigger function
-- rewrite). AC7/AC8/AC9 are verified by sibling tests. AC13 (cycle-1
-- regression) is preserved via the byte-for-byte unauthorized branch in
-- profiles_protect_role_change below.
--
-- Scope: schema substrate only. Application-side withAudit helper lives in
-- lib/audit/withAudit.ts (cycle-2 task t2); production wiring of staff
-- mutations to use the helper is deferred to ADR-0006 Slice 2 and beyond.
--
-- Premortem: .conductor/0006/dispatches/0006-premortem-t1.md. The seven
-- INVARIANT comment blocks below are load-bearing future-maintainer
-- signaling — DO NOT remove them, even if a linter complains about
-- comment density.

-- 1. audit_log table (AC1 + AC2)
--
-- INVARIANT (ADR-0006): audit_log has NO TRIGGERS. Do not add any.
-- Reason: profiles.profiles_protect_role_change writes to audit_log;
-- if audit_log has a trigger that reads profiles (e.g. to fetch actor
-- display name for redaction), the cycle becomes recursive. Append-only
-- is enforced at the RLS policy layer (no UPDATE/DELETE policies);
-- structural triggers are not needed. If you find yourself wanting an
-- audit_log trigger, you are almost certainly solving the wrong problem
-- — push the logic to the call site (e.g. withAudit helper) where the
-- read is explicit and the recursion is impossible by construction.
CREATE TABLE audit_log (
    id           BIGSERIAL   PRIMARY KEY,
    -- INVARIANT (ADR-0006 + ADR-0023): actor_id MUST stay nullable.
    -- Service-role and system actions write actor_id = NULL (the
    -- service-role bypass path has auth.uid() = NULL by design). ADR-0023
    -- anonymizes via del:<hash> token replacement on auth.users, which
    -- still requires this column be writable / nullable. Do NOT add
    -- NOT NULL or CHECK constraints in future migrations — doing so
    -- causes legitimate role-change operations to fail with SQLSTATE
    -- 23502, which LOOKS like a role-ladder bug but is actually
    -- constraint drift. Update this comment AND docs/kb/audit-log.md
    -- before changing nullability.
    --
    -- INVARIANT (ADR-0023): NO ON DELETE CASCADE on this FK. ADR-0023
    -- specifies audit rows survive account deletion via del:<hash>
    -- token replacement on auth.users — NOT by deleting audit_log rows.
    -- Cycle 6 (ADR-0023) MAY change this to ON DELETE SET NULL when it
    -- implements anonymization; CASCADE is forbidden under any
    -- circumstance. This slice deliberately uses NO ACTION (block the
    -- delete) so the contract is explicit. Adding CASCADE here is a
    -- privacy-law violation.
    actor_id     UUID        REFERENCES auth.users(id),
    action       TEXT        NOT NULL,
    target_type  TEXT        NOT NULL,
    target_id    TEXT        NOT NULL,
    before       JSONB,
    after        JSONB,
    ip           INET,
    user_agent   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE audit_log IS
    'Per ADR-0006. Append-only forensic record-of-record. RLS-enabled with FORCE; manager+ may SELECT; any authenticated caller may INSERT. NO UPDATE or DELETE policies — append-only is structural. Service-role retains full DML via Postgres-role BYPASSRLS for emergency repair.';
COMMENT ON COLUMN audit_log.actor_id IS
    'NULLABLE on purpose — service-role / system actions write NULL. ADR-0023 anonymizes via del:<hash> token on auth.users, NOT by NOT-NULL-ing this column.';
COMMENT ON COLUMN audit_log.target_id IS
    'TEXT not UUID — staff sign-in audit (ADR-0002 cycle 3) writes a session id; future events may reference non-uuid identifiers.';

-- 2. Indices (AC3) — verbatim from ADR-0006 §Decision.
--    Each leads with the most-selective filter column and trails with
--    created_at DESC so the common "recent activity by X" reads are
--    index-only and time-ordered.
--
-- migration-review: blocking-index-approved — audit_log is created in this
-- same migration (empty table); the brief ACCESS EXCLUSIVE lock during
-- index build holds on zero rows. CONCURRENTLY is not an option here
-- because Supabase wraps each migration .sql file in a single transaction
-- and CREATE INDEX CONCURRENTLY cannot run inside a transaction.
CREATE INDEX audit_log_actor_idx  ON audit_log (actor_id, created_at DESC);
CREATE INDEX audit_log_target_idx ON audit_log (target_type, target_id, created_at DESC);
CREATE INDEX audit_log_action_idx ON audit_log (action, created_at DESC);

-- 3. RLS enable + force (AC4 prologue).
--    FORCE applies RLS even to the table-owner connection. In production
--    Supabase, anon/authenticated are never the table owner — this is a
--    no-op for them. The pglite WASM test substrate runs as the owner by
--    default, so without FORCE the policies are bypassed in tests; FORCE
--    makes the test substrate match production semantics. Same posture
--    as cycle 1's profiles table (defense-in-depth per Supabase docs).
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

-- 4. Policies (AC4) — exactly two: SELECT (manager+) and INSERT (any
-- authenticated caller). NO UPDATE, NO DELETE policies — RLS denies by
-- default and that denial IS the append-only invariant.
--
-- INVARIANT (ADR-0006): audit_log is append-only at the policy layer.
-- DO NOT add CREATE POLICY ... FOR UPDATE or FOR DELETE in any future
-- migration. Service-role keeps emergency DML via Postgres-role
-- BYPASSRLS — that is the only escape hatch. Anonymization (ADR-0023)
-- operates on auth.users and on profiles via del:<hash> tokens — NOT
-- by mutating audit_log rows. If you find yourself wanting an UPDATE
-- policy here, you are solving the wrong problem.
--
-- The auth.uid() IS NOT NULL WITH CHECK clause is intentionally
-- restrictive: service-role inserts succeed via Postgres-role
-- BYPASSRLS (the policy never evaluates), NOT via policy weakening.
-- DO NOT change this to (true) or add an OR-disjunct — doing so opens
-- an anon-INSERT hole that the AC7.6 sub-case is the regression guard
-- for.
CREATE POLICY audit_log_select_manager
    ON audit_log
    FOR SELECT
    USING (auth.role_at_least('manager'));

CREATE POLICY audit_log_insert_authenticated
    ON audit_log
    FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

-- 5. profiles_protect_role_change rewrite (AC5).
--
-- IMPORTANT: This file uses CREATE OR REPLACE FUNCTION, NOT DROP+CREATE.
-- Triggers reference functions by OID; REPLACE preserves the OID and the
-- cycle-1 trigger profiles_protect_role_change ON profiles continues to
-- fire. DROP FUNCTION ... CASCADE would silently drop the cycle-1
-- trigger, opening a privilege-escalation hole (any caller with UPDATE
-- permission on profiles could rewrite their own role to 'owner'). If
-- REPLACE fails for a signature reason, fix the signature — DO NOT
-- switch to DROP+CREATE. There is NO `DROP FUNCTION` statement anywhere
-- in this file by design.
--
-- IMPORTANT: This function is INVOKER-rights (no SECURITY DEFINER).
-- The audit INSERT succeeds because:
--   (a) manager+ branch: caller has INSERT permission on audit_log via
--       GRANT to app_authenticated, and auth.uid() IS NOT NULL satisfies
--       the audit_log_insert_authenticated WITH CHECK;
--   (b) service-role branch: caller is postgres (BYPASSRLS), the policy
--       never evaluates, INSERT succeeds with NULL actor_id.
-- Do NOT add SECURITY DEFINER to this function. It would silently
-- elevate the function to function-owner privileges (BYPASSRLS) in all
-- branches, weakening the anti-forgery posture and decoupling the
-- function's reachability from the caller's RLS state. If the audit
-- INSERT fails under a specific caller, the right fix is to adjust the
-- GRANT or the policy — NOT to add SECURITY DEFINER. Note: cycle 1's
-- auth.role_at_least() IS SECURITY DEFINER (it must read profiles even
-- when the caller can't); that's correct and unchanged. The
-- invoker-rights discipline is function-specific.
--
-- INVARIANT (ADR-0006 + ADR-0023): The columns this INSERT writes —
-- actor_id, action, target_type, target_id, before, after — MUST stay
-- write-compatible with the audit_log table's NOT NULL / CHECK
-- constraints. In particular:
--   * actor_id MUST remain NULLABLE (service-role bypass writes NULL).
--   * before / after MUST remain NULLABLE (other call sites — INSERT
--     events, DELETE events — write NULL on one side; only role change
--     writes both).
--   * target_id is TEXT not UUID — see column comment above.
-- Adding a constraint that this INSERT cannot satisfy will cause
-- legitimate role-change operations to fail with SQLSTATE 23502 / 23514,
-- which LOOKS like a role-ladder bug but is actually constraint drift.
--
-- The unauthorized branch (the ELSE arm with `RAISE EXCEPTION 'role
-- change requires manager+' USING ERRCODE = '42501'`) is preserved
-- byte-for-byte from cycle 1 (0002_profiles_and_roles.sql). Tests
-- assert error.code === '42501' — DO NOT match the message text.
-- Cycle-1's tests/db/rls-profiles.test.ts is the AC13 regression
-- contract; it MUST stay green after this REPLACE.
CREATE OR REPLACE FUNCTION profiles_protect_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF auth.role_at_least('manager') OR auth.uid() IS NULL THEN
        INSERT INTO audit_log (actor_id, action, target_type, target_id, before, after)
        VALUES (
            auth.uid(),
            'profile.role_change',
            'profile',
            NEW.id::text,
            jsonb_build_object('role', OLD.role),
            jsonb_build_object('role', NEW.role)
        );
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'role change requires manager+'
        USING ERRCODE = '42501';
END;
$$;

-- Note: NO `CREATE TRIGGER profiles_protect_role_change` here — the
-- trigger declaration lives in 0002_profiles_and_roles.sql. CREATE OR
-- REPLACE FUNCTION above preserves the function OID, so the cycle-1
-- trigger keeps pointing at the new body. Re-issuing CREATE TRIGGER
-- would either fail (already exists) or — worse — silently shadow the
-- cycle-1 trigger with a duplicate. AC8's regex tier asserts the
-- absence of `CREATE TRIGGER profiles_protect_role_change` in this
-- file as a structural guard.
