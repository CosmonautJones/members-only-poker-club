-- ADR-0035: feature_flags RLS posture (Slice 4 — admin operations console).
-- Spec: docs/specs/0035-admin-operations-console-implementation.md AC2.
-- safe-window: any (purely additive — ENABLE/FORCE RLS + two policies + COMMENT).
--
-- Closes the gap between ADR-0035's required posture (`/admin/flags` writes
-- via the cookie-scoped supabase client; manager+ role-gate at the DB layer)
-- and the cycle-1 comment in 0001_feature_flags.sql which forecasted that
-- writes would flow through the service-role key.
--
-- Forward-only drift resolution per ADR-0018: the cycle-1 migration is NOT
-- rewritten. This migration amends the posture forward and re-comments the
-- table to reflect the new contract.
--
-- Why this is safe to enable RLS on feature_flags now:
--   - NO production writer currently depends on the un-RLS'd posture. The
--     cycle-1 reader path is `lib/flags/registry.ts` — an in-code, static
--     registry that does NOT query the table. The cycle-1 migration comment
--     forecasted service-role writes only; no such writer was ever built.
--   - Reads from any authenticated session continue to succeed via the new
--     `feature_flags_select_authenticated` policy (the future DB-backed read
--     path in lib/flags/db.ts will rely on this).
--   - Writes were always intended to be admin-gated; this migration moves
--     the gate from "service-role only at the application layer" to
--     "manager+ at the DB layer via auth.role_at_least('manager')".
--   - Service-role retains BYPASSRLS as a Postgres-role attribute, so the
--     emergency-repair path (a service-role write from an alerting bot or
--     out-of-band script) remains available without a policy change.
--
-- 1. Enable RLS. FORCE applies even to the table owner (Supabase production
--    runs the cookie-scoped client as the `authenticated` role which is not
--    the owner, but the pglite test substrate runs as owner — FORCE makes
--    tests match production semantics; same pattern as 0002_profiles_and_roles).
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags FORCE ROW LEVEL SECURITY;

-- 2. SELECT policy — any authenticated caller may read flags. The runtime
--    needs this so feature-gate evaluation (manager+ AND member alike) can
--    resolve a flag's state without a service-role round-trip. The bypass
--    predicate `auth.uid() IS NOT NULL` mirrors the inverse of the cycle-1
--    bypass predicate used elsewhere in the schema (auth.uid() IS NULL is
--    service-role / anonymous; auth.uid() IS NOT NULL is "logged in").
CREATE POLICY feature_flags_select_authenticated ON feature_flags
    FOR SELECT
    USING (auth.uid() IS NOT NULL);

-- 3. Write policy — only manager+ may INSERT / UPDATE / DELETE rows.
--    FOR ALL applies to every command including SELECT — but SELECT for
--    manager+ is already covered by the policy above (Postgres ORs the
--    applicable USING clauses across multiple policies on the same command),
--    so this is purely additive for writes. WITH CHECK is identical to USING
--    so a manager+ rewriting the row to a state that would no longer satisfy
--    the predicate is impossible — defense-in-depth against a future
--    `key`-rewrite vector.
--
--    auth.role_at_least('manager') is SECURITY DEFINER from 0002 — it reads
--    profiles.role under elevated privileges and returns boolean. Callers
--    do NOT need GRANT SELECT on profiles for this policy to evaluate.
CREATE POLICY feature_flags_write_manager ON feature_flags
    FOR ALL
    USING (auth.role_at_least('manager'))
    WITH CHECK (auth.role_at_least('manager'));

-- 4. Amend the cycle-1 table comment so the schema's self-documentation
--    matches the live posture. The cycle-1 comment forecasted service-role
--    writes (out of date as of ADR-0035); this rewrites it to reflect the
--    actual contract per ADR-0035 §Consequences.
COMMENT ON TABLE feature_flags IS
    'Per ADR-0020 (schema) + ADR-0035 (RLS posture). RLS-enabled: authenticated SELECT, manager+ ALL. Writes flow through the cookie-scoped supabase client per ADR-0035 §Consequences; service-role retains BYPASSRLS for emergency repair.';
