-- ADR-0023: Privacy / GDPR / CCPA — soft-delete + pgcrypto extension (Slice 1).
-- Spec: docs/specs/0023-privacy-gdpr-implementation.md AC1.
-- Acceptance criteria covered by this migration: AC1 (structural), verified by
-- tests/migrations/privacy-soft-delete-shape.test.ts.
--
-- Scope: additive schema changes only. No data-destructive statements.
--
-- migration-review: policy-replace-approved
-- migration-review: blocking-index-approved
-- Justification for blocking-index: profiles table is append-mostly during
-- the v1 launch phase (expected member count < 10,000). The CREATE INDEX
-- without CONCURRENTLY is acceptable at this scale; the partial index
-- (deleted_at IS NULL) covers a small fraction of rows and the lock window
-- is negligible during initial migration. A future migration can rebuild
-- CONCURRENTLY if needed.
-- Justification: The DROP POLICY + CREATE POLICY pair for
-- profiles_select_self_or_staff below executes atomically within this
-- migration transaction. Supabase wraps each migration file in a single
-- transaction, so there is no window of unprotected access between the DROP
-- and the CREATE. The new policy is strictly equivalent to the old one for
-- non-deleted rows (deleted_at IS NULL is the typical state for all current
-- rows), and the threshold rises from cashier to manager for deleted-row
-- visibility per ADR-0023's design. The second additive policy
-- (profiles_select_active_for_staff) preserves cashier-level read access
-- to active rows so cashier workflows are unaffected.

-- 1. pgcrypto extension — enables encode(digest(..., 'sha256'), 'hex') used
--    by softDeleteProfile (AC3). CREATE IF NOT EXISTS is idempotent; safe to
--    run multiple times. pglite supports pgcrypto natively.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Add deleted_at column to profiles (AC1).
--    Nullable, no default. Non-NULL signals an anonymized soft-deleted profile.
--    This is an additive change — all existing rows remain unaffected with
--    deleted_at = NULL.
ALTER TABLE profiles ADD COLUMN deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN profiles.deleted_at IS
    'Per ADR-0023 (Slice 1). Non-NULL marks an anonymized, soft-deleted profile. '
    'Anonymization is irreversible in this slice — there is no undelete path. '
    'The full_name, email, and phone columns are replaced with del:<sha256> '
    'tokens at deletion time; the audit_log actor row survives forever '
    '(ADR-0006 retention) and carries the actor UUID, not the PII values.';

-- 3. Partial index on active profiles (AC1).
--    Partial index so active-profile lookups stay fast as deleted rows
--    accumulate. Rows where deleted_at IS NULL are indexed; deleted rows are
--    excluded, keeping the index footprint bounded.
CREATE INDEX profiles_active_idx ON profiles (id) WHERE deleted_at IS NULL;

COMMENT ON INDEX profiles_active_idx IS
    'Per ADR-0023 (Slice 1). Partial index covering only non-deleted profiles '
    '(deleted_at IS NULL). Deleted rows are excluded to bound index size as '
    'anonymized rows accumulate over the lifetime of the application.';

-- 4. Replace the existing profiles_select_self_or_staff policy (AC1).
--    The original policy (cycle 1, migration 0002) allowed any cashier+ to
--    read ALL profile rows, including soft-deleted ones. ADR-0023 requires
--    that deleted rows be invisible to cashiers — only managers and above
--    may see them (for forensics / support). The staff threshold rises from
--    cashier to manager for deleted-row visibility.
--
--    The DROP + CREATE executes atomically within this migration transaction.
--    No window of unprotected access exists.
DROP POLICY profiles_select_self_or_staff ON profiles;

CREATE POLICY profiles_select_self_or_staff ON profiles
    FOR SELECT
    USING (
        (id = auth.uid() AND deleted_at IS NULL)
        OR auth.role_at_least('manager')
    );

-- 5. Add second staff-active policy (AC1).
--    Cashiers may still SELECT active rows (deleted_at IS NULL) for their
--    normal workflows (cashier console, game management). The two SELECT
--    policies combine with OR (Postgres default for multiple policies):
--      - profiles_select_self_or_staff: own non-deleted row OR manager+
--      - profiles_select_active_for_staff: cashier+ AND non-deleted row
--    The union gives: member sees own active row, cashier sees all active
--    rows, manager sees all rows (including deleted).
CREATE POLICY profiles_select_active_for_staff ON profiles
    FOR SELECT
    USING (
        auth.role_at_least('cashier') AND deleted_at IS NULL
    );
