-- ADR-0036: Payment Management Console (Slice 1 — Schema substrate A).
-- Spec: docs/specs/0036-payment-management-console-implementation.md AC2, AC9.
-- Acceptance criteria covered by this migration: AC2 (structural), AC9
-- (migrate:check passes — purely additive). Verified by
-- tests/migrations/memberships-shape.test.ts (regex + AST + pglite-applies tiers).
--
-- Scope: additive schema changes only. One new table (memberships) with one
-- index on (status, current_period_end), ENABLE+FORCE RLS at end of file.
-- No policies — policies land in 0016_payments_rls.sql per the slice plan.
--
-- migration-review: blocking-index-approved
-- Justification for blocking-index: memberships is created EMPTY in this
-- same migration. CREATE INDEX on an empty, newly-created table acquires the
-- lock for microseconds. Same posture as 0003 and 0005 and 0008.
--
-- Premortem coupling (.conductor/36/returns/0004-premortem-schema.md):
--   R8 — RLS-off window → ENABLE + FORCE row level security at end of THIS
--        migration so default-deny is in place BEFORE 0016 lands policies.
--   R9 — FK ON DELETE behavior → explicit `REFERENCES profiles(id) ON DELETE
--        NO ACTION` matches the 0005_privacy_requests.sql convention.

-- Schema column naming deviation (spec §"Schema column naming"): the ADR
-- (§Data model) names this column `member_id`; the spec deviates to
-- `profile_id` for consistency with privacy_requests.profile_id (0005),
-- existing admin queries, and the RLS predicate symmetry
-- `profile_id = auth.uid()`. profile_id doubles as PRIMARY KEY since each
-- profile has at most one membership row (mirrors a Stripe customer's
-- single subscription state).

CREATE TABLE memberships (
    profile_id             uuid        PRIMARY KEY REFERENCES profiles(id) ON DELETE NO ACTION,
    stripe_customer_id     text        NOT NULL,
    stripe_subscription_id text,                                                              -- null if never subscribed
    status                 text        NOT NULL,                                              -- mirrors Stripe subscription.status
    collection_method      text        NOT NULL DEFAULT 'charge_automatically',               -- or 'send_invoice'
    current_period_start   timestamptz,
    current_period_end     timestamptz,
    past_due_since         timestamptz,                                                       -- nullable; set by invoice.payment_failed
    cancel_at_period_end   boolean     NOT NULL DEFAULT false,
    raw_event              jsonb,                                                             -- last Stripe sub object (debugging aid)
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE memberships IS
    'Per ADR-0010 / ADR-0036. Local mirror of Stripe Subscription state. '
    'Written by the webhook handler (Slice 2 of ADR-0036) and the membership-'
    'override server action (Slice 2). Read by /admin/payments and the admin '
    'member-detail page. RLS-enabled with FORCE — default-deny until 0016 '
    'lands policies; service-role retains BYPASSRLS for webhook + override '
    'write paths. Column naming deviation: profile_id (this implementation) '
    'vs member_id (ADR-0036 §Data model prose) — see spec §"Schema column '
    'naming". profile_id is both PRIMARY KEY and FK because each profile has '
    'at most one membership row at a time (mirrors one Stripe subscription).';

-- Index on (status, current_period_end) (ADR-0036 §Data model).
--
-- The /admin/payments overview surface filters by status='past_due' or
-- status='canceled' and sorts by current_period_end so the manager sees
-- "subscriptions that expire soonest among the at-risk set". The composite
-- index covers both the WHERE and the ORDER BY in a single scan.
CREATE INDEX memberships_status_idx ON memberships (status, current_period_end);

-- ENABLE + FORCE row-level security (premortem R8).
--
-- Per the schema-slice premortem D4 amendment: each table-creating migration
-- enables AND forces RLS in its OWN file so the "RLS-off write window
-- between table-create and policy-create" is zero. Policies (CREATE POLICY)
-- land in 0016_payments_rls.sql; this migration ships only the default-deny
-- posture. memberships gets a manager+ UPDATE policy there to support the
-- membership-override surface (Slice 2 wiring).
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE  ROW LEVEL SECURITY;
