-- ADR-0036: Payment Management Console (Slice 1 — Schema substrate B).
-- Spec: docs/specs/0036-payment-management-console-implementation.md AC4, AC9.
-- Acceptance criteria covered by this migration: AC4 (structural), AC9
-- (migrate:check passes — purely additive). Verified by
-- tests/migrations/time-bank-shape.test.ts (regex + AST + pglite-applies tiers).
--
-- Scope: additive schema changes only. One new table (time_ledger) with
-- TWO indexes (profile_idx + action_idx), TWO table-level CONSTRAINTs
-- (UNIQUE idempotency_key + CHECK payment-or-manual), and ENABLE+FORCE
-- RLS at end of file. No policies — policies land in 0016_payments_rls.sql
-- per the slice plan.
--
-- migration-review: blocking-index-approved
-- Justification for blocking-index: time_ledger is created EMPTY in this
-- same migration. CREATE INDEX on an empty, newly-created table acquires
-- the lock for microseconds and has no production traffic to block (the
-- table did not exist 2 statements earlier). CONCURRENTLY is not an option
-- because Supabase wraps each migration file in a single transaction and
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction. Same posture
-- as 0003, 0005, 0008, 0009.
--
-- Append-only invariant (ADR-0011): time_ledger rows are NEVER updated or
-- deleted. Corrections are NEW rows with negative amount_minutes. The RLS
-- migration 0016 will add a SELECT policy and an INSERT policy but
-- intentionally NO UPDATE or DELETE policy — the absence of those policies
-- is the structural enforcement. The trigger in 0012 must NEVER UPDATE or
-- DELETE time_ledger rows from its function body (premortem R2 — shape
-- test asserts the literal strings `UPDATE time_ledger` and
-- `DELETE FROM time_ledger` do NOT appear in the trigger function body).
--
-- Premortem coupling (.conductor/36/returns/0004-premortem-schema.md):
--   R2  — time_ledger mutation backdoor → COMMENT ON TABLE pins the
--          append-only invariant; absence of UPDATE/DELETE policy in 0016
--          is the structural enforcement; trigger function body in 0012
--          must NOT contain `UPDATE time_ledger` or `DELETE FROM time_ledger`.
--   R5  — FK orphan ledger entries → explicit `REFERENCES payments(id) ON
--          DELETE NO ACTION` on source_payment_id, plus CHECK constraint
--          time_ledger_payment_or_manual enforcing that every row has either
--          a Stripe payment to link OR a human actor to attribute (never
--          neither).
--   R8  — RLS-off window → ENABLE + FORCE row level security at end of
--          THIS migration so default-deny is in place BEFORE 0016 lands
--          policies. Service-role retains BYPASSRLS for the webhook write
--          path.
--   R9  — FK ON DELETE behavior → explicit `REFERENCES profiles(id) ON
--          DELETE NO ACTION` on profile_id and actor_id matches the
--          0005_privacy_requests.sql convention.
--   R10 — idempotency-key collision invisibility → bare-column UNIQUE on
--          idempotency_key (per ADR-0005 "key is per-operation globally").
--          Shape test asserts duplicate INSERT raises SQLSTATE '23505'
--          specifically so Slice 2 handler code can pattern-match on the
--          SQLSTATE rather than the error message.

-- Schema column naming deviation (spec §"Schema column naming"): the ADR
-- (§Data model) names the member FK `member_id`; the spec deviates to
-- `profile_id` for consistency with privacy_requests.profile_id (0005),
-- payments.profile_id (0008), memberships.profile_id (0009),
-- time_wallets.profile_id (0010), and RLS predicate symmetry.

CREATE TABLE time_ledger (
    id                bigserial   PRIMARY KEY,
    profile_id        uuid        NOT NULL REFERENCES profiles(id) ON DELETE NO ACTION,
    action            text        NOT NULL,                                                  -- enum CHECK below
    amount_minutes    bigint      NOT NULL,                                                  -- positive = credit, negative = debit
    source_payment_id bigint      REFERENCES payments(id) ON DELETE NO ACTION,               -- null for manual entries (paired with CHECK)
    reason            text,                                                                  -- free text for manual entries
    actor_id          uuid        REFERENCES profiles(id) ON DELETE NO ACTION,               -- null = system (webhook-driven, paired with CHECK)
    idempotency_key   text        NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),

    -- INVARIANT (ADR-0005 + premortem R10): bare-column UNIQUE on
    -- idempotency_key — retries of the same logical operation collide
    -- with SQLSTATE 23505 and the Slice 2 handler short-circuits
    -- idempotently. The shape test asserts the specific SQLSTATE so
    -- handler code can pattern-match on the code rather than the message.
    CONSTRAINT time_ledger_idempotency_key_unique UNIQUE (idempotency_key),

    -- INVARIANT (ADR-0011): action MUST be one of eight enum values.
    -- The CHECK is the structural enforcement; application code at
    -- lib/payments/* validates BEFORE the INSERT but the CHECK catches
    -- bypass paths (raw SQL backfill, future server actions, etc.).
    CONSTRAINT time_ledger_action_enum CHECK (action IN (
        'purchase',
        'promo_bonus',
        'refund',
        'redemption',
        'manual_credit',
        'manual_debit',
        'dormancy_conversion',
        'escheatment'
    )),

    -- INVARIANT (premortem R5): every row MUST have either a Stripe
    -- payment to link OR a human actor to attribute, never neither. A
    -- row with both source_payment_id IS NULL AND actor_id IS NULL would
    -- be an un-attributable ghost ledger entry — audit-log queries
    -- "who/what caused this row?" would have no answer. Webhook-written
    -- rows always have source_payment_id (the originating payment_intent);
    -- manual entries always have actor_id (the staff member who issued).
    CONSTRAINT time_ledger_payment_or_manual CHECK (
        (source_payment_id IS NULL AND actor_id IS NOT NULL)
        OR
        (source_payment_id IS NOT NULL)
    )
);

COMMENT ON TABLE time_ledger IS
    'Append-only ledger of every time-bank credit and debit. Per ADR-0011 / '
    'ADR-0036. The wallet balance (time_wallets.balance_minutes) is a '
    'derived projection maintained by a trigger '
    '(0012_time_ledger_balance_trigger.sql). '
    'INVARIANT (ADR-0011): APPEND-ONLY. NO UPDATE or DELETE policies, ever. '
    'No trigger function may UPDATE or DELETE time_ledger rows. Corrections '
    'are NEW rows with negative amount_minutes (compensating entries). The '
    'absence of UPDATE/DELETE policies in 0016_payments_rls.sql is the '
    'structural enforcement; the application layer must never bypass via '
    'service-role for non-correction reasons. RLS-enabled with FORCE — '
    'default-deny posture until 0016 lands policies; service-role retains '
    'BYPASSRLS for webhook writes. Column naming deviation: profile_id '
    '(this implementation) vs member_id (ADR-0036 §Data model prose) — see '
    'spec §"Schema column naming".';

-- Indexes (ADR-0036 §Data model).
--
-- time_ledger_profile_idx serves the admin member-detail page and the
-- AC5 trigger function (which SUMs amount_minutes WHERE profile_id = ...).
-- time_ledger_action_idx serves the /admin/payments overview cards ("recent
-- refunds", "recent manual credits") and the reconciliation viewer.
-- Both lead with the most-selective filter column and trail with
-- created_at DESC so the common "most recent" reads are time-ordered.
CREATE INDEX time_ledger_profile_idx ON time_ledger (profile_id, created_at DESC);
CREATE INDEX time_ledger_action_idx  ON time_ledger (action, created_at DESC);

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
-- the Postgres-role attribute, so webhook-handler writes and the AC5
-- trigger's SECURITY DEFINER function remain functional even with no
-- policies present.
ALTER TABLE time_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_ledger FORCE  ROW LEVEL SECURITY;
