-- ADR-0036: Payment Management Console (Slice 1 — Schema substrate C).
-- Spec: docs/specs/0036-payment-management-console-implementation.md AC8, AC9.
-- Acceptance criteria covered by this migration: AC8 (structural), AC9
-- (migrate:check passes — purely additive). Verified by
-- tests/migrations/refund-requests-shape.test.ts (regex + AST +
-- pglite-applies tiers).
--
-- Scope: additive schema changes only. One new table (refund_requests)
-- with two indexes (profile + status), table-level UNIQUE on
-- idempotency_key, strict-positive CHECK on amount_cents, ENABLE+FORCE RLS
-- at end of file. No policies — policies land in 0016_payments_rls.sql
-- per the slice plan.
--
-- migration-review: blocking-index-approved
-- Justification for blocking-index: refund_requests is created EMPTY in this
-- same migration. CREATE INDEX on an empty, newly-created table acquires
-- the lock for microseconds. Same posture as 0003, 0005, 0008, 0014.
--
-- Premortem coupling (.conductor/36/returns/0004-premortem-schema.md):
--   R6 — Zero/negative refund slips past form validation → strict-positive
--        CHECK (amount_cents > 0); a future form-validation regression
--        cannot land $0 / negative refunds. DO NOT relax to `>= 0`.
--   R8 — RLS-off window → ENABLE + FORCE row level security at end of THIS
--        migration so default-deny is in place BEFORE 0016 lands policies.
--   R9 — FK ON DELETE behavior → every FK explicitly declares `ON DELETE
--        NO ACTION` (target_payment_id → payments, profile_id + actor_id →
--        profiles) matching the 0005_privacy_requests.sql convention.

-- Schema column naming deviation (spec §"Schema column naming"): the ADR
-- (§Data model) names the member column `member_id`; the spec deviates to
-- `profile_id` for consistency with privacy_requests.profile_id (0005),
-- existing admin queries, and the RLS predicate symmetry
-- `profile_id = auth.uid()`.

CREATE TABLE refund_requests (
    id                bigserial   PRIMARY KEY,
    target_payment_id bigint      NOT NULL REFERENCES payments(id) ON DELETE NO ACTION,
    profile_id        uuid        NOT NULL REFERENCES profiles(id) ON DELETE NO ACTION,
    actor_id          uuid        NOT NULL REFERENCES profiles(id) ON DELETE NO ACTION,  -- staff member who initiated
    refund_type       text        NOT NULL,                                              -- 'time_bank'|'membership_current'|'membership_previous'
    amount_cents      bigint      NOT NULL,
    reason            text        NOT NULL,                                              -- 'duplicate'|'fraudulent'|'requested_by_customer'|'goodwill'|'other'
    reason_note       text,
    status            text        NOT NULL DEFAULT 'pending',                            -- 'pending'|'stripe_pending'|'settled'|'failed'|'denied'
    stripe_refund_id  text,
    stripe_error      jsonb,
    idempotency_key   text        NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    settled_at        timestamptz,

    -- Unique idempotency_key (ADR-0005). Slice 2 webhook handler treats a
    -- 23505 SQLSTATE collision as a retry → returns the existing row instead
    -- of redoing the Stripe refund call. Form-mount UUID v4 is the source.
    CONSTRAINT refund_requests_idempotency_key_unique UNIQUE (idempotency_key),

    -- INVARIANT (premortem R6 / ADR-0004): refunds MUST be strictly positive.
    -- A zero-cent refund is a form-validation bug worth catching at the DB
    -- layer; a negative-cent refund would be a $credit$ — semantically
    -- impossible in this column. DO NOT relax to `>= 0`.
    CONSTRAINT refund_requests_amount_positive CHECK (amount_cents > 0)
);

COMMENT ON TABLE refund_requests IS
    'Per ADR-0036 / ADR-0005 / ADR-0027. Refund operations queue + history. '
    'Slice 1 of ADR-0036 ships the schema + RLS only; the writer (server '
    'action initiateRefund) lands in Slice 2 and the webhook handler updates '
    'rows to status=settled. Idempotency anchor is the form-mount UUID v4 '
    '(ADR-0005). The ADR-0027 authority matrix (cashier ≤ $25, manager ≤ '
    '$200, owner all) is enforced by lib/payments/authority.ts in lib code, '
    'NOT by RLS — RLS only gates "who can INSERT at all" = manager+ (the '
    'fine-grained tier is a runtime guard so unauthorized attempts produce '
    'an InsufficientAuthorityError with audit context, not a silent RLS '
    'rejection). amount_cents is strictly positive — see '
    'refund_requests_amount_positive CHECK. RLS-enabled with FORCE — default-'
    'deny posture until 0016 lands policies; service-role retains BYPASSRLS '
    'for the webhook write path. Column naming deviation: profile_id (this '
    'implementation) vs member_id (ADR-0036 §Data model prose) — see spec '
    '§"Schema column naming".';

-- Indexes (ADR-0036 §Data model).
--
-- profile_idx serves the admin member-detail page (refunds for a member,
-- most-recent-first) and the per-member refund history surface (Slice 2+).
-- status_idx serves the refunds queue (pending → stripe_pending → settled
-- pipeline view + failed/denied investigation queue).
CREATE INDEX refund_requests_profile_idx ON refund_requests (profile_id, created_at DESC);
CREATE INDEX refund_requests_status_idx  ON refund_requests (status, created_at DESC);

-- ENABLE + FORCE row-level security (premortem R8 / synthesis D4).
--
-- Per the schema-slice premortem D4 amendment: each table-creating migration
-- enables AND forces RLS in its OWN file. refund_requests gets manager+
-- READ + INSERT policies in 0016 (the fine-grained authority tier is
-- runtime, not RLS).
ALTER TABLE refund_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_requests FORCE  ROW LEVEL SECURITY;
