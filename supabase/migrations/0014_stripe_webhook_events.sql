-- ADR-0036: Payment Management Console (Slice 1 — Schema substrate C).
-- Spec: docs/specs/0036-payment-management-console-implementation.md AC7, AC9.
-- Acceptance criteria covered by this migration: AC7 (structural), AC9
-- (migrate:check passes — purely additive). Verified by
-- tests/migrations/stripe-webhook-events-shape.test.ts (regex + AST +
-- pglite-applies tiers).
--
-- Scope: additive schema changes only. One new table (stripe_webhook_events)
-- with THREE indexes (received DESC, unprocessed partial, stuck partial),
-- ENABLE+FORCE RLS at end of file. No policies — policies land in
-- 0016_payments_rls.sql per the slice plan.
--
-- migration-review: blocking-index-approved
-- Justification for blocking-index: stripe_webhook_events is created EMPTY
-- in this same migration. CREATE INDEX on an empty, newly-created table
-- acquires the lock for microseconds and has no production traffic to block
-- (the table did not exist 2 statements earlier). CONCURRENTLY is not an
-- option because Supabase wraps each migration file in a single transaction
-- and CREATE INDEX CONCURRENTLY cannot run inside a transaction. Same
-- posture as 0003, 0005, 0008.
--
-- Premortem coupling (.conductor/36/returns/0004-premortem-schema.md):
--   R7 — stripe_webhook_events partial-write invisibility → add `attempts
--        integer NOT NULL DEFAULT 0` so a retry can increment it and a
--        partial-write becomes visible (`attempts > 0 AND processed_at IS
--        NULL` = crashed). Plus a partial index for the SEV2 alert
--        cohort: `stripe_webhook_events_stuck_idx`. The "just arrived"
--        cohort (attempts = 0 AND processed_at IS NULL) is the normal
--        startup state and is captured by the existing `unprocessed_idx`.
--   R8 — RLS-off window → ENABLE + FORCE row level security at end of THIS
--        migration so default-deny is in place BEFORE 0016 lands policies.
--        Writes to this table are EXCLUSIVELY service-role (webhook handler);
--        no INSERT/UPDATE policy is ever planned.

CREATE TABLE stripe_webhook_events (
    event_id      text        PRIMARY KEY,                            -- Stripe `evt_*` — idempotency anchor (ADR-0005)
    event_type    text        NOT NULL,                               -- 'payment_intent.succeeded' | 'charge.refunded' | ...
    livemode      boolean     NOT NULL,                               -- false for test-mode events
    payload       jsonb       NOT NULL,                               -- full Stripe event payload for forensics
    received_at   timestamptz NOT NULL DEFAULT now(),
    processed_at  timestamptz,                                        -- nullable; set when side effects complete
    processing_ms integer,                                            -- nullable; latency for SLO tracking
    error         text,                                               -- nullable; populated on handler throw
    -- Premortem R7: attempts column lets a retry increment a counter so
    -- a crashed-mid-processing row is distinguishable from a just-arrived
    -- row. The Slice 2 webhook handler increments this on each attempt
    -- before doing side-effect work; the stuck_idx partial index below
    -- selects the "crashed" cohort for the SEV2 alert.
    attempts      integer     NOT NULL DEFAULT 0,

    -- Premortem R7: non-negative invariant on attempts. Catches a future
    -- handler bug that decrements attempts past zero (which would be
    -- semantically meaningless and corrupt the stuck-idx cohort).
    CONSTRAINT stripe_webhook_events_attempts_nonneg CHECK (attempts >= 0)
);

COMMENT ON TABLE stripe_webhook_events IS
    'Per ADR-0036 / ADR-0005. Stripe webhook event log AND idempotency '
    'anchor. PK on event_id (Stripe evt_*); duplicate deliveries hit the PK '
    'and the Slice 2 webhook handler treats the conflict as ON CONFLICT DO '
    'NOTHING — no side effects re-run per ADR-0005. Written ONLY by '
    '/api/webhooks/stripe (Slice 2); read by /admin/payments and (Slice 2) '
    '/admin/payments/webhooks. RLS-enabled with FORCE — default-deny posture '
    'until 0016 lands policies; service-role retains BYPASSRLS for the '
    'webhook write path. NO INSERT/UPDATE policy is ever planned (writes are '
    'service-role-exclusive). Crashed-mid-processing rows are visible via '
    'the stuck_idx partial index (attempts > 0 AND processed_at IS NULL) — '
    'distinct from the "just arrived" cohort captured by unprocessed_idx '
    '(attempts = 0 AND processed_at IS NULL is normal startup state).';

-- Indexes (ADR-0036 §Data model + premortem R7).
--
-- received_idx serves the admin webhook-list page in chronological order
-- (most-recent-first). DESC matches the page's default sort.
CREATE INDEX stripe_webhook_events_received_idx
    ON stripe_webhook_events (received_at DESC);

-- unprocessed_idx is the "in-flight + just-arrived" cohort. Used by the
-- overview "webhook health" card (count of unprocessed events) and by the
-- Slice 4 retry job that picks up never-completed rows.
CREATE INDEX stripe_webhook_events_unprocessed_idx
    ON stripe_webhook_events (received_at)
    WHERE processed_at IS NULL;

-- stuck_idx is the "crashed-during-processing" cohort (premortem R7).
-- The Slice 2 webhook handler increments attempts BEFORE doing side-effect
-- work; a row with attempts > 0 AND processed_at IS NULL means the handler
-- crashed between the increment and the completion stamp. This cohort
-- triggers a SEV2 alert in Slice 4 (post-v1; v1 is alert-and-investigate).
CREATE INDEX stripe_webhook_events_stuck_idx
    ON stripe_webhook_events (received_at)
    WHERE processed_at IS NULL AND attempts > 0;

-- ENABLE + FORCE row-level security (premortem R8 / synthesis D4).
--
-- Per the schema-slice premortem D4 amendment: each table-creating migration
-- enables AND forces RLS in its OWN file. stripe_webhook_events gets a
-- manager+ READ policy in 0016; writes are service-role-only.
ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_webhook_events FORCE  ROW LEVEL SECURITY;
