-- ADR-0036: Payment Management Console (Slice 1 — Schema substrate A).
-- Spec: docs/specs/0036-payment-management-console-implementation.md AC1, AC9.
-- Acceptance criteria covered by this migration: AC1 (structural), AC9
-- (migrate:check passes — purely additive). Verified by
-- tests/migrations/payments-shape.test.ts (regex + AST + pglite-applies tiers).
--
-- Scope: additive schema changes only. One new table (payments) with three
-- indexes (one partial UNIQUE), three table-level CONSTRAINTs (UNIQUE +
-- two CHECKs), ENABLE+FORCE RLS at end of file. No policies — policies land
-- in 0016_payments_rls.sql per the slice plan.
--
-- migration-review: blocking-index-approved
-- Justification for blocking-index: payments is created EMPTY in this same
-- migration. CREATE INDEX on an empty, newly-created table acquires the lock
-- for microseconds and has no production traffic to block (the table did not
-- exist 2 statements earlier). CONCURRENTLY is not an option because
-- Supabase wraps each migration file in a single transaction and CREATE
-- INDEX CONCURRENTLY cannot run inside a transaction. The scanner cannot
-- distinguish "new table + immediate index" from "existing hot table +
-- blocking index" so we acknowledge explicitly. Same posture as 0003 and 0005.
--
-- Premortem coupling (.conductor/36/returns/0004-premortem-schema.md):
--   R1 — currency drift → payments_currency_usd_only CHECK (currency = 'usd')
--        beyond the ADR-0004 prose; webhook handler must NOT relax this even
--        if Stripe Connect (Slice 4) introduces multi-currency. A separate
--        ADR amendment to ADR-0004 is required to add additional allowed
--        currencies — DO NOT add `currency IN ('usd', 'cad', ...)` here.
--   R3 — idempotency_key NULL bypass → partial UNIQUE index on
--        idempotency_key WHERE idempotency_key IS NOT NULL (NULLs do NOT
--        collide in PostgreSQL UNIQUE, so a bare UNIQUE column constraint
--        would silently allow webhook double-write to land duplicate
--        NULL-keyed rows). Plus payments_idem_or_audit_trail CHECK forcing
--        at least one of idempotency_key / stripe_event_id to be present.
--   R8 — RLS-off window → ENABLE + FORCE row level security at end of THIS
--        migration so default-deny is in place BEFORE 0016 lands policies.
--        Service-role retains BYPASSRLS for the webhook write path.
--   R9 — FK ON DELETE behavior → explicit `REFERENCES profiles(id) ON DELETE
--        NO ACTION` matches the 0005_privacy_requests.sql convention. Default
--        is NO ACTION but the explicit clause documents the contract and is
--        reviewable.

-- Schema column naming deviation (spec §"Schema column naming"): the ADR
-- (§Data model) names this column `member_id`; the spec deviates to
-- `profile_id` for consistency with privacy_requests.profile_id (0005),
-- existing admin queries (`.eq('profile_id', ...)`), and the RLS predicate
-- symmetry `profile_id = auth.uid()`. A follow-up ADR amendment will record
-- the deviation; this spec is the load-bearing source of truth.

CREATE TABLE payments (
    id               bigserial   PRIMARY KEY,
    stripe_object_id text        NOT NULL,                                     -- payment_intent_id, charge_id, etc.
    kind             text        NOT NULL,                                     -- 'membership' | 'time_topup' | 'refund' | 'other'
    profile_id       uuid        NOT NULL REFERENCES profiles(id) ON DELETE NO ACTION,
    amount_cents     bigint      NOT NULL,
    currency         text        NOT NULL DEFAULT 'usd',                       -- guard column; CHECK below enforces
    status           text        NOT NULL,                                     -- 'succeeded'|'failed'|'pending'|'refunded'|'partially_refunded'
    stripe_event_id  text,                                                     -- the webhook event.id that wrote this row
    raw_event        jsonb,                                                    -- full Stripe event payload (for forensics)
    idempotency_key  text,                                                     -- = stripe_event_id for webhook-written rows; partial UNIQUE below
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),

    -- Composite uniqueness on (stripe_object_id, kind) — a single
    -- payment_intent_id is unique within its kind ('membership' vs
    -- 'time_topup' etc.). The ADR §Data model pins this constraint.
    CONSTRAINT payments_stripe_object_kind_unique UNIQUE (stripe_object_id, kind),

    -- INVARIANT (ADR-0004 + premortem R1): currency MUST equal 'usd'. DO NOT
    -- relax this to `currency IN ('usd', 'cad', ...)` without an ADR amendment
    -- to ADR-0004. The webhook handler also raises SEV2 if Stripe ever sends
    -- a non-usd charge; this CHECK is the structural belt-and-suspenders.
    CONSTRAINT payments_currency_usd_only CHECK (currency = 'usd'),

    -- INVARIANT (premortem R3): every row MUST carry at least one
    -- traceability anchor. Webhook-written rows use stripe_event_id; manual
    -- backfill paths supply idempotency_key. A row with both NULL would be
    -- un-deduplicable and un-traceable.
    CONSTRAINT payments_idem_or_audit_trail CHECK (
        idempotency_key IS NOT NULL OR stripe_event_id IS NOT NULL
    )
);

COMMENT ON TABLE payments IS
    'Per ADR-0010 / ADR-0011 / ADR-0036. Local mirror of Stripe '
    'payment_intent / charge events. Written ONLY by the webhook handler in '
    'Slice 2 of ADR-0036; read by /admin/payments and the admin member-detail '
    'page. RLS-enabled with FORCE — default-deny posture until 0016 lands '
    'policies; service-role retains BYPASSRLS for the webhook write path. '
    'Column naming deviation: profile_id (this implementation) vs member_id '
    '(ADR-0036 §Data model prose) — see spec §"Schema column naming".';

COMMENT ON COLUMN payments.currency IS
    'USD-only per ADR-0004. The payments_currency_usd_only CHECK constraint '
    'enforces the guard at the DB layer; webhook handler raises SEV2 alert '
    'if Stripe ever sends a non-usd charge. Multi-currency support requires '
    'a separate ADR amendment to ADR-0004 — DO NOT add additional allowed '
    'currencies here.';

-- Indexes (ADR-0036 §Data model).
--
-- payments_profile_idx serves the admin member-detail page (recent payments
-- for a member) AND the member-facing /profile/billing page (self-view).
-- payments_kind_status_idx serves the /admin/payments overview cards
-- ("recent payments by kind" + "stuck pending payments by status").
-- Both lead with the most-selective filter column and trail with
-- created_at DESC so the common "most recent" reads are time-ordered.
CREATE INDEX payments_profile_idx     ON payments (profile_id, created_at DESC);
CREATE INDEX payments_kind_status_idx ON payments (kind, status, created_at DESC);

-- Partial UNIQUE on idempotency_key (premortem R3). NULL is allowed by the
-- column type (webhook-written rows lean on stripe_event_id for traceability)
-- but ONLY for the not-null cohort do we enforce uniqueness. PostgreSQL's
-- treatment of NULLs in UNIQUE is "NULLs are distinct from each other" so
-- without the partial WHERE clause, three NULL-keyed rows would coexist
-- silently — a Stripe-retry double-write would not raise 23505.
CREATE UNIQUE INDEX payments_idempotency_key_unique
    ON payments (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- ENABLE + FORCE row-level security (premortem R8).
--
-- Per the schema-slice premortem D4 amendment: each table-creating migration
-- enables AND forces RLS in its OWN file so the "RLS-off write window
-- between table-create and policy-create" is zero. Policies (CREATE POLICY)
-- land in 0016_payments_rls.sql; this migration ships only the default-deny
-- posture.
--
-- FORCE applies RLS to the table-owner connection so the pglite WASM test
-- substrate (which runs as owner by default) sees the same policy
-- enforcement as production Supabase. Service-role retains BYPASSRLS via
-- the Postgres-role attribute, so the webhook handler's writes remain
-- functional even with no policies present.
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE  ROW LEVEL SECURITY;
