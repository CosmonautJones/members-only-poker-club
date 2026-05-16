-- ADR-0036: Payment Management Console (Slice 1 — Schema substrate D).
-- Spec: docs/specs/0036-payment-management-console-implementation.md AC10.
-- Acceptance criteria covered by this migration: AC10 (structural). Verified
-- by tests/migrations/payments-rls-policies-shape.test.ts (regex + cross-
-- migration uniqueness + pglite-applies-cleanly tiers).
--
-- Scope: policies-only migration. ENABLE+FORCE ROW LEVEL SECURITY is ALREADY
-- present in each of 0008..0015 (per the schema-slice premortem D4
-- amendment) so the default-deny posture lands the instant each table is
-- created — there is no RLS-off write window for a stray service-role insert
-- to bypass policy. This migration adds only CREATE POLICY statements + the
-- memberships.profile_id immutability trigger + three load-bearing COMMENTs.
--
-- Why `auth.role_at_least(...)` and not `public.role_at_least(...)`:
--   This is the established in-repo convention (see 0005_privacy_requests.sql,
--   0006_feature_flags_rls.sql). Hosted prod has a `public.role_at_least`
--   variant because the modern hosted `auth` schema is locked to
--   `supabase_auth_admin` — that drift is a KNOWN ISSUE documented in user
--   memory `project_supabase_hosted_drift.md` (2026-05-15 incident) and is a
--   reconciliation runbook concern, NOT part of this slice. See the slice
--   retrospective for the proposed reconciliation ADR.
--
-- Premortem coupling (.conductor/36/returns/0005-premortem-rls.md):
--   R4 — policy-name collision invariant → all 10 policy names below are
--        load-bearing; t5 contract tests grep for them and the paired
--        shape test asserts no name collides with existing policies from
--        0001..0015.
--   R5 — refund_requests UPDATE policy intentionally absent → COMMENT ON
--        TABLE refund_requests pins this as load-bearing so a future Slice
--        2+ worker doesn't reactively add an UPDATE policy.
--   R6 — time_ledger cashier-insert-for-other-member is intentional → COMMENT
--        ON POLICY documents that the authority matrix lives in
--        lib/payments/authority.ts and that tightening the WITH CHECK would
--        break the service-role webhook write path.
--   R9 — memberships profile_id PK immutability → BEFORE UPDATE trigger
--        raises SQLSTATE 42501 when OLD.profile_id <> NEW.profile_id, plus
--        COMMENT ON COLUMN pinning the contract.
--   R10 — stripe_webhook_events.payload PII (manager+ read intentional per
--         ADR-0022 but every read should be operationally justified) → Slice
--         2 follow-up, NOT in scope here.
--
-- TODO(ADR-0036 Slice 2 follow-up): audit-log every SELECT from
-- stripe_webhook_events.payload — see RLS premortem risk R10. Currently
-- manager+ read is intentional per ADR-0022 but the application layer should
-- pair each read with an audit row.

-- =============================================================================
-- 1. payments — members read self; cashier+ read all; writes service-role only
-- =============================================================================

CREATE POLICY payments_self_or_cashier_read ON payments
    FOR SELECT
    USING (profile_id = auth.uid() OR auth.role_at_least('cashier'));

-- =============================================================================
-- 2. memberships — members read self; manager+ UPDATE; writes service-role only
-- =============================================================================

CREATE POLICY memberships_self_or_cashier_read ON memberships
    FOR SELECT
    USING (profile_id = auth.uid() OR auth.role_at_least('cashier'));

-- manager+ UPDATE policy — backs the Slice 2 membership-override surface.
-- USING gates the pre-image, WITH CHECK gates the post-image. Both are
-- identical because the only sensible "manager can demote themselves out of
-- being able to read" failure mode is structurally impossible (role is not on
-- memberships).
CREATE POLICY memberships_manager_write ON memberships
    FOR UPDATE
    USING (auth.role_at_least('manager'))
    WITH CHECK (auth.role_at_least('manager'));

-- Premortem R9: memberships.profile_id immutability trigger.
--
-- The PRIMARY KEY on memberships.profile_id makes it immutable-by-convention
-- in Postgres (PK update is technically allowed but FK fan-outs trip). At the
-- RLS layer the manager+ UPDATE policy does NOT restrict which columns can be
-- changed — only WHO can update. A buggy Slice 2 form that submits
-- profile_id=<other-member-id> as part of the payload would reassign one
-- member's Stripe customer state to another profile, which the next webhook
-- would then update against the wrong row.
--
-- This trigger is the schema-layer guard. Raises SQLSTATE 42501 (insufficient
-- privilege) on any UPDATE that would rewrite profile_id. The server action
-- layer in Slice 2 SHOULD also pin profile_id in the WHERE clause and NEVER
-- include it in the UPDATE SET — but the trigger is the load-bearing defense.
CREATE OR REPLACE FUNCTION public.memberships_protect_profile_id_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.profile_id IS DISTINCT FROM NEW.profile_id THEN
        RAISE EXCEPTION 'memberships.profile_id is immutable post-INSERT (ADR-0036 §RLS, premortem R9)'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER memberships_profile_id_immutable_trigger
    BEFORE UPDATE ON memberships
    FOR EACH ROW
    EXECUTE FUNCTION public.memberships_protect_profile_id_immutable();

COMMENT ON COLUMN memberships.profile_id IS
    'Immutable post-INSERT. Enforced by memberships_profile_id_immutable_trigger '
    '(raises SQLSTATE 42501 on UPDATE attempts that rewrite this column). The '
    'Slice 2 membership-override server action MUST WHERE on this column, never '
    'UPDATE it. Per ADR-0036 §RLS premortem R9.';

-- =============================================================================
-- 3. time_wallets — members read self; cashier+ read all; writes via trigger
-- =============================================================================

CREATE POLICY time_wallets_self_or_cashier_read ON time_wallets
    FOR SELECT
    USING (profile_id = auth.uid() OR auth.role_at_least('cashier'));

-- =============================================================================
-- 4. time_ledger — members read self; cashier+ read all; cashier+ INSERT
-- =============================================================================

CREATE POLICY time_ledger_self_or_cashier_read ON time_ledger
    FOR SELECT
    USING (profile_id = auth.uid() OR auth.role_at_least('cashier'));

-- cashier+ INSERT policy. PER-MEMBER AUTHORITY IS NOT GATED HERE — see the
-- COMMENT below for the load-bearing reasoning.
CREATE POLICY time_ledger_cashier_insert ON time_ledger
    FOR INSERT
    WITH CHECK (auth.role_at_least('cashier'));

COMMENT ON POLICY time_ledger_cashier_insert ON time_ledger IS
    'Gates role of inserter ONLY, NOT the target profile_id. Authority matrix '
    'enforcement (who can credit/debit whom, and by how much) lives in '
    'lib/payments/authority.ts. DO NOT tighten to include actor_id = auth.uid() '
    '— that breaks the service-role webhook write path (the webhook handler '
    'runs as service-role with actor_id resolved post-validation). Per '
    'ADR-0036 §RLS premortem R6.';

-- =============================================================================
-- 5. refund_requests — manager+ read AND insert; writes service-role only
-- =============================================================================

CREATE POLICY refund_requests_manager_read ON refund_requests
    FOR SELECT
    USING (auth.role_at_least('manager'));

CREATE POLICY refund_requests_manager_insert ON refund_requests
    FOR INSERT
    WITH CHECK (auth.role_at_least('manager'));

-- Premortem R5 — NO UPDATE policy on refund_requests is LOAD-BEARING.
--
-- The Slice 2 webhook handler will UPDATE refund_requests.status from
-- 'pending' → 'succeeded'/'failed'/'settled' via the service-role context;
-- service-role BYPASSRLS handles the UPDATE without a policy. The absence
-- of any FOR UPDATE policy on this table is the structural enforcement that
-- only the webhook handler can transition status. The slice-1→slice-2
-- handoff worker MUST NOT reactively add an UPDATE policy (e.g.,
-- "refund_requests_status_update_manager") — that decision requires
-- re-engaging the authority matrix in lib/payments/authority.ts and the
-- audit-pairing invariant per ADR-0006.
COMMENT ON TABLE refund_requests IS
    'Per ADR-0036 (Slice 1) + ADR-0027 (refund authority matrix). Manager+ INSERTs '
    'via the cookie-scoped supabase client during refund initiation. The fine-'
    'grained authority tier (cashier ≤ $25 time-bank refunds, manager ≤ $200, '
    'owner > $200, manager for current-period membership, owner for prior-period) '
    'is enforced in lib/payments/authority.ts — NOT in RLS. Writes after INSERT '
    'are service-role-only via the Slice 2 webhook handler; '
    'do not add an UPDATE policy reactively — '
    'that decision requires re-engaging the authority matrix in '
    'lib/payments/authority.ts and the audit-pairing invariant. '
    'Per ADR-0036 §RLS premortem R5.';

-- =============================================================================
-- 6. stripe_webhook_events — manager+ read; writes service-role only
-- =============================================================================

CREATE POLICY stripe_webhook_events_manager_read ON stripe_webhook_events
    FOR SELECT
    USING (auth.role_at_least('manager'));

-- =============================================================================
-- 7. disputes — manager+ read; writes service-role only
-- =============================================================================

CREATE POLICY disputes_manager_read ON disputes
    FOR SELECT
    USING (auth.role_at_least('manager'));

-- =============================================================================
-- INVARIANTS (load-bearing absences — DO NOT add these in a future migration
-- without re-engaging the authority matrix in lib/payments/authority.ts and
-- the audit-pairing invariant in ADR-0006):
--
--   - NO DELETE policy on any of the 7 tables (append-only or service-role-
--     only per ADR-0006 §append-only and ADR-0011 §ledger immutability).
--   - NO INSERT policy on payments, disputes, stripe_webhook_events (service-
--     role-only write path via the Slice 2 webhook handler — BYPASSRLS).
--   - NO INSERT policy on time_wallets (rows are written exclusively by the
--     time_ledger_balance_trigger from 0012 — SECURITY DEFINER + service-role).
--   - NO UPDATE policy on payments, time_ledger, refund_requests, disputes,
--     stripe_webhook_events (write-once from service-role webhook).
--   - The only UPDATE policy is memberships_manager_write — backs the
--     Slice 2 membership-override surface.
-- =============================================================================
