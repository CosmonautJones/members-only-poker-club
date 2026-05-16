-- ADR-0036: Payment Management Console (Slice 1 — Schema substrate C).
-- Spec: docs/specs/0036-payment-management-console-implementation.md AC6, AC9.
-- Acceptance criteria covered by this migration: AC6 (structural), AC9
-- (migrate:check passes — purely additive). Verified by
-- tests/migrations/disputes-shape.test.ts (regex + AST + pglite-applies tiers).
--
-- Scope: additive schema changes only. One new table (disputes) with no
-- indexes (the table is minimal — three-cards-on-overview cardinality is
-- low and queries are bounded by status), ENABLE+FORCE RLS at end of file.
-- No policies — policies land in 0016_payments_rls.sql per the slice plan.
--
-- Premortem coupling (.conductor/36/returns/0004-premortem-schema.md):
--   R8 — RLS-off window → ENABLE + FORCE row level security at end of THIS
--        migration so default-deny is in place BEFORE 0016 lands policies.
--        Service-role retains BYPASSRLS for the webhook write path.
--   R9 — FK ON DELETE behavior → explicit `REFERENCES profiles(id) ON DELETE
--        NO ACTION` matches the 0005_privacy_requests.sql convention. Default
--        is NO ACTION but the explicit clause documents the contract and is
--        reviewable.
--
-- Synthesis D4 (.conductor/36/premortem-synthesis.md): each of 0008..0015
-- ends with ENABLE + FORCE so any service-role write between the table-
-- creation migration and the policy migration cannot bypass RLS. The default-
-- deny is in place before any row lands.

-- Schema column naming deviation (spec §"Schema column naming"): the ADR
-- (§Data model) names this column `member_id`; the spec deviates to
-- `profile_id` for consistency with privacy_requests.profile_id (0005),
-- existing admin queries, and the RLS predicate symmetry
-- `profile_id = auth.uid()`. profile_id is INTENTIONALLY NULLABLE here
-- because a dispute may arrive via webhook before the customer-to-profile
-- join is resolvable (the webhook handler does a best-effort lookup by
-- Stripe customer id; if no profile matches, the row is still written so
-- the overview count is accurate). dispute-response UI is deferred per
-- ADR-0027 §open-questions.

CREATE TABLE disputes (
    stripe_dispute_id text        PRIMARY KEY,                                                -- Stripe `dp_*` / `du_*`
    payment_intent_id text        NOT NULL,                                                   -- the disputed PI
    profile_id        uuid        REFERENCES profiles(id) ON DELETE NO ACTION,                -- nullable; best-effort join via customer
    amount_cents      bigint      NOT NULL,
    status            text        NOT NULL,                                                   -- 'needs_response'|'under_review'|'won'|'lost'|'warning_needs_response'|...
    reason            text,                                                                   -- 'fraudulent'|'unrecognized'|...
    outcome           text,                                                                   -- 'won'|'lost'|null while open
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE disputes IS
    'Per ADR-0036 / ADR-0027. Minimal local mirror of Stripe disputes. '
    'Written ONLY by the webhook handler in Slice 2 of ADR-0036 (charge.'
    'dispute.created / charge.dispute.closed); read by /admin/payments for '
    'the open-disputes count card. Dispute response UI is DEFERRED per '
    'ADR-0027 §open-questions — managers respond to disputes via the Stripe '
    'Dashboard, NOT via this app. This table exists so the overview can show '
    'a count and link out. profile_id is nullable: best-effort join via '
    'Stripe customer; some disputes may land without a resolved member if '
    'the customer mapping is missing. RLS-enabled with FORCE — default-deny '
    'posture until 0016 lands policies; service-role retains BYPASSRLS for '
    'the webhook write path. Column naming deviation: profile_id (this '
    'implementation) vs member_id (ADR-0036 §Data model prose) — see spec '
    '§"Schema column naming".';

-- ENABLE + FORCE row-level security (premortem R8 / synthesis D4).
--
-- Per the schema-slice premortem D4 amendment: each table-creating migration
-- enables AND forces RLS in its OWN file so the "RLS-off write window
-- between table-create and policy-create" is zero. Policies (CREATE POLICY)
-- land in 0016_payments_rls.sql; this migration ships only the default-deny
-- posture. disputes gets a manager+ read policy there (writes are service-
-- role-only — no INSERT/UPDATE policy ever).
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes FORCE  ROW LEVEL SECURITY;
