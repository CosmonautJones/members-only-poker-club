-- ADR-0036: Payment Management Console (Slice 1 — Schema substrate B).
-- Spec: docs/specs/0036-payment-management-console-implementation.md AC3, AC9.
-- Acceptance criteria covered by this migration: AC3 (structural), AC9
-- (migrate:check passes — purely additive). Verified by
-- tests/migrations/time-bank-shape.test.ts (regex + AST + pglite-applies tiers).
--
-- Scope: additive schema changes only. One new table (time_wallets) with a
-- GENERATED ALWAYS AS ... STORED projection column (balance_cents) and
-- ENABLE+FORCE RLS at end of file. No indexes (PRIMARY KEY on profile_id
-- already covers the only access pattern: "look up this member's wallet").
-- No policies — policies land in 0016_payments_rls.sql per the slice plan.
--
-- Premortem coupling (.conductor/36/returns/0004-premortem-schema.md):
--   R4  — GENERATED column drift on fallback → pglite 0.4.5 ACCEPTS
--          `GENERATED ALWAYS AS ... STORED` (verified by an in-tree
--          experiment on 2026-05-16: `CREATE TABLE probe (minutes bigint
--          DEFAULT 0, cents bigint GENERATED ALWAYS AS (...) STORED)`
--          succeeded, all balance_cents values matched balance_minutes*20
--          exactly, and direct `UPDATE probe SET cents = 999` was
--          rejected with `column "cents" can only be updated to DEFAULT`).
--          Therefore this migration ships the GENERATED variant; the
--          trigger-update fallback documented in the spec is NOT needed.
--   R8  — RLS-off window → ENABLE + FORCE row level security at end of
--          THIS migration so default-deny is in place BEFORE 0016 lands
--          policies. Service-role retains BYPASSRLS for the webhook write
--          path (the AC5 trigger function is SECURITY DEFINER).
--   R9  — FK ON DELETE behavior → explicit `REFERENCES profiles(id) ON
--          DELETE NO ACTION` matches the 0005_privacy_requests.sql
--          convention. Default is NO ACTION but the explicit clause
--          documents the contract and is reviewable.
--   R11 — GENERATED expression precision drift → HOURLY_RATE_CENTS=1200
--          is a literal in the SQL (NOT a variable, NOT an env var). The
--          rate is the load-bearing constant from lib/money/types.ts;
--          drifting it is a deliberate ADR-0011 amendment, not a schema
--          tweak. At rate=1200 ($12/hour, $0.20/minute), the expression
--          `round((minutes::numeric / 60.0) * 1200)::bigint` is exact for
--          every integer minute because (m * 1200) / 60 = m * 20. The
--          numeric cast and round() are defensive against future rate
--          changes that introduce non-integer arithmetic.
--
-- Schema column naming deviation (spec §"Schema column naming"): the ADR
-- (§Data model) names this column `member_id`; the spec deviates to
-- `profile_id` for consistency with privacy_requests.profile_id (0005),
-- existing admin queries (`.eq('profile_id', ...)`), payments.profile_id
-- (0008), memberships.profile_id (0009), and the RLS predicate symmetry
-- `profile_id = auth.uid()`.

CREATE TABLE time_wallets (
    profile_id        uuid        PRIMARY KEY REFERENCES profiles(id) ON DELETE NO ACTION,
    balance_minutes   bigint      NOT NULL DEFAULT 0,                                        -- canonical ledger projection (ADR-0011)
    balance_cents     bigint      GENERATED ALWAYS AS (
                                    (round((balance_minutes::numeric / 60.0) * 1200))::bigint
                                  ) STORED,                                                  -- DO NOT WRITE — derived; see comment below
    last_activity_at  timestamptz,                                                           -- ADR-0011 dormancy clock
    updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE time_wallets IS
    'Per-member time-bank balance. Per ADR-0011 / ADR-0036. balance_minutes '
    'is the canonical ledger projection (the running SUM of time_ledger.amount_minutes '
    'maintained by the trigger in 0012_time_ledger_balance_trigger.sql); balance_cents '
    'is a generated read-only projection at HOURLY_RATE_CENTS=1200 ($12/hour, $0.20/minute) '
    'for the existing admin member-detail page. RLS-enabled with FORCE — default-deny '
    'posture until 0016 lands policies; service-role retains BYPASSRLS for the AC5 '
    'trigger function (SECURITY DEFINER) which upserts wallet rows on every ledger '
    'insert. Column naming deviation: profile_id (this implementation) vs member_id '
    '(ADR-0036 §Data model prose) — see spec §"Schema column naming".';

-- Load-bearing column comment (premortem R4 + R11). The GENERATED column
-- is read-only at the DB layer; Postgres rejects direct UPDATEs with
-- `column "balance_cents" can only be updated to DEFAULT`. Application
-- code reads this column but MUST NOT attempt to write it. The literal
-- `1200` in the expression pins HOURLY_RATE_CENTS per lib/money/types.ts;
-- changing the rate requires an ADR-0011 amendment, NOT a schema tweak.
-- The numeric cast and round() are defensive against future rate changes
-- introducing non-integer arithmetic — at rate=1200 the math is exact for
-- every integer minute (m * 1200 / 60 = m * 20).
COMMENT ON COLUMN time_wallets.balance_cents IS
    'GENERATED ALWAYS AS — DO NOT WRITE. Derived from balance_minutes at '
    'HOURLY_RATE_CENTS=1200 (lib/money/types.ts). The Postgres engine '
    'rejects direct UPDATEs to this column. Rate changes require an '
    'ADR-0011 amendment.';

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
-- the Postgres-role attribute, so the AC5 trigger function (which runs
-- SECURITY DEFINER) and direct webhook-handler writes remain functional
-- even with no policies present.
ALTER TABLE time_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_wallets FORCE  ROW LEVEL SECURITY;
